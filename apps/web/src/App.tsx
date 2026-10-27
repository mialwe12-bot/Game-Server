import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/Guards';
import { Layout, MaintenancePage } from './components/Layout';
import { PageLoader } from './components/ui';
import { useAuth } from './lib/auth';
import AccountPage from './pages/account/AccountPage';
import ProfilePage from './pages/account/ProfilePage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
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
  const { settings, user, loading } = useAuth();
  if (loading) return <PageLoader />;
  const blocked = settings?.maintenanceMode && user?.role !== 'ADMIN';

  return (
    <Routes>
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
            <Route path="/discover" element={<RequireAuth><DiscoveryPage /></RequireAuth>} />
            <Route path="/wishlist" element={<RequireAuth><WishlistPage /></RequireAuth>} />
            <Route path="/library" element={<RequireAuth><LibraryPage /></RequireAuth>} />
            <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
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
