import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="py-24 text-center">
      <p className="text-6xl font-bold text-accent">404</p>
      <h1 className="mt-4 text-2xl font-semibold">{t('common.notFound')}</h1>
      <p className="mt-2 text-muted">{t('common.notFoundText')}</p>
      <Link to="/" className="mt-6 inline-block text-accent hover:underline">
        {t('common.toHome')}
      </Link>
    </div>
  );
}
