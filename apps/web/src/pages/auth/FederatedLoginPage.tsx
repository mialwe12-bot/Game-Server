import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { AuthCard, FormError } from './AuthCard';

/**
 * Stufe 2 (besuchender Server): Rücksprung vom Heimat-Server. Tauscht den Code
 * gegen eine Sitzung und meldet den (Schatten-)Nutzer an.
 */
export default function FederatedLoginPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      setError(t('federatedAuth.invalid'));
      return;
    }
    api.auth
      .federatedCallback(code, state)
      .then((res) => {
        setUser(res.user);
        navigate('/', { replace: true });
      })
      .catch((e) => setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthCard title={t('federatedAuth.finishTitle')}>
      {error ? (
        <FormError message={error} />
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> {t('federatedAuth.finishing')}
        </div>
      )}
    </AuthCard>
  );
}
