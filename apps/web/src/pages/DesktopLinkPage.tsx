import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Monitor } from 'lucide-react';
import { Button, Card } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { toast } from '../lib/toast';

/**
 * Anmeldung des Desktop-Clients im Browser (z. B. für SSO-Nutzer): Nach Bestätigung wird ein Device-Token
 * erzeugt und an den lokalen Loopback-Listener des Clients (127.0.0.1) übergeben.
 */
export default function DesktopLinkPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const port = params.get('port') ?? '';
  const state = params.get('state') ?? '';
  const name = (params.get('name') ?? 'Desktop').slice(0, 80);
  const valid = /^\d{2,5}$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535 && /^[A-Za-z0-9-]{8,64}$/.test(state);

  if (!valid) return <Card className="mx-auto mt-8 max-w-lg">{t('desktopLink.invalid')}</Card>;

  const allow = async () => {
    setBusy(true);
    try {
      const { token } = await api.me.createDeviceToken(name);
      const target = new URL(`http://127.0.0.1:${port}/callback`);
      target.searchParams.set('token', token);
      target.searchParams.set('state', state);
      target.searchParams.set('username', user?.username ?? '');
      setDone(true);
      window.location.href = target.toString();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto mt-8 max-w-lg" title={t('desktopLink.title')}>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <Monitor className="mt-1 size-8 shrink-0 text-accent" />
          <p className="text-sm">{t('desktopLink.text', { name })}</p>
        </div>
        {done ? (
          <p className="text-success">{t('desktopLink.done')}</p>
        ) : (
          <div className="flex gap-2">
            <Button variant="primary" loading={busy} onClick={() => void allow()}>
              {t('desktopLink.allow')}
            </Button>
            <Button onClick={() => window.close()}>{t('desktopLink.deny')}</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
