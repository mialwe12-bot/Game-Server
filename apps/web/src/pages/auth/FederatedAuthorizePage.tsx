import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { AuthCard, FormError } from './AuthCard';

/**
 * Stufe 2 (Heimat-Server): Der angemeldete Nutzer bestätigt, dass ein anderer
 * Server im Netzwerk ihn mit diesem Konto anmelden darf.
 */
export default function FederatedAuthorizePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const origin = params.get('origin') ?? '';
  const redirect = params.get('redirect') ?? '';
  const state = params.get('state') ?? '';
  let originHost = origin;
  try {
    originHost = new URL(origin).host;
  } catch {
    /* ungültige URL – unten als Fehler behandelt */
  }

  if (!origin || !redirect || !state) {
    return (
      <AuthCard title={t('federatedAuth.title')}>
        <FormError message={t('federatedAuth.invalid')} />
      </AuthCard>
    );
  }

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const { redirectUrl } = await api.federation.authorizeApprove({ origin, redirect, state });
      window.location.href = redirectUrl;
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t('federatedAuth.title')}>
      <p className="text-sm text-muted">{t('federatedAuth.prompt', { origin: originHost, user: user?.displayName || user?.username })}</p>
      {error && (
        <div className="mt-3">
          <FormError message={error} />
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" className="flex-1" onClick={() => void approve()} disabled={busy}>
          {t('federatedAuth.approve')}
        </Button>
        <Button className="flex-1" onClick={() => navigate('/')} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </AuthCard>
  );
}
