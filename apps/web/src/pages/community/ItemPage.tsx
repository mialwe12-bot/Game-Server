import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Heart, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../../components/Avatar';
import { Markdown } from '../../components/Markdown';
import { UserLink } from '../../components/Social';
import { Button, ConfirmButton, ErrorState, Input, PageLoader, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { toast } from '../../lib/toast';

/** Einzelansicht für Screenshot, Artwork oder Guide */
export default function ItemPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const item = useQuery({ queryKey: ['community-item', id], queryFn: () => api.community.item(id) });
  const [like, setLike] = useState<{ likes: number; liked: boolean } | null>(null);
  const [edit, setEdit] = useState<{ title: string; body: string } | null>(null);

  if (item.isLoading) return <PageLoader />;
  if (item.error) return <ErrorState error={item.error} />;
  const i = item.data!;
  const likes = like ?? { likes: i.likes, liked: i.liked };
  const tab = i.type === 'GUIDE' ? 'guides' : i.type === 'ARTWORK' ? 'artwork' : 'screenshots';

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link to={`/game/${i.game.slug}/${tab}`} className="text-sm text-accent hover:underline">
        ← {i.game.title} · {t(`social.community.tabs.${tab}`)}
      </Link>
      {edit ? (
        <div className="space-y-2">
          <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} maxLength={160} />
          <Textarea rows={i.type === 'GUIDE' ? 16 : 4} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await api.community.updateItem(i.id, edit);
                  setEdit(null);
                  void item.refetch();
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              {t('common.save')}
            </Button>
            <Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="flex-1 text-2xl font-bold">{i.title || t(`social.community.types.${i.type}`)}</h1>
            <Button
              variant={likes.liked ? 'primary' : 'secondary'}
              icon={<Heart className={clsx('size-4', likes.liked && 'fill-current')} />}
              disabled={!user}
              onClick={async () => setLike(await (likes.liked ? api.community.unlike(i.id) : api.community.like(i.id)))}
            >
              {likes.likes}
            </Button>
            {i.canEdit && (
              <>
                <Button icon={<Pencil className="size-4" />} onClick={() => setEdit({ title: i.title, body: i.body })}>
                  {t('common.edit')}
                </Button>
                <ConfirmButton icon={<Trash2 className="size-4" />} onConfirm={() => void api.community.deleteItem(i.id).then(() => navigate(`/game/${i.game.slug}/${tab}`))}>
                  {t('common.delete')}
                </ConfirmButton>
              </>
            )}
          </div>
          <p className="flex items-center gap-2 text-sm text-muted">
            {i.author && <Avatar user={i.author} size={24} />}
            {i.author && <UserLink user={i.author} />} · {formatDateTime(i.createdAt)}
          </p>
          {i.imageUrl && (
            <a href={api.url(i.imageUrl)} target="_blank" rel="noreferrer">
              <img src={api.url(i.imageUrl)} alt={i.title} className="max-h-[75vh] w-full rounded-lg border border-border object-contain" />
            </a>
          )}
          {i.body && (i.type === 'GUIDE' ? <Markdown className="rounded-lg border border-border bg-surface p-6">{i.body}</Markdown> : <p className="whitespace-pre-wrap">{i.body}</p>)}
        </>
      )}
    </div>
  );
}
