import type { User } from '@prisma/client';
import type { BadgeDto, Presence, ProfileStats, RelationState } from '@gameserver/shared';
import type { AppContext } from '../context.js';
import type { Db } from '../db.js';
import { forbidden } from '../lib/errors.js';
import { iso } from '../lib/time.js';

export async function friendIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.friendship.findMany({
    where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
}

export async function areFriends(db: Db, a: string, b: string): Promise<boolean> {
  const f = await db.friendship.findFirst({
    where: { status: 'ACCEPTED', OR: [{ requesterId: a, addresseeId: b }, { requesterId: b, addresseeId: a }] },
  });
  return !!f;
}

/** true, wenn einer der beiden den anderen blockiert hat */
export async function isBlocked(db: Db, a: string, b: string): Promise<boolean> {
  const block = await db.block.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } });
  return !!block;
}

export async function relation(db: Db, viewerId: string | null, targetId: string): Promise<RelationState> {
  if (!viewerId) return 'none';
  if (viewerId === targetId) return 'self';
  const [blocked, blockedBy, friendship] = await Promise.all([
    db.block.findUnique({ where: { blockerId_blockedId: { blockerId: viewerId, blockedId: targetId } } }),
    db.block.findUnique({ where: { blockerId_blockedId: { blockerId: targetId, blockedId: viewerId } } }),
    db.friendship.findFirst({
      where: { OR: [{ requesterId: viewerId, addresseeId: targetId }, { requesterId: targetId, addresseeId: viewerId }] },
    }),
  ]);
  if (blocked) return 'blocked';
  if (blockedBy) return 'blockedBy';
  if (!friendship) return 'none';
  if (friendship.status === 'ACCEPTED') return 'friends';
  return friendship.requesterId === viewerId ? 'outgoing' : 'incoming';
}

/** Darf `viewer` das vollständige Profil von `target` sehen? */
export function profileVisible(target: User, viewer: User | null, rel: RelationState): boolean {
  if (rel === 'self' || viewer?.role === 'ADMIN') return true;
  if (rel === 'blockedBy') return false;
  if (target.profileVisibility === 'PUBLIC') return true;
  if (target.profileVisibility === 'FRIENDS') return rel === 'friends';
  return false;
}

/** Fehler, wenn zwischen den Nutzern eine Blockierung besteht. */
export async function assertNotBlocked(db: Db, a: string, b: string): Promise<void> {
  if (await isBlocked(db, a, b)) throw forbidden('Mit diesem Nutzer ist keine Interaktion möglich', 'blocked');
}

export class PresenceService {
  private gameCache = new Map<string, { id: string; slug: string; title: string }>();

  constructor(private readonly ctx: AppContext) {}

  async gameRef(gameId: string | null): Promise<Presence['game']> {
    if (!gameId) return null;
    const cached = this.gameCache.get(gameId);
    if (cached) return cached;
    const g = await this.ctx.db.game.findUnique({ where: { id: gameId }, select: { id: true, slug: true, title: true } });
    if (g) this.gameCache.set(gameId, g);
    return g;
  }

  async presence(user: Pick<User, 'id' | 'lastSeenAt'>): Promise<Presence> {
    const online = this.ctx.hub.isOnline(user.id);
    return {
      userId: user.id,
      online,
      game: online ? await this.gameRef(this.ctx.hub.gameOf(user.id)) : null,
      lastSeenAt: iso(user.lastSeenAt),
    };
  }

  /** Reagiert auf Änderungen der Präsenz: Zeitstempel speichern und Freunde informieren. */
  start(): void {
    this.ctx.hub.onPresence((change) => {
      void (async () => {
        try {
          const lastSeenAt = new Date();
          await this.ctx.db.user.updateMany({ where: { id: change.userId }, data: { lastSeenAt } });
          const presence: Presence = {
            userId: change.userId,
            online: change.online,
            game: change.online ? await this.gameRef(change.gameId) : null,
            lastSeenAt: lastSeenAt.toISOString(),
          };
          const friends = await friendIds(this.ctx.db, change.userId);
          this.ctx.hub.toUsers(friends, { type: 'presence', data: presence });
          if (change.gameId && change.online) {
            // „spielt gerade“ als Aktivität (höchstens einmal pro Stunde und Spiel)
            const recent = await this.ctx.db.activity.findFirst({
              where: { userId: change.userId, type: 'game.played', gameId: change.gameId, createdAt: { gte: new Date(Date.now() - 3600_000) } },
            });
            if (!recent) await this.ctx.activity.record(change.userId, 'game.played', {}, change.gameId);
          }
        } catch {
          // Präsenz ist nicht kritisch
        }
      })();
    });
  }
}

const BADGE_LEVELS: Record<string, number[]> = {
  collector: [5, 25, 100, 250],
  player: [10, 100, 500, 1000],
  reviewer: [1, 10, 50],
  social: [5, 25, 100],
  photographer: [1, 10, 50],
  veteran: [1, 2, 5],
  hunter: [10, 50, 200, 500],
};

/** Automatische Abzeichen aus Meilensteinen (eigene Abzeichen-/Level-Systeme folgen in Phase 4). */
export function computeBadges(stats: ProfileStats, memberSince: Date, now = Date.now()): BadgeDto[] {
  const years = Math.floor((now - memberSince.getTime()) / (365.25 * 24 * 3600_000));
  const values: Record<string, number> = {
    collector: stats.games,
    player: Math.floor(stats.playtimeSeconds / 3600),
    reviewer: stats.reviews,
    social: stats.friends,
    photographer: stats.screenshots,
    veteran: years,
    hunter: stats.achievements,
  };
  const badges: BadgeDto[] = [];
  for (const [id, levels] of Object.entries(BADGE_LEVELS)) {
    const value = values[id];
    const level = levels.filter((l) => value >= l).length;
    if (level > 0) badges.push({ id, level, value });
  }
  return badges;
}
