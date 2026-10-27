import { useQueryClient } from '@tanstack/react-query';
import { Play, RefreshCw, Square, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GameCover } from '../components/GameCard';
import { Button, EmptyState } from '../components/ui';
import { formatPlaytime } from '../lib/format';
import { desktop } from './bridge';
import { useDesktopRequired } from './DesktopProvider';

/** Wird angezeigt, wenn der Server nicht erreichbar ist: installierte Spiele bleiben spielbar. */
export default function OfflinePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { installed, running, play } = useDesktopRequired();
  const [pending, setPending] = useState(0);
  useEffect(() => {
    void desktop.pendingPlaytime().then(setPending);
  }, [running]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/50 bg-warning/10 p-4">
        <WifiOff className="size-6 text-warning" />
        <div className="flex-1">
          <h1 className="font-semibold">{t('desktop.offlineTitle')}</h1>
          <p className="text-sm text-muted">{t('desktop.offlineText')}</p>
          {pending > 0 && <p className="text-xs text-muted">{t('desktop.pendingPlaytime', { time: formatPlaytime(pending) })}</p>}
        </div>
        <Button icon={<RefreshCw className="size-4" />} onClick={() => void qc.invalidateQueries()}>
          {t('desktop.retry')}
        </Button>
      </div>
      {installed.length === 0 ? (
        <EmptyState title={t('library.empty')} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {installed.map((g) => {
            const isRunning = running.has(g.gameId);
            return (
              <div key={g.gameId} className="overflow-hidden rounded-lg border border-border bg-surface">
                <GameCover game={{ title: g.title, coverUrl: null, headerUrl: null }} />
                <div className="space-y-2 p-2">
                  <p className="line-clamp-1 text-sm font-semibold">{g.title}</p>
                  {isRunning ? (
                    <Button size="sm" variant="danger" className="w-full" icon={<Square className="size-4" />} onClick={() => void desktop.stopGame(g.gameId)}>
                      {t('desktop.stop')}
                    </Button>
                  ) : (
                    <Button size="sm" variant="success" className="w-full" icon={<Play className="size-4" />} onClick={() => void play(g.gameId)}>
                      {t('desktop.play')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
