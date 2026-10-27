import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminSettings, RegistrationMode } from '@gameserver/shared';
import { Button, Card, ErrorState, Field, Input, PageLoader, Select, Textarea, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast } from '../../lib/toast';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export default function SettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { refresh, settings: pub } = useAuth();
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.admin.settings() });
  const [s, setS] = useState<AdminSettings | null>(null);
  useEffect(() => {
    if (settings.data) setS(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (data: Partial<AdminSettings>) => api.admin.updateSettings(data),
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'settings'], data);
      void refresh();
      toast.success(t('common.saved'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const testMail = useMutation({
    mutationFn: () => api.admin.testMail(),
    onSuccess: () => toast.success(t('admin.settingsPage.testMailSent')),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (settings.isLoading || !s) return <PageLoader />;
  if (settings.error) return <ErrorState error={settings.error} />;
  const num = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(s);
      }}
    >
      <h1 className="text-2xl font-bold">{t('admin.settings')}</h1>
      <Card title={t('admin.settingsPage.general')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('admin.settingsPage.siteName')}>
            <Input value={s.siteName} onChange={(e) => setS({ ...s, siteName: e.target.value })} required maxLength={100} />
          </Field>
          <Field label={t('admin.settingsPage.registration')}>
            <Select value={s.registrationMode} onChange={(e) => setS({ ...s, registrationMode: e.target.value as RegistrationMode })}>
              <option value="open">{t('admin.settingsPage.registrationOpen')}</option>
              <option value="invite">{t('admin.settingsPage.registrationInvite')}</option>
              <option value="closed">{t('admin.settingsPage.registrationClosed')}</option>
            </Select>
          </Field>
          <Field label={t('admin.settingsPage.siteDescription')} className="md:col-span-2">
            <Input value={s.siteDescription} onChange={(e) => setS({ ...s, siteDescription: e.target.value })} maxLength={500} />
          </Field>
          <Toggle checked={s.storePublic} onChange={(v) => setS({ ...s, storePublic: v })} label={t('admin.settingsPage.storePublic')} />
        </div>
      </Card>

      <Card title={t('admin.settingsPage.maintenance')}>
        <div className="space-y-4">
          <Toggle checked={s.maintenanceMode} onChange={(v) => setS({ ...s, maintenanceMode: v })} label={t('admin.settingsPage.maintenanceMode')} />
          <Field label={t('admin.settingsPage.maintenanceMessage')} hint={t('common.markdownHint')}>
            <Textarea value={s.maintenanceMessage} onChange={(e) => setS({ ...s, maintenanceMessage: e.target.value })} rows={3} />
          </Field>
        </div>
      </Card>

      <Card title={t('admin.settingsPage.limits')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('admin.settingsPage.maxUploadFile')}>
            <Input type="number" min={0.001} step="any" value={s.maxUploadFileBytes / GB} onChange={(e) => setS({ ...s, maxUploadFileBytes: Math.round(num(e.target.value) * GB) })} />
          </Field>
          <Field label={t('admin.settingsPage.defaultQuota')}>
            <Input type="number" min={0} step="any" value={s.defaultUploadQuotaBytes / GB} onChange={(e) => setS({ ...s, defaultUploadQuotaBytes: Math.round(num(e.target.value) * GB) })} />
          </Field>
          <Field label={t('admin.settingsPage.maxConcurrent')}>
            <Input type="number" min={1} value={s.maxConcurrentUploadsPerUser} onChange={(e) => setS({ ...s, maxConcurrentUploadsPerUser: num(e.target.value) })} />
          </Field>
          <Field label={t('admin.settingsPage.chunkSize')}>
            <Input type="number" min={1} max={256} value={s.uploadChunkBytes / MB} onChange={(e) => setS({ ...s, uploadChunkBytes: Math.round(num(e.target.value) * MB) })} />
          </Field>
          <Field label={t('admin.settingsPage.downloadLimit')}>
            <Input type="number" min={0} value={s.downloadRateLimitKbps} onChange={(e) => setS({ ...s, downloadRateLimitKbps: num(e.target.value) })} />
          </Field>
        </div>
      </Card>

      <Card title={t('admin.settingsPage.backupSchedule')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Toggle checked={s.backupSchedule.enabled} onChange={(v) => setS({ ...s, backupSchedule: { ...s.backupSchedule, enabled: v } })} label={t('admin.settingsPage.backupEnabled')} />
          <Toggle
            checked={s.backupSchedule.includeFiles}
            onChange={(v) => setS({ ...s, backupSchedule: { ...s.backupSchedule, includeFiles: v } })}
            label={t('admin.settingsPage.backupIncludeFiles')}
          />
          <Field label={t('admin.settingsPage.backupInterval')}>
            <Input type="number" min={1} value={s.backupSchedule.intervalHours} onChange={(e) => setS({ ...s, backupSchedule: { ...s.backupSchedule, intervalHours: num(e.target.value) } })} />
          </Field>
          <Field label={t('admin.settingsPage.backupKeep')}>
            <Input type="number" min={0} value={s.backupSchedule.keep} onChange={(e) => setS({ ...s, backupSchedule: { ...s.backupSchedule, keep: num(e.target.value) } })} />
          </Field>
        </div>
      </Card>

      <Card title={t('admin.settingsPage.social')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Toggle checked={s.voiceEnabled} onChange={(v) => setS({ ...s, voiceEnabled: v })} label={t('admin.settingsPage.voiceEnabled')} />
          <Toggle checked={s.gifsEnabled} onChange={(v) => setS({ ...s, gifsEnabled: v })} label={t('admin.settingsPage.gifsEnabled')} />
          <Field label={t('admin.settingsPage.maxChatImageMb')}>
            <Input
              type="number"
              min={1}
              max={100}
              value={Math.round(s.maxChatImageBytes / 1024 ** 2)}
              onChange={(e) => setS({ ...s, maxChatImageBytes: Math.max(1, num(e.target.value)) * 1024 ** 2 })}
            />
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted">{t('admin.settingsPage.socialHint')}</p>
      </Card>

      <Card title={t('admin.settingsPage.mail')}>
        <Button onClick={() => testMail.mutate()} loading={testMail.isPending} disabled={!pub?.smtpEnabled}>
          {t('admin.settingsPage.testMail')}
        </Button>
      </Card>

      <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
        {t('common.save')}
      </Button>
    </form>
  );
}
