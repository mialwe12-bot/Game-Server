import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState, ErrorState, PageLoader } from '../../components/ui';
import { isDesktop } from '../../desktop/bridge';
import { api } from '../../lib/api';
import { WorkshopCard } from './WorkshopTab';

/** Eigene veröffentlichte und abonnierte Workshop-Inhalte */
export default function MyWorkshopPage() {
  const { t } = useTranslation();
  const data = useQuery({ queryKey: ['workshop', 'mine'], queryFn: () => api.workshop.mine() });
  if (data.isLoading) return <PageLoader />;
  if (data.error) return <ErrorState error={data.error} />;
  const { published, subscribed } = data.data!;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-bold">{t('workshop.myTitle')}</h1>
      <p className="text-sm text-muted">{t(isDesktop ? 'workshop.syncHintDesktop' : 'workshop.syncHintWeb')}</p>
      <Card title={t('workshop.mySubscriptions', { count: subscribed.length })}>
        {subscribed.length ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {subscribed.map((i) => (
              <WorkshopCard key={i.id} item={i} />
            ))}
          </div>
        ) : (
          <EmptyState title={t('workshop.noSubscriptions')} />
        )}
      </Card>
      <Card title={t('workshop.myPublished', { count: published.length })}>
        {published.length ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {published.map((i) => (
              <WorkshopCard key={i.id} item={i} />
            ))}
          </div>
        ) : (
          <EmptyState title={t('workshop.noPublished')} />
        )}
      </Card>
    </div>
  );
}
