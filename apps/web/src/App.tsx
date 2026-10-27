import { lazy, Suspense, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/Guards';
import { Layout, MaintenancePage } from './components/Layout';
import { PageLoader } from './components/ui';
import { isDesktop } from './desktop/bridge';
import ClientSettingsPage from './desktop/ClientSettingsPage';
import DownloadsPage from './desktop/DownloadsPage';
import OfflinePage from './desktop/OfflinePage';
import ServerSetupPage from './desktop/ServerSetupPage';
import { api } from './lib/api';
import { useAuth } from './lib/auth';
import AccountPage from './pages/account/AccountPage';
import ProfilePage from './pages/account/ProfilePage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import ClientDownloadPage from './pages/ClientDownloadPage';
import DesktopLinkPage from './pages/DesktopLinkPage';
import LibraryPage from './pages/library/LibraryPage';
import NotFoundPage from './pages/NotFoundPage';
import DiscoveryPage from './pages/store/DiscoveryPage';
import GamePage from './pages/store/GamePage';
import HomePage from './pages/store/HomePage';
import SearchPage from './pages/store/SearchPage';
import WishlistPage from './pages/store/WishlistPage';

// Admin-Bereich separat laden
const AdminRoutes = lazy(() => import('./pages/admin/AdminRoutes'));

export default function App() {
  const { settings, user, loading, offline } = useAuth();
  const [hasServer, setHasServer] = useState(!isDesktop || !!api.baseUrl);

  if (!hasServer) return <ServerSetupPage onConnected={() => setHasServer(true)} />;
  if (loading) return <PageLoader />;
  if (offline) return <OfflinePage />;
  const blocked = settings?.maintenanceMode && user?.role !== 'ADMIN';

  return (
    <Routes>
      {isDesktop && <Route path="/server-setup" element={<ServerSetupPage />} />}
      <Route element={<Layout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {blocked ? (
          <Route path="*" element={<MaintenancePage message={settings!.maintenanceMessage} />} />
        ) : (
          <>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/game/:slug" element={<GamePage />} />
            <Route path="/u/:username" element={<ProfilePage />} />
            <Route path="/client" element={<ClientDownloadPage />} />
            <Route path="/desktop-link" element={<RequireAuth><DesktopLinkPage /></RequireAuth>} />
            <Route path="/discover" element={<RequireAuth><DiscoveryPage /></RequireAuth>} />
            <Route path="/wishlist" element={<RequireAuth><WishlistPage /></RequireAuth>} />
            <Route path="/library" element={<RequireAuth><LibraryPage /></RequireAuth>} />
            <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
            {isDesktop && <Route path="/downloads" element={<RequireAuth><DownloadsPage /></RequireAuth>} />}
            {isDesktop && <Route path="/client-settings" element={<ClientSettingsPage />} />}
            <Route
              path="/admin/*"
              element={
                <RequireAuth roles={['ADMIN', 'UPLOADER']}>
                  <Suspense fallback={<PageLoader />}>
                    <AdminRoutes />
                  </Suspense>
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </>
        )}
      </Route>
    </Routes>
  );
}
