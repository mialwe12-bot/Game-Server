import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Baby, Check, Home, LogOut, Shield, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AGE_RATINGS, type FamilyDto, type FamilyMemberDto, type FamilyRole } from '@gameserver/shared';
import { Avatar } from '../../components/Avatar';
import { GameCard } from '../../components/GameCard';
import { UserLink } from '../../components/Social';
import { Badge, Button, Card, ConfirmButton, EmptyState, ErrorState, Field, Input, Modal, PageLoader, Select, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast } from '../../lib/toast';

/** Familie: Mitglieder, Einladungen, Kindersicherung und Familienbibliothek */
export default function FamilyPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const family = useQuery({ queryKey: ['family'], queryFn: () => api.family.get() });
  const invites = useQuery({ queryKey: ['family', 'invites'], queryFn: () => api.family.invites() });
  const [name, setName] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['family'] });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      void refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (family.isLoading) return <PageLoader />;
  if (family.error) return <ErrorState error={family.error} />;
  const f = family.data;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <Home className="size-6" />
        {f ? f.name : t('family.title')}
      </h1>
      {!!invites.data?.length && (
        <Card title={t('family.invitesForYou')}>
          <ul className="divide-y divide-border">
            {invites.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="flex-1 text-sm">
                  {t('family.inviteText', { family: i.family.name, role: t(`family.roles.${i.role}`) })}
                  {i.invitedBy.length > 0 && <span className="text-muted"> · {i.invitedBy.map((u) => u.displayName || u.username).join(', ')}</span>}
                </span>
                <Button size="sm" variant="primary" icon={<Check className="size-4" />} disabled={!!f} onClick={() => void run(() => api.family.acceptInvite(i.id))}>
                  {t('social.friends.accept')}
                </Button>
                <Button size="sm" icon={<X className="size-4" />} onClick={() => void run(() => api.family.deleteInvite(i.id))}>
                  {t('social.friends.decline')}
                </Button>
              </li>
            ))}
          </ul>
          {f && <p className="mt-2 text-xs text-muted">{t('family.leaveFirst')}</p>}
        </Card>
      )}
      {!f ? (
        <Card>
          <p className="mb-4 text-sm text-muted">{t('family.intro')}</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api.family.create(name));
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('family.namePlaceholder')} required maxLength={60} />
            <Button type="submit" variant="primary">
              {t('family.create')}
            </Button>
          </form>
        </Card>
      ) : (
        <FamilyView family={f} run={run} />
      )}
    </div>
  );
}

function FamilyView({ family, run }: { family: FamilyDto; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const adult = family.myRole === 'ADULT';
  const [invite, setInvite] = useState<{ username: string; role: FamilyRole }>({ username: '', role: 'CHILD' });
  const [editing, setEditing] = useState<FamilyMemberDto | null>(null);
  const library = useQuery({ queryKey: ['family', 'library'], queryFn: () => api.family.library() });
  return (
    <>
      <Card title={t('family.members', { count: family.members.length })}>
        <ul className="divide-y divide-border">
          {family.members.map((m) => (
            <li key={m.user.id} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar user={m.user} size={40} />
              <div className="min-w-0 flex-1">
                <UserLink user={m.user} />
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge tone={m.role === 'ADULT' ? 'accent' : 'default'}>
                    {m.role === 'CHILD' ? <Baby className="mr-1 inline size-3" /> : <Shield className="mr-1 inline size-3" />}
                    {t(`family.roles.${m.role}`)}
                  </Badge>
                  {m.role === 'CHILD' && (
                    <>
                      {t('family.ageLimit', { age: m.parental.maxAgeRating })}
                      {m.parental.dailyMinutes !== null && ` · ${t('family.dailyLimit', { minutes: m.parental.dailyMinutes })}`}
                      {!m.parental.chatAllowed && ` · ${t('family.noChat')}`}
                      {!m.parental.communityAllowed && ` · ${t('family.noCommunity')}`}
                    </>
                  )}
                </p>
              </div>
              {adult && (
                <Button size="sm" onClick={() => setEditing(m)}>
                  {t('family.settings')}
                </Button>
              )}
              {/* Nur Erwachsene entfernen Mitglieder bzw. verlassen die Familie – Kinder nicht (Kindersicherung) */}
              {adult && (
                <ConfirmButton size="sm" icon={<LogOut className="size-4" />} onConfirm={() => void run(() => api.family.removeMember(m.user.id))}>
                  {m.user.id === user?.id ? t('family.leave') : t('common.remove')}
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
        {adult && family.invites.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-2 text-sm font-medium">{t('family.pendingInvites')}</p>
            <ul className="space-y-1 text-sm">
              {family.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-2">
                  <Avatar user={i.user} size={24} />
                  <span className="flex-1">
                    {i.user.displayName || i.user.username} · {t(`family.roles.${i.role}`)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void run(() => api.family.deleteInvite(i.id))}>
                    {t('social.groups.revokeInvite')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {adult && (
          <form
            className="mt-4 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api.family.invite(invite.username, invite.role)).then(() => setInvite({ ...invite, username: '' }));
            }}
          >
            <Input className="w-auto flex-1" value={invite.username} onChange={(e) => setInvite({ ...invite, username: e.target.value })} placeholder={t('admin.permissions.username')} required />
            <Select className="w-auto" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as FamilyRole })}>
              <option value="CHILD">{t('family.roles.CHILD')}</option>
              <option value="ADULT">{t('family.roles.ADULT')}</option>
            </Select>
            <Button type="submit" icon={<UserPlus className="size-4" />}>
              {t('social.groups.invite')}
            </Button>
          </form>
        )}
      </Card>

      <Card title={t('family.library')}>
        <p className="mb-3 text-sm text-muted">{t('family.libraryHint')}</p>
        {library.data?.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {library.data.map((e) => (
              <GameCard
                key={e.game.id}
                game={e.game}
                footer={<span className="text-xs text-muted">{e.owners.map((o) => o.displayName || o.username).join(', ')}</span>}
              />
            ))}
          </div>
        ) : (
          <EmptyState title={t('family.libraryEmpty')} />
        )}
      </Card>

      {editing && <ParentalModal member={editing} onClose={() => setEditing(null)} run={run} />}
    </>
  );
}

function ParentalModal({ member, onClose, run }: { member: FamilyMemberDto; onClose: () => void; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { t } = useTranslation();
  const [p, setP] = useState({ ...member.parental, role: member.role });
  const save = useMutation({
    mutationFn: () => run(() => api.family.updateMember(member.user.id, p)),
    onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} title={t('family.settingsFor', { name: member.user.displayName || member.user.username })}>
      <div className="space-y-4">
        <Field label={t('family.role')}>
          <Select value={p.role} onChange={(e) => setP({ ...p, role: e.target.value as FamilyRole })}>
            <option value="CHILD">{t('family.roles.CHILD')}</option>
            <option value="ADULT">{t('family.roles.ADULT')}</option>
          </Select>
        </Field>
        {p.role === 'CHILD' && (
          <>
            <Field label={t('family.maxAge')}>
              <Select value={p.maxAgeRating} onChange={(e) => setP({ ...p, maxAgeRating: Number(e.target.value) })}>
                {AGE_RATINGS.map((a) => (
                  <option key={a} value={a}>
                    {a === 0 ? t('admin.features.ageNone') : t('admin.features.ageFrom', { age: a })}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('family.dailyMinutes')} hint={t('family.dailyMinutesHint')}>
              <Input
                type="number"
                min={0}
                max={1440}
                value={p.dailyMinutes ?? ''}
                onChange={(e) => setP({ ...p, dailyMinutes: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
            <Toggle checked={p.chatAllowed} onChange={(v) => setP({ ...p, chatAllowed: v })} label={t('family.chatAllowed')} />
            <Toggle checked={p.communityAllowed} onChange={(v) => setP({ ...p, communityAllowed: v })} label={t('family.communityAllowed')} />
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
