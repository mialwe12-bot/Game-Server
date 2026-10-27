import { useMutation } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { METADATA_FIELDS, type ManagedGame, type MetadataField, type MetadataProvider, type MetadataSearchResult } from '@gameserver/shared';
import { Button, Card, EmptyState, Input, Select } from '../../../components/ui';
import { api, errorMessage } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { toast } from '../../../lib/toast';

export function MetadataTab({ game, onSaved }: { game: ManagedGame; onSaved: (g: ManagedGame) => void }) {
  const { t } = useTranslation();
  const { settings } = useAuth();
  const available = (['igdb', 'rawg'] as MetadataProvider[]).filter((p) => settings?.metadataProviders[p]);
  const [provider, setProvider] = useState<MetadataProvider>(available[0] ?? 'rawg');
  const [q, setQ] = useState(game.title);
  const [selected, setSelected] = useState<MetadataSearchResult | null>(null);
  const [fields, setFields] = useState<Set<MetadataField>>(new Set(METADATA_FIELDS));

  const search = useMutation({ mutationFn: () => api.manage.metadataSearch(provider, q), onError: (e) => toast.error(errorMessage(e)) });
  const importIt = useMutation({
    mutationFn: () => api.manage.metadataImport(game.id, selected!.provider, selected!.externalId, [...fields]),
    onSuccess: (g) => {
      onSaved(g);
      toast.success(t('admin.metadata.imported'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (available.length === 0) return <EmptyState title={t('admin.metadata.notConfigured')} />;

  return (
    <div className="space-y-6">
      <Card>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSelected(null);
            search.mutate();
          }}
        >
          <Select value={provider} onChange={(e) => setProvider(e.target.value as MetadataProvider)} className="w-auto" aria-label={t('admin.metadata.provider')}>
            {available.map((p) => (
              <option key={p} value={p}>
                {p.toUpperCase()}
              </option>
            ))}
          </Select>
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="min-w-60 flex-1" required />
          <Button type="submit" variant="primary" icon={<Search className="size-4" />} loading={search.isPending}>
            {t('admin.metadata.search')}
          </Button>
        </form>
        {search.data && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {search.data.map((r) => (
              <button
                key={`${r.provider}-${r.externalId}`}
                type="button"
                onClick={() => setSelected(r)}
                className={`overflow-hidden rounded-md border text-left ${selected?.externalId === r.externalId ? 'border-accent ring-2 ring-accent' : 'border-border hover:border-accent/60'}`}
              >
                <div className="aspect-video bg-surface-2">{r.coverUrl && <img src={r.coverUrl} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" />}</div>
                <div className="p-2 text-sm">
                  <p className="line-clamp-1 font-semibold">{r.title}</p>
                  <p className="text-xs text-muted">{r.releaseDate ?? '–'}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
      {selected && (
        <Card title={`${t('admin.metadata.fields')}: ${selected.title}`}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {METADATA_FIELDS.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={fields.has(f)}
                  onChange={(e) => {
                    const next = new Set(fields);
                    if (e.target.checked) next.add(f);
                    else next.delete(f);
                    setFields(next);
                  }}
                />
                {t(`admin.metadata.field.${f}`)}
              </label>
            ))}
          </div>
          <Button className="mt-4" variant="primary" loading={importIt.isPending} disabled={fields.size === 0} onClick={() => importIt.mutate()}>
            {t('admin.metadata.import')}
          </Button>
        </Card>
      )}
    </div>
  );
}
