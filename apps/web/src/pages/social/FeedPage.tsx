import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorState, PageLoader } from '../../components/ui';
import { api } from '../../lib/api';
import { ActivityList } from './ActivityList';

/** Aktivitäts-Feed: eigene Aktivitäten und die von Freunden */
export default function FeedPage() {
  const { t } = useTranslation();
  const feed = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) => api.notifications.feed(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length >= 30 ? last[last.length - 1].createdAt : undefined),
  });
  if (feed.isLoading) return <PageLoader />;
  if (feed.error) return <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />;
  const items = feed.data?.pages.flat() ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('social.activity.title')}</h1>
        <Link to="/friends" className="text-sm text-accent hover:underline">
          {t('nav.friends')}
        </Link>
      </div>
      <Card>
        <ActivityList items={items} />
        {feed.hasNextPage && (
          <div className="pt-3 text-center">
            <Button size="sm" loading={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
              {t('social.loadMore')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
