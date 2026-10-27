import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, Gamepad2, Library, LogOut, Maximize, Play, Plus, Square, Store, Trophy, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { GameSummary } from '@gameserver/shared';
import { Avatar } from '../../components/Avatar';
import { presenceLabel, PresenceDot } from '../../components/Social';
import { Markdown } from '../../components/Markdown';
import { desktop, desktopError, isDesktop } from '../../desktop/bridge';
import { activeDownloads, useDesktop } from '../../desktop/DesktopProvider';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatPlaytime } from '../../lib/format';
import { useSpatialNav } from '../../lib/spatial';
import { toast } from '../../lib/toast';

type Section = 'library' | 'store' | 'friends' | 'downloads';

const tileClass =
  'group relative overflow-hidden rounded-xl bg-white/5 outline-none ring-offset-4 ring-offset-[#0d141d] transition focus:scale-105 focus:ring-4 focus:ring-sky-400';

function Cover({ game, onOpen, sub }: { game: Pick<GameSummary, 'title' | 'coverUrl' | 'headerUrl'>; onOpen: () => void; sub?: string }) {
  return (
    <button type="button" data-nav className={clsx(tileClass, 'aspect-[3/4] w-full text-left')} onClick={onOpen}>
      {game.coverUrl ? (
        <img src={api.url(game.coverUrl)} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-600 to-slate-800 p-3 text-center text-xl font-semibold">{game.title}</div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 opacity-0 transition group-focus:opacity-100">
        <p className="truncate text-lg font-semibold">{game.title}</p>
        {sub && <p className="text-sm text-white/70">{sub}</p>}
      </div>
    </button>
  );
}

/**
 * Big-Picture-Modus: Vollbild-Oberfläche für Fernseher, Controller und Steam Deck.
 * Steuerung: Steuerkreuz/Stick bzw. Pfeiltasten, A/Enter = Auswahl, B/Escape = Zurück, LB/RB bzw. Q/E = Bereich.
 */
export default function BigPicturePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const desk = useDesktop();
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<Section>('library');
  const [detail, setDetail] = useState<string | null>(null);
  const sections: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: 'library', label: t('nav.library'), icon: <Library className="size-6" /> },
    { id: 'store', label: t('nav.store'), icon: <Store className="size-6" /> },
    { id: 'friends', label: t('nav.friends'), icon: <Users className="size-6" /> },
    ...(desk ? [{ id: 'downloads' as const, label: t('nav.downloads'), icon: <Download className="size-6" /> }] : []),
  ];
  const cycle = (d: number) => {
    const i = sections.findIndex((s) => s.id === section);
    setDetail(null);
    setSection(sections[(i + d + sections.length) % sections.length].id);
  };
  useSpatialNav(root, {
    onBack: () => (detail ? setDetail(null) : undefined),
    onPrevSection: () => cycle(-1),
    onNextSection: () => cycle(1),
  });

  // Ersten Eintrag fokussieren, wenn sich der Inhalt ändert
  useEffect(() => {
    const timer = setTimeout(() => root.current?.querySelector<HTMLElement>('main [data-nav]')?.focus(), 150);
    return () => clearTimeout(timer);
  }, [section, detail]);

  const exit = async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    navigate('/');
  };

  return (
    <div ref={root} className="dark fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#0d141d] text-white">
      <header className="flex items-center gap-6 px-10 py-6">
        <Gamepad2 className="size-9 text-sky-400" />
        <nav className="flex gap-2">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              data-nav
              onClick={() => (setDetail(null), setSection(s.id))}
              className={clsx(
                'flex items-center gap-2 rounded-full px-5 py-2.5 text-lg font-semibold outline-none transition focus:ring-4 focus:ring-sky-400',
                section === s.id ? 'bg-white text-black' : 'text-white/70 hover:text-white',
              )}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {user && <Avatar user={user} size={40} className="rounded-full" />}
          {!document.fullscreenElement && (
            <button type="button" data-nav onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)} className="rounded-full p-3 outline-none hover:bg-white/10 focus:ring-4 focus:ring-sky-400" aria-label={t('bigPicture.fullscreen')}>
              <Maximize className="size-6" />
            </button>
          )}
          <button type="button" data-nav onClick={() => void exit()} className="flex items-center gap-2 rounded-full px-4 py-2.5 outline-none hover:bg-white/10 focus:ring-4 focus:ring-sky-400">
            <LogOut className="size-6" />
            {t('bigPicture.exit')}
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-10 pb-16">
        {detail ? (
          <GameDetailView gameId={detail} onBack={() => setDetail(null)} />
        ) : section === 'library' ? (
          <LibrarySection onOpen={setDetail} />
        ) : section === 'store' ? (
          <StoreSection onOpen={setDetail} />
        ) : section === 'friends' ? (
          <FriendsSection />
        ) : (
          <DownloadsSection />
        )}
      </main>
      <footer className="flex gap-6 bg-black/40 px-10 py-3 text-sm text-white/60">
        <span>
          <kbd className="rounded bg-white/15 px-1.5">A</kbd> / Enter {t('bigPicture.select')}
        </span>
        <span>
          <kbd className="rounded bg-white/15 px-1.5">B</kbd> / Esc {t('bigPicture.back')}
        </span>
        <span>
          <kbd className="rounded bg-white/15 px-1.5">LB</kbd> <kbd className="rounded bg-white/15 px-1.5">RB</kbd> / Q E {t('bigPicture.sections')}
        </span>
        {isDesktop && <span className="ml-auto">{t('bigPicture.desktopHint')}</span>}
      </footer>
    </div>
  );
}

function LibrarySection({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const desk = useDesktop();
  const lib = useQuery({ queryKey: ['library', 'bp'], queryFn: () => api.library.list({ sort: 'lastPlayed' }) });
  const [installedOnly, setInstalledOnly] = useState(false);
  const entries = (lib.data ?? []).filter((e) => !installedOnly || desk?.installedById.has(e.game.id));
  return (
    <section>
      <div className="mb-6 flex items-center gap-4">
        <h2 className="text-3xl font-bold">{t('nav.library')}</h2>
        {desk && (
          <button type="button" data-nav onClick={() => setInstalledOnly((v) => !v)} className="rounded-full bg-white/10 px-4 py-2 outline-none focus:ring-4 focus:ring-sky-400">
            {installedOnly ? t('bigPicture.showAll') : t('bigPicture.installedOnly')}
          </button>
        )}
      </div>
      {!entries.length && <p className="text-xl text-white/60">{t('bigPicture.emptyLibrary')}</p>}
      <div className="grid grid-cols-3 gap-6 md:grid-cols-4 xl:grid-cols-6">
        {entries.map((e) => (
          <Cover
            key={e.game.id}
            game={e.game}
            onOpen={() => onOpen(e.game.id)}
            sub={desk?.installedById.has(e.game.id) ? t('bigPicture.installed') : e.playtimeSeconds ? formatPlaytime(e.playtimeSeconds) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

function StoreSection({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const home = useQuery({ queryKey: ['store-home'], queryFn: () => api.store.home() });
  const rows: { title: string; games: GameSummary[] }[] = home.data
    ? [
        { title: t('store.featured'), games: home.data.featured },
        { title: t('store.newReleases'), games: home.data.newReleases },
        { title: t('store.popular'), games: home.data.popular },
      ].filter((r) => r.games.length)
    : [];
  return (
    <div className="space-y-10">
      {rows.map((r) => (
        <section key={r.title}>
          <h2 className="mb-4 text-2xl font-bold">{r.title}</h2>
          <div className="grid grid-cols-3 gap-6 md:grid-cols-4 xl:grid-cols-6">
            {r.games.slice(0, 12).map((g) => (
              <Cover key={g.id} game={g} onOpen={() => onOpen(g.id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FriendsSection() {
  const { t } = useTranslation();
  const friends = useQuery({ queryKey: ['friends'], queryFn: () => api.friends.overview() });
  return (
    <section>
      <h2 className="mb-6 text-3xl font-bold">{t('nav.friends')}</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {friends.data?.friends.map((f) => (
          <button key={f.user.id} type="button" data-nav className={clsx(tileClass, 'flex items-center gap-4 p-4 text-left')}>
            <Avatar user={f.user} size={64} className="rounded-full" />
            <div className="min-w-0">
              <p className="truncate text-xl font-semibold">{f.user.displayName || f.user.username}</p>
              <p className={clsx('flex items-center gap-2', f.presence.game ? 'text-green-400' : 'text-white/60')}>
                <PresenceDot presence={f.presence} />
                {presenceLabel(t, f.presence)}
              </p>
            </div>
          </button>
        ))}
      </div>
      {!friends.data?.friends.length && <p className="text-xl text-white/60">{t('social.friends.empty')}</p>}
    </section>
  );
}

function DownloadsSection() {
  const { t } = useTranslation();
  const desk = useDesktop();
  const jobs = desk ? activeDownloads(desk.downloads) : [];
  return (
    <section>
      <h2 className="mb-6 text-3xl font-bold">{t('nav.downloads')}</h2>
      {!jobs.length && <p className="text-xl text-white/60">{t('bigPicture.noDownloads')}</p>}
      <ul className="space-y-4">
        {jobs.map((j) => {
          const pct = j.totalBytes ? Math.round((j.downloadedBytes / j.totalBytes) * 100) : 0;
          return (
            <li key={j.id} className="rounded-xl bg-white/5 p-5">
              <div className="mb-2 flex justify-between text-xl">
                <span className="font-semibold">{j.title}</span>
                <span>{pct} %</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-sky-400" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-3 flex gap-3">
                <button type="button" data-nav className="rounded-full bg-white/10 px-4 py-2 outline-none focus:ring-4 focus:ring-sky-400" onClick={() => void (j.state === 'paused' ? desktop.resumeDownload(j.id) : desktop.pauseDownload(j.id))}>
                  {j.state === 'paused' ? t('desktop.resume') : t('desktop.pause')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GameDetailView({ gameId, onBack }: { gameId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const desk = useDesktop();
  const game = useQuery({ queryKey: ['game', gameId, 'bp'], queryFn: () => api.store.game(gameId) });
  const ach = useQuery({ queryKey: ['achievements', 'game', gameId], queryFn: () => api.achievements.forGame(gameId), enabled: game.isSuccess && (game.data?.achievementCount ?? 0) > 0 });
  if (!game.data) return <p className="text-xl text-white/60">{t('common.loading')}</p>;
  const g = game.data;
  const installed = desk?.installedById.get(g.id);
  const running = desk?.running.has(g.id);
  const btn = 'flex items-center gap-3 rounded-full px-8 py-4 text-2xl font-bold outline-none transition focus:scale-105 focus:ring-4 focus:ring-sky-400';
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(typeof e === 'string' ? desktopError(e) : errorMessage(e));
    }
  };
  return (
    <div className="relative -mx-10 min-h-full">
      {g.headerUrl && <img src={api.url(g.backgroundUrl ?? g.headerUrl)} alt="" className="absolute inset-0 h-96 w-full object-cover opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" />}
      <div className="relative space-y-6 px-10 pt-40">
        <h2 className="text-6xl font-bold drop-shadow">{g.title}</h2>
        <div className="flex flex-wrap gap-4">
          {!g.inLibrary ? (
            <button type="button" data-nav className={clsx(btn, 'bg-sky-500 text-black')} onClick={() => void act(async () => (await api.library.add(g.id), qc.invalidateQueries({ queryKey: ['game', gameId] })))}>
              <Plus className="size-7" />
              {t('store.addToLibrary')}
            </button>
          ) : desk && running ? (
            <button type="button" data-nav className={clsx(btn, 'bg-red-500')} onClick={() => void act(() => desktop.stopGame(g.id))}>
              <Square className="size-7" />
              {t('desktop.stop')}
            </button>
          ) : desk && installed ? (
            <button type="button" data-nav className={clsx(btn, 'bg-green-500 text-black')} onClick={() => void act(() => desk.play(g.id))}>
              <Play className="size-7" />
              {t('desktop.play')}
            </button>
          ) : desk ? (
            <button type="button" data-nav className={clsx(btn, 'bg-sky-500 text-black')} onClick={() => void act(() => desktop.installGame({ gameId: g.id }))}>
              <Download className="size-7" />
              {t('desktop.install')}
            </button>
          ) : (
            <span className="rounded-full bg-white/10 px-6 py-4 text-lg">{t('bigPicture.useClient')}</span>
          )}
          <button type="button" data-nav className={clsx(btn, 'bg-white/10')} onClick={onBack}>
            {t('bigPicture.back')}
          </button>
        </div>
        <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          <div className="text-lg text-white/80">
            <Markdown>{g.shortDescription || g.description.slice(0, 1200)}</Markdown>
          </div>
          <div className="space-y-3 text-lg">
            {g.playtimeSeconds > 0 && (
              <p>
                {t('store.playtime')}: {formatPlaytime(g.playtimeSeconds)}
              </p>
            )}
            {ach.data && (
              <p className="flex items-center gap-2">
                <Trophy className="size-5 text-amber-300" />
                {t('achievements.progress', { unlocked: ach.data.unlocked, total: ach.data.total })}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
