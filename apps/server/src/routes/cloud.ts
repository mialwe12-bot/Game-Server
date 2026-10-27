import { createHash } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { CloudSave } from '@prisma/client';
import type { CloudSaveDto, CloudSaveFile, CloudSaveOverview, CloudSaveStatus, SavePathConfig } from '@gameserver/shared';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import { sendFile } from '../lib/send.js';
import { isZip, storeStream } from '../lib/stream-upload.js';
import { requireAuth } from '../plugins/auth.js';
import { canViewGame } from '../services/access.js';
import { gameRef } from '../services/achievements.js';

const gameParams = z.object({ gameId: z.string() });

const manifestSchema = z
  .array(
    z.object({
      root: z.number().int().min(0).max(31),
      path: z
        .string()
        .min(1)
        .max(1024)
        .refine((p) => !p.split(/[\\/]/).includes('..') && !p.startsWith('/'), 'Ungültiger Pfad'),
      size: z.number().int().min(0),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      mtime: z.number().int().min(0),
    }),
  )
  .max(20000);

/** Inhaltskennung: unabhängig von Reihenfolge und Änderungszeit */
export function contentHash(manifest: CloudSaveFile[]): string {
  const lines = manifest.map((f) => `${f.root}:${f.path}:${f.sha256}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export function savePathsOf(raw: unknown): SavePathConfig[] {
  return Array.isArray(raw) ? (raw as SavePathConfig[]) : [];
}

/** Cloud-Saves: versionierte Spielstände pro Nutzer und Spiel. Konflikterkennung über die Basisversion des Clients. */
export const cloudRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const { db } = ctx;

  const dto = (s: CloudSave): CloudSaveDto => ({
    id: s.id,
    gameId: s.gameId,
    version: s.version,
    size: Number(s.size),
    contentHash: s.contentHash,
    fileCount: Array.isArray(s.manifest) ? s.manifest.length : 0,
    deviceName: s.deviceName,
    platform: s.platform,
    createdAt: s.createdAt.toISOString(),
    downloadUrl: `/api/cloud/${s.gameId}/versions/${s.version}/download`,
  });

  async function enabled() {
    const s = await ctx.settings.get();
    if (!s.cloudSavesEnabled) throw forbidden('Cloud-Saves sind deaktiviert', 'cloud_disabled');
    return s;
  }

  async function usedBytes(userId: string): Promise<number> {
    const agg = await db.cloudSave.aggregate({ where: { userId }, _sum: { size: true } });
    return Number(agg._sum.size ?? 0);
  }

  async function game(userId: string, gameId: string) {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const g = await db.game.findUnique({ where: { id: gameId } });
    if (!g || !(await canViewGame(db, user, g))) throw notFound('Spiel nicht gefunden');
    return g;
  }

  app.get('/', { schema: { tags: ['cloud'], summary: 'Eigene Cloud-Saves (pro Spiel die neueste Version)' } }, async (req): Promise<CloudSaveOverview[]> => {
    const { user } = requireAuth(req);
    const saves = await db.cloudSave.findMany({ where: { userId: user.id }, include: { game: true }, orderBy: { version: 'desc' } });
    const byGame = new Map<string, CloudSaveOverview>();
    for (const s of saves) {
      const cur = byGame.get(s.gameId);
      if (!cur) byGame.set(s.gameId, { game: gameRef(s.game), latest: dto(s), versions: 1, totalBytes: Number(s.size) });
      else {
        cur.versions++;
        cur.totalBytes += Number(s.size);
      }
    }
    return [...byGame.values()].sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
  });

  app.get('/:gameId', { schema: { tags: ['cloud'], summary: 'Cloud-Status eines Spiels', params: gameParams } }, async (req): Promise<CloudSaveStatus> => {
    const { user } = requireAuth(req);
    const s = await ctx.settings.get();
    const g = await game(user.id, req.params.gameId);
    const versions = await db.cloudSave.findMany({ where: { userId: user.id, gameId: g.id }, orderBy: { version: 'desc' } });
    const latest = versions[0];
    return {
      enabled: s.cloudSavesEnabled,
      savePaths: savePathsOf(g.savePaths),
      latest: latest ? { ...dto(latest), manifest: latest.manifest as unknown as CloudSaveFile[] } : null,
      versions: versions.map(dto),
      quotaBytes: s.cloudQuotaBytes,
      usedBytes: await usedBytes(user.id),
    };
  });

  app.post(
    '/:gameId',
    {
      schema: {
        tags: ['cloud'],
        summary: 'Spielstand hochladen (multipart: Feld „manifest“ (JSON) vor Datei „file“ (ZIP))',
        params: gameParams,
        querystring: z.object({
          baseVersion: z.coerce.number().int().min(0).default(0),
          force: z.coerce.boolean().default(false),
          deviceName: z.string().max(100).optional(),
          platform: z.enum(['WINDOWS', 'LINUX', 'MACOS']).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { user } = requireAuth(req);
      const settings = await enabled();
      const g = await game(user.id, req.params.gameId);
      const latest = await db.cloudSave.findFirst({ where: { userId: user.id, gameId: g.id }, orderBy: { version: 'desc' } });
      const remaining = settings.cloudQuotaBytes > 0 ? settings.cloudQuotaBytes - (await usedBytes(user.id)) : Number.MAX_SAFE_INTEGER;
      const file = await req.file({ limits: { fileSize: Math.max(1, Math.min(remaining, 4 * 1024 ** 3)) } });
      if (!file) throw badRequest('Keine Datei', 'no_file');
      const manifestField = file.fields.manifest as { value?: string } | undefined;
      let manifest: CloudSaveFile[];
      try {
        manifest = manifestSchema.parse(JSON.parse(String(manifestField?.value ?? '')));
      } catch {
        file.file.resume();
        throw badRequest('Manifest fehlt oder ist ungültig (Feld „manifest“ muss vor der Datei gesendet werden)', 'invalid_manifest');
      }
      const hash = contentHash(manifest);
      if (latest && latest.contentHash === hash) {
        file.file.resume();
        return { save: dto(latest), unchanged: true };
      }
      // Konflikt: Auf dem Server liegt eine neuere Version als die, auf der der Client aufbaut
      if (latest && latest.version > req.query.baseVersion && !req.query.force) {
        file.file.resume();
        return reply.code(409).send({ error: 'conflict', message: 'Auf dem Server liegt ein neuerer Spielstand', details: { latest: dto(latest) } });
      }
      const version = (latest?.version ?? 0) + 1;
      const key = `cloud/${user.id}/${g.id}/${version}-${Date.now().toString(36)}.zip`;
      let stored;
      try {
        stored = await storeStream(ctx.storage, file.file, key, Math.max(0, remaining));
      } catch (err) {
        if (err instanceof HttpError && err.code === 'too_large') throw new HttpError(413, 'quota_exceeded', 'Cloud-Speicherkontingent überschritten');
        throw err;
      }
      if (!isZip(stored.head) && stored.size > 0) {
        await ctx.storage.remove(key);
        throw badRequest('Spielstand muss ein ZIP-Archiv sein', 'invalid_archive');
      }
      const save = await db.cloudSave.create({
        data: {
          userId: user.id,
          gameId: g.id,
          version,
          storageKey: key,
          size: stored.size,
          contentHash: hash,
          manifest: manifest as never,
          deviceName: req.query.deviceName ?? null,
          platform: req.query.platform ?? null,
        },
      });
      // Alte Versionen aufräumen
      const old = await db.cloudSave.findMany({
        where: { userId: user.id, gameId: g.id },
        orderBy: { version: 'desc' },
        skip: settings.cloudSaveVersions,
      });
      for (const o of old) {
        await ctx.storage.remove(o.storageKey).catch(() => undefined);
        await db.cloudSave.delete({ where: { id: o.id } });
      }
      ctx.hub.toUser(user.id, { type: 'cloud.updated', data: { gameId: g.id, version } });
      return { save: dto(save), unchanged: false };
    },
  );

  app.get(
    '/:gameId/versions/:version/download',
    { schema: { tags: ['cloud'], summary: 'Spielstand herunterladen (ZIP)', params: z.object({ gameId: z.string(), version: z.coerce.number().int() }) } },
    async (req, reply) => {
      const { user } = requireAuth(req);
      const save = await db.cloudSave.findUnique({ where: { userId_gameId_version: { userId: user.id, gameId: req.params.gameId, version: req.params.version } } });
      if (!save) throw notFound('Spielstand nicht gefunden');
      return sendFile(req, reply, {
        filePath: ctx.storage.resolve(save.storageKey),
        size: Number(save.size),
        contentType: 'application/zip',
        filename: `save-${save.version}.zip`,
        etag: save.contentHash,
        cacheControl: 'private, no-cache',
      });
    },
  );

  app.get(
    '/:gameId/versions/:version',
    { schema: { tags: ['cloud'], summary: 'Manifest einer Version', params: z.object({ gameId: z.string(), version: z.coerce.number().int() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const save = await db.cloudSave.findUnique({ where: { userId_gameId_version: { userId: user.id, gameId: req.params.gameId, version: req.params.version } } });
      if (!save) throw notFound('Spielstand nicht gefunden');
      return { ...dto(save), manifest: save.manifest as unknown as CloudSaveFile[] };
    },
  );

  app.post(
    '/:gameId/versions/:version/restore',
    { schema: { tags: ['cloud'], summary: 'Ältere Version zur neuesten machen', params: z.object({ gameId: z.string(), version: z.coerce.number().int() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      await enabled();
      const save = await db.cloudSave.findUnique({ where: { userId_gameId_version: { userId: user.id, gameId: req.params.gameId, version: req.params.version } } });
      if (!save) throw notFound('Spielstand nicht gefunden');
      const latest = await db.cloudSave.findFirstOrThrow({ where: { userId: user.id, gameId: save.gameId }, orderBy: { version: 'desc' } });
      if (latest.id === save.id) return dto(save);
      const version = latest.version + 1;
      const key = `cloud/${user.id}/${save.gameId}/${version}-${Date.now().toString(36)}.zip`;
      const { copyFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(ctx.storage.resolve(key)), { recursive: true });
      await copyFile(ctx.storage.resolve(save.storageKey), ctx.storage.resolve(key));
      const copy = await db.cloudSave.create({
        data: {
          userId: user.id,
          gameId: save.gameId,
          version,
          storageKey: key,
          size: save.size,
          contentHash: save.contentHash,
          manifest: save.manifest as never,
          deviceName: save.deviceName,
          platform: save.platform,
        },
      });
      ctx.hub.toUser(user.id, { type: 'cloud.updated', data: { gameId: save.gameId, version } });
      return dto(copy);
    },
  );

  app.delete('/:gameId', { schema: { tags: ['cloud'], summary: 'Alle Spielstände eines Spiels löschen', params: gameParams } }, async (req) => {
    const { user } = requireAuth(req);
    const saves = await db.cloudSave.findMany({ where: { userId: user.id, gameId: req.params.gameId } });
    for (const s of saves) await ctx.storage.remove(s.storageKey).catch(() => undefined);
    await db.cloudSave.deleteMany({ where: { userId: user.id, gameId: req.params.gameId } });
    return { ok: true, deleted: saves.length };
  });
};
