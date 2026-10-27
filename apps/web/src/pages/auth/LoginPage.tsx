import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Field, Input } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { AuthCard, FormError } from './AuthCard';

export default function LoginPage() {
  const { t } = useTranslation();
  const { user, settings, setUser } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/';
  const oidcError = params.get('error');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(
    oidcError ? ((t(`auth.errors.${oidcError}`, { defaultValue: t('errors.generic') }) as string) ?? null) : null,
  );
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (challenge) {
        const res = await api.auth.login2fa(challenge, code);
        setUser(res.user);
        navigate(next, { replace: true });
      } else {
        const res = await api.auth.login(login, password);
        if ('mfaRequired' in res) setChallenge(res.challengeToken);
        else {
          setUser(res.user);
          navigate(next, { replace: true });
        }
      }
    } catch (err) {
      setError(errorMessage(err));
      if (challenge) setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={challenge ? t('auth.mfaTitle') : t('auth.loginTitle')}
      footer={
        settings?.registrationMode !== 'closed' && (
          <>
            {t('auth.noAccount')}{' '}
            <Link to="/register" className="text-accent hover:underline">
              {t('nav.register')}
            </Link>
          </>
        )
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        {challenge ? (
          <>
            <p className="text-sm text-muted">{t('auth.mfaText')}</p>
            <Field label={t('auth.code')}>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                inputMode="numeric"
                autoFocus
                required
                maxLength={32}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label={t('auth.loginField')}>
              <Input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoFocus required />
            </Field>
            <Field label={t('auth.password')}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </Field>
            <div className="text-right text-sm">
              <Link to="/forgot-password" className="text-accent hover:underline">
                {t('auth.forgot')}
              </Link>
            </div>
          </>
        )}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          {challenge ? t('auth.verify') : t('auth.loginTitle')}
        </Button>
        {challenge && (
          <Button variant="ghost" className="w-full" onClick={() => setChallenge(null)}>
            {t('common.back')}
          </Button>
        )}
      </form>
      {settings?.oidcEnabled && !challenge && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-border" />
            {t('auth.or')}
            <span className="h-px flex-1 bg-border" />
          </div>
          <a
            href={api.auth.oidcStartUrl(next)}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-surface-2 text-sm font-medium hover:bg-border"
          >
            <KeyRound className="size-4" />
            {t('auth.sso', { name: settings.oidcName })}
          </a>
        </>
      )}
    </AuthCard>
  );
}
