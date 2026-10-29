import { ArrowUpCircle, Download, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui';
import { toast } from '../lib/toast';
import { desktop, desktopError } from './bridge';
import { useDesktop } from './DesktopProvider';

/** Hinweisleiste im Desktop-Client, wenn ein Client-Update verfügbar ist (install/herunterladen). */
export function ClientUpdateBanner() {
  const { t } = useTranslation();
  const desk = useDesktop();
  const update = desk?.clientUpdate;
  if (!update?.available) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-accent/40 bg-accent/10 px-4 py-2 text-sm">
      <ArrowUpCircle className="size-5 text-accent" />
      <span className="flex-1">{t('desktop.clientUpdateAvailable', { version: update.version })}</span>
      {update.canInstall ? (
        <Button size="sm" variant="primary" icon={<Download className="size-4" />} onClick={() => void desktop.installClientUpdate().catch((e) => toast.error(desktopError(e)))}>
          {t('desktop.installClientUpdate')}
        </Button>
      ) : (
        update.downloadUrl && (
          <Button size="sm" variant="primary" icon={<Download className="size-4" />} onClick={() => void desktop.openUrl(update.downloadUrl!)}>
            {t('desktop.downloadClientUpdate')}
          </Button>
        )
      )}
      <Button size="sm" variant="ghost" icon={<X className="size-4" />} aria-label={t('common.close')} onClick={() => desk?.dismissClientUpdate()} />
    </div>
  );
}
