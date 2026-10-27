import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import type { AchievementDto, GameDetail } from '@gameserver/shared';
import { Card, EmptyState, ErrorState, PageLoader, ProgressBar, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { AchievementIcon } from '../admin/game/AchievementsTab';

export function AchievementRow({ a }: { a: AchievementDto }) {
  const { t } = useTranslation();
  const secret = a.hidden && !a.unlocked && !a.name;
  return (
    <li className={clsx('flex items-center gap-3 py-3', !a.unlocked && 'opacity-80')}>
      <AchievementIcon url={a.iconUrl} size={48} locked={!a.unlocked} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-medium">
          {secret ? (
            <>
              <EyeOff className="size-4 text-muted" />
              {t('achievements.hidden')}
            </>
          ) : (
            a.name
          )}
        </p>
        <p className="text-sm text-muted">{secret ? t('achievements.hiddenHint') : a.description}</p>
        {a.progressMax && !a.unlocked && (
          <div className="mt-1 flex items-center gap-2">
            <ProgressBar value={a.progress / a.progressMax} className="max-w-56" />
            <span className="text-xs text-muted">
              {a.progress}/{a.progressMax}
            </span>
          </div>
        )}
      </div>
      <div className="text-right text-xs">
        <p className={clsx('font-semibold', a.rarity < 10 ? 'text-warning' : 'text-muted')}>{t('achievements.rarity', { percent: a.rarity })}</p>
        {a.unlockedAt && <p className="text-success">{t('achievements.unlockedAt', { date: formatDate(a.unlockedAt) })}</p>}
      </div>
    </li>
  );
}

/** Tab „Achievements“ auf der Spieleseite */
export function GameAchievementsTab({ game }: { game: GameDetail }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const data = useQuery({ queryKey: ['achievements', 'game', game.id, user?.id], queryFn: () => api.achievements.forGame(game.id) });
  if (data.isLoading) return <Spinner />;
  if (data.error) return <ErrorState error={data.error} />;
  const d = data.data!;
  if (!d.total) return <EmptyState title={t('achievements.none')} />;
  const sorted = [...d.achievements].sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || b.rarity - a.rarity);
  return (
    <Card>
      {user && (
        <div className="mb-3 flex items-center gap-3">
          <ProgressBar value={d.unlocked / d.total} />
          <span className="shrink-0 text-sm font-medium">{t('achievements.progress', { unlocked: d.unlocked, total: d.total })}</span>
        </div>
      )}
      <ul className="divide-y divide-border">
        {sorted.map((a) => (
          <AchievementRow key={a.id} a={a} />
        ))}
      </ul>
    </Card>
  );
}

/** Übersicht aller Achievements eines Nutzers (/u/:username/achievements) */
export default function UserAchievementsPage() {
  const { username = '' } = useParams();
  const { t } = useTranslation();
  const data = useQuery({ queryKey: ['achievements', 'user', username], queryFn: () => api.achievements.forUser(username) });
  if (data.isLoading) return <PageLoader />;
  if (data.error) return <ErrorState error={data.error} />;
  const games = data.data!;
  const total = games.reduce((s, g) => s + g.unlocked, 0);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('achievements.userTitle', { name: username })}</h1>
        <Link to={`/u/${username}`} className="text-sm text-accent hover:underline">
          ← {t('nav.profile')}
        </Link>
      </div>
      <p className="text-muted">{t('achievements.userTotal', { count: total, games: games.length })}</p>
      {games.length === 0 && <EmptyState title={t('achievements.noneUser')} />}
      {games.map((g) => (
        <Card
          key={g.game.id}
          title={
            <Link to={`/game/${g.game.slug}/achievements`} className="hover:text-accent">
              {g.game.title}
            </Link>
          }
          actions={<span className="text-sm text-muted">{t('achievements.progress', { unlocked: g.unlocked, total: g.total })}</span>}
        >
          <ProgressBar value={g.total ? g.unlocked / g.total : 0} className="mb-2" />
          <ul className="divide-y divide-border">
            {g.achievements
              .filter((a) => a.unlocked)
              .sort((a, b) => a.rarity - b.rarity)
              .slice(0, 5)
              .map((a) => (
                <AchievementRow key={a.id} a={a} />
              ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
