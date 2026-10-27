import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { GameCover } from '../../components/GameCard';
import { PlatformIcons } from '../../components/PlatformIcons';
import { Button, EmptyState, ErrorState, PageLoader } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { toast } from '../../lib/toast';

export default function WishlistPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['wishlist'], queryFn: () => api.library.wishlist() });
  const mutate = useMutation({
    mutationFn: async ({ id, add }: { id: string; add: boolean }) => (add ? api.library.add(id) : api.library.removeFromWishlist(id)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wishlist'] });
      void qc.invalidateQueries({ queryKey: ['library'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (list.isLoading) return <PageLoader />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('wishlist.title')}</h1>
      {list.data!.length === 0 ? (
        <EmptyState icon={<Heart className="size-8" />} title={t('wishlist.empty')}>
          <Link to="/search" className="text-accent hover:underline">
            {t('store.browseAll')}
          </Link>
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {list.data!.map((g) => (
            <li key={g.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center">
              <Link to={`/game/${g.slug}`} className="w-full shrink-0 sm:w-48">
                <GameCover game={g} landscape className="rounded" />
              </Link>
              <div className="min-w-0 flex-1">
                <Link to={`/game/${g.slug}`} className="text-lg font-semibold hover:text-accent">
                  {g.title}
                </Link>
                <p className="line-clamp-2 text-sm text-muted">{g.shortDescription}</p>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted">
                  <PlatformIcons platforms={g.platforms} />
                  <span>{t('wishlist.added', { date: formatDate(g.addedAt) })}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => mutate.mutate({ id: g.id, add: true })}>
                  {t('store.addToLibrary')}
                </Button>
                <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => mutate.mutate({ id: g.id, add: false })} aria-label={t('common.remove')} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
