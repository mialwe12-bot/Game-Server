import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, FolderOpen, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalScreenshot } from '@gameserver/shared';
import { Button, ConfirmButton, EmptyState, Input, Modal, Select, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatBytes, formatDateTime } from '../lib/format';
import { toast } from '../lib/toast';
import { DESKTOP_EVENTS } from '@gameserver/shared';
import { desktop, desktopError } from './bridge';
import { useDesktopRequired } from './DesktopProvider';

/** Lädt die PNG-Bytes eines lokalen Screenshots als Objekt-URL */
function useLocalImage(path: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    let alive = true;
    void desktop
      .readScreenshot(path)
      .then((buf) => {
        if (!alive) return;
        revoke = URL.createObjectURL(new Blob([buf], { type: 'image/png' }));
        setUrl(revoke);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [path]);
  return url;
}

function Thumb({ shot, onOpen }: { shot: LocalScreenshot; onOpen: () => void }) {
  const url = useLocalImage(shot.path);
  return (
    <button type="button" onClick={onOpen} className="group overflow-hidden rounded-lg border border-border bg-surface text-left hover:border-accent">
      <div className="aspect-video bg-surface-2">{url && <img src={url} alt="" className="size-full object-cover" />}</div>
      <p className="truncate px-2 py-1 text-xs text-muted">
        {shot.gameTitle ?? '—'} · {formatDateTime(shot.takenAt)}
      </p>
    </button>
  );
}

/** Screenshot-Raster (auch im Overlay verwendet) */
export function ScreenshotGrid({ filterGameId = null }: { filterGameId?: string | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const shots = useQuery({ queryKey: ['screenshots'], queryFn: () => desktop.listScreenshots() });
  const [open, setOpen] = useState<LocalScreenshot | null>(null);
  useEffect(() => {
    const un = desktop.on(DESKTOP_EVENTS.screenshot, () => void qc.invalidateQueries({ queryKey: ['screenshots'] }));
    return () => void un.then((f) => f());
  }, [qc]);
  if (shots.isLoading) return <Spinner />;
  const list = (shots.data ?? []).filter((s) => !filterGameId || s.gameId === filterGameId);
  return (
    <>
      {list.length ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {list.map((s) => (
            <Thumb key={s.path} shot={s} onOpen={() => setOpen(s)} />
          ))}
        </div>
      ) : (
        <EmptyState title={t('screenshots.empty')} />
      )}
      {open && <ScreenshotModal shot={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ScreenshotModal({ shot, onClose }: { shot: LocalScreenshot; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const desk = useDesktopRequired();
  const url = useLocalImage(shot.path);
  const [title, setTitle] = useState('');
  const [gameId, setGameId] = useState(shot.gameId ?? '');
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    setBusy(true);
    try {
      const buf = await desktop.readScreenshot(shot.path);
      const item = await api.community.uploadImage(gameId, new Blob([buf], { type: 'image/png' }), { type: 'SCREENSHOT', title });
      toast.success(t('screenshots.uploaded'));
      onClose();
      window.location.hash = `#/community/items/${item.id}`;
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={shot.gameTitle ?? t('screenshots.title')} wide>
      <div className="space-y-3">
        {url && <img src={url} alt="" className="max-h-[60vh] w-full rounded object-contain" />}
        <p className="text-xs text-muted">
          {formatDateTime(shot.takenAt)} · {shot.width}×{shot.height} · {formatBytes(shot.size)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Select className="w-auto" value={gameId} onChange={(e) => setGameId(e.target.value)}>
            <option value="">{t('screenshots.pickGame')}</option>
            {desk.installed.map((g) => (
              <option key={g.gameId} value={g.gameId}>
                {g.title}
              </option>
            ))}
          </Select>
          <Input className="w-auto flex-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('social.community.titlePlaceholder')} maxLength={160} />
          <Button variant="primary" icon={<Upload className="size-4" />} disabled={!gameId} loading={busy} onClick={() => void upload()}>
            {t('screenshots.upload')}
          </Button>
          <ConfirmButton
            icon={<Trash2 className="size-4" />}
            onConfirm={async () => {
              try {
                await desktop.deleteScreenshot(shot.path);
                void qc.invalidateQueries({ queryKey: ['screenshots'] });
                onClose();
              } catch (e) {
                toast.error(desktopError(e));
              }
            }}
          >
            {t('common.delete')}
          </ConfirmButton>
        </div>
      </div>
    </Modal>
  );
}

/** Screenshot-Manager (Desktop-Client) */
export default function ScreenshotsPage() {
  const { t } = useTranslation();
  const desk = useDesktopRequired();
  const qc = useQueryClient();
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-2xl font-bold">{t('screenshots.title')}</h1>
        <Button
          icon={<Camera className="size-4" />}
          onClick={async () => {
            try {
              await desktop.takeScreenshot();
              void qc.invalidateQueries({ queryKey: ['screenshots'] });
            } catch (e) {
              toast.error(desktopError(e));
            }
          }}
        >
          {t('screenshots.take')}
        </Button>
        <Button icon={<FolderOpen className="size-4" />} onClick={() => void desktop.openScreenshotFolder()}>
          {t('screenshots.openFolder')}
        </Button>
      </div>
      <p className="text-sm text-muted">{t('screenshots.hint', { key: desk.config.screenshotHotkey })}</p>
      <ScreenshotGrid />
    </div>
  );
}
