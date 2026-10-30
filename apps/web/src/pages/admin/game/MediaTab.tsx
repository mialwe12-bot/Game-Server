import { ChevronLeft, ChevronRight, ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ManagedGame, MediaDto, MediaKind } from '@gameserver/shared';
import { Button, Card, Spinner } from '../../../components/ui';
import { api, errorMessage } from '../../../lib/api';
import { toast } from '../../../lib/toast';

function UploadButton({ gameId, kind, multiple, onDone }: { gameId: string; kind: MediaKind; multiple?: boolean; onDone: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) await api.manage.uploadMedia(gameId, kind, f);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files);
          e.target.value = '';
        }}
      />
      <Button size="sm" icon={busy ? <Spinner className="size-4" /> : <ImagePlus className="size-4" />} disabled={busy} onClick={() => ref.current?.click()}>
        {t('admin.media.upload')}
      </Button>
    </>
  );
}

function Single({ game, kind, label, onChange, aspect }: { game: ManagedGame; kind: MediaKind; label: string; onChange: () => void; aspect: string }) {
  const media = game.media.find((m) => m.kind === kind);
  return (
    <Card title={label} actions={<UploadButton gameId={game.id} kind={kind} onDone={onChange} />}>
      <div className={`relative overflow-hidden rounded-md bg-surface-2 ${aspect}`}>
        {media && (
          <>
            <img src={api.url(media.url)} alt="" className="absolute inset-0 size-full object-cover" />
            <button
              type="button"
              onClick={() => void api.manage.deleteMedia(game.id, media.id).then(onChange)}
              className="absolute top-2 right-2 rounded bg-black/60 p-1.5 text-white hover:bg-danger"
              aria-label="delete"
            >
              <Trash2 className="size-4" />
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

function Gallery({ game, kind, label, onChange }: { game: ManagedGame; kind: MediaKind; label: string; onChange: () => void }) {
  const { t } = useTranslation();
  const items = game.media.filter((m) => m.kind === kind).sort((a, b) => a.sortOrder - b.sortOrder);
  const move = async (list: MediaDto[], from: number, to: number) => {
    const next = [...list];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    await api.manage.orderMedia(game.id, next.map((m) => m.id));
    onChange();
  };
  return (
    <Card title={label} actions={<UploadButton gameId={game.id} kind={kind} multiple onDone={onChange} />}>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.media.dropHint')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {items.map((m, i) => (
            <div key={m.id} className="group relative aspect-video overflow-hidden rounded-md bg-surface-2">
              <img src={api.url(m.url)} alt="" className="size-full object-cover" loading="lazy" />
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 p-1 opacity-0 transition group-hover:opacity-100">
                <div className="flex gap-1">
                  <button type="button" disabled={i === 0} onClick={() => void move(items, i, i - 1)} className="rounded p-1 text-white disabled:opacity-30" aria-label={t('admin.media.moveLeft')}>
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    type="button"
                    disabled={i === items.length - 1}
                    onClick={() => void move(items, i, i + 1)}
                    className="rounded p-1 text-white disabled:opacity-30"
                    aria-label={t('admin.media.moveRight')}
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
                <button type="button" onClick={() => void api.manage.deleteMedia(game.id, m.id).then(onChange)} className="rounded p-1 text-white hover:text-danger" aria-label="delete">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function MediaTab({ game, onChange }: { game: ManagedGame; onChange: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_2fr]">
        <Single game={game} kind="COVER" label={t('admin.media.cover')} onChange={onChange} aspect="aspect-[2/3]" />
        <div className="space-y-6">
          <Single game={game} kind="HEADER" label={t('admin.media.header')} onChange={onChange} aspect="aspect-[46/21]" />
          <Single game={game} kind="BACKGROUND" label={t('admin.media.background')} onChange={onChange} aspect="aspect-video" />
        </div>
      </div>
      <Gallery game={game} kind="SCREENSHOT" label={t('admin.media.screenshots')} onChange={onChange} />
      <Gallery game={game} kind="ARTWORK" label={t('admin.media.artwork')} onChange={onChange} />
    </div>
  );
}
