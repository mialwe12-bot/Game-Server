import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Filter, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { PLATFORMS, type Platform, type StoreSort } from '@gameserver/shared';
import { GameGrid } from '../../components/GameCard';
import { PlatformIcon } from '../../components/PlatformIcons';
import { Button, EmptyState, ErrorState, Input, Pagination, Select, Spinner } from '../../components/ui';
import { api } from '../../lib/api';

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

export default function SearchPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const genres = list(params.get('genres'));
  const tags = list(params.get('tags'));
  const platforms = list(params.get('platforms')) as Platform[];
  const sort = (params.get('sort') as StoreSort) || 'relevance';
  const page = Number(params.get('page') ?? 1);
  const [text, setText] = useState(q);
  const [showFilters, setShowFilters] = useState(false);
  useEffect(() => setText(q), [q]);

  const update = (patch: Record<string, string | string[] | number | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      const value = Array.isArray(v) ? v.join(',') : v === null ? '' : String(v);
      if (value) next.set(k, value);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  // Suche verzögert beim Tippen
  useEffect(() => {
    if (text === q) return;
    const timer = setTimeout(() => update({ q: text }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const facets = useQuery({ queryKey: ['facets'], queryFn: () => api.store.facets(), staleTime: 300_000 });
  const results = useQuery({
    queryKey: ['search', q, genres, tags, platforms, sort, page],
    queryFn: ({ signal }) => api.store.search({ q, genres, tags, platforms, sort, page, pageSize: 24 }, signal),
    placeholderData: keepPreviousData,
  });

  const toggle = (key: 'genres' | 'tags' | 'platforms', current: string[], value: string) =>
    update({ [key]: current.includes(value) ? current.filter((x) => x !== value) : [...current, value] });

  const chip = (active: boolean) =>
    clsx('rounded-full border px-3 py-1 text-xs transition', active ? 'border-accent bg-accent/15 text-accent' : 'border-border hover:border-accent/60');

  const filters = (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">{t('store.platforms')}</h3>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button key={p} type="button" className={chip(platforms.includes(p))} onClick={() => toggle('platforms', platforms, p)}>
              <span className="inline-flex items-center gap-1">
                <PlatformIcon platform={p} className="size-3" /> {t(`platforms.${p}`)}
              </span>
            </button>
          ))}
        </div>
      </div>
      {!!facets.data?.genres.length && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t('store.genres')}</h3>
          <div className="flex flex-wrap gap-2">
            {facets.data.genres.map((g) => (
              <button key={g.id} type="button" className={chip(genres.includes(g.slug))} onClick={() => toggle('genres', genres, g.slug)}>
                {g.name} <span className="text-muted">({g.count})</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {!!facets.data?.tags.length && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t('store.tags')}</h3>
          <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto">
            {facets.data.tags.map((g) => (
              <button key={g.id} type="button" className={chip(tags.includes(g.slug))} onClick={() => toggle('tags', tags, g.slug)}>
                {g.name} <span className="text-muted">({g.count})</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {(genres.length > 0 || tags.length > 0 || platforms.length > 0) && (
        <Button size="sm" variant="ghost" onClick={() => update({ genres: null, tags: null, platforms: null })}>
          {t('store.resetFilters')}
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('store.searchPlaceholder')} className="pl-9" autoFocus />
        </div>
        <Select value={sort} onChange={(e) => update({ sort: e.target.value })} className="w-auto" aria-label={t('store.sort')}>
          <option value="relevance">{t('store.sortRelevance')}</option>
          <option value="title">{t('store.sortTitle')}</option>
          <option value="release">{t('store.sortRelease')}</option>
          <option value="newest">{t('store.sortNewest')}</option>
          <option value="popular">{t('store.sortPopular')}</option>
        </Select>
        <Button className="lg:hidden" icon={<Filter className="size-4" />} onClick={() => setShowFilters((s) => !s)}>
          {t('store.filters')}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_260px]">
        <div className="order-2 space-y-4 lg:order-1">
          <div className="flex items-center gap-2 text-sm text-muted">
            {results.data && t('store.results', { count: results.data.total })}
            {results.isFetching && <Spinner className="size-4" />}
          </div>
          {results.error ? (
            <ErrorState error={results.error} onRetry={() => results.refetch()} />
          ) : results.data && results.data.items.length === 0 ? (
            <EmptyState title={t('store.noResults')} />
          ) : (
            results.data && (
              <>
                <GameGrid games={results.data.items} />
                <Pagination page={page} pageSize={24} total={results.data.total} onChange={(p) => update({ page: p })} />
              </>
            )
          )}
        </div>
        <aside className={clsx('order-1 rounded-lg border border-border bg-surface p-4 lg:order-2 lg:block', !showFilters && 'hidden')}>
          {filters}
        </aside>
      </div>
    </div>
  );
}
