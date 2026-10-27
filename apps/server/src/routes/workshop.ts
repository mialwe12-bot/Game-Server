import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma, User } from '@prisma/client';
import type { WorkshopCommentDto, WorkshopItemDto, WorkshopSubscriptionDto } from '@gameserver/shared';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { saveImageUpload } from '../lib/image-upload.js';
import { sendFile } from '../lib/send.js';
import { is7z, isZip, storeStream } from '../lib/stream-upload.js';
import { requireAuth } from '../plugins/auth.js';
import { canEditGame, canViewGame, viewableWhere } from '../services/access.js';
import { userPublic } from '../services/dto.js';
import { assertCommunityAllowed } from '../services/family.js';
import { itemInclude, versionDto, workshopItemDto, type ItemRow } from '../services/workshop.js';

const itemBody = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().max(50_000).default(''),
  kind: z.enum(['MOD', 'MAP', 'OTHER']).default('MOD'),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});

/** Workshop: Mods, Maps und andere Inhalte pro Spiel mit Versionen, Bewertungen, Kommentaren und Abos. */
export const workshopRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const { db } = ctx;

  async function enabled() {
    const s = await ctx.settings.get();
    if (!s.workshopEnabled) throw forbidden('Der Workshop ist deaktiviert', 'workshop_disabled');
    return s;
  }

  const dto = (i: ItemRow, viewer: User | null) => workshopItemDto(ctx, i, viewer);

  /** Inhalt laden und Sichtbarkeit prüfen (ausgeblendete Inhalte nur für Autor und Moderation) */
  async function load(id: string, viewer: User | null): Promise<ItemRow> {
    const i = await db.workshopItem.findUnique({ where: { id }, include: itemInclude });
    if (!i || !(await canViewGame(db, viewer, i.game))) throw notFound('Inhalt nicht gefunden');
    if (i.hidden && !(viewer && (i.authorId === viewer.id || (await canEditGame(db, viewer, i.gameId))))) throw notFound('Inhalt nicht gefunden');
    return i;
  }

  async function assertEditor(i: ItemRow, user: User) {
    if (i.authorId !== user.id && !(await canEditGame(db, user, i.gameId))) throw forbidden();
  }

  app.get(
    '/games/:gameId',
    {
      schema: {
        tags: ['workshop'],
        summary: 'Workshop-Inhalte eines Spiels',
        params: z.object({ gameId: z.string() }),
        querystring: z.object({
          q: z.string().trim().max(100).optional(),
          kind: z.enum(['MOD', 'MAP', 'OTHER']).optional(),
          sort: z.enum(['popular', 'recent', 'rating']).default('popular'),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(60).default(24),
        }),
      },
    },
    async (req): Promise<{ items: WorkshopItemDto[]; total: number; enabled: boolean }> => {
      const viewer = req.auth?.user ?? null;
      const settings = await ctx.settings.get();
      const game = await db.game.findFirst({ where: { OR: [{ id: req.params.gameId }, { slug: req.params.gameId }] } });
      if (!game || !(await canViewGame(db, viewer, game))) throw notFound('Spiel nicht gefunden');
      const { q, kind, sort, page, pageSize } = req.query;
      const moderator = !!viewer && (await canEditGame(db, viewer, game.id));
      const where: Prisma.WorkshopItemWhereInput = {
        gameId: game.id,
        ...(kind ? { kind } : {}),
        AND: [
          q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { tags: { has: q.toLowerCase() } }] } : {},
          moderator ? {} : { OR: [{ hidden: false }, ...(viewer ? [{ authorId: viewer.id }] : [])] },
        ],
      };
      const rows = await db.workshopItem.findMany({ where, include: itemInclude });
      const score = (i: ItemRow) => i.ratings.filter((r) => r.up).length - i.ratings.filter((r) => !r.up).length;
      rows.sort((a, b) =>
        sort === 'recent'
          ? b.updatedAt.getTime() - a.updatedAt.getTime()
          : sort === 'rating'
            ? score(b) - score(a) || b._count.subscriptions - a._count.subscriptions
            : b._count.subscriptions - a._count.subscriptions || score(b) - score(a),
      );
      const slice = rows.slice((page - 1) * pageSize, page * pageSize);
      return { items: await Promise.all(slice.map((i) => dto(i, viewer))), total: rows.length, enabled: settings.workshopEnabled && !!game.workshopPath };
    },
  );

  app.get('/items/:id', { schema: { tags: ['workshop'], summary: 'Workshop-Inhalt mit allen Versionen', params: z.object({ id: z.string() }) } }, async (req) => {
    const viewer = req.auth?.user ?? null;
    const i = await load(req.params.id, viewer);
    const versions = await db.workshopVersion.findMany({ where: { itemId: i.id }, orderBy: { createdAt: 'desc' } });
    return { ...(await dto(i, viewer)), versions: versions.map(versionDto) };
  });

  app.post(
    '/games/:gameId',
    { schema: { tags: ['workshop'], summary: 'Workshop-Inhalt anlegen', params: z.object({ gameId: z.string() }), body: itemBody } },
    async (req) => {
      const { user } = requireAuth(req);
      await enabled();
      await assertCommunityAllowed(db, user);
      const game = await db.game.findUnique({ where: { id: req.params.gameId } });
      if (!game || !(await canViewGame(db, user, game))) throw notFound('Spiel nicht gefunden');
      if (!game.workshopPath) throw badRequest('Für dieses Spiel ist der Workshop nicht eingerichtet', 'workshop_not_configured');
      const item = await db.workshopItem.create({
        data: { ...req.body, tags: req.body.tags.map((t) => t.toLowerCase()), gameId: game.id, authorId: user.id },
        include: itemInclude,
      });
      return dto(item, user);
    },
  );

  app.patch(
    '/items/:id',
    { schema: { tags: ['workshop'], summary: 'Workshop-Inhalt bearbeiten', params: z.object({ id: z.string() }), body: itemBody.partial() } },
    async (req) => {
      const { user } = requireAuth(req);
      const i = await load(req.params.id, user);
      await assertEditor(i, user);
      const data = { ...req.body, ...(req.body.tags ? { tags: req.body.tags.map((t) => t.toLowerCase()) } : {}) };
      return dto(await db.workshopItem.update({ where: { id: i.id }, data, include: itemInclude }), user);
    },
  );

  app.post(
    '/items/:id/moderate',
    { schema: { tags: ['workshop'], summary: 'Inhalt aus-/einblenden (Moderation)', params: z.object({ id: z.string() }), body: z.object({ hidden: z.boolean() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const i = await load(req.params.id, user);
      if (!(await canEditGame(db, user, i.gameId))) throw forbidden();
      await ctx.audit.log({ userId: user.id, action: 'workshop.moderated', target: i.id, meta: { hidden: req.body.hidden }, ip: req.ip });
      return dto(await db.workshopItem.update({ where: { id: i.id }, data: { hidden: req.body.hidden }, include: itemInclude }), user);
    },
  );

  app.delete('/items/:id', { schema: { tags: ['workshop'], summary: 'Workshop-Inhalt löschen', params: z.object({ id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    const i = await load(req.params.id, user);
    await assertEditor(i, user);
    await db.workshopItem.delete({ where: { id: i.id } });
    await ctx.storage.remove(`workshop/${i.id}`).catch(() => undefined);
    if (i.previewKey) await ctx.storage.remove(i.previewKey).catch(() => undefined);
    return { ok: true };
  });

  app.post('/items/:id/preview', { schema: { tags: ['workshop'], summary: 'Vorschaubild hochladen', params: z.object({ id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    const i = await load(req.params.id, user);
    await assertEditor(i, user);
    const saved = await saveImageUpload(req, ctx.storage, `social/workshop/${i.id}`, 8 * 1024 ** 2);
    if (i.previewKey) await ctx.storage.remove(i.previewKey).catch(() => undefined);
    return dto(await db.workshopItem.update({ where: { id: i.id }, data: { previewKey: saved.key }, include: itemInclude }), user);
  });

  app.post(
    '/items/:id/versions',
    {
      schema: {
        tags: ['workshop'],
        summary: 'Neue Version hochladen (multipart „file“, ZIP oder 7z)',
        params: z.object({ id: z.string() }),
        querystring: z.object({ version: z.string().trim().min(1).max(40), changelog: z.string().max(10_000).default('') }),
      },
    },
    async (req) => {
      const { user } = requireAuth(req);
      const settings = await enabled();
      const i = await load(req.params.id, user);
      await assertEditor(i, user);
      if (await db.workshopVersion.findUnique({ where: { itemId_version: { itemId: i.id, version: req.query.version } } })) {
        throw conflict('Diese Versionsnummer existiert bereits', 'version_exists');
      }
      const file = await req.file({ limits: { fileSize: settings.maxWorkshopFileBytes } });
      if (!file) throw badRequest('Keine Datei', 'no_file');
      const ext = file.filename.toLowerCase().endsWith('.7z') ? '7z' : 'zip';
      const key = `workshop/${i.id}/${Date.now().toString(36)}.${ext}`;
      const stored = await storeStream(ctx.storage, file.file, key, settings.maxWorkshopFileBytes);
      if (!(ext === 'zip' ? isZip(stored.head) : is7z(stored.head))) {
        await ctx.storage.remove(key);
        throw badRequest('Nur ZIP- oder 7z-Archive sind erlaubt', 'invalid_archive');
      }
      const v = await db.workshopVersion.create({
        data: {
          itemId: i.id,
          version: req.query.version,
          changelog: req.query.changelog,
          fileKey: key,
          fileName: file.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `${i.id}.${ext}`,
          size: stored.size,
          sha256: stored.sha256,
        },
      });
      await db.workshopItem.update({ where: { id: i.id }, data: { updatedAt: new Date() } });
      if (!i.versions.length) await ctx.activity.record(user.id, 'workshop.published', { title: i.title, itemId: i.id }, i.gameId);
      // Abonnenten (Desktop-Clients) informieren, damit sie das Update laden
      const subs = await db.workshopSubscription.findMany({ where: { itemId: i.id }, select: { userId: true } });
      ctx.hub.toUsers(
        subs.map((s) => s.userId),
        { type: 'workshop.updated', data: { itemId: i.id, gameId: i.gameId } },
      );
      return versionDto(v);
    },
  );

  app.delete(
    '/items/:id/versions/:versionId',
    { schema: { tags: ['workshop'], summary: 'Version löschen', params: z.object({ id: z.string(), versionId: z.string() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const i = await load(req.params.id, user);
      await assertEditor(i, user);
      const v = await db.workshopVersion.findFirst({ where: { id: req.params.versionId, itemId: i.id } });
      if (!v) throw notFound('Version nicht gefunden');
      await db.workshopVersion.delete({ where: { id: v.id } });
      await ctx.storage.remove(v.fileKey).catch(() => undefined);
      return { ok: true };
    },
  );

  app.get(
    '/items/:id/versions/:versionId/download',
    { schema: { tags: ['workshop'], summary: 'Version herunterladen', params: z.object({ id: z.string(), versionId: z.string() }) } },
    async (req, reply) => {
      const viewer = req.auth?.user ?? null;
      if (!viewer) throw forbidden('Anmeldung erforderlich', 'unauthorized');
      const i = await load(req.params.id, viewer);
      const v = await db.workshopVersion.findFirst({ where: { id: req.params.versionId, itemId: i.id } });
      if (!v) throw notFound('Version nicht gefunden');
      return sendFile(req, reply, {
        filePath: ctx.storage.resolve(v.fileKey),
        size: Number(v.size),
        filename: v.fileName,
        contentType: v.fileKey.endsWith('.7z') ? 'application/x-7z-compressed' : 'application/zip',
        etag: v.sha256,
        cacheControl: 'private, max-age=31536000, immutable',
      });
    },
  );

  app.put(
    '/items/:id/rating',
    { schema: { tags: ['workshop'], summary: 'Bewerten (true = Daumen hoch, null = entfernen)', params: z.object({ id: z.string() }), body: z.object({ up: z.boolean().nullable() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const i = await load(req.params.id, user);
      if (i.authorId === user.id) throw badRequest('Eigene Inhalte können nicht bewertet werden', 'own_item');
      if (req.body.up === null) await db.workshopRating.deleteMany({ where: { itemId: i.id, userId: user.id } });
      else {
        await db.workshopRating.upsert({
          where: { itemId_userId: { itemId: i.id, userId: user.id } },
          create: { itemId: i.id, userId: user.id, up: req.body.up },
          update: { up: req.body.up },
        });
      }
      return dto(await load(i.id, user), user);
    },
  );

  app.put('/items/:id/subscription', { schema: { tags: ['workshop'], summary: 'Abonnieren', params: z.object({ id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    const i = await load(req.params.id, user);
    await db.workshopSubscription.upsert({ where: { itemId_userId: { itemId: i.id, userId: user.id } }, create: { itemId: i.id, userId: user.id }, update: {} });
    ctx.hub.toUser(user.id, { type: 'workshop.updated', data: { itemId: i.id, gameId: i.gameId } });
    return dto(await load(i.id, user), user);
  });

  app.delete('/items/:id/subscription', { schema: { tags: ['workshop'], summary: 'Abo beenden', params: z.object({ id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    const i = await db.workshopItem.findUnique({ where: { id: req.params.id } });
    await db.workshopSubscription.deleteMany({ where: { itemId: req.params.id, userId: user.id } });
    if (i) ctx.hub.toUser(user.id, { type: 'workshop.updated', data: { itemId: i.id, gameId: i.gameId } });
    return { ok: true };
  });

  app.get(
    '/subscriptions',
    { schema: { tags: ['workshop'], summary: 'Abonnierte Inhalte mit neuester Version (für den Desktop-Client)', querystring: z.object({ gameId: z.string().optional() }) } },
    async (req): Promise<WorkshopSubscriptionDto[]> => {
      const { user } = requireAuth(req);
      const settings = await ctx.settings.get();
      if (!settings.workshopEnabled) return [];
      const subs = await db.workshopSubscription.findMany({
        where: {
          userId: user.id,
          item: { hidden: false, game: { AND: [viewableWhere(user), { workshopPath: { not: null } }] }, ...(req.query.gameId ? { gameId: req.query.gameId } : {}) },
        },
        include: { item: { include: { game: true, versions: { orderBy: { createdAt: 'desc' }, take: 1 } } } },
      });
      return subs
        .filter((s) => s.item.versions.length)
        .map((s) => ({
          itemId: s.itemId,
          gameId: s.item.gameId,
          title: s.item.title,
          workshopPath: s.item.game.workshopPath!,
          version: versionDto(s.item.versions[0]),
        }));
    },
  );

  app.get('/mine', { schema: { tags: ['workshop'], summary: 'Eigene und abonnierte Inhalte' } }, async (req) => {
    const { user } = requireAuth(req);
    const [own, subs] = await Promise.all([
      db.workshopItem.findMany({ where: { authorId: user.id }, include: itemInclude, orderBy: { updatedAt: 'desc' } }),
      db.workshopItem.findMany({ where: { subscriptions: { some: { userId: user.id } } }, include: itemInclude, orderBy: { updatedAt: 'desc' } }),
    ]);
    return {
      published: await Promise.all(own.map((i) => dto(i, user))),
      subscribed: await Promise.all(subs.filter((i) => !i.hidden).map((i) => dto(i, user))),
    };
  });

  // ---- Kommentare ----

  app.get('/items/:id/comments', { schema: { tags: ['workshop'], summary: 'Kommentare', params: z.object({ id: z.string() }) } }, async (req): Promise<WorkshopCommentDto[]> => {
    const i = await load(req.params.id, req.auth?.user ?? null);
    const rows = await db.workshopComment.findMany({ where: { itemId: i.id }, include: { author: true }, orderBy: { createdAt: 'asc' }, take: 500 });
    return rows.map((c) => ({ id: c.id, author: c.author ? userPublic(c.author) : null, body: c.body, createdAt: c.createdAt.toISOString() }));
  });

  app.post(
    '/items/:id/comments',
    {
      schema: { tags: ['workshop'], summary: 'Kommentieren', params: z.object({ id: z.string() }), body: z.object({ body: z.string().trim().min(1).max(5000) }) },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req): Promise<WorkshopCommentDto> => {
      const { user } = requireAuth(req);
      await assertCommunityAllowed(db, user);
      const i = await load(req.params.id, user);
      const c = await db.workshopComment.create({ data: { itemId: i.id, authorId: user.id, body: req.body.body }, include: { author: true } });
      if (i.authorId && i.authorId !== user.id) {
        await ctx.notifications.notify(i.authorId, 'workshop.comment', {
          username: user.displayName ?? user.username,
          title: i.title,
          preview: c.body.slice(0, 200),
          path: `/workshop/${i.id}`,
        });
      }
      return { id: c.id, author: userPublic(c.author!), body: c.body, createdAt: c.createdAt.toISOString() };
    },
  );

  app.delete('/comments/:id', { schema: { tags: ['workshop'], summary: 'Kommentar löschen', params: z.object({ id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    const c = await db.workshopComment.findUnique({ where: { id: req.params.id }, include: { item: true } });
    if (!c) throw notFound('Kommentar nicht gefunden');
    if (c.authorId !== user.id && c.item.authorId !== user.id && !(await canEditGame(db, user, c.item.gameId))) throw forbidden();
    await db.workshopComment.delete({ where: { id: c.id } });
    return { ok: true };
  });
};
