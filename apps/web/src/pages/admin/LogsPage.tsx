import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, PageLoader, Pagination, Select, Tabs, Toggle } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

function AuditLog() {
  const { t } = useTranslation();
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const logs = useQuery({
    queryKey: ['admin', 'audit', action, page],
    queryFn: () => api.admin.auditLogs({ action: action || undefined, page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="space-y-3">
      <Input value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} placeholder={t('admin.logsPage.filterAction')} className="max-w-xs" />
      {logs.isLoading ? (
        <PageLoader />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 text-left text-muted uppercase">
                <tr>
                  <th className="p-2">{t('admin.logsPage.time')}</th>
                  <th className="p-2">{t('admin.logsPage.action')}</th>
                  <th className="p-2">{t('admin.logsPage.user')}</th>
                  <th className="p-2">{t('admin.logsPage.target')}</th>
                  <th className="p-2">IP</th>
                  <th className="p-2">{t('admin.logsPage.details')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.data?.items.map((l) => (
                  <tr key={l.id}>
                    <td className="p-2 whitespace-nowrap text-muted">{formatDateTime(l.createdAt)}</td>
                    <td className="p-2 font-mono text-accent">{l.action}</td>
                    <td className="p-2">{l.user?.username ?? '–'}</td>
                    <td className="max-w-40 truncate p-2 font-mono" title={l.target ?? ''}>
                      {l.target ?? '–'}
                    </td>
                    <td className="p-2 text-muted">{l.ip ?? '–'}</td>
                    <td className="max-w-96 truncate p-2 font-mono text-muted" title={JSON.stringify(l.meta)}>
                      {Object.keys(l.meta).length ? JSON.stringify(l.meta) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={50} total={logs.data?.total ?? 0} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function ServerLog() {
  const { t } = useTranslation();
  const [level, setLevel] = useState('info');
  const [q, setQ] = useState('');
  const [auto, setAuto] = useState(true);
  const logs = useQuery({
    queryKey: ['admin', 'server-logs', level, q],
    queryFn: () => api.admin.serverLogs({ level, q: q || undefined, limit: 500 }),
    refetchInterval: auto ? 5000 : false,
    placeholderData: keepPreviousData,
  });
  const color = (l: string) => (l === 'error' || l === 'fatal' ? 'text-danger' : l === 'warn' ? 'text-warning' : l === 'debug' || l === 'trace' ? 'text-muted' : 'text-success');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-auto" aria-label={t('admin.logsPage.level')}>
          {['debug', 'info', 'warn', 'error'].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} className="max-w-xs" />
        <Toggle checked={auto} onChange={setAuto} label={t('admin.logsPage.autoRefresh')} />
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-black/90 p-3 font-mono text-xs text-gray-200">
        {logs.data?.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            <span className="text-gray-500">{l.time.replace('T', ' ').slice(0, 19)}</span> <span className={clsx('uppercase', color(l.level))}>{l.level.padEnd(5)}</span> {l.msg}
            {l.data && Object.keys(l.data).length > 0 && <span className="text-gray-500"> {JSON.stringify(l.data)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LogsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'audit' | 'server'>('audit');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('admin.logs')}</h1>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'audit', label: t('admin.logsPage.audit') },
          { id: 'server', label: t('admin.logsPage.server') },
        ]}
      />
      {tab === 'audit' ? <AuditLog /> : <ServerLog />}
    </div>
  );
}
