import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ROLES, type InviteDto, type Role } from '@gameserver/shared';
import { Badge, Button, Card, CopyField, Field, Input, PageLoader, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { toast } from '../../lib/toast';

export default function InvitesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const invites = useQuery({ queryKey: ['admin', 'invites'], queryFn: () => api.admin.invites() });
  const [form, setForm] = useState({ role: 'USER' as Role, maxUses: '1', expires: '14', note: '' });
  const [created, setCreated] = useState<InviteDto | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.admin.createInvite({ role: form.role, maxUses: Number(form.maxUses) || 1, expiresInDays: form.expires ? Number(form.expires) : null, note: form.note || undefined }),
    onSuccess: (i) => {
      setCreated(i);
      void qc.invalidateQueries({ queryKey: ['admin', 'invites'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const state = (i: InviteDto) =>
    i.revoked ? (
      <Badge tone="danger">{t('admin.invitesPage.revoked')}</Badge>
    ) : i.expiresAt && new Date(i.expiresAt) < new Date() ? (
      <Badge>{t('admin.invitesPage.expired')}</Badge>
    ) : i.uses >= i.maxUses ? (
      <Badge>{i.uses}/{i.maxUses}</Badge>
    ) : (
      <Badge tone="success">{t('admin.invitesPage.active')}</Badge>
    );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('admin.invites')}</h1>
      <Card title={t('admin.invitesPage.create')}>
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label={t('admin.usersPage.role')}>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('admin.invitesPage.maxUses')}>
            <Input type="number" min={1} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} />
          </Field>
          <Field label={t('admin.invitesPage.expires')}>
            <Input type="number" min={1} max={365} value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} />
          </Field>
          <Field label={t('admin.invitesPage.note')}>
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={200} />
          </Field>
          <Button type="submit" variant="primary" loading={create.isPending} className="lg:col-span-4 lg:w-fit">
            {t('admin.invitesPage.create')}
          </Button>
        </form>
        {created && (
          <div className="mt-4">
            <CopyField value={created.url} />
          </div>
        )}
      </Card>
      {invites.isLoading ? (
        <PageLoader />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted uppercase">
              <tr>
                <th className="p-3">Code</th>
                <th className="p-3">{t('admin.usersPage.role')}</th>
                <th className="p-3">{t('admin.invitesPage.uses')}</th>
                <th className="hidden p-3 md:table-cell">{t('admin.invitesPage.note')}</th>
                <th className="hidden p-3 md:table-cell">{t('common.created')}</th>
                <th className="p-3">{t('common.status')}</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invites.data?.map((i) => (
                <tr key={i.id}>
                  <td className="p-3 font-mono">
                    <button type="button" className="hover:text-accent" title={i.url} onClick={() => void navigator.clipboard?.writeText(i.url).then(() => toast.success(t('common.copied')))}>
                      {i.code}
                    </button>
                  </td>
                  <td className="p-3">{t(`roles.${i.role}`)}</td>
                  <td className="p-3">
                    {i.uses}/{i.maxUses}
                  </td>
                  <td className="hidden p-3 text-muted md:table-cell">{i.note}</td>
                  <td className="hidden p-3 text-muted md:table-cell">
                    {formatDateTime(i.createdAt)}
                    {i.expiresAt && <div className="text-xs">→ {formatDateTime(i.expiresAt)}</div>}
                  </td>
                  <td className="p-3">{state(i)}</td>
                  <td className="p-3 text-right">
                    {!i.revoked && (
                      <Button size="sm" variant="ghost" onClick={() => void api.admin.revokeInvite(i.id).then(() => invites.refetch())}>
                        {t('admin.invitesPage.revoke')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
