import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { GameSummary, Paginated, StoreFacets, StoreHome } from '@gameserver/shared';
import { notFound } from '../lib/errors.js';
import { requireAuth } from '../plugins/auth.js';
import { canViewGame, storeVisibleWhere } from '../services/access.js';
import { announcementDto, announcementInclude, gameSummary, gameSummaryInclude } from '../services/dto.js';
import { assertStoreAccess, findGameByIdOrSlug, gameDetail, popularity, recommendations } from '../services/catalog.js';

const csv = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean)));

export const storeRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;

  app.get('/home', { schema: { tags: ['store'], summary: 'Store-Startseite' } }, async (req): Promise<StoreHome> => {
    const user = req.auth?.user ?? null;
    await assertStoreAccess(ctx, user);
    const visible = storeVisibleWhere(user);
    const [featured, newest, pop, announcements] = await Promise.all([
      ctx.db.game.findMany({ where: { AND: [visible, { featured: true }] }, include: gameSummaryInclude, take: 8, orderBy: { updatedAt: 'desc' } }),
      ctx.db.game.findMany({ where: visible, include: gameSummaryInclude, take: 12, orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }] }),
      popularity(ctx),
      ctx.db.announcement.findMany({
        where: { published: true },
        include: announcementInclude,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }),
    ]);
    const popularIds = [...pop.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const popularGames = await ctx.db.game.findMany({
      where: { AND: [visible, { id: { in: popularIds.slice(0, 50) } }] },
      include: gameSummaryInclude,
    });
    const popularSorted = popularIds
      .map((id) => popularGames.find((g) => g.id === id))
      .filter((g): g is (typeof popularGames)[number] => !!g)
      .slice(0, 12);
    if (popularSorted.length < 12) {
      // Auffüllen nach Gesamt-Downloads, damit die Liste auch bei wenig Aktivität gefüllt ist
      const more = await ctx.db.game.findMany({
        where: { AND: [visible, { id: { notIn: popularSorted.map((g) => g.id) } }] },
        include: gameSummaryInclude,
        orderBy: { downloadCount: 'desc' },
        take: 12 - popularSorted.length,
      });
      popularSorted.push(...more);
    }
    return {
      featured: featured.map(gameSummary),
      recommended: await recommendations(ctx, user, { limit: 8 }),
      newReleases: newest.map(gameSummary),
      popular: popularSorted.map(gameSummary),
      announcements: announcements.map(announcementDto),
    };
  });

  app.get(
    '/search',
    {
      schema: {
        tags: ['store'],
        summary: 'Suche mit Filtern',
        querystring: z.object({
          q: z.string().trim().max(200).optional(),
          genres: csv,
          tags: csv,
          platforms: csv.pipe(z.array(z.enum(['WINDOWS', 'LINUX', 'MACOS']))),
          sort: z.enum(['relevance', 'title', 'release', 'newest', 'popular']).default('relevance'),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(24),
        }),
      },
    },
    async (req): Promise<Paginated<GameSummary>> => {
      const user = req.auth?.user ?? null;
      await assertStoreAccess(ctx, user);
      const { q, genres, tags, platforms, sort, page, pageSize } = req.query;
      const and: Prisma.GameWhereInput[] = [storeVisibleWhere(user)];
      if (q) {
        and.push({
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { shortDescription: { contains: q, mode: 'insensitive' } },
            { developer: { contains: q, mode: 'insensitive' } },
            { publisher: { contains: q, mode: 'insensitive' } },
            { tags: { some: { name: { contains: q, mode: 'insensitive' } } } },
            { genres: { some: { name: { contains: q, mode: 'insensitive' } } } },
          ],
        });
      }
      for (const slug of genres) and.push({ genres: { some: { slug } } });
      for (const slug of tags) and.push({ tags: { some: { slug } } });
      if (platforms.length) {
        and.push({ versions: { some: { published: true, builds: { some: { status: 'READY', platform: { in: platforms } } } } } });
      }
      const where: Prisma.GameWhereInput = { AND: and };
      const total = await ctx.db.game.count({ where });

      if (sort === 'relevance') {
        // Relevanz: exakter Titel > Titelanfang > Titel enthält > sonstige Treffer; danach Popularität
        const all = await ctx.db.game.findMany({ where, include: gameSummaryInclude, take: 1000 });
        const pop = await popularity(ctx);
        const ql = q?.toLowerCase() ?? '';
        const rank = (title: string) => {
          if (!ql) return 0;
          const t = title.toLowerCase();
          return t === ql ? 3 : t.startsWith(ql) ? 2 : t.includes(ql) ? 1 : 0;
        };
        all.sort(
          (a, b) =>
            rank(b.title) - rank(a.title) ||
            (pop.get(b.id) ?? 0) - (pop.get(a.id) ?? 0) ||
            b.downloadCount - a.downloadCount ||
            a.title.localeCompare(b.title),
        );
        return { items: all.slice((page - 1) * pageSize, page * pageSize).map(gameSummary), total, page, pageSize };
      }

      const orderBy: Prisma.GameOrderByWithRelationInput[] =
        sort === 'title'
          ? [{ title: 'asc' }]
          : sort === 'release'
            ? [{ releaseDate: { sort: 'desc', nulls: 'last' } }, { title: 'asc' }]
            : sort === 'newest'
              ? [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }]
              : [{ downloadCount: 'desc' }, { title: 'asc' }];
      const items = await ctx.db.game.findMany({
        where,
        include: gameSummaryInclude,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items: items.map(gameSummary), total, page, pageSize };
    },
  );

  app.get('/facets', { schema: { tags: ['store'], summary: 'Genres und Tags mit Anzahl' } }, async (req): Promise<StoreFacets> => {
    const user = req.auth?.user ?? null;
    await assertStoreAccess(ctx, user);
    const visible = storeVisibleWhere(user);
    const [genres, tags] = await Promise.all([
      ctx.db.genre.findMany({ include: { _count: { select: { games: { where: visible } } } }, orderBy: { name: 'asc' } }),
      ctx.db.tag.findMany({ include: { _count: { select: { games: { where: visible } } } }, orderBy: { name: 'asc' } }),
    ]);
    const map = (x: { id: string; slug: string; name: string; _count: { games: number } }) => ({
      id: x.id,
      slug: x.slug,
      name: x.name,
      count: x._count.games,
    });
    return { genres: genres.map(map).filter((g) => g.count > 0), tags: tags.map(map).filter((t) => t.count > 0) };
  });

  app.get(
    '/recommendations',
    { schema: { tags: ['store'], summary: 'Empfehlungen anhand der Spielzeit', querystring: z.object({ limit: z.coerce.number().int().min(1).max(50).default(12) }) } },
    async (req) => {
      const user = req.auth?.user ?? null;
      await assertStoreAccess(ctx, user);
      return recommendations(ctx, user, { limit: req.query.limit });
    },
  );

  // ---- Entdeckungs-Queue ----

  app.get(
    '/discovery',
    { schema: { tags: ['store'], summary: 'Entdeckungs-Queue', querystring: z.object({ size: z.coerce.number().int().min(1).max(30).default(12) }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const seen = await ctx.db.discoveryView.findMany({ where: { userId: user.id }, select: { gameId: true } });
      const exclude = new Set(seen.map((s) => s.gameId));
      const wish = await ctx.db.wishlistEntry.findMany({ where: { userId: user.id }, select: { gameId: true } });
      for (const w of wish) exclude.add(w.gameId);
      return recommendations(ctx, user, { limit: req.query.size, exclude, jitter: 0.5 });
    },
  );

  app.post(
    '/discovery/:gameId',
    {
      schema: {
        tags: ['store'],
        summary: 'Spiel in der Queue bewerten',
        params: z.object({ gameId: z.string() }),
        body: z.object({ action: z.enum(['SKIPPED', 'WISHLISTED', 'ADDED']) }),
      },
    },
    async (req) => {
      const { user } = requireAuth(req);
      const game = await ctx.db.game.findUnique({ where: { id: req.params.gameId } });
      if (!game || !(await canViewGame(ctx.db, user, game))) throw notFound('Spiel nicht gefunden');
      const { action } = req.body;
      await ctx.db.discoveryView.upsert({
        where: { userId_gameId: { userId: user.id, gameId: game.id } },
        create: { userId: user.id, gameId: game.id, action },
        update: { action, seenAt: new Date() },
      });
      if (action === 'WISHLISTED') {
        await ctx.db.wishlistEntry.upsert({
          where: { userId_gameId: { userId: user.id, gameId: game.id } },
          create: { userId: user.id, gameId: game.id },
          update: {},
        });
      } else if (action === 'ADDED') {
        await ctx.db.libraryEntry.upsert({
          where: { userId_gameId: { userId: user.id, gameId: game.id } },
          create: { userId: user.id, gameId: game.id },
          update: {},
        });
      }
      return { ok: true };
    },
  );

  app.delete('/discovery', { schema: { tags: ['store'], summary: 'Entdeckungs-Queue zurücksetzen' } }, async (req) => {
    const { user } = requireAuth(req);
    await ctx.db.discoveryView.deleteMany({ where: { userId: user.id } });
    return { ok: true };
  });

  // ---- Spieldetails ----

  app.get(
    '/games/:idOrSlug',
    { schema: { tags: ['store'], summary: 'Spieldetails', params: z.object({ idOrSlug: z.string().max(100) }) } },
    async (req) => gameDetail(ctx, req.auth?.user ?? null, req.params.idOrSlug),
  );

  app.get(
    '/games/:idOrSlug/similar',
    { schema: { tags: ['store'], summary: 'Ähnliche Spiele', params: z.object({ idOrSlug: z.string().max(100) }) } },
    async (req) => {
      const user = req.auth?.user ?? null;
      await assertStoreAccess(ctx, user);
      const game = await findGameByIdOrSlug(ctx, req.params.idOrSlug);
      if (!game) throw notFound('Spiel nicht gefunden');
      const full = await ctx.db.game.findUniqueOrThrow({ where: { id: game.id }, include: { genres: true, tags: true } });
      const others = await ctx.db.game.findMany({
        where: {
          AND: [
            storeVisibleWhere(user),
            { id: { not: game.id } },
            {
              OR: [
                { genres: { some: { id: { in: full.genres.map((g) => g.id) } } } },
                { tags: { some: { id: { in: full.tags.map((t) => t.id) } } } },
              ],
            },
          ],
        },
        include: gameSummaryInclude,
        take: 200,
      });
      const g = new Set(full.genres.map((x) => x.id));
      const t = new Set(full.tags.map((x) => x.id));
      const score = (o: (typeof others)[number]) =>
        o.genres.filter((x) => g.has(x.id)).length * 2 + o.tags.filter((x) => t.has(x.id)).length;
      return others
        .sort((a, b) => score(b) - score(a))
        .slice(0, 8)
        .map(gameSummary);
    },
  );

  app.get(
    '/announcements',
    {
      schema: {
        tags: ['store'],
        summary: 'Ankündigungen',
        querystring: z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(10) }),
      },
    },
    async (req) => {
      await assertStoreAccess(ctx, req.auth?.user ?? null);
      const { page, pageSize } = req.query;
      const where = { published: true };
      const [items, total] = await Promise.all([
        ctx.db.announcement.findMany({
          where,
          include: announcementInclude,
          orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        ctx.db.announcement.count({ where }),
      ]);
      return { items: items.map(announcementDto), total, page, pageSize };
    },
  );
};
