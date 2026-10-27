import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, Plus, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { DiscoveryAction } from '@gameserver/shared';
import { GameCover } from '../../components/GameCard';
import { PlatformIcons } from '../../components/PlatformIcons';
import { Button, EmptyState, ErrorState, PageLoader, ProgressBar } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { toast } from '../../lib/toast';

export default function DiscoveryPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const queue = useQuery({ queryKey: ['discovery'], queryFn: () => api.store.discovery(12), staleTime: Infinity });
  const [index, setIndex] = useState(0);

  const act = useMutation({
    mutationFn: ({ gameId, action }: { gameId: string; action: DiscoveryAction }) => api.store.discoveryAction(gameId, action),
    onSuccess: (_d, v) => {
      if (v.action !== 'SKIPPED') void qc.invalidateQueries({ queryKey: [v.action === 'ADDED' ? 'library' : 'wishlist'] });
      setIndex((i) => i + 1);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const restart = async (reset: boolean) => {
    if (reset) await api.store.resetDiscovery();
    setIndex(0);
    await queue.refetch();
  };

  if (queue.isLoading) return <PageLoader />;
  if (queue.error) return <ErrorState error={queue.error} onRetry={() => queue.refetch()} />;
  const games = queue.data!;
  const game = games[index];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('discovery.title')}</h1>
        <p className="text-sm text-muted">{t('discovery.text')}</p>
      </div>
      {!game ? (
        <EmptyState title={t('discovery.done')}>
          <div className="mt-2 flex justify-center gap-2">
            <Button variant="primary" onClick={() => void restart(false)}>
              {t('discovery.restart')}
            </Button>
            <Button icon={<RotateCcw className="size-4" />} onClick={() => void restart(true)}>
              {t('discovery.reset')}
            </Button>
          </div>
        </EmptyState>
      ) : (
        <>
          <div className="space-y-1">
            <ProgressBar value={index / games.length} />
            <p className="text-right text-xs text-muted">{t('discovery.progress', { current: index + 1, total: games.length })}</p>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-surface md:grid md:grid-cols-[3fr_2fr]">
            <GameCover game={game} landscape className="md:aspect-auto md:h-full" />
            <div className="flex flex-col gap-3 p-5">
              <Link to={`/game/${game.slug}`} className="text-2xl font-bold hover:text-accent">
                {game.title}
              </Link>
              <p className="text-sm text-muted">{game.shortDescription}</p>
              <div className="flex flex-wrap gap-1">
                {game.genres.map((g) => (
                  <span key={g.id} className="rounded bg-accent/15 px-2 py-0.5 text-xs text-accent">
                    {g.name}
                  </span>
                ))}
                {game.tags.slice(0, 6).map((g) => (
                  <span key={g.id} className="rounded bg-surface-2 px-2 py-0.5 text-xs">
                    {g.name}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{game.releaseDate && formatDate(game.releaseDate)}</span>
                <PlatformIcons platforms={game.platforms} />
              </div>
              <div className="mt-auto grid grid-cols-1 gap-2 pt-4 sm:grid-cols-3">
                <Button icon={<X className="size-4" />} disabled={act.isPending} onClick={() => act.mutate({ gameId: game.id, action: 'SKIPPED' })}>
                  {t('discovery.skip')}
                </Button>
                <Button icon={<Heart className="size-4" />} disabled={act.isPending} onClick={() => act.mutate({ gameId: game.id, action: 'WISHLISTED' })}>
                  {t('discovery.wishlist')}
                </Button>
                <Button
                  variant="primary"
                  icon={<Plus className="size-4" />}
                  disabled={act.isPending}
                  onClick={() => act.mutate({ gameId: game.id, action: 'ADDED' })}
                >
                  {t('discovery.add')}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
