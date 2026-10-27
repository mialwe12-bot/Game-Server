import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Field, Input } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { AuthCard, FormError } from './AuthCard';

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <AuthCard title={t('auth.resetTitle')}>
      {done ? (
        <div className="space-y-4">
          <p className="text-success">{t('auth.resetDone')}</p>
          <Link to="/login" className="text-accent hover:underline">
            {t('nav.login')}
          </Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (password !== password2) return setError(t('auth.passwordMismatch'));
            setBusy(true);
            setError(null);
            try {
              await api.auth.resetPassword(token, password);
              setDone(true);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <FormError message={error} />
          <Field label={t('account.newPassword')} hint={t('auth.passwordHint')}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required autoComplete="new-password" />
          </Field>
          <Field label={t('auth.passwordRepeat')}>
            <Input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} minLength={10} required autoComplete="new-password" />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!token}>
            {t('common.save')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
