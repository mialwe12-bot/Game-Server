import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { BarChart } from '../../components/BarChart';
import { Card, EmptyState, ErrorState, PageLoader } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatPlaytime } from '../../lib/format';
import i18n from '../../i18n';
import { hourAxis, hours, StatTile } from './StatsPage';

/** Jahresrückblick (/year/:year bzw. /u/:username/year/:year) */
export default function YearReviewPage() {
  const { username, year: yearParam } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const year = Number(yearParam) || new Date().getFullYear();
  const own = !username || username.toLowerCase() === user?.username.toLowerCase();
  const review = useQuery({
    queryKey: ['stats', 'year', username ?? 'me', year],
    queryFn: () => (own ? api.stats.myYear(year) : api.stats.userYear(username!, year)),
  });
  const base = own ? '/year' : `/u/${username}/year`;
  if (review.isLoading) return <PageLoader />;
  if (review.error) return <ErrorState error={review.error} />;
  const r = review.data!;
  const months = Array.from({ length: 12 }, (_, i) => new Date(year, i, 1).toLocaleDateString(i18n.language, { month: 'short' }));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to={`${base}/${year - 1}`} className="rounded p-1 hover:bg-surface-2" aria-label={String(year - 1)}>
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold">{own ? t('stats.yearTitle', { year }) : t('stats.yearTitleUser', { year, name: username })}</h1>
        {year < new Date().getFullYear() && (
          <Link to={`${base}/${year + 1}`} className="rounded p-1 hover:bg-surface-2" aria-label={String(year + 1)}>
            <ChevronRight className="size-5" />
          </Link>
        )}
      </div>
      {r.totalSeconds === 0 ? (
        <EmptyState title={t('stats.yearEmpty', { year })} />
      ) : (
        <>
          <div className="rounded-lg border border-border bg-surface p-6">
            <p className="text-sm text-muted">{t('stats.yearHero')}</p>
            <p className="text-5xl font-semibold tabular-nums">{hours(r.totalSeconds)}</p>
            <p className="mt-1 text-sm text-muted">
              {t('stats.yearHeroHint', { sessions: r.sessions, games: r.gamesPlayed })}
              {r.percentile !== null && ` · ${t('stats.percentile', { percent: r.percentile })}`}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label={t('stats.newGames')} value={r.newGames} />
            <StatTile label={t('stats.achievementsUnlocked')} value={r.achievementsUnlocked} />
            <StatTile label={t('stats.reviewsWritten')} value={r.reviewsWritten} />
            <StatTile label={t('stats.friendsAdded')} value={r.friendsAdded} />
            {r.longestSession && (
              <StatTile label={t('stats.longestSession')} value={formatPlaytime(r.longestSession.seconds)} hint={`${r.longestSession.game.title} · ${formatDate(r.longestSession.date)}`} />
            )}
            {r.mostActiveDay && <StatTile label={t('stats.mostActiveDay')} value={formatDate(r.mostActiveDay.date)} hint={hours(r.mostActiveDay.seconds)} />}
            <StatTile label={t('stats.screenshotsShared')} value={r.screenshotsShared} />
          </div>
          <Card>
            <BarChart title={t('stats.perMonth')} format={(h) => hours(h * 3600)} axisFormat={hourAxis} minTop={1} data={r.months.map((v, i) => ({ key: String(i), label: months[i], value: v / 3600 }))} />
          </Card>
          <Card title={t('stats.topGames')}>
            <ol className="space-y-2">
              {r.topGames.map((g, i) => (
                <li key={g.game.id} className="flex items-center gap-3">
                  <span className="w-6 text-right text-sm font-semibold text-muted">{i + 1}.</span>
                  <Link to={`/game/${g.game.slug}`} className="flex-1 truncate hover:text-accent">
                    {g.game.title}
                  </Link>
                  {/* Anteil als dezente Balkenspur, Wert als Text */}
                  <span className="hidden h-2 w-40 overflow-hidden rounded-full bg-surface-2 sm:block">
                    <span className="block h-full rounded-full" style={{ width: `${(g.seconds / r.topGames[0].seconds) * 100}%`, background: 'var(--chart-1)' }} />
                  </span>
                  <span className="w-20 text-right text-sm tabular-nums">{hours(g.seconds)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </div>
  );
}
