import path from 'node:path';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { User } from '@prisma/client';
import { z } from 'zod';
import type { BuildManifest } from '@gameserver/shared';
import type { AppContext } from '../context.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { sendFile } from '../lib/send.js';
import { requireAuth } from '../plugins/auth.js';
import { canEditGame, canViewGame } from '../services/access.js';
import { buildDto } from '../services/dto.js';
import { iso } from '../lib/time.js';

/** Lädt einen Build und prüft die Download-Berechtigung. */
export async function loadDownloadableBuild(ctx: AppContext, user: User, buildId: string) {
  const build = await ctx.db.build.findUnique({
    where: { id: buildId },
    include: { version: { include: { game: true } }, _count: { select: { files: true } } },
  });
  if (!build) throw notFound('Build nicht gefunden');
  const game = build.version.game;
  if (await canEditGame(ctx.db, user, game.id)) return build;
  if (!(await canViewGame(ctx.db, user, game))) throw notFound('Build nicht gefunden');
  if (!build.version.published || build.status !== 'READY') throw forbidden('Build ist nicht veröffentlicht', 'not_published');
  return build;
}

export const downloadRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;

  async function recordDownload(userId: string, gameId: string, buildId: string) {
    // Pro Nutzer und Build höchstens ein Zähler je Stunde (Fortsetzen/parallele Chunks zählen nicht doppelt)
    const recent = await ctx.db.downloadEvent.findFirst({
      where: { userId, buildId, createdAt: { gte: new Date(Date.now() - 3600_000) } },
    });
    if (recent) return;
    await ctx.db.$transaction([
      ctx.db.downloadEvent.create({ data: { userId, gameId, buildId } }),
      ctx.db.game.update({ where: { id: gameId }, data: { downloadCount: { increment: 1 } } }),
    ]);
  }

  app.get(
    '/:buildId/manifest',
    { schema: { tags: ['downloads'], summary: 'Datei-Manifest eines Builds (Pfade, Größen, SHA-256)', params: z.object({ buildId: z.string() }) } },
    async (req): Promise<BuildManifest> => {
      const { user } = requireAuth(req);
      const build = await loadDownloadableBuild(ctx, user, req.params.buildId);
      const files = await ctx.db.buildFile.findMany({ where: { buildId: build.id }, orderBy: { path: 'asc' } });
      const game = build.version.game;
      return {
        game: { id: game.id, slug: game.slug, title: game.title },
        version: {
          id: build.version.id,
          version: build.version.version,
          changelog: build.version.changelog,
          publishedAt: iso(build.version.publishedAt),
        },
        build: buildDto(build),
        files: files.map((f) => ({
          id: f.id,
          path: f.path,
          size: Number(f.size),
          sha256: f.sha256,
          downloadUrl: `/api/builds/${build.id}/files/${f.id}`,
        })),
      };
    },
  );

  // HEAD wird von Fastify automatisch aus der GET-Route erzeugt.
  app.get(
    '/:buildId/files/:fileId',
    {
      schema: {
        tags: ['downloads'],
        summary: 'Datei herunterladen (unterstützt HTTP Range)',
        params: z.object({ buildId: z.string(), fileId: z.string() }),
      },
      config: { rateLimit: false },
    },
    async (req, reply) => {
      const { user } = requireAuth(req);
      const build = await loadDownloadableBuild(ctx, user, req.params.buildId);
      const file = await ctx.db.buildFile.findFirst({ where: { id: req.params.fileId, buildId: build.id } });
      if (!file) throw notFound('Datei nicht gefunden');
      const settings = await ctx.settings.get();
      const rangeStart = /^bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1];
      if (req.method === 'GET' && (!rangeStart || rangeStart === '0')) {
        await recordDownload(user.id, build.version.gameId, build.id);
      }
      return sendFile(req, reply, {
        filePath: ctx.storage.resolve(file.storageKey),
        size: Number(file.size),
        filename: path.posix.basename(file.path),
        etag: file.sha256,
        rateKbps: settings.downloadRateLimitKbps,
        cacheControl: 'private, no-transform',
      });
    },
  );

  app.get(
    '/:buildId/download',
    { schema: { tags: ['downloads'], summary: 'Einzeldatei-Build direkt herunterladen (Weiterleitung)', params: z.object({ buildId: z.string() }) } },
    async (req, reply) => {
      const { user } = requireAuth(req);
      const build = await loadDownloadableBuild(ctx, user, req.params.buildId);
      if (build.kind === 'FOLDER') throw badRequest('Ordner-Builds bitte über den Desktop-Client oder das Manifest laden', 'folder_build');
      const file = await ctx.db.buildFile.findFirst({ where: { buildId: build.id } });
      if (!file) throw notFound('Build enthält keine Datei');
      return reply.redirect(`/api/builds/${build.id}/files/${file.id}`);
    },
  );
};
