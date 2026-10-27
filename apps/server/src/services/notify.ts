import type { Notification } from '@prisma/client';
import type { NotificationDto, NotificationPrefs, NotificationType } from '@gameserver/shared';
import type { AppContext } from '../context.js';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  email: { friends: true, messages: false, groups: true, events: true, community: false, trading: false },
};

/** Welche E-Mail-Einstellung für welchen Typ gilt */
const CATEGORY: Record<NotificationType, keyof NotificationPrefs['email']> = {
  'friend.request': 'friends',
  'friend.accepted': 'friends',
  'game.invite': 'friends',
  message: 'messages',
  'group.invite': 'groups',
  'group.request': 'groups',
  'group.accepted': 'groups',
  'group.announcement': 'groups',
  'event.created': 'events',
  'event.reminder': 'events',
  'review.helpful': 'community',
  'forum.reply': 'community',
  'card.drop': 'trading',
  'trade.offer': 'trading',
  'trade.accepted': 'trading',
  'market.completed': 'trading',
  'gift.received': 'friends',
  'family.invite': 'friends',
  'workshop.comment': 'community',
};

export function notificationPrefs(raw: unknown): NotificationPrefs {
  const p = (raw ?? {}) as Partial<NotificationPrefs>;
  return { email: { ...DEFAULT_NOTIFICATION_PREFS.email, ...(p.email ?? {}) } };
}

export function notificationDto(n: Notification): NotificationDto {
  return {
    id: n.id,
    type: n.type as NotificationType,
    data: (n.data ?? {}) as Record<string, string>,
    read: !!n.readAt,
    createdAt: n.createdAt.toISOString(),
  };
}

/** Text der E-Mail-Benachrichtigung (Deutsch/Englisch je nach Nutzersprache). */
export function emailText(type: NotificationType, data: Record<string, string>, de: boolean): { subject: string; text: string } {
  const who = data.username ?? '';
  const map: Record<NotificationType, [string, string]> = {
    'friend.request': [`${who} möchte mit dir befreundet sein`, `${who} sent you a friend request`],
    'friend.accepted': [`${who} hat deine Freundschaftsanfrage angenommen`, `${who} accepted your friend request`],
    'game.invite': [`${who} lädt dich zu ${data.gameTitle ?? 'einem Spiel'} ein`, `${who} invited you to play ${data.gameTitle ?? 'a game'}`],
    message: [`Neue Nachricht von ${who}`, `New message from ${who}`],
    'group.invite': [`Einladung in die Gruppe ${data.groupName ?? ''}`, `Invitation to the group ${data.groupName ?? ''}`],
    'group.request': [`${who} möchte der Gruppe ${data.groupName ?? ''} beitreten`, `${who} wants to join ${data.groupName ?? ''}`],
    'group.accepted': [`Du bist jetzt Mitglied in ${data.groupName ?? ''}`, `You are now a member of ${data.groupName ?? ''}`],
    'group.announcement': [`${data.groupName ?? ''}: ${data.title ?? ''}`, `${data.groupName ?? ''}: ${data.title ?? ''}`],
    'event.created': [`Neues Event in ${data.groupName ?? ''}: ${data.title ?? ''}`, `New event in ${data.groupName ?? ''}: ${data.title ?? ''}`],
    'event.reminder': [`Gleich geht's los: ${data.title ?? ''}`, `Starting soon: ${data.title ?? ''}`],
    'review.helpful': [`Dein Review zu ${data.gameTitle ?? ''} wurde als hilfreich bewertet`, `Your review of ${data.gameTitle ?? ''} was rated helpful`],
    'forum.reply': [`Neue Antwort in „${data.title ?? ''}“`, `New reply in "${data.title ?? ''}"`],
    'card.drop': [`Neue Sammelkarte: ${data.title ?? ''} (${data.gameTitle ?? ''})`, `New trading card: ${data.title ?? ''} (${data.gameTitle ?? ''})`],
    'trade.offer': [`${who} schlägt dir einen Tausch vor`, `${who} sent you a trade offer`],
    'trade.accepted': [`${who} hat deinen Tausch angenommen`, `${who} accepted your trade offer`],
    'market.completed': [`Dein Marktplatz-Angebot wurde getauscht`, `Your market listing was traded`],
    'gift.received': [`${who} hat dir ${data.gameTitle ?? 'ein Spiel'} geschenkt`, `${who} gave you ${data.gameTitle ?? 'a game'}`],
    'family.invite': [`Einladung in die Familie ${data.familyName ?? ''}`, `Invitation to the family ${data.familyName ?? ''}`],
    'workshop.comment': [`Neuer Kommentar zu „${data.title ?? ''}“`, `New comment on "${data.title ?? ''}"`],
  };
  const [subjectDe, subjectEn] = map[type];
  const subject = de ? subjectDe : subjectEn;
  const text = `${subject}${data.preview ? `\n\n${data.preview}` : ''}\n\n${data.url ?? ''}`;
  return { subject, text };
}

export class NotificationService {
  constructor(private readonly ctx: AppContext) {}

  /**
   * Legt eine Benachrichtigung an, sendet sie live per WebSocket und – je nach Einstellung und nur, wenn der
   * Nutzer gerade nicht online ist – per E-Mail. `store: false` = nur live/E-Mail (z. B. Chatnachrichten).
   */
  async notify(userId: string, type: NotificationType, data: Record<string, string>, opts: { store?: boolean } = {}): Promise<void> {
    const { db, hub, mailer, config } = this.ctx;
    let dto: NotificationDto;
    if (opts.store === false) {
      dto = { id: `live-${Date.now()}`, type, data, read: false, createdAt: new Date().toISOString() };
    } else {
      dto = notificationDto(await db.notification.create({ data: { userId, type, data } }));
      hub.toUser(userId, { type: 'notification', data: dto });
    }

    if (hub.isOnline(userId) || !mailer.enabled) return;
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.disabled) return;
    if (!notificationPrefs(user.notificationPrefs).email[CATEGORY[type]]) return;
    const url = data.path ? new URL(data.path, config.PUBLIC_URL).toString() : config.PUBLIC_URL;
    const { subject, text } = emailText(type, { ...data, url }, user.locale !== 'en');
    try {
      await mailer.send({ to: user.email, subject, text });
      if (opts.store !== false) await db.notification.updateMany({ where: { id: dto.id }, data: { emailedAt: new Date() } });
    } catch (err) {
      this.ctx.logs.push({ time: new Date().toISOString(), level: 'warn', msg: `Benachrichtigungs-Mail fehlgeschlagen: ${String(err)}` });
    }
  }
}

export class ActivityService {
  constructor(private readonly ctx: AppContext) {}

  async record(userId: string, type: string, data: Record<string, string> = {}, gameId?: string | null): Promise<void> {
    await this.ctx.db.activity.create({ data: { userId, type, data, gameId: gameId ?? null } });
  }
}
