import type { Group, GroupMember, User } from '@prisma/client';
import type { AppContext } from '../context.js';
import type { Db } from '../db.js';
import { forbidden, notFound } from '../lib/errors.js';

export type GroupWithMe = Group & { me: GroupMember | null };

export async function loadGroup(db: Db, idOrSlug: string, viewer: User | null): Promise<GroupWithMe> {
  const group = await db.group.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
  if (!group) throw notFound('Gruppe nicht gefunden');
  const me = viewer ? await db.groupMember.findUnique({ where: { groupId_userId: { groupId: group.id, userId: viewer.id } } }) : null;
  // Versteckte Gruppen sind nur für Mitglieder, Eingeladene und Admins sichtbar
  if (group.visibility === 'HIDDEN' && !me && viewer?.role !== 'ADMIN') throw notFound('Gruppe nicht gefunden');
  return { ...group, me };
}

export const isActive = (m: GroupMember | null) => m?.status === 'ACTIVE';

export function canModerate(g: GroupWithMe, viewer: User): boolean {
  if (viewer.role === 'ADMIN') return true;
  return isActive(g.me) && (g.me!.role === 'OWNER' || g.me!.role === 'MODERATOR');
}

export function assertModerator(g: GroupWithMe, viewer: User): void {
  if (!canModerate(g, viewer)) throw forbidden('Nur Gruppen-Moderatoren', 'not_moderator');
}

export async function activeMemberIds(db: Db, groupId: string): Promise<string[]> {
  const rows = await db.groupMember.findMany({ where: { groupId, status: 'ACTIVE' }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** Mitglieder aller Kanäle einer Gruppe an die aktiven Gruppenmitglieder angleichen. */
export async function syncChannels(ctx: AppContext, groupId: string): Promise<void> {
  const { db, hub } = ctx;
  const members = await activeMemberIds(db, groupId);
  const channels = await db.conversation.findMany({ where: { groupId, type: 'CHANNEL' }, include: { members: true } });
  for (const ch of channels) {
    const current = new Set(ch.members.map((m) => m.userId));
    const wanted = new Set(members);
    const add = members.filter((id) => !current.has(id));
    const remove = [...current].filter((id) => !wanted.has(id));
    if (add.length) await db.conversationMember.createMany({ data: add.map((userId) => ({ conversationId: ch.id, userId })), skipDuplicates: true });
    if (remove.length) await db.conversationMember.deleteMany({ where: { conversationId: ch.id, userId: { in: remove } } });
    if (add.length || remove.length) hub.toUsers([...add, ...remove], { type: 'chat.conversation', data: { conversationId: ch.id } });
  }
}

/** Erinnert Zusagen/Vielleicht-Zusagen ca. eine Stunde vor Beginn eines Events (Prüfung alle 5 Minuten). */
export async function sendEventReminders(ctx: AppContext, now = new Date()): Promise<number> {
  const { db } = ctx;
  const events = await db.groupEvent.findMany({
    where: { reminded: false, startsAt: { gt: now, lte: new Date(now.getTime() + 3600_000) } },
    include: { group: true, rsvps: { where: { status: { in: ['GOING', 'MAYBE'] } } } },
  });
  for (const e of events) {
    const claimed = await db.groupEvent.updateMany({ where: { id: e.id, reminded: false }, data: { reminded: true } });
    if (claimed.count === 0) continue;
    for (const r of e.rsvps) {
      await ctx.notifications.notify(r.userId, 'event.reminder', {
        title: e.title,
        groupName: e.group.name,
        startsAt: e.startsAt.toISOString(),
        path: `/groups/${e.group.slug}`,
      });
    }
  }
  return events.length;
}

export function startEventReminders(ctx: AppContext): NodeJS.Timeout {
  const timer = setInterval(() => void sendEventReminders(ctx).catch(() => undefined), 5 * 60_000);
  timer.unref();
  return timer;
}
