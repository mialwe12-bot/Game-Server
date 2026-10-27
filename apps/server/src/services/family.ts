import type { FamilyMember, User } from '@prisma/client';
import type { ParentalSettings, ParentalStatus } from '@gameserver/shared';
import type { Db } from '../db.js';
import { forbidden } from '../lib/errors.js';
import type { UserWithFamily } from './access.js';

export function startOfDay(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function parentalOf(m: FamilyMember | null | undefined): ParentalSettings {
  return {
    maxAgeRating: m?.maxAgeRating ?? 18,
    dailyMinutes: m?.dailyMinutes ?? null,
    chatAllowed: m?.chatAllowed ?? true,
    communityAllowed: m?.communityAllowed ?? true,
  };
}

async function memberOf(db: Db, user: User): Promise<FamilyMember | null> {
  const loaded = (user as UserWithFamily).familyMember;
  if (loaded !== undefined) return loaded;
  return db.familyMember.findUnique({ where: { userId: user.id } });
}

/** Spielzeit heute (Server-Zeitzone) aus den gemeldeten Spielsitzungen */
export async function playedToday(db: Db, userId: string, now = new Date()): Promise<number> {
  const since = startOfDay(now);
  const agg = await db.playSession.aggregate({ where: { userId, endedAt: { gte: since } }, _sum: { seconds: true } });
  return agg._sum.seconds ?? 0;
}

/** Wirksame Kindersicherung des Nutzers (für Erwachsene/Nutzer ohne Familie: keine Einschränkungen) */
export async function parentalStatus(db: Db, user: User, now = new Date()): Promise<ParentalStatus> {
  const m = await memberOf(db, user);
  const child = m?.role === 'CHILD';
  const p = parentalOf(child ? m : null);
  const today = child ? await playedToday(db, user.id, now) : 0;
  return {
    restricted: child,
    maxAgeRating: child ? p.maxAgeRating : 18,
    dailyMinutes: child ? p.dailyMinutes : null,
    playedTodaySeconds: today,
    remainingSeconds: child && p.dailyMinutes !== null ? Math.max(0, p.dailyMinutes * 60 - today) : null,
    chatAllowed: child ? p.chatAllowed : true,
    communityAllowed: child ? p.communityAllowed : true,
  };
}

export async function assertChatAllowed(db: Db, user: User): Promise<void> {
  const m = await memberOf(db, user);
  if (m?.role === 'CHILD' && !m.chatAllowed) throw forbidden('Chat ist durch die Kindersicherung gesperrt', 'parental_chat');
}

export async function assertCommunityAllowed(db: Db, user: User): Promise<void> {
  const m = await memberOf(db, user);
  if (m?.role === 'CHILD' && !m.communityAllowed) throw forbidden('Community-Beiträge sind durch die Kindersicherung gesperrt', 'parental_community');
}

/** IDs aller Mitglieder der Familie des Nutzers (inkl. ihm selbst) */
export async function familyMemberIds(db: Db, userId: string): Promise<string[]> {
  const m = await db.familyMember.findUnique({ where: { userId }, include: { family: { include: { members: true } } } });
  return m ? m.family.members.map((x) => x.userId) : [userId];
}
