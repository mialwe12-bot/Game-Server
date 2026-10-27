import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BellRing, CheckCheck, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorState, PageLoader } from '../../components/ui';
import { isDesktop } from '../../desktop/bridge';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { notificationPath, notificationText, requestBrowserNotifications } from '../../lib/social';

export default function NotificationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  const list = useInfiniteQuery({
    queryKey: ['notifications', 'all'],
    queryFn: ({ pageParam }) => api.notifications.list(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.items.length >= 30 ? last.items[last.items.length - 1].createdAt : undefined),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });

  if (list.isLoading) return <PageLoader />;
  if (list.error) return <ErrorState error={list.error} />;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('social.notifications.title')}</h1>
        <div className="flex flex-wrap gap-2">
          {!isDesktop && permission === 'default' && (
            <Button size="sm" icon={<BellRing className="size-4" />} onClick={async () => setPermission((await requestBrowserNotifications()) ? 'granted' : 'denied')}>
              {t('social.notifications.enableBrowser')}
            </Button>
          )}
          <Button size="sm" icon={<CheckCheck className="size-4" />} onClick={async () => (await api.notifications.markRead(), refresh())}>
            {t('social.notifications.markAll')}
          </Button>
          <Button size="sm" icon={<Trash2 className="size-4" />} onClick={async () => (await api.notifications.clearRead(), refresh())}>
            {t('social.notifications.clearRead')}
          </Button>
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState title={t('social.notifications.empty')} />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {items.map((n) => (
              <li key={n.id} className={clsx('flex items-center gap-3 py-3', !n.read && 'font-medium')}>
                {!n.read && <span className="size-2 shrink-0 rounded-full bg-accent" />}
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left hover:text-accent"
                  onClick={async () => {
                    if (!n.read) await api.notifications.markRead([n.id]);
                    void refresh();
                    const path = notificationPath(n);
                    if (path) navigate(path);
                  }}
                >
                  <span className="block text-sm">{notificationText(n)}</span>
                  {n.data.preview && <span className="block truncate text-xs font-normal text-muted">{n.data.preview}</span>}
                  <span className="text-xs font-normal text-muted">{formatDateTime(n.createdAt)}</span>
                </button>
                <button type="button" className="rounded p-1 text-muted hover:text-danger" aria-label={t('common.delete')} onClick={async () => (await api.notifications.remove(n.id), refresh())}>
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <div className="pt-3 text-center">
              <Button size="sm" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {t('social.loadMore')}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
