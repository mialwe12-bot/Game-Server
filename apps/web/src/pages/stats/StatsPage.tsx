import { useQuery } from '@tanstack/react-query';
import { CalendarRange, Trophy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { BarChart } from '../../components/BarChart';
import { Card, ErrorState, PageLoader, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatPlaytime } from '../../lib/format';

export const hours = (s: number) =>
  s > 0 && s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s / 3600 >= 10 ? `${Math.round(s / 3600)} h` : `${(s / 3600).toFixed(1).replace('.0', '')} h`;

/** Achsenbeschriftung für Diagramme in Stunden (Werte < 1 h in Minuten) */
export const hourAxis = (h: number) => (h > 0 && h < 1 ? `${Math.round(h * 60)} min` : `${Number(h.toFixed(1))} h`);

export function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Spielzeit-Statistik (eigene: /stats, fremde: /u/:username/stats) */
export default function StatsPage() {
  const { username } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [weeks, setWeeks] = useState(12);
  const own = !username || username.toLowerCase() === user?.username.toLowerCase();
  const stats = useQuery({
    queryKey: ['stats', username ?? 'me', weeks],
    queryFn: () => (own ? api.stats.me(weeks) : api.stats.user(username!, weeks)),
  });
  if (stats.isLoading) return <PageLoader />;
  if (stats.error) return <ErrorState error={stats.error} />;
  const s = stats.data!;
  const titles = new Map(s.games.map((g) => [g.game.id, g.game.title]));
  const thisWeek = s.weeks.at(-1)?.seconds ?? 0;
  const avg = s.weeks.reduce((a, w) => a + w.seconds, 0) / Math.max(1, s.weeks.length);
  const year = new Date().getFullYear();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">{own ? t('stats.title') : t('stats.titleUser', { name: username })}</h1>
        <Link to={own ? `/year/${year}` : `/u/${username}/year/${year}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
          <CalendarRange className="size-4" />
          {t('stats.yearReview', { year })}
        </Link>
        <Link to="/charts" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
          <Trophy className="size-4" />
          {t('stats.charts')}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={t('stats.total')} value={hours(s.totalSeconds)} />
        <StatTile label={t('stats.thisWeek')} value={hours(thisWeek)} />
        <StatTile label={t('stats.weeklyAverage', { weeks })} value={hours(avg)} />
        <StatTile label={t('stats.gamesPlayed')} value={s.games.length} />
      </div>
      <Card
        actions={
          <Select className="w-auto" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label={t('stats.period')}>
            {[4, 12, 26, 52].map((w) => (
              <option key={w} value={w}>
                {t('stats.lastWeeks', { count: w })}
              </option>
            ))}
          </Select>
        }
      >
        <BarChart
          title={t('stats.perWeek')}
          format={(h) => hours(h * 3600)}
          axisFormat={hourAxis}
          minTop={1}
          data={s.weeks.map((w) => ({
            key: w.weekStart,
            label: formatDate(w.weekStart, { day: '2-digit', month: '2-digit' }),
            value: w.seconds / 3600,
            detail: w.games.length ? (
              <ul className="mt-1 space-y-0.5 text-muted">
                {w.games.slice(0, 4).map((g) => (
                  <li key={g.gameId} className="flex justify-between gap-3">
                    <span className="truncate">{titles.get(g.gameId) ?? '—'}</span>
                    <span className="tabular-nums">{hours(g.seconds)}</span>
                  </li>
                ))}
              </ul>
            ) : null,
          }))}
        />
      </Card>
      <Card title={t('stats.perGame')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-2">{t('stats.game')}</th>
                <th className="text-right">{t('stats.playtime')}</th>
                <th className="text-right">{t('stats.lastTwoWeeks')}</th>
                <th className="text-right">{t('stats.sessions')}</th>
                <th className="text-right">{t('stats.lastPlayed')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {s.games.map((g) => (
                <tr key={g.game.id}>
                  <td className="py-2">
                    <Link to={`/game/${g.game.slug}`} className="hover:text-accent">
                      {g.game.title}
                    </Link>
                  </td>
                  <td className="text-right tabular-nums">{formatPlaytime(g.seconds)}</td>
                  <td className="text-right text-muted tabular-nums">{g.recentSeconds ? formatPlaytime(g.recentSeconds) : '—'}</td>
                  <td className="text-right tabular-nums">{g.sessions}</td>
                  <td className="text-right text-muted">{g.lastPlayedAt ? formatDate(g.lastPlayedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!s.games.length && <p className="py-6 text-center text-sm text-muted">{t('stats.noPlaytime')}</p>}
        </div>
      </Card>
    </div>
  );
}
