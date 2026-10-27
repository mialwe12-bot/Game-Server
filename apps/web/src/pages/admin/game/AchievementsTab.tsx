import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, EyeOff, ImagePlus, Pencil, Plus, Trash2, Trophy } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AchievementDetection, AdminAchievementDto, ManagedGame } from '@gameserver/shared';
import { Badge, Button, Card, ConfirmButton, EmptyState, Field, Input, Modal, Select, Spinner, Textarea, Toggle } from '../../../components/ui';
import { api, errorMessage, type AchievementInput } from '../../../lib/api';
import { toast } from '../../../lib/toast';

type Form = { apiName: string; name: string; description: string; hidden: boolean; progressMax: string; detectionType: '' | AchievementDetection['type']; detectionPath: string; detectionPattern: string };

const emptyForm: Form = { apiName: '', name: '', description: '', hidden: false, progressMax: '', detectionType: '', detectionPath: '', detectionPattern: '' };

export function AchievementIcon({ url, size = 40, locked = false }: { url: string | null; size?: number; locked?: boolean }) {
  if (url) return <img src={api.url(url)} alt="" className={locked ? 'rounded opacity-40 grayscale' : 'rounded'} style={{ width: size, height: size }} />;
  return (
    <span className="flex shrink-0 items-center justify-center rounded bg-surface-2 text-muted" style={{ width: size, height: size }}>
      <Trophy style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

/** Achievements eines Spiels verwalten (Icons, versteckt, Fortschritt, Erkennungsregeln, Reihenfolge) */
export function AchievementsTab({ game }: { game: ManagedGame }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['admin', 'achievements', game.id];
  const list = useQuery({ queryKey: key, queryFn: () => api.achievements.manage(game.id) });
  const [editing, setEditing] = useState<AdminAchievementDto | 'new' | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [grant, setGrant] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [iconFor, setIconFor] = useState<string | null>(null);
  const set = (data: AdminAchievementDto[]) => qc.setQueryData(key, data);
  const run = async (fn: () => Promise<AdminAchievementDto[]>) => {
    try {
      set(await fn());
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const open = (a: AdminAchievementDto | 'new') => {
    setEditing(a);
    setForm(
      a === 'new'
        ? emptyForm
        : {
            apiName: a.apiName,
            name: a.name,
            description: a.description,
            hidden: a.hidden,
            progressMax: a.progressMax ? String(a.progressMax) : '',
            detectionType: a.detection?.type ?? '',
            detectionPath: a.detection?.path ?? '',
            detectionPattern: a.detection?.pattern ?? '',
          },
    );
  };

  const save = async () => {
    const data: AchievementInput & { apiName: string; name: string } = {
      apiName: form.apiName.trim(),
      name: form.name.trim(),
      description: form.description,
      hidden: form.hidden,
      progressMax: form.progressMax ? Number(form.progressMax) : null,
      detection: form.detectionType
        ? { type: form.detectionType, path: form.detectionPath.trim(), ...(form.detectionPattern ? { pattern: form.detectionPattern } : {}) }
        : null,
    };
    try {
      set(editing === 'new' ? await api.achievements.create(game.id, data) : await api.achievements.update(game.id, (editing as AdminAchievementDto).id, data));
      setEditing(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const move = (i: number, d: number) => {
    const ids = list.data!.map((a) => a.id);
    const [x] = ids.splice(i, 1);
    ids.splice(i + d, 0, x);
    void run(() => api.achievements.order(game.id, ids));
  };

  if (list.isLoading) return <Spinner />;
  const items = list.data ?? [];

  return (
    <div className="space-y-4">
      <Card
        title={t('admin.achievements.title', { count: items.length })}
        actions={
          <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => open('new')}>
            {t('admin.achievements.add')}
          </Button>
        }
      >
        <p className="mb-3 text-sm text-muted">{t('admin.achievements.hint')}</p>
        {items.length === 0 ? (
          <EmptyState title={t('admin.achievements.empty')} />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((a, i) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                <button type="button" title={t('admin.achievements.icon')} onClick={() => (setIconFor(a.id), fileRef.current?.click())} className="relative">
                  <AchievementIcon url={a.iconUrl} />
                  <ImagePlus className="absolute -right-1 -bottom-1 size-3.5 rounded bg-surface text-muted" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {a.name}
                    <code className="rounded bg-surface-2 px-1 text-xs">{a.apiName}</code>
                    {a.hidden && (
                      <Badge>
                        <EyeOff className="mr-1 inline size-3" />
                        {t('admin.achievements.hidden')}
                      </Badge>
                    )}
                    {a.progressMax && <Badge>0/{a.progressMax}</Badge>}
                    {a.detection && <Badge tone="accent">{t(`admin.achievements.detect.${a.detection.type}`)}</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    {a.description} · {t('admin.achievements.unlocks', { count: a.unlockCount, rarity: a.rarity })}
                  </p>
                </div>
                <Button size="sm" variant="ghost" icon={<ArrowUp className="size-4" />} disabled={i === 0} onClick={() => move(i, -1)} />
                <Button size="sm" variant="ghost" icon={<ArrowDown className="size-4" />} disabled={i === items.length - 1} onClick={() => move(i, 1)} />
                <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => open(a)} aria-label={t('common.edit')} />
                <ConfirmButton size="sm" icon={<Trash2 className="size-4" />} onConfirm={() => void run(() => api.achievements.remove(game.id, a.id))} />
              </li>
            ))}
          </ul>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f && iconFor) void run(() => api.achievements.uploadIcon(game.id, iconFor, f));
          }}
        />
      </Card>

      {items.length > 0 && (
        <Card title={t('admin.achievements.support')}>
          <p className="mb-3 text-sm text-muted">{t('admin.achievements.supportHint')}</p>
          <div className="flex flex-wrap gap-2">
            <Input className="w-auto" value={grant} onChange={(e) => setGrant(e.target.value)} placeholder={t('admin.permissions.username')} />
            <Select className="w-auto" id="grant-ach">
              {items.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Button
              onClick={async () => {
                const id = (document.getElementById('grant-ach') as HTMLSelectElement).value;
                try {
                  await api.achievements.grant(game.id, id, grant.trim());
                  toast.success(t('admin.achievements.granted'));
                  void list.refetch();
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              {t('admin.achievements.grant')}
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                const id = (document.getElementById('grant-ach') as HTMLSelectElement).value;
                try {
                  await api.achievements.revoke(game.id, id, grant.trim());
                  toast.success(t('admin.achievements.revoked'));
                  void list.refetch();
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              {t('admin.achievements.revoke')}
            </Button>
          </div>
        </Card>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? t('admin.achievements.add') : t('common.edit')} wide>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.achievements.apiName')} hint={t('admin.achievements.apiNameHint')}>
              <Input required pattern="[A-Za-z0-9_.\-]{1,64}" className="font-mono" value={form.apiName} onChange={(e) => setForm({ ...form, apiName: e.target.value })} />
            </Field>
            <Field label={t('common.name')}>
              <Input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
          </div>
          <Field label={t('admin.achievements.description')}>
            <Textarea rows={2} maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.achievements.progressMax')} hint={t('admin.achievements.progressHint')}>
              <Input type="number" min={2} value={form.progressMax} onChange={(e) => setForm({ ...form, progressMax: e.target.value })} />
            </Field>
            <div className="pt-6">
              <Toggle checked={form.hidden} onChange={(v) => setForm({ ...form, hidden: v })} label={t('admin.achievements.hiddenLabel')} />
            </div>
          </div>
          <fieldset className="space-y-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">{t('admin.achievements.detection')}</legend>
            <p className="text-xs text-muted">{t('admin.achievements.detectionHint')}</p>
            <Select value={form.detectionType} onChange={(e) => setForm({ ...form, detectionType: e.target.value as Form['detectionType'] })}>
              <option value="">{t('admin.achievements.detect.none')}</option>
              <option value="file_exists">{t('admin.achievements.detect.file_exists')}</option>
              <option value="file_regex">{t('admin.achievements.detect.file_regex')}</option>
              <option value="log_regex">{t('admin.achievements.detect.log_regex')}</option>
            </Select>
            {form.detectionType && (
              <>
                <Input required className="font-mono text-xs" value={form.detectionPath} onChange={(e) => setForm({ ...form, detectionPath: e.target.value })} placeholder="{install}/logs/game.log" />
                {form.detectionType !== 'file_exists' && (
                  <Input required className="font-mono text-xs" value={form.detectionPattern} onChange={(e) => setForm({ ...form, detectionPattern: e.target.value })} placeholder="BOSS (DEFEATED|KILLED)" />
                )}
              </>
            )}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary">
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
