import type { Prisma, User } from '@prisma/client';
import type { GameDetail, GameSummary, SavePathConfig } from '@gameserver/shared';
import type { AppContext } from '../context.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { DAY_MS } from '../lib/time.js';
import { canEditGame, canViewGame, storeVisibleWhere } from './access.js';
import {
  announcementDto,
  announcementInclude,
  gameSummary,
  gameSummaryInclude,
  mediaDto,
  mediaUrl,
  systemRequirements,
  versionDto,
  type GameWithSummary,
} from './dto.js';
import { preferenceWeights, rankCandidates } from './recommend.js';

/** Wirft 401, wenn der Store nicht öffentlich ist und niemand angemeldet ist. */
export async function assertStoreAccess(ctx: AppContext, user: User | null): Promise<void> {
  if (user) return;
  const settings = await ctx.settings.get();
  if (!settings.storePublic) throw unauthorized('Bitte anmelden, um den Store zu sehen', 'login_required');
}

export async function findGameByIdOrSlug(ctx: AppContext, idOrSlug: string) {
  return ctx.db.game.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
}

/** Popularität der letzten 30 Tage: Downloads + neue Bibliothekseinträge + Spielsitzungen. */
export async function popularity(ctx: AppContext): Promise<Map<string, number>> {
  const since = new Date(Date.now() - 30 * DAY_MS);
  const [downloads, library, sessions] = await Promise.all([
    ctx.db.downloadEvent.groupBy({ by: ['gameId'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    ctx.db.libraryEntry.groupBy({ by: ['gameId'], where: { addedAt: { gte: since } }, _count: { _all: true } }),
    ctx.db.playSession.groupBy({ by: ['gameId'], where: { startedAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const map = new Map<string, number>();
  const add = (id: string, n: number) => map.set(id, (map.get(id) ?? 0) + n);
  for (const d of downloads) add(d.gameId, d._count._all * 2);
  for (const l of library) add(l.gameId, l._count._all * 3);
  for (const s of sessions) add(s.gameId, s._count._all);
  return map;
}

type FeatureRow = GameWithSummary;
const toFeature = (g: FeatureRow) => ({ ...g, genreIds: g.genres.map((x) => x.id), tagIds: g.tags.map((x) => x.id) });

/** Empfehlungen anhand Spielzeit, Favoriten und Wunschliste. */
export async function recommendations(
  ctx: AppContext,
  user: User | null,
  opts: { limit: number; exclude?: Set<string>; jitter?: number; extraWhere?: Prisma.GameWhereInput } = { limit: 12 },
): Promise<GameSummary[]> {
  const pop = await popularity(ctx);
  const candidatesRaw = await ctx.db.game.findMany({
    where: {
      AND: [storeVisibleWhere(user), opts.extraWhere ?? {}, user ? { libraryEntries: { none: { userId: user.id } } } : {}],
    },
    include: gameSummaryInclude,
    take: 2000,
  });
  const candidates = candidatesRaw.filter((g) => !opts.exclude?.has(g.id)).map(toFeature);
  let weights = new Map<string, number>();
  if (user) {
    const [library, wishlist] = await Promise.all([
      ctx.db.libraryEntry.findMany({
        where: { userId: user.id },
        include: { game: { include: { genres: { select: { id: true } }, tags: { select: { id: true } } } } },
      }),
      ctx.db.wishlistEntry.findMany({
        where: { userId: user.id },
        include: { game: { include: { genres: { select: { id: true } }, tags: { select: { id: true } } } } },
      }),
    ]);
    weights = preferenceWeights(
      library.map((e) => ({
        id: e.gameId,
        playtimeSeconds: e.playtimeSeconds,
        favorite: e.favorite,
        genreIds: e.game.genres.map((g) => g.id),
        tagIds: e.game.tags.map((t) => t.id),
      })),
      wishlist.map((w) => ({ id: w.gameId, genreIds: w.game.genres.map((g) => g.id), tagIds: w.game.tags.map((t) => t.id) })),
    );
  }
  return rankCandidates(weights, candidates, pop, opts.jitter ?? 0)
    .slice(0, opts.limit)
    .map((g) => gameSummary(g));
}

export async function gameDetail(ctx: AppContext, user: User | null, idOrSlug: string): Promise<GameDetail> {
  const base = await findGameByIdOrSlug(ctx, idOrSlug);
  if (!base) throw notFound('Spiel nicht gefunden');
  const canEdit = await canEditGame(ctx.db, user, base.id);
  if (!canEdit && !(await canViewGame(ctx.db, user, base))) {
    if (!user) throw unauthorized('Bitte anmelden', 'login_required');
    throw forbidden('Kein Zugriff auf dieses Spiel');
  }
  if (!canEdit) await assertStoreAccess(ctx, user);

  const game = await ctx.db.game.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      genres: true,
      tags: true,
      media: { orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] },
      versions: {
        where: canEdit ? {} : { published: true },
        orderBy: { createdAt: 'desc' },
        include: {
          builds: { where: canEdit ? {} : { status: 'READY' }, include: { _count: { select: { files: true } } } },
        },
      },
      announcements: { where: { published: true }, include: announcementInclude, orderBy: { createdAt: 'desc' }, take: 5 },
      _count: { select: { libraryEntries: true, achievements: true, tradingCards: true, workshopItems: { where: { hidden: false } } } },
    },
  });
  const [entry, wish] = user
    ? await Promise.all([
        ctx.db.libraryEntry.findUnique({ where: { userId_gameId: { userId: user.id, gameId: game.id } } }),
        ctx.db.wishlistEntry.findUnique({ where: { userId_gameId: { userId: user.id, gameId: game.id } } }),
      ])
    : [null, null];

  const summaryInput: GameWithSummary = {
    ...game,
    media: game.media.filter((m) => m.kind === 'COVER' || m.kind === 'HEADER'),
    versions: game.versions.filter((v) => v.published).map((v) => ({ builds: v.builds.filter((b) => b.status === 'READY') })),
  };
  const background = game.media.find((m) => m.kind === 'BACKGROUND');
  const versions = game.versions.map(versionDto);
  return {
    ...gameSummary(summaryInput),
    description: game.description,
    publisher: game.publisher,
    website: game.website,
    trailerUrls: game.trailerUrls,
    systemRequirements: systemRequirements(game.systemRequirements),
    backgroundUrl: background ? mediaUrl(background) : null,
    media: game.media.map(mediaDto),
    versions,
    latestVersion: versions.find((v) => v.published && v.builds.some((b) => b.status === 'READY')) ?? null,
    libraryCount: game._count.libraryEntries,
    downloadCount: game.downloadCount,
    inLibrary: !!entry,
    inWishlist: !!wish,
    favorite: entry?.favorite ?? false,
    playtimeSeconds: entry?.playtimeSeconds ?? 0,
    canEdit,
    announcements: game.announcements.map(announcementDto),
    ageRating: game.ageRating,
    savePaths: Array.isArray(game.savePaths) ? (game.savePaths as unknown as SavePathConfig[]) : [],
    workshopPath: game.workshopPath,
    achievementCount: game._count.achievements,
    cardCount: game._count.tradingCards,
    workshopCount: game._count.workshopItems,
    createdAt: game.createdAt.toISOString(),
    updatedAt: game.updatedAt.toISOString(),
  };
}
