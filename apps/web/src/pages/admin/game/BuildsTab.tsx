import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileArchive, FolderUp, Plus, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILD_KINDS, PLATFORMS, type BuildDto, type BuildKind, type LinuxRunner, type ManagedGame, type Platform, type VersionDto } from '@gameserver/shared';
import { Markdown } from '../../../components/Markdown';
import { PlatformIcon } from '../../../components/PlatformIcons';
import { Badge, Button, Card, ConfirmButton, EmptyState, Field, Input, Modal, Select, Textarea } from '../../../components/ui';
import { api, errorMessage } from '../../../lib/api';
import { formatBytes, formatDate } from '../../../lib/format';
import { toast } from '../../../lib/toast';
import { enqueueUploads, useUploadQueue } from '../../../lib/uploads';
import { UploadRow } from '../UploadQueue';

const ACCEPT: Record<BuildKind, string> = {
  ZIP: '.zip',
  SEVEN_ZIP: '.7z',
  INSTALLER: '.exe,.msi,.sh,.run,.deb,.rpm,.AppImage,.appimage,.pkg,.dmg',
  FOLDER: '',
};

/** Entfernt den obersten Ordnernamen bei Ordner-Uploads (webkitRelativePath = "MeinSpiel/bin/game"). */
function relativePath(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (!rel) return file.name;
  const parts = rel.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : rel;
}

function BuildFiles({ build, onChange }: { build: BuildDto; onChange: () => void }) {
  const { t } = useTranslation();
  const files = useQuery({ queryKey: ['admin', 'build-files', build.id], queryFn: () => api.manage.buildFiles(build.id) });
  if (!files.data) return null;
  if (files.data.length === 0) return <p className="text-sm text-muted">{t('admin.builds.noFiles')}</p>;
  return (
    <div className="max-h-72 overflow-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface-2 text-left text-muted">
          <tr>
            <th className="p-2">{t('common.name')}</th>
            <th className="p-2 text-right">{t('admin.backupsPage.size')}</th>
            <th className="hidden p-2 md:table-cell">{t('admin.builds.sha256')}</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {files.data.map((f) => (
            <tr key={f.id}>
              <td className="p-2 font-mono break-all">{f.path}</td>
              <td className="p-2 text-right whitespace-nowrap">{formatBytes(f.size)}</td>
              <td className="hidden p-2 font-mono text-muted md:table-cell" title={f.sha256}>
                {f.sha256.slice(0, 16)}…
              </td>
              <td className="p-2 text-right">
                <button
                  type="button"
                  className="text-muted hover:text-danger"
                  aria-label={t('common.delete')}
                  onClick={() =>
                    void api.manage
                      .deleteBuildFile(build.id, f.id)
                      .then(() => {
                        void files.refetch();
                        onChange();
                      })
                      .catch((err) => toast.error(errorMessage(err)))
                  }
                >
                  <Trash2 className="size-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BuildCard({ game, version, build, onChange }: { game: ManagedGame; version: VersionDto; build: BuildDto; onChange: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(build.status !== 'READY');
  const [cfg, setCfg] = useState({
    executable: build.executable,
    launchArgs: build.launchArgs,
    workingDir: build.workingDir,
    installerArgs: build.installerArgs,
    linuxRunner: build.linuxRunner,
    installSize: String(build.installSize),
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const queue = useUploadQueue().filter((i) => i.buildId === build.id && i.progress.state !== 'completed');

  const afterUpload = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'build-files', build.id] });
    onChange();
  };
  const startUpload = (list: FileList | null) => {
    if (!list?.length) return;
    const files = Array.from(list).map((file) => ({ file, path: build.kind === 'FOLDER' ? relativePath(file) : file.name }));
    enqueueUploads(build.id, files, `${game.title} ${version.version} ${build.platform}`, afterUpload);
  };

  const save = useMutation({
    mutationFn: (extra: Partial<{ status: BuildDto['status'] }> = {}) =>
      api.manage.updateBuild(build.id, {
        executable: cfg.executable,
        launchArgs: cfg.launchArgs,
        workingDir: cfg.workingDir,
        installerArgs: cfg.installerArgs,
        linuxRunner: cfg.linuxRunner,
        installSize: Number(cfg.installSize) || 0,
        ...extra,
      }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      onChange();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="rounded-md border border-border">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-surface-2/50">
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <PlatformIcon platform={build.platform} className="size-5" />
        <span className="font-semibold">{t(`platforms.${build.platform}`)}</span>
        <span className="text-sm text-muted">{t(`buildKinds.${build.kind}`)}</span>
        <Badge tone={build.status === 'READY' ? 'success' : 'default'}>{build.status === 'READY' ? t('admin.builds.ready') : t('admin.builds.draft')}</Badge>
        <span className="ml-auto text-xs text-muted">
          {build.fileCount} {t('admin.builds.files')} · {formatBytes(build.totalSize)}
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-border p-4">
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              multiple={build.kind === 'FOLDER'}
              accept={ACCEPT[build.kind] || undefined}
              onChange={(e) => {
                startUpload(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={folderInput}
              type="file"
              className="hidden"
              // @ts-expect-error – nicht standardisiertes Attribut für Ordner-Uploads
              webkitdirectory=""
              directory=""
              multiple
              onChange={(e) => {
                startUpload(e.target.files);
                e.target.value = '';
              }}
            />
            {build.kind === 'FOLDER' ? (
              <>
                <Button size="sm" icon={<FolderUp className="size-4" />} onClick={() => folderInput.current?.click()}>
                  {t('admin.builds.uploadFolder')}
                </Button>
                <Button size="sm" icon={<Upload className="size-4" />} onClick={() => fileInput.current?.click()}>
                  {t('admin.builds.uploadFiles')}
                </Button>
              </>
            ) : (
              <Button size="sm" icon={<FileArchive className="size-4" />} onClick={() => fileInput.current?.click()}>
                {t('admin.builds.uploadArchive')}
              </Button>
            )}
          </div>
          {queue.length > 0 && (
            <div className="max-h-60 space-y-2 overflow-y-auto">
              {queue.slice(0, 50).map((i) => (
                <UploadRow key={i.key} item={i} />
              ))}
            </div>
          )}
          <BuildFiles build={build} onChange={onChange} />

          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({});
            }}
          >
            {build.kind !== 'INSTALLER' ? (
              <Field label={t('admin.builds.executable')} hint={t('admin.builds.executableHint')}>
                <Input value={cfg.executable} onChange={(e) => setCfg({ ...cfg, executable: e.target.value })} className="font-mono" />
              </Field>
            ) : (
              <Field label={t('admin.builds.installerArgs')}>
                <Input value={cfg.installerArgs} onChange={(e) => setCfg({ ...cfg, installerArgs: e.target.value })} className="font-mono" />
              </Field>
            )}
            <Field label={t('admin.builds.launchArgs')}>
              <Input value={cfg.launchArgs} onChange={(e) => setCfg({ ...cfg, launchArgs: e.target.value })} className="font-mono" placeholder="--fullscreen" />
            </Field>
            {build.kind === 'INSTALLER' && (
              <Field label={t('admin.builds.executable')} hint={t('admin.builds.executableHint')}>
                <Input value={cfg.executable} onChange={(e) => setCfg({ ...cfg, executable: e.target.value })} className="font-mono" />
              </Field>
            )}
            <Field label={t('admin.builds.workingDir')}>
              <Input value={cfg.workingDir} onChange={(e) => setCfg({ ...cfg, workingDir: e.target.value })} className="font-mono" />
            </Field>
            <Field label={t('admin.builds.installSize')}>
              <Input type="number" min={0} value={cfg.installSize} onChange={(e) => setCfg({ ...cfg, installSize: e.target.value })} />
            </Field>
            {build.platform === 'WINDOWS' && (
              <Field label={t('admin.builds.linuxRunner')}>
                <Select value={cfg.linuxRunner} onChange={(e) => setCfg({ ...cfg, linuxRunner: e.target.value as LinuxRunner })}>
                  {(['NONE', 'PROTON', 'WINE'] as LinuxRunner[]).map((r) => (
                    <option key={r} value={r}>
                      {t(`runners.${r}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="flex flex-wrap items-center gap-2 md:col-span-2">
              <Button type="submit" loading={save.isPending}>
                {t('admin.builds.saveConfig')}
              </Button>
              {build.status === 'READY' ? (
                <Button onClick={() => save.mutate({ status: 'DRAFT' })}>{t('admin.builds.markDraft')}</Button>
              ) : (
                <Button variant="success" onClick={() => save.mutate({ status: 'READY' })}>
                  {t('admin.builds.markReady')}
                </Button>
              )}
              <ConfirmButton className="ml-auto" onConfirm={() => void api.manage.deleteBuild(build.id).then(onChange).catch((e) => toast.error(errorMessage(e)))}>
                {t('admin.builds.deleteBuild')}
              </ConfirmButton>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function VersionCard({ game, version, onChange }: { game: ManagedGame; version: VersionDto; onChange: () => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [changelog, setChangelog] = useState(version.changelog);
  const [newBuild, setNewBuild] = useState<{ platform: Platform; kind: BuildKind } | null>(null);
  const usedPlatforms = new Set(version.builds.map((b) => b.platform));
  const freePlatforms = PLATFORMS.filter((p) => !usedPlatforms.has(p));

  const run = (fn: () => Promise<unknown>) => () => void fn().then(onChange).catch((err) => toast.error(errorMessage(err)));

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {t('store.version')} {version.version}
          <Badge tone={version.published ? 'success' : 'default'}>{version.published ? t('admin.builds.published') : t('admin.builds.draft')}</Badge>
          <span className="text-xs font-normal text-muted">{formatDate(version.publishedAt ?? version.createdAt)}</span>
        </span>
      }
      actions={
        <>
          {version.published ? (
            <Button size="sm" onClick={run(() => api.manage.updateVersion(version.id, { published: false }))}>
              {t('admin.builds.unpublish')}
            </Button>
          ) : (
            <Button size="sm" variant="success" onClick={run(() => api.manage.updateVersion(version.id, { published: true }))}>
              {t('admin.builds.publish')}
            </Button>
          )}
          <ConfirmButton size="sm" onConfirm={run(() => api.manage.deleteVersion(version.id))}>
            {t('admin.builds.deleteVersion')}
          </ConfirmButton>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium">{t('admin.builds.changelog')}</span>
            <button type="button" className="text-xs text-accent hover:underline" onClick={() => setEditing((e) => !e)}>
              {editing ? t('common.cancel') : t('common.edit')}
            </button>
          </div>
          {editing ? (
            <div className="space-y-2">
              <Textarea value={changelog} onChange={(e) => setChangelog(e.target.value)} rows={6} className="font-mono" />
              <Button
                size="sm"
                variant="primary"
                onClick={run(async () => {
                  await api.manage.updateVersion(version.id, { changelog });
                  setEditing(false);
                })}
              >
                {t('common.save')}
              </Button>
            </div>
          ) : version.changelog ? (
            <Markdown>{version.changelog}</Markdown>
          ) : (
            <p className="text-sm text-muted">–</p>
          )}
        </div>
        <div className="space-y-2">
          {version.builds.map((b) => (
            <BuildCard key={b.id} game={game} version={version} build={b} onChange={onChange} />
          ))}
        </div>
        {freePlatforms.length > 0 && (
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setNewBuild({ platform: freePlatforms[0], kind: 'ZIP' })}>
            {t('admin.builds.addBuild')}
          </Button>
        )}
      </div>
      <Modal open={!!newBuild} onClose={() => setNewBuild(null)} title={t('admin.builds.addBuild')}>
        {newBuild && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api.manage.createBuild(version.id, newBuild);
                setNewBuild(null);
              })();
            }}
          >
            <Field label={t('admin.builds.platform')}>
              <Select value={newBuild.platform} onChange={(e) => setNewBuild({ ...newBuild, platform: e.target.value as Platform })}>
                {freePlatforms.map((p) => (
                  <option key={p} value={p}>
                    {t(`platforms.${p}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('admin.builds.kind')}>
              <Select value={newBuild.kind} onChange={(e) => setNewBuild({ ...newBuild, kind: e.target.value as BuildKind })}>
                {BUILD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`buildKinds.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setNewBuild(null)}>{t('common.cancel')}</Button>
              <Button type="submit" variant="primary">
                {t('common.create')}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}

export function BuildsTab({ game, onChange }: { game: ManagedGame; onChange: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ version: '', changelog: '' });
  const create = useMutation({
    mutationFn: () => api.manage.createVersion(game.id, form.version, form.changelog),
    onSuccess: () => {
      setOpen(false);
      setForm({ version: '', changelog: '' });
      onChange();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-muted">{t('admin.builds.buildHelp')}</p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
          {t('admin.builds.newVersion')}
        </Button>
      </div>
      {game.versions.length === 0 ? (
        <EmptyState title={t('admin.builds.noVersions')} />
      ) : (
        game.versions.map((v) => <VersionCard key={v.id} game={game} version={v} onChange={onChange} />)
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('admin.builds.newVersion')}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label={t('admin.builds.versionLabel')}>
            <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} required maxLength={50} placeholder="1.0.0" autoFocus />
          </Field>
          <Field label={t('admin.builds.changelog')} hint={t('common.markdownHint')}>
            <Textarea value={form.changelog} onChange={(e) => setForm({ ...form, changelog: e.target.value })} rows={5} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              {t('common.create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
