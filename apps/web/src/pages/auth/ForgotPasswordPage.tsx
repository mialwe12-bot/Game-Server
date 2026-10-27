import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, Field, Input } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { AuthCard, FormError } from './AuthCard';

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const { settings } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <AuthCard
      title={t('auth.forgotTitle')}
      footer={
        <Link to="/login" className="text-accent hover:underline">
          {t('nav.login')}
        </Link>
      }
    >
      {!settings?.smtpEnabled ? (
        <p className="text-muted">{t('auth.forgotNoSmtp')}</p>
      ) : sent ? (
        <p className="text-success">{t('auth.forgotSent')}</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api.auth.forgotPassword(email);
              setSent(true);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-sm text-muted">{t('auth.forgotText')}</p>
          <FormError message={error} />
          <Field label={t('auth.email')}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            {t('auth.sendLink')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
