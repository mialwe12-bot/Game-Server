import { useQuery } from '@tanstack/react-query';
import { Download, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PLATFORMS } from '@gameserver/shared';
import { Markdown } from '../components/Markdown';
import { PlatformIcon } from '../components/PlatformIcons';
import { Card, EmptyState, PageLoader } from '../components/ui';
import { api } from '../lib/api';
import { formatBytes, formatDate } from '../lib/format';

/** Download-Seite für den Desktop-Client (Windows/Linux). */
export default function ClientDownloadPage() {
  const { t } = useTranslation();
  const latest = useQuery({ queryKey: ['client-latest'], queryFn: () => api.client.latest() });
  if (latest.isLoading) return <PageLoader />;
  const r = latest.data;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start gap-4">
        <Monitor className="size-10 shrink-0 text-accent" />
        <div>
          <h1 className="text-2xl font-bold">{t('clientDownload.title')}</h1>
          <p className="text-muted">{t('clientDownload.text')}</p>
        </div>
      </div>
      {!r ? (
        <EmptyState title={t('clientDownload.none')} />
      ) : (
        <Card title={`${t('clientDownload.version', { version: r.version })} · ${formatDate(r.publishedAt ?? r.createdAt)}`}>
          <div className="space-y-6">
            {PLATFORMS.filter((p) => r.files.some((f) => f.platform === p)).map((p) => (
              <div key={p} className="space-y-2">
                <h3 className="flex items-center gap-2 font-semibold">
                  <PlatformIcon platform={p} className="size-5" /> {t(`platforms.${p}`)}
                </h3>
                <ul className="space-y-2">
                  {r.files
                    .filter((f) => f.platform === p)
                    .map((f) => (
                      <li key={f.id}>
                        <a
                          href={api.url(f.downloadUrl)}
                          className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 hover:border-accent/60 hover:bg-surface-2/50"
                        >
                          <Download className="size-5 text-accent" />
                          <span className="flex-1 font-medium">{t(`clientDownload.formats.${f.format}`)}</span>
                          <span className="text-xs text-muted">
                            {f.arch} · {formatBytes(f.size)}
                          </span>
                          <span className="w-full truncate font-mono text-[10px] text-muted" title={f.sha256}>
                            SHA-256: {f.sha256}
                          </span>
                        </a>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
            {r.notes && <Markdown>{r.notes}</Markdown>}
            <p className="text-sm text-muted">{t('clientDownload.afterInstall', { url: window.location.origin })}</p>
          </div>
        </Card>
      )}
    </div>
  );
}
