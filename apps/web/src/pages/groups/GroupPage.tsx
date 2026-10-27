import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check, Hash, ImagePlus, LogOut, Megaphone, Pencil, Plus, Shield, Trash2, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { GroupDetail, GroupEventDto, RsvpStatus } from '@gameserver/shared';
import { Avatar } from '../../components/Avatar';
import { Markdown } from '../../components/Markdown';
import { UserLink } from '../../components/Social';
import { Badge, Button, Card, ConfirmButton, ErrorState, Field, Input, Modal, PageLoader, Select, Tabs, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatDateTime } from '../../lib/format';
import { toast } from '../../lib/toast';
import { GroupFormModal } from './GroupsPage';

type Tab = 'overview' | 'events' | 'members' | 'announcements';

export default function GroupPage() {
  const { slug = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const group = useQuery({ queryKey: ['groups', 'detail', slug], queryFn: () => api.groups.get(slug) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['groups'] });
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (group.isLoading) return <PageLoader />;
  if (group.error) return <ErrorState error={group.error} />;
  const g = group.data!;
  const active = g.myStatus === 'ACTIVE';

  const upload = (kind: 'avatar' | 'banner') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) act.mutate(() => api.groups.uploadImage(g.id, kind, f));
    };
    input.click();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="relative h-40 bg-gradient-to-r from-accent/40 to-surface-2 sm:h-56">
          {g.bannerUrl && <img src={api.url(g.bannerUrl)} alt="" className="absolute inset-0 size-full object-cover" />}
          {g.canManage && (
            <Button size="sm" className="absolute top-2 right-2" icon={<ImagePlus className="size-4" />} onClick={() => upload('banner')}>
              {t('social.groups.banner')}
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end">
          <button type="button" disabled={!g.canManage} onClick={() => upload('avatar')} className="-mt-16 self-start" title={g.canManage ? t('social.groups.avatar') : undefined}>
            <Avatar user={{ username: g.name, avatarUrl: g.avatarUrl }} size={96} className="ring-4 ring-surface" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{g.name}</h1>
            <p className="text-sm text-muted">
              {t('social.groups.memberCount', { count: g.memberCount })} · {t(`social.groups.policy.${g.joinPolicy}`)} · {t('social.groups.founded', { date: formatDate(g.createdAt) })}
            </p>
          </div>
          {user && (
            <div className="flex flex-wrap gap-2">
              {!g.myStatus && g.joinPolicy !== 'INVITE' && (
                <Button variant="primary" onClick={() => act.mutate(() => api.groups.join(g.id))}>
                  {g.joinPolicy === 'OPEN' ? t('social.groups.join') : t('social.groups.requestJoin')}
                </Button>
              )}
              {g.myStatus === 'INVITED' && (
                <>
                  <Button variant="primary" icon={<Check className="size-4" />} onClick={() => act.mutate(() => api.groups.join(g.id))}>
                    {t('social.groups.acceptInvite')}
                  </Button>
                  <Button icon={<X className="size-4" />} onClick={() => act.mutate(() => api.groups.leave(g.id))}>
                    {t('social.friends.decline')}
                  </Button>
                </>
              )}
              {g.myStatus === 'PENDING' && (
                <Button onClick={() => act.mutate(() => api.groups.leave(g.id))}>{t('social.groups.withdrawRequest')}</Button>
              )}
              {g.canManage && (
                <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                  {t('common.edit')}
                </Button>
              )}
              {active && (
                <ConfirmButton
                  icon={<LogOut className="size-4" />}
                  onConfirm={() =>
                    act.mutate(async () => {
                      await api.groups.leave(g.id);
                      navigate('/groups');
                    })
                  }
                >
                  {t('social.groups.leave')}
                </ConfirmButton>
              )}
              {g.myRole === 'OWNER' && (
                <ConfirmButton
                  icon={<Trash2 className="size-4" />}
                  onConfirm={() =>
                    act.mutate(async () => {
                      await api.groups.remove(g.id);
                      navigate('/groups');
                    })
                  }
                >
                  {t('social.groups.dissolve')}
                </ConfirmButton>
              )}
            </div>
          )}
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: t('social.groups.overview') },
          { id: 'announcements', label: t('social.groups.announcements') },
          { id: 'events', label: t('social.groups.events') },
          { id: 'members', label: t('social.groups.members') },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <Card>{g.description ? <Markdown>{g.description}</Markdown> : <p className="text-muted">{g.summary || '—'}</p>}</Card>
            {g.announcements.length > 0 && (
              <Card title={t('social.groups.latestAnnouncement')}>
                <h3 className="font-semibold">{g.announcements[0].title}</h3>
                <p className="mb-2 text-xs text-muted">{formatDateTime(g.announcements[0].createdAt)}</p>
                <Markdown>{g.announcements[0].body}</Markdown>
              </Card>
            )}
          </div>
          <div className="space-y-4">
            {g.channels.length > 0 && (
              <Card title={t('social.groups.channels')}>
                <ChannelList g={g} />
              </Card>
            )}
            <Card title={t('social.groups.upcoming')}>
              {g.upcomingEvents.length ? (
                <ul className="space-y-2">
                  {g.upcomingEvents.map((e) => (
                    <li key={e.id} className="text-sm">
                      <p className="font-medium">{e.title}</p>
                      <p className="text-xs text-muted">{formatDateTime(e.startsAt)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{t('social.groups.noEvents')}</p>
              )}
            </Card>
          </div>
        </div>
      )}
      {tab === 'announcements' && <Announcements g={g} />}
      {tab === 'events' && <Events g={g} />}
      {tab === 'members' && <Members g={g} />}
      {editing && (
        <GroupFormModal
          initial={g}
          onClose={() => {
            setEditing(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function ChannelList({ g }: { g: GroupDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['groups', 'detail'] });
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {g.channels.map((c) => (
          <li key={c.id} className="flex items-center gap-1">
            <Link to={`/chat/${c.id}`} className="flex flex-1 items-center gap-1 rounded px-2 py-1 text-sm hover:bg-surface-2">
              <Hash className="size-4 text-muted" />
              {c.title}
            </Link>
            {g.canManage && g.channels.length > 1 && (
              <button
                type="button"
                className="rounded p-1 text-muted hover:text-danger"
                aria-label={t('common.delete')}
                onClick={() => window.confirm(t('common.reallyDelete')) && void api.groups.deleteChannel(g.id, c.id).then(refresh)}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {g.canManage && (
        <form
          className="flex gap-1"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.groups.createChannel(g.id, name);
              setName('');
              void refresh();
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('social.groups.newChannel')} maxLength={40} required />
          <Button type="submit" size="sm" icon={<Plus className="size-4" />} aria-label={t('common.add')} />
        </form>
      )}
    </div>
  );
}

function Announcements({ g }: { g: GroupDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['groups', 'announcements', g.id], queryFn: () => api.groups.announcements(g.id) });
  const [form, setForm] = useState({ title: '', body: '' });
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['groups'] });
  return (
    <div className="space-y-3">
      {g.canManage && (
        <Button variant="primary" icon={<Megaphone className="size-4" />} onClick={() => setOpen(true)}>
          {t('social.groups.newAnnouncement')}
        </Button>
      )}
      {list.data?.map((a) => (
        <Card key={a.id} title={a.title} actions={g.canManage && <ConfirmButton size="sm" icon={<Trash2 className="size-4" />} onConfirm={() => void api.groups.deleteAnnouncement(g.id, a.id).then(refresh)} />}>
          <p className="mb-2 text-xs text-muted">
            {a.author && <UserLink user={a.author} />} · {formatDateTime(a.createdAt)}
          </p>
          <Markdown>{a.body}</Markdown>
        </Card>
      ))}
      {list.data?.length === 0 && <p className="text-sm text-muted">{t('social.groups.noAnnouncements')}</p>}
      <Modal open={open} onClose={() => setOpen(false)} title={t('social.groups.newAnnouncement')} wide>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.groups.announce(g.id, form.title, form.body);
              setForm({ title: '', body: '' });
              setOpen(false);
              void refresh();
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          <Field label={t('social.groups.announcementTitle')}>
            <Input required maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label={t('social.groups.announcementBody')} hint={t('common.markdownHint')}>
            <Textarea rows={8} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              {t('social.groups.publish')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function Events({ g }: { g: GroupDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [past, setPast] = useState(false);
  const [edit, setEdit] = useState<GroupEventDto | 'new' | null>(null);
  const events = useQuery({ queryKey: ['groups', 'events', g.id, past], queryFn: () => api.groups.events(g.id, past) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['groups'] });
  const rsvp = async (e: GroupEventDto, status: RsvpStatus | null) => {
    try {
      await api.groups.rsvp(e.id, status);
      void refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {g.canManage && (
          <Button variant="primary" icon={<CalendarDays className="size-4" />} onClick={() => setEdit('new')}>
            {t('social.groups.newEvent')}
          </Button>
        )}
        <Button onClick={() => setPast((p) => !p)}>{past ? t('social.groups.upcoming') : t('social.groups.pastEvents')}</Button>
      </div>
      {events.data?.map((e) => (
        <Card
          key={e.id}
          title={e.title}
          actions={
            g.canManage && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit(e)} />
                <ConfirmButton size="sm" icon={<Trash2 className="size-4" />} onConfirm={() => void api.groups.deleteEvent(g.id, e.id).then(refresh)} />
              </div>
            )
          }
        >
          <p className="text-sm text-muted">
            {formatDateTime(e.startsAt)}
            {e.endsAt && ` – ${formatDateTime(e.endsAt)}`}
            {e.game && (
              <>
                {' · '}
                <Link to={`/game/${e.game.slug}`} className="text-accent hover:underline">
                  {e.game.title}
                </Link>
              </>
            )}
          </p>
          {e.description && <Markdown className="mt-2">{e.description}</Markdown>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">{t('social.groups.rsvpCounts', { going: e.rsvp.going, maybe: e.rsvp.maybe })}</span>
            {g.myStatus === 'ACTIVE' &&
              (['GOING', 'MAYBE', 'DECLINED'] as const).map((s) => (
                <Button key={s} size="sm" variant={e.myRsvp === s ? 'primary' : 'secondary'} onClick={() => void rsvp(e, e.myRsvp === s ? null : s)}>
                  {t(`social.groups.rsvp.${s}`)}
                </Button>
              ))}
          </div>
        </Card>
      ))}
      {events.data?.length === 0 && <p className="text-sm text-muted">{t('social.groups.noEvents')}</p>}
      {edit && (
        <EventModal
          g={g}
          event={edit === 'new' ? null : edit}
          onClose={() => {
            setEdit(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function EventModal({ g, event, onClose }: { g: GroupDetail; event: GroupEventDto | null; onClose: () => void }) {
  const { t } = useTranslation();
  const library = useQuery({ queryKey: ['library', 'event'], queryFn: () => api.library.list() });
  const [form, setForm] = useState({
    title: event?.title ?? '',
    description: event?.description ?? '',
    startsAt: toLocalInput(event?.startsAt) || toLocalInput(new Date(Date.now() + 86400_000).toISOString()),
    endsAt: toLocalInput(event?.endsAt),
    gameId: event?.game?.id ?? '',
  });
  const save = async () => {
    const data = {
      title: form.title,
      description: form.description,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      gameId: form.gameId || null,
    };
    try {
      if (event) await api.groups.updateEvent(g.id, event.id, data);
      else await api.groups.createEvent(g.id, data);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Modal open onClose={onClose} title={event ? t('social.groups.editEvent') : t('social.groups.newEvent')} wide>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={t('social.groups.eventTitle')}>
          <Input required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('social.groups.startsAt')}>
            <Input type="datetime-local" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
          </Field>
          <Field label={t('social.groups.endsAt')}>
            <Input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
          </Field>
        </div>
        <Field label={t('social.groups.eventGame')}>
          <Select value={form.gameId} onChange={(e) => setForm({ ...form, gameId: e.target.value })}>
            <option value="">—</option>
            {event?.game && !library.data?.some((l) => l.game.id === event.game!.id) && <option value={event.game.id}>{event.game.title}</option>}
            {library.data?.map((l) => (
              <option key={l.game.id} value={l.game.id}>
                {l.game.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('social.groups.description')} hint={t('common.markdownHint')}>
          <Textarea rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Members({ g }: { g: GroupDetail }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ['groups', 'members', g.id], queryFn: () => api.groups.members(g.id) });
  const friends = useQuery({ queryKey: ['friends'], queryFn: () => api.friends.overview(), enabled: g.myStatus === 'ACTIVE' });
  const [invitee, setInvitee] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['groups'] });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      void refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const list = members.data ?? [];
  const pending = list.filter((m) => m.status === 'PENDING');
  const invited = list.filter((m) => m.status === 'INVITED');
  const active = list.filter((m) => m.status === 'ACTIVE');
  const canInvite = g.myStatus === 'ACTIVE' && (g.joinPolicy !== 'INVITE' || g.canManage);
  const invitable = friends.data?.friends.filter((f) => !list.some((m) => m.user.id === f.user.id)) ?? [];
  const isOwner = g.myRole === 'OWNER' || user?.role === 'ADMIN';

  return (
    <div className="space-y-4">
      {canInvite && (
        <Card title={t('social.groups.inviteFriends')}>
          {invitable.length ? (
            <div className="flex gap-2">
              <Select value={invitee} onChange={(e) => setInvitee(e.target.value)}>
                <option value="">—</option>
                {invitable.map((f) => (
                  <option key={f.user.id} value={f.user.id}>
                    {f.user.displayName || f.user.username}
                  </option>
                ))}
              </Select>
              <Button
                variant="primary"
                icon={<UserPlus className="size-4" />}
                disabled={!invitee}
                onClick={() =>
                  void run(async () => {
                    await api.groups.invite(g.id, invitee);
                    toast.success(t('social.groups.invited'));
                    setInvitee('');
                  })
                }
              >
                {t('social.groups.invite')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted">{t('social.chat.noFriendsToAdd')}</p>
          )}
        </Card>
      )}
      {g.canManage && pending.length > 0 && (
        <Card title={t('social.groups.requests')}>
          <ul className="divide-y divide-border">
            {pending.map((m) => (
              <li key={m.user.id} className="flex items-center gap-3 py-2">
                <Avatar user={m.user} size={32} />
                <UserLink user={m.user} className="flex-1" />
                <Button size="sm" variant="primary" onClick={() => void run(() => api.groups.approve(g.id, m.user.id))}>
                  {t('social.friends.accept')}
                </Button>
                <Button size="sm" onClick={() => void run(() => api.groups.removeMember(g.id, m.user.id))}>
                  {t('social.friends.decline')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={t('social.groups.memberCount', { count: active.length })}>
        <ul className="divide-y divide-border">
          {active.map((m) => (
            <li key={m.user.id} className="flex flex-wrap items-center gap-3 py-2">
              <Avatar user={m.user} size={32} />
              <div className="min-w-0 flex-1">
                <UserLink user={m.user} />
                <p className="text-xs text-muted">{t('social.groups.joined', { date: formatDate(m.joinedAt) })}</p>
              </div>
              {m.role !== 'MEMBER' && (
                <Badge tone={m.role === 'OWNER' ? 'accent' : 'default'}>
                  <Shield className="mr-1 inline size-3" />
                  {t(`social.groups.roles.${m.role}`)}
                </Badge>
              )}
              {isOwner && m.role !== 'OWNER' && (
                <Select
                  className="w-auto"
                  value={m.role}
                  onChange={(e) => {
                    const role = e.target.value as 'OWNER' | 'MODERATOR' | 'MEMBER';
                    if (role === 'OWNER' && !window.confirm(t('social.groups.confirmTransfer'))) return;
                    void run(() => api.groups.setRole(g.id, m.user.id, role));
                  }}
                >
                  <option value="MEMBER">{t('social.groups.roles.MEMBER')}</option>
                  <option value="MODERATOR">{t('social.groups.roles.MODERATOR')}</option>
                  <option value="OWNER">{t('social.groups.roles.OWNER')}</option>
                </Select>
              )}
              {g.canManage && m.role !== 'OWNER' && m.user.id !== user?.id && (m.role === 'MEMBER' || isOwner) && (
                <ConfirmButton size="sm" onConfirm={() => void run(() => api.groups.removeMember(g.id, m.user.id))}>
                  {t('social.groups.kick')}
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {g.canManage && invited.length > 0 && (
        <Card title={t('social.groups.invitedList')}>
          <ul className="divide-y divide-border">
            {invited.map((m) => (
              <li key={m.user.id} className="flex items-center gap-3 py-2">
                <Avatar user={m.user} size={28} />
                <UserLink user={m.user} className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => void run(() => api.groups.removeMember(g.id, m.user.id))}>
                  {t('social.groups.revokeInvite')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
