import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientReleaseDto, ClientReleaseFileDto } from '@gameserver/shared';
import { Markdown } from '../../components/Markdown';
import { PlatformIcon } from '../../components/PlatformIcons';
import { Badge, Button, Card, ConfirmButton, EmptyState, Field, Input, Modal, PageLoader, Spinner, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatBytes, formatDate } from '../../lib/format';
import { toast } from '../../lib/toast';

function SignatureEditor({ file, onSaved }: { file: ClientReleaseFileDto; onSaved: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [sig, setSig] = useState('');
  const sigInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        <Badge tone={file.hasSignature ? 'success' : 'warning'}>{file.hasSignature ? t('admin.clientReleasesPage.signed') : t('admin.clientReleasesPage.unsigned')}</Badge>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={file.filename}>
        <div className="space-y-3">
          <Field label={t('admin.clientReleasesPage.signature')}>
            <Textarea value={sig} onChange={(e) => setSig(e.target.value)} rows={5} className="font-mono text-xs" />
          </Field>
          <input
            ref={sigInput}
            type="file"
            accept=".sig"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setSig((await f.text()).trim());
              e.target.value = '';
            }}
          />
          <div className="flex gap-2">
            <Button onClick={() => sigInput.current?.click()}>.sig …</Button>
            <Button
              variant="primary"
              onClick={() =>
                void api.client
                  .setSignature(file.id, sig.trim() || null)
                  .then(() => {
                    setOpen(false);
                    onSaved();
                  })
                  .catch((e) => toast.error(errorMessage(e)))
              }
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function ReleaseCard({ release, onChange }: { release: ClientReleaseDto; onChange: () => void }) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        if (f.name.endsWith('.sig')) continue;
        await api.client.uploadFile(release.id, f, f.name);
      }
      // Passende .sig-Dateien automatisch zuordnen
      const latest = (await api.client.releases()).find((r) => r.id === release.id);
      for (const sigFile of Array.from(files).filter((f) => f.name.endsWith('.sig'))) {
        const target = latest?.files.find((x) => `${x.filename}.sig` === sigFile.name);
        if (target) await api.client.setSignature(target.id, (await sigFile.text()).trim());
      }
      onChange();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {release.version}
          <Badge tone={release.published ? 'success' : 'default'}>{release.published ? t('admin.builds.published') : t('admin.builds.draft')}</Badge>
          <span className="text-xs font-normal text-muted">{formatDate(release.publishedAt ?? release.createdAt)}</span>
        </span>
      }
      actions={
        <>
          <input ref={fileInput} type="file" multiple className="hidden" accept=".msi,.exe,.AppImage,.appimage,.deb,.rpm,.dmg,.gz,.sig" onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
          <Button size="sm" icon={uploading ? <Spinner className="size-4" /> : <Upload className="size-4" />} disabled={uploading} onClick={() => fileInput.current?.click()}>
            {t('admin.media.upload')}
          </Button>
          <Button
            size="sm"
            variant={release.published ? 'secondary' : 'success'}
            onClick={() => void api.client.updateRelease(release.id, { published: !release.published }).then(onChange).catch((e) => toast.error(errorMessage(e)))}
          >
            {release.published ? t('admin.clientReleasesPage.unpublish') : t('admin.clientReleasesPage.publish')}
          </Button>
          <ConfirmButton size="sm" onConfirm={() => void api.client.deleteRelease(release.id).then(onChange)}>
            {t('common.delete')}
          </ConfirmButton>
        </>
      }
    >
      {release.notes && <Markdown className="mb-3">{release.notes}</Markdown>}
      {release.files.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.clientReleasesPage.upload')}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {release.files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 py-2">
              <PlatformIcon platform={f.platform} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.filename}</span>
              <span className="text-xs text-muted">
                {f.format} · {f.arch} · {formatBytes(f.size)}
              </span>
              <SignatureEditor file={f} onSaved={onChange} />
              <button type="button" className="text-muted hover:text-danger" onClick={() => void api.client.deleteFile(f.id).then(onChange)} aria-label={t('common.delete')}>
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function ClientReleasesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const releases = useQuery({ queryKey: ['admin', 'client-releases'], queryFn: () => api.client.releases() });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ version: '', notes: '' });
  const reload = () => void qc.invalidateQueries({ queryKey: ['admin', 'client-releases'] });
  const create = useMutation({
    mutationFn: () => api.client.createRelease(form.version, form.notes),
    onSuccess: () => {
      setOpen(false);
      setForm({ version: '', notes: '' });
      reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">{t('admin.clientReleases')}</h1>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
          {t('admin.clientReleasesPage.newRelease')}
        </Button>
      </div>
      <p className="text-sm text-muted">{t('admin.clientReleasesPage.text')}</p>
      <p className="text-xs text-muted">{t('admin.clientReleasesPage.howto')}</p>
      {releases.isLoading ? (
        <PageLoader />
      ) : releases.data!.length === 0 ? (
        <EmptyState title={t('admin.clientReleasesPage.none')} />
      ) : (
        releases.data!.map((r) => <ReleaseCard key={r.id} release={r} onChange={reload} />)
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('admin.clientReleasesPage.newRelease')}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label={t('admin.clientReleasesPage.version')}>
            <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} required pattern="\d+\.\d+\.\d+(-[\w.]+)?" placeholder="0.3.0" autoFocus />
          </Field>
          <Field label={t('admin.clientReleasesPage.notes')} hint={t('common.markdownHint')}>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={5} />
          </Field>
          <Button type="submit" variant="primary" loading={create.isPending}>
            {t('common.create')}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
