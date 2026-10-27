import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AdminAchievementDto, GameAchievements, GameRef } from '@gameserver/shared';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { saveImageUpload } from '../lib/image-upload.js';
import { requireAuth } from '../plugins/auth.js';
import { assertCanEditGame, canViewGame, viewableWhere } from '../services/access.js';
import { adminAchievementDto, gameRef, rarities } from '../services/achievements.js';
import { profileVisible, relation } from '../services/social.js';

const detectionSchema = z
  .object({
    type: z.enum(['file_exists', 'file_regex', 'log_regex']),
    path: z.string().trim().min(1).max(500),
    pattern: z
      .string()
      .max(500)
      .refine((p) => {
        try {
          new RegExp(p);
          return true;
        } catch {
          return false;
        }
      }, 'Ungültiger regulärer Ausdruck')
      .optional(),
  })
  .refine((d) => d.type === 'file_exists' || !!d.pattern, 'Für file_regex/log_regex wird ein Muster benötigt');

const achievementBody = z.object({
  apiName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{1,64}$/, 'Nur Buchstaben, Ziffern, _ . -'),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(''),
  hidden: z.boolean().default(false),
  progressMax: z.number().int().min(2).max(1_000_000_000).nullable().optional(),
  detection: detectionSchema.nullable().optional(),
});

/** Achievements: Anzeige pro Spiel/Nutzer, Erkennung durch den Client, Verwaltung durch Maintainer. */
export const achievementRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const { db } = ctx;

  app.get(
    '/games/:gameId',
    { schema: { tags: ['achievements'], summary: 'Achievements eines Spiels (mit eigenem Fortschritt)', params: z.object({ gameId: z.string() }) } },
    async (req): Promise<GameAchievements> => {
      const viewer = req.auth?.user ?? null;
      const game = await db.game.findFirst({ where: { OR: [{ id: req.params.gameId }, { slug: req.params.gameId }] } });
      if (!game || !(await canViewGame(db, viewer, game))) throw notFound('Spiel nicht gefunden');
      const achievements = await ctx.achievements.forUser(game.id, viewer?.id ?? null);
      return { game: gameRef(game), total: achievements.length, unlocked: achievements.filter((a) => a.unlocked).length, achievements };
    },
  );

  app.get(
    '/users/:username',
    { schema: { tags: ['achievements'], summary: 'Achievements eines Nutzers je Spiel', params: z.object({ username: z.string().max(64) }) } },
    async (req): Promise<(GameAchievements & { lastUnlockedAt: string | null })[]> => {
      const viewer = req.auth?.user ?? null;
      const target = await db.user.findFirst({ where: { username: { equals: req.params.username, mode: 'insensitive' }, disabled: false } });
      if (!target) throw notFound('Nutzer nicht gefunden');
      const rel = await relation(db, viewer?.id ?? null, target.id);
      if (!profileVisible(target, viewer, rel)) throw forbidden('Profil ist privat', 'profile_private');
      const games = await db.game.findMany({
        where: { AND: [viewableWhere(viewer), { achievements: { some: {} } }, { libraryEntries: { some: { userId: target.id } } }] },
      });
      const result = [];
      for (const g of games) {
        const list = await ctx.achievements.forUser(g.id, target.id);
        const unlocked = list.filter((a) => a.unlocked);
        const last = unlocked.map((a) => a.unlockedAt!).sort().pop() ?? null;
        result.push({ game: gameRef(g) as GameRef, total: list.length, unlocked: unlocked.length, achievements: list, lastUnlockedAt: last });
      }
      return result.sort((a, b) => (b.lastUnlockedAt ?? '').localeCompare(a.lastUnlockedAt ?? '') || b.unlocked - a.unlocked);
    },
  );

  // Erkennung per Datei/Log: Der Desktop-Client prüft die konfigurierten Regeln und meldet Treffer.
  app.post(
    '/detect',
    {
      schema: {
        tags: ['achievements'],
        summary: 'Vom Client erkanntes Achievement melden (nur mit hinterlegter Erkennungsregel)',
        body: z.object({ gameId: z.string(), apiName: z.string().max(64) }),
      },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { user } = requireAuth(req);
      const entry = await db.libraryEntry.findUnique({ where: { userId_gameId: { userId: user.id, gameId: req.body.gameId } } });
      if (!entry) throw forbidden('Spiel ist nicht in der Bibliothek', 'not_in_library');
      return ctx.achievements.unlock(user.id, req.body.gameId, req.body.apiName, { source: 'detect' });
    },
  );

  // ---- Verwaltung (Admin/Maintainer) ----

  const manageParams = z.object({ gameId: z.string() });
  const itemParams = z.object({ gameId: z.string(), id: z.string() });

  async function list(gameId: string): Promise<AdminAchievementDto[]> {
    const [items, rar] = await Promise.all([
      db.achievement.findMany({
        where: { gameId },
        include: { _count: { select: { unlocks: { where: { unlockedAt: { not: null } } } } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      rarities(db, gameId),
    ]);
    return items.map((a) => adminAchievementDto(ctx.signer, a, rar.get(a.id) ?? 0));
  }

  async function own(gameId: string, id: string) {
    const a = await db.achievement.findFirst({ where: { id, gameId } });
    if (!a) throw notFound('Achievement nicht gefunden');
    return a;
  }

  app.get('/manage/:gameId', { schema: { tags: ['achievements'], summary: 'Achievements verwalten', params: manageParams } }, async (req) => {
    const { user } = requireAuth(req);
    await assertCanEditGame(db, user, req.params.gameId);
    return list(req.params.gameId);
  });

  app.post('/manage/:gameId', { schema: { tags: ['achievements'], summary: 'Achievement anlegen', params: manageParams, body: achievementBody } }, async (req) => {
    const { user } = requireAuth(req);
    await assertCanEditGame(db, user, req.params.gameId);
    const max = await db.achievement.aggregate({ where: { gameId: req.params.gameId }, _max: { sortOrder: true } });
    const { detection, ...rest } = req.body;
    await db.achievement.create({
      data: { ...rest, gameId: req.params.gameId, sortOrder: (max._max.sortOrder ?? -1) + 1, detection: detection ?? undefined },
    });
    await ctx.audit.log({ userId: user.id, action: 'achievement.created', target: req.params.gameId, meta: { apiName: rest.apiName }, ip: req.ip });
    return list(req.params.gameId);
  });

  app.patch(
    '/manage/:gameId/:id',
    { schema: { tags: ['achievements'], summary: 'Achievement bearbeiten', params: itemParams, body: achievementBody.partial() } },
    async (req) => {
      const { user } = requireAuth(req);
      await assertCanEditGame(db, user, req.params.gameId);
      await own(req.params.gameId, req.params.id);
      const { detection, ...rest } = req.body;
      await db.achievement.update({
        where: { id: req.params.id },
        data: { ...rest, ...(detection !== undefined ? { detection: detection ?? (null as never) } : {}) },
      });
      return list(req.params.gameId);
    },
  );

  app.delete('/manage/:gameId/:id', { schema: { tags: ['achievements'], summary: 'Achievement löschen', params: itemParams } }, async (req) => {
    const { user } = requireAuth(req);
    await assertCanEditGame(db, user, req.params.gameId);
    const a = await own(req.params.gameId, req.params.id);
    await db.achievement.delete({ where: { id: a.id } });
    if (a.iconKey) await ctx.storage.remove(a.iconKey).catch(() => undefined);
    await ctx.audit.log({ userId: user.id, action: 'achievement.deleted', target: req.params.gameId, meta: { apiName: a.apiName }, ip: req.ip });
    return list(req.params.gameId);
  });

  app.post('/manage/:gameId/:id/icon', { schema: { tags: ['achievements'], summary: 'Icon hochladen (max. 1 MB)', params: itemParams } }, async (req) => {
    const { user } = requireAuth(req);
    await assertCanEditGame(db, user, req.params.gameId);
    const a = await own(req.params.gameId, req.params.id);
    const saved = await saveImageUpload(req, ctx.storage, `social/achievements/${a.gameId}`, 1024 ** 2);
    if (a.iconKey) await ctx.storage.remove(a.iconKey).catch(() => undefined);
    await db.achievement.update({ where: { id: a.id }, data: { iconKey: saved.key } });
    return list(req.params.gameId);
  });

  app.put(
    '/manage/:gameId/order',
    { schema: { tags: ['achievements'], summary: 'Reihenfolge setzen', params: manageParams, body: z.object({ ids: z.array(z.string()).max(1000) }) } },
    async (req) => {
      const { user } = requireAuth(req);
      await assertCanEditGame(db, user, req.params.gameId);
      await db.$transaction(req.body.ids.map((id, i) => db.achievement.updateMany({ where: { id, gameId: req.params.gameId }, data: { sortOrder: i } })));
      return list(req.params.gameId);
    },
  );

  app.post(
    '/manage/:gameId/:id/users/:username',
    {
      schema: { tags: ['achievements'], summary: 'Achievement manuell vergeben (Support)', params: z.object({ gameId: z.string(), id: z.string(), username: z.string() }) },
    },
    async (req) => {
      const { user } = requireAuth(req);
      await assertCanEditGame(db, user, req.params.gameId);
      const a = await own(req.params.gameId, req.params.id);
      const target = await db.user.findUnique({ where: { username: req.params.username } });
      if (!target) throw notFound('Nutzer nicht gefunden');
      const result = await ctx.achievements.unlock(target.id, a.gameId, a.apiName, { source: 'admin' });
      await ctx.audit.log({ userId: user.id, action: 'achievement.granted', target: target.id, meta: { apiName: a.apiName, gameId: a.gameId }, ip: req.ip });
      return result;
    },
  );

  app.delete(
    '/manage/:gameId/:id/users/:username',
    {
      schema: { tags: ['achievements'], summary: 'Achievement entziehen (Support)', params: z.object({ gameId: z.string(), id: z.string(), username: z.string() }) },
    },
    async (req) => {
      const { user } = requireAuth(req);
      await assertCanEditGame(db, user, req.params.gameId);
      const a = await own(req.params.gameId, req.params.id);
      const target = await db.user.findUnique({ where: { username: req.params.username } });
      if (!target) throw notFound('Nutzer nicht gefunden');
      const res = await db.userAchievement.deleteMany({ where: { userId: target.id, achievementId: a.id } });
      if (!res.count) throw badRequest('Nicht freigeschaltet', 'not_unlocked');
      await ctx.audit.log({ userId: user.id, action: 'achievement.revoked', target: target.id, meta: { apiName: a.apiName, gameId: a.gameId }, ip: req.ip });
      return { ok: true };
    },
  );
};
