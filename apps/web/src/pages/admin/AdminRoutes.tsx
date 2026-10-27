import clsx from 'clsx';
import { Archive, BookOpen, FileText, Gamepad2, HardDrive, LayoutDashboard, Mail, Megaphone, Settings, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import AnnouncementsPage from './AnnouncementsPage';
import BackupsPage from './BackupsPage';
import DashboardPage from './DashboardPage';
import GameEditPage from './GameEditPage';
import GamesPage from './GamesPage';
import InvitesPage from './InvitesPage';
import LogsPage from './LogsPage';
import SettingsPage from './SettingsPage';
import StoragePage from './StoragePage';
import { UploadQueuePanel } from './UploadQueue';
import UsersPage from './UsersPage';

function SideLink({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/admin'}
      className={({ isActive }) =>
        clsx('flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm', isActive ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg')
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}

export default function AdminRoutes() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <aside className="space-y-4">
        <h1 className="text-xl font-bold">{t('admin.title')}</h1>
        <nav className="scrollbar-thin flex gap-1 overflow-x-auto lg:flex-col">
          {isAdmin && (
            <SideLink to="/admin" icon={<LayoutDashboard className="size-4" />}>
              {t('admin.dashboard')}
            </SideLink>
          )}
          <SideLink to="/admin/games" icon={<Gamepad2 className="size-4" />}>
            {t('admin.games')}
          </SideLink>
          {isAdmin && (
            <>
              <SideLink to="/admin/users" icon={<Users className="size-4" />}>
                {t('admin.users')}
              </SideLink>
              <SideLink to="/admin/invites" icon={<Mail className="size-4" />}>
                {t('admin.invites')}
              </SideLink>
              <SideLink to="/admin/announcements" icon={<Megaphone className="size-4" />}>
                {t('admin.announcements')}
              </SideLink>
              <SideLink to="/admin/storage" icon={<HardDrive className="size-4" />}>
                {t('admin.storage')}
              </SideLink>
              <SideLink to="/admin/backups" icon={<Archive className="size-4" />}>
                {t('admin.backups')}
              </SideLink>
              <SideLink to="/admin/logs" icon={<FileText className="size-4" />}>
                {t('admin.logs')}
              </SideLink>
              <SideLink to="/admin/settings" icon={<Settings className="size-4" />}>
                {t('admin.settings')}
              </SideLink>
            </>
          )}
          <a href="/api/docs" target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg">
            <BookOpen className="size-4" />
            {t('admin.apiDocs')}
          </a>
        </nav>
        <UploadQueuePanel />
      </aside>
      <div className="min-w-0">
        <Routes>
          <Route index element={isAdmin ? <DashboardPage /> : <Navigate to="games" replace />} />
          <Route path="games" element={<GamesPage />} />
          <Route path="games/:id" element={<GameEditPage />} />
          {isAdmin && (
            <>
              <Route path="users" element={<UsersPage />} />
              <Route path="invites" element={<InvitesPage />} />
              <Route path="announcements" element={<AnnouncementsPage />} />
              <Route path="storage" element={<StoragePage />} />
              <Route path="backups" element={<BackupsPage />} />
              <Route path="logs" element={<LogsPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </div>
    </div>
  );
}
