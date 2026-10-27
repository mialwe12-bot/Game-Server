import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, EyeOff, Package, Plus, ThumbsUp, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import type { GameDetail, WorkshopItemDto, WorkshopKind } from '@gameserver/shared';
import { Badge, Button, EmptyState, Field, Input, Modal, Pagination, Select, Spinner, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast } from '../../lib/toast';

export function WorkshopCard({ item }: { item: WorkshopItemDto }) {
  const { t } = useTranslation();
  return (
    <Link to={`/workshop/${item.id}`} className="group overflow-hidden rounded-lg border border-border bg-surface transition hover:border-accent">
      <div className="relative aspect-video bg-surface-2">
        {item.previewUrl ? (
          <img src={api.url(item.previewUrl)} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <Package className="absolute inset-0 m-auto size-10 text-muted" />
        )}
        <Badge className="absolute top-2 left-2">{t(`workshop.kinds.${item.kind}`)}</Badge>
        {item.hidden && (
          <Badge tone="warning" className="absolute top-2 right-2">
            <EyeOff className="mr-1 inline size-3" />
            {t('workshop.hiddenBadge')}
          </Badge>
        )}
      </div>
      <div className="space-y-1 p-3">
        <p className="truncate font-semibold group-hover:text-accent">{item.title}</p>
        <p className="truncate text-xs text-muted">
          {item.author?.displayName || item.author?.username || '—'} · {item.latestVersion ? `v${item.latestVersion.version}` : t('workshop.noVersion')}
        </p>
        <p className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1">
            <ThumbsUp className="size-3.5" />
            {item.up - item.down}
          </span>
          <span className="flex items-center gap-1">
            <Users className="size-3.5" />
            {item.subscribers}
          </span>
          {item.subscribed && <span className={clsx('flex items-center gap-1 text-success')}><Download className="size-3.5" />{t('workshop.subscribed')}</span>}
        </p>
      </div>
    </Link>
  );
}

/** Tab „Workshop“ auf der Spieleseite */
export function WorkshopTab({ game }: { game: GameDetail }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<WorkshopKind | ''>('');
  const [sort, setSort] = useState<'popular' | 'recent' | 'rating'>('popular');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', kind: 'MOD' as WorkshopKind, tags: '' });
  const list = useQuery({
    queryKey: ['workshop', game.id, query, kind, sort, page],
    queryFn: () => api.workshop.list(game.id, { q: query || undefined, kind: kind || undefined, sort, page, pageSize: 24 }),
  });
  const create = useMutation({
    mutationFn: () =>
      api.workshop.create(game.id, {
        title: form.title,
        description: form.description,
        kind: form.kind,
        tags: form.tags
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      }),
    onSuccess: (item) => navigate(`/workshop/${item.id}`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (list.isLoading) return <Spinner />;
  if (list.data && !list.data.enabled) return <EmptyState title={t('workshop.notEnabled')} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
            setPage(1);
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('workshop.search')} />
          <Button type="submit">{t('common.search')}</Button>
        </form>
        <Select className="w-auto" value={kind} onChange={(e) => (setKind(e.target.value as WorkshopKind | ''), setPage(1))}>
          <option value="">{t('common.all')}</option>
          {(['MOD', 'MAP', 'OTHER'] as const).map((k) => (
            <option key={k} value={k}>
              {t(`workshop.kinds.${k}`)}
            </option>
          ))}
        </Select>
        <Select className="w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="popular">{t('workshop.sort.popular')}</option>
          <option value="rating">{t('workshop.sort.rating')}</option>
          <option value="recent">{t('workshop.sort.recent')}</option>
        </Select>
        {user && (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t('workshop.publish')}
          </Button>
        )}
      </div>
      {list.data?.items.length ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {list.data.items.map((i) => (
              <WorkshopCard key={i.id} item={i} />
            ))}
          </div>
          <Pagination page={page} pageSize={24} total={list.data.total} onChange={setPage} />
        </>
      ) : (
        <EmptyState title={t('workshop.empty')} />
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title={t('workshop.publish')} wide>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label={t('workshop.title')}>
            <Input required minLength={2} maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('workshop.kind')}>
              <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as WorkshopKind })}>
                {(['MOD', 'MAP', 'OTHER'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`workshop.kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('workshop.tags')}>
              <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="koop, pvp" />
            </Field>
          </div>
          <Field label={t('workshop.description')} hint={t('common.markdownHint')}>
            <Textarea rows={8} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <p className="text-xs text-muted">{t('workshop.publishHint')}</p>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={create.isPending}>
              {t('common.create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
