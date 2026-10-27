/**
 * Game-Server-SDK (MIT-Lizenz) – Achievements aus dem Spiel heraus freischalten.
 *
 * Der Desktop-Client startet Spiele mit den Umgebungsvariablen GS_API_URL, GS_GAME_ID und GS_GAME_TOKEN.
 * `GameServerSdk.fromEnv()` liest sie aus; ohne Client (z. B. beim Entwickeln) liefert es `null` und das Spiel
 * läuft einfach ohne Achievements weiter.
 *
 * Fehlgeschlagene Freischaltungen (z. B. offline) werden zwischengespeichert und mit `flush()` erneut gesendet.
 */

export interface SdkAchievement {
  id: string;
  apiName: string;
  name: string;
  description: string;
  iconUrl: string | null;
  hidden: boolean;
  progressMax: number | null;
  rarity: number;
  unlocked: boolean;
  unlockedAt: string | null;
  progress: number;
}

export interface SdkUnlockResult {
  achievement: SdkAchievement;
  newlyUnlocked: boolean;
}

export interface SdkMe {
  user: { id: string; username: string; displayName: string | null };
  game: { id: string; slug: string; title: string };
  expiresAt: string;
}

export interface SdkOptions {
  apiUrl: string;
  token: string;
  gameId?: string;
  fetch?: typeof fetch;
  /** Zeitlimit pro Anfrage in ms (Standard 10 s) */
  timeoutMs?: number;
}

export class SdkError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Pending = { apiName: string; progress?: number };

export class GameServerSdk {
  readonly apiUrl: string;
  readonly gameId: string | null;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private pending: Pending[] = [];

  constructor(opts: SdkOptions) {
    this.apiUrl = opts.apiUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.gameId = opts.gameId ?? null;
    this.fetchImpl = opts.fetch ?? ((...args) => globalThis.fetch(...args));
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /** SDK aus den Umgebungsvariablen des Desktop-Clients; `null`, wenn das Spiel nicht über den Client gestartet wurde. */
  static fromEnv(env: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}): GameServerSdk | null {
    const apiUrl = env.GS_API_URL;
    const token = env.GS_GAME_TOKEN;
    if (!apiUrl || !token) return null;
    return new GameServerSdk({ apiUrl, token, gameId: env.GS_GAME_ID });
  }

  /** Für Web-/HTML5-Spiele: Werte aus den URL-Parametern gs_api, gs_token, gs_game */
  static fromUrl(url: string): GameServerSdk | null {
    const p = new URL(url).searchParams;
    const apiUrl = p.get('gs_api');
    const token = p.get('gs_token');
    if (!apiUrl || !token) return null;
    return new GameServerSdk({ apiUrl, token, gameId: p.get('gs_game') ?? undefined });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.apiUrl}/api/sdk${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new SdkError(res.status, data.error ?? 'http_error', data.message ?? res.statusText);
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  me(): Promise<SdkMe> {
    return this.request('GET', '/me');
  }

  achievements(): Promise<SdkAchievement[]> {
    return this.request('GET', '/achievements');
  }

  /**
   * Achievement freischalten. Bei Netzwerkfehlern wird die Freischaltung vorgemerkt (Rückgabe `null`)
   * und beim nächsten `flush()` nachgeholt. Fachliche Fehler (z. B. unbekannter apiName) werden geworfen.
   */
  async unlock(apiName: string): Promise<SdkUnlockResult | null> {
    return this.send({ apiName });
  }

  /** Fortschritt melden (z. B. 7 von 10 gesammelt); bei Erreichen des Zielwerts wird freigeschaltet. */
  async setProgress(apiName: string, progress: number): Promise<SdkUnlockResult | null> {
    return this.send({ apiName, progress: Math.max(0, Math.floor(progress)) });
  }

  private async send(p: Pending): Promise<SdkUnlockResult | null> {
    try {
      const path = `/achievements/${encodeURIComponent(p.apiName)}/${p.progress === undefined ? 'unlock' : 'progress'}`;
      return await this.request<SdkUnlockResult>('POST', path, p.progress === undefined ? undefined : { progress: p.progress });
    } catch (err) {
      if (err instanceof SdkError && err.status !== 429 && err.status < 500) throw err;
      // Offline/Serverfehler: vormerken (Fortschritt nur den höchsten Wert behalten)
      const existing = this.pending.find((x) => x.apiName === p.apiName);
      if (!existing) this.pending.push(p);
      else if (p.progress === undefined) existing.progress = undefined;
      else if (existing.progress !== undefined) existing.progress = Math.max(existing.progress, p.progress);
      return null;
    }
  }

  /** Anzahl vorgemerkter, noch nicht übertragener Meldungen */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** Vorgemerkte Meldungen erneut senden. Gibt die Anzahl der erfolgreich übertragenen zurück. */
  async flush(): Promise<number> {
    const queue = this.pending;
    this.pending = [];
    let ok = 0;
    for (const p of queue) {
      try {
        if ((await this.send(p)) !== null) ok++;
      } catch {
        // fachlicher Fehler → verwerfen
      }
    }
    return ok;
  }
}

export default GameServerSdk;
