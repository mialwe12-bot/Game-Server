import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { User } from '@prisma/client';
import type { GameRef, PlaytimeStats, TopLists, YearReview } from '@gameserver/shared';
import { forbidden, notFound } from '../lib/errors.js';
import { DAY_MS } from '../lib/time.js';
import { requireAuth } from '../plugins/auth.js';
import { storeVisibleWhere, viewableWhere } from '../services/access.js';
import { gameRef } from '../services/achievements.js';
import { profileLevel } from '../services/cards.js';
import { userPublic } from '../services/dto.js';
import { reviewSummary } from '../services/social-dto.js';
import { profileVisible, relation } from '../services/social.js';

/** Montag 00:00 (lokale Serverzeit) der Woche von `d` */
export function weekStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Statistiken: Spielzeit pro Woche/Spiel, Jahresrückblick, globale Top-Listen. */
export const statsRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const { db } = ctx;

  async function visibleUser(viewer: User | null, username: string) {
    const target = await db.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' }, disabled: false } });
    if (!target) throw notFound('Nutzer nicht gefunden');
    if (!profileVisible(target, viewer, await relation(db, viewer?.id ?? null, target.id))) throw forbidden('Profil ist privat', 'profile_private');
    return target;
  }

  async function playtime(user: User, viewer: User | null, weeks: number): Promise<PlaytimeStats> {
    const since = weekStart(new Date(Date.now() - (weeks - 1) * 7 * DAY_MS));
    const [sessions, entries] = await Promise.all([
      db.playSession.findMany({ where: { userId: user.id, startedAt: { gte: since }, game: viewableWhere(viewer) }, select: { gameId: true, startedAt: true, seconds: true } }),
      db.libraryEntry.findMany({
        where: { userId: user.id, playtimeSeconds: { gt: 0 }, game: viewableWhere(viewer) },
        include: { game: true },
        orderBy: { playtimeSeconds: 'desc' },
      }),
    ]);
    const weekMap = new Map<number, Map<string, number>>();
    for (let i = 0; i < weeks; i++) weekMap.set(since.getTime() + i * 7 * DAY_MS, new Map());
    const recent = new Map<string, number>();
    const sessionCount = new Map<string, number>();
    for (const s of sessions) {
      const key = weekStart(s.startedAt).getTime();
      const m = weekMap.get(key) ?? new Map<string, number>();
      weekMap.set(key, m);
      m.set(s.gameId, (m.get(s.gameId) ?? 0) + s.seconds);
      if (s.startedAt.getTime() > Date.now() - 14 * DAY_MS) recent.set(s.gameId, (recent.get(s.gameId) ?? 0) + s.seconds);
    }
    const counts = await db.playSession.groupBy({ by: ['gameId'], where: { userId: user.id }, _count: { _all: true } });
    for (const c of counts) sessionCount.set(c.gameId, c._count._all);
    return {
      totalSeconds: entries.reduce((sum, e) => sum + e.playtimeSeconds, 0),
      weeks: [...weekMap.entries()]
        .sort(([a], [b]) => a - b)
        .map(([ts, m]) => ({
          weekStart: new Date(ts).toISOString(),
          seconds: [...m.values()].reduce((a, b) => a + b, 0),
          games: [...m.entries()].map(([gameId, seconds]) => ({ gameId, seconds })).sort((a, b) => b.seconds - a.seconds),
        })),
      games: entries.map((e) => ({
        game: gameRef(e.game),
        seconds: e.playtimeSeconds,
        sessions: sessionCount.get(e.gameId) ?? 0,
        lastPlayedAt: e.lastPlayedAt?.toISOString() ?? null,
        recentSeconds: recent.get(e.gameId) ?? 0,
      })),
    };
  }

  app.get(
    '/me',
    { schema: { tags: ['stats'], summary: 'Eigene Spielzeit pro Woche und Spiel', querystring: z.object({ weeks: z.coerce.number().int().min(1).max(104).default(12) }) } },
    async (req) => {
      const { user } = requireAuth(req);
      return playtime(user, user, req.query.weeks);
    },
  );

  app.get(
    '/users/:username',
    {
      schema: {
        tags: ['stats'],
        summary: 'Spielzeit-Statistik eines Nutzers',
        params: z.object({ username: z.string().max(64) }),
        querystring: z.object({ weeks: z.coerce.number().int().min(1).max(104).default(12) }),
      },
    },
    async (req) => {
      const viewer = req.auth?.user ?? null;
      return playtime(await visibleUser(viewer, req.params.username), viewer, req.query.weeks);
    },
  );

  async function yearReview(user: User, viewer: User | null, year: number): Promise<YearReview> {
    const from = new Date(year, 0, 1);
    const to = new Date(year + 1, 0, 1);
    const range = { gte: from, lt: to };
    const sessions = await db.playSession.findMany({
      where: { userId: user.id, startedAt: range, game: viewableWhere(viewer) },
      include: { game: true },
      orderBy: { startedAt: 'asc' },
    });
    const months = Array.from({ length: 12 }, () => 0);
    const perGame = new Map<string, { game: GameRef; seconds: number; sessions: number }>();
    const perDay = new Map<string, number>();
    let longest: YearReview['longestSession'] = null;
    for (const s of sessions) {
      months[s.startedAt.getMonth()] += s.seconds;
      const g = perGame.get(s.gameId) ?? { game: gameRef(s.game), seconds: 0, sessions: 0 };
      g.seconds += s.seconds;
      g.sessions++;
      perGame.set(s.gameId, g);
      const day = dayKey(s.startedAt);
      perDay.set(day, (perDay.get(day) ?? 0) + s.seconds);
      if (!longest || s.seconds > longest.seconds) longest = { game: gameRef(s.game), seconds: s.seconds, date: s.startedAt.toISOString() };
    }
    const busiest = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0];
    const total = sessions.reduce((sum, s) => sum + s.seconds, 0);
    const [newGames, achievements, reviews, friends, screenshots, totals] = await Promise.all([
      db.libraryEntry.count({ where: { userId: user.id, addedAt: range } }),
      db.userAchievement.count({ where: { userId: user.id, unlockedAt: range } }),
      db.review.count({ where: { userId: user.id, createdAt: range } }),
      db.friendship.count({ where: { status: 'ACCEPTED', acceptedAt: range, OR: [{ requesterId: user.id }, { addresseeId: user.id }] } }),
      db.communityItem.count({ where: { authorId: user.id, type: 'SCREENSHOT', createdAt: range } }),
      db.playSession.groupBy({ by: ['userId'], where: { startedAt: range }, _sum: { seconds: true } }),
    ]);
    // Perzentil: Anteil der aktiven Spieler mit weniger Spielzeit
    const others = totals.map((t) => t._sum.seconds ?? 0);
    const percentile = total > 0 && others.length > 1 ? Math.round((others.filter((s) => s < total).length / (others.length - 1)) * 100) : null;
    return {
      year,
      totalSeconds: total,
      sessions: sessions.length,
      gamesPlayed: perGame.size,
      newGames,
      months,
      topGames: [...perGame.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 10),
      longestSession: longest,
      mostActiveDay: busiest ? { date: busiest[0], seconds: busiest[1] } : null,
      achievementsUnlocked: achievements,
      reviewsWritten: reviews,
      friendsAdded: friends,
      screenshotsShared: screenshots,
      percentile,
    };
  }

  const yearSchema = z.coerce.number().int().min(2000).max(2100);

  app.get('/me/year/:year', { schema: { tags: ['stats'], summary: 'Eigener Jahresrückblick', params: z.object({ year: yearSchema }) } }, async (req) => {
    const { user } = requireAuth(req);
    return yearReview(user, user, req.params.year);
  });

  app.get(
    '/users/:username/year/:year',
    { schema: { tags: ['stats'], summary: 'Jahresrückblick eines Nutzers', params: z.object({ username: z.string().max(64), year: yearSchema }) } },
    async (req) => {
      const viewer = req.auth?.user ?? null;
      return yearReview(await visibleUser(viewer, req.params.username), viewer, req.params.year);
    },
  );

  app.get(
    '/top',
    { schema: { tags: ['stats'], summary: 'Globale Top-Listen', querystring: z.object({ period: z.enum(['week', 'month', 'year', 'all']).default('month') }) } },
    async (req): Promise<TopLists> => {
      const viewer = req.auth?.user ?? null;
      const days = { week: 7, month: 30, year: 365, all: null }[req.query.period];
      const since = days ? new Date(Date.now() - days * DAY_MS) : undefined;
      const games = await db.game.findMany({ where: storeVisibleWhere(viewer), include: { media: { where: { kind: 'COVER' }, take: 1 } } });
      const byId = new Map(games.map((g) => [g.id, g]));
      const ref = (id: string): GameRef => {
        const g = byId.get(id)!;
        return { ...gameRef(g), coverUrl: g.media[0] ? `/api/media/${g.media[0].id}` : null };
      };
      const ids = [...byId.keys()];
      const [played, players, owned, reviews, positive, achievementCounts, levels] = await Promise.all([
        db.playSession.groupBy({ by: ['gameId'], where: { gameId: { in: ids }, ...(since ? { startedAt: { gte: since } } : {}) }, _sum: { seconds: true } }),
        db.playSession.groupBy({ by: ['gameId', 'userId'], where: { gameId: { in: ids }, ...(since ? { startedAt: { gte: since } } : {}) } }),
        db.libraryEntry.groupBy({ by: ['gameId'], where: { gameId: { in: ids } }, _count: { _all: true } }),
        db.review.groupBy({ by: ['gameId'], where: { gameId: { in: ids } }, _count: { _all: true } }),
        db.review.groupBy({ by: ['gameId'], where: { gameId: { in: ids }, recommended: true }, _count: { _all: true } }),
        db.userAchievement.groupBy({
          by: ['userId'],
          where: { unlockedAt: since ? { gte: since } : { not: null }, user: { disabled: false, profileVisibility: 'PUBLIC' } },
          _count: { _all: true },
          orderBy: { _count: { userId: 'desc' } },
          take: 10,
        }),
        db.user.findMany({ where: { disabled: false, profileVisibility: 'PUBLIC', xp: { gt: 0 } }, orderBy: { xp: 'desc' }, take: 10 }),
      ]);
      const playerCount = new Map<string, number>();
      for (const p of players) playerCount.set(p.gameId, (playerCount.get(p.gameId) ?? 0) + 1);
      const pos = new Map(positive.map((p) => [p.gameId, p._count._all]));
      const hunters = await db.user.findMany({ where: { id: { in: achievementCounts.map((a) => a.userId) } } });
      const hunterById = new Map(hunters.map((u) => [u.id, u]));
      return {
        period: req.query.period,
        mostPlayed: played
          .map((p) => ({ game: ref(p.gameId), seconds: p._sum.seconds ?? 0, players: playerCount.get(p.gameId) ?? 0 }))
          .sort((a, b) => b.seconds - a.seconds)
          .slice(0, 20),
        mostOwned: owned
          .map((o) => ({ game: ref(o.gameId), owners: o._count._all }))
          .sort((a, b) => b.owners - a.owners)
          .slice(0, 20),
        topRated: reviews
          .filter((r) => r._count._all >= 1)
          .map((r) => {
            const s = reviewSummary(r._count._all, pos.get(r.gameId) ?? 0);
            return { game: ref(r.gameId), percent: s.percent, total: s.total };
          })
          // Wilson-ähnliche Gewichtung: wenige Reviews zählen weniger
          .sort((a, b) => b.percent * Math.min(1, b.total / 10) - a.percent * Math.min(1, a.total / 10) || b.total - a.total)
          .slice(0, 20),
        mostAchievements: achievementCounts
          .filter((a) => hunterById.has(a.userId))
          .map((a) => ({ user: userPublic(hunterById.get(a.userId)!), unlocked: a._count._all })),
        topLevels: levels.map((u) => ({ user: userPublic(u), level: profileLevel(u.xp).level, xp: u.xp })),
      };
    },
  );
};
