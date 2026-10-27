import { ArrowUpCircle, Download, HardDrive, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { InstalledGame } from '@gameserver/shared';
import { GameCover } from '../components/GameCard';
import { Badge, Button, EmptyState } from '../components/ui';
import { formatBytes, formatDate, formatPlaytime } from '../lib/format';
import { toast } from '../lib/toast';
import { desktop, desktopError } from './bridge';
import { activeDownloads, useDesktopRequired } from './DesktopProvider';
import { ManageGameModal } from './GameInstallPanel';

/** Kompakter Spielen/Installieren-Knopf für Bibliothekseinträge im Desktop-Client. */
export function LibraryPlayButton({ gameId, slug }: { gameId: string; slug: string }) {
  const { t } = useTranslation();
  const { installedById, running, downloads, play } = useDesktopRequired();
  const installed = installedById.get(gameId);
  const job = activeDownloads(downloads).find((d) => d.gameId === gameId);
  if (job) {
    const pct = job.totalBytes ? Math.round((job.downloadedBytes / job.totalBytes) * 100) : 0;
    return (
      <Link to="/downloads" className="text-xs text-accent">
        {t(`desktop.states.${job.state}`)} {pct}%
      </Link>
    );
  }
  if (!installed) {
    return (
      <Link to={`/game/${slug}`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent">
        <Download className="size-3" /> {t('desktop.install')}
      </Link>
    );
  }
  if (running.has(gameId)) {
    return (
      <button type="button" className="inline-flex items-center gap-1 text-xs text-danger" onClick={() => void desktop.stopGame(gameId)}>
        <Square className="size-3" /> {t('desktop.stop')}
      </button>
    );
  }
  return (
    <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-success hover:brightness-110" onClick={() => void play(gameId)}>
      <Play className="size-3" /> {t('desktop.play')}
      {installed.updateAvailable && <ArrowUpCircle className="size-3 text-accent" />}
    </button>
  );
}

/** Liste aller lokal installierten Spiele (auch offline verfügbar). */
export function InstalledList() {
  const { t } = useTranslation();
  const { installed, running, play } = useDesktopRequired();
  const [manage, setManage] = useState<InstalledGame | null>(null);
  if (installed.length === 0) return <EmptyState icon={<HardDrive className="size-8" />} title={t('library.empty')} />;
  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {installed.map((g) => (
          <li key={g.gameId} className="flex flex-wrap items-center gap-3 p-2">
            <Link to={`/game/${g.slug}`} className="w-24 shrink-0">
              <GameCover game={{ title: g.title, coverUrl: g.coverUrl, headerUrl: g.headerUrl }} landscape className="rounded" />
            </Link>
            <div className="min-w-0 flex-1">
              <Link to={`/game/${g.slug}`} className="font-semibold hover:text-accent">
                {g.title}
              </Link>
              <p className="text-xs text-muted">
                {t('desktop.version')} {g.version} · {formatBytes(g.sizeOnDisk)}
                {g.lastPlayedAt && ` · ${t('library.lastPlayed', { date: formatDate(g.lastPlayedAt) })}`}
                {g.localPlaytimeSeconds > 0 && ` · ${formatPlaytime(g.localPlaytimeSeconds)}`}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {g.updateAvailable && <Badge tone="accent">{t('desktop.updateAvailable', { version: g.updateAvailable.version })}</Badge>}
                {g.pinnedVersionId && <Badge tone="warning">{t('desktop.pinned')}</Badge>}
              </div>
            </div>
            {g.updateAvailable && (
              <Button size="sm" icon={<ArrowUpCircle className="size-4" />} onClick={() => void desktop.updateGame(g.gameId).catch((e) => toast.error(desktopError(e)))}>
                {t('desktop.update')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setManage(g)}>
              {t('desktop.manage')}
            </Button>
            {running.has(g.gameId) ? (
              <Button size="sm" variant="danger" icon={<Square className="size-4" />} onClick={() => void desktop.stopGame(g.gameId)}>
                {t('desktop.stop')}
              </Button>
            ) : (
              <Button size="sm" variant="success" icon={<Play className="size-4" />} onClick={() => void play(g.gameId)}>
                {t('desktop.play')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {manage && <ManageGameModal installed={manage} onClose={() => setManage(null)} />}
    </>
  );
}
