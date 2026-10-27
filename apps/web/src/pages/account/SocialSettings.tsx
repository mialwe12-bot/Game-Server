import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SHOWCASE_KINDS, type NotificationPrefs, type ProfileSettings, type ProfileVisibility, type ShowcaseConfig, type ShowcaseKind } from '@gameserver/shared';
import { Button, Card, Field, Input, Select, Spinner, Textarea, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { toast } from '../../lib/toast';

/** Profil-Darstellung, Privatsphäre, Vitrinen und Benachrichtigungen (Phase 3) */
export function SocialSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['profile-settings'], queryFn: () => api.profiles.settings() });
  const library = useQuery({ queryKey: ['library', 'showcase'], queryFn: () => api.library.list() });
  const [draft, setDraft] = useState<ProfileSettings | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const onSaved = (s: ProfileSettings) => {
    qc.setQueryData(['profile-settings'], s);
    void qc.invalidateQueries({ queryKey: ['profile'] });
  };
  const save = useMutation({
    mutationFn: (d: ProfileSettings) =>
      api.profiles.updateSettings({
        accent: d.accent,
        visibility: d.visibility,
        allowFriendRequests: d.allowFriendRequests,
        showcases: d.showcases,
        notificationPrefs: d.notificationPrefs,
      }),
    onSuccess: (s) => {
      onSaved(s);
      toast.success(t('common.saved'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const background = useMutation({
    mutationFn: (file: File | null) => (file ? api.profiles.uploadBackground(file) : api.profiles.deleteBackground()),
    onSuccess: onSaved,
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!draft) return <Spinner />;
  const set = (patch: Partial<ProfileSettings>) => setDraft({ ...draft, ...patch });
  const setShowcase = (i: number, patch: Partial<ShowcaseConfig>) => set({ showcases: draft.showcases.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, d: number) => {
    const list = [...draft.showcases];
    const [x] = list.splice(i, 1);
    list.splice(i + d, 0, x);
    set({ showcases: list });
  };
  const setEmail = (key: keyof NotificationPrefs['email'], v: boolean) => set({ notificationPrefs: { email: { ...draft.notificationPrefs.email, [key]: v } } });

  return (
    <div id="profile" className="space-y-6">
      <Card title={t('social.settings.appearance')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('social.settings.accent')}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={draft.accent ?? '#66c0f4'}
                onChange={(e) => set({ accent: e.target.value })}
                className="h-10 w-16 cursor-pointer rounded border border-border bg-surface-2"
              />
              {draft.accent && (
                <Button size="sm" variant="ghost" onClick={() => set({ accent: null })}>
                  {t('social.settings.reset')}
                </Button>
              )}
            </div>
          </Field>
          <Field label={t('social.settings.background')} hint={t('social.settings.backgroundHint')}>
            <div className="flex items-center gap-2">
              {draft.backgroundUrl && <img src={api.url(draft.backgroundUrl)} alt="" className="h-10 w-16 rounded object-cover" />}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) background.mutate(f);
                }}
              />
              <Button size="sm" icon={<ImagePlus className="size-4" />} loading={background.isPending} onClick={() => fileRef.current?.click()}>
                {t('social.settings.upload')}
              </Button>
              {draft.backgroundUrl && (
                <Button size="sm" variant="ghost" onClick={() => background.mutate(null)}>
                  {t('common.remove')}
                </Button>
              )}
            </div>
          </Field>
        </div>
      </Card>

      <Card title={t('social.settings.showcases')}>
        <p className="mb-3 text-sm text-muted">{t('social.settings.showcasesHint')}</p>
        <ul className="space-y-3">
          {draft.showcases.map((s, i) => (
            <li key={i} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap gap-2">
                <Select className="w-auto" value={s.kind} onChange={(e) => setShowcase(i, { kind: e.target.value as ShowcaseKind })}>
                  {SHOWCASE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`social.showcases.${k}`)}
                    </option>
                  ))}
                </Select>
                <Input className="w-auto flex-1" value={s.title ?? ''} onChange={(e) => setShowcase(i, { title: e.target.value || undefined })} placeholder={t('social.settings.showcaseTitle')} maxLength={80} />
                <Button size="sm" variant="ghost" icon={<ArrowUp className="size-4" />} disabled={i === 0} onClick={() => move(i, -1)} />
                <Button size="sm" variant="ghost" icon={<ArrowDown className="size-4" />} disabled={i === draft.showcases.length - 1} onClick={() => move(i, 1)} />
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => set({ showcases: draft.showcases.filter((_, j) => j !== i) })} />
              </div>
              {s.kind === 'favoriteGame' && (
                <Select value={s.gameId ?? ''} onChange={(e) => setShowcase(i, { gameId: e.target.value || undefined })}>
                  <option value="">—</option>
                  {library.data?.map((l) => (
                    <option key={l.game.id} value={l.game.id}>
                      {l.game.title}
                    </option>
                  ))}
                </Select>
              )}
              {(s.kind === 'text' || s.kind === 'favoriteGame') && (
                <Textarea rows={3} value={s.text ?? ''} onChange={(e) => setShowcase(i, { text: e.target.value })} placeholder={t('common.markdownHint')} maxLength={4000} />
              )}
            </li>
          ))}
        </ul>
        {draft.showcases.length < 6 && (
          <Button className="mt-3" size="sm" icon={<Plus className="size-4" />} onClick={() => set({ showcases: [...draft.showcases, { kind: 'recentGames' }] })}>
            {t('social.settings.addShowcase')}
          </Button>
        )}
      </Card>

      <Card title={t('social.settings.privacy')}>
        <div className="space-y-4">
          <Field label={t('social.settings.visibility')}>
            <Select value={draft.visibility} onChange={(e) => set({ visibility: e.target.value as ProfileVisibility })}>
              {(['PUBLIC', 'FRIENDS', 'PRIVATE'] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`social.settings.visibilities.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Toggle checked={draft.allowFriendRequests} onChange={(v) => set({ allowFriendRequests: v })} label={t('social.settings.allowFriendRequests')} />
        </div>
      </Card>

      <Card title={t('social.settings.notifications')}>
        <p className="mb-3 text-sm text-muted">{t('social.settings.emailHint')}</p>
        <div className="space-y-3">
          {(['friends', 'messages', 'groups', 'events', 'community'] as const).map((k) => (
            <Toggle key={k} checked={draft.notificationPrefs.email[k]} onChange={(v) => setEmail(k, v)} label={t(`social.settings.email.${k}`)} />
          ))}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(draft)}>
          {t('social.settings.save')}
        </Button>
      </div>
    </div>
  );
}
