import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '@gameserver/shared';
import { Button, ProgressBar } from '../../components/ui';
import { formatBytes } from '../../lib/format';
import { uploadQueue, useUploadQueue, type QueueItem } from '../../lib/uploads';

export function UploadRow({ item }: { item: QueueItem }) {
  const { t } = useTranslation();
  const p = item.progress;
  const ratio = p.total ? p.uploaded / p.total : 1;
  const eta = p.speed > 0 ? (p.total - p.uploaded) / p.speed : NaN;
  return (
    <div className="space-y-1 rounded-md border border-border bg-surface-2/40 p-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono" title={`${item.label} · ${item.path}`}>
          {item.path}
        </span>
        {p.state === 'uploading' && (
          <button type="button" onClick={() => uploadQueue.pause(item.key)} className="text-muted hover:text-fg" aria-label={t('admin.uploads.pause')}>
            <Pause className="size-3.5" />
          </button>
        )}
        {p.state === 'paused' && (
          <button type="button" onClick={() => uploadQueue.resume(item.key)} className="text-muted hover:text-fg" aria-label={t('admin.uploads.resume')}>
            <Play className="size-3.5" />
          </button>
        )}
        {p.state === 'failed' && (
          <button type="button" onClick={() => uploadQueue.resume(item.key)} className="text-muted hover:text-fg" aria-label={t('admin.uploads.retry')}>
            <RotateCcw className="size-3.5" />
          </button>
        )}
        {p.state !== 'completed' && (
          <button type="button" onClick={() => void uploadQueue.cancel(item.key)} className="text-muted hover:text-danger" aria-label={t('admin.uploads.cancel')}>
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <ProgressBar value={ratio} className={p.state === 'failed' ? '[&>div]:bg-danger' : p.state === 'completed' ? '[&>div]:bg-success' : ''} />
      <div className="flex justify-between gap-2 text-muted">
        <span>
          {t(`admin.uploads.states.${p.state}`)} · {formatBytes(p.uploaded)} / {formatBytes(p.total)}
        </span>
        {p.state === 'uploading' && p.speed > 0 && (
          <span>
            {t('admin.uploads.speed', { speed: formatBytes(p.speed) })} · {t('admin.uploads.eta', { time: formatDuration(eta) })}
          </span>
        )}
      </div>
      {p.error && <p className="text-danger">{p.error}</p>}
    </div>
  );
}

/** Kompakte Anzeige der globalen Upload-Warteschlange in der Admin-Seitenleiste. */
export function UploadQueuePanel() {
  const { t } = useTranslation();
  const items = useUploadQueue();
  if (items.length === 0) return null;
  const done = items.filter((i) => i.progress.state === 'completed').length;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {t('admin.uploads.queue')} ({done}/{items.length})
        </h2>
        <Button size="sm" variant="ghost" onClick={() => uploadQueue.clearDone()}>
          {t('admin.uploads.clearDone')}
        </Button>
      </div>
      <div className="max-h-96 space-y-2 overflow-y-auto">
        {items.map((i) => (
          <UploadRow key={i.key} item={i} />
        ))}
      </div>
      <p className="text-xs text-muted">{t('admin.uploads.resumeHint')}</p>
    </div>
  );
}
