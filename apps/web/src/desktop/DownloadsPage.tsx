import clsx from 'clsx';
import { ArrowDown, ArrowUp, Download, Pause, Play, RotateCcw, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { formatDuration, type DownloadJob } from '@gameserver/shared';
import { GameCover } from '../components/GameCard';
import { Badge, Button, EmptyState, ProgressBar } from '../components/ui';
import { formatBytes } from '../lib/format';
import { desktop } from './bridge';
import { activeDownloads, useDesktopRequired } from './DesktopProvider';

function JobRow({ job, index, count }: { job: DownloadJob; index: number; count: number }) {
  const { t } = useTranslation();
  const { installedById } = useDesktopRequired();
  const ratio = job.totalBytes ? job.downloadedBytes / job.totalBytes : job.state === 'completed' ? 1 : 0;
  const eta = job.speed > 0 ? (job.totalBytes - job.downloadedBytes) / job.speed : NaN;
  const active = ['downloading', 'verifying', 'extracting', 'installing'].includes(job.state);
  const finished = ['completed', 'failed', 'cancelled'].includes(job.state);
  const slug = installedById.get(job.gameId)?.slug ?? job.gameId;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center">
      <Link to={`/game/${slug}`} className="w-full shrink-0 sm:w-40">
        <GameCover game={{ title: job.title, coverUrl: job.coverUrl, headerUrl: job.coverUrl }} landscape className="rounded" />
      </Link>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{job.title}</span>
          <Badge>{t(`desktop.kinds.${job.kind}`)}</Badge>
          <span className="text-xs text-muted">
            {t('desktop.version')} {job.version}
          </span>
        </div>
        <ProgressBar value={ratio} className={clsx(job.state === 'failed' && '[&>div]:bg-danger', job.state === 'completed' && '[&>div]:bg-success')} />
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
          <span className={clsx(job.state === 'failed' && 'text-danger')}>
            {t(`desktop.states.${job.state}`)}
            {job.totalBytes > 0 && ` · ${formatBytes(job.downloadedBytes)} / ${formatBytes(job.totalBytes)}`}
            {job.filesTotal > 1 && ` · ${t('desktop.filesProgress', { done: job.filesDone, total: job.filesTotal })}`}
          </span>
          {active && job.speed > 0 && (
            <span>
              {formatBytes(job.speed)}/s · {formatDuration(eta)}
            </span>
          )}
        </div>
        {job.error && <p className="text-xs text-danger">{job.error}</p>}
      </div>
      <div className="flex shrink-0 gap-1">
        {!finished && (
          <>
            <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => void desktop.reorderDownload(job.id, -1)} aria-label={t('desktop.moveUp')}>
              <ArrowUp className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" disabled={index === count - 1} onClick={() => void desktop.reorderDownload(job.id, 1)} aria-label={t('desktop.moveDown')}>
              <ArrowDown className="size-4" />
            </Button>
          </>
        )}
        {job.state === 'paused' && (
          <Button size="sm" onClick={() => void desktop.resumeDownload(job.id)} icon={<Play className="size-4" />}>
            {t('admin.uploads.resume')}
          </Button>
        )}
        {job.state === 'failed' && (
          <Button size="sm" onClick={() => void desktop.resumeDownload(job.id)} icon={<RotateCcw className="size-4" />}>
            {t('common.retry')}
          </Button>
        )}
        {!finished && job.state !== 'paused' && (
          <Button size="sm" onClick={() => void desktop.pauseDownload(job.id)} icon={<Pause className="size-4" />}>
            {t('admin.uploads.pause')}
          </Button>
        )}
        {!finished ? (
          <Button size="sm" variant="ghost" onClick={() => void desktop.cancelDownload(job.id)} aria-label={t('common.cancel')}>
            <X className="size-4" />
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => void desktop.cancelDownload(job.id)} aria-label={t('common.remove')}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </li>
  );
}

export default function DownloadsPage() {
  const { t } = useTranslation();
  const { downloads, config } = useDesktopRequired();
  const open = activeDownloads(downloads);
  const finished = downloads.filter((d) => !open.includes(d));
  const totalSpeed = open.reduce((s, j) => s + j.speed, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto flex items-center gap-2 text-2xl font-bold">
          <Download className="size-6" /> {t('desktop.downloads')}
          {totalSpeed > 0 && <span className="text-base font-normal text-muted">{formatBytes(totalSpeed)}/s</span>}
        </h1>
        <Button size="sm" onClick={() => void desktop.pauseAll()} icon={<Pause className="size-4" />}>
          {t('desktop.pauseAll')}
        </Button>
        <Button size="sm" onClick={() => void desktop.resumeAll()} icon={<Play className="size-4" />}>
          {t('desktop.resumeAll')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void desktop.clearFinished()}>
          {t('desktop.clearFinished')}
        </Button>
      </div>
      {(config.schedule.enabled || config.bandwidthLimitKbps > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {config.schedule.enabled && (
            <Badge tone="warning">{t('desktop.scheduleActive', { start: config.schedule.startHour, end: config.schedule.endHour })}</Badge>
          )}
          {config.bandwidthLimitKbps > 0 && <Badge tone="warning">{t('desktop.bandwidthActive', { limit: formatBytes(config.bandwidthLimitKbps * 1024) })}</Badge>}
        </div>
      )}
      {downloads.length === 0 ? (
        <EmptyState icon={<Download className="size-8" />} title={t('desktop.noDownloads')} />
      ) : (
        <ul className="space-y-3">
          {open.map((j, i) => (
            <JobRow key={j.id} job={j} index={i} count={open.length} />
          ))}
          {finished.map((j) => (
            <JobRow key={j.id} job={j} index={0} count={1} />
          ))}
        </ul>
      )}
    </div>
  );
}
