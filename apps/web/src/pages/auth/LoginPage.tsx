import { Globe, KeyRound, Server } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Field, Input } from '../../components/ui';
import { desktop, desktopError, isDesktop } from '../../desktop/bridge';
import { useDesktop } from '../../desktop/DesktopProvider';
import { api, errorMessage, setApiSession } from '../../lib/api';
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
  const [waitingBrowser, setWaitingBrowser] = useState(false);
  const desk = useDesktop();

  if (user) return <Navigate to={next} replace />;

  /** Desktop: erhaltenes Device-Token lokal speichern */
  async function storeDeviceSession(res: { token?: string; user: { username: string } }) {
    if (!isDesktop || !res.token) return;
    await desktop.setSession(api.baseUrl, res.token, res.user.username);
    // Token setzen und Beobachter benachrichtigen → Queries laden neu, WebSocket verbindet authentifiziert (kein Neustart nötig)
    setApiSession({ token: res.token });
  }

  async function browserLogin() {
    try {
      await desktop.startSsoLogin();
      setWaitingBrowser(true);
    } catch (err) {
      setError(desktopError(err));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (challenge) {
        const res = await api.auth.login2fa(challenge, code);
        await storeDeviceSession(res);
        setUser(res.user);
        navigate(next, { replace: true });
      } else {
        const device = isDesktop ? { name: desk?.platform?.hostname || 'Desktop-Client' } : undefined;
        const res = await api.auth.login(login, password, device);
        if ('mfaRequired' in res) setChallenge(res.challengeToken);
        else {
          await storeDeviceSession(res);
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
        <>
          {settings?.registrationMode !== 'closed' && (
            <p>
              {t('auth.noAccount')}{' '}
              {isDesktop ? (
                <button type="button" className="text-accent hover:underline" onClick={() => void desktop.openUrl(`${api.baseUrl}/register`)}>
                  {t('desktop.registerInBrowser')}
                </button>
              ) : (
                <Link to="/register" className="text-accent hover:underline">
                  {t('nav.register')}
                </Link>
              )}
            </p>
          )}
          {isDesktop && (
            <p className="mt-2">
              <Link to="/server-setup" className="inline-flex items-center gap-1 text-accent hover:underline">
                <Server className="size-3" /> {t('desktop.changeServer')} ({api.baseUrl})
              </Link>
            </p>
          )}
        </>
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
              {isDesktop ? (
                <button type="button" className="text-accent hover:underline" onClick={() => void desktop.openUrl(`${api.baseUrl}/forgot-password`)}>
                  {t('auth.forgot')}
                </button>
              ) : (
                <Link to="/forgot-password" className="text-accent hover:underline">
                  {t('auth.forgot')}
                </Link>
              )}
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
      {isDesktop && !challenge && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-border" />
            {t('auth.or')}
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button className="w-full" icon={<Globe className="size-4" />} onClick={() => void browserLogin()}>
            {settings?.oidcEnabled ? t('desktop.ssoBrowser', { name: settings.oidcName }) : t('desktop.browserLogin')}
          </Button>
          <p className="mt-2 text-center text-xs text-muted">{waitingBrowser ? t('desktop.waitingForBrowser') : t('desktop.browserLoginHint')}</p>
        </>
      )}
      {!isDesktop && settings?.oidcEnabled && !challenge && (
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
