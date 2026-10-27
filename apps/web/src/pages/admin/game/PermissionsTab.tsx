import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ManagedGame, UserPublic } from '@gameserver/shared';
import { Avatar } from '../../../components/Avatar';
import { Button, Card, Input } from '../../../components/ui';
import { api, errorMessage } from '../../../lib/api';
import { toast } from '../../../lib/toast';

function UserList({
  title,
  hint,
  users,
  onAdd,
  onRemove,
}: {
  title: string;
  hint: string;
  users: UserPublic[];
  onAdd: (username: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  return (
    <Card title={title}>
      <p className="mb-3 text-sm text-muted">{hint}</p>
      <ul className="mb-4 divide-y divide-border">
        {users.map((u) => (
          <li key={u.id} className="flex items-center gap-3 py-2">
            <Avatar user={u} size={28} />
            <span className="flex-1 text-sm">
              {u.displayName || u.username} <span className="text-muted">@{u.username}</span>
            </span>
            <button type="button" className="text-muted hover:text-danger" onClick={() => void onRemove(u.id)} aria-label={t('common.remove')}>
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await onAdd(name);
          setName('');
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('admin.permissions.username')} required />
        <Button type="submit">{t('common.add')}</Button>
      </form>
    </Card>
  );
}

export function PermissionsTab({ game, onSaved }: { game: ManagedGame; onSaved: (g: ManagedGame) => void }) {
  const { t } = useTranslation();
  const wrap = (fn: () => Promise<ManagedGame>) => async () => {
    try {
      onSaved(await fn());
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <UserList
        title={t('admin.permissions.maintainers')}
        hint={t('admin.permissions.maintainersHint')}
        users={game.maintainers}
        onAdd={(u) => wrap(() => api.manage.addMaintainer(game.id, u))()}
        onRemove={(id) => wrap(() => api.manage.removeMaintainer(game.id, id))()}
      />
      <UserList
        title={t('admin.permissions.access')}
        hint={t('admin.permissions.accessHint')}
        users={game.accessUsers}
        onAdd={(u) => wrap(() => api.manage.grantAccess(game.id, u))()}
        onRemove={(id) => wrap(() => api.manage.revokeAccess(game.id, id))()}
      />
    </div>
  );
}
