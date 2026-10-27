import { useMutation, useQuery } from '@tanstack/react-query';
import { Archive, Database, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, ConfirmButton, EmptyState, PageLoader } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatBytes, formatDateTime } from '../../lib/format';
import { toast } from '../../lib/toast';

export default function BackupsPage() {
  const { t } = useTranslation();
  const backups = useQuery({
    queryKey: ['admin', 'backups'],
    queryFn: () => api.admin.backups(),
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === 'RUNNING') ? 2000 : false),
  });
  const start = useMutation({
    mutationFn: (includeFiles: boolean) => api.admin.startBackup(includeFiles),
    onSuccess: () => void backups.refetch(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('admin.backups')}</h1>
      <Card title={t('admin.backupsPage.create')}>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Database className="size-4" />} onClick={() => start.mutate(false)} loading={start.isPending}>
            {t('admin.backupsPage.createDb')}
          </Button>
          <Button icon={<Archive className="size-4" />} onClick={() => start.mutate(true)} loading={start.isPending}>
            {t('admin.backupsPage.createFull')}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">{t('admin.backupsPage.restoreHint')}</p>
      </Card>
      {backups.isLoading ? (
        <PageLoader />
      ) : backups.data!.length === 0 ? (
        <EmptyState title={t('admin.backupsPage.none')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted uppercase">
              <tr>
                <th className="p-3">{t('common.name')}</th>
                <th className="p-3">{t('admin.backupsPage.type')}</th>
                <th className="p-3">{t('admin.backupsPage.size')}</th>
                <th className="p-3">{t('common.status')}</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {backups.data!.map((b) => (
                <tr key={b.id}>
                  <td className="p-3">
                    <p className="font-mono text-xs">{b.filename}</p>
                    <p className="text-xs text-muted">{formatDateTime(b.createdAt)}</p>
                    {b.error && <p className="text-xs text-danger">{b.error}</p>}
                  </td>
                  <td className="p-3">{b.includesFiles ? t('admin.backupsPage.full') : t('admin.backupsPage.dbOnly')}</td>
                  <td className="p-3">{b.status === 'COMPLETED' ? formatBytes(b.size) : '–'}</td>
                  <td className="p-3">
                    <Badge tone={b.status === 'COMPLETED' ? 'success' : b.status === 'FAILED' ? 'danger' : 'warning'}>{b.status}</Badge>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {b.status === 'COMPLETED' && (
                      <a href={api.admin.backupDownloadUrl(b.id)} className="mr-2 inline-flex items-center gap-1 text-accent hover:underline">
                        <Download className="size-4" /> {t('common.download')}
                      </a>
                    )}
                    {b.status !== 'RUNNING' && (
                      <ConfirmButton size="sm" onConfirm={() => void api.admin.deleteBackup(b.id).then(() => backups.refetch())}>
                        {t('common.delete')}
                      </ConfirmButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
