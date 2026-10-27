import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorState, PageLoader, ProgressBar } from '../../components/ui';
import { api } from '../../lib/api';
import { formatBytes, formatDateTime } from '../../lib/format';

export default function StoragePage() {
  const { t } = useTranslation();
  const storage = useQuery({ queryKey: ['admin', 'storage'], queryFn: () => api.admin.storage() });
  const uploads = useQuery({ queryKey: ['admin', 'uploads'], queryFn: () => api.admin.uploads(), refetchInterval: 5000 });
  if (storage.isLoading) return <PageLoader />;
  if (storage.error) return <ErrorState error={storage.error} />;
  const s = storage.data!;
  const parts = [
    { label: t('admin.storagePage.builds'), value: s.builds },
    { label: t('admin.storagePage.media'), value: s.media },
    { label: t('admin.storagePage.avatars'), value: s.avatars },
    { label: t('admin.storagePage.pendingUploads'), value: s.pendingUploads },
    { label: t('admin.storagePage.backups'), value: s.backups },
  ];
  const max = Math.max(...s.games.map((g) => g.bytes), 1);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('admin.storage')}</h1>
      <Card title={t('admin.storagePage.disk')}>
        <ProgressBar value={s.disk.total ? s.disk.used / s.disk.total : 0} />
        <p className="mt-2 text-sm text-muted">{t('admin.stats.free', { free: formatBytes(s.disk.free), total: formatBytes(s.disk.total) })}</p>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
          {parts.map((p) => (
            <div key={p.label}>
              <dt className="text-xs text-muted">{p.label}</dt>
              <dd className="font-semibold">{formatBytes(p.value)}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title={t('admin.uploads.active')}>
        {uploads.data?.length ? (
          <ul className="divide-y divide-border text-sm">
            {uploads.data.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs">{u.path}</p>
                  <p className="text-xs text-muted">
                    {u.user.username} · {u.game.title} {u.version} ({u.platform}) · {formatDateTime(u.updatedAt)}
                  </p>
                  <ProgressBar value={u.size ? u.offset / u.size : 0} className="mt-1" />
                </div>
                <span className="text-xs text-muted">
                  {formatBytes(u.offset)} / {formatBytes(u.size)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => void api.admin.cancelUpload(u.id).then(() => uploads.refetch())}>
                  {t('admin.uploads.cancel')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('admin.uploads.none')}</p>
        )}
      </Card>
      <Card title={t('admin.storagePage.perGame')}>
        <ul className="space-y-3">
          {s.games.map((g) => (
            <li key={g.id} className="text-sm">
              <div className="flex justify-between gap-2">
                <Link to={`/admin/games/${g.id}`} className="hover:text-accent">
                  {g.title}
                </Link>
                <span className="text-muted">
                  {formatBytes(g.bytes)} · {t('admin.versionsCount', { count: g.versions })}
                </span>
              </div>
              <ProgressBar value={g.bytes / max} className="mt-1 h-1.5" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
