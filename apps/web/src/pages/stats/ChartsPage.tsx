import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { TopLists } from '@gameserver/shared';
import { Avatar } from '../../components/Avatar';
import { Card, ErrorState, PageLoader, Tabs } from '../../components/ui';
import { api } from '../../lib/api';
import { hours } from './StatsPage';

function Ranked<T>({ title, items, render, value }: { title: string; items: T[]; render: (i: T) => ReactNode; value: (i: T) => string }) {
  const { t } = useTranslation();
  return (
    <Card title={title}>
      {items.length ? (
        <ol className="divide-y divide-border">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-3 py-2">
              <span className="w-6 text-right text-sm font-semibold text-muted tabular-nums">{i + 1}.</span>
              <div className="min-w-0 flex-1 truncate">{render(it)}</div>
              <span className="text-sm tabular-nums">{value(it)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted">{t('stats.noData')}</p>
      )}
    </Card>
  );
}

/** Globale Top-Listen */
export default function ChartsPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<TopLists['period']>('month');
  const top = useQuery({ queryKey: ['stats', 'top', period], queryFn: () => api.stats.top(period) });
  const game = (g: { slug: string; title: string; coverUrl?: string | null }) => (
    <Link to={`/game/${g.slug}`} className="flex items-center gap-2 hover:text-accent">
      {g.coverUrl && <img src={api.url(g.coverUrl)} alt="" className="h-9 w-7 rounded object-cover" />}
      {g.title}
    </Link>
  );
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold">{t('stats.charts')}</h1>
      <Tabs
        value={period}
        onChange={setPeriod}
        tabs={(['week', 'month', 'year', 'all'] as const).map((p) => ({ id: p, label: t(`stats.periods.${p}`) }))}
      />
      {top.isLoading ? (
        <PageLoader />
      ) : top.error ? (
        <ErrorState error={top.error} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Ranked title={t('stats.mostPlayed')} items={top.data!.mostPlayed} render={(i) => game(i.game)} value={(i) => `${hours(i.seconds)} · ${t('stats.players', { count: i.players })}`} />
          <Ranked title={t('stats.mostOwned')} items={top.data!.mostOwned} render={(i) => game(i.game)} value={(i) => t('stats.owners', { count: i.owners })} />
          <Ranked title={t('stats.topRated')} items={top.data!.topRated} render={(i) => game(i.game)} value={(i) => `${i.percent} % · ${i.total}`} />
          <Ranked
            title={t('stats.achievementHunters')}
            items={top.data!.mostAchievements}
            render={(i) => (
              <Link to={`/u/${i.user.username}`} className="flex items-center gap-2 hover:text-accent">
                <Avatar user={i.user} size={24} />
                {i.user.displayName || i.user.username}
              </Link>
            )}
            value={(i) => String(i.unlocked)}
          />
          <Ranked
            title={t('stats.topLevels')}
            items={top.data!.topLevels}
            render={(i) => (
              <Link to={`/u/${i.user.username}`} className="flex items-center gap-2 hover:text-accent">
                <Avatar user={i.user} size={24} />
                {i.user.displayName || i.user.username}
              </Link>
            )}
            value={(i) => `Level ${i.level}`}
          />
        </div>
      )}
    </div>
  );
}
