import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Field, Input } from '../../components/ui';
import i18n from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { AuthCard, FormError } from './AuthCard';

export default function RegisterPage() {
  const { t } = useTranslation();
  const { user, settings, setUser } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '', password2: '', inviteCode: params.get('invite') ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invite = useQuery({
    queryKey: ['invite', form.inviteCode],
    queryFn: () => api.auth.checkInvite(form.inviteCode.trim()),
    enabled: form.inviteCode.trim().length >= 6,
    retry: false,
  });

  if (user) return <Navigate to="/" replace />;
  const mode = settings?.registrationMode ?? 'invite';
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.password2) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.auth.register({
        username: form.username,
        email: form.email,
        password: form.password,
        inviteCode: form.inviteCode.trim() || undefined,
        locale: i18n.language,
      });
      setUser(res.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <>
      {t('auth.haveAccount')}{' '}
      <Link to="/login" className="text-accent hover:underline">
        {t('nav.login')}
      </Link>
    </>
  );

  if (mode === 'closed' && !form.inviteCode) {
    return (
      <AuthCard title={t('auth.registerTitle')} footer={footer}>
        <p className="text-muted">{t('auth.registrationClosed')}</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('auth.registerTitle')} footer={footer}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        {mode !== 'open' && (
          <Field
            label={t('auth.inviteCode')}
            hint={
              invite.data ? (
                invite.data.valid ? (
                  <span className="flex items-center gap-1 text-success">
                    <CheckCircle2 className="size-3" /> {t('auth.inviteValid')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-danger">
                    <XCircle className="size-3" /> {t('auth.inviteInvalid')}
                  </span>
                )
              ) : (
                t('auth.registrationInvite')
              )
            }
          >
            <Input value={form.inviteCode} onChange={set('inviteCode')} required className="font-mono uppercase" />
          </Field>
        )}
        <Field label={t('auth.username')}>
          <Input value={form.username} onChange={set('username')} autoComplete="username" pattern="[a-zA-Z0-9_.\-]{3,32}" required />
        </Field>
        <Field label={t('auth.email')}>
          <Input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
        </Field>
        <Field label={t('auth.password')} hint={t('auth.passwordHint')}>
          <Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" minLength={10} required />
        </Field>
        <Field label={t('auth.passwordRepeat')}>
          <Input type="password" value={form.password2} onChange={set('password2')} autoComplete="new-password" minLength={10} required />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          {t('nav.register')}
        </Button>
      </form>
    </AuthCard>
  );
}
