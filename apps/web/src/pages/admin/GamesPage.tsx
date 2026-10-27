import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { GameCover } from '../../components/GameCard';
import { PlatformIcons } from '../../components/PlatformIcons';
import { Badge, Button, EmptyState, ErrorState, Field, Input, Modal, PageLoader } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { toast } from '../../lib/toast';

export default function GamesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const games = useQuery({ queryKey: ['admin', 'games', q], queryFn: () => api.manage.games(q || undefined) });
  const create = useMutation({
    mutationFn: () => api.manage.createGame({ title }),
    onSuccess: (g) => navigate(`/admin/games/${g.id}`),
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t('admin.games')}</h1>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.searchGames')} className="ml-auto max-w-xs" />
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
          {t('admin.newGame')}
        </Button>
      </div>
      {games.isLoading ? (
        <PageLoader />
      ) : games.error ? (
        <ErrorState error={games.error} onRetry={() => games.refetch()} />
      ) : games.data!.length === 0 ? (
        <EmptyState title={t('admin.noGames')} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {games.data!.map((g) => (
                <tr key={g.id} className="hover:bg-surface-2/50">
                  <td className="w-28 p-2">
                    <Link to={`/admin/games/${g.id}`}>
                      <GameCover game={g} landscape className="rounded" />
                    </Link>
                  </td>
                  <td className="p-2">
                    <Link to={`/admin/games/${g.id}`} className="font-semibold hover:text-accent">
                      {g.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Badge tone={g.visibility === 'PUBLIC' ? 'success' : g.visibility === 'HIDDEN' ? 'default' : 'warning'}>
                        {t(`visibility.${g.visibility}`).split(' (')[0]}
                      </Badge>
                      {g.featured && <Badge tone="accent">★</Badge>}
                      <span>{t('admin.versionsCount', { count: g.versionCount })}</span>
                      <PlatformIcons platforms={g.platforms} />
                    </div>
                  </td>
                  <td className="hidden p-2 text-right text-xs text-muted md:table-cell">
                    <div>
                      {g.downloadCount} {t('store.downloads')} · {t('store.owners', { count: g.libraryCount })}
                    </div>
                    <div>
                      {t('common.updated')}: {formatDateTime(g.updatedAt)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('admin.newGame')}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label={t('admin.gameTitle')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus maxLength={200} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              {t('common.create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
