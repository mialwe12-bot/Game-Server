import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, Download, History, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, ConfirmButton, EmptyState, ErrorState, PageLoader, ProgressBar, Spinner } from '../../components/ui';
import { isDesktop } from '../../desktop/bridge';
import { api, errorMessage } from '../../lib/api';
import { formatBytes, formatDateTime } from '../../lib/format';
import { toast } from '../../lib/toast';

/** Übersicht der Cloud-Saves mit Versionen, Wiederherstellen und Löschen */
export default function CloudPage() {
  const { t } = useTranslation();
  const list = useQuery({ queryKey: ['cloud'], queryFn: () => api.cloud.list() });
  const [open, setOpen] = useState<string | null>(null);
  if (list.isLoading) return <PageLoader />;
  if (list.error) return <ErrorState error={list.error} />;
  const items = list.data!;
  const total = items.reduce((s, i) => s + i.totalBytes, 0);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <Cloud className="size-6" />
        {t('cloud.title')}
      </h1>
      <p className="text-sm text-muted">{t(isDesktop ? 'cloud.hintDesktop' : 'cloud.hintWeb')}</p>
      {items.length === 0 ? (
        <EmptyState title={t('cloud.empty')} />
      ) : (
        <>
          <p className="text-sm">{t('cloud.total', { size: formatBytes(total), games: items.length })}</p>
          {items.map((i) => (
            <Card
              key={i.game.id}
              title={
                <Link to={`/game/${i.game.slug}`} className="hover:text-accent">
                  {i.game.title}
                </Link>
              }
              actions={
                <Button size="sm" icon={<History className="size-4" />} onClick={() => setOpen(open === i.game.id ? null : i.game.id)}>
                  {t('cloud.versions', { count: i.versions })}
                </Button>
              }
            >
              <p className="text-sm text-muted">
                {t('cloud.latest', { version: i.latest.version, date: formatDateTime(i.latest.createdAt) })}
                {i.latest.deviceName && ` · ${i.latest.deviceName}`} · {formatBytes(i.totalBytes)}
              </p>
              {open === i.game.id && <Versions gameId={i.game.id} />}
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

function Versions({ gameId }: { gameId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['cloud', gameId], queryFn: () => api.cloud.status(gameId) });
  if (status.isLoading) return <Spinner />;
  const s = status.data!;
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast.success(msg);
      void qc.invalidateQueries({ queryKey: ['cloud'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="mt-3 space-y-3">
      {s.quotaBytes > 0 && (
        <div>
          <p className="mb-1 text-xs text-muted">{t('cloud.quota', { used: formatBytes(s.usedBytes), quota: formatBytes(s.quotaBytes) })}</p>
          <ProgressBar value={s.usedBytes / s.quotaBytes} />
        </div>
      )}
      {s.latest && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">{t('cloud.files', { count: s.latest.manifest.length })}</summary>
          <ul className="mt-1 max-h-48 overflow-auto font-mono">
            {s.latest.manifest.map((f) => (
              <li key={`${f.root}:${f.path}`}>
                {s.savePaths[f.root]?.path ?? `#${f.root}`}/{f.path} <span className="text-muted">({formatBytes(f.size)})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <ul className="divide-y divide-border">
        {s.versions.map((v, idx) => (
          <li key={v.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className="font-medium">v{v.version}</span>
            {idx === 0 && <Badge tone="success">{t('cloud.current')}</Badge>}
            <span className="flex-1 text-muted">
              {formatDateTime(v.createdAt)}
              {v.deviceName && ` · ${v.deviceName}`} · {t('cloud.fileCount', { count: v.fileCount })} · {formatBytes(v.size)}
            </span>
            <a href={api.cloud.downloadUrl(gameId, v.version)} className="inline-flex items-center gap-1 text-xs text-accent hover:underline" download>
              <Download className="size-3.5" />
              ZIP
            </a>
            {idx > 0 && (
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => void run(() => api.cloud.restore(gameId, v.version), t('cloud.restored'))}>
                {t('cloud.restore')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmButton size="sm" icon={<Trash2 className="size-4" />} onConfirm={() => void run(() => api.cloud.remove(gameId), t('cloud.deleted'))}>
        {t('cloud.deleteAll')}
      </ConfirmButton>
    </div>
  );
}
