import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Copy, Link2, RefreshCw, ServerCog, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FederatedServerDto, FederationPairingCode, FederationStatus, GameVisibility, RegistrationMode, RemoteSettingsDto, RemoteUserDto, Role } from '@gameserver/shared';
import { VISIBILITIES } from '@gameserver/shared';
import { Badge, Button, Card, ConfirmButton, EmptyState, Field, Input, PageLoader, Select, Textarea, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBytes, formatDate, formatDateTime } from '../../lib/format';
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

/** Fern-Spiele: Liste + Sichtbarkeit ändern. */
function RemoteGames({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const games = useQuery({ queryKey: ['fed', 'remote', serverId, 'games'], queryFn: () => api.federation.remoteGames(serverId) });
  const setVis = useMutation({
    mutationFn: ({ gameId, visibility }: { gameId: string; visibility: GameVisibility }) => api.federation.remoteSetGameVisibility(serverId, gameId, visibility),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fed', 'remote', serverId, 'games'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (games.isLoading) return <PageLoader />;
  if (games.isError) return <p className="text-sm text-danger">{errorMessage(games.error)}</p>;
  if (!games.data || games.data.length === 0) return <p className="py-2 text-sm text-muted">{t('federation.remote.noGames')}</p>;
  return (
    <div>
      {games.data.map((g) => (
        <div key={g.id} className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{g.title}</div>
            <div className="truncate text-xs text-muted">
              {g.slug} · {t('federation.remote.versions', { n: g.versionCount })} · {t('federation.remote.downloads', { n: g.downloadCount })}
            </div>
          </div>
          <Select value={g.visibility} onChange={(e) => setVis.mutate({ gameId: g.id, visibility: e.target.value as GameVisibility })} disabled={setVis.isPending} className="w-40">
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {t(`visibility.${v}`)}
              </option>
            ))}
          </Select>
        </div>
      ))}
    </div>
  );
}

/** Fern-Logs: Audit-Log (nur lesen). */
function RemoteLogs({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const logs = useQuery({ queryKey: ['fed', 'remote', serverId, 'logs'], queryFn: () => api.federation.remoteLogs(serverId) });
  if (logs.isLoading) return <PageLoader />;
  if (logs.isError) return <p className="text-sm text-danger">{errorMessage(logs.error)}</p>;
  if (!logs.data || logs.data.length === 0) return <p className="py-2 text-sm text-muted">{t('federation.remote.noLogs')}</p>;
  return (
    <div className="max-h-80 overflow-y-auto">
      {logs.data.map((l) => (
        <div key={l.id} className="border-t border-border py-1.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium">{l.action}</span>
            {l.user && <span className="text-muted">{l.user.username}</span>}
            <span className="ml-auto text-muted">{formatDateTime(l.createdAt)}</span>
          </div>
          {l.target && <div className="truncate text-muted">{l.target}</div>}
        </div>
      ))}
    </div>
  );
}

/** Fern-Backups: Liste + starten. */
function RemoteBackups({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const backups = useQuery({ queryKey: ['fed', 'remote', serverId, 'backups'], queryFn: () => api.federation.remoteBackups(serverId) });
  const create = useMutation({
    mutationFn: (includeFiles: boolean) => api.federation.remoteCreateBackup(serverId, includeFiles),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fed', 'remote', serverId, 'backups'] });
      toast.success(t('federation.remote.backupStarted'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => create.mutate(false)} loading={create.isPending}>
          {t('federation.remote.backupDb')}
        </Button>
        <Button onClick={() => create.mutate(true)} loading={create.isPending}>
          {t('federation.remote.backupFull')}
        </Button>
        <Button variant="ghost" onClick={() => backups.refetch()} loading={backups.isFetching}>
          <RefreshCw className="size-4" />
        </Button>
      </div>
      {backups.isError ? (
        <p className="text-sm text-danger">{errorMessage(backups.error)}</p>
      ) : !backups.data || backups.data.length === 0 ? (
        <p className="py-2 text-sm text-muted">{t('federation.remote.noBackups')}</p>
      ) : (
        backups.data.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm">
            <div className="min-w-0 flex-1 truncate">
              <span className="font-mono text-xs">{b.filename}</span>
            </div>
            <Badge tone={b.status === 'COMPLETED' ? 'success' : b.status === 'FAILED' ? 'danger' : 'warning'}>{b.status}</Badge>
            <span className="text-xs text-muted">{b.size ? formatBytes(b.size) : '—'}</span>
            <span className="text-xs text-muted">{formatDateTime(b.createdAt)}</span>
          </div>
        ))
      )}
    </div>
  );
}

/** Fernverwaltungs-Panel: Übersicht + Tabs (Nutzer/Spiele/Einstellungen/Logs/Backups) eines verbundenen Servers. */
function RemoteAdminPanel({ server }: { server: FederatedServerDto }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'users' | 'games' | 'settings' | 'logs' | 'backups'>('users');
  const overview = useQuery({ queryKey: ['fed', 'remote', server.id, 'overview'], queryFn: () => api.federation.remoteOverview(server.id) });
  const users = useQuery({ queryKey: ['fed', 'remote', server.id, 'users', query], queryFn: () => api.federation.remoteUsers(server.id, query || undefined), enabled: tab === 'users' });
  const refreshUsers = () => void qc.invalidateQueries({ queryKey: ['fed', 'remote', server.id, 'users'] });

  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'users', label: t('federation.remote.usersTitle') },
    { id: 'games', label: t('federation.remote.gamesTitle') },
    { id: 'settings', label: t('federation.remote.settingsTitle') },
    { id: 'logs', label: t('federation.remote.logsTitle') },
    { id: 'backups', label: t('federation.remote.backupsTitle') },
  ];

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

      <div className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-1.5 text-sm font-medium transition ${tab === tb.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <div>
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
      )}
      {tab === 'games' && <RemoteGames serverId={server.id} />}
      {tab === 'settings' && <RemoteSettingsEditor serverId={server.id} />}
      {tab === 'logs' && <RemoteLogs serverId={server.id} />}
      {tab === 'backups' && <RemoteBackups serverId={server.id} />}
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
