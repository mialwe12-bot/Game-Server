import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Avatar } from '../../components/Avatar';
import { Markdown } from '../../components/Markdown';
import { Badge, ErrorState, PageLoader } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate, formatPlaytime } from '../../lib/format';

export default function ProfilePage() {
  const { username = '' } = useParams();
  const { t } = useTranslation();
  const profile = useQuery({ queryKey: ['profile', username], queryFn: () => api.users.byName(username) });
  if (profile.isLoading) return <PageLoader />;
  if (profile.error) return <ErrorState error={profile.error} />;
  const p = profile.data!;
  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-col gap-6 rounded-lg border border-border bg-gradient-to-br from-surface to-surface-2 p-6 sm:flex-row">
        <Avatar user={p} size={128} />
        <div className="flex-1 space-y-2">
          <h1 className="flex flex-wrap items-center gap-2 text-3xl font-bold">
            {p.displayName || p.username}
            {p.role !== 'USER' && <Badge tone="accent">{t(`roles.${p.role}`)}</Badge>}
          </h1>
          <p className="text-sm text-muted">
            @{p.username} · {t('profile.memberSince', { date: formatDate(p.createdAt) })}
          </p>
          {p.bio && <Markdown>{p.bio}</Markdown>}
        </div>
        <dl className="grid grid-cols-2 gap-4 text-center sm:grid-cols-1">
          <div>
            <dt className="text-xs uppercase text-muted">{t('profile.games')}</dt>
            <dd className="text-2xl font-bold">{p.libraryCount}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted">{t('profile.playtime')}</dt>
            <dd className="text-2xl font-bold">{formatPlaytime(p.playtimeSeconds)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
