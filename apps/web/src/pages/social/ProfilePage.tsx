import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Award, Ban, Camera, Gamepad2, Library, Lock, MessageSquare, Settings, ThumbsDown, ThumbsUp, UserCheck, UserMinus, UserPlus, Users } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { BadgeDto, ProfileDto, ResolvedShowcase } from '@gameserver/shared';
import { Avatar } from '../../components/Avatar';
import { GameCard } from '../../components/GameCard';
import { Markdown } from '../../components/Markdown';
import { PresenceDot, presenceLabel } from '../../components/Social';
import { Badge, Button, ConfirmButton, ErrorState, PageLoader } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatPlaytime } from '../../lib/format';
import { toast } from '../../lib/toast';
import { ActivityList } from './ActivityList';

const BADGE_ICONS: Record<string, ReactNode> = {
  collector: <Library className="size-6" />,
  player: <Gamepad2 className="size-6" />,
  reviewer: <ThumbsUp className="size-6" />,
  social: <Users className="size-6" />,
  photographer: <Camera className="size-6" />,
  veteran: <Award className="size-6" />,
};

export function BadgeList({ badges }: { badges: BadgeDto[] }) {
  const { t } = useTranslation();
  if (!badges.length) return <p className="text-sm text-muted">{t('social.profile.noBadges')}</p>;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {badges.map((b) => (
        <li key={b.id} className="flex items-center gap-2 rounded-md border border-border bg-surface-2 p-2" title={t(`social.badges.${b.id}.desc`, { value: b.value })}>
          <span className="text-[var(--profile-accent)]">{BADGE_ICONS[b.id]}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{t(`social.badges.${b.id}.name`)}</span>
            <span className="text-xs text-muted">{t('social.profile.level', { level: b.level })}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface/90 p-4 backdrop-blur">
      <h2 className="mb-3 border-b border-[var(--profile-accent)]/40 pb-2 text-sm font-semibold tracking-wide uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Showcase({ s, profile }: { s: ResolvedShowcase; profile: ProfileDto }) {
  const { t } = useTranslation();
  const title = s.title || t(`social.showcases.${s.kind}`);
  switch (s.kind) {
    case 'text':
      return (
        <Section title={title}>
          <Markdown>{s.text ?? ''}</Markdown>
        </Section>
      );
    case 'favoriteGame':
      return (
        <Section title={title}>
          {s.game ? (
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="w-full sm:w-56">
                <GameCard game={s.game} />
              </div>
              {s.text && <Markdown className="flex-1">{s.text}</Markdown>}
            </div>
          ) : (
            <p className="text-sm text-muted">—</p>
          )}
        </Section>
      );
    case 'recentGames':
      return (
        <Section title={title}>
          <ul className="space-y-2">
            {s.games.map((g) => (
              <li key={g.game.id} className="flex items-center gap-3">
                {g.game.coverUrl && <img src={api.url(g.game.coverUrl)} alt="" className="h-14 w-10 rounded object-cover" />}
                <Link to={`/game/${g.game.slug}`} className="flex-1 font-medium hover:text-accent">
                  {g.game.title}
                </Link>
                <span className="text-right text-xs text-muted">
                  {formatPlaytime(g.playtimeSeconds)}
                  <br />
                  {formatDate(g.lastPlayedAt)}
                </span>
              </li>
            ))}
            {!s.games.length && <p className="text-sm text-muted">—</p>}
          </ul>
        </Section>
      );
    case 'screenshots':
      return (
        <Section title={title}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {s.items.map((i) => (
              <Link key={i.id} to={`/community/items/${i.id}`} className="block overflow-hidden rounded">
                <img src={api.url(i.imageUrl)} alt={i.title} className="aspect-video w-full object-cover transition hover:scale-105" loading="lazy" />
              </Link>
            ))}
          </div>
          {!s.items.length && <p className="text-sm text-muted">—</p>}
        </Section>
      );
    case 'reviews':
      return (
        <Section title={title}>
          <ul className="space-y-3">
            {s.reviews.map((r) => (
              <li key={r.id} className="rounded-md bg-surface-2 p-3">
                <Link to={`/game/${r.game?.slug}/reviews`} className="flex items-center gap-2 font-medium hover:text-accent">
                  {r.recommended ? <ThumbsUp className="size-4 text-success" /> : <ThumbsDown className="size-4 text-danger" />}
                  {r.game?.title}
                </Link>
                <p className="mt-1 line-clamp-3 text-sm text-muted">{r.body}</p>
              </li>
            ))}
          </ul>
          {!s.reviews.length && <p className="text-sm text-muted">—</p>}
        </Section>
      );
    case 'groups':
      return (
        <Section title={title}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {s.groups.map((g) => (
              <li key={g.id}>
                <Link to={`/groups/${g.slug}`} className="flex items-center gap-2 rounded-md p-2 hover:bg-surface-2">
                  <Avatar user={{ username: g.name, avatarUrl: g.avatarUrl }} size={32} />
                  <span className="flex-1 truncate">{g.name}</span>
                  <span className="text-xs text-muted">{g.memberCount}</span>
                </Link>
              </li>
            ))}
          </ul>
          {!s.groups.length && <p className="text-sm text-muted">—</p>}
        </Section>
      );
    case 'badges':
      return (
        <Section title={title}>
          <BadgeList badges={profile.badges} />
        </Section>
      );
    case 'stats':
      return profile.stats ? (
        <Section title={title}>
          <StatsGrid profile={profile} />
        </Section>
      ) : null;
    default:
      return null;
  }
}

function StatsGrid({ profile }: { profile: ProfileDto }) {
  const { t } = useTranslation();
  const s = profile.stats!;
  const items: [string, string | number][] = [
    [t('profile.games'), s.games],
    [t('profile.playtime'), formatPlaytime(s.playtimeSeconds)],
    [t('social.profile.reviews'), s.reviews],
    [t('social.profile.friends'), s.friends],
    [t('social.profile.screenshots'), s.screenshots],
    [t('social.profile.groups'), s.groups],
  ];
  return (
    <dl className="grid grid-cols-3 gap-3 text-center">
      {items.map(([label, value]) => (
        <div key={label}>
          <dd className="text-xl font-bold">{value}</dd>
          <dt className="text-xs text-muted uppercase">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

export default function ProfilePage() {
  const { username = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ['profile', username.toLowerCase()], queryFn: () => api.profiles.get(username) });
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['profile', username.toLowerCase()] });
      void qc.invalidateQueries({ queryKey: ['friends'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (profile.isLoading) return <PageLoader />;
  if (profile.error) return <ErrorState error={profile.error} />;
  const p = profile.data!;
  const accent = p.accent ?? 'var(--accent)';

  const acceptRequest = async () => {
    const overview = await api.friends.overview();
    const req = overview.incoming.find((r) => r.user.id === p.user.id);
    if (req) await api.friends.accept(req.id);
  };

  const actions = user && p.relation !== 'self' && (
    <div className="flex flex-wrap gap-2">
      {p.relation === 'none' && (
        <Button size="sm" variant="primary" icon={<UserPlus className="size-4" />} onClick={() => act.mutate(() => api.friends.request(p.user.username))}>
          {t('social.friends.addFriend')}
        </Button>
      )}
      {p.relation === 'incoming' && (
        <Button size="sm" variant="primary" icon={<UserCheck className="size-4" />} onClick={() => act.mutate(acceptRequest)}>
          {t('social.friends.accept')}
        </Button>
      )}
      {p.relation === 'outgoing' && <Badge>{t('social.friends.pending')}</Badge>}
      {p.relation === 'friends' && (
        <>
          <Button
            size="sm"
            variant="primary"
            icon={<MessageSquare className="size-4" />}
            onClick={async () => {
              try {
                navigate(`/chat/${(await api.chat.direct(p.user.id)).id}`);
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            {t('social.friends.message')}
          </Button>
          <ConfirmButton size="sm" icon={<UserMinus className="size-4" />} onConfirm={() => act.mutate(() => api.friends.remove(p.user.id))}>
            {t('social.friends.remove')}
          </ConfirmButton>
        </>
      )}
      {p.relation === 'blocked' ? (
        <Button size="sm" onClick={() => act.mutate(() => api.friends.unblock(p.user.id))}>
          {t('social.friends.unblock')}
        </Button>
      ) : (
        <ConfirmButton size="sm" icon={<Ban className="size-4" />} onConfirm={() => act.mutate(() => api.friends.block(p.user.id))}>
          {t('social.friends.block')}
        </ConfirmButton>
      )}
    </div>
  );

  return (
    <div className="-mx-4 -mt-6 min-h-[70vh] px-4 pt-6" style={{ '--profile-accent': accent } as CSSProperties}>
      {p.backgroundUrl && (
        <div
          className="pointer-events-none fixed inset-0 -z-10 bg-cover bg-center opacity-40"
          style={{ backgroundImage: `url("${api.url(p.backgroundUrl)}")` }}
          aria-hidden="true"
        />
      )}
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-col gap-5 rounded-lg border border-[var(--profile-accent)]/50 bg-surface/90 p-6 backdrop-blur sm:flex-row">
          <div className="relative self-start">
            <Avatar user={p.user} size={128} className="ring-4 ring-[var(--profile-accent)]" />
          </div>
          <div className="flex-1 space-y-2">
            <h1 className="flex flex-wrap items-center gap-2 text-3xl font-bold">
              {p.user.displayName || p.user.username}
              {p.user.role !== 'USER' && <Badge tone="accent">{t(`roles.${p.user.role}`)}</Badge>}
            </h1>
            <p className="text-sm text-muted">
              @{p.user.username} · {t('profile.memberSince', { date: formatDate(p.user.createdAt) })}
            </p>
            {p.presence && (
              <p className={clsx('flex items-center gap-2 text-sm', p.presence.game ? 'text-success' : p.presence.online ? 'text-accent' : 'text-muted')}>
                <PresenceDot presence={p.presence} />
                {presenceLabel(t, p.presence)}
              </p>
            )}
            {p.user.bio && <Markdown>{p.user.bio}</Markdown>}
            {actions}
            {p.relation === 'self' && (
              <Link to="/account#profile" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
                <Settings className="size-4" />
                {t('social.profile.edit')}
              </Link>
            )}
          </div>
          {p.stats && (
            <div className="sm:w-64">
              <StatsGrid profile={p} />
            </div>
          )}
        </div>

        {p.restricted ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface/90 p-6 text-muted">
            <Lock className="size-5" />
            {t(p.visibility === 'FRIENDS' ? 'social.profile.friendsOnly' : 'social.profile.private')}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4">
              {p.showcases.map((s, i) => (
                <Showcase key={i} s={s} profile={p} />
              ))}
              <Section title={t('social.activity.recent')}>
                <ActivityList items={p.activity} showUser={false} />
              </Section>
            </div>
            <div className="space-y-4">
              <Section title={t('social.profile.badges')}>
                <BadgeList badges={p.badges} />
              </Section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
