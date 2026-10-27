import { useQuery } from '@tanstack/react-query';
import { ArrowUpCircle, Download, FolderOpen, Pause, Play, Settings2, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { GameDetail, InstalledGame, RunnerInfo } from '@gameserver/shared';
import { PlatformIcon } from '../components/PlatformIcons';
import { Badge, Button, Card, Field, Input, Modal, ProgressBar, Select, Tabs, Textarea, Toggle } from '../components/ui';
import { formatBytes, formatPlaytime } from '../lib/format';
import { toast } from '../lib/toast';
import { desktop, desktopError } from './bridge';
import { activeDownloads, useDesktopRequired } from './DesktopProvider';
import { envToText, installableVersions, parseEnv } from './util';

async function run(fn: () => Promise<unknown>, success?: string) {
  try {
    await fn();
    if (success) toast.success(success);
  } catch (err) {
    toast.error(desktopError(err));
  }
}

function InstallDialog({ game, onClose }: { game: GameDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const { config, platform, updateConfig } = useDesktopRequired();
  const host = platform?.platform ?? 'LINUX';
  const versions = installableVersions(game, host);
  const [versionId, setVersionId] = useState(versions[0]?.version.id ?? '');
  const [folder, setFolder] = useState(config.defaultLibraryFolder ?? config.libraryFolders[0] ?? '');
  const space = useQuery({ queryKey: ['disk', folder], queryFn: () => desktop.diskSpace(folder), enabled: !!folder });
  const selected = versions.find((v) => v.version.id === versionId);
  const needed = selected ? Math.max(selected.build.installSize, selected.build.totalSize) : 0;
  const enough = !space.data || space.data.free > needed;

  const pickOther = async () => {
    const picked = await desktop.pickFolder();
    if (picked) {
      setFolder(picked);
      if (!config.libraryFolders.includes(picked)) await updateConfig({ libraryFolders: [...config.libraryFolders, picked] });
    }
  };

  return (
    <Modal open onClose={onClose} title={t('desktop.installTitle', { title: game.title })}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await desktop.installGame({ gameId: game.id, versionId: versionId === versions[0]?.version.id ? null : versionId, libraryFolder: folder });
            onClose();
          });
        }}
      >
        <Field label={t('desktop.installTo')}>
          <div className="flex gap-2">
            <Select value={folder} onChange={(e) => setFolder(e.target.value)}>
              {[...new Set([...config.libraryFolders, folder])].filter(Boolean).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
            <Button onClick={() => void pickOther()} icon={<FolderOpen className="size-4" />}>
              {t('desktop.otherFolder')}
            </Button>
          </div>
        </Field>
        {versions.length > 1 && (
          <Field label={t('desktop.version')}>
            <Select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
              {versions.map((v, i) => (
                <option key={v.version.id} value={v.version.id}>
                  {i === 0 ? t('desktop.latestVersion', { version: v.version.version }) : v.version.version}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {selected && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <PlatformIcon platform={selected.build.platform} />
            <span>{t(`buildKinds.${selected.build.kind}`)}</span>
            <span className="text-muted">{t('desktop.needSpace', { size: formatBytes(needed) })}</span>
            {space.data && (
              <span className={enough ? 'text-muted' : 'text-danger'}>{t('desktop.freeSpace', { free: formatBytes(space.data.free) })}</span>
            )}
          </div>
        )}
        {selected?.build.platform === 'WINDOWS' && host === 'LINUX' && <p className="text-xs text-muted">{t('desktop.windowsOnLinux')}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" icon={<Download className="size-4" />} disabled={!selected || !folder || !enough}>
            {t('desktop.install')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type ManageTab = 'options' | 'versions' | 'files' | 'uninstall';

export function ManageGameModal({ installed, game, onClose }: { installed: InstalledGame; game?: GameDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const { platform } = useDesktopRequired();
  const [tab, setTab] = useState<ManageTab>('options');
  const [args, setArgs] = useState(installed.options.args);
  const [env, setEnv] = useState(envToText(installed.options.env));
  const [runnerId, setRunnerId] = useState(installed.options.runnerId ?? '');
  const [useRunner, setUseRunner] = useState(installed.options.useRunner);
  const [autoUpdate, setAutoUpdate] = useState(installed.autoUpdate);
  const [runners, setRunners] = useState<RunnerInfo[]>([]);
  const [removePrefix, setRemovePrefix] = useState(false);
  const [removeAll, setRemoveAll] = useState(false);
  const host = platform?.platform ?? 'LINUX';
  const windowsOnLinux = host === 'LINUX' && installed.platform === 'WINDOWS';
  const versions = game ? installableVersions(game, host) : [];
  const [versionId, setVersionId] = useState(installed.versionId);

  useEffect(() => {
    if (windowsOnLinux) void desktop.listRunners().then(setRunners);
  }, [windowsOnLinux]);

  const save = () =>
    run(
      () => desktop.setGameOptions(installed.gameId, { args, env: parseEnv(env), runnerId: runnerId || null, useRunner }, autoUpdate),
      t('common.saved'),
    );

  return (
    <Modal open onClose={onClose} title={t('desktop.manageTitle', { title: installed.title })} wide>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'options', label: t('desktop.launchOptions') },
          ...(versions.length > 0 ? [{ id: 'versions' as const, label: t('desktop.versionSelect') }] : []),
          { id: 'files', label: t('admin.builds.files') },
          { id: 'uninstall', label: t('desktop.uninstall') },
        ]}
      />
      <div className="mt-4 space-y-4">
        {tab === 'options' && (
          <>
            <Field label={t('desktop.extraArgs')}>
              <Input value={args} onChange={(e) => setArgs(e.target.value)} className="font-mono" placeholder="-windowed" />
            </Field>
            <Field label={t('desktop.envVars')}>
              <Textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={3} className="font-mono text-xs" placeholder={'DXVK_HUD=fps\nPROTON_ENABLE_NVAPI=1'} />
            </Field>
            {windowsOnLinux && (
              <>
                <Toggle checked={useRunner} onChange={setUseRunner} label={t('desktop.useRunner')} />
                <Field label={t('desktop.runner')} hint={runners.length === 0 ? t('desktop.noRunners') : undefined}>
                  <Select value={runnerId} onChange={(e) => setRunnerId(e.target.value)}>
                    <option value="">{t('desktop.runnerAuto')}</option>
                    {runners.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
            <Toggle checked={autoUpdate} onChange={setAutoUpdate} label={t('desktop.autoUpdate')} />
            <Button variant="primary" onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </>
        )}
        {tab === 'versions' && (
          <>
            {installed.pinnedVersionId && <Badge tone="warning">{t('desktop.pinned')}</Badge>}
            <Field label={t('desktop.version')}>
              <Select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
                {versions.map((v, i) => (
                  <option key={v.version.id} value={v.version.id}>
                    {i === 0 ? t('desktop.latestVersion', { version: v.version.version }) : v.version.version}
                    {v.version.id === installed.versionId ? ` – ${t('desktop.installed')}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="primary"
              disabled={versionId === installed.versionId}
              onClick={() =>
                void run(async () => {
                  await desktop.updateGame(installed.gameId, versionId);
                  onClose();
                })
              }
            >
              {t('desktop.switchVersion')}
            </Button>
          </>
        )}
        {tab === 'files' && (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">{t('desktop.location')}</dt>
              <dd className="font-mono text-xs break-all">{installed.installDir}</dd>
              <dt className="text-muted">{t('desktop.sizeOnDisk')}</dt>
              <dd>{formatBytes(installed.sizeOnDisk)}</dd>
              <dt className="text-muted">{t('desktop.version')}</dt>
              <dd>
                {installed.version} ({t(`platforms.${installed.platform}`)}, {t(`buildKinds.${installed.kind}`)})
              </dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button icon={<FolderOpen className="size-4" />} onClick={() => void run(() => desktop.openPath(installed.installDir))}>
                {t('desktop.openFolder')}
              </Button>
              <Button
                onClick={() =>
                  void run(async () => {
                    await desktop.repairGame(installed.gameId);
                    onClose();
                  })
                }
              >
                {t('desktop.verify')}
              </Button>
            </div>
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm font-medium">{t('desktop.shortcuts')}</p>
              <Toggle
                checked={installed.shortcuts.desktop}
                onChange={(v) => void run(() => desktop.createShortcuts(installed.gameId, v, installed.shortcuts.menu))}
                label={t('desktop.shortcutDesktop')}
              />
              <Toggle
                checked={installed.shortcuts.menu}
                onChange={(v) => void run(() => desktop.createShortcuts(installed.gameId, installed.shortcuts.desktop, v))}
                label={t('desktop.shortcutMenu')}
              />
            </div>
          </>
        )}
        {tab === 'uninstall' && (
          <>
            <p className="text-sm">{t('desktop.uninstallConfirm')}</p>
            {windowsOnLinux && <Toggle checked={removePrefix} onChange={setRemovePrefix} label={t('desktop.removePrefix')} />}
            <Toggle checked={removeAll} onChange={setRemoveAll} label={t('desktop.removeAll')} />
            <Button
              variant="danger"
              onClick={() =>
                void run(async () => {
                  await desktop.uninstallGame(installed.gameId, removePrefix, removeAll);
                  onClose();
                })
              }
            >
              {t('desktop.uninstall')}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Ersetzt im Desktop-Client die Download-Karte der Spielseite: Installieren, Spielen, Updates, Verwalten. */
export function GameInstallPanel({ game }: { game: GameDetail }) {
  const { t } = useTranslation();
  const { installedById, downloads, running, play, platform } = useDesktopRequired();
  const [installOpen, setInstallOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const installed = installedById.get(game.id);
  const job = useMemo(() => activeDownloads(downloads).find((d) => d.gameId === game.id), [downloads, game.id]);
  const isRunning = running.has(game.id);
  const host = platform?.platform ?? 'LINUX';
  const versions = installableVersions(game, host);
  const latest = versions[0];
  const updateTo = installed && !installed.pinnedVersionId && latest && latest.version.id !== installed.versionId ? latest.version : null;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        {job ? (
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex justify-between text-sm">
              <span>{t(`desktop.states.${job.state}`)}</span>
              <span className="text-muted">
                {formatBytes(job.downloadedBytes)} / {formatBytes(job.totalBytes)}
                {job.speed > 0 && ` · ${formatBytes(job.speed)}/s`}
              </span>
            </div>
            <ProgressBar value={job.totalBytes ? job.downloadedBytes / job.totalBytes : 0} />
          </div>
        ) : installed ? (
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t('desktop.installedVersion', { version: installed.version })}</p>
            <p className="text-xs text-muted">
              {formatBytes(installed.sizeOnDisk)}
              {installed.localPlaytimeSeconds > 0 && ` · ${formatPlaytime(installed.localPlaytimeSeconds)}`}
            </p>
            {installed.pinnedVersionId && <p className="text-xs text-warning">{t('desktop.pinned')}</p>}
          </div>
        ) : (
          <p className="flex-1 text-sm text-muted">{latest ? `${t('desktop.notInstalled')} · ${formatBytes(latest.build.totalSize)}` : t('store.noBuilds')}</p>
        )}

        <div className="flex flex-wrap gap-2">
          {job ? (
            job.state === 'paused' ? (
              <Button icon={<Play className="size-4" />} onClick={() => void desktop.resumeDownload(job.id)}>
                {t('admin.uploads.resume')}
              </Button>
            ) : (
              <Button icon={<Pause className="size-4" />} onClick={() => void desktop.pauseDownload(job.id)}>
                {t('admin.uploads.pause')}
              </Button>
            )
          ) : installed ? (
            <>
              {updateTo && (
                <Button icon={<ArrowUpCircle className="size-4" />} onClick={() => void run(() => desktop.updateGame(game.id))}>
                  {t('desktop.updateAvailable', { version: updateTo.version })}
                </Button>
              )}
              <Button variant="ghost" icon={<Settings2 className="size-4" />} onClick={() => setManageOpen(true)}>
                {t('desktop.manage')}
              </Button>
              {isRunning ? (
                <Button variant="danger" size="lg" icon={<Square className="size-4" />} onClick={() => void run(() => desktop.stopGame(game.id))}>
                  {t('desktop.stop')}
                </Button>
              ) : (
                <Button variant="success" size="lg" icon={<Play className="size-5" />} onClick={() => void play(game.id)}>
                  {t('desktop.play')}
                </Button>
              )}
            </>
          ) : (
            latest && (
              <Button variant="primary" size="lg" icon={<Download className="size-5" />} onClick={() => setInstallOpen(true)}>
                {t('desktop.install')}
              </Button>
            )
          )}
          {job && (
            <Link to="/downloads" className="self-center text-sm text-accent hover:underline">
              {t('desktop.downloads')}
            </Link>
          )}
        </div>
      </div>
      {installOpen && <InstallDialog game={game} onClose={() => setInstallOpen(false)} />}
      {manageOpen && installed && <ManageGameModal installed={installed} game={game} onClose={() => setManageOpen(false)} />}
    </Card>
  );
}
