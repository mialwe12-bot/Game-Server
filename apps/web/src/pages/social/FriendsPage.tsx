import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Gamepad2, MessageSquare, Search, UserMinus, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { FriendDto, UserPublic } from '@gameserver/shared';
import { Avatar } from '../../components/Avatar';
import { InviteToGameModal, PresenceAvatar, presenceLabel, UserLink } from '../../components/Social';
import { Badge, Button, Card, ConfirmButton, EmptyState, ErrorState, Input, PageLoader, Tabs } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { toast } from '../../lib/toast';

type Tab = 'friends' | 'requests' | 'add' | 'blocked';

export default function FriendsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('friends');
  const [inviteFor, setInviteFor] = useState<UserPublic | null>(null);
  const overview = useQuery({ queryKey: ['friends'], queryFn: () => api.friends.overview() });

  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const openChat = async (userId: string) => {
    try {
      const conv = await api.chat.direct(userId);
      navigate(`/chat/${conv.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (overview.isLoading) return <PageLoader />;
  if (overview.error) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  const data = overview.data!;
  const online = data.friends.filter((f) => f.presence.online);
  const offline = data.friends.filter((f) => !f.presence.online);

  const friendRow = (f: FriendDto) => (
    <li key={f.user.id} className="flex flex-wrap items-center gap-3 py-3">
      <PresenceAvatar user={f.user} presence={f.presence} size={44} />
      <div className="min-w-0 flex-1">
        <UserLink user={f.user} />
        <p className={f.presence.game ? 'text-sm text-success' : 'text-sm text-muted'}>{presenceLabel(t, f.presence)}</p>
      </div>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" icon={<MessageSquare className="size-4" />} onClick={() => void openChat(f.user.id)} title={t('social.friends.message')}>
          <span className="hidden sm:inline">{t('social.friends.message')}</span>
        </Button>
        <Button size="sm" variant="ghost" icon={<Gamepad2 className="size-4" />} onClick={() => setInviteFor(f.user)} title={t('social.friends.invite')}>
          <span className="hidden sm:inline">{t('social.friends.invite')}</span>
        </Button>
        <ConfirmButton size="sm" icon={<UserMinus className="size-4" />} onConfirm={() => action.mutate(() => api.friends.remove(f.user.id))} title={t('social.friends.remove')}>
          <span className="sr-only">{t('social.friends.remove')}</span>
        </ConfirmButton>
      </div>
    </li>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold">{t('social.friends.title')}</h1>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'friends', label: `${t('social.friends.tabFriends')} (${data.friends.length})` },
          {
            id: 'requests',
            label: (
              <span className="flex items-center gap-1">
                {t('social.friends.tabRequests')}
                {data.incoming.length > 0 && <Badge tone="accent">{data.incoming.length}</Badge>}
              </span>
            ),
          },
          { id: 'add', label: t('social.friends.tabAdd') },
          { id: 'blocked', label: t('social.friends.tabBlocked') },
        ]}
      />

      {tab === 'friends' &&
        (data.friends.length === 0 ? (
          <EmptyState title={t('social.friends.empty')}>
            <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setTab('add')}>
              {t('social.friends.addFriend')}
            </Button>
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {online.length > 0 && (
              <Card title={`${t('social.presence.online')} (${online.length})`}>
                <ul className="divide-y divide-border">{online.map(friendRow)}</ul>
              </Card>
            )}
            {offline.length > 0 && (
              <Card title={`${t('social.presence.offline')} (${offline.length})`}>
                <ul className="divide-y divide-border">{offline.map(friendRow)}</ul>
              </Card>
            )}
          </div>
        ))}

      {tab === 'requests' && (
        <div className="space-y-4">
          <Card title={t('social.friends.incoming')}>
            {data.incoming.length === 0 ? (
              <p className="text-sm text-muted">{t('social.friends.noRequests')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.incoming.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-3">
                    <Avatar user={r.user} size={40} />
                    <div className="flex-1">
                      <UserLink user={r.user} />
                      <p className="text-xs text-muted">{formatDate(r.createdAt)}</p>
                    </div>
                    <Button size="sm" variant="primary" icon={<Check className="size-4" />} onClick={() => action.mutate(() => api.friends.accept(r.id))}>
                      {t('social.friends.accept')}
                    </Button>
                    <Button size="sm" icon={<X className="size-4" />} onClick={() => action.mutate(() => api.friends.decline(r.id))}>
                      {t('social.friends.decline')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t('social.friends.outgoing')}>
            {data.outgoing.length === 0 ? (
              <p className="text-sm text-muted">{t('social.friends.noRequests')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.outgoing.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-3">
                    <Avatar user={r.user} size={40} />
                    <div className="flex-1">
                      <UserLink user={r.user} />
                      <p className="text-xs text-muted">{formatDate(r.createdAt)}</p>
                    </div>
                    <Button size="sm" onClick={() => action.mutate(() => api.friends.decline(r.id))}>
                      {t('social.friends.withdraw')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'add' && <AddFriend />}

      {tab === 'blocked' && (
        <Card title={t('social.friends.tabBlocked')}>
          {data.blocked.length === 0 ? (
            <p className="text-sm text-muted">{t('social.friends.noBlocked')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.blocked.map((u) => (
                <li key={u.id} className="flex items-center gap-3 py-3">
                  <Avatar user={u} size={36} />
                  <span className="flex-1">{u.displayName || u.username}</span>
                  <Button size="sm" onClick={() => action.mutate(() => api.friends.unblock(u.id))}>
                    {t('social.friends.unblock')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {inviteFor && <InviteToGameModal friend={inviteFor} open onClose={() => setInviteFor(null)} />}
    </div>
  );
}

function AddFriend() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const results = useQuery({ queryKey: ['users-search', query], queryFn: () => api.friends.search(query), enabled: query.length >= 2 });
  const send = useMutation({
    mutationFn: (username: string) => api.friends.request(username),
    onSuccess: (r) => {
      toast.success(r.status === 'friends' ? t('social.friends.nowFriends') : t('social.friends.requestSent'));
      void qc.invalidateQueries({ queryKey: ['friends'] });
      void results.refetch();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const block = useMutation({
    mutationFn: (userId: string) => api.friends.block(userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['friends'] });
      void results.refetch();
    },
  });

  return (
    <Card>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('social.friends.searchPlaceholder')} minLength={2} />
        <Button type="submit" variant="primary" icon={<Search className="size-4" />}>
          {t('common.search')}
        </Button>
      </form>
      <ul className="mt-4 divide-y divide-border">
        {results.data?.map((r) => (
          <li key={r.user.id} className="flex items-center gap-3 py-3">
            <Avatar user={r.user} size={36} />
            <div className="flex-1">
              <UserLink user={r.user} />
              <p className="text-xs text-muted">@{r.user.username}</p>
            </div>
            {r.relation === 'none' && (
              <Button size="sm" variant="primary" icon={<UserPlus className="size-4" />} loading={send.isPending} onClick={() => send.mutate(r.user.username)}>
                {t('social.friends.addFriend')}
              </Button>
            )}
            {r.relation === 'incoming' && (
              <Button size="sm" variant="primary" onClick={() => send.mutate(r.user.username)}>
                {t('social.friends.accept')}
              </Button>
            )}
            {r.relation === 'outgoing' && <Badge>{t('social.friends.pending')}</Badge>}
            {r.relation === 'friends' && <Badge tone="success">{t('social.friends.isFriend')}</Badge>}
            {r.relation === 'blocked' && <Badge tone="danger">{t('social.friends.isBlocked')}</Badge>}
            {r.relation !== 'blocked' && (
              <ConfirmButton size="sm" icon={<Ban className="size-4" />} onConfirm={() => block.mutate(r.user.id)} title={t('social.friends.block')}>
                <span className="sr-only">{t('social.friends.block')}</span>
              </ConfirmButton>
            )}
          </li>
        ))}
        {results.data?.length === 0 && <p className="py-4 text-center text-sm text-muted">{t('social.friends.noResults')}</p>}
      </ul>
    </Card>
  );
}
