import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pin, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnnouncementDto } from '@gameserver/shared';
import { Markdown } from '../../components/Markdown';
import { Badge, Button, Card, ConfirmButton, EmptyState, Field, Input, Modal, PageLoader, Select, Textarea, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { toast } from '../../lib/toast';

type Form = { id?: string; title: string; body: string; pinned: boolean; published: boolean; gameId: string };

export default function AnnouncementsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin', 'announcements'], queryFn: () => api.admin.announcements() });
  const games = useQuery({ queryKey: ['admin', 'games', ''], queryFn: () => api.manage.games() });
  const [form, setForm] = useState<Form | null>(null);
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'announcements'] });
    void qc.invalidateQueries({ queryKey: ['store-home'] });
  };
  const save = useMutation({
    mutationFn: (f: Form) => {
      const data = { title: f.title, body: f.body, pinned: f.pinned, published: f.published, gameId: f.gameId || null };
      return f.id ? api.admin.updateAnnouncement(f.id, data) : api.admin.createAnnouncement(data);
    },
    onSuccess: () => {
      setForm(null);
      reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const edit = (a: AnnouncementDto) => setForm({ id: a.id, title: a.title, body: a.body, pinned: a.pinned, published: a.published, gameId: a.gameId ?? '' });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('admin.announcements')}</h1>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ title: '', body: '', pinned: false, published: true, gameId: '' })}>
          {t('admin.announcementsPage.new')}
        </Button>
      </div>
      {list.isLoading ? (
        <PageLoader />
      ) : list.data!.length === 0 ? (
        <EmptyState title="–" />
      ) : (
        list.data!.map((a) => (
          <Card
            key={a.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {a.pinned && <Pin className="size-4 text-accent" />}
                {a.title}
                {!a.published && <Badge>{t('admin.builds.draft')}</Badge>}
                {a.gameTitle && <Badge tone="accent">{a.gameTitle}</Badge>}
              </span>
            }
            actions={
              <>
                <Button size="sm" onClick={() => edit(a)}>
                  {t('common.edit')}
                </Button>
                <ConfirmButton size="sm" onConfirm={() => void api.admin.deleteAnnouncement(a.id).then(reload)}>
                  {t('common.delete')}
                </ConfirmButton>
              </>
            }
          >
            <p className="mb-2 text-xs text-muted">
              {formatDateTime(a.createdAt)} · {a.author?.username}
            </p>
            <Markdown>{a.body}</Markdown>
          </Card>
        ))
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? t('common.edit') : t('admin.announcementsPage.new')} wide>
        {form && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
          >
            <Field label={t('admin.announcementsPage.title')}>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
            </Field>
            <Field label={t('admin.announcementsPage.body')} hint={t('common.markdownHint')}>
              <Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={8} required />
            </Field>
            <Field label={t('admin.announcementsPage.game')}>
              <Select value={form.gameId} onChange={(e) => setForm({ ...form, gameId: e.target.value })}>
                <option value="">–</option>
                {games.data?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-6">
              <Toggle checked={form.published} onChange={(v) => setForm({ ...form, published: v })} label={t('admin.announcementsPage.published')} />
              <Toggle checked={form.pinned} onChange={(v) => setForm({ ...form, pinned: v })} label={t('admin.announcementsPage.pinned')} />
            </div>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {t('common.save')}
            </Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
