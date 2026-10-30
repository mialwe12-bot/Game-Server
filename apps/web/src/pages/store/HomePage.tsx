import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Compass, Megaphone, Pin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { GameSummary } from '@gameserver/shared';
import { GameCover, GameRow } from '../../components/GameCard';
import { Markdown } from '../../components/Markdown';
import { PlatformIcons } from '../../components/PlatformIcons';
import { EmptyState, ErrorState, PageLoader } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/format';

function FeaturedCarousel({ games }: { games: GameSummary[] }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (games.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % games.length), 7000);
    return () => clearInterval(timer);
  }, [games.length]);
  if (games.length === 0) return null;
  const game = games[index % games.length];
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold uppercase tracking-wide">{t('store.featured')}</h2>
      <div className="relative overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
        <Link to={`/game/${game.slug}`} className="grid grid-cols-1 md:grid-cols-[2fr_1fr]">
          <GameCover game={game} landscape className="md:aspect-auto md:min-h-80" />
          <div className="flex flex-col gap-3 p-5">
            <h3 className="text-2xl font-bold">{game.title}</h3>
            <p className="line-clamp-5 text-sm text-muted">{game.shortDescription}</p>
            <div className="mt-auto flex flex-wrap gap-1">
              {game.genres.slice(0, 4).map((g) => (
                <span key={g.id} className="rounded bg-surface-2 px-2 py-0.5 text-xs">
                  {g.name}
                </span>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-success">{t('store.free')}</span>
              <PlatformIcons platforms={game.platforms} />
            </div>
          </div>
        </Link>
        {games.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => setIndex((i) => (i - 1 + games.length) % games.length)}
              className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              aria-label={t('common.previous')}
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => setIndex((i) => (i + 1) % games.length)}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 md:right-[calc(33%+0.5rem)]"
              aria-label={t('common.next')}
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </div>
      <div className="flex justify-center gap-2">
        {games.map((g, i) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setIndex(i)}
            className={`h-1.5 w-6 rounded-full ${i === index ? 'bg-accent' : 'bg-border'}`}
            aria-label={g.title}
          />
        ))}
      </div>
    </section>
  );
}

export default function HomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const home = useQuery({ queryKey: ['store-home', user?.id], queryFn: () => api.store.home() });

  if (home.isLoading) return <PageLoader />;
  if (home.error) return <ErrorState error={home.error} onRetry={() => home.refetch()} />;
  const data = home.data!;
  const empty = !data.newReleases.length && !data.featured.length;

  return (
    <div className="space-y-10">
      {user && (
        <Link
          to="/discover"
          className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm font-medium hover:bg-accent/20"
        >
          <Compass className="size-5 text-accent" />
          {t('discovery.title')}
          <ChevronRight className="ml-auto size-4" />
        </Link>
      )}
      {empty ? (
        <EmptyState title={t('store.emptyStore')}>
          {(user?.role === 'ADMIN' || user?.role === 'UPLOADER') && (
            <Link to="/admin/games" className="text-accent hover:underline">
              {t('store.emptyStoreAdmin')}
            </Link>
          )}
        </EmptyState>
      ) : (
        <>
          <FeaturedCarousel games={data.featured} />
          {user && <GameRow title={t('store.recommended')} hint={t('store.recommendedHint')} games={data.recommended} />}
          <GameRow
            title={t('store.newReleases')}
            games={data.newReleases}
            action={
              <Link to="/search?sort=newest" className="text-sm text-accent hover:underline">
                {t('store.browseAll')}
              </Link>
            }
          />
          <GameRow title={t('store.popular')} games={data.popular} />
        </>
      )}
      {data.announcements.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-xl font-semibold uppercase tracking-wide">
            <Megaphone className="size-5" /> {t('store.announcements')}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {data.announcements.map((a) => (
              <article key={a.id} className="rounded-lg border border-border bg-surface p-4">
                <header className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="font-semibold">
                    {a.pinned && <Pin className="mr-1 inline size-4 text-accent" />}
                    {a.title}
                  </h3>
                  <time className="shrink-0 text-xs text-muted">{formatDate(a.createdAt)}</time>
                </header>
                {a.gameTitle && a.gameId && <p className="mb-2 text-xs text-accent">{a.gameTitle}</p>}
                <Markdown>{a.body}</Markdown>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
