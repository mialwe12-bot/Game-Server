import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, ChevronLeft, ChevronRight, Download, ExternalLink, Heart, Pencil, Plus, Star } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { trailerEmbed, type BuildDto, type GameDetail, type MediaDto, type Platform, type VersionDto } from '@gameserver/shared';
import { GameCard, GameCover } from '../../components/GameCard';
import { Markdown } from '../../components/Markdown';
import { PlatformIcon } from '../../components/PlatformIcons';
import { Badge, Button, Card, ErrorState, PageLoader, Tabs } from '../../components/ui';
import { GameCommunity, GameTabs, type GameTab } from '../community/GameCommunity';
import { GameExtras } from './GameExtras';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBytes, formatDate, formatPlaytime } from '../../lib/format';
import { toast } from '../../lib/toast';
import NotFoundPage from '../NotFoundPage';
import { useDesktop } from '../../desktop/DesktopProvider';
import { GameInstallPanel } from '../../desktop/GameInstallPanel';

type Slide = { type: 'image'; media: MediaDto } | { type: 'youtube' | 'video'; src: string };

function MediaGallery({ game }: { game: GameDetail }) {
  const slides: Slide[] = [
    ...game.trailerUrls.map((u) => trailerEmbed(u)).filter((x): x is NonNullable<typeof x> => !!x).map((e) => ({ type: e.type, src: e.src }) as Slide),
    ...game.media.filter((m) => m.kind === 'SCREENSHOT' || m.kind === 'ARTWORK').map((media) => ({ type: 'image' as const, media })),
  ];
  const [index, setIndex] = useState(0);
  if (slides.length === 0) return <GameCover game={game} landscape className="rounded-lg" />;
  const current = slides[Math.min(index, slides.length - 1)];
  return (
    <div className="space-y-2">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
        {current.type === 'image' && <img src={api.url(current.media.url)} alt="" className="size-full object-contain" />}
        {current.type === 'youtube' && (
          <iframe
            src={current.src}
            title="Trailer"
            className="size-full"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
        {current.type === 'video' && <video src={current.src} controls className="size-full" preload="metadata" />}
        {slides.length > 1 && (
          <>
            <button
              type="button"
              className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
              aria-label="prev"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              onClick={() => setIndex((i) => (i + 1) % slides.length)}
              aria-label="next"
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </div>
      {slides.length > 1 && (
        <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
          {slides.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              className={clsx('aspect-video w-28 shrink-0 overflow-hidden rounded border-2', i === index ? 'border-accent' : 'border-transparent opacity-70 hover:opacity-100')}
            >
              {s.type === 'image' ? (
                <img src={api.url(s.media.url)} alt="" className="size-full object-cover" loading="lazy" />
              ) : (
                <span className="flex size-full items-center justify-center bg-surface-2 text-xs">▶ Trailer</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BuildDownload({ build }: { build: BuildDto }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showFiles, setShowFiles] = useState(false);
  const manifest = useQuery({
    queryKey: ['manifest', build.id],
    queryFn: () => api.builds.manifest(build.id),
    enabled: showFiles && !!user,
  });
  const requireLogin = () => navigate(`/login?next=${encodeURIComponent(location.pathname)}`);

  return (
    <div className="rounded-md border border-border bg-surface-2/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PlatformIcon platform={build.platform} className="size-5" />
          <div>
            <p className="font-semibold">{t(`platforms.${build.platform}`)}</p>
            <p className="text-xs text-muted">
              {t(`buildKinds.${build.kind}`)} · {formatBytes(build.totalSize)}
              {build.installSize > 0 && ` · ${t('store.installSize')}: ${formatBytes(build.installSize)}`}
            </p>
          </div>
        </div>
        {build.kind === 'FOLDER' ? (
          <Button size="sm" onClick={() => (user ? setShowFiles((s) => !s) : requireLogin())} icon={<Download className="size-4" />}>
            {t('store.downloadFor', { platform: t(`platforms.${build.platform}`) })}
          </Button>
        ) : user ? (
          <a
            href={api.builds.downloadUrl(build.id)}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-success px-3 text-sm font-medium text-white hover:brightness-110"
          >
            <Download className="size-4" />
            {t('store.downloadFor', { platform: t(`platforms.${build.platform}`) })}
          </a>
        ) : (
          <Button size="sm" variant="success" onClick={requireLogin} icon={<Download className="size-4" />}>
            {t('store.downloadFor', { platform: t(`platforms.${build.platform}`) })}
          </Button>
        )}
      </div>
      {build.linuxRunner !== 'NONE' && (
        <p className="mt-2 text-xs text-muted">{t('store.linuxRunner', { runner: t(`runners.${build.linuxRunner}`) })}</p>
      )}
      {showFiles && manifest.data && (
        <div className="mt-3 space-y-1 text-xs">
          <p className="text-muted">{t('store.folderBuildHint', { count: manifest.data.files.length })}</p>
          <ul className="max-h-64 overflow-y-auto rounded border border-border">
            {manifest.data.files.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 border-b border-border px-2 py-1 last:border-0">
                <a href={api.url(f.downloadUrl)} className="truncate font-mono text-accent hover:underline">
                  {f.path}
                </a>
                <span className="shrink-0 text-muted">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Versions({ versions }: { versions: VersionDto[] }) {
  const { t } = useTranslation();
  const published = versions.filter((v) => v.published);
  if (published.length <= 1 && !published[0]?.changelog) return null;
  return (
    <Card title={t('store.versions')}>
      <div className="space-y-4">
        {published.map((v) => (
          <details key={v.id} className="group rounded-md border border-border p-3" open={v === published[0]}>
            <summary className="flex cursor-pointer items-center justify-between gap-2">
              <span className="font-semibold">
                {t('store.version')} {v.version}
              </span>
              <span className="text-xs text-muted">{formatDate(v.publishedAt ?? v.createdAt)}</span>
            </summary>
            {v.changelog && <Markdown className="mt-3">{v.changelog}</Markdown>}
          </details>
        ))}
      </div>
    </Card>
  );
}

function Requirements({ game }: { game: GameDetail }) {
  const { t } = useTranslation();
  const keys = (['windows', 'linux', 'macos'] as const).filter((k) => game.systemRequirements[k]?.minimum || game.systemRequirements[k]?.recommended);
  const [tab, setTab] = useState(keys[0]);
  if (keys.length === 0 || !tab) return null;
  const req = game.systemRequirements[tab]!;
  const platformOf = { windows: 'WINDOWS', linux: 'LINUX', macos: 'MACOS' } as const;
  return (
    <Card title={t('store.systemRequirements')}>
      <Tabs tabs={keys.map((k) => ({ id: k, label: t(`platforms.${platformOf[k] as Platform}`) }))} value={tab} onChange={setTab} />
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        {req.minimum && (
          <div>
            <h4 className="mb-2 text-sm font-semibold uppercase text-muted">{t('store.minimum')}</h4>
            <Markdown>{req.minimum}</Markdown>
          </div>
        )}
        {req.recommended && (
          <div>
            <h4 className="mb-2 text-sm font-semibold uppercase text-muted">{t('store.recommendedReq')}</h4>
            <Markdown>{req.recommended}</Markdown>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function GamePage() {
  const { slug = '', tab: tabParam, topicId } = useParams();
  const tab = topicId ? 'forum' : (tabParam ?? 'store');
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const desk = useDesktop();
  const game = useQuery({ queryKey: ['game', slug, user?.id], queryFn: () => api.store.game(slug) });
  const similar = useQuery({ queryKey: ['similar', slug], queryFn: () => api.store.similar(slug), enabled: game.isSuccess });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['game', slug] });
    void qc.invalidateQueries({ queryKey: ['library'] });
    void qc.invalidateQueries({ queryKey: ['wishlist'] });
  };
  const mutate = useMutation({
    mutationFn: async (action: 'add' | 'remove' | 'wish' | 'unwish' | 'fav' | 'unfav') => {
      const id = game.data!.id;
      if (action === 'add') await api.library.add(id);
      if (action === 'remove') await api.library.remove(id);
      if (action === 'wish') await api.library.addToWishlist(id);
      if (action === 'unwish') await api.library.removeFromWishlist(id);
      if (action === 'fav') await api.library.update(id, { favorite: true });
      if (action === 'unfav') await api.library.update(id, { favorite: false });
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (game.isLoading) return <PageLoader />;
  if (game.error) {
    if ((game.error as { status?: number }).status === 404) return <NotFoundPage />;
    if ((game.error as { status?: number }).status === 401) {
      navigate(`/login?next=/game/${slug}`, { replace: true });
      return null;
    }
    return <ErrorState error={game.error} onRetry={() => game.refetch()} />;
  }
  const g = game.data!;
  const latest = g.latestVersion;
  const needLogin = () => navigate(`/login?next=/game/${slug}`);

  return (
    <div className="relative">
      {g.backgroundUrl && (
        <div
          className="pointer-events-none absolute inset-x-0 -top-6 -z-10 h-[520px] bg-cover bg-center opacity-25 [mask-image:linear-gradient(to_bottom,black,transparent)]"
          style={{ backgroundImage: `url(${api.url(g.backgroundUrl)})` }}
        />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-3xl font-bold">{g.title}</h1>
        {g.visibility !== 'PUBLIC' && (
          <Badge tone="warning">
            {g.visibility === 'RESTRICTED' ? t('store.restricted') : g.visibility === 'UNLISTED' ? t('store.unlisted') : t('store.hidden')}
          </Badge>
        )}
        {g.canEdit && (
          <Link to={`/admin/games/${g.id}`} className="ml-auto inline-flex items-center gap-1 text-sm text-accent hover:underline">
            <Pencil className="size-4" /> {t('store.edit')}
          </Link>
        )}
      </div>
      <GameTabs game={g} tab={tab as GameTab} />

      {tab !== 'store' ? (
        <GameCommunity game={g} tab={tab as GameTab} topicId={topicId} />
      ) : (
      <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <MediaGallery game={g} />
        <aside className="space-y-4">
          <GameCover game={g} landscape className="hidden rounded-lg lg:block" />
          {g.shortDescription && <p className="text-sm">{g.shortDescription}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {g.releaseDate && (
              <>
                <dt className="text-muted">{t('store.releaseDate')}</dt>
                <dd>{formatDate(g.releaseDate)}</dd>
              </>
            )}
            {g.developer && (
              <>
                <dt className="text-muted">{t('store.developer')}</dt>
                <dd>{g.developer}</dd>
              </>
            )}
            {g.publisher && (
              <>
                <dt className="text-muted">{t('store.publisher')}</dt>
                <dd>{g.publisher}</dd>
              </>
            )}
            {g.website && (
              <>
                <dt className="text-muted">{t('store.website')}</dt>
                <dd>
                  <a href={g.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-accent hover:underline">
                    {new URL(g.website).hostname} <ExternalLink className="size-3" />
                  </a>
                </dd>
              </>
            )}
            <dt className="text-muted">{t('store.downloads')}</dt>
            <dd>
              {g.downloadCount} · {t('store.owners', { count: g.libraryCount })}
            </dd>
          </dl>
          <div className="flex flex-wrap gap-1">
            {g.genres.map((x) => (
              <Link key={x.id} to={`/search?genres=${x.slug}`} className="rounded bg-accent/15 px-2 py-0.5 text-xs text-accent hover:bg-accent/25">
                {x.name}
              </Link>
            ))}
            {g.tags.map((x) => (
              <Link key={x.id} to={`/search?tags=${x.slug}`} className="rounded bg-surface-2 px-2 py-0.5 text-xs hover:bg-border">
                {x.name}
              </Link>
            ))}
          </div>
        </aside>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <div className="order-2 space-y-6 lg:order-1">
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-semibold">{g.title}</span>
              <span className="rounded bg-success/15 px-2 py-0.5 text-sm font-semibold text-success">{t('store.free')}</span>
              <div className="ml-auto flex flex-wrap gap-2">
                {g.inLibrary ? (
                  <>
                    <Button
                      variant="ghost"
                      icon={<Star className={clsx('size-4', g.favorite && 'fill-warning text-warning')} />}
                      onClick={() => mutate.mutate(g.favorite ? 'unfav' : 'fav')}
                    >
                      {g.favorite ? t('library.unfavorite') : t('library.favorite')}
                    </Button>
                    <Button variant="secondary" icon={<Check className="size-4" />} onClick={() => mutate.mutate('remove')} title={t('store.removeFromLibrary')}>
                      {t('store.inLibrary')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      icon={<Heart className={clsx('size-4', g.inWishlist && 'fill-danger text-danger')} />}
                      onClick={() => (user ? mutate.mutate(g.inWishlist ? 'unwish' : 'wish') : needLogin())}
                    >
                      {g.inWishlist ? t('store.onWishlist') : t('store.addToWishlist')}
                    </Button>
                    <Button variant="primary" icon={<Plus className="size-4" />} loading={mutate.isPending} onClick={() => (user ? mutate.mutate('add') : needLogin())}>
                      {t('store.addToLibrary')}
                    </Button>
                  </>
                )}
              </div>
            </div>
            {g.inLibrary && g.playtimeSeconds > 0 && (
              <p className="mt-2 text-sm text-muted">
                {t('store.playtime')}: {formatPlaytime(g.playtimeSeconds)}
              </p>
            )}
            <GameExtras game={g} />
          </Card>

          {desk ? (
            <GameInstallPanel game={g} />
          ) : (
          <Card title={t('store.downloads')}>
              {latest ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted">
                    {t('store.version')} {latest.version} · {formatDate(latest.publishedAt ?? latest.createdAt)}
                  </p>
                  {latest.builds
                    .filter((b) => b.status === 'READY')
                    .map((b) => (
                      <BuildDownload key={b.id} build={b} />
                    ))}
                  <p className="text-xs text-muted">{t('library.clientHint')}</p>
                </div>
              ) : (
                <p className="text-sm text-muted">{t('store.noBuilds')}</p>
              )}
            </Card>
          )}

          {g.description && (
            <Card title={t('store.about')}>
              <Markdown>{g.description}</Markdown>
            </Card>
          )}
          <Requirements game={g} />
          <Versions versions={g.versions} />
          {g.announcements.length > 0 && (
            <Card title={t('store.announcements')}>
              <div className="space-y-4">
                {g.announcements.map((a) => (
                  <article key={a.id}>
                    <h3 className="font-semibold">{a.title}</h3>
                    <p className="mb-1 text-xs text-muted">{formatDate(a.createdAt)}</p>
                    <Markdown>{a.body}</Markdown>
                  </article>
                ))}
              </div>
            </Card>
          )}
        </div>
        <aside className="order-1 space-y-4 lg:order-2">
          {!!similar.data?.length && (
            <Card title={t('store.similar')}>
              <div className="grid grid-cols-2 gap-3">
                {similar.data.slice(0, 6).map((s) => (
                  <GameCard key={s.id} game={s} />
                ))}
              </div>
            </Card>
          )}
        </aside>
      </div>
      </>
      )}
    </div>
  );
}
