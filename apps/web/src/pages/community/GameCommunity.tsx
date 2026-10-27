import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Heart, Lock, MessageSquare, Pin, Plus, ThumbsDown, ThumbsUp, Trash2, Upload, Laugh, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import type { CommunityItemDto, GameDetail, ReviewDto, ReviewSummary } from '@gameserver/shared';
import { Avatar } from '../../components/Avatar';
import { Markdown } from '../../components/Markdown';
import { UserLink } from '../../components/Social';
import { Badge, Button, Card, ConfirmButton, EmptyState, Field, Input, Modal, Pagination, PageLoader, Select, Spinner, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatDateTime, formatPlaytime } from '../../lib/format';
import { toast } from '../../lib/toast';

export type GameTab = 'store' | 'reviews' | 'forum' | 'screenshots' | 'artwork' | 'guides' | 'news';
const TABS: GameTab[] = ['store', 'reviews', 'forum', 'screenshots', 'artwork', 'guides', 'news'];

export function ScoreBadge({ summary }: { summary: ReviewSummary }) {
  const { t } = useTranslation();
  if (summary.score === 'none') return <span className="text-sm text-muted">{t('social.reviews.noReviews')}</span>;
  const positive = summary.percent >= 70;
  const negative = summary.percent < 40;
  return (
    <span className={clsx('text-sm font-semibold', positive ? 'text-accent' : negative ? 'text-danger' : 'text-warning')} title={t('social.reviews.percent', { percent: summary.percent, total: summary.total })}>
      {t(`social.reviews.score.${summary.score}`)} <span className="font-normal text-muted">({summary.total})</span>
    </span>
  );
}

export function GameTabs({ game, tab }: { game: GameDetail; tab: GameTab }) {
  const { t } = useTranslation();
  const summary = useQuery({ queryKey: ['reviews', 'summary', game.id], queryFn: () => api.community.reviewSummary(game.id) });
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border">
      <nav className="scrollbar-thin -mb-px flex gap-1 overflow-x-auto">
        {TABS.map((id) => (
          <Link
            key={id}
            to={id === 'store' ? `/game/${game.slug}` : `/game/${game.slug}/${id}`}
            className={clsx(
              'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition',
              id === tab ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t(`social.community.tabs.${id}`)}
          </Link>
        ))}
      </nav>
      {summary.data && (
        <Link to={`/game/${game.slug}/reviews`} className="ml-auto pb-2">
          <ScoreBadge summary={summary.data} />
        </Link>
      )}
    </div>
  );
}

export function GameCommunity({ game, tab, topicId }: { game: GameDetail; tab: GameTab; topicId?: string }) {
  switch (tab) {
    case 'reviews':
      return <Reviews game={game} />;
    case 'forum':
      return topicId ? <TopicView id={topicId} /> : <Forum game={game} />;
    case 'screenshots':
      return <Gallery game={game} type="SCREENSHOT" />;
    case 'artwork':
      return <Gallery game={game} type="ARTWORK" />;
    case 'guides':
      return <Guides game={game} />;
    case 'news':
      return <News game={game} />;
    default:
      return null;
  }
}

// ---- Reviews ----

function ReviewCard({ r, onChanged }: { r: ReviewDto; onChanged: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [current, setCurrent] = useState(r);
  const vote = async (helpful: boolean | null, funny = current.myVote?.funny ?? false) => {
    if (!user) return;
    try {
      setCurrent(await api.community.vote(r.id, helpful, funny));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const own = user?.id === r.author.id;
  return (
    <article className="rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-center gap-3">
        <Avatar user={r.author} size={36} />
        <div className="min-w-0 flex-1">
          <UserLink user={r.author} />
          <p className="text-xs text-muted">
            {t('social.reviews.playtimeAt', { time: formatPlaytime(r.playtimeAtReview) })} · {formatDate(r.createdAt)}
          </p>
        </div>
        <span className={clsx('flex items-center gap-1 rounded px-2 py-1 text-sm font-semibold', r.recommended ? 'bg-accent/15 text-accent' : 'bg-danger/15 text-danger')}>
          {r.recommended ? <ThumbsUp className="size-4" /> : <ThumbsDown className="size-4" />}
          {r.recommended ? t('social.reviews.recommended') : t('social.reviews.notRecommended')}
        </span>
      </header>
      <p className="mt-3 text-sm whitespace-pre-wrap">{r.body}</p>
      <footer className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{t('social.reviews.helpfulCount', { count: current.helpful })}</span>
        {current.funny > 0 && <span>· {t('social.reviews.funnyCount', { count: current.funny })}</span>}
        {user && !own && (
          <span className="ml-auto flex items-center gap-1">
            {t('social.reviews.wasHelpful')}
            <Button size="sm" variant={current.myVote?.helpful === true ? 'primary' : 'ghost'} icon={<ThumbsUp className="size-3.5" />} onClick={() => void vote(current.myVote?.helpful === true ? null : true)}>
              {t('common.yes')}
            </Button>
            <Button size="sm" variant={current.myVote?.helpful === false ? 'primary' : 'ghost'} icon={<ThumbsDown className="size-3.5" />} onClick={() => void vote(current.myVote?.helpful === false ? null : false)}>
              {t('common.no')}
            </Button>
            <Button
              size="sm"
              variant={current.myVote?.funny ? 'primary' : 'ghost'}
              icon={<Laugh className="size-3.5" />}
              onClick={() => void vote(current.myVote?.helpful ?? true, !current.myVote?.funny)}
            >
              {t('social.reviews.funny')}
            </Button>
          </span>
        )}
        {user && !own && user.role === 'ADMIN' && (
          <ConfirmButton size="sm" icon={<Trash2 className="size-3.5" />} onConfirm={() => void api.community.deleteReview(r.id).then(onChanged)} />
        )}
      </footer>
    </article>
  );
}

function Reviews({ game }: { game: GameDetail }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [sort, setSort] = useState<'helpful' | 'recent'>('helpful');
  const [filter, setFilter] = useState<'all' | 'positive' | 'negative'>('all');
  const [page, setPage] = useState(1);
  const [writing, setWriting] = useState(false);
  const reviews = useQuery({ queryKey: ['reviews', game.id, sort, filter, page], queryFn: () => api.community.reviews(game.id, { sort, filter, page, pageSize: 10 }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['reviews'] });
  const data = reviews.data;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select className="w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="helpful">{t('social.reviews.sortHelpful')}</option>
            <option value="recent">{t('social.reviews.sortRecent')}</option>
          </Select>
          <Select className="w-auto" value={filter} onChange={(e) => (setFilter(e.target.value as typeof filter), setPage(1))}>
            <option value="all">{t('common.all')}</option>
            <option value="positive">{t('social.reviews.positive')}</option>
            <option value="negative">{t('social.reviews.negative')}</option>
          </Select>
        </div>
        {reviews.isLoading && <Spinner />}
        {data?.items.map((r) => (
          <ReviewCard key={`${r.id}-${r.updatedAt}`} r={r} onChanged={refresh} />
        ))}
        {data && data.items.length === 0 && <EmptyState title={t('social.reviews.noReviews')} />}
        {data && <Pagination page={page} pageSize={10} total={data.total} onChange={setPage} />}
      </div>
      <aside className="space-y-4">
        {data && (
          <Card title={t('social.reviews.overall')}>
            <ScoreBadge summary={data.summary} />
            {data.summary.total > 0 && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-danger/40">
                <div className="h-full bg-accent" style={{ width: `${data.summary.percent}%` }} />
              </div>
            )}
          </Card>
        )}
        {user && (
          <Card title={t('social.reviews.yours')}>
            {data?.mine ? (
              <div className="space-y-2 text-sm">
                <p className="flex items-center gap-1 font-medium">
                  {data.mine.recommended ? <ThumbsUp className="size-4 text-accent" /> : <ThumbsDown className="size-4 text-danger" />}
                  {data.mine.recommended ? t('social.reviews.recommended') : t('social.reviews.notRecommended')}
                </p>
                <p className="line-clamp-4 text-muted">{data.mine.body}</p>
                <div className="flex gap-2">
                  <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => setWriting(true)}>
                    {t('common.edit')}
                  </Button>
                  <ConfirmButton size="sm" icon={<Trash2 className="size-4" />} onConfirm={() => void api.community.deleteMyReview(game.id).then(refresh)}>
                    {t('common.delete')}
                  </ConfirmButton>
                </div>
              </div>
            ) : game.inLibrary ? (
              <Button variant="primary" onClick={() => setWriting(true)}>
                {t('social.reviews.write')}
              </Button>
            ) : (
              <p className="text-sm text-muted">{t('social.reviews.needLibrary')}</p>
            )}
          </Card>
        )}
      </aside>
      {writing && <ReviewModal game={game} mine={data?.mine ?? null} onClose={() => (setWriting(false), void refresh())} />}
    </div>
  );
}

function ReviewModal({ game, mine, onClose }: { game: GameDetail; mine: ReviewDto | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [recommended, setRecommended] = useState(mine?.recommended ?? true);
  const [body, setBody] = useState(mine?.body ?? '');
  const save = useMutation({
    mutationFn: () => api.community.saveReview(game.id, recommended, body),
    onSuccess: onClose,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={t('social.reviews.reviewFor', { title: game.title })} wide>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button variant={recommended ? 'primary' : 'secondary'} icon={<ThumbsUp className="size-4" />} onClick={() => setRecommended(true)}>
            {t('social.reviews.recommend')}
          </Button>
          <Button variant={!recommended ? 'danger' : 'secondary'} icon={<ThumbsDown className="size-4" />} onClick={() => setRecommended(false)}>
            {t('social.reviews.dontRecommend')}
          </Button>
        </div>
        <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} minLength={10} maxLength={10000} placeholder={t('social.reviews.placeholder')} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={body.trim().length < 10} loading={save.isPending} onClick={() => save.mutate()}>
            {t('social.reviews.publish')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Forum ----

function Forum({ game }: { game: GameDetail }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', body: '' });
  const topics = useQuery({ queryKey: ['forum', game.id, page, query], queryFn: () => api.community.topics(game.id, { page, pageSize: 25, q: query || undefined }) });
  const create = useMutation({
    mutationFn: () => api.community.createTopic(game.id, form.title, form.body),
    onSuccess: (topic) => navigate(`/game/${game.slug}/forum/${topic.id}`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
            setPage(1);
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('social.forum.search')} />
          <Button type="submit">{t('common.search')}</Button>
        </form>
        {user && (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t('social.forum.newTopic')}
          </Button>
        )}
      </div>
      {topics.isLoading ? (
        <Spinner />
      ) : topics.data?.items.length ? (
        <Card>
          <ul className="divide-y divide-border">
            {topics.data.items.map((tp) => (
              <li key={tp.id}>
                <Link to={`/game/${game.slug}/forum/${tp.id}`} className="flex items-center gap-3 py-3 hover:text-accent">
                  <MessageSquare className="size-5 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 truncate font-medium">
                      {tp.pinned && <Pin className="size-3.5 text-accent" />}
                      {tp.locked && <Lock className="size-3.5 text-muted" />}
                      {tp.title}
                    </p>
                    <p className="text-xs text-muted">
                      {tp.author?.displayName || tp.author?.username || '—'} · {formatDateTime(tp.createdAt)}
                    </p>
                  </div>
                  <span className="text-right text-xs text-muted">
                    {t('social.forum.posts', { count: tp.postCount })}
                    <br />
                    {formatDateTime(tp.lastPostAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={25} total={topics.data.total} onChange={setPage} />
        </Card>
      ) : (
        <EmptyState title={t('social.forum.empty')} />
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title={t('social.forum.newTopic')} wide>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label={t('social.forum.topicTitle')}>
            <Input required minLength={3} maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label={t('social.forum.message')} hint={t('common.markdownHint')}>
            <Textarea required rows={8} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={create.isPending}>
              {t('social.forum.create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function TopicView({ id }: { id: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [reply, setReply] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const topic = useQuery({ queryKey: ['topic', id, page], queryFn: () => api.community.topic(id, page) });
  const refresh = () => void topic.refetch();
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  if (topic.isLoading) return <PageLoader />;
  if (topic.error) return <p className="text-muted">{errorMessage(topic.error)}</p>;
  const d = topic.data!;
  return (
    <div className="space-y-3">
      <Link to={`/game/${d.game.slug}/forum`} className="text-sm text-accent hover:underline">
        ← {t('social.community.tabs.forum')}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-xl font-bold">
          {d.topic.pinned && <Pin className="mr-1 inline size-4 text-accent" />}
          {d.topic.locked && <Lock className="mr-1 inline size-4 text-muted" />}
          {d.topic.title}
        </h2>
        {d.canModerate && (
          <div className="flex gap-1">
            <Button size="sm" icon={<Pin className="size-4" />} onClick={() => void run(() => api.community.updateTopic(id, { pinned: !d.topic.pinned }))}>
              {d.topic.pinned ? t('social.forum.unpin') : t('social.forum.pin')}
            </Button>
            <Button size="sm" icon={<Lock className="size-4" />} onClick={() => void run(() => api.community.updateTopic(id, { locked: !d.topic.locked }))}>
              {d.topic.locked ? t('social.forum.unlock') : t('social.forum.lock')}
            </Button>
            <ConfirmButton size="sm" icon={<Trash2 className="size-4" />} onConfirm={() => void api.community.deleteTopic(id).then(() => navigate(`/game/${d.game.slug}/forum`))}>
              {t('common.delete')}
            </ConfirmButton>
          </div>
        )}
      </div>
      {d.posts.map((p) => (
        <article key={p.id} className="flex gap-3 rounded-lg border border-border bg-surface p-4">
          {p.author ? <Avatar user={p.author} size={40} /> : <span className="size-10" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              {p.author ? <UserLink user={p.author} /> : '—'} <span className="text-xs text-muted">{formatDateTime(p.createdAt)}</span>
              {p.editedAt && <span className="ml-1 text-xs text-muted">({t('social.chat.edited')})</span>}
            </p>
            {editing?.id === p.id ? (
              <div className="mt-2 space-y-2">
                <Textarea rows={5} value={editing.body} onChange={(e) => setEditing({ id: p.id, body: e.target.value })} />
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => void run(() => api.community.editPost(p.id, editing.body)).then(() => setEditing(null))}>
                    {t('common.save')}
                  </Button>
                  <Button size="sm" onClick={() => setEditing(null)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <Markdown className="mt-1">{p.body}</Markdown>
            )}
          </div>
          {user && (p.author?.id === user.id || d.canModerate) && editing?.id !== p.id && (
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing({ id: p.id, body: p.body })} aria-label={t('common.edit')} />
              <ConfirmButton
                size="sm"
                icon={<Trash2 className="size-3.5" />}
                onConfirm={() =>
                  void run(async () => {
                    await api.community.deletePost(p.id);
                    if (p.id === d.posts[0]?.id && page === 1) navigate(`/game/${d.game.slug}/forum`);
                  })
                }
              />
            </div>
          )}
        </article>
      ))}
      <Pagination page={page} pageSize={50} total={d.total} onChange={setPage} />
      {user && (!d.topic.locked || d.canModerate) ? (
        <Card title={t('social.forum.reply')}>
          <Textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t('common.markdownHint')} />
          <div className="mt-2 flex justify-end">
            <Button variant="primary" disabled={!reply.trim()} onClick={() => void run(() => api.community.reply(id, reply)).then(() => setReply(''))}>
              {t('social.forum.send')}
            </Button>
          </div>
        </Card>
      ) : d.topic.locked ? (
        <p className="text-sm text-muted">{t('social.forum.lockedHint')}</p>
      ) : null}
    </div>
  );
}

// ---- Screenshots / Artworks ----

function Gallery({ game, type }: { game: GameDetail; type: 'SCREENSHOT' | 'ARTWORK' }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [sort, setSort] = useState<'recent' | 'popular'>('recent');
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const items = useQuery({ queryKey: ['community-items', game.id, type, sort, page], queryFn: () => api.community.items(game.id, { type, sort, page, pageSize: 24 }) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select className="w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="recent">{t('social.reviews.sortRecent')}</option>
          <option value="popular">{t('social.community.popular')}</option>
        </Select>
        {user && (
          <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => setUploading(true)}>
            {t(type === 'SCREENSHOT' ? 'social.community.uploadScreenshot' : 'social.community.uploadArtwork')}
          </Button>
        )}
      </div>
      {items.isLoading ? (
        <Spinner />
      ) : items.data?.items.length ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {items.data.items.map((i) => (
              <Link key={i.id} to={`/community/items/${i.id}`} className="group overflow-hidden rounded-lg border border-border bg-surface">
                <img src={api.url(i.imageUrl)} alt={i.title} className="aspect-video w-full object-cover transition group-hover:scale-105" loading="lazy" />
                <div className="flex items-center gap-2 p-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">{i.title || i.author?.displayName || i.author?.username}</span>
                  <span className="flex items-center gap-0.5 text-muted">
                    <Heart className={clsx('size-3.5', i.liked && 'fill-danger text-danger')} />
                    {i.likes}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <Pagination page={page} pageSize={24} total={items.data.total} onChange={setPage} />
        </>
      ) : (
        <EmptyState title={t('social.community.emptyGallery')} />
      )}
      {uploading && <UploadModal game={game} type={type} onClose={() => (setUploading(false), void qc.invalidateQueries({ queryKey: ['community-items'] }))} />}
    </div>
  );
}

function UploadModal({ game, type, onClose }: { game: GameDetail; type: 'SCREENSHOT' | 'ARTWORK'; onClose: () => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const upload = useMutation({
    mutationFn: () => api.community.uploadImage(game.id, file!, { type, title, body }),
    onSuccess: onClose,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={t(type === 'SCREENSHOT' ? 'social.community.uploadScreenshot' : 'social.community.uploadArtwork')}>
      <div className="space-y-3">
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file && <img src={URL.createObjectURL(file)} alt="" className="max-h-48 rounded" />}
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('social.community.titlePlaceholder')} maxLength={160} />
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('social.community.descriptionPlaceholder')} maxLength={2000} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!file} loading={upload.isPending} onClick={() => upload.mutate()}>
            {t('social.community.upload')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Guides ----

function Guides({ game }: { game: GameDetail }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [writing, setWriting] = useState(false);
  const [form, setForm] = useState({ title: '', body: '' });
  const items = useQuery({ queryKey: ['community-items', game.id, 'GUIDE', page], queryFn: () => api.community.items(game.id, { type: 'GUIDE', sort: 'popular', page, pageSize: 20 }) });
  const create = useMutation({
    mutationFn: () => api.community.createGuide(game.id, form.title, form.body),
    onSuccess: (item) => navigate(`/community/items/${item.id}`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-3">
      {user && (
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setWriting(true)}>
          {t('social.community.writeGuide')}
        </Button>
      )}
      {items.data?.items.length ? (
        <Card>
          <ul className="divide-y divide-border">
            {items.data.items.map((i: CommunityItemDto) => (
              <li key={i.id}>
                <Link to={`/community/items/${i.id}`} className="flex items-center gap-3 py-3 hover:text-accent">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{i.title}</p>
                    <p className="text-xs text-muted">
                      {i.author?.displayName || i.author?.username || '—'} · {formatDate(i.updatedAt)}
                    </p>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <Heart className={clsx('size-3.5', i.liked && 'fill-danger text-danger')} /> {i.likes}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={20} total={items.data.total} onChange={setPage} />
        </Card>
      ) : items.isLoading ? (
        <Spinner />
      ) : (
        <EmptyState title={t('social.community.emptyGuides')} />
      )}
      <Modal open={writing} onClose={() => setWriting(false)} title={t('social.community.writeGuide')} wide>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label={t('social.forum.topicTitle')}>
            <Input required minLength={3} maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label={t('social.community.guideBody')} hint={t('common.markdownHint')}>
            <Textarea required minLength={20} rows={14} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={create.isPending}>
              {t('social.reviews.publish')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ---- News ----

function News({ game }: { game: GameDetail }) {
  const { t } = useTranslation();
  const news = useQuery({ queryKey: ['news', game.id], queryFn: () => api.community.news(game.id) });
  if (news.isLoading) return <Spinner />;
  if (!news.data?.length) return <EmptyState title={t('social.community.noNews')} />;
  return (
    <div className="space-y-3">
      {news.data.map((a) => (
        <Card key={a.id} title={a.title}>
          <p className="mb-2 flex items-center gap-2 text-xs text-muted">
            {a.pinned && <Badge tone="accent">{t('social.forum.pinned')}</Badge>}
            {formatDateTime(a.createdAt)}
          </p>
          <Markdown>{a.body}</Markdown>
        </Card>
      ))}
    </div>
  );
}
