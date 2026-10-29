import { ApiClient, ApiError } from '@gameserver/shared';

/** API-Basis-URL: leer = gleiche Origin. Der Desktop-Client setzt window.__GS_API_BASE__ und ein Device-Token. */
declare global {
  interface Window {
    __GS_API_BASE__?: string;
    __GS_TOKEN__?: string;
  }
}

export const api = new ApiClient({
  baseUrl: window.__GS_API_BASE__ ?? '',
  token: window.__GS_TOKEN__ ?? null,
});

/** Beobachter für Sitzungswechsel (Server-Adresse/Token) im Desktop-Client. */
const sessionListeners = new Set<() => void>();

/** Auf Änderungen von Server-Adresse/Token reagieren (für erneutes Laden + WebSocket-Neuverbindung). */
export function onApiSessionChange(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => void sessionListeners.delete(listener);
}

/** Server-Adresse und/oder Token setzen und alle Beobachter benachrichtigen. */
export function setApiSession(opts: { baseUrl?: string; token?: string | null }): void {
  if (opts.baseUrl !== undefined) api.baseUrl = opts.baseUrl;
  if (opts.token !== undefined) api.token = opts.token;
  for (const l of sessionListeners) l();
}

export function errorMessage(err: unknown, fallback = 'Fehler'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return 'Server nicht erreichbar';
  if (err instanceof Error) return err.message;
  return fallback;
}

export { ApiError };
export type { AchievementInput } from '@gameserver/shared';
