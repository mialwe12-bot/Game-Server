import { Cloud, HardDrive } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CloudSyncResult } from '@gameserver/shared';
import { Button, Modal } from '../components/ui';
import { formatBytes, formatDateTime } from '../lib/format';
import { desktop, desktopError } from './bridge';
import { toast } from '../lib/toast';

/**
 * Konfliktdialog für Cloud-Saves: lokal und in der Cloud wurde seit dem letzten Abgleich geändert.
 * Der Nutzer entscheidet, welcher Stand gilt; der andere bleibt als ältere Version in der Cloud erhalten.
 */
export function CloudConflictDialog({ conflict, title, onDone }: { conflict: CloudSyncResult; title: string; onDone: (resolved: boolean) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const choose = async (mode: 'upload' | 'download') => {
    setBusy(true);
    try {
      const r = await desktop.cloudSync(conflict.gameId, mode);
      toast.success(t(mode === 'upload' ? 'cloud.keptLocal' : 'cloud.usedRemote'));
      onDone(r.status !== 'error');
    } catch (e) {
      toast.error(desktopError(e));
      onDone(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={() => onDone(false)} title={t('cloud.conflictTitle', { title })} wide>
      <p className="mb-4 text-sm text-muted">{t('cloud.conflictText')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" disabled={busy} onClick={() => void choose('upload')} className="rounded-lg border border-border p-4 text-left hover:border-accent">
          <HardDrive className="mb-2 size-6 text-accent" />
          <p className="font-semibold">{t('cloud.local')}</p>
          <p className="text-sm text-muted">
            {conflict.local.modifiedAt ? formatDateTime(conflict.local.modifiedAt) : '—'} · {t('cloud.fileCount', { count: conflict.local.files })} · {formatBytes(conflict.local.bytes)}
          </p>
          <p className="mt-2 text-xs text-accent">{t('cloud.keepLocal')}</p>
        </button>
        <button type="button" disabled={busy || !conflict.remote} onClick={() => void choose('download')} className="rounded-lg border border-border p-4 text-left hover:border-accent">
          <Cloud className="mb-2 size-6 text-accent" />
          <p className="font-semibold">{t('cloud.remote')}</p>
          {conflict.remote && (
            <p className="text-sm text-muted">
              v{conflict.remote.version} · {formatDateTime(conflict.remote.createdAt)}
              {conflict.remote.deviceName && ` · ${conflict.remote.deviceName}`}
            </p>
          )}
          <p className="mt-2 text-xs text-accent">{t('cloud.useRemote')}</p>
        </button>
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => onDone(false)} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </Modal>
  );
}
