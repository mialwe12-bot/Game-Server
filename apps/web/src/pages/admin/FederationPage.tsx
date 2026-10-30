import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Copy, Link2, RefreshCw, ServerCog, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FederatedServerDto, FederationPairingCode, FederationStatus, RegistrationMode, RemoteSettingsDto, RemoteUserDto, Role } from '@gameserver/shared';
import { Badge, Button, Card, ConfirmButton, EmptyState, Field, Input, PageLoader, Select, Textarea, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBytes, formatDate } from '../../lib/format';
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

/** Nutzerzeile im Fernverwaltungs-Panel: Rolle + Deaktivierung + Netzwerk-Admin ändern. */
function RemoteUserRow({ serverId, u, onChange }: { serverId: string; u: RemoteUserDto; onChange: () => void }) {
  const { t } = useTranslation();
  const update = useMutation({
    mutationFn: (data: { role?: Role; disabled?: boolean; networkAdmin?: boolean }) => api.federation.remoteUpdateUser(serverId, u.id, data),
    onSuccess: onChange,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{u.displayName || u.username}</span>
          {u.networkAdmin && <Badge tone="accent">{t('federation.remote.networkAdmin')}</Badge>}
          {u.federated && <Badge tone="warning">{t('federation.remote.federatedUser')}</Badge>}
          {u.disabled && <Badge tone="danger">{t('federation.remote.disabled')}</Badge>}
        </div>
        <div className="truncate text-xs text-muted">{u.email}</div>
      </div>
      <Select value={u.role} onChange={(e) => update.mutate({ role: e.target.value as Role })} disabled={update.isPending} className="w-36" title={t('federation.remote.serverAdminHint')}>
        <option value="USER">USER</option>
        <option value="UPLOADER">UPLOADER</option>
        <option value="ADMIN">{t('federation.remote.roleServerAdmin')}</option>
      </Select>
      <Button onClick={() => update.mutate({ networkAdmin: !u.networkAdmin })} disabled={update.isPending}>
        {u.networkAdmin ? t('federation.remote.revokeNetworkAdmin') : t('federation.remote.makeNetworkAdmin')}
      </Button>
      <Button onClick={() => update.mutate({ disabled: !u.disabled })} disabled={update.isPending}>
        {u.disabled ? t('federation.remote.enable') : t('federation.remote.disable')}
      </Button>
    </div>
  );
}

/** Fern-Einstellungen: wichtigste Betriebseinstellungen eines verbundenen Servers bearbeiten. */
function RemoteSettingsEditor({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['fed', 'remote', serverId, 'settings'], queryFn: () => api.federation.remoteSettings(serverId) });
  const [draft, setDraft] = useState<RemoteSettingsDto | null>(null);
  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (patch: RemoteSettingsDto) => api.federation.remoteUpdateSettings(serverId, patch),
    onSuccess: (data) => {
      setDraft(data);
      void qc.invalidateQueries({ queryKey: ['fed', 'remote', serverId, 'settings'] });
      toast.success(t('federation.remote.settingsSaved'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (settings.isError) return <p className="text-sm text-danger">{errorMessage(settings.error)}</p>;
  if (!draft) return <PageLoader />;
  const set = (patch: Partial<RemoteSettingsDto>) => setDraft({ ...draft, ...patch });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('federation.remote.siteName')}>
          <Input value={draft.siteName} onChange={(e) => set({ siteName: e.target.value })} />
        </Field>
        <Field label={t('federation.remote.registration')}>
          <Select value={draft.registrationMode} onChange={(e) => set({ registrationMode: e.target.value as RegistrationMode })}>
            <option value="open">{t('federation.remote.regOpen')}</option>
            <option value="invite">{t('federation.remote.regInvite')}</option>
            <option value="closed">{t('federation.remote.regClosed')}</option>
          </Select>
        </Field>
      </div>
      <Field label={t('federation.remote.siteDescription')}>
        <Input value={draft.siteDescription} onChange={(e) => set({ siteDescription: e.target.value })} />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Toggle checked={draft.storePublic} onChange={(v) => set({ storePublic: v })} label={t('federation.remote.storePublic')} />
        <Toggle checked={draft.maintenanceMode} onChange={(v) => set({ maintenanceMode: v })} label={t('federation.remote.maintenance')} />
      </div>
      {draft.maintenanceMode && (
        <Field label={t('federation.remote.maintenanceMessage')}>
          <Textarea value={draft.maintenanceMessage} onChange={(e) => set({ maintenanceMessage: e.target.value })} rows={2} />
        </Field>
      )}
      <Button variant="primary" onClick={() => save.mutate(draft)} loading={save.isPending}>
        {t('common.save')}
      </Button>
    </div>
  );
}

/** Fernverwaltungs-Panel: Übersicht + Einstellungen + Nutzerliste eines verbundenen Servers. */
function RemoteAdminPanel({ server }: { server: FederatedServerDto }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const overview = useQuery({ queryKey: ['fed', 'remote', server.id, 'overview'], queryFn: () => api.federation.remoteOverview(server.id) });
  const users = useQuery({ queryKey: ['fed', 'remote', server.id, 'users', query], queryFn: () => api.federation.remoteUsers(server.id, query || undefined) });
  const refreshUsers = () => void qc.invalidateQueries({ queryKey: ['fed', 'remote', server.id, 'users'] });

  const o = overview.data;
  const stats: [string, string][] = o
    ? [
        [t('federation.remote.users'), String(o.userCount)],
        [t('federation.remote.admins'), String(o.adminCount)],
        [t('federation.remote.games'), String(o.gameCount)],
        [t('federation.remote.storage'), formatBytes(o.storageBytes)],
        [t('federation.remote.servers'), String(o.federatedServerCount)],
        [t('federation.remote.version'), o.version],
      ]
    : [];

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
      {overview.isError ? (
        <p className="text-sm text-danger">{errorMessage(overview.error)}</p>
      ) : o ? (
        <>
          <div className="flex items-center gap-2">
            <ServerCog className="size-4 text-accent" />
            <span className="font-medium">{o.siteName}</span>
            {o.maintenanceMode && <Badge tone="warning">{t('federation.remote.maintenance')}</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {stats.map(([label, val]) => (
              <div key={label} className="rounded-md bg-surface p-2">
                <div className="text-xs text-muted">{label}</div>
                <div className="font-semibold">{val}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <PageLoader />
      )}

      <div>
        <p className="mb-2 text-sm font-medium">{t('federation.remote.settingsTitle')}</p>
        <RemoteSettingsEditor serverId={server.id} />
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">{t('federation.remote.usersTitle')}</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('federation.remote.searchUsers')} />
          <Button type="submit">{t('common.search')}</Button>
        </form>
        <div className="mt-2">
          {users.isLoading ? (
            <PageLoader />
          ) : users.data && users.data.length > 0 ? (
            users.data.map((u) => <RemoteUserRow key={u.id} serverId={server.id} u={u} onChange={refreshUsers} />)
          ) : (
            <p className="py-2 text-sm text-muted">{t('federation.remote.noUsers')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ServerRow({ server, canManage, onChange }: { server: FederatedServerDto; canManage: boolean; onChange: () => void }) {
  const { t } = useTranslation();
  const [manage, setManage] = useState(false);
  const sync = useMutation({ mutationFn: () => api.federation.sync(server.id), onSuccess: onChange, onError: (e) => toast.error(errorMessage(e)) });
  const setStatus = useMutation({
    mutationFn: (status: FederationStatus) => api.federation.setStatus(server.id, status),
    onSuccess: onChange,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: () => api.federation.remove(server.id), onSuccess: onChange, onError: (e) => toast.error(errorMessage(e)) });
  // Fernverwalten: nur Netzwerk-Admins, nur ACTIVE-Server (BLOCKED = Notaus).
  const manageable = canManage && server.status === 'ACTIVE';

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
          {manageable && (
            <Button variant={manage ? 'primary' : 'secondary'} onClick={() => setManage((m) => !m)} title={t('federation.remote.manage')}>
              <ServerCog className="size-4" />
            </Button>
          )}
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

      {manage && manageable && <RemoteAdminPanel server={server} />}
    </div>
  );
}

export default function FederationPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canManage = !!user?.networkAdmin;
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
              <ServerRow key={s.id} server={s} canManage={canManage} onChange={refresh} />
            ))}
          </div>
        ) : (
          <EmptyState title={t('federation.noneTitle')}>{t('federation.noneDesc')}</EmptyState>

        )}
      </Card>
    </div>
  );
}
