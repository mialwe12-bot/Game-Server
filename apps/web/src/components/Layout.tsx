import clsx from 'clsx';
import { Activity, BarChart3, Camera, Cloud, Gamepad2, Gift, Home, Layers, Network, Package, CheckCircle2, ChevronDown, Download, Info, Library, LogOut, Menu, Monitor, Moon, Search, Server, Settings, Shield, SlidersHorizontal, Store, Sun, User, Users, UsersRound, X, XCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ClientUpdateBanner } from '../desktop/ClientUpdateBanner';
import { isDesktop } from '../desktop/bridge';
import { activeDownloads, useDesktop } from '../desktop/DesktopProvider';
import { LANGUAGES } from '../i18n';
import { useAuth } from '../lib/auth';
import { useTheme, type ThemeMode } from '../lib/theme';
import { dismiss, useToasts } from '../lib/toast';
import { BrandLogo } from './Branding';
import { Avatar } from './Avatar';
import { Markdown } from './Markdown';
import { ChatNavButton, NotificationBell } from './Social';

function NavItem({ to, label, icon, badge, compact }: { to: string; label: string; icon: ReactNode; badge?: ReactNode; compact?: boolean }) {
  return (
    <NavLink
      to={to}
      title={compact ? label : undefined}
      end={to === '/'}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-semibold uppercase tracking-wide transition',
          isActive ? 'text-accent' : 'text-muted hover:text-fg',
        )
      }
    >
      {icon}
      {/* Kopfzeile: nur Shop/Bibliothek mit Text, Rest als Symbol mit Tooltip – sonst reicht die Breite nicht */}
      {compact ? <span className="sr-only">{label}</span> : label}
      {badge}
    </NavLink>
  );
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onOutside]);
}

function UserMenu() {
  const { t, i18n } = useTranslation();
  const { user, logout, settings } = useAuth();
  const { mode, setMode } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  const themes: { id: ThemeMode; label: string; icon: ReactNode }[] = [
    { id: 'light', label: t('nav.themeLight'), icon: <Sun className="size-4" /> },
    { id: 'dark', label: t('nav.themeDark'), icon: <Moon className="size-4" /> },
    { id: 'system', label: t('nav.themeSystem'), icon: <Monitor className="size-4" /> },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {user ? <Avatar user={user} size={28} /> : <User className="size-5" />}
        <span className="hidden max-w-32 truncate sm:inline">{user ? user.displayName || user.username : t('nav.login')}</span>
        <ChevronDown className="size-4 text-muted" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 max-h-[calc(100vh-5rem)] w-60 overflow-y-auto rounded-lg border border-border bg-surface shadow-xl">
          {user ? (
            <div className="border-b border-border p-1">
              <MenuLink to={`/u/${user.username}`} icon={<User className="size-4" />} onClick={() => setOpen(false)}>
                {t('nav.profile')}
              </MenuLink>
              {settings?.features.cards && (
                <MenuLink to="/inventory" icon={<Layers className="size-4" />} onClick={() => setOpen(false)}>
                  {t('nav.inventory')}
                </MenuLink>
              )}
              <MenuLink to="/stats" icon={<BarChart3 className="size-4" />} onClick={() => setOpen(false)}>
                {t('nav.stats')}
              </MenuLink>
              <MenuLink to="/network" icon={<Network className="size-4" />} onClick={() => setOpen(false)}>
                {t('nav.network')}
              </MenuLink>
              {settings?.features.workshop && (
                <MenuLink to="/workshop" icon={<Package className="size-4" />} onClick={() => setOpen(false)}>
                  {t('nav.workshop')}
                </MenuLink>
              )}
              {settings?.features.cloudSaves && (
                <MenuLink to="/cloud" icon={<Cloud className="size-4" />} onClick={() => setOpen(false)}>
                  {t('nav.cloud')}
                </MenuLink>
              )}
              <MenuLink to="/family" icon={<Home className="size-4" />} onClick={() => setOpen(false)}>
                {t('nav.family')}
              </MenuLink>
              <MenuLink to="/gifts" icon={<Gift className="size-4" />} onClick={() => setOpen(false)}>
                {t('nav.gifts')}
              </MenuLink>
              {isDesktop && (
                <MenuLink to="/screenshots" icon={<Camera className="size-4" />} onClick={() => setOpen(false)}>
                  {t('screenshots.title')}
                </MenuLink>
              )}
              <MenuLink to="/big-picture" icon={<Gamepad2 className="size-4" />} onClick={() => setOpen(false)}>
                {t('nav.bigPicture')}
              </MenuLink>
              <MenuLink to="/account" icon={<Settings className="size-4" />} onClick={() => setOpen(false)}>
                {t('nav.account')}
              </MenuLink>
              {(user.role === 'ADMIN' || user.role === 'UPLOADER') && (
                <MenuLink to="/admin" icon={<Shield className="size-4" />} onClick={() => setOpen(false)}>
                  {t('nav.admin')}
                </MenuLink>
              )}
              {!isDesktop && (
                <MenuLink to="/client" icon={<Monitor className="size-4" />} onClick={() => setOpen(false)}>
                  {t('nav.getClient')}
                </MenuLink>
              )}
            </div>
          ) : (
            <div className="border-b border-border p-1">
              <MenuLink to="/login" icon={<User className="size-4" />} onClick={() => setOpen(false)}>
                {t('nav.login')}
              </MenuLink>
            </div>
          )}
          {isDesktop && (
            <div className="border-b border-border p-1">
              <MenuLink to="/client-settings" icon={<SlidersHorizontal className="size-4" />} onClick={() => setOpen(false)}>
                {t('desktop.clientSettings')}
              </MenuLink>
              <MenuLink to="/server-setup" icon={<Server className="size-4" />} onClick={() => setOpen(false)}>
                {t('desktop.changeServer')}
              </MenuLink>
            </div>
          )}
          <div className="border-b border-border p-3">
            <p className="mb-2 text-xs font-medium uppercase text-muted">{t('nav.theme')}</p>
            <div className="grid grid-cols-3 gap-1">
              {themes.map((th) => (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => setMode(th.id)}
                  className={clsx(
                    'flex flex-col items-center gap-1 rounded-md py-1.5 text-xs',
                    mode === th.id ? 'bg-accent/15 text-accent' : 'hover:bg-surface-2',
                  )}
                >
                  {th.icon}
                  {th.label}
                </button>
              ))}
            </div>
          </div>
          <div className="border-b border-border p-3">
            <p className="mb-2 text-xs font-medium uppercase text-muted">{t('nav.language')}</p>
            <div className="grid grid-cols-2 gap-1">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => void i18n.changeLanguage(l.code)}
                  className={clsx('rounded-md py-1.5 text-xs', i18n.language === l.code ? 'bg-accent/15 text-accent' : 'hover:bg-surface-2')}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          {user && (
            <div className="p-1">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-surface-2"
                onClick={async () => {
                  setOpen(false);
                  await logout();
                  navigate('/');
                }}
              >
                <LogOut className="size-4" />
                {t('nav.logout')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MenuLink({ to, icon, children, onClick }: { to: string; icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <Link to={to} onClick={onClick} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-surface-2" role="menuitem">
      {icon}
      {children}
    </Link>
  );
}

function HeaderSearch({ mobile, onDone }: { mobile?: boolean; onDone?: () => void } = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form
      className={mobile ? 'relative w-full' : 'relative hidden md:block'}
      onSubmit={(e) => {
        e.preventDefault();
        navigate(`/search?q=${encodeURIComponent(q)}`);
        onDone?.();
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('store.searchPlaceholder')}
        className={clsx(
          'h-9 rounded-md border border-border bg-surface-2 pr-3 pl-9 text-sm focus:border-accent focus:outline-none',
          mobile ? 'w-full' : 'w-56 focus:w-72 lg:w-64',
        )}
        aria-label={t('common.search')}
      />
    </form>
  );
}

export function Toaster() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={clsx(
            'pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface p-3 text-sm shadow-xl',
            toast.kind === 'success' && 'border-success/50',
            toast.kind === 'error' && 'border-danger/50',
            toast.kind === 'info' && 'border-accent/50',
          )}
        >
          {toast.kind === 'success' && <CheckCircle2 className="size-5 shrink-0 text-success" />}
          {toast.kind === 'error' && <XCircle className="size-5 shrink-0 text-danger" />}
          {toast.kind === 'info' && <Info className="size-5 shrink-0 text-accent" />}
          <span className="flex-1 break-words">{toast.message}</span>
          <button type="button" onClick={() => dismiss(toast.id)} className="text-muted hover:text-fg" aria-label="close">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Layout() {
  const { t } = useTranslation();
  const { user, settings } = useAuth();
  const desk = useDesktop();
  const openDownloads = desk ? activeDownloads(desk.downloads).length : 0;
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    if (settings?.siteName) document.title = settings.siteName;
  }, [settings?.siteName]);

  const navItems = (compact: boolean) => (
    <>
      <NavItem to="/" icon={<Store className="size-4" />} label={t('nav.store')} />
      {user && (
        <>
          <NavItem to="/library" icon={<Library className="size-4" />} label={t('nav.library')} />
          <NavItem compact={compact} to="/discover" icon={<Search className="size-4" />} label={t('nav.discover')} />
          <NavItem compact={compact} to="/wishlist" icon={<Star className="size-4" />} label={t('nav.wishlist')} />
          <NavItem compact={compact} to="/friends" icon={<Users className="size-4" />} label={t('nav.friends')} />
          <NavItem compact={compact} to="/groups" icon={<UsersRound className="size-4" />} label={t('nav.groups')} />
          <NavItem compact={compact} to="/activity" icon={<Activity className="size-4" />} label={t('nav.activity')} />
          {desk && (
            <NavItem compact={compact} to="/downloads" icon={<Download className="size-4" />} label={t('nav.downloads')} badge={openDownloads > 0 && <span className="rounded-full bg-accent px-1.5 text-xs text-accent-fg">{openDownloads}</span>} />
          )}
        </>
      )}
    </>
  );

  return (
    <div className="flex min-h-screen flex-col">
      {settings?.maintenanceMode && (
        <div className="bg-warning px-4 py-2 text-center text-sm font-medium text-black">
          {t('maintenance.banner')}: {settings.maintenanceMessage}
        </div>
      )}
      {isDesktop && <ClientUpdateBanner />}
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <button type="button" className="rounded p-1 xl:hidden" onClick={() => setMobileOpen((o) => !o)} aria-label={t('nav.menu')}>
            {mobileOpen ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
          <Link to="/" className="flex items-center gap-2 font-bold tracking-wide">
            <BrandLogo className="size-7 rounded" />
            <span className="hidden whitespace-nowrap sm:inline">{settings?.siteName ?? 'Game Server'}</span>
          </Link>
          <nav className="hidden items-center gap-1 xl:flex">{navItems(true)}</nav>
          <div className="ml-auto flex items-center gap-2">
            <HeaderSearch />
            {user && (
              <>
                <ChatNavButton />
                <NotificationBell />
              </>
            )}
            {!user && (
              <Link to="/login" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:brightness-110">
                {t('nav.login')}
              </Link>
            )}
            <UserMenu />
          </div>
        </div>
        {mobileOpen && (
          <nav className="flex flex-col gap-1 border-t border-border px-4 py-3 xl:hidden">
            <div className="mb-2 md:hidden">
              <HeaderSearch mobile onDone={() => setMobileOpen(false)} />
            </div>
            {navItems(false)}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 sm:py-6">
        <Outlet />
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted">
        {settings?.siteName} · v{settings?.version} · Open Source · DRM-frei
        {!isDesktop && (
          <>
            {' · '}
            <Link to="/client" className="text-accent hover:underline">
              {t('nav.getClient')}
            </Link>
          </>
        )}
      </footer>
      <Toaster />
    </div>
  );
}

function Star({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />
    </svg>
  );
}

export function MaintenancePage({ message }: { message: string }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <h1 className="text-2xl font-bold">{t('maintenance.title')}</h1>
      <Markdown className="mt-4">{message}</Markdown>
      <Link to="/login" className="mt-6 inline-block text-sm text-accent">
        {t('nav.login')}
      </Link>
    </div>
  );
}
