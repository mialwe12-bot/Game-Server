import type { AdminSettings, VoiceServerConfig } from '@gameserver/shared';

/** Ein Voice-Server mit vollständig aufgelösten Zugangsdaten (Secrets aus der Umgebung ergänzt). */
export interface ResolvedVoiceServer {
  name: string;
  url: string;
  apiKey: string;
  apiSecret: string;
}

/** Prüffunktion: ist der LiveKit-Server unter dieser URL erreichbar? (für Tests injizierbar) */
export type VoiceProbe = (url: string, timeoutMs: number) => Promise<boolean>;

/**
 * Prüft, ob ein LiveKit-Server erreichbar ist. LiveKit beantwortet HTTP-GET auf „/“ (wss→https, ws→http);
 * jede HTTP-Antwort gilt als „erreichbar“. Fehler/Timeout = nicht erreichbar.
 */
export async function probeLivekit(url: string, timeoutMs = 2500): Promise<boolean> {
  let httpUrl: string;
  try {
    const u = new URL(url);
    u.protocol = u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol;
    httpUrl = u.toString();
  } catch {
    return false;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(httpUrl, { method: 'GET', signal: ctl.signal });
    return res.status > 0; // Server hat geantwortet
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Löst die konfigurierte Voice-Server-Liste in eine geordnete Liste mit vollständigen Zugangsdaten auf.
 * Fällt auf das alte Einzelfeld `livekitUrl` zurück, wenn `voiceServers` leer ist. Leere API-Felder je Eintrag
 * werden mit den Umgebungs-Zugangsdaten (LIVEKIT_API_KEY/SECRET) ergänzt. Einträge ohne gültige wss-URL oder ohne
 * auflösbare Zugangsdaten werden verworfen. Reihenfolge bleibt erhalten (0 = Primär).
 */
export function resolveVoiceServers(
  s: Pick<AdminSettings, 'voiceServers' | 'livekitUrl'>,
  env: { LIVEKIT_API_KEY: string; LIVEKIT_API_SECRET: string },
): ResolvedVoiceServer[] {
  const raw: VoiceServerConfig[] =
    s.voiceServers && s.voiceServers.length > 0 ? s.voiceServers : s.livekitUrl ? [{ url: s.livekitUrl }] : [];
  return raw
    .filter((e) => typeof e.url === 'string' && /^wss?:\/\/.+/.test(e.url))
    .map((e, i) => ({
      name: (e.name && e.name.trim()) || (i === 0 ? 'Primär' : `Server ${i + 1}`),
      url: e.url,
      apiKey: (e.apiKey && e.apiKey.trim()) || env.LIVEKIT_API_KEY,
      apiSecret: (e.apiSecret && e.apiSecret.trim()) || env.LIVEKIT_API_SECRET,
    }))
    .filter((e) => e.apiKey && e.apiSecret);
}

/**
 * Wählt aus einer geordneten Voice-Server-Liste den ersten erreichbaren aus (Failover). Erreichbarkeit wird mit
 * kurzem TTL zwischengespeichert, damit nicht jede Token-Anfrage eine HTTP-Probe auslöst. Ist kein Server
 * erreichbar (oder nicht prüfbar), wird trotzdem der Primär-Server zurückgegeben – der Client kann ihn evtl.
 * direkt erreichen, auch wenn der Game-Server ihn gerade nicht sieht.
 */
export class VoiceFailover {
  private readonly health = new Map<string, { healthy: boolean; at: number }>();

  constructor(
    private readonly probe: VoiceProbe = probeLivekit,
    private readonly ttlMs = 30_000,
  ) {}

  async pick(servers: ResolvedVoiceServer[]): Promise<ResolvedVoiceServer | null> {
    if (servers.length === 0) return null;
    if (servers.length === 1) return servers[0]; // kein Failover möglich – ohne Probe direkt verwenden
    for (const srv of servers) {
      if (await this.isHealthy(srv.url)) return srv;
    }
    return servers[0];
  }

  /** Aktueller Erreichbarkeits-Status aller Server (frisch geprüft, wenn der Cache abgelaufen ist). */
  async status(servers: ResolvedVoiceServer[]): Promise<{ name: string; url: string; healthy: boolean }[]> {
    return Promise.all(
      servers.map(async (s) => ({ name: s.name, url: s.url, healthy: await this.isHealthy(s.url) })),
    );
  }

  private async isHealthy(url: string): Promise<boolean> {
    const now = Date.now();
    const cached = this.health.get(url);
    if (cached && now - cached.at < this.ttlMs) return cached.healthy;
    const healthy = await this.probe(url, 2500).catch(() => false);
    this.health.set(url, { healthy, at: now });
    return healthy;
  }
}
