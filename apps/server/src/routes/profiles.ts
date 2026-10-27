import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { User } from '@prisma/client';
import { SHOWCASE_KINDS, type ProfileDto, type ProfileSettings, type ProfileStats, type ResolvedShowcase, type ShowcaseConfig } from '@gameserver/shared';
import { notFound } from '../lib/errors.js';
import { fileUrl, saveImageUpload } from '../lib/image-upload.js';
import { iso } from '../lib/time.js';
import { requireAuth } from '../plugins/auth.js';
import { viewableWhere } from '../services/access.js';
import { gameSummary, gameSummaryInclude, userPublic } from '../services/dto.js';
import { notificationPrefs } from '../services/notify.js';
import { communityItemDto, communityItemInclude, groupCountInclude, groupSummary, reviewDto, reviewInclude } from '../services/social-dto.js';
import { computeBadges, friendIds, profileVisible, relation } from '../services/social.js';
import { activityDto, activityInclude } from './notifications.js';
import { achievementDto, gameRef, rarities } from '../services/achievements.js';
import { profileLevel } from '../services/cards.js';
import { itemInclude, workshopItemDto } from '../services/workshop.js';

const showcaseSchema = z.object({
  kind: z.enum(SHOWCASE_KINDS as [ShowcaseConfig['kind'], ...ShowcaseConfig['kind'][]]),
  gameId: z.string().max(64).optional(),
  title: z.string().trim().max(80).optional(),
  text: z.string().max(4000).optional(),
});

function showcasesOf(user: User): ShowcaseConfig[] {
  return Array.isArray(user.showcases) ? (user.showcases as unknown as ShowcaseConfig[]) : [];
}

/** Anpassbare Profile: Hintergrund, Akzentfarbe, Vitrinen, Abzeichen, Statistiken, Aktivität. */
export const profileRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;

  async function stats(userId: string): Promise<ProfileStats> {
    const [games, playtime, reviews, friends, screenshots, groups, achievements] = await Promise.all([
      ctx.db.libraryEntry.count({ where: { userId } }),
      ctx.db.libraryEntry.aggregate({ where: { userId }, _sum: { playtimeSeconds: true } }),
      ctx.db.review.count({ where: { userId } }),
      friendIds(ctx.db, userId).then((f) => f.length),
      ctx.db.communityItem.count({ where: { authorId: userId, type: 'SCREENSHOT' } }),
      ctx.db.groupMember.count({ where: { userId, status: 'ACTIVE', group: { visibility: 'PUBLIC' } } }),
      ctx.db.userAchievement.count({ where: { userId, unlockedAt: { not: null } } }),
    ]);
    return { games, playtimeSeconds: playtime._sum.playtimeSeconds ?? 0, reviews, friends, screenshots, groups, achievements };
  }

  async function resolveShowcase(cfg: ShowcaseConfig, target: User, viewer: User | null): Promise<ResolvedShowcase> {
    const base = emptyShowcase(cfg);
    const gameWhere = viewableWhere(viewer);
    switch (cfg.kind) {
      case 'text':
        return { ...base, text: cfg.text ?? '' };
      case 'favoriteGame': {
        if (!cfg.gameId) return base;
        const g = await ctx.db.game.findFirst({ where: { AND: [{ id: cfg.gameId }, gameWhere] }, include: gameSummaryInclude });
        return { ...base, game: g ? gameSummary(g) : null, text: cfg.text ?? null };
      }
      case 'recentGames': {
        const entries = await ctx.db.libraryEntry.findMany({
          where: { userId: target.id, lastPlayedAt: { not: null }, game: gameWhere },
          include: { game: { include: gameSummaryInclude } },
          orderBy: { lastPlayedAt: 'desc' },
          take: 6,
        });
        return { ...base, games: entries.map((e) => ({ game: gameSummary(e.game), playtimeSeconds: e.playtimeSeconds, lastPlayedAt: iso(e.lastPlayedAt) })) };
      }
      case 'screenshots': {
        const items = await ctx.db.communityItem.findMany({
          where: { authorId: target.id, type: { in: ['SCREENSHOT', 'ARTWORK'] }, game: gameWhere },
          include: communityItemInclude,
          orderBy: { createdAt: 'desc' },
          take: 8,
        });
        return { ...base, items: items.map((i) => communityItemDto(ctx.signer, i, viewer?.id ?? null)) };
      }
      case 'reviews': {
        const rows = await ctx.db.review.findMany({ where: { userId: target.id, game: gameWhere }, include: reviewInclude, orderBy: { createdAt: 'desc' }, take: 3 });
        return { ...base, reviews: rows.map((r) => reviewDto(r, viewer?.id ?? null)) };
      }
      case 'groups': {
        const groups = await ctx.db.group.findMany({
          where: { visibility: 'PUBLIC', members: { some: { userId: target.id, status: 'ACTIVE' } } },
          include: groupCountInclude,
          take: 8,
        });
        return { ...base, groups: groups.map((g) => groupSummary(ctx.signer, g)) };
      }
      case 'achievements': {
        // Seltenste freigeschaltete Achievements (bei gewähltem Spiel nur dieses)
        const unlocks = await ctx.db.userAchievement.findMany({
          where: { userId: target.id, unlockedAt: { not: null }, achievement: { game: gameWhere, ...(cfg.gameId ? { gameId: cfg.gameId } : {}) } },
          include: { achievement: { include: { game: true } } },
          orderBy: { unlockedAt: 'desc' },
          take: 50,
        });
        const rarity = new Map<string, number>();
        for (const gameId of new Set(unlocks.map((u) => u.achievement.gameId))) {
          for (const [id, pct] of await rarities(ctx.db, gameId)) rarity.set(id, pct);
        }
        const list = unlocks
          .map((u) => ({ ...achievementDto(ctx.signer, u.achievement, u, rarity.get(u.achievementId) ?? 0), game: gameRef(u.achievement.game) }))
          .sort((a, b) => a.rarity - b.rarity)
          .slice(0, 8);
        return { ...base, achievements: list };
      }
      case 'gameBadges': {
        const badges = await ctx.db.gameBadge.findMany({ where: { userId: target.id, level: { gt: 0 }, game: gameWhere }, include: { game: true }, orderBy: { level: 'desc' }, take: 12 });
        return { ...base, gameBadges: badges.map((b) => ({ game: gameRef(b.game), level: b.level, craftedAt: b.updatedAt.toISOString() })) };
      }
      case 'workshop': {
        const items = await ctx.db.workshopItem.findMany({ where: { authorId: target.id, hidden: false, game: gameWhere }, include: itemInclude, orderBy: { updatedAt: 'desc' }, take: 6 });
        return { ...base, workshopItems: await Promise.all(items.map((i) => workshopItemDto(ctx, i, viewer))) };
      }
      default:
        return base;
    }
  }

  app.get(
    '/profiles/:username',
    { schema: { tags: ['profiles'], summary: 'Profil (Privatsphäre wird beachtet)', params: z.object({ username: z.string().max(64) }) } },
    async (req): Promise<ProfileDto> => {
      const viewer = req.auth?.user ?? null;
      const target = await ctx.db.user.findFirst({ where: { username: { equals: req.params.username, mode: 'insensitive' } } });
      if (!target || (target.disabled && viewer?.role !== 'ADMIN')) throw notFound('Profil nicht gefunden');
      const rel = await relation(ctx.db, viewer?.id ?? null, target.id);
      if (rel === 'blockedBy') throw notFound('Profil nicht gefunden');
      const visible = profileVisible(target, viewer, rel);
      const base: ProfileDto = {
        user: userPublic(target),
        backgroundUrl: fileUrl(ctx.signer, target.profileBackgroundKey),
        accent: target.profileAccent,
        visibility: target.profileVisibility,
        restricted: !visible,
        relation: rel,
        presence: null,
        stats: null,
        badges: [],
        showcases: [],
        activity: [],
        level: null,
        achievementCount: 0,
      };
      if (!visible) return { ...base, user: { ...base.user, bio: null } };
      const s = await stats(target.id);
      const showcases = await Promise.all(
        showcasesOf(target)
          .slice(0, 6)
          .map((c) => (c.kind === 'stats' || c.kind === 'badges' ? Promise.resolve({ ...emptyShowcase(c) }) : resolveShowcase(c, target, viewer))),
      );
      const activity = await ctx.db.activity.findMany({
        where: { userId: target.id, OR: [{ gameId: null }, { game: viewableWhere(viewer) }] },
        include: activityInclude,
        orderBy: { createdAt: 'desc' },
        take: 15,
      });
      return {
        ...base,
        presence: await ctx.presence.presence(target),
        stats: s,
        badges: computeBadges(s, target.createdAt),
        showcases,
        activity: activity.map(activityDto),
        level: profileLevel(target.xp),
        achievementCount: s.achievements,
      };
    },
  );

  function emptyShowcase(c: ShowcaseConfig): ResolvedShowcase {
    return {
      kind: c.kind,
      title: c.title ?? null,
      text: null,
      game: null,
      games: [],
      items: [],
      reviews: [],
      groups: [],
      achievements: [],
      gameBadges: [],
      workshopItems: [],
    };
  }

  const settingsOf = (u: User): ProfileSettings => ({
    accent: u.profileAccent,
    backgroundUrl: fileUrl(ctx.signer, u.profileBackgroundKey),
    visibility: u.profileVisibility,
    allowFriendRequests: u.allowFriendRequests,
    showcases: showcasesOf(u),
    notificationPrefs: notificationPrefs(u.notificationPrefs),
  });

  app.get('/me/profile', { schema: { tags: ['profiles'], summary: 'Eigene Profil- und Benachrichtigungseinstellungen' } }, async (req) => {
    const { user } = requireAuth(req);
    return settingsOf(user);
  });

  app.patch(
    '/me/profile',
    {
      schema: {
        tags: ['profiles'],
        summary: 'Profil- und Benachrichtigungseinstellungen ändern',
        body: z.object({
          accent: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .nullable()
            .optional(),
          visibility: z.enum(['PUBLIC', 'FRIENDS', 'PRIVATE']).optional(),
          allowFriendRequests: z.boolean().optional(),
          showcases: z.array(showcaseSchema).max(6).optional(),
          notificationPrefs: z
            .object({
              email: z.object({ friends: z.boolean(), messages: z.boolean(), groups: z.boolean(), events: z.boolean(), community: z.boolean(), trading: z.boolean() }).partial(),
            })
            .optional(),
        }),
      },
    },
    async (req): Promise<ProfileSettings> => {
      const { user } = requireAuth(req);
      const b = req.body;
      const prefs = b.notificationPrefs
        ? { email: { ...notificationPrefs(user.notificationPrefs).email, ...b.notificationPrefs.email } }
        : undefined;
      const updated = await ctx.db.user.update({
        where: { id: user.id },
        data: {
          ...(b.accent !== undefined ? { profileAccent: b.accent } : {}),
          ...(b.visibility ? { profileVisibility: b.visibility } : {}),
          ...(b.allowFriendRequests !== undefined ? { allowFriendRequests: b.allowFriendRequests } : {}),
          ...(b.showcases ? { showcases: b.showcases } : {}),
          ...(prefs ? { notificationPrefs: prefs } : {}),
        },
      });
      return settingsOf(updated);
    },
  );

  app.post('/me/profile/background', { schema: { tags: ['profiles'], summary: 'Profilhintergrund hochladen (max. 8 MB)' } }, async (req) => {
    const { user } = requireAuth(req);
    const saved = await saveImageUpload(req, ctx.storage, `social/profiles/${user.id}`, 8 * 1024 ** 2);
    if (user.profileBackgroundKey) await ctx.storage.remove(user.profileBackgroundKey).catch(() => undefined);
    return settingsOf(await ctx.db.user.update({ where: { id: user.id }, data: { profileBackgroundKey: saved.key } }));
  });

  app.delete('/me/profile/background', { schema: { tags: ['profiles'], summary: 'Profilhintergrund entfernen' } }, async (req) => {
    const { user } = requireAuth(req);
    if (user.profileBackgroundKey) await ctx.storage.remove(user.profileBackgroundKey).catch(() => undefined);
    return settingsOf(await ctx.db.user.update({ where: { id: user.id }, data: { profileBackgroundKey: null } }));
  });
};
