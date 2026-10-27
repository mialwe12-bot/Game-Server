import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { VISIBILITIES, type GameVisibility, type ManagedGame, type SystemRequirements } from '@gameserver/shared';
import { Markdown } from '../../../components/Markdown';
import { Button, Card, ConfirmButton, Field, Input, Select, Tabs, Textarea, Toggle } from '../../../components/ui';
import { api, errorMessage } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { toast } from '../../../lib/toast';

const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function MarkdownEditor({ value, onChange, rows = 10 }: { value: string; onChange: (v: string) => void; rows?: number }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex justify-end">
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => setPreview((p) => !p)}>
          {preview ? t('common.edit') : t('common.preview')}
        </button>
      </div>
      {preview ? (
        <div className="min-h-24 rounded-md border border-border p-3">
          <Markdown>{value || '–'}</Markdown>
        </div>
      ) : (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} className="font-mono" />
      )}
      <p className="text-xs text-muted">{t('common.markdownHint')}</p>
    </div>
  );
}

export function DetailsTab({ game, onSaved }: { game: ManagedGame; onSaved: (g: ManagedGame) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: game.title,
    slug: game.slug,
    shortDescription: game.shortDescription,
    description: game.description,
    developer: game.developer ?? '',
    publisher: game.publisher ?? '',
    releaseDate: game.releaseDate?.slice(0, 10) ?? '',
    website: game.website ?? '',
    trailerUrls: game.trailerUrls.join('\n'),
    genres: game.genres.map((g) => g.name).join(', '),
    tags: game.tags.map((g) => g.name).join(', '),
    visibility: game.visibility,
    featured: game.featured,
  });
  const [req, setReq] = useState<SystemRequirements>(game.systemRequirements);
  const [reqTab, setReqTab] = useState<'windows' | 'linux' | 'macos'>('windows');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const save = useMutation({
    mutationFn: () =>
      api.manage.updateGame(game.id, {
        title: form.title,
        slug: form.slug,
        shortDescription: form.shortDescription,
        description: form.description,
        developer: form.developer || null,
        publisher: form.publisher || null,
        releaseDate: form.releaseDate || null,
        website: form.website || null,
        trailerUrls: form.trailerUrls.split('\n').map((s) => s.trim()).filter(Boolean),
        genres: splitList(form.genres),
        tags: splitList(form.tags),
        visibility: form.visibility,
        featured: form.featured,
        systemRequirements: req,
      }),
    onSuccess: (g) => {
      onSaved(g);
      toast.success(t('common.saved'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = async () => {
    try {
      await api.manage.deleteGame(game.id);
      navigate('/admin/games');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('admin.gameTitle')}>
            <Input value={form.title} onChange={set('title')} required maxLength={200} />
          </Field>
          <Field label={t('admin.slug')}>
            <Input value={form.slug} onChange={set('slug')} pattern="[a-z0-9\-]{1,80}" required />
          </Field>
          <Field label={t('admin.game.shortDescription')} className="md:col-span-2">
            <Textarea value={form.shortDescription} onChange={set('shortDescription')} maxLength={500} rows={2} />
          </Field>
          <div className="md:col-span-2">
            <span className="text-sm font-medium">{t('admin.game.description')}</span>
            <MarkdownEditor value={form.description} onChange={(v) => setForm({ ...form, description: v })} rows={14} />
          </div>
          <Field label={t('admin.game.developer')}>
            <Input value={form.developer} onChange={set('developer')} maxLength={200} />
          </Field>
          <Field label={t('admin.game.publisher')}>
            <Input value={form.publisher} onChange={set('publisher')} maxLength={200} />
          </Field>
          <Field label={t('admin.game.releaseDate')}>
            <Input type="date" value={form.releaseDate} onChange={set('releaseDate')} />
          </Field>
          <Field label={t('admin.game.website')}>
            <Input type="url" value={form.website} onChange={set('website')} placeholder="https://" />
          </Field>
          <Field label={t('admin.game.genres')}>
            <Input value={form.genres} onChange={set('genres')} placeholder="Action, RPG" />
          </Field>
          <Field label={t('admin.game.tags')}>
            <Input value={form.tags} onChange={set('tags')} placeholder="Open Source, Coop" />
          </Field>
          <Field label={t('admin.game.trailers')} className="md:col-span-2">
            <Textarea value={form.trailerUrls} onChange={set('trailerUrls')} rows={3} className="font-mono text-xs" />
          </Field>
        </div>
      </Card>

      <Card title={t('admin.game.sysreq')}>
        <Tabs
          value={reqTab}
          onChange={setReqTab}
          tabs={[
            { id: 'windows', label: t('platforms.WINDOWS') },
            { id: 'linux', label: t('platforms.LINUX') },
            { id: 'macos', label: t('platforms.MACOS') },
          ]}
        />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label={t('store.minimum')}>
            <Textarea
              rows={6}
              value={req[reqTab]?.minimum ?? ''}
              onChange={(e) => setReq({ ...req, [reqTab]: { ...req[reqTab], minimum: e.target.value } })}
              placeholder={'- OS: Ubuntu 22.04\n- CPU: 2 GHz\n- RAM: 4 GB'}
            />
          </Field>
          <Field label={t('store.recommendedReq')}>
            <Textarea
              rows={6}
              value={req[reqTab]?.recommended ?? ''}
              onChange={(e) => setReq({ ...req, [reqTab]: { ...req[reqTab], recommended: e.target.value } })}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <div className="grid gap-4 md:grid-cols-2 md:items-end">
          <Field label={t('admin.game.visibility')}>
            <Select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as GameVisibility })}>
              {VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {t(`visibility.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          {user?.role === 'ADMIN' && <Toggle checked={form.featured} onChange={(v) => setForm({ ...form, featured: v })} label={t('admin.game.featured')} />}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t('common.save')}
        </Button>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted">
          {t('admin.game.deleteGameText')}
          <ConfirmButton onConfirm={remove}>{t('admin.game.deleteGame')}</ConfirmButton>
        </div>
      </div>
    </form>
  );
}
