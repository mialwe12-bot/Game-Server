import { useQuery } from '@tanstack/react-query';
import { Cloud, Gift, MonitorDown, Play, ShieldAlert, Trophy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { GameDetail } from '@gameserver/shared';
import { Avatar } from '../../components/Avatar';
import { Badge, Button, Input, Modal, Select, Spinner } from '../../components/ui';
import { isDesktop } from '../../desktop/bridge';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast } from '../../lib/toast';

/** Phase 4 auf der Spieleseite: Altersfreigabe, Achievements, Cloud, Verschenken, Remote-Installation */
export function GameExtras({ game }: { game: GameDetail }) {
  const { t } = useTranslation();
  const { user, settings } = useAuth();
  const [gift, setGift] = useState(false);
  const [remote, setRemote] = useState(false);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
      {game.ageRating > 0 && (
        <Badge tone="warning">
          <ShieldAlert className="mr-1 inline size-3" />
          {t('admin.features.ageFrom', { age: game.ageRating })}
        </Badge>
      )}
      {game.achievementCount > 0 && (
        <Link to={`/game/${game.slug}/achievements`} className="inline-flex items-center gap-1 text-muted hover:text-accent">
          <Trophy className="size-4" />
          {t('achievements.count', { count: game.achievementCount })}
        </Link>
      )}
      {game.savePaths.length > 0 && settings?.features.cloudSaves && (
        <span className="inline-flex items-center gap-1 text-muted" title={t('cloud.supportedHint')}>
          <Cloud className="size-4" />
          {t('cloud.supported')}
        </span>
      )}
      {user && (
        <div className="ml-auto flex flex-wrap gap-2">
          {settings?.features.gifts && game.visibility !== 'HIDDEN' && (
            <Button size="sm" variant="ghost" icon={<Gift className="size-4" />} onClick={() => setGift(true)}>
              {t('gifts.give')}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<MonitorDown className="size-4" />} onClick={() => setRemote(true)}>
            {t(isDesktop ? 'devices.otherDevice' : 'devices.installOn')}
          </Button>
        </div>
      )}
      {gift && <GiftModal game={game} onClose={() => setGift(false)} />}
      {remote && <RemoteModal game={game} onClose={() => setRemote(false)} />}
    </div>
  );
}

function GiftModal({ game, onClose }: { game: GameDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const friends = useQuery({ queryKey: ['friends'], queryFn: () => api.friends.overview() });
  const family = useQuery({ queryKey: ['family'], queryFn: () => api.family.get() });
  const { user } = useAuth();
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const people = new Map<string, { id: string; username: string; displayName: string | null; avatarUrl: string | null }>();
  for (const f of friends.data?.friends ?? []) people.set(f.user.id, f.user);
  for (const m of family.data?.members ?? []) if (m.user.id !== user?.id) people.set(m.user.id, m.user);
  return (
    <Modal open onClose={onClose} title={t('gifts.giveTitle', { title: game.title })}>
      {friends.isLoading ? (
        <Spinner />
      ) : people.size === 0 ? (
        <p className="text-sm text-muted">{t('gifts.noRecipients')}</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.gifts.send(game.id, to, message);
              toast.success(t('gifts.sentToast'));
              onClose();
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          <Select required value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">—</option>
            {[...people.values()].map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName || p.username}
              </option>
            ))}
          </Select>
          <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('gifts.messagePlaceholder')} maxLength={500} />
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" icon={<Gift className="size-4" />} disabled={!to}>
              {t('gifts.send')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function RemoteModal({ game, onClose }: { game: GameDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.devices.list(), refetchInterval: 10_000 });
  const send = async (sessionId: string, action: 'install' | 'launch') => {
    try {
      await api.devices.command(sessionId, action, game.id);
      toast.success(t(action === 'install' ? 'devices.installSent' : 'devices.launchSent'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const list = devices.data?.filter((d) => !d.current) ?? [];
  return (
    <Modal open onClose={onClose} title={t('devices.title')}>
      <p className="mb-3 text-sm text-muted">{t('devices.hint')}</p>
      {devices.isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted">{t('devices.none')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((d) => (
            <li key={d.sessionId} className="flex flex-wrap items-center gap-3 py-2">
              <Avatar user={{ username: d.name, avatarUrl: null }} size={28} />
              <div className="flex-1 text-sm">
                <p className="font-medium">{d.name}</p>
                <p className={d.online ? 'text-xs text-success' : 'text-xs text-muted'}>{d.online ? t('social.presence.online') : t('social.presence.offline')}</p>
              </div>
              <Button size="sm" icon={<MonitorDown className="size-4" />} disabled={!d.online} onClick={() => void send(d.sessionId, 'install')}>
                {t('devices.install')}
              </Button>
              <Button size="sm" variant="ghost" icon={<Play className="size-4" />} disabled={!d.online} onClick={() => void send(d.sessionId, 'launch')}>
                {t('devices.launch')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
