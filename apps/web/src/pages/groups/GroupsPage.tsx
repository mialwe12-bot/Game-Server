import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Search, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import type { GroupJoinPolicy, GroupSummary, GroupVisibility } from '@gameserver/shared';
import { Avatar } from '../../components/Avatar';
import { Badge, Button, EmptyState, Field, Input, Modal, PageLoader, Select, Tabs, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { toast } from '../../lib/toast';

export function GroupCard({ g }: { g: GroupSummary }) {
  const { t } = useTranslation();
  return (
    <Link to={`/groups/${g.slug}`} className="flex gap-3 rounded-lg border border-border bg-surface p-4 transition hover:border-accent">
      <Avatar user={{ username: g.name, avatarUrl: g.avatarUrl }} size={56} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-semibold">{g.name}</h3>
        <p className="line-clamp-2 text-sm text-muted">{g.summary}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Users className="size-3.5" />
          {t('social.groups.memberCount', { count: g.memberCount })}
          {g.joinPolicy !== 'OPEN' && <Badge>{t(`social.groups.policy.${g.joinPolicy}`)}</Badge>}
          {g.visibility === 'HIDDEN' && <Badge tone="warning">{t('social.groups.hidden')}</Badge>}
        </p>
      </div>
    </Link>
  );
}

export default function GroupsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'mine' | 'all'>('mine');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const groups = useQuery({ queryKey: ['groups', tab, query], queryFn: () => api.groups.list(tab === 'mine' ? { mine: true } : { q: query || undefined }) });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('social.groups.title')}</h1>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          {t('social.groups.create')}
        </Button>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'mine', label: t('social.groups.mine') },
          { id: 'all', label: t('social.groups.browse') },
        ]}
      />
      {tab === 'all' && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('social.groups.search')} />
          <Button type="submit" icon={<Search className="size-4" />}>
            {t('common.search')}
          </Button>
        </form>
      )}
      {groups.isLoading ? (
        <PageLoader />
      ) : groups.data?.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {groups.data.map((g) => (
            <GroupCard key={g.id} g={g} />
          ))}
        </div>
      ) : (
        <EmptyState title={tab === 'mine' ? t('social.groups.noneMine') : t('social.groups.none')} />
      )}
      {creating && <GroupFormModal onClose={() => setCreating(false)} />}
    </div>
  );
}

export function GroupFormModal({
  onClose,
  initial,
}: {
  onClose: () => void;
  initial?: { id: string; name: string; summary: string; description: string; joinPolicy: GroupJoinPolicy; visibility: GroupVisibility };
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    summary: initial?.summary ?? '',
    description: initial?.description ?? '',
    joinPolicy: initial?.joinPolicy ?? ('OPEN' as GroupJoinPolicy),
    visibility: initial?.visibility ?? ('PUBLIC' as GroupVisibility),
  });
  const save = useMutation({
    mutationFn: () => (initial ? api.groups.update(initial.id, form) : api.groups.create(form)),
    onSuccess: (g) => {
      onClose();
      if (!initial) navigate(`/groups/${g.slug}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={initial ? t('social.groups.edit') : t('social.groups.create')} wide>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label={t('common.name')}>
          <Input required minLength={2} maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t('social.groups.summary')}>
          <Input maxLength={300} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
        </Field>
        <Field label={t('social.groups.description')} hint={t('common.markdownHint')}>
          <Textarea rows={6} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('social.groups.joinPolicy')}>
            <Select value={form.joinPolicy} onChange={(e) => setForm({ ...form, joinPolicy: e.target.value as GroupJoinPolicy })}>
              {(['OPEN', 'REQUEST', 'INVITE'] as const).map((p) => (
                <option key={p} value={p}>
                  {t(`social.groups.policy.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('social.groups.visibility')}>
            <Select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as GroupVisibility })}>
              <option value="PUBLIC">{t('social.groups.public')}</option>
              <option value="HIDDEN">{t('social.groups.hidden')}</option>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {initial ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
