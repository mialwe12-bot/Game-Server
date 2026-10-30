import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, Eye, EyeOff, ImagePlus, Package, Pencil, ThumbsDown, ThumbsUp, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../../components/Avatar';
import { Markdown } from '../../components/Markdown';
import { UserLink } from '../../components/Social';
import { Badge, Button, Card, ConfirmButton, ErrorState, Field, Input, PageLoader, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBytes, formatDate, formatDateTime } from '../../lib/format';
import { toast } from '../../lib/toast';

/** Detailseite eines Workshop-Inhalts mit Versionen, Bewertung, Abo und Kommentaren */
export default function WorkshopItemPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const item = useQuery({ queryKey: ['workshop', 'item', id], queryFn: () => api.workshop.item(id) });
  const comments = useQuery({ queryKey: ['workshop', 'comments', id], queryFn: () => api.workshop.comments(id), enabled: item.isSuccess });
  const [comment, setComment] = useState('');
  const [upload, setUpload] = useState<{ file: File | null; version: string; changelog: string; progress: number | null }>({ file: null, version: '', changelog: '', progress: null });
  const [editing, setEditing] = useState<{ title: string; description: string; tags: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['workshop'] });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      void refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (item.isLoading) return <PageLoader />;
  if (item.error) return <ErrorState error={item.error} />;
  const i = item.data!;
  const own = user?.id === i.author?.id;

  const pickPreview = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => input.files?.[0] && void run(() => api.workshop.uploadPreview(i.id, input.files![0]));
    input.click();
  };

  const doUpload = async () => {
    if (!upload.file) return;
    setUpload({ ...upload, progress: 0 });
    try {
      await api.workshop.uploadVersion(i.id, upload.file, upload.file.name, upload.version.trim(), upload.changelog);
      toast.success(t('workshop.versionUploaded'));
      setUpload({ file: null, version: '', changelog: '', progress: null });
      void refresh();
    } catch (e) {
      setUpload({ ...upload, progress: null });
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link to={`/game/${i.game.slug}/workshop`} className="text-sm text-accent hover:underline">
        ← {i.game.title} · {t('social.community.tabs.workshop')}
      </Link>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-surface-2">
            {i.previewUrl ? <img src={api.url(i.previewUrl)} alt="" className="size-full object-cover" /> : <Package className="absolute inset-0 m-auto size-16 text-muted" />}
            {i.canEdit && (
              <Button size="sm" className="absolute top-2 right-2" icon={<ImagePlus className="size-4" />} onClick={pickPreview}>
                {t('workshop.preview')}
              </Button>
            )}
          </div>
          {editing ? (
            <Card>
              <div className="space-y-2">
                <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} maxLength={120} />
                <Input value={editing.tags} onChange={(e) => setEditing({ ...editing, tags: e.target.value })} placeholder={t('workshop.tags')} />
                <Textarea rows={10} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    onClick={() =>
                      void run(() =>
                        api.workshop.update(i.id, {
                          title: editing.title,
                          description: editing.description,
                          tags: editing.tags
                            .split(',')
                            .map((x) => x.trim())
                            .filter(Boolean),
                        }),
                      ).then(() => setEditing(null))
                    }
                  >
                    {t('common.save')}
                  </Button>
                  <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="flex flex-wrap items-start gap-2">
                <h1 className="flex-1 text-2xl font-bold">{i.title}</h1>
                {i.canEdit && <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditing({ title: i.title, description: i.description, tags: i.tags.join(', ') })} />}
              </div>
              <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
                <Badge>{t(`workshop.kinds.${i.kind}`)}</Badge>
                {i.tags.map((tag) => (
                  <Badge key={tag}>#{tag}</Badge>
                ))}
                {i.hidden && <Badge tone="warning">{t('workshop.hiddenBadge')}</Badge>}
              </p>
              {i.description ? <Markdown>{i.description}</Markdown> : <p className="text-muted">—</p>}
            </Card>
          )}

          <Card title={t('workshop.comments')}>
            <ul className="mb-3 divide-y divide-border">
              {comments.data?.map((c) => (
                <li key={c.id} className="flex gap-3 py-2">
                  {c.author && <Avatar user={c.author} size={32} />}
                  <div className="min-w-0 flex-1 text-sm">
                    <p>
                      {c.author ? <UserLink user={c.author} /> : '—'} <span className="text-xs text-muted">{formatDateTime(c.createdAt)}</span>
                    </p>
                    <p className="whitespace-pre-wrap">{c.body}</p>
                  </div>
                  {(c.author?.id === user?.id || i.canEdit) && (
                    <button type="button" className="text-muted hover:text-danger" onClick={() => void run(() => api.workshop.deleteComment(c.id))} aria-label={t('common.delete')}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              ))}
              {!comments.data?.length && <p className="py-2 text-sm text-muted">{t('workshop.noComments')}</p>}
            </ul>
            {user && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => api.workshop.comment(i.id, comment)).then(() => setComment(''));
                }}
              >
                <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('workshop.commentPlaceholder')} maxLength={5000} required />
                <Button type="submit">{t('social.forum.send')}</Button>
              </form>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <div className="space-y-3">
              {user && (
                <Button
                  className="w-full"
                  variant={i.subscribed ? 'secondary' : 'primary'}
                  icon={<Download className="size-4" />}
                  disabled={!i.latestVersion}
                  onClick={() => void run(() => (i.subscribed ? api.workshop.unsubscribe(i.id) : api.workshop.subscribe(i.id)))}
                >
                  {i.subscribed ? t('workshop.unsubscribe') : t('workshop.subscribe')}
                </Button>
              )}
              <p className="text-xs text-muted">{t('workshop.subscribeHint')}</p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={i.myRating === true ? 'primary' : 'secondary'}
                  icon={<ThumbsUp className="size-4" />}
                  disabled={!user || own}
                  onClick={() => void run(() => api.workshop.rate(i.id, i.myRating === true ? null : true))}
                >
                  {i.up}
                </Button>
                <Button
                  size="sm"
                  variant={i.myRating === false ? 'danger' : 'secondary'}
                  icon={<ThumbsDown className="size-4" />}
                  disabled={!user || own}
                  onClick={() => void run(() => api.workshop.rate(i.id, i.myRating === false ? null : false))}
                >
                  {i.down}
                </Button>
                <span className="ml-auto text-sm text-muted">{t('workshop.subscribers', { count: i.subscribers })}</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted">{t('workshop.author')}</dt>
                <dd>{i.author ? <UserLink user={i.author} /> : '—'}</dd>
                <dt className="text-muted">{t('common.created')}</dt>
                <dd>{formatDate(i.createdAt)}</dd>
                <dt className="text-muted">{t('common.updated')}</dt>
                <dd>{formatDate(i.updatedAt)}</dd>
              </dl>
              {i.canEdit && !own && (
                <Button size="sm" icon={i.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />} onClick={() => void run(() => api.workshop.moderate(i.id, !i.hidden))}>
                  {i.hidden ? t('workshop.unhide') : t('workshop.hide')}
                </Button>
              )}
              {i.canEdit && (
                <ConfirmButton size="sm" icon={<Trash2 className="size-4" />} onConfirm={() => void api.workshop.remove(i.id).then(() => navigate(`/game/${i.game.slug}/workshop`))}>
                  {t('common.delete')}
                </ConfirmButton>
              )}
            </div>
          </Card>

          <Card title={t('workshop.versions')}>
            <ul className="space-y-3">
              {i.versions.map((v, idx) => (
                <li key={v.id} className={clsx('text-sm', idx > 0 && 'opacity-80')}>
                  <p className="flex items-center gap-2 font-medium">
                    v{v.version}
                    {idx === 0 && <Badge tone="success">{t('workshop.latest')}</Badge>}
                    <span className="ml-auto text-xs text-muted">{formatBytes(v.size)}</span>
                  </p>
                  <p className="text-xs text-muted">{formatDate(v.createdAt)}</p>
                  {v.changelog && <p className="mt-1 whitespace-pre-wrap text-xs">{v.changelog}</p>}
                  <div className="mt-1 flex gap-2">
                    {user && (
                      <a href={api.url(v.downloadUrl)} className="text-xs text-accent hover:underline">
                        {t('common.download')}
                      </a>
                    )}
                    {i.canEdit && (
                      <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => window.confirm(t('common.reallyDelete')) && void run(() => api.workshop.deleteVersion(i.id, v.id))}>
                        {t('common.delete')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
              {!i.versions.length && <p className="text-sm text-muted">{t('workshop.noVersion')}</p>}
            </ul>
          </Card>
        </aside>
      </div>

      {i.canEdit && <UploadForm onSubmit={doUpload} state={upload} setState={setUpload} />}
    </div>
  );
}

function UploadForm({
  state,
  setState,
  onSubmit,
}: {
  state: { file: File | null; version: string; changelog: string; progress: number | null };
  setState: (s: { file: File | null; version: string; changelog: string; progress: number | null }) => void;
  onSubmit: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <Card title={t('workshop.newVersion')}>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_160px]"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <Field label={t('workshop.file')} hint={t('workshop.fileHint')}>
          <input type="file" accept=".zip,.7z" required onChange={(e) => setState({ ...state, file: e.target.files?.[0] ?? null })} />
        </Field>
        <Field label={t('workshop.versionLabel')}>
          <Input required maxLength={40} value={state.version} onChange={(e) => setState({ ...state, version: e.target.value })} placeholder="1.0" />
        </Field>
        <Field label={t('workshop.changelog')} className="sm:col-span-2">
          <Textarea rows={3} value={state.changelog} onChange={(e) => setState({ ...state, changelog: e.target.value })} />
        </Field>
        <div>
          <Button type="submit" variant="primary" icon={<Upload className="size-4" />} loading={state.progress !== null}>
            {t('workshop.upload')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
