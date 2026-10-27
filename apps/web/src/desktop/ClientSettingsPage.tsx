import { useMutation, useQuery } from '@tanstack/react-query';
import { FolderPlus, Gamepad2, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientUpdateInfo } from '@gameserver/shared';
import { Badge, Button, Card, Field, Input, Select, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatBytes } from '../lib/format';
import { toast } from '../lib/toast';
import { desktop, desktopError } from './bridge';
import { useDesktopRequired } from './DesktopProvider';

function FolderRow({ path, isDefault, onDefault, onRemove }: { path: string; isDefault: boolean; onDefault: () => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const space = useQuery({ queryKey: ['disk', path], queryFn: () => desktop.diskSpace(path) });
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <span className="min-w-0 flex-1 truncate font-mono text-sm">{path}</span>
      {space.data && <span className="text-xs text-muted">{t('desktop.freeSpace', { free: formatBytes(space.data.free) })}</span>}
      {isDefault ? (
        <Badge tone="accent">{t('desktop.defaultFolder')}</Badge>
      ) : (
        <Button size="sm" variant="ghost" onClick={onDefault}>
          {t('desktop.makeDefault')}
        </Button>
      )}
      {!isDefault && (
        <button type="button" className="text-muted hover:text-danger" onClick={onRemove} aria-label={t('common.remove')}>
          <Trash2 className="size-4" />
        </button>
      )}
    </li>
  );
}

export default function ClientSettingsPage() {
  const { t } = useTranslation();
  const { config, updateConfig, platform } = useDesktopRequired();
  const { user, settings } = useAuth();
  const runners = useQuery({ queryKey: ['runners'], queryFn: () => desktop.listRunners(false), enabled: platform?.os === 'linux' });
  const [bandwidth, setBandwidth] = useState(String(config.bandwidthLimitKbps));
  const [update, setUpdate] = useState<ClientUpdateInfo | null>(null);
  const checkUpdate = useMutation({
    mutationFn: () => desktop.checkClientUpdate(),
    onSuccess: setUpdate,
    onError: (e) => toast.error(desktopError(e)),
  });
  const gameUpdates = useMutation({
    mutationFn: () => desktop.checkGameUpdates(),
    onSuccess: (list) => (list.length ? toast.info(list.map((g) => g.title).join(', ')) : toast.success(t('desktop.noUpdates'))),
    onError: (e) => toast.error(desktopError(e)),
  });

  const addFolder = async () => {
    const picked = await desktop.pickFolder();
    if (picked && !config.libraryFolders.includes(picked)) await updateConfig({ libraryFolders: [...config.libraryFolders, picked] });
  };
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">{t('desktop.clientSettings')}</h1>

      <Card title={t('desktop.account')}>
        <p className="text-sm">{t('desktop.loggedInAs', { name: user?.username ?? '–', server: settings?.siteName ? `${settings.siteName} (${api.baseUrl})` : api.baseUrl })}</p>
      </Card>

      <Card title={t('desktop.libraryFolders')} actions={<Button size="sm" icon={<FolderPlus className="size-4" />} onClick={() => void addFolder()}>{t('desktop.addFolder')}</Button>}>
        <p className="mb-2 text-sm text-muted">{t('desktop.libraryFoldersHint')}</p>
        <ul className="divide-y divide-border">
          {config.libraryFolders.map((f) => (
            <FolderRow
              key={f}
              path={f}
              isDefault={f === config.defaultLibraryFolder}
              onDefault={() => void updateConfig({ defaultLibraryFolder: f })}
              onRemove={() => void updateConfig({ libraryFolders: config.libraryFolders.filter((x) => x !== f) })}
            />
          ))}
        </ul>
      </Card>

      <Card title={t('desktop.downloadSettings')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('desktop.bandwidth')}>
            <Input
              type="number"
              min={0}
              value={bandwidth}
              onChange={(e) => setBandwidth(e.target.value)}
              onBlur={() => void updateConfig({ bandwidthLimitKbps: Math.max(0, Number(bandwidth) || 0) })}
            />
          </Field>
          <Field label={t('desktop.parallelChunks')}>
            <Select value={config.maxConcurrentChunks} onChange={(e) => void updateConfig({ maxConcurrentChunks: Number(e.target.value) })}>
              {[1, 2, 4, 6, 8, 12, 16].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <div className="space-y-3 md:col-span-2">
            <Toggle
              checked={config.schedule.enabled}
              onChange={(v) => void updateConfig({ schedule: { ...config.schedule, enabled: v } })}
              label={t('desktop.scheduleEnabled')}
            />
            {config.schedule.enabled && (
              <div className="grid grid-cols-2 gap-4">
                <Field label={t('desktop.scheduleFrom')}>
                  <Select value={config.schedule.startHour} onChange={(e) => void updateConfig({ schedule: { ...config.schedule, startHour: Number(e.target.value) } })}>
                    {hours.map((h) => (
                      <option key={h} value={h}>
                        {h}:00
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('desktop.scheduleTo')}>
                  <Select value={config.schedule.endHour} onChange={(e) => void updateConfig({ schedule: { ...config.schedule, endHour: Number(e.target.value) } })}>
                    {hours.map((h) => (
                      <option key={h} value={h}>
                        {h}:00
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </div>
          <Toggle checked={config.autoUpdateGames} onChange={(v) => void updateConfig({ autoUpdateGames: v })} label={t('desktop.autoUpdateGames')} />
          <Button size="sm" className="w-fit" loading={gameUpdates.isPending} onClick={() => gameUpdates.mutate()}>
            {t('desktop.checkUpdates')}
          </Button>
        </div>
      </Card>

      {platform?.os === 'linux' && (
        <Card
          title={t('desktop.compatibility')}
          actions={
            <Button size="sm" icon={<RefreshCw className="size-4" />} onClick={() => void desktop.listRunners(true).then(() => runners.refetch())}>
              {t('desktop.refreshRunners')}
            </Button>
          }
        >
          {runners.data?.length ? (
            <Field label={t('desktop.defaultRunner')}>
              <Select value={config.defaultRunnerId ?? ''} onChange={(e) => void updateConfig({ defaultRunnerId: e.target.value || null })}>
                <option value="">{t('desktop.runnerAuto')}</option>
                {runners.data.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.path})
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <p className="text-sm text-muted">{t('desktop.noRunners')}</p>
          )}
        </Card>
      )}

      <Card title={t('desktop.behavior')}>
        <div className="space-y-3">
          <Toggle checked={config.closeToTray} onChange={(v) => void updateConfig({ closeToTray: v })} label={t('desktop.closeToTray')} />
          <Toggle checked={config.startMinimized} onChange={(v) => void updateConfig({ startMinimized: v })} label={t('desktop.startMinimized')} />
          <Toggle checked={config.autostart} onChange={(v) => void updateConfig({ autostart: v })} label={t('desktop.autostart')} />
          <Toggle checked={config.notifications} onChange={(v) => void updateConfig({ notifications: v })} label={t('desktop.notifications')} />
        </div>
      </Card>

      <Card title={t('desktop.system')}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">{t('desktop.clientVersion')}</dt>
          <dd>{platform?.clientVersion}</dd>
          <dt className="text-muted">OS</dt>
          <dd>
            {platform?.os} ({platform?.arch}) · {platform?.hostname}
          </dd>
        </dl>
        <div className="mt-2 flex flex-wrap gap-2">
          {platform?.steamDeck && (
            <Badge tone="accent">
              <Gamepad2 className="size-3" /> {t('desktop.steamDeck')}
            </Badge>
          )}
          {platform?.gamingMode && <Badge tone="accent">{t('desktop.gamingMode')}</Badge>}
        </div>
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <p className="text-sm font-medium">{t('desktop.clientUpdate')}</p>
          <Button size="sm" loading={checkUpdate.isPending} onClick={() => checkUpdate.mutate()}>
            {t('desktop.checkClientUpdate')}
          </Button>
          {update && !update.available && <p className="text-sm text-success">{t('desktop.clientUpToDate')}</p>}
          {update?.available && (
            <div className="space-y-2 text-sm">
              <p>{t('desktop.clientUpdateAvailable', { version: update.version })}</p>
              {update.canInstall ? (
                <Button variant="primary" onClick={() => void desktop.installClientUpdate().catch((e) => toast.error(desktopError(e)))}>
                  {t('desktop.installClientUpdate')}
                </Button>
              ) : (
                update.downloadUrl && (
                  <Button variant="primary" onClick={() => void desktop.openUrl(update.downloadUrl!)}>
                    {t('desktop.downloadClientUpdate')}
                  </Button>
                )
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
