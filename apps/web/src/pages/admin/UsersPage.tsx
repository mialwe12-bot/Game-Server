import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ROLES, type AdminUserDto, type Role } from '@gameserver/shared';
import { Avatar } from '../../components/Avatar';
import { Badge, Button, ConfirmButton, ErrorState, Field, Input, Modal, PageLoader, Pagination, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBytes, formatDateTime } from '../../lib/format';
import { toast } from '../../lib/toast';

function UserModal({ user, onClose }: { user: AdminUserDto; onClose: () => void }) {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [role, setRole] = useState<Role>(user.role);
  const [quota, setQuota] = useState(user.uploadQuotaBytes === null ? '' : String(user.uploadQuotaBytes));
  const [password, setPassword] = useState('');
  const sessions = useQuery({ queryKey: ['admin', 'user-sessions', user.id], queryFn: () => api.admin.userSessions(user.id) });
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    toast.success(t('common.saved'));
  };
  const update = useMutation({
    mutationFn: (data: Parameters<typeof api.admin.updateUser>[1]) => api.admin.updateUser(user.id, data),
    onSuccess: done,
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Modal open onClose={onClose} title={user.username} wide>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.usersPage.role')}>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('admin.usersPage.quota')} hint={`${t('admin.usersPage.used')}: ${formatBytes(user.usedUploadBytes)}`}>
            <Input type="number" min={0} value={quota} onChange={(e) => setQuota(e.target.value)} />
          </Field>
        </div>
        <Button
          variant="primary"
          loading={update.isPending}
          onClick={() => update.mutate({ role, uploadQuotaBytes: quota === '' ? null : Number(quota) })}
        >
          {t('common.save')}
        </Button>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {user.id !== me?.id && (
            <Button variant={user.disabled ? 'success' : 'danger'} onClick={() => update.mutate({ disabled: !user.disabled })}>
              {user.disabled ? t('admin.usersPage.enable') : t('admin.usersPage.disable')}
            </Button>
          )}
          {user.totpEnabled && <ConfirmButton onConfirm={() => update.mutate({ resetTotp: true })}>{t('admin.usersPage.reset2fa')}</ConfirmButton>}
          {user.id !== me?.id && (
            <ConfirmButton
              onConfirm={() =>
                void api.admin
                  .deleteUser(user.id)
                  .then(() => {
                    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
                    onClose();
                  })
                  .catch((e) => toast.error(errorMessage(e)))
              }
            >
              {t('common.delete')}
            </ConfirmButton>
          )}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ password });
            setPassword('');
          }}
        >
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} placeholder={t('admin.usersPage.setPassword')} required autoComplete="new-password" />
          <Button type="submit">{t('admin.usersPage.setPassword')}</Button>
        </form>

        <div>
          <h3 className="mb-2 font-semibold">{t('admin.usersPage.sessions')}</h3>
          <ul className="divide-y divide-border text-sm">
            {sessions.data?.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-2">
                <Badge>{s.kind}</Badge>
                <span className="flex-1 truncate">
                  {s.name ?? s.userAgent} · {s.ip} · {formatDateTime(s.lastUsedAt)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => void api.admin.revokeUserSession(user.id, s.id).then(() => sessions.refetch())}>
                  {t('account.revoke')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

function NewUserModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'USER' as Role });
  const create = useMutation({
    mutationFn: () => api.admin.createUser(form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={t('admin.usersPage.newUser')}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label={t('auth.username')}>
          <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
        </Field>
        <Field label={t('auth.email')}>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </Field>
        <Field label={t('auth.password')} hint={t('auth.passwordHint')}>
          <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={10} required autoComplete="new-password" />
        </Field>
        <Field label={t('admin.usersPage.role')}>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="primary" loading={create.isPending}>
          {t('common.create')}
        </Button>
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminUserDto | null>(null);
  const [creating, setCreating] = useState(false);
  const users = useQuery({
    queryKey: ['admin', 'users', q, role, page],
    queryFn: () => api.admin.users({ q: q || undefined, role: role || undefined, page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">{t('admin.users')}</h1>
        <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder={t('admin.usersPage.search')} className="max-w-xs" />
        <Select value={role} onChange={(e) => (setRole(e.target.value as Role | ''), setPage(1))} className="w-auto">
          <option value="">{t('common.all')}</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </Select>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          {t('admin.usersPage.newUser')}
        </Button>
      </div>
      {users.isLoading ? (
        <PageLoader />
      ) : users.error ? (
        <ErrorState error={users.error} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-muted uppercase">
                <tr>
                  <th className="p-3">{t('auth.username')}</th>
                  <th className="p-3">{t('admin.usersPage.role')}</th>
                  <th className="hidden p-3 md:table-cell">{t('admin.usersPage.lastLogin')}</th>
                  <th className="hidden p-3 lg:table-cell">{t('admin.usersPage.library')}</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.data!.items.map((u) => (
                  <tr key={u.id} className="hover:bg-surface-2/50">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Avatar user={u} size={28} />
                        <div>
                          <Link to={`/u/${u.username}`} className="font-medium hover:text-accent">
                            {u.username}
                          </Link>
                          <p className="text-xs text-muted">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={u.role === 'ADMIN' ? 'accent' : 'default'}>{t(`roles.${u.role}`)}</Badge>
                        {u.disabled && <Badge tone="danger">{t('admin.usersPage.disabled')}</Badge>}
                        {u.totpEnabled && <Badge tone="success">2FA</Badge>}
                      </div>
                    </td>
                    <td className="hidden p-3 text-muted md:table-cell">{formatDateTime(u.lastLoginAt)}</td>
                    <td className="hidden p-3 text-muted lg:table-cell">{u.libraryCount}</td>
                    <td className="p-3 text-right">
                      <Button size="sm" onClick={() => setSelected(u)}>
                        {t('common.edit')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={50} total={users.data!.total} onChange={setPage} />
        </>
      )}
      {selected && <UserModal user={users.data?.items.find((u) => u.id === selected.id) ?? selected} onClose={() => setSelected(null)} />}
      {creating && <NewUserModal onClose={() => setCreating(false)} />}
    </div>
  );
}
