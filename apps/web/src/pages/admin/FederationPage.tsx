import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Copy, Link2, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FederatedServerDto, FederationPairingCode, FederationStatus } from '@gameserver/shared';
import { Badge, Button, Card, ConfirmButton, EmptyState, Field, Input, PageLoader } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { toast } from '../../lib/toast';

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <Button
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => toast.success(t('common.copied')),
          () => toast.error(t('common.copyFailed')),
        );
      }}
    >
      <Copy className="size-4" />
    </Button>
  );
}

function statusTone(s: FederationStatus): 'success' | 'warning' | 'danger' {
  return s === 'ACTIVE' ? 'success' : s === 'BLOCKED' ? 'danger' : 'warning';
}

function ServerRow({ server, onChange }: { server: FederatedServerDto; onChange: () => void }) {
  const { t } = useTranslation();
  const sync = useMutation({ mutationFn: () => api.federation.sync(server.id), onSuccess: onChange, onError: (e) => toast.error(errorMessage(e)) });
  const setStatus = useMutation({
    mutationFn: (status: FederationStatus) => api.federation.setStatus(server.id, status),
    onSuccess: onChange,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: () => api.federation.remove(server.id), onSuccess: onChange, onError: (e) => toast.error(errorMessage(e)) });

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{server.name}</span>
          <Badge tone={statusTone(server.status)}>{t(`federation.status.${server.status}`)}</Badge>
        </div>
        <div className="truncate text-xs text-muted">{server.baseUrl}</div>
        <div className="text-xs text-muted">
          {t('federation.gameCount', { n: server.gameCount })}
          {' · '}
          {server.lastSyncedAt ? t('federation.lastSync', { date: formatDate(server.lastSyncedAt) }) : t('federation.neverSynced')}
          {server.lastError ? ` · ⚠ ${server.lastError}` : ''}
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => sync.mutate()} disabled={sync.isPending} title={t('federation.syncNow')}>
          <RefreshCw className={`size-4 ${sync.isPending ? 'animate-spin' : ''}`} />
        </Button>
        {server.status === 'BLOCKED' ? (
          <Button onClick={() => setStatus.mutate('ACTIVE')} title={t('federation.activate')}>
            <Check className="size-4" />
          </Button>
        ) : (
          <Button onClick={() => setStatus.mutate('BLOCKED')} title={t('federation.block')}>
            <Ban className="size-4" />
          </Button>
        )}
        <ConfirmButton onConfirm={() => remove.mutate()} title={t('federation.remove')}>
          <Trash2 className="size-4" />
        </ConfirmButton>
      </div>
    </div>
  );
}

export default function FederationPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const self = useQuery({ queryKey: ['fed', 'self'], queryFn: () => api.federation.self() });
  const servers = useQuery({ queryKey: ['fed', 'servers'], queryFn: () => api.federation.servers() });
  const [code, setCode] = useState<FederationPairingCode | null>(null);
  const [peerUrl, setPeerUrl] = useState('');
  const [peerCode, setPeerCode] = useState('');

  const refresh = () => void qc.invalidateQueries({ queryKey: ['fed', 'servers'] });

  const genCode = useMutation({ mutationFn: () => api.federation.createPairingCode(), onSuccess: setCode, onError: (e) => toast.error(errorMessage(e)) });
  const connect = useMutation({
    mutationFn: () => api.federation.connect(peerUrl.trim(), peerCode.trim()),
    onSuccess: () => {
      setPeerUrl('');
      setPeerCode('');
      toast.success(t('federation.connected'));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (self.isLoading || servers.isLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">{t('federation.title')}</h1>
        <p className="text-sm text-muted">{t('federation.intro')}</p>
      </div>

      {/* Eigener Server – zum Teilen mit anderen Admins */}
      <Card className="space-y-3">
        <h2 className="font-semibold">{t('federation.thisServer')}</h2>
        <Field label={t('federation.myAddress')}>
          <div className="flex gap-2">
            <Input readOnly value={self.data?.baseUrl ?? ''} className="font-mono text-xs" />
            <CopyButton value={self.data?.baseUrl ?? ''} />
          </div>
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => genCode.mutate()} disabled={genCode.isPending}>
            <Link2 className="size-4" /> {t('federation.generateCode')}
          </Button>
          {code && (
            <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
              <code className="select-all font-mono text-sm">{code.code}</code>
              <CopyButton value={code.code} />
              <span className="text-xs text-muted">{t('federation.codeHint', { date: formatDate(code.expiresAt) })}</span>
            </div>
          )}
        </div>
      </Card>

      {/* Mit einem anderen Server verbinden */}
      <Card className="space-y-3">
        <h2 className="font-semibold">{t('federation.connectTitle')}</h2>
        <p className="text-sm text-muted">{t('federation.connectHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('federation.peerAddress')}>
            <Input placeholder="https://games.example.com" value={peerUrl} onChange={(e) => setPeerUrl(e.target.value)} />
          </Field>
          <Field label={t('federation.pairingCode')}>
            <Input value={peerCode} onChange={(e) => setPeerCode(e.target.value)} className="font-mono" />
          </Field>
        </div>
        <Button variant="primary" onClick={() => connect.mutate()} disabled={connect.isPending || !peerUrl.trim() || !peerCode.trim()}>
          {t('federation.connect')}
        </Button>
      </Card>

      {/* Verbundene Server */}
      <Card className="space-y-3">
        <h2 className="font-semibold">{t('federation.connectedServers')}</h2>
        {servers.data && servers.data.length > 0 ? (
          <div className="space-y-2">
            {servers.data.map((s) => (
              <ServerRow key={s.id} server={s} onChange={refresh} />
            ))}
          </div>
        ) : (
          <EmptyState title={t('federation.noneTitle')}>{t('federation.noneDesc')}</EmptyState>

        )}
      </Card>
    </div>
  );
}
