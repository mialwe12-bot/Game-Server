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

export function errorMessage(err: unknown, fallback = 'Fehler'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return 'Server nicht erreichbar';
  if (err instanceof Error) return err.message;
  return fallback;
}

export { ApiError };
export type { AchievementInput } from '@gameserver/shared';
