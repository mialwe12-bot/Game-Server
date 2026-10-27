import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Camera, Globe, MessageSquare, NotebookPen, Trophy, Users, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { PresenceAvatar, presenceLabel } from '../components/Social';
import { Button, EmptyState, Input, Spinner, Textarea } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { toast } from '../lib/toast';
import ChatPage from '../pages/chat/ChatPage';
import { AchievementRow } from '../pages/achievements/AchievementList';
import { desktop, desktopError } from './bridge';
import { useDesktopRequired } from './DesktopProvider';
import { ScreenshotGrid } from './ScreenshotsPage';

/**
 * Overlay (eigenes Always-on-top-Fenster, Hotkey Standard Umschalt+Tab).
 * Ehrlicher Hinweis: Es wird nicht in das Spiel „eingeklinkt“ (kein Grafik-Hooking) – über exklusivem Vollbild
 * erscheint es daher nicht; im Fenster- oder randlosen Modus liegt es über dem Spiel.
 */
export default function OverlayPage() {
  const { t } = useTranslation();
  const desk = useDesktopRequired();
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && void desktop.toggleOverlay(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const gameId = desk.running.size ? [...desk.running][0] : null;
  const game = gameId ? desk.installedById.get(gameId) : null;
  const tabs = [
    { to: '/overlay', label: t('nav.friends'), icon: <Users className="size-5" />, end: true },
    { to: '/overlay/chat', label: t('social.chat.title'), icon: <MessageSquare className="size-5" /> },
    { to: '/overlay/achievements', label: t('overlay.achievements'), icon: <Trophy className="size-5" /> },
    { to: '/overlay/browser', label: t('overlay.browser'), icon: <Globe className="size-5" /> },
    { to: '/overlay/notes', label: t('overlay.notes'), icon: <NotebookPen className="size-5" /> },
    { to: '/overlay/screenshots', label: t('screenshots.title'), icon: <Camera className="size-5" /> },
  ];
  return (
    <div className="dark fixed inset-0 flex flex-col bg-[#0b1118]/95 text-fg">
      <header className="flex items-center gap-4 border-b border-white/10 px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{game ? game.title : t('overlay.noGame')}</p>
          <p className="text-xs text-muted">{t('overlay.hotkeyHint', { key: desk.config.overlayHotkey })}</p>
        </div>
        <span className="text-2xl font-light tabular-nums">{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <Button variant="ghost" icon={<X className="size-5" />} onClick={() => void desktop.toggleOverlay(false)} aria-label={t('common.close')} />
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-48 shrink-0 flex-col gap-1 border-r border-white/10 p-2">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => clsx('flex items-center gap-3 rounded-md px-3 py-2 text-sm', isActive ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-white/5 hover:text-fg')}
            >
              {tab.icon}
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <main className="min-h-0 flex-1 overflow-y-auto p-4">
          <Routes>
            <Route index element={<OverlayFriends />} />
            <Route path="chat" element={<ChatPage basePath="/overlay/chat" compact />} />
            <Route path="chat/:id" element={<ChatPage basePath="/overlay/chat" compact />} />
            <Route path="achievements" element={<OverlayAchievements gameId={gameId} />} />
            <Route path="browser" element={<OverlayBrowser gameSlug={game?.slug ?? null} />} />
            <Route path="notes" element={<OverlayNotes gameId={gameId} />} />
            <Route path="screenshots" element={<ScreenshotGrid filterGameId={gameId} />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function OverlayFriends() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const friends = useQuery({ queryKey: ['friends'], queryFn: () => api.friends.overview() });
  if (friends.isLoading) return <Spinner />;
  const list = friends.data?.friends ?? [];
  if (!list.length) return <EmptyState title={t('social.friends.empty')} />;
  return (
    <ul className="divide-y divide-white/10">
      {list.map((f) => (
        <li key={f.user.id} className="flex items-center gap-3 py-2">
          <PresenceAvatar user={f.user} presence={f.presence} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{f.user.displayName || f.user.username}</p>
            <p className="truncate text-xs text-muted">{presenceLabel(t, f.presence)}</p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<MessageSquare className="size-4" />}
            onClick={async () => {
              try {
                navigate(`/overlay/chat/${(await api.chat.direct(f.user.id)).id}`);
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            {t('social.friends.message')}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function OverlayAchievements({ gameId }: { gameId: string | null }) {
  const { t } = useTranslation();
  const data = useQuery({ queryKey: ['achievements', 'game', gameId, 'overlay'], queryFn: () => api.achievements.forGame(gameId!), enabled: !!gameId, refetchInterval: 30_000 });
  if (!gameId) return <EmptyState title={t('overlay.noGame')} />;
  if (data.isLoading) return <Spinner />;
  if (!data.data?.total) return <EmptyState title={t('achievements.none')} />;
  return (
    <>
      <p className="mb-2 text-sm text-muted">{t('achievements.progress', { unlocked: data.data.unlocked, total: data.data.total })}</p>
      <ul className="divide-y divide-white/10">
        {[...data.data.achievements]
          .sort((a, b) => Number(b.unlocked) - Number(a.unlocked))
          .map((a) => (
            <AchievementRow key={a.id} a={a} />
          ))}
      </ul>
    </>
  );
}

function OverlayBrowser({ gameSlug }: { gameSlug: string | null }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const open = async (target: string) => {
    let u = target.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = /\s/.test(u) || !u.includes('.') ? `https://duckduckgo.com/?q=${encodeURIComponent(u)}` : `https://${u}`;
    try {
      await desktop.openOverlayBrowser(u);
    } catch (e) {
      toast.error(desktopError(e));
    }
  };
  const base = api.baseUrl || window.location.origin;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('overlay.browserHint')}</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void open(url);
        }}
      >
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('overlay.urlPlaceholder')} autoFocus />
        <Button type="submit" variant="primary" icon={<Globe className="size-4" />}>
          {t('overlay.open')}
        </Button>
      </form>
      {gameSlug && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void open(`${base}/#/game/${gameSlug}/guides`)}>
            {t('social.community.tabs.guides')}
          </Button>
          <Button size="sm" onClick={() => void open(`${base}/#/game/${gameSlug}/forum`)}>
            {t('social.community.tabs.forum')}
          </Button>
        </div>
      )}
    </div>
  );
}

function OverlayNotes({ gameId }: { gameId: string | null }) {
  const { t } = useTranslation();
  const note = useQuery({ queryKey: ['notes', gameId], queryFn: () => api.notes.get(gameId!), enabled: !!gameId });
  const [body, setBody] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (note.data && body === null) setBody(note.data.body);
  }, [note.data, body]);
  if (!gameId) return <EmptyState title={t('overlay.noGame')} />;
  if (body === null) return <Spinner />;
  return (
    <div className="flex h-full flex-col gap-2">
      <Textarea
        className="min-h-80 flex-1 font-mono text-sm"
        value={body}
        onChange={(e) => {
          const v = e.target.value;
          setBody(v);
          clearTimeout(timer.current);
          // Automatisch speichern (gedrosselt)
          timer.current = setTimeout(() => {
            void api.notes
              .save(gameId, v)
              .then((n) => setSaved(n.updatedAt))
              .catch((err) => toast.error(errorMessage(err)));
          }, 800);
        }}
        placeholder={t('overlay.notesPlaceholder')}
      />
      <p className="text-xs text-muted">{saved ? t('overlay.saved') : t('overlay.autosave')}</p>
    </div>
  );
}
