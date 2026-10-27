import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { ApiError, type CurrentUser, type MeResponse, type PublicSettings, type WsEvent } from '@gameserver/shared';
import { desktop, isDesktop } from '../desktop/bridge';
import i18n from '../i18n';
import { api } from './api';
import { toast } from './toast';

interface AuthState {
  user: CurrentUser | null;
  settings: PublicSettings | null;
  loading: boolean;
  /** Desktop-Client ohne Verbindung zum Server */
  offline: boolean;
  refresh: () => Promise<void>;
  setUser: (u: CurrentUser | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<MeResponse> => {
      if (isDesktop && !api.baseUrl) return { user: null, csrfToken: null };
      try {
        return await api.auth.me();
      } catch (err) {
        // Widerrufenes/abgelaufenes Device-Token → abmelden
        if (isDesktop && err instanceof ApiError && err.status === 401) {
          api.token = null;
          await desktop.clearSession();
          return { user: null, csrfToken: null };
        }
        throw err;
      }
    },
    staleTime: 60_000,
  });
  const settings = useQuery({
    queryKey: ['public-settings'],
    queryFn: () => api.publicSettings(),
    staleTime: 60_000,
    enabled: !isDesktop || !!api.baseUrl,
  });
  const isNetworkError = (e: unknown) => !!e && !(e instanceof ApiError);
  const offline = isDesktop && !!api.baseUrl && (isNetworkError(me.error) || isNetworkError(settings.error));
  const user = me.data?.user ?? null;

  const refresh = useCallback(async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['public-settings'] })]);
  }, [qc]);

  const setUser = useCallback(
    (u: CurrentUser | null) => {
      qc.setQueryData(['me'], { user: u, csrfToken: api.csrfToken });
      if (u?.locale && u.locale !== i18n.language) void i18n.changeLanguage(u.locale);
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    if (isDesktop) {
      api.token = null;
      await desktop.clearSession();
    }
    qc.clear();
    qc.setQueryData(['me'], { user: null, csrfToken: null });
    await qc.invalidateQueries({ queryKey: ['public-settings'] });
  }, [qc]);

  // Sprache aus dem Profil übernehmen
  useEffect(() => {
    if (user?.locale && user.locale !== i18n.language) void i18n.changeLanguage(user.locale);
  }, [user?.locale]);

  // Echtzeit-Ereignisse
  useEffect(() => {
    if (me.isLoading || offline || (isDesktop && !api.baseUrl)) return;
    return api.connectEvents((e: WsEvent) => {
      switch (e.type) {
        case 'maintenance':
          void qc.invalidateQueries({ queryKey: ['public-settings'] });
          break;
        case 'announcement.created':
          toast.info(e.data.title);
          void qc.invalidateQueries({ queryKey: ['store-home'] });
          break;
        case 'library.updated':
          void qc.invalidateQueries({ queryKey: ['library'] });
          break;
        case 'session.revoked':
          void qc.invalidateQueries({ queryKey: ['me'] });
          break;
        case 'backup.updated':
          void qc.invalidateQueries({ queryKey: ['admin', 'backups'] });
          break;
        default:
          break;
      }
    });
  }, [me.isLoading, user?.id, qc, offline]);

  return (
    <AuthContext.Provider
      value={{
        user,
        settings: settings.data ?? null,
        loading: me.isLoading || (settings.isLoading && settings.fetchStatus !== 'idle'),
        offline,
        refresh,
        setUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth außerhalb des AuthProviders');
  return ctx;
}
