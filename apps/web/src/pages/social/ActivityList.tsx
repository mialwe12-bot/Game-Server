import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ActivityDto } from '@gameserver/shared';
import { Avatar } from '../../components/Avatar';
import { UserLink } from '../../components/Social';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

function activityText(t: (k: string, o?: Record<string, unknown>) => string, a: ActivityDto): string {
  const d = a.data;
  switch (a.type) {
    case 'review.created':
      return t(d.recommended === 'false' ? 'social.activity.reviewNegative' : 'social.activity.reviewPositive');
    case 'community.posted':
      return t(`social.activity.posted.${d.itemType ?? 'SCREENSHOT'}`, { title: d.title ?? '' });
    case 'group.joined':
      return t('social.activity.groupJoined', { group: d.groupName ?? '' });
    case 'friend.added':
      return t('social.activity.friendAdded', { name: d.displayName ?? d.username ?? '' });
    case 'forum.topic':
      return t('social.activity.forumTopic', { title: d.title ?? '' });
    default:
      return t(`social.activity.${a.type === 'library.added' ? 'libraryAdded' : 'gamePlayed'}`);
  }
}

function activityLink(a: ActivityDto): string | null {
  const d = a.data;
  if (a.type === 'group.joined' && d.groupSlug) return `/groups/${d.groupSlug}`;
  if (a.type === 'friend.added' && d.username) return `/u/${d.username}`;
  if (a.type === 'forum.topic' && a.game && d.topicId) return `/game/${a.game.slug}/forum/${d.topicId}`;
  if (a.type === 'community.posted' && d.itemId) return `/community/items/${d.itemId}`;
  if (a.type === 'review.created' && a.game) return `/game/${a.game.slug}/reviews`;
  return a.game ? `/game/${a.game.slug}` : null;
}

export function ActivityList({ items, showUser = true }: { items: ActivityDto[]; showUser?: boolean }) {
  const { t } = useTranslation();
  if (!items.length) return <p className="py-6 text-center text-sm text-muted">{t('social.activity.empty')}</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((a) => {
        const link = activityLink(a);
        return (
          <li key={a.id} className="flex items-center gap-3 py-3">
            {showUser && <Avatar user={a.user} size={36} />}
            <div className="min-w-0 flex-1 text-sm">
              <p>
                {showUser && (
                  <>
                    <UserLink user={a.user} />{' '}
                  </>
                )}
                {link ? (
                  <Link to={link} className="hover:text-accent">
                    {activityText(t, a)}
                  </Link>
                ) : (
                  activityText(t, a)
                )}
                {a.game && (
                  <>
                    {' · '}
                    <Link to={`/game/${a.game.slug}`} className="font-medium text-accent hover:underline">
                      {a.game.title}
                    </Link>
                  </>
                )}
              </p>
              <p className="text-xs text-muted">{formatDateTime(a.createdAt)}</p>
            </div>
            {a.game?.coverUrl && (
              <Link to={`/game/${a.game.slug}`} className="shrink-0">
                <img src={api.url(a.game.coverUrl)} alt="" className="h-12 w-9 rounded object-cover" loading="lazy" />
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
