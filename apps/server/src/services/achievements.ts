import type { Achievement, Game, UserAchievement } from '@prisma/client';
import type { AchievementDetection, AchievementDto, AchievementUnlockResult, AdminAchievementDto, GameRef } from '@gameserver/shared';
import type { AppContext } from '../context.js';
import type { Db } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { fileUrl } from '../lib/image-upload.js';
import type { UrlSigner } from '../lib/sign.js';
import { iso } from '../lib/time.js';

/** XP pro freigeschaltetem Achievement (Profil-Level) */
export const ACHIEVEMENT_XP = 5;

export const gameRef = (g: Pick<Game, 'id' | 'slug' | 'title'>): GameRef => ({ id: g.id, slug: g.slug, title: g.title });

/** Seltenheit in Prozent: Anteil der Besitzer (Bibliothek), die das Achievement freigeschaltet haben. */
export async function rarities(db: Db, gameId: string): Promise<Map<string, number>> {
  const [owners, counts] = await Promise.all([
    db.libraryEntry.count({ where: { gameId } }),
    db.userAchievement.groupBy({
      by: ['achievementId'],
      where: { unlockedAt: { not: null }, achievement: { gameId } },
      _count: { _all: true },
    }),
  ]);
  const map = new Map<string, number>();
  for (const c of counts) {
    const pct = owners > 0 ? (c._count._all / Math.max(owners, c._count._all)) * 100 : 0;
    map.set(c.achievementId, Math.round(pct * 10) / 10);
  }
  return map;
}

export function achievementDto(signer: UrlSigner, a: Achievement, unlock: UserAchievement | null | undefined, rarity: number, reveal = false): AchievementDto {
  const unlocked = !!unlock?.unlockedAt;
  // Versteckte Achievements bleiben bis zur Freischaltung geheim
  const masked = a.hidden && !unlocked && !reveal;
  return {
    id: a.id,
    gameId: a.gameId,
    apiName: masked ? '' : a.apiName,
    name: masked ? '' : a.name,
    description: masked ? '' : a.description,
    iconUrl: masked ? null : fileUrl(signer, a.iconKey),
    hidden: a.hidden,
    progressMax: a.progressMax,
    rarity,
    unlocked,
    unlockedAt: iso(unlock?.unlockedAt ?? null),
    progress: unlock?.progress ?? 0,
  };
}

export function adminAchievementDto(signer: UrlSigner, a: Achievement & { _count: { unlocks: number } }, rarity: number): AdminAchievementDto {
  return {
    ...achievementDto(signer, a, null, rarity, true),
    sortOrder: a.sortOrder,
    detection: (a.detection as AchievementDetection | null) ?? null,
    unlockCount: a._count.unlocks,
  };
}

export class AchievementService {
  constructor(private readonly ctx: AppContext) {}

  /** Alle Achievements eines Spiels aus Sicht eines Nutzers */
  async forUser(gameId: string, userId: string | null, reveal = false): Promise<AchievementDto[]> {
    const { db, signer } = this.ctx;
    const [list, rar, unlocks] = await Promise.all([
      db.achievement.findMany({ where: { gameId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      rarities(db, gameId),
      userId ? db.userAchievement.findMany({ where: { userId, achievement: { gameId } } }) : Promise.resolve([]),
    ]);
    const byId = new Map(unlocks.map((u) => [u.achievementId, u]));
    return list.map((a) => achievementDto(signer, a, byId.get(a.id), rar.get(a.id) ?? 0, reveal));
  }

  /**
   * Freischalten bzw. Fortschritt setzen. `progress` nur für Achievements mit progressMax; Erreichen des Zielwerts schaltet frei.
   * Fortschritt kann nur steigen. Bereits freigeschaltete Achievements bleiben unverändert.
   */
  async unlock(
    userId: string,
    gameId: string,
    apiName: string,
    opts: { progress?: number; source: 'sdk' | 'detect' | 'admin' },
  ): Promise<AchievementUnlockResult> {
    const { db, signer, hub } = this.ctx;
    const a = await db.achievement.findUnique({ where: { gameId_apiName: { gameId, apiName } }, include: { game: true } });
    if (!a) throw notFound(`Achievement „${apiName}“ nicht gefunden`, 'achievement_not_found');
    if (opts.source === 'detect' && !a.detection) throw badRequest('Für dieses Achievement ist keine Erkennung eingerichtet', 'no_detection');
    const existing = await db.userAchievement.findUnique({ where: { userId_achievementId: { userId, achievementId: a.id } } });
    if (existing?.unlockedAt) {
      return { achievement: achievementDto(signer, a, existing, (await rarities(db, gameId)).get(a.id) ?? 0), newlyUnlocked: false };
    }
    let progress = existing?.progress ?? 0;
    let unlockNow = true;
    if (a.progressMax && opts.progress !== undefined) {
      progress = Math.max(progress, Math.min(Math.floor(opts.progress), a.progressMax));
      unlockNow = progress >= a.progressMax;
    } else if (a.progressMax) {
      progress = a.progressMax;
    }
    const row = await db.userAchievement.upsert({
      where: { userId_achievementId: { userId, achievementId: a.id } },
      create: { userId, achievementId: a.id, progress, unlockedAt: unlockNow ? new Date() : null, source: opts.source },
      update: { progress, ...(unlockNow ? { unlockedAt: new Date(), source: opts.source } : {}) },
    });
    const dto = achievementDto(signer, a, row, (await rarities(db, gameId)).get(a.id) ?? 0);
    if (unlockNow) {
      await db.user.update({ where: { id: userId }, data: { xp: { increment: ACHIEVEMENT_XP } } });
      await this.ctx.activity.record(userId, 'achievement.unlocked', { name: a.name, apiName: a.apiName }, gameId);
      hub.toUser(userId, { type: 'achievement.unlocked', data: { achievement: dto, game: gameRef(a.game) } });
    }
    return { achievement: dto, newlyUnlocked: unlockNow };
  }
}
