import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { EyeOff, Folder, FolderPlus, Gamepad2, HardDrive, LayoutGrid, List, MoreVertical, Pencil, Star, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import type { CollectionDto, LibraryEntryDto } from '@gameserver/shared';
import { GameCover } from '../../components/GameCard';
import { PlatformIcons } from '../../components/PlatformIcons';
import { Button, ConfirmButton, EmptyState, ErrorState, Input, Modal, PageLoader, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDate, formatPlaytime } from '../../lib/format';
import { toast } from '../../lib/toast';
import { useDesktop } from '../../desktop/DesktopProvider';
import { InstalledList, LibraryPlayButton } from '../../desktop/LibraryActions';

type Sort = 'title' | 'lastPlayed' | 'playtime' | 'added';

function EntryMenu({ entry, collections, onChange }: { entry: LibraryEntryDto; collections: CollectionDto[]; onChange: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const run = async (fn: () => Promise<unknown>) => {
    setOpen(false);
    try {
      await fn();
      onChange();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const id = entry.game.id;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label={t('common.actions')}>
        <MoreVertical className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 bottom-full z-30 mb-1 w-56 rounded-lg border border-border bg-surface p-1 text-sm shadow-xl">
          <button type="button" className="flex w-full items-center gap-2 rounded px-3 py-2 hover:bg-surface-2" onClick={() => run(() => api.library.update(id, { favorite: !entry.favorite }))}>
            <Star className="size-4" /> {entry.favorite ? t('library.unfavorite') : t('library.favorite')}
          </button>
          <button type="button" className="flex w-full items-center gap-2 rounded px-3 py-2 hover:bg-surface-2" onClick={() => run(() => api.library.update(id, { hidden: !entry.hidden }))}>
            <EyeOff className="size-4" /> {entry.hidden ? t('library.unhide') : t('library.hide')}
          </button>
          {collections.length > 0 && (
            <div className="border-t border-border pt-1">
              <p className="px-3 py-1 text-xs text-muted">{t('library.addToCollection')}</p>
              {collections.map((c) => {
                const inIt = entry.collectionIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-3 py-1.5 hover:bg-surface-2"
                    onClick={() => run(() => (inIt ? api.library.removeFromCollection(c.id, id) : api.library.addToCollection(c.id, id)))}
                  >
                    <Folder className={clsx('size-4', inIt && 'fill-accent text-accent')} /> {c.name}
                  </button>
                );
              })}
            </div>
          )}
          <div className="border-t border-border pt-1">
            <button type="button" className="flex w-full items-center gap-2 rounded px-3 py-2 text-danger hover:bg-surface-2" onClick={() => run(() => api.library.remove(id))}>
              <Trash2 className="size-4" /> {t('store.removeFromLibrary')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LibraryPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? 'all'; // all | favorites | hidden | collection id
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem('gs-lib-sort') as Sort) || 'title');
  const [layout, setLayout] = useState<'grid' | 'list'>(() => (localStorage.getItem('gs-lib-layout') as 'grid' | 'list') || 'grid');
  const [q, setQ] = useState('');
  const [collectionModal, setCollectionModal] = useState<{ id?: string; name: string } | null>(null);
  const desk = useDesktop();

  useEffect(() => localStorage.setItem('gs-lib-sort', sort), [sort]);
  useEffect(() => localStorage.setItem('gs-lib-layout', layout), [layout]);

  const query = {
    sort,
    q: q || undefined,
    favorites: view === 'favorites' || undefined,
    hidden: view === 'hidden' || undefined,
    collection: !['all', 'favorites', 'hidden', 'installed'].includes(view) ? view : undefined,
  };
  const entries = useQuery({ queryKey: ['library', query], queryFn: () => api.library.list(query) });
  const collections = useQuery({ queryKey: ['library', 'collections'], queryFn: () => api.library.collections() });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['library'] });

  const saveCollection = useMutation({
    mutationFn: async (c: { id?: string; name: string }) => (c.id ? api.library.renameCollection(c.id, c.name) : api.library.createCollection(c.name)),
    onSuccess: () => {
      setCollectionModal(null);
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const totalPlaytime = (entries.data ?? []).reduce((s, e) => s + e.playtimeSeconds, 0);
  const activeCollection = collections.data?.find((c) => c.id === view);

  const sideItem = (id: string, label: React.ReactNode, icon: React.ReactNode, count?: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setParams(id === 'all' ? {} : { view: id })}
      className={clsx('flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm', view === id ? 'bg-accent/15 text-accent' : 'hover:bg-surface-2')}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-xs text-muted">{count}</span>}
    </button>
  );

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
      <aside className="space-y-1">
        <h1 className="mb-3 text-2xl font-bold">{t('library.title')}</h1>
        {sideItem('all', t('library.all'), <Gamepad2 className="size-4" />)}
        {sideItem('favorites', t('library.favorites'), <Star className="size-4" />)}
        {sideItem('hidden', t('library.hidden'), <EyeOff className="size-4" />)}
        {desk && sideItem('installed', t('desktop.installedTab'), <HardDrive className="size-4" />, desk.installed.length)}
        <div className="flex items-center justify-between pt-4 pb-1">
          <span className="px-3 text-xs font-semibold uppercase text-muted">{t('library.collections')}</span>
          <button type="button" className="rounded p-1 text-muted hover:text-fg" onClick={() => setCollectionModal({ name: '' })} aria-label={t('library.newCollection')}>
            <FolderPlus className="size-4" />
          </button>
        </div>
        {collections.data?.map((c) => sideItem(c.id, c.name, <Folder className="size-4" />, c.gameIds.length))}
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('library.filter')} className="max-w-xs" />
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-auto">
            <option value="title">{t('library.sortTitle')}</option>
            <option value="lastPlayed">{t('library.sortLastPlayed')}</option>
            <option value="playtime">{t('library.sortPlaytime')}</option>
            <option value="added">{t('library.sortAdded')}</option>
          </Select>
          <div className="flex rounded-md border border-border">
            <button type="button" onClick={() => setLayout('grid')} className={clsx('p-2', layout === 'grid' && 'bg-surface-2 text-accent')} aria-label={t('library.gridView')}>
              <LayoutGrid className="size-4" />
            </button>
            <button type="button" onClick={() => setLayout('list')} className={clsx('p-2', layout === 'list' && 'bg-surface-2 text-accent')} aria-label={t('library.listView')}>
              <List className="size-4" />
            </button>
          </div>
          {activeCollection && (
            <div className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setCollectionModal({ id: activeCollection.id, name: activeCollection.name })}>
                {t('library.renameCollection')}
              </Button>
              <ConfirmButton
                size="sm"
                onConfirm={async () => {
                  await api.library.deleteCollection(activeCollection.id);
                  setParams({});
                  refresh();
                }}
              >
                {t('library.deleteCollection')}
              </ConfirmButton>
            </div>
          )}
        </div>
        {!!entries.data?.length && <p className="text-sm text-muted">{t('library.totalPlaytime', { time: formatPlaytime(totalPlaytime) })}</p>}

        {desk && view === 'installed' ? (
          <InstalledList />
        ) : entries.isLoading ? (
          <PageLoader />
        ) : entries.error ? (
          <ErrorState error={entries.error} onRetry={() => entries.refetch()} />
        ) : entries.data!.length === 0 ? (
          <EmptyState icon={<Gamepad2 className="size-8" />} title={t('library.empty')}>
            <Link to="/search" className="text-accent hover:underline">
              {t('library.emptyHint')}
            </Link>
          </EmptyState>
        ) : layout === 'grid' ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {entries.data!.map((e) => (
              <div key={e.game.id} className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
                <Link to={`/game/${e.game.slug}`} className="relative">
                  <GameCover game={e.game} />
                  {e.favorite && <Star className="absolute top-2 right-2 size-5 fill-warning text-warning drop-shadow" />}
                </Link>
                <div className="flex items-start gap-1 p-2">
                  <div className="min-w-0 flex-1">
                    <Link to={`/game/${e.game.slug}`} className="line-clamp-1 text-sm font-semibold hover:text-accent">
                      {e.game.title}
                    </Link>
                    <p className="text-xs text-muted">{e.playtimeSeconds > 0 ? formatPlaytime(e.playtimeSeconds) : t('library.neverPlayed')}</p>
                    {desk && <LibraryPlayButton gameId={e.game.id} slug={e.game.slug} />}
                  </div>
                  <EntryMenu entry={e} collections={collections.data ?? []} onChange={refresh} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {entries.data!.map((e) => (
              <li key={e.game.id} className="flex items-center gap-3 p-2">
                <Link to={`/game/${e.game.slug}`} className="w-24 shrink-0">
                  <GameCover game={e.game} landscape className="rounded" />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link to={`/game/${e.game.slug}`} className="flex items-center gap-1 font-semibold hover:text-accent">
                    {e.favorite && <Star className="size-4 fill-warning text-warning" />}
                    <span className="truncate">{e.game.title}</span>
                  </Link>
                  <p className="text-xs text-muted">
                    {e.lastPlayedAt ? t('library.lastPlayed', { date: formatDate(e.lastPlayedAt) }) : t('library.neverPlayed')}
                  </p>
                </div>
                {desk && <LibraryPlayButton gameId={e.game.id} slug={e.game.slug} />}
                <PlatformIcons platforms={e.game.platforms} className="hidden sm:inline-flex" />
                <span className="w-20 text-right text-sm text-muted">{formatPlaytime(e.playtimeSeconds)}</span>
                <EntryMenu entry={e} collections={collections.data ?? []} onChange={refresh} />
              </li>
            ))}
          </ul>
        )}
        {!desk && <p className="text-xs text-muted">{t('library.clientHint')}</p>}
      </section>

      <Modal open={!!collectionModal} onClose={() => setCollectionModal(null)} title={collectionModal?.id ? t('library.renameCollection') : t('library.newCollection')}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (collectionModal?.name.trim()) saveCollection.mutate(collectionModal);
          }}
        >
          <Input
            autoFocus
            value={collectionModal?.name ?? ''}
            onChange={(e) => setCollectionModal((c) => c && { ...c, name: e.target.value })}
            placeholder={t('library.collectionName')}
            maxLength={64}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCollectionModal(null)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" loading={saveCollection.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
