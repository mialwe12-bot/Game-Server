import type { QueryClient } from '@tanstack/react-query';
import type { MeResponse, NotificationDto, WsEvent } from '@gameserver/shared';
import { desktop, isDesktop } from '../desktop/bridge';
import i18n from '../i18n';
import { toast } from './toast';

/** Gerade geöffnete Unterhaltung (dafür keine Hinweise anzeigen). */
let activeConversation: string | null = null;
export function setActiveConversation(id: string | null): void {
  activeConversation = id;
}

export function notificationText(n: Pick<NotificationDto, 'type' | 'data'>): string {
  const d = n.data;
  return i18n.t(`social.notifications.types.${n.type}`, {
    username: d.username ?? '',
    gameTitle: d.gameTitle ?? '',
    groupName: d.groupName ?? '',
    title: d.title ?? '',
    defaultValue: n.type,
  });
}

/** Zielseite einer Benachrichtigung (Pfade vom Server, im Desktop-Client per HashRouter). */
export function notificationPath(n: Pick<NotificationDto, 'data'>): string | null {
  return n.data.path ?? null;
}

/** Systembenachrichtigung: im Desktop-Client über Tauri, im Browser über die Notification-API (falls erlaubt). */
export function systemNotify(title: string, body: string): void {
  if (isDesktop) {
    void desktop.showNotification(title, body).catch(() => undefined);
    return;
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '/favicon.svg' });
    } catch {
      // z. B. in manchen mobilen Browsern nicht erlaubt
    }
  }
}

export async function requestBrowserNotifications(): Promise<boolean> {
  if (isDesktop) return true;
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

function attention(title: string, body: string, toastText = body ? `${title}: ${body}` : title) {
  if (typeof document !== 'undefined' && document.hidden) systemNotify(title, body);
  else toast.info(toastText);
}

/** Reaktion auf soziale Echtzeit-Ereignisse: Caches aktualisieren und Hinweise anzeigen. */
export function handleSocialEvent(e: WsEvent, qc: QueryClient): void {
  const me = qc.getQueryData<MeResponse>(['me'])?.user;
  switch (e.type) {
    case 'notification':
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      if (e.data.type.startsWith('friend.')) void qc.invalidateQueries({ queryKey: ['friends'] });
      if (e.data.type.startsWith('group.') || e.data.type.startsWith('event.')) void qc.invalidateQueries({ queryKey: ['groups'] });
      attention(i18n.t('social.notifications.title'), notificationText(e.data), notificationText(e.data));
      break;
    case 'presence':
    case 'friends.changed':
      void qc.invalidateQueries({ queryKey: ['friends'] });
      break;
    case 'chat.message': {
      void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      void qc.invalidateQueries({ queryKey: ['chat', 'unread'] });
      const m = e.data;
      if (!me || m.author?.id === me.id) break;
      const conv = qc.getQueryData<{ id: string; muted: boolean; type: string }[]>(['chat', 'conversations'])?.find((c) => c.id === m.conversationId);
      if (conv?.muted || conv?.type === 'CHANNEL') break;
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (activeConversation === m.conversationId && !hidden) break;
      const who = m.author ? m.author.displayName || m.author.username : '';
      attention(who, m.body || (m.gifUrl ? 'GIF' : m.attachmentUrl ? i18n.t('social.chat.image') : ''));
      break;
    }
    case 'chat.conversation':
      void qc.invalidateQueries({ queryKey: ['chat'] });
      break;
    default:
      break;
  }
}
