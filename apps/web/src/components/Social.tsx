import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, CheckCheck, MessageSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import type { Presence, UserPublic } from '@gameserver/shared';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { notificationPath, notificationText } from '../lib/social';
import { toast } from '../lib/toast';
import { Avatar } from './Avatar';
import { Button, Modal, Select, Spinner } from './ui';

export function presenceLabel(t: (k: string, o?: Record<string, unknown>) => string, p: Presence | null | undefined): string {
  if (!p) return '';
  if (p.online && p.game) return t('social.presence.playing', { game: p.game.title });
  if (p.online) return t('social.presence.online');
  if (p.lastSeenAt) return t('social.presence.lastSeen', { date: formatDateTime(p.lastSeenAt) });
  return t('social.presence.offline');
}

export function PresenceDot({ presence, className }: { presence: Presence | null | undefined; className?: string }) {
  const color = !presence?.online ? 'bg-muted/60' : presence.game ? 'bg-success' : 'bg-accent';
  return <span className={clsx('inline-block size-2.5 shrink-0 rounded-full ring-2 ring-surface', color, className)} aria-hidden="true" />;
}

/** Avatar mit Präsenzpunkt */
export function PresenceAvatar({ user, presence, size = 40 }: { user: UserPublic; presence?: Presence | null; size?: number }) {
  return (
    <span className="relative inline-flex">
      <Avatar user={user} size={size} />
      {presence && <PresenceDot presence={presence} className="absolute -right-0.5 -bottom-0.5" />}
    </span>
  );
}

export function UserLink({ user, className }: { user: Pick<UserPublic, 'username' | 'displayName'>; className?: string }) {
  return (
    <Link to={`/u/${user.username}`} className={clsx('font-medium hover:text-accent hover:underline', className)}>
      {user.displayName || user.username}
    </Link>
  );
}

/** Freund zu einem Spiel aus der eigenen Bibliothek einladen */
export function InviteToGameModal({ friend, open, onClose }: { friend: UserPublic; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const library = useQuery({ queryKey: ['library', 'invite'], queryFn: () => api.library.list({ sort: 'lastPlayed' }), enabled: open });
  const [gameId, setGameId] = useState('');
  useEffect(() => {
    if (!gameId && library.data?.[0]) setGameId(library.data[0].game.id);
  }, [library.data, gameId]);
  const invite = useMutation({
    mutationFn: () => api.friends.invite(friend.id, gameId),
    onSuccess: () => {
      toast.success(t('social.friends.invited', { name: friend.displayName || friend.username }));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('social.friends.inviteTitle', { name: friend.displayName || friend.username })}>
      {library.isLoading ? (
        <Spinner />
      ) : library.data?.length ? (
        <div className="space-y-4">
          <Select value={gameId} onChange={(e) => setGameId(e.target.value)}>
            {library.data.map((e) => (
              <option key={e.game.id} value={e.game.id}>
                {e.game.title}
              </option>
            ))}
          </Select>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={invite.isPending} disabled={!gameId} onClick={() => invite.mutate()}>
              {t('social.friends.sendInvite')}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">{t('social.friends.inviteEmpty')}</p>
      )}
    </Modal>
  );
}

/** Glocke mit Benachrichtigungen im Kopfbereich */
export function NotificationBell() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = useQuery({ queryKey: ['notifications'], queryFn: () => api.notifications.list(), refetchInterval: 5 * 60_000 });
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  const markAll = async () => {
    await api.notifications.markRead().catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const unread = list.data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-2 text-muted hover:bg-surface-2 hover:text-fg"
        aria-label={t('social.notifications.title')}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">{t('social.notifications.title')}</span>
            <button type="button" className="flex items-center gap-1 text-xs text-accent hover:underline" onClick={() => void markAll()}>
              <CheckCheck className="size-3.5" />
              {t('social.notifications.markAll')}
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {list.data?.items.length ? (
              list.data.items.slice(0, 15).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={clsx('flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left text-sm hover:bg-surface-2', !n.read && 'bg-accent/5')}
                  onClick={async () => {
                    setOpen(false);
                    if (!n.read) await api.notifications.markRead([n.id]).catch(() => undefined);
                    void qc.invalidateQueries({ queryKey: ['notifications'] });
                    const path = notificationPath(n);
                    if (path) navigate(path);
                  }}
                >
                  <span className={clsx(!n.read && 'font-medium')}>{notificationText(n)}</span>
                  <span className="text-xs text-muted">{formatDateTime(n.createdAt)}</span>
                </button>
              ))
            ) : (
              <p className="p-4 text-center text-sm text-muted">{t('social.notifications.empty')}</p>
            )}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block py-2 text-center text-xs text-accent hover:underline">
            {t('social.notifications.showAll')}
          </Link>
        </div>
      )}
    </div>
  );
}

/** Chat-Symbol mit Anzahl ungelesener Nachrichten */
export function ChatNavButton() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const unread = useQuery({ queryKey: ['chat', 'unread'], queryFn: () => api.chat.unread(), enabled: !!user, refetchInterval: 5 * 60_000 });
  const count = unread.data?.count ?? 0;
  return (
    <NavLink
      to="/chat"
      className={({ isActive }) => clsx('relative rounded-md p-2 hover:bg-surface-2', isActive ? 'text-accent' : 'text-muted hover:text-fg')}
      aria-label={t('social.chat.title')}
    >
      <MessageSquare className="size-5" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 font-bold text-accent-fg">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </NavLink>
  );
}
