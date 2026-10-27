import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { METADATA_FIELDS, type ManagedGame } from '@gameserver/shared';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import { detectImage } from '../lib/images.js';
import { normalizeRelPath } from '../lib/paths.js';
import { slugify } from '../lib/slug.js';
import { requireAuth } from '../plugins/auth.js';
import { assertCanEditGame, canUpload, isAdmin } from '../services/access.js';
import { gameDetail } from '../services/catalog.js';
import { buildDto, gameSummary, gameSummaryInclude, mediaDto, userPublic, versionDto } from '../services/dto.js';

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const SINGLE_MEDIA = new Set(['COVER', 'HEADER', 'BACKGROUND']);

const requirementsBlock = z.object({ minimum: z.string().max(5000).optional(), recommended: z.string().max(5000).optional() });
const gameBody = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,80}$/)
    .optional(),
  shortDescription: z.string().max(500).optional(),
  description: z.string().max(100_000).optional(),
  developer: z.string().max(200).nullable().optional(),
  publisher: z.string().max(200).nullable().optional(),
  releaseDate: z.string().date().nullable().optional(),
  website: z.string().url().max(500).nullable().optional(),
  trailerUrls: z.array(z.string().url().max(500)).max(10).optional(),
  systemRequirements: z.object({ windows: requirementsBlock, linux: requirementsBlock, macos: requirementsBlock }).partial().optional(),
  visibility: z.enum(['PUBLIC', 'UNLISTED', 'RESTRICTED', 'HIDDEN']).optional(),
  featured: z.boolean().optional(),
  genres: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
  // Phase 4
  ageRating: z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(16), z.literal(18)]).optional(),
  savePaths: z
    .array(
      z.object({
        platform: z.enum(['WINDOWS', 'LINUX', 'ANY']),
        path: z.string().trim().min(1).max(500),
        include: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
        exclude: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
      }),
    )
    .max(16)
    .optional(),
  workshopPath: z
    .string()
    .trim()
    .max(200)
    .refine((p) => !p.split(/[\\/]/).includes('..') && !p.startsWith('/') && !/^[a-zA-Z]:/.test(p), 'Relativer Pfad erwartet')
    .nullable()
    .optional(),
});

const buildBody = z.object({
  platform: z.enum(['WINDOWS', 'LINUX', 'MACOS']),
  kind: z.enum(['ZIP', 'SEVEN_ZIP', 'FOLDER', 'INSTALLER']),
  executable: z.string().max(1024).optional(),
  launchArgs: z.string().max(2000).optional(),
  workingDir: z.string().max(1024).optional(),
  installerArgs: z.string().max(2000).optional(),
  linuxRunner: z.enum(['NONE', 'PROTON', 'WINE']).optional(),
  installSize: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});

const connectNames = (names: string[]) => {
  const unique = new Map<string, string>();
  for (const n of names) if (slugify(n)) unique.set(slugify(n), n);
  return [...unique].map(([slug, name]) => ({ where: { slug }, create: { slug, name } }));
};

export const manageRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;

  const editor = (req: Parameters<typeof requireAuth>[0]) => {
    const auth = requireAuth(req);
    if (!canUpload(auth.user)) throw forbidden('Nur Admins und Uploader');
    return auth.user;
  };

  async function managedGame(userId: string, gameId: string): Promise<ManagedGame> {
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: userId } });
    const detail = await gameDetail(ctx, user, gameId);
    const game = await ctx.db.game.findUniqueOrThrow({
      where: { id: gameId },
      include: { maintainers: { include: { user: true } }, access: { include: { user: true } } },
    });
    const storage = await ctx.db.buildFile.aggregate({ where: { build: { version: { gameId } } }, _sum: { size: true } });
    return {
      ...detail,
      igdbId: game.igdbId,
      rawgId: game.rawgId,
      maintainers: game.maintainers.map((m) => userPublic(m.user)),
      accessUsers: game.access.map((a) => userPublic(a.user)),
      storageBytes: Number(storage._sum.size ?? 0n),
    };
  }

  // ---- Spiele ----

  app.get(
    '/games',
    {
      schema: {
        tags: ['manage'],
        summary: 'Verwaltbare Spiele (Admin: alle, Uploader: eigene)',
        querystring: z.object({ q: z.string().trim().max(200).optional() }),
      },
    },
    async (req) => {
      const user = editor(req);
      const games = await ctx.db.game.findMany({
        where: {
          AND: [
            isAdmin(user) ? {} : { maintainers: { some: { userId: user.id } } },
            req.query.q ? { title: { contains: req.query.q, mode: 'insensitive' } } : {},
          ],
        },
        include: { ...gameSummaryInclude, _count: { select: { versions: true, libraryEntries: true } } },
        orderBy: { updatedAt: 'desc' },
      });
      return games.map((g) => ({
        ...gameSummary(g),
        versionCount: g._count.versions,
        libraryCount: g._count.libraryEntries,
        downloadCount: g.downloadCount,
        updatedAt: g.updatedAt.toISOString(),
      }));
    },
  );

  app.post('/games', { schema: { tags: ['manage'], summary: 'Spiel anlegen', body: gameBody } }, async (req) => {
    const user = editor(req);
    const { genres, tags, releaseDate, slug, systemRequirements, savePaths, ...rest } = req.body;
    let finalSlug = slug ?? slugify(rest.title);
    for (let i = 2; await ctx.db.game.findUnique({ where: { slug: finalSlug } }); i++) finalSlug = `${slug ?? slugify(rest.title)}-${i}`;
    const visibility = rest.visibility ?? 'HIDDEN';
    const game = await ctx.db.game.create({
      data: {
        ...rest,
        slug: finalSlug,
        visibility,
        featured: isAdmin(user) ? rest.featured : false,
        publishedAt: visibility !== 'HIDDEN' ? new Date() : null,
        releaseDate: releaseDate ? new Date(releaseDate) : null,
        systemRequirements: (systemRequirements ?? {}) as Prisma.InputJsonValue,
        savePaths: (savePaths ?? []) as Prisma.InputJsonValue,
        createdById: user.id,
        genres: genres ? { connectOrCreate: connectNames(genres) } : undefined,
        tags: tags ? { connectOrCreate: connectNames(tags) } : undefined,
        maintainers: { create: { userId: user.id } },
      },
    });
    await ctx.audit.log({ userId: user.id, action: 'game.created', target: game.id, meta: { title: game.title }, ip: req.ip });
    return managedGame(user.id, game.id);
  });

  app.get('/games/:id', { schema: { tags: ['manage'], summary: 'Spiel (Verwaltungsansicht)', params: z.object({ id: z.string() }) } }, async (req) => {
    const user = editor(req);
    await assertCanEditGame(ctx.db, user, req.params.id);
    return managedGame(user.id, req.params.id);
  });

  app.patch(
    '/games/:id',
    { schema: { tags: ['manage'], summary: 'Spiel bearbeiten', params: z.object({ id: z.string() }), body: gameBody.partial() } },
    async (req) => {
      const user = editor(req);
      const game = await assertCanEditGame(ctx.db, user, req.params.id);
      const { genres, tags, releaseDate, systemRequirements, featured, savePaths, ...rest } = req.body;
      const data: Prisma.GameUpdateInput = { ...rest };
      if (savePaths !== undefined) data.savePaths = savePaths as Prisma.InputJsonValue;
      if (featured !== undefined && isAdmin(user)) data.featured = featured;
      if (releaseDate !== undefined) data.releaseDate = releaseDate ? new Date(releaseDate) : null;
      if (systemRequirements !== undefined) data.systemRequirements = systemRequirements as Prisma.InputJsonValue;
      if (rest.visibility && rest.visibility !== 'HIDDEN' && !game.publishedAt) data.publishedAt = new Date();
      if (genres) data.genres = { set: [], connectOrCreate: connectNames(genres) };
      if (tags) data.tags = { set: [], connectOrCreate: connectNames(tags) };
      await ctx.db.game.update({ where: { id: game.id }, data });
      await ctx.audit.log({ userId: user.id, action: 'game.updated', target: game.id, meta: { fields: Object.keys(req.body) }, ip: req.ip });
      return managedGame(user.id, game.id);
    },
  );

  app.delete('/games/:id', { schema: { tags: ['manage'], summary: 'Spiel inkl. aller Dateien löschen', params: z.object({ id: z.string() }) } }, async (req) => {
    const user = editor(req);
    const game = await assertCanEditGame(ctx.db, user, req.params.id);
    const builds = await ctx.db.build.findMany({ where: { version: { gameId: game.id } }, select: { id: true } });
    await ctx.db.game.delete({ where: { id: game.id } });
    for (const b of builds) await ctx.storage.remove(`builds/${b.id}`);
    await ctx.storage.remove(`media/${game.id}`);
    await ctx.audit.log({ userId: user.id, action: 'game.deleted', target: game.id, meta: { title: game.title }, ip: req.ip });
    return { ok: true };
  });

  // ---- Rechte pro Spiel ----

  const userRef = z.object({ username: z.string().trim().min(1).max(64) });

  app.post(
    '/games/:id/maintainers',
    { schema: { tags: ['manage'], summary: 'Maintainer hinzufügen (Rolle Uploader/Admin nötig)', params: z.object({ id: z.string() }), body: userRef } },
    async (req) => {
      const user = editor(req);
      const game = await assertCanEditGame(ctx.db, user, req.params.id);
      const target = await ctx.db.user.findFirst({ where: { username: { equals: req.body.username, mode: 'insensitive' } } });
      if (!target) throw notFound('Nutzer nicht gefunden');
      if (!canUpload(target)) throw badRequest('Nutzer benötigt die Rolle Uploader oder Admin', 'role_required');
      await ctx.db.gameMaintainer.upsert({
        where: { gameId_userId: { gameId: game.id, userId: target.id } },
        create: { gameId: game.id, userId: target.id },
        update: {},
      });
      await ctx.audit.log({ userId: user.id, action: 'game.maintainer_added', target: game.id, meta: { user: target.username }, ip: req.ip });
      return managedGame(user.id, game.id);
    },
  );

  app.delete(
    '/games/:id/maintainers/:userId',
    { schema: { tags: ['manage'], summary: 'Maintainer entfernen', params: z.object({ id: z.string(), userId: z.string() }) } },
    async (req) => {
      const user = editor(req);
      const game = await assertCanEditGame(ctx.db, user, req.params.id);
      await ctx.db.gameMaintainer.deleteMany({ where: { gameId: game.id, userId: req.params.userId } });
      await ctx.audit.log({ userId: user.id, action: 'game.maintainer_removed', target: game.id, meta: { userId: req.params.userId }, ip: req.ip });
      return managedGame(user.id, game.id);
    },
  );

  app.post(
    '/games/:id/access',
    { schema: { tags: ['manage'], summary: 'Zugriff für eingeschränktes Spiel gewähren', params: z.object({ id: z.string() }), body: userRef } },
    async (req) => {
      const user = editor(req);
      const game = await assertCanEditGame(ctx.db, user, req.params.id);
      const target = await ctx.db.user.findFirst({ where: { username: { equals: req.body.username, mode: 'insensitive' } } });
      if (!target) throw notFound('Nutzer nicht gefunden');
      await ctx.db.gameAccess.upsert({
        where: { gameId_userId: { gameId: game.id, userId: target.id } },
        create: { gameId: game.id, userId: target.id },
        update: {},
      });
      await ctx.audit.log({ userId: user.id, action: 'game.access_granted', target: game.id, meta: { user: target.username }, ip: req.ip });
      return managedGame(user.id, game.id);
    },
  );

  app.delete(
    '/games/:id/access/:userId',
    { schema: { tags: ['manage'], summary: 'Zugriff entziehen', params: z.object({ id: z.string(), userId: z.string() }) } },
    async (req) => {
      const user = editor(req);
      const game = await assertCanEditGame(ctx.db, user, req.params.id);
      await ctx.db.gameAccess.deleteMany({ where: { gameId: game.id, userId: req.params.userId } });
      await ctx.audit.log({ userId: user.id, action: 'game.access_revoked', target: game.id, meta: { userId: req.params.userId }, ip: req.ip });
      return managedGame(user.id, game.id);
    },
  );

  // ---- Medien ----

  app.post(
    '/games/:id/media',
    {
      schema: {
        tags: ['manage'],
        summary: 'Bild hochladen (multipart, Feld "file")',
        params: z.object({ id: z.string() }),
        querystring: z.object({ kind: z.enum(['COVER', 'HEADER', 'BACKGROUND', 'SCREENSHOT', 'ARTWORK']) }),
      },
    },
    async (req) => {
      const user = editor(req);
      const game = await assertCanEditGame(ctx.db, user, req.params.id);
      const file = await req.file({ limits: { fileSize: MAX_MEDIA_BYTES } });
      if (!file) throw badRequest('Keine Datei', 'no_file');
      const data = await file.toBuffer();
      if (file.file.truncated) throw new HttpError(413, 'too_large', 'Bild ist zu groß (max. 25 MB)');
      const type = detectImage(data);
      if (!type) throw badRequest('Nur PNG, JPEG, WebP, GIF oder AVIF erlaubt', 'invalid_image');
      const kind = req.query.kind;
      const old = SINGLE_MEDIA.has(kind) ? await ctx.db.gameMedia.findMany({ where: { gameId: game.id, kind } }) : [];
      const sortOrder = SINGLE_MEDIA.has(kind) ? 0 : await ctx.db.gameMedia.count({ where: { gameId: game.id, kind } });
      const media = await ctx.db.gameMedia.create({
        data: { gameId: game.id, kind, storageKey: 'pending', mimeType: type.mime, size: data.length, sortOrder },
      });
      const key = `media/${game.id}/${media.id}.${type.ext}`;
      await ctx.storage.write(key, data);
      const saved = await ctx.db.gameMedia.update({ where: { id: media.id }, data: { storageKey: key } });
      for (const o of old) {
        await ctx.db.gameMedia.delete({ where: { id: o.id } });
        await ctx.storage.remove(o.storageKey);
      }
      return mediaDto(saved);
    },
  );

  app.delete(
    '/games/:id/media/:mediaId',
    { schema: { tags: ['manage'], summary: 'Bild löschen', params: z.object({ id: z.string(), mediaId: z.string() }) } },
    async (req) => {
      const user = editor(req);
      const game = await assertCanEditGame(ctx.db, user, req.params.id);
      const media = await ctx.db.gameMedia.findFirst({ where: { id: req.params.mediaId, gameId: game.id } });
      if (!media) throw notFound('Medium nicht gefunden');
      await ctx.db.gameMedia.delete({ where: { id: media.id } });
      await ctx.storage.remove(media.storageKey);
      return { ok: true };
    },
  );

  app.put(
    '/games/:id/media/order',
    {
      schema: {
        tags: ['manage'],
        summary: 'Reihenfolge von Screenshots/Artworks setzen',
        params: z.object({ id: z.string() }),
        body: z.object({ ids: z.array(z.string()).max(200) }),
      },
    },
    async (req) => {
      const user = editor(req);
      const game = await assertCanEditGame(ctx.db, user, req.params.id);
      await ctx.db.$transaction(
        req.body.ids.map((id, i) => ctx.db.gameMedia.updateMany({ where: { id, gameId: game.id }, data: { sortOrder: i } })),
      );
      return { ok: true };
    },
  );

  // ---- Metadaten (IGDB/RAWG) ----

  app.get(
    '/metadata/search',
    {
      schema: {
        tags: ['manage'],
        summary: 'Metadaten bei IGDB/RAWG suchen',
        querystring: z.object({ provider: z.enum(['igdb', 'rawg']), q: z.string().trim().min(1).max(200) }),
      },
    },
    async (req) => {
      editor(req);
      try {
        return await ctx.metadata.search(req.query.provider, req.query.q);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(502, 'provider_error', err instanceof Error ? err.message : 'Anbieter nicht erreichbar');
      }
    },
  );

  app.post(
    '/games/:id/metadata/import',
    {
      schema: {
        tags: ['manage'],
        summary: 'Metadaten übernehmen',
        params: z.object({ id: z.string() }),
        body: z.object({
          provider: z.enum(['igdb', 'rawg']),
          externalId: z.string().min(1).max(50),
          fields: z.array(z.enum(METADATA_FIELDS as [string, ...string[]])).min(1),
        }),
      },
    },
    async (req) => {
      const user = editor(req);
      const game = await assertCanEditGame(ctx.db, user, req.params.id);
      try {
        await ctx.metadata.importInto(game.id, req.body.provider, req.body.externalId, req.body.fields as never);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(502, 'provider_error', err instanceof Error ? err.message : 'Anbieter nicht erreichbar');
      }
      await ctx.audit.log({ userId: user.id, action: 'game.metadata_imported', target: game.id, meta: { ...req.body }, ip: req.ip });
      return managedGame(user.id, game.id);
    },
  );

  // ---- Versionen ----

  async function versionWithBuilds(id: string) {
    const v = await ctx.db.gameVersion.findUniqueOrThrow({
      where: { id },
      include: { builds: { include: { _count: { select: { files: true } } }, orderBy: { platform: 'asc' } } },
    });
    return versionDto(v);
  }

  async function editableVersion(userId: string, versionId: string) {
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: userId } });
    const v = await ctx.db.gameVersion.findUnique({ where: { id: versionId } });
    if (!v) throw notFound('Version nicht gefunden');
    await assertCanEditGame(ctx.db, user, v.gameId);
    return v;
  }

  app.post(
    '/games/:id/versions',
    {
      schema: {
        tags: ['manage'],
        summary: 'Version anlegen',
        params: z.object({ id: z.string() }),
        body: z.object({ version: z.string().trim().min(1).max(50), changelog: z.string().max(50_000).optional() }),
      },
    },
    async (req) => {
      const user = editor(req);
      const game = await assertCanEditGame(ctx.db, user, req.params.id);
      const v = await ctx.db.gameVersion.create({ data: { gameId: game.id, version: req.body.version, changelog: req.body.changelog ?? '' } });
      await ctx.audit.log({ userId: user.id, action: 'version.created', target: v.id, meta: { game: game.title, version: v.version }, ip: req.ip });
      return versionWithBuilds(v.id);
    },
  );

  app.patch(
    '/versions/:versionId',
    {
      schema: {
        tags: ['manage'],
        summary: 'Version bearbeiten/veröffentlichen',
        params: z.object({ versionId: z.string() }),
        body: z.object({
          version: z.string().trim().min(1).max(50).optional(),
          changelog: z.string().max(50_000).optional(),
          published: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const user = editor(req);
      const v = await editableVersion(user.id, req.params.versionId);
      if (req.body.published) {
        const ready = await ctx.db.build.count({ where: { versionId: v.id, status: 'READY' } });
        if (ready === 0) throw badRequest('Mindestens ein Build muss bereit sein', 'no_ready_build');
      }
      await ctx.db.gameVersion.update({
        where: { id: v.id },
        data: { ...req.body, publishedAt: req.body.published && !v.publishedAt ? new Date() : undefined },
      });
      await ctx.audit.log({ userId: user.id, action: 'version.updated', target: v.id, meta: req.body, ip: req.ip });
      return versionWithBuilds(v.id);
    },
  );

  app.delete('/versions/:versionId', { schema: { tags: ['manage'], summary: 'Version inkl. Dateien löschen', params: z.object({ versionId: z.string() }) } }, async (req) => {
    const user = editor(req);
    const v = await editableVersion(user.id, req.params.versionId);
    const builds = await ctx.db.build.findMany({ where: { versionId: v.id }, select: { id: true } });
    await ctx.db.gameVersion.delete({ where: { id: v.id } });
    for (const b of builds) await ctx.storage.remove(`builds/${b.id}`);
    await ctx.audit.log({ userId: user.id, action: 'version.deleted', target: v.id, meta: { version: v.version }, ip: req.ip });
    return { ok: true };
  });

  // ---- Builds (Plattform + Format + Startkonfiguration) ----

  async function editableBuild(userId: string, buildId: string) {
    const build = await ctx.db.build.findUnique({ where: { id: buildId } });
    if (!build) throw notFound('Build nicht gefunden');
    await editableVersion(userId, build.versionId);
    return build;
  }

  const buildResponse = async (id: string) =>
    buildDto(await ctx.db.build.findUniqueOrThrow({ where: { id }, include: { _count: { select: { files: true } } } }));

  app.post(
    '/versions/:versionId/builds',
    { schema: { tags: ['manage'], summary: 'Build anlegen', params: z.object({ versionId: z.string() }), body: buildBody } },
    async (req) => {
      const user = editor(req);
      const v = await editableVersion(user.id, req.params.versionId);
      const { installSize, ...rest } = req.body;
      if (rest.linuxRunner && rest.linuxRunner !== 'NONE' && rest.platform !== 'WINDOWS') {
        throw badRequest('Proton/Wine ist nur für Windows-Builds sinnvoll', 'invalid_runner');
      }
      const b = await ctx.db.build.create({
        data: { ...rest, versionId: v.id, installSize: BigInt(installSize ?? 0) },
      });
      await ctx.audit.log({ userId: user.id, action: 'build.created', target: b.id, meta: { platform: b.platform, kind: b.kind }, ip: req.ip });
      return buildResponse(b.id);
    },
  );

  app.patch(
    '/builds/:buildId',
    {
      schema: {
        tags: ['manage'],
        summary: 'Build/Startkonfiguration bearbeiten, Status setzen',
        params: z.object({ buildId: z.string() }),
        body: buildBody.omit({ platform: true, kind: true }).extend({ status: z.enum(['DRAFT', 'READY']).optional() }).partial(),
      },
    },
    async (req) => {
      const user = editor(req);
      const build = await editableBuild(user.id, req.params.buildId);
      const { installSize, status, ...rest } = req.body;
      if (rest.linuxRunner && rest.linuxRunner !== 'NONE' && build.platform !== 'WINDOWS') {
        throw badRequest('Proton/Wine ist nur für Windows-Builds sinnvoll', 'invalid_runner');
      }
      if (status === 'READY') {
        const files = await ctx.db.buildFile.findMany({ where: { buildId: build.id }, select: { path: true } });
        if (files.length === 0) throw badRequest('Build enthält noch keine Dateien', 'no_files');
        const executable = rest.executable ?? build.executable;
        if (build.kind !== 'INSTALLER' && !executable) throw badRequest('Bitte die ausführbare Datei angeben', 'executable_required');
        if (build.kind === 'FOLDER' && executable) {
          const normalized = normalizeRelPath(executable);
          if (!normalized || !files.some((f) => f.path === normalized)) {
            throw badRequest(`Executable "${executable}" ist nicht im Build enthalten`, 'executable_missing');
          }
        }
        const active = await ctx.db.upload.count({ where: { buildId: build.id, status: 'ACTIVE' } });
        if (active > 0) throw badRequest('Es laufen noch Uploads für diesen Build', 'uploads_active');
      }
      await ctx.db.build.update({
        where: { id: build.id },
        data: { ...rest, status, installSize: installSize !== undefined ? BigInt(installSize) : undefined },
      });
      await ctx.audit.log({ userId: user.id, action: 'build.updated', target: build.id, meta: req.body, ip: req.ip });
      return buildResponse(build.id);
    },
  );

  app.delete('/builds/:buildId', { schema: { tags: ['manage'], summary: 'Build löschen', params: z.object({ buildId: z.string() }) } }, async (req) => {
    const user = editor(req);
    const build = await editableBuild(user.id, req.params.buildId);
    await ctx.db.build.delete({ where: { id: build.id } });
    await ctx.storage.remove(`builds/${build.id}`);
    await ctx.audit.log({ userId: user.id, action: 'build.deleted', target: build.id, ip: req.ip });
    return { ok: true };
  });

  app.get('/builds/:buildId/files', { schema: { tags: ['manage'], summary: 'Dateien eines Builds', params: z.object({ buildId: z.string() }) } }, async (req) => {
    const user = editor(req);
    const build = await editableBuild(user.id, req.params.buildId);
    const files = await ctx.db.buildFile.findMany({ where: { buildId: build.id }, orderBy: { path: 'asc' } });
    return files.map((f) => ({
      id: f.id,
      path: f.path,
      size: Number(f.size),
      sha256: f.sha256,
      downloadUrl: `/api/builds/${build.id}/files/${f.id}`,
    }));
  });

  app.delete(
    '/builds/:buildId/files/:fileId',
    { schema: { tags: ['manage'], summary: 'Datei aus Build entfernen', params: z.object({ buildId: z.string(), fileId: z.string() }) } },
    async (req) => {
      const user = editor(req);
      const build = await editableBuild(user.id, req.params.buildId);
      const file = await ctx.db.buildFile.findFirst({ where: { id: req.params.fileId, buildId: build.id } });
      if (!file) throw notFound('Datei nicht gefunden');
      await ctx.db.buildFile.delete({ where: { id: file.id } });
      await ctx.storage.remove(file.storageKey);
      await ctx.uploads.recalcBuild(build.id);
      if (build.status === 'READY' && (await ctx.db.buildFile.count({ where: { buildId: build.id } })) === 0) {
        await ctx.db.build.update({ where: { id: build.id }, data: { status: 'DRAFT' } });
      }
      return { ok: true };
    },
  );
};
