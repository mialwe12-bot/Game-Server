import { useQuery } from '@tanstack/react-query';
import { FolderSearch, MonitorPlay, RefreshCw, Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImportCandidate } from '@gameserver/shared';
import { Badge, Button, Card, Field, Input, Select, Toggle } from '../components/ui';
import { useAuth } from '../lib/auth';
import { toast } from '../lib/toast';
import { desktop, desktopError } from './bridge';
import { useDesktopRequired } from './DesktopProvider';

/** Phase 4: Cloud/Workshop/Overlay/Screenshots/Discord/Big Picture sowie Steam-, Sunshine- und Ordner-Import */
export function IntegrationSettings() {
  const { t } = useTranslation();
  const { settings } = useAuth();
  const { config, updateConfig, reload } = useDesktopRequired();
  const steam = useQuery({ queryKey: ['desktop', 'steam'], queryFn: () => desktop.steamStatus() });
  const sunshine = useQuery({ queryKey: ['desktop', 'sunshine'], queryFn: () => desktop.sunshineStatus() });
  const [steamUser, setSteamUser] = useState('');
  const [scanPath, setScanPath] = useState('');
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async <T,>(key: string, fn: () => Promise<T>, ok: (r: T) => string) => {
    setBusy(key);
    try {
      toast.success(ok(await fn()));
    } catch (e) {
      toast.error(desktopError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Card title={t('desktop.p4.features')}>
        <div className="space-y-3">
          <Toggle checked={config.cloudSync} onChange={(v) => void updateConfig({ cloudSync: v })} label={t('desktop.p4.cloudSync')} disabled={!settings?.features.cloudSaves} />
          <Toggle checked={config.workshopAutoSync} onChange={(v) => void updateConfig({ workshopAutoSync: v })} label={t('desktop.p4.workshopAutoSync')} disabled={!settings?.features.workshop} />
          <Toggle checked={config.overlayEnabled} onChange={(v) => void updateConfig({ overlayEnabled: v })} label={t('desktop.p4.overlay')} />
          <Toggle checked={config.discordRpc} onChange={(v) => void updateConfig({ discordRpc: v })} label={t('desktop.p4.discord')} disabled={!settings?.discordAppId} />
          {!settings?.discordAppId && <p className="text-xs text-muted">{t('desktop.p4.discordHint')}</p>}
          <Toggle checked={config.startInBigPicture} onChange={(v) => void updateConfig({ startInBigPicture: v })} label={t('desktop.p4.bigPicture')} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('desktop.p4.overlayHotkey')}>
              <Input defaultValue={config.overlayHotkey} onBlur={(e) => e.target.value !== config.overlayHotkey && void updateConfig({ overlayHotkey: e.target.value.trim() })} />
            </Field>
            <Field label={t('desktop.p4.screenshotHotkey')}>
              <Input defaultValue={config.screenshotHotkey} onBlur={(e) => e.target.value !== config.screenshotHotkey && void updateConfig({ screenshotHotkey: e.target.value.trim() })} />
            </Field>
          </div>
          <p className="text-xs text-muted">{t('desktop.p4.hotkeyHint')}</p>
          <Button
            size="sm"
            icon={<RefreshCw className="size-4" />}
            loading={busy === 'workshop'}
            onClick={() => void run('workshop', () => desktop.workshopSync(), (r) => t('desktop.p4.workshopSynced', { installed: r.installed, updated: r.updated, removed: r.removed }))}
          >
            {t('desktop.p4.workshopSyncNow')}
          </Button>
        </div>
      </Card>

      <Card title={t('desktop.p4.steam')}>
        {steam.data?.found ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t('desktop.p4.steamHint')}</p>
            {steam.data.running && <Badge tone="warning">{t('desktop.p4.steamRunning')}</Badge>}
            <div className="flex flex-wrap gap-2">
              <Select className="w-auto" value={steamUser} onChange={(e) => setSteamUser(e.target.value)}>
                <option value="">{t('desktop.p4.allSteamUsers')}</option>
                {steam.data.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.id})
                  </option>
                ))}
              </Select>
              <Button
                variant="primary"
                loading={busy === 'steam'}
                onClick={() => void run('steam', () => desktop.steamSyncShortcuts(steamUser || null), (r) => t('desktop.p4.synced', { added: r.added, updated: r.updated, removed: r.removed }))}
              >
                {t('desktop.p4.steamSync')}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">{steam.isLoading ? t('common.loading') : t('desktop.p4.steamNotFound')}</p>
        )}
      </Card>

      <Card title={t('desktop.p4.remotePlay')}>
        <p className="mb-3 text-sm text-muted">{t('desktop.p4.remotePlayHint')}</p>
        {sunshine.data?.found ? (
          <Button
            icon={<MonitorPlay className="size-4" />}
            loading={busy === 'sunshine'}
            onClick={() => void run('sunshine', () => desktop.sunshineSync(), (r) => t('desktop.p4.synced', { added: r.added, updated: r.updated, removed: r.removed }))}
          >
            {t('desktop.p4.sunshineSync')}
          </Button>
        ) : (
          <p className="text-sm">
            {t('desktop.p4.sunshineNotFound')}{' '}
            <button type="button" className="text-accent hover:underline" onClick={() => void desktop.openUrl('https://github.com/LizardByte/Sunshine')}>
              Sunshine
            </button>{' '}
            ·{' '}
            <button type="button" className="text-accent hover:underline" onClick={() => void desktop.openUrl('https://moonlight-stream.org')}>
              Moonlight
            </button>
          </p>
        )}
      </Card>

      <Card title={t('desktop.p4.import')}>
        <p className="mb-3 text-sm text-muted">{t('desktop.p4.importHint')}</p>
        <div className="flex flex-wrap gap-2">
          <Input className="w-auto flex-1 font-mono text-xs" value={scanPath} onChange={(e) => setScanPath(e.target.value)} placeholder="/home/…/Games" />
          <Button
            onClick={async () => {
              const p = await desktop.pickFolder();
              if (p) setScanPath(p);
            }}
          >
            {t('desktop.p4.pick')}
          </Button>
          <Button
            variant="primary"
            icon={<FolderSearch className="size-4" />}
            disabled={!scanPath}
            loading={busy === 'scan'}
            onClick={async () => {
              setBusy('scan');
              try {
                setCandidates(await desktop.scanFolder(scanPath));
              } catch (e) {
                toast.error(desktopError(e));
              } finally {
                setBusy(null);
              }
            }}
          >
            {t('desktop.p4.scan')}
          </Button>
        </div>
        {candidates && (
          <ul className="mt-3 divide-y divide-border">
            {candidates.length === 0 && <p className="py-2 text-sm text-muted">{t('desktop.p4.noCandidates')}</p>}
            {candidates.map((c) => (
              <li key={c.path} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {c.title} <span className="text-muted">v{c.version}</span>
                  </p>
                  <p className="truncate font-mono text-xs text-muted">{c.path}</p>
                </div>
                <Badge tone={c.confidence >= 0.95 ? 'success' : c.confidence >= 0.5 ? 'warning' : 'default'}>
                  {t('desktop.p4.matched', { matched: c.matchedFiles, total: c.totalFiles })}
                </Badge>
                <Button
                  size="sm"
                  icon={<Download className="size-4" />}
                  loading={busy === c.path}
                  onClick={() =>
                    void run(c.path, () => desktop.importGame(c.path, c.gameId, c.buildId), () => {
                      void reload();
                      setCandidates((list) => list?.filter((x) => x.path !== c.path) ?? null);
                      return t('desktop.p4.imported', { title: c.title });
                    })
                  }
                >
                  {t('desktop.p4.importButton')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
