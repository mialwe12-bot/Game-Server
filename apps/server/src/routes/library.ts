import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { CollectionDto, GameSummary, LibraryEntryDto } from '@gameserver/shared';
import { badRequest, notFound } from '../lib/errors.js';
import { iso } from '../lib/time.js';
import { requireAuth } from '../plugins/auth.js';
import { canViewGame } from '../services/access.js';
import { gameSummary, gameSummaryInclude } from '../services/dto.js';

const gameParams = z.object({ gameId: z.string() });
/** Maximal gemeldete Dauer einer einzelnen Spielsitzung. */
const MAX_SESSION_SECONDS = 24 * 3600;

export const libraryRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;

  async function viewableGame(userId: string, gameId: string) {
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: userId } });
    const game = await ctx.db.game.findUnique({ where: { id: gameId } });
    if (!game || !(await canViewGame(ctx.db, user, game))) throw notFound('Spiel nicht gefunden');
    return game;
  }

  app.get(
    '/',
    {
      schema: {
        tags: ['library'],
        summary: 'Bibliothek',
        querystring: z.object({
          sort: z.enum(['title', 'lastPlayed', 'playtime', 'added']).default('title'),
          collection: z.string().optional(),
          favorites: z.coerce.boolean().optional(),
          hidden: z.coerce.boolean().optional(),
          q: z.string().trim().max(200).optional(),
        }),
      },
    },
    async (req): Promise<LibraryEntryDto[]> => {
      const { user } = requireAuth(req);
      const { sort, collection, favorites, hidden, q } = req.query;
      const entries = await ctx.db.libraryEntry.findMany({
        where: {
          userId: user.id,
          ...(favorites ? { favorite: true } : {}),
          ...(favorites || collection ? {} : { hidden: hidden ?? false }),
          AND: [
            q ? { game: { title: { contains: q, mode: 'insensitive' } } } : {},
            collection ? { game: { collections: { some: { collectionId: collection } } } } : {},
          ],
        },
        include: { game: { include: { ...gameSummaryInclude, collections: { where: { collection: { userId: user.id } } } } } },
      });
      const sorted = entries.sort((a, b) => {
        switch (sort) {
          case 'lastPlayed':
            return (b.lastPlayedAt?.getTime() ?? 0) - (a.lastPlayedAt?.getTime() ?? 0) || a.game.title.localeCompare(b.game.title);
          case 'playtime':
            return b.playtimeSeconds - a.playtimeSeconds || a.game.title.localeCompare(b.game.title);
          case 'added':
            return b.addedAt.getTime() - a.addedAt.getTime();
          default:
            return a.game.title.localeCompare(b.game.title, undefined, { sensitivity: 'base' });
        }
      });
      return sorted.map((e) => ({
        game: gameSummary(e.game),
        favorite: e.favorite,
        hidden: e.hidden,
        playtimeSeconds: e.playtimeSeconds,
        lastPlayedAt: iso(e.lastPlayedAt),
        addedAt: e.addedAt.toISOString(),
        collectionIds: e.game.collections.map((c) => c.collectionId),
      }));
    },
  );

  app.put('/:gameId', { schema: { tags: ['library'], summary: 'Spiel zur Bibliothek hinzufügen', params: gameParams } }, async (req) => {
    const { user } = requireAuth(req);
    const game = await viewableGame(user.id, req.params.gameId);
    await ctx.db.libraryEntry.upsert({
      where: { userId_gameId: { userId: user.id, gameId: game.id } },
      create: { userId: user.id, gameId: game.id },
      update: {},
    });
    await ctx.db.wishlistEntry.deleteMany({ where: { userId: user.id, gameId: game.id } });
    ctx.hub.toUser(user.id, { type: 'library.updated', data: { gameId: game.id } });
    return { ok: true };
  });

  app.delete('/:gameId', { schema: { tags: ['library'], summary: 'Spiel aus der Bibliothek entfernen', params: gameParams } }, async (req) => {
    const { user } = requireAuth(req);
    await ctx.db.libraryEntry.deleteMany({ where: { userId: user.id, gameId: req.params.gameId } });
    await ctx.db.collectionGame.deleteMany({ where: { gameId: req.params.gameId, collection: { userId: user.id } } });
    ctx.hub.toUser(user.id, { type: 'library.updated', data: { gameId: req.params.gameId } });
    return { ok: true };
  });

  app.patch(
    '/:gameId',
    {
      schema: {
        tags: ['library'],
        summary: 'Favorit/Ausblenden setzen',
        params: gameParams,
        body: z.object({ favorite: z.boolean().optional(), hidden: z.boolean().optional() }),
      },
    },
    async (req) => {
      const { user } = requireAuth(req);
      const res = await ctx.db.libraryEntry.updateMany({ where: { userId: user.id, gameId: req.params.gameId }, data: req.body });
      if (res.count === 0) throw notFound('Spiel ist nicht in der Bibliothek');
      return { ok: true };
    },
  );

  app.post(
    '/:gameId/playtime',
    {
      schema: {
        tags: ['library'],
        summary: 'Spielsitzung melden (vom Desktop-Client)',
        params: gameParams,
        body: z.object({
          seconds: z.number().int().min(1).max(MAX_SESSION_SECONDS),
          startedAt: z.string().datetime({ offset: true }).optional(),
        }),
      },
    },
    async (req) => {
      const { user } = requireAuth(req);
      const { seconds } = req.body;
      const entry = await ctx.db.libraryEntry.findUnique({ where: { userId_gameId: { userId: user.id, gameId: req.params.gameId } } });
      if (!entry) throw notFound('Spiel ist nicht in der Bibliothek');
      const startedAt = req.body.startedAt ? new Date(req.body.startedAt) : new Date(Date.now() - seconds * 1000);
      if (startedAt.getTime() > Date.now() + 60_000) throw badRequest('Startzeit liegt in der Zukunft');
      const endedAt = new Date(startedAt.getTime() + seconds * 1000);
      const [updated] = await ctx.db.$transaction([
        ctx.db.libraryEntry.update({
          where: { userId_gameId: { userId: user.id, gameId: entry.gameId } },
          data: {
            playtimeSeconds: { increment: seconds },
            lastPlayedAt: entry.lastPlayedAt && entry.lastPlayedAt > endedAt ? entry.lastPlayedAt : endedAt,
          },
        }),
        ctx.db.playSession.create({ data: { userId: user.id, gameId: entry.gameId, startedAt, endedAt, seconds } }),
      ]);
      return { playtimeSeconds: updated.playtimeSeconds };
    },
  );

  // ---- Wunschliste ----

  app.get('/wishlist', { schema: { tags: ['library'], summary: 'Wunschliste' } }, async (req): Promise<(GameSummary & { addedAt: string })[]> => {
    const { user } = requireAuth(req);
    const entries = await ctx.db.wishlistEntry.findMany({
      where: { userId: user.id },
      include: { game: { include: gameSummaryInclude } },
      orderBy: { createdAt: 'desc' },
    });
    const visible = [];
    for (const e of entries) if (await canViewGame(ctx.db, user, e.game)) visible.push({ ...gameSummary(e.game), addedAt: e.createdAt.toISOString() });
    return visible;
  });

  app.put('/wishlist/:gameId', { schema: { tags: ['library'], summary: 'Auf die Wunschliste', params: gameParams } }, async (req) => {
    const { user } = requireAuth(req);
    const game = await viewableGame(user.id, req.params.gameId);
    await ctx.db.wishlistEntry.upsert({
      where: { userId_gameId: { userId: user.id, gameId: game.id } },
      create: { userId: user.id, gameId: game.id },
      update: {},
    });
    return { ok: true };
  });

  app.delete('/wishlist/:gameId', { schema: { tags: ['library'], summary: 'Von der Wunschliste entfernen', params: gameParams } }, async (req) => {
    const { user } = requireAuth(req);
    await ctx.db.wishlistEntry.deleteMany({ where: { userId: user.id, gameId: req.params.gameId } });
    return { ok: true };
  });

  // ---- Sammlungen ----

  const collectionDto = (c: { id: string; name: string; createdAt: Date; games: { gameId: string }[] }): CollectionDto => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt.toISOString(),
    gameIds: c.games.map((g) => g.gameId),
  });

  async function ownCollection(userId: string, id: string) {
    const c = await ctx.db.collection.findFirst({ where: { id, userId }, include: { games: true } });
    if (!c) throw notFound('Sammlung nicht gefunden');
    return c;
  }

  app.get('/collections', { schema: { tags: ['library'], summary: 'Sammlungen' } }, async (req) => {
    const { user } = requireAuth(req);
    const list = await ctx.db.collection.findMany({ where: { userId: user.id }, include: { games: true }, orderBy: { name: 'asc' } });
    return list.map(collectionDto);
  });

  app.post(
    '/collections',
    { schema: { tags: ['library'], summary: 'Sammlung anlegen', body: z.object({ name: z.string().trim().min(1).max(64) }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const c = await ctx.db.collection.create({ data: { userId: user.id, name: req.body.name }, include: { games: true } });
      return collectionDto(c);
    },
  );

  app.patch(
    '/collections/:id',
    {
      schema: {
        tags: ['library'],
        summary: 'Sammlung umbenennen',
        params: z.object({ id: z.string() }),
        body: z.object({ name: z.string().trim().min(1).max(64) }),
      },
    },
    async (req) => {
      const { user } = requireAuth(req);
      await ownCollection(user.id, req.params.id);
      const c = await ctx.db.collection.update({ where: { id: req.params.id }, data: { name: req.body.name }, include: { games: true } });
      return collectionDto(c);
    },
  );

  app.delete('/collections/:id', { schema: { tags: ['library'], summary: 'Sammlung löschen', params: z.object({ id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    await ownCollection(user.id, req.params.id);
    await ctx.db.collection.delete({ where: { id: req.params.id } });
    return { ok: true };
  });

  app.put(
    '/collections/:id/games/:gameId',
    { schema: { tags: ['library'], summary: 'Spiel zur Sammlung hinzufügen', params: z.object({ id: z.string(), gameId: z.string() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      await ownCollection(user.id, req.params.id);
      const entry = await ctx.db.libraryEntry.findUnique({ where: { userId_gameId: { userId: user.id, gameId: req.params.gameId } } });
      if (!entry) throw badRequest('Spiel muss zuerst in der Bibliothek sein', 'not_in_library');
      await ctx.db.collectionGame.upsert({
        where: { collectionId_gameId: { collectionId: req.params.id, gameId: req.params.gameId } },
        create: { collectionId: req.params.id, gameId: req.params.gameId },
        update: {},
      });
      return collectionDto(await ownCollection(user.id, req.params.id));
    },
  );

  app.delete(
    '/collections/:id/games/:gameId',
    { schema: { tags: ['library'], summary: 'Spiel aus Sammlung entfernen', params: z.object({ id: z.string(), gameId: z.string() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      await ownCollection(user.id, req.params.id);
      await ctx.db.collectionGame.deleteMany({ where: { collectionId: req.params.id, gameId: req.params.gameId } });
      return collectionDto(await ownCollection(user.id, req.params.id));
    },
  );
};
