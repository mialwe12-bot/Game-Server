import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, ErrorState, PageLoader, ProgressBar } from '../../components/ui';
import { api } from '../../lib/api';
import { formatBytes, formatDateTime } from '../../lib/format';

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs uppercase text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.admin.overview(), refetchInterval: 15_000 });
  const audit = useQuery({ queryKey: ['admin', 'audit', 'recent'], queryFn: () => api.admin.auditLogs({ pageSize: 10 }) });
  if (overview.isLoading) return <PageLoader />;
  if (overview.error) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;
  const o = overview.data!;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('admin.dashboard')}</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t('admin.stats.users')} value={o.users} />
        <Stat label={t('admin.stats.games')} value={o.games} sub={`${o.publicGames} ${t('admin.stats.publicGames')}`} />
        <Stat label={t('admin.stats.readyBuilds')} value={o.readyBuilds} />
        <Stat label={t('admin.stats.activeUploads')} value={o.activeUploads} />
        <Stat label={t('admin.stats.downloads30d')} value={o.downloads30d} />
        <Stat label={t('admin.stats.activeSessions')} value={o.activeSessions} />
        <Stat label={t('admin.stats.online')} value={o.onlineConnections} />
        <Stat label="Version" value={o.version} />
      </div>
      <Card title={t('admin.stats.disk')}>
        <ProgressBar value={o.disk.total ? o.disk.used / o.disk.total : 0} />
        <p className="mt-2 text-sm text-muted">{t('admin.stats.free', { free: formatBytes(o.disk.free), total: formatBytes(o.disk.total) })}</p>
      </Card>
      <Card title={t('admin.logsPage.audit')}>
        <ul className="divide-y divide-border text-sm">
          {audit.data?.items.map((a) => (
            <li key={a.id} className="flex flex-wrap gap-x-3 py-2">
              <span className="w-32 shrink-0 text-muted">{formatDateTime(a.createdAt)}</span>
              <span className="font-mono text-accent">{a.action}</span>
              <span>{a.user?.username ?? '–'}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
