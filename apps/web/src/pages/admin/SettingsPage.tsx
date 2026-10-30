import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Image as ImageIcon, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminSettings, RegistrationMode, ServerUpdateStatus, VoiceServerConfig } from '@gameserver/shared';
import { Button, Card, ErrorState, Field, Input, PageLoader, Select, Textarea, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast } from '../../lib/toast';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export default function SettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { refresh, settings: pub } = useAuth();
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.admin.settings() });
  const [s, setS] = useState<AdminSettings | null>(null);
  useEffect(() => {
    if (settings.data) setS(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (data: Partial<AdminSettings>) => api.admin.updateSettings(data),
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'settings'], data);
      void refresh();
      toast.success(t('common.saved'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const testMail = useMutation({
    mutationFn: () => api.admin.testMail(),
    onSuccess: () => toast.success(t('admin.settingsPage.testMailSent')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  // Logo hochladen/entfernen – aktualisiert Admin- und öffentliche Einstellungen sofort
  const applyBranding = (data: AdminSettings) => {
    qc.setQueryData(['admin', 'settings'], data);
    setS(data);
    void refresh();
  };
  const uploadLogo = useMutation({
    mutationFn: ({ kind, file }: { kind: 'logo' | 'client-logo'; file: Blob }) => api.admin.uploadLogo(kind, file),
    onSuccess: applyBranding,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeLogo = useMutation({
    mutationFn: (kind: 'logo' | 'client-logo') => api.admin.removeLogo(kind),
    onSuccess: applyBranding,
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (settings.isLoading || !s) return <PageLoader />;
  if (settings.error) return <ErrorState error={settings.error} />;
  const num = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(s);
      }}
    >
      <h1 className="text-2xl font-bold">{t('admin.settings')}</h1>
      <UpdateCard />
      <Card title={t('admin.settingsPage.general')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('admin.settingsPage.siteName')}>
            <Input value={s.siteName} onChange={(e) => setS({ ...s, siteName: e.target.value })} required maxLength={100} />
          </Field>
          <Field label={t('admin.settingsPage.registration')}>
            <Select value={s.registrationMode} onChange={(e) => setS({ ...s, registrationMode: e.target.value as RegistrationMode })}>
              <option value="open">{t('admin.settingsPage.registrationOpen')}</option>
              <option value="invite">{t('admin.settingsPage.registrationInvite')}</option>
              <option value="closed">{t('admin.settingsPage.registrationClosed')}</option>
            </Select>
          </Field>
          <Field label={t('admin.settingsPage.siteDescription')} className="md:col-span-2">
            <Input value={s.siteDescription} onChange={(e) => setS({ ...s, siteDescription: e.target.value })} maxLength={500} />
          </Field>
          <Toggle checked={s.storePublic} onChange={(v) => setS({ ...s, storePublic: v })} label={t('admin.settingsPage.storePublic')} />
        </div>
      </Card>

      <Card title={t('admin.settingsPage.maintenance')}>
        <div className="space-y-4">
          <Toggle checked={s.maintenanceMode} onChange={(v) => setS({ ...s, maintenanceMode: v })} label={t('admin.settingsPage.maintenanceMode')} />
          <Field label={t('admin.settingsPage.maintenanceMessage')} hint={t('common.markdownHint')}>
            <Textarea value={s.maintenanceMessage} onChange={(e) => setS({ ...s, maintenanceMessage: e.target.value })} rows={3} />
          </Field>
        </div>
      </Card>

      <Card title={t('admin.settingsPage.limits')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('admin.settingsPage.maxUploadFile')}>
            <Input type="number" min={0.001} step="any" value={s.maxUploadFileBytes / GB} onChange={(e) => setS({ ...s, maxUploadFileBytes: Math.round(num(e.target.value) * GB) })} />
          </Field>
          <Field label={t('admin.settingsPage.defaultQuota')}>
            <Input type="number" min={0} step="any" value={s.defaultUploadQuotaBytes / GB} onChange={(e) => setS({ ...s, defaultUploadQuotaBytes: Math.round(num(e.target.value) * GB) })} />
          </Field>
          <Field label={t('admin.settingsPage.maxConcurrent')}>
            <Input type="number" min={1} value={s.maxConcurrentUploadsPerUser} onChange={(e) => setS({ ...s, maxConcurrentUploadsPerUser: num(e.target.value) })} />
          </Field>
          <Field label={t('admin.settingsPage.chunkSize')}>
            <Input type="number" min={1} max={256} value={s.uploadChunkBytes / MB} onChange={(e) => setS({ ...s, uploadChunkBytes: Math.round(num(e.target.value) * MB) })} />
          </Field>
          <Field label={t('admin.settingsPage.downloadLimit')}>
            <Input type="number" min={0} value={s.downloadRateLimitKbps} onChange={(e) => setS({ ...s, downloadRateLimitKbps: num(e.target.value) })} />
          </Field>
        </div>
      </Card>

      <Card title={t('admin.settingsPage.backupSchedule')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Toggle checked={s.backupSchedule.enabled} onChange={(v) => setS({ ...s, backupSchedule: { ...s.backupSchedule, enabled: v } })} label={t('admin.settingsPage.backupEnabled')} />
          <Toggle
            checked={s.backupSchedule.includeFiles}
            onChange={(v) => setS({ ...s, backupSchedule: { ...s.backupSchedule, includeFiles: v } })}
            label={t('admin.settingsPage.backupIncludeFiles')}
          />
          <Field label={t('admin.settingsPage.backupInterval')}>
            <Input type="number" min={1} value={s.backupSchedule.intervalHours} onChange={(e) => setS({ ...s, backupSchedule: { ...s.backupSchedule, intervalHours: num(e.target.value) } })} />
          </Field>
          <Field label={t('admin.settingsPage.backupKeep')}>
            <Input type="number" min={0} value={s.backupSchedule.keep} onChange={(e) => setS({ ...s, backupSchedule: { ...s.backupSchedule, keep: num(e.target.value) } })} />
          </Field>
        </div>
      </Card>

      <Card title={t('admin.settingsPage.social')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Toggle checked={s.voiceEnabled} onChange={(v) => setS({ ...s, voiceEnabled: v })} label={t('admin.settingsPage.voiceEnabled')} />
          <Toggle checked={s.gifsEnabled} onChange={(v) => setS({ ...s, gifsEnabled: v })} label={t('admin.settingsPage.gifsEnabled')} />
          {s.voiceEnabled && (
            <Field label={t('admin.settingsPage.voiceBackend')}>
              <select
                value={s.voiceBackend}
                onChange={(e) => setS({ ...s, voiceBackend: e.target.value as 'MESH' | 'LIVEKIT' })}
                className="h-10 w-full rounded-md border border-border bg-surface px-2 text-sm"
              >
                <option value="MESH">{t('admin.settingsPage.voiceBackendMesh')}</option>
                <option value="LIVEKIT">{t('admin.settingsPage.voiceBackendLivekit')}</option>
              </select>
            </Field>
          )}
          {s.voiceEnabled && s.voiceBackend === 'LIVEKIT' && (
            <div className="md:col-span-2">
              <VoiceServersEditor servers={s.voiceServers ?? []} onChange={(v) => setS({ ...s, voiceServers: v })} />
            </div>
          )}
          <Field label={t('admin.settingsPage.maxChatImageMb')}>
            <Input
              type="number"
              min={1}
              max={100}
              value={Math.round(s.maxChatImageBytes / 1024 ** 2)}
              onChange={(e) => setS({ ...s, maxChatImageBytes: Math.max(1, num(e.target.value)) * 1024 ** 2 })}
            />
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted">{t('admin.settingsPage.socialHint')}</p>
      </Card>

      <Card title={t('admin.settingsPage.steam')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Toggle checked={s.cloudSavesEnabled} onChange={(v) => setS({ ...s, cloudSavesEnabled: v })} label={t('admin.settingsPage.cloudSavesEnabled')} />
          <Toggle checked={s.workshopEnabled} onChange={(v) => setS({ ...s, workshopEnabled: v })} label={t('admin.settingsPage.workshopEnabled')} />
          <Toggle checked={s.cardsEnabled} onChange={(v) => setS({ ...s, cardsEnabled: v })} label={t('admin.settingsPage.cardsEnabled')} />
          <Toggle checked={s.marketEnabled} onChange={(v) => setS({ ...s, marketEnabled: v })} label={t('admin.settingsPage.marketEnabled')} disabled={!s.cardsEnabled} />
          <Toggle checked={s.giftsEnabled} onChange={(v) => setS({ ...s, giftsEnabled: v })} label={t('admin.settingsPage.giftsEnabled')} />
          <div />
          <Field label={t('admin.settingsPage.cloudSaveVersions')}>
            <Input type="number" min={1} max={100} value={s.cloudSaveVersions} onChange={(e) => setS({ ...s, cloudSaveVersions: Math.max(1, num(e.target.value)) })} />
          </Field>
          <Field label={t('admin.settingsPage.cloudQuotaMb')} hint={t('admin.settingsPage.zeroUnlimited')}>
            <Input type="number" min={0} value={Math.round(s.cloudQuotaBytes / 1024 ** 2)} onChange={(e) => setS({ ...s, cloudQuotaBytes: num(e.target.value) * 1024 ** 2 })} />
          </Field>
          <Field label={t('admin.settingsPage.maxWorkshopMb')}>
            <Input type="number" min={1} value={Math.round(s.maxWorkshopFileBytes / 1024 ** 2)} onChange={(e) => setS({ ...s, maxWorkshopFileBytes: Math.max(1, num(e.target.value)) * 1024 ** 2 })} />
          </Field>
          <Field label={t('admin.settingsPage.cardDropMinutes')}>
            <Input type="number" min={1} max={1440} value={s.cardDropMinutes} onChange={(e) => setS({ ...s, cardDropMinutes: Math.max(1, num(e.target.value)) })} />
          </Field>
          <Field label={t('admin.settingsPage.discordAppId')} hint={t('admin.settingsPage.discordHint')}>
            <Input value={s.discordAppId} inputMode="numeric" onChange={(e) => setS({ ...s, discordAppId: e.target.value.replace(/\D/g, '') })} />
          </Field>
        </div>
      </Card>

      <Card title={t('admin.settingsPage.branding')}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <LogoField
              label={t('admin.settingsPage.logo')}
              hint={t('admin.settingsPage.logoHint')}
              url={s.logoUrl}
              busy={uploadLogo.isPending}
              onPick={(file) => uploadLogo.mutate({ kind: 'logo', file })}
              onClear={() => removeLogo.mutate('logo')}
            />
            <LogoField
              label={t('admin.settingsPage.clientLogo')}
              hint={t('admin.settingsPage.clientLogoHint')}
              url={s.clientLogoUrl}
              busy={uploadLogo.isPending}
              onPick={(file) => uploadLogo.mutate({ kind: 'client-logo', file })}
              onClear={() => removeLogo.mutate('client-logo')}
            />
          </div>
          <Field label={t('admin.settingsPage.customCss')} hint={t('admin.settingsPage.customCssHint')}>
            <Textarea value={s.customCss} onChange={(e) => setS({ ...s, customCss: e.target.value })} rows={8} className="font-mono text-xs" spellCheck={false} />
          </Field>
        </div>
      </Card>

      <Card title={t('admin.settingsPage.mail')}>
        <Button onClick={() => testMail.mutate()} loading={testMail.isPending} disabled={!pub?.smtpEnabled}>
          {t('admin.settingsPage.testMail')}
        </Button>
      </Card>

      <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
        {t('common.save')}
      </Button>
    </form>
  );
}

/** Logo-Vorschau mit Upload/Entfernen-Buttons. */
function LogoField({ label, hint, url, busy, onPick, onClear }: { label: string; hint: string; url: string; busy: boolean; onPick: (file: Blob) => void; onClear: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded border border-border bg-surface-2">
          {url ? <img src={api.url(url)} alt="" className="max-h-10 max-w-10 object-contain" /> : <ImageIcon className="size-5 text-muted" />}
        </div>
        <input
          ref={ref}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onPick(f);
          }}
        />
        <Button size="sm" loading={busy} onClick={() => ref.current?.click()}>
          {t('admin.settingsPage.uploadLogo')}
        </Button>
        {url && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            {t('common.remove')}
          </Button>
        )}
      </div>
    </Field>
  );
}

/**
 * Editor für die geordnete Voice-Server-Liste (Failover). Eintrag 0 = Primär (idealerweise der Main-Server),
 * danach die Fallbacks in der Reihenfolge, in der sie einspringen. Leere API-Felder = Zugangsdaten aus der
 * Server-Umgebung (LIVEKIT_API_KEY/SECRET). Secrets werden vom Server maskiert geliefert (Platzhalter) und nur
 * bei Eingabe eines neuen Werts überschrieben.
 */
function VoiceServersEditor({ servers, onChange }: { servers: VoiceServerConfig[]; onChange: (v: VoiceServerConfig[]) => void }) {
  const { t } = useTranslation();
  const status = useQuery({ queryKey: ['admin', 'voice-status'], queryFn: () => api.admin.voiceStatus(), staleTime: 10_000 });

  const update = (i: number, patch: Partial<VoiceServerConfig>) => onChange(servers.map((srv, idx) => (idx === i ? { ...srv, ...patch } : srv)));
  const remove = (i: number) => onChange(servers.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= servers.length) return;
    const copy = servers.slice();
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  };
  const add = () => onChange([...servers, { name: '', url: '', apiKey: '', apiSecret: '' }]);
  const health = (url: string) => status.data?.find((s) => s.url === url);

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{t('admin.settingsPage.voiceServers')}</p>
          <p className="text-xs text-muted">{t('admin.settingsPage.voiceServersHint')}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => status.refetch()} loading={status.isFetching}>
          <RefreshCw className="mr-1 h-4 w-4" />
          {t('admin.settingsPage.voiceStatusRefresh')}
        </Button>
      </div>

      {servers.length === 0 && <p className="text-sm text-muted">{t('admin.settingsPage.voiceServersEmpty')}</p>}

      <div className="space-y-3">
        {servers.map((srv, i) => {
          const h = health(srv.url);
          return (
            <div key={i} className="rounded-md border border-border bg-surface-2/40 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-surface-2 px-2 py-0.5 text-xs font-medium">
                    {i === 0 ? t('admin.settingsPage.voicePrimary') : t('admin.settingsPage.voiceFallbackN', { n: i })}
                  </span>
                  {h && (
                    <span className={`inline-flex items-center gap-1 text-xs ${h.healthy ? 'text-success' : 'text-warning'}`}>
                      <span className={`h-2 w-2 rounded-full ${h.healthy ? 'bg-success' : 'bg-warning'}`} />
                      {h.healthy ? t('admin.settingsPage.voiceReachable') : t('admin.settingsPage.voiceUnreachable')}
                      {h.active && ` · ${t('admin.settingsPage.voiceActive')}`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('admin.settingsPage.voiceMoveUp')}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => move(i, 1)}
                    disabled={i === servers.length - 1}
                    aria-label={t('admin.settingsPage.voiceMoveDown')}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(i)} aria-label={t('common.remove')}>
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('admin.settingsPage.voiceServerName')}>
                  <Input value={srv.name ?? ''} onChange={(e) => update(i, { name: e.target.value })} placeholder={t('admin.settingsPage.voiceServerNamePlaceholder')} />
                </Field>
                <Field label={t('admin.settingsPage.voiceServerUrl')}>
                  <Input value={srv.url} onChange={(e) => update(i, { url: e.target.value })} placeholder="wss://voice.example.com" />
                </Field>
                <Field label={t('admin.settingsPage.voiceServerApiKey')} hint={t('admin.settingsPage.voiceServerCredsHint')}>
                  <Input value={srv.apiKey ?? ''} onChange={(e) => update(i, { apiKey: e.target.value })} placeholder={t('admin.settingsPage.voiceFromEnv')} />
                </Field>
                <Field label={t('admin.settingsPage.voiceServerApiSecret')}>
                  <Input
                    type="password"
                    value={srv.apiSecret ?? ''}
                    onChange={(e) => update(i, { apiSecret: e.target.value })}
                    placeholder={t('admin.settingsPage.voiceFromEnv')}
                  />
                </Field>
              </div>
            </div>
          );
        })}
      </div>

      <Button size="sm" variant="ghost" onClick={add} disabled={servers.length >= 10}>
        <Plus className="mr-1 h-4 w-4" />
        {t('admin.settingsPage.voiceAddServer')}
      </Button>
    </div>
  );
}

/** Server-Update: Version prüfen und (falls eingerichtet) per Knopfdruck anwenden. */
function UpdateCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ServerUpdateStatus | null>(null);
  const check = useMutation({
    mutationFn: () => api.admin.checkUpdate(),
    onSuccess: setStatus,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () => api.admin.applyUpdate(),
    onSuccess: () => toast.success(t('admin.settingsPage.updateStarted')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card title={t('admin.settingsPage.updates')}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            {t('admin.settingsPage.currentVersion')}: <span className="font-mono">{status?.current ?? '…'}</span>
          </p>
          <Button size="sm" loading={check.isPending} onClick={() => check.mutate()}>
            {t('admin.settingsPage.checkUpdate')}
          </Button>
        </div>
        {status && !status.checkEnabled && <p className="text-sm text-muted">{t('admin.settingsPage.updateCheckDisabled')}</p>}
        {status?.error && <p className="text-sm text-warning">{t('admin.settingsPage.updateCheckError', { error: status.error })}</p>}
        {status && status.checkEnabled && !status.error && !status.updateAvailable && status.latest && (
          <p className="text-sm text-success">{t('admin.settingsPage.upToDate', { version: status.current })}</p>
        )}
        {status?.updateAvailable && (
          <div className="space-y-2 rounded-md border border-accent/40 bg-accent/5 p-3">
            <p className="text-sm font-medium">{t('admin.settingsPage.updateAvailable', { version: status.latest })}</p>
            {status.canApply ? (
              <Button
                variant="primary"
                size="sm"
                loading={apply.isPending}
                onClick={() => {
                  if (confirm(t('admin.settingsPage.updateConfirm'))) apply.mutate();
                }}
              >
                {t('admin.settingsPage.applyUpdate')}
              </Button>
            ) : (
              <div className="text-sm text-muted">
                <p>{t('admin.settingsPage.updateManualHint')}</p>
                {status.manualCommand && <code className="mt-1 block rounded bg-surface-2 px-2 py-1 font-mono text-xs">{status.manualCommand}</code>}
              </div>
            )}
          </div>
        )}
        {/* Branch-/Privat-Repo-Deployments: wenn Ein-Klick-Update aktiv ist, lässt sich jederzeit auf den neuesten
            Stand ziehen – auch wenn die Versionsprüfung (GitHub-Releases) nichts findet. */}
        {status && status.canApply && !status.updateAvailable && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm text-muted">{t('admin.settingsPage.forceUpdateHint')}</p>
            <Button
              variant="primary"
              size="sm"
              loading={apply.isPending}
              onClick={() => {
                if (confirm(t('admin.settingsPage.updateConfirm'))) apply.mutate();
              }}
            >
              {t('admin.settingsPage.applyUpdateAnyway')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
