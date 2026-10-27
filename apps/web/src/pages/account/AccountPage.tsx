import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, Monitor, ShieldCheck, ShieldOff, Upload } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TotpSetup } from '@gameserver/shared';
import { Avatar } from '../../components/Avatar';
import { Badge, Button, Card, ConfirmButton, CopyField, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { LANGUAGES } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBytes, formatDateTime } from '../../lib/format';
import { toast } from '../../lib/toast';
import { SocialSettings } from './SocialSettings';

function ProfileSection() {
  const { t, i18n } = useTranslation();
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ displayName: user!.displayName ?? '', bio: user!.bio ?? '', locale: user!.locale });
  const [email, setEmail] = useState(user!.email);
  const [currentPassword, setCurrentPassword] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: () => api.me.update({ displayName: form.displayName || null, bio: form.bio || null, locale: form.locale }),
    onSuccess: (u) => {
      setUser(u);
      void i18n.changeLanguage(u.locale);
      toast.success(t('common.saved'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const saveEmail = useMutation({
    mutationFn: () => api.me.update({ email, currentPassword: currentPassword || undefined }),
    onSuccess: (u) => {
      setUser(u);
      setCurrentPassword('');
      toast.success(t('common.saved'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const avatar = useMutation({
    mutationFn: (file: File | null) => (file ? api.me.uploadAvatar(file) : api.me.deleteAvatar()),
    onSuccess: (u) => setUser(u),
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Card title={t('account.profile')}>
      <div className="grid gap-6 md:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center gap-2">
          <Avatar user={user!} size={112} />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) avatar.mutate(f);
              e.target.value = '';
            }}
          />
          <Button size="sm" icon={<Upload className="size-4" />} loading={avatar.isPending} onClick={() => fileRef.current?.click()}>
            {t('account.uploadAvatar')}
          </Button>
          {user!.avatarUrl && (
            <Button size="sm" variant="ghost" onClick={() => avatar.mutate(null)}>
              {t('account.removeAvatar')}
            </Button>
          )}
          <p className="max-w-36 text-center text-xs text-muted">{t('account.avatarHint')}</p>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('auth.username')}>
              <Input value={user!.username} disabled />
            </Field>
            <Field label={t('account.displayName')}>
              <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} maxLength={64} />
            </Field>
          </div>
          <Field label={t('account.bio')} hint={t('common.markdownHint')}>
            <Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={2000} />
          </Field>
          <Field label={t('account.language')}>
            <Select value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </form>
      </div>
      <form
        className="mt-6 grid gap-4 border-t border-border pt-6 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          saveEmail.mutate();
        }}
      >
        <Field label={t('account.emailChange')}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        {user!.hasPassword && (
          <Field label={t('account.currentPassword')}>
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          </Field>
        )}
        <Button type="submit" loading={saveEmail.isPending} disabled={email === user!.email}>
          {t('common.save')}
        </Button>
      </form>
    </Card>
  );
}

function PasswordSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const change = useMutation({
    mutationFn: () => api.me.changePassword(current || undefined, next),
    onSuccess: () => {
      toast.success(t('account.passwordChanged'));
      setCurrent('');
      setNext('');
      setNext2('');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Card title={user!.hasPassword ? t('account.changePassword') : t('account.setPassword')}>
      <form
        className="grid gap-4 sm:grid-cols-3 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (next !== next2) return toast.error(t('auth.passwordMismatch'));
          change.mutate();
        }}
      >
        {user!.hasPassword && (
          <Field label={t('account.currentPassword')}>
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </Field>
        )}
        <Field label={t('account.newPassword')} hint={t('auth.passwordHint')}>
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={10} autoComplete="new-password" required />
        </Field>
        <Field label={t('auth.passwordRepeat')}>
          <Input type="password" value={next2} onChange={(e) => setNext2(e.target.value)} minLength={10} autoComplete="new-password" required />
        </Field>
        <Button type="submit" variant="primary" loading={change.isPending} className="sm:col-span-3 sm:w-fit">
          {t('common.save')}
        </Button>
      </form>
    </Card>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p className="text-sm text-warning">{t('account.recoveryHint')}</p>
      <pre className="grid grid-cols-2 gap-2 rounded-md bg-surface-2 p-3 font-mono text-sm">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </pre>
      <CopyField value={codes.join('\n')} />
    </div>
  );
}

function TwoFactorSection() {
  const { t } = useTranslation();
  const { user, refresh } = useAuth();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);

  useEffect(() => {
    if (setup) void QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 220 }).then(setQr);
  }, [setup]);

  const start = useMutation({ mutationFn: () => api.me.totpSetup(), onSuccess: setSetup, onError: (e) => toast.error(errorMessage(e)) });
  const enable = useMutation({
    mutationFn: () => api.me.totpEnable(code),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      setSetup(null);
      setCode('');
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const disable = useMutation({
    mutationFn: () => api.me.totpDisable(code, password || undefined),
    onSuccess: () => {
      setDisableOpen(false);
      setCode('');
      setPassword('');
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const regenerate = useMutation({
    mutationFn: () => api.me.recoveryCodes(code),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      setCode('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card title={t('account.twoFactor')}>
      {codes && (
        <div className="mb-4">
          <h3 className="mb-2 font-semibold">{t('account.recoveryCodes')}</h3>
          <RecoveryCodes codes={codes} />
        </div>
      )}
      {user!.totpEnabled ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-success">
            <ShieldCheck className="size-5" /> {t('account.twoFactorOn')}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('auth.code')}>
              <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" className="w-40" />
            </Field>
            <Button onClick={() => regenerate.mutate()} loading={regenerate.isPending} disabled={code.length < 6}>
              {t('account.newRecoveryCodes')}
            </Button>
            <Button variant="danger" onClick={() => setDisableOpen(true)}>
              {t('account.disable2fa')}
            </Button>
          </div>
        </div>
      ) : setup ? (
        <form
          className="grid gap-6 md:grid-cols-[auto_1fr]"
          onSubmit={(e) => {
            e.preventDefault();
            enable.mutate();
          }}
        >
          {qr && <img src={qr} alt="QR" className="rounded-md bg-white p-2" width={220} height={220} />}
          <div className="space-y-4">
            <p className="text-sm">{t('account.scanQr')}</p>
            <Field label={t('account.secret')}>
              <CopyField value={setup.secret} />
            </Field>
            <Field label={t('auth.code')}>
              <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" className="w-40" required />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={enable.isPending}>
                {t('auth.verify')}
              </Button>
              <Button onClick={() => setSetup(null)}>{t('common.cancel')}</Button>
            </div>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <p className="flex items-center gap-2 text-muted">
            <ShieldOff className="size-5" /> {t('account.twoFactorOff')}
          </p>
          <Button variant="primary" onClick={() => start.mutate()} loading={start.isPending}>
            {t('account.enable2fa')}
          </Button>
        </div>
      )}
      <Modal open={disableOpen} onClose={() => setDisableOpen(false)} title={t('account.disable2fa')}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            disable.mutate();
          }}
        >
          {user!.hasPassword && (
            <Field label={t('auth.password')}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
          )}
          <Field label={t('auth.code')}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
          <Button type="submit" variant="danger" loading={disable.isPending}>
            {t('account.disable2fa')}
          </Button>
        </form>
      </Modal>
    </Card>
  );
}

function SessionsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.me.sessions() });
  const [tokenName, setTokenName] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const reload = () => void qc.invalidateQueries({ queryKey: ['sessions'] });

  return (
    <Card
      title={t('account.sessions')}
      actions={
        <ConfirmButton size="sm" onConfirm={() => void api.me.revokeOtherSessions().then(reload)}>
          {t('account.revokeOthers')}
        </ConfirmButton>
      }
    >
      <p className="mb-4 text-sm text-muted">{t('account.sessionsHint')}</p>
      <ul className="divide-y divide-border">
        {sessions.data?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
            {s.kind === 'DEVICE' ? <Laptop className="size-5 text-muted" /> : <Monitor className="size-5 text-muted" />}
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {s.name ?? (s.kind === 'DEVICE' ? t('account.device') : t('account.web'))}
                {s.current && <Badge tone="success">{t('account.current')}</Badge>}
                <Badge>{s.kind === 'DEVICE' ? t('account.device') : t('account.web')}</Badge>
              </p>
              <p className="truncate text-xs text-muted">
                {s.ip} · {t('account.lastUsed')}: {formatDateTime(s.lastUsedAt)} · {s.userAgent}
              </p>
            </div>
            {!s.current && (
              <Button size="sm" variant="ghost" onClick={() => void api.me.revokeSession(s.id).then(reload)}>
                {t('account.revoke')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-4 space-y-3 border-t border-border pt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await api.me.createDeviceToken(tokenName);
            setNewToken(r.token);
            setTokenName('');
            reload();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      >
        <p className="text-sm font-medium">{t('account.createToken')}</p>
        <p className="text-xs text-muted">{t('account.tokenHint')}</p>
        <div className="flex gap-2">
          <Input value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder={t('account.tokenName')} required maxLength={100} />
          <Button type="submit">{t('common.create')}</Button>
        </div>
        {newToken && (
          <div className="space-y-1">
            <p className="text-sm text-warning">{t('account.tokenCreated')}</p>
            <CopyField value={newToken} />
          </div>
        )}
      </form>
    </Card>
  );
}

function QuotaSection() {
  const { t } = useTranslation();
  const quota = useQuery({ queryKey: ['quota'], queryFn: () => api.me.uploadQuota() });
  if (!quota.data) return null;
  return (
    <Card title={t('account.uploadQuota')}>
      <p className="text-sm">
        {formatBytes(quota.data.used)} / {quota.data.quota > 0 ? formatBytes(quota.data.quota) : t('account.unlimited')}
      </p>
    </Card>
  );
}

export default function AccountPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">{t('account.title')}</h1>
      <ProfileSection />
      <SocialSettings />
      <h2 className="pt-2 text-xl font-semibold">{t('account.security')}</h2>
      <PasswordSection />
      <TwoFactorSection />
      <SessionsSection />
      {(user?.role === 'ADMIN' || user?.role === 'UPLOADER') && <QuotaSection />}
    </div>
  );
}
