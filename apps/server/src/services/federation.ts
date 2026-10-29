import { createPrivateKey, createPublicKey, randomBytes, sign as edSign, verify as edVerify } from 'node:crypto';
import type { FederatedServer } from '@prisma/client';
import type {
  FederatedServerDto,
  FederationInfo,
  NetworkGameDto,
  RemoteBuildDto,
  RemoteDownloadDto,
  RemoteGameDto,
} from '@gameserver/shared';
import type { AppContext } from '../context.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { iso } from '../lib/time.js';

const CLOCK_SKEW_MS = 5 * 60_000;
const PAIRING_TTL_MS = 15 * 60_000;
const SYNC_INTERVAL_MS = 10 * 60_000;
const FILE_URL_TTL = 24 * 3600;

/** Normalisiert eine Server-Basis-URL (ohne abschließende Schrägstriche). */
export function normalizeBaseUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(u)) throw badRequest('Ungültige Server-Adresse', 'invalid_url');
  return u;
}

export function federatedServerDto(s: FederatedServer): FederatedServerDto {
  const catalog = Array.isArray(s.catalog) ? (s.catalog as unknown[]) : [];
  return {
    id: s.id,
    name: s.name,
    baseUrl: s.baseUrl,
    status: s.status,
    lastSyncedAt: iso(s.lastSyncedAt),
    lastError: s.lastError,
    gameCount: catalog.length,
    createdAt: iso(s.createdAt)!,
  };
}

/**
 * Föderation (Stufe 1): verbindet mehrere Server zu einem Netzwerk.
 * Jeder Server hat ein Ed25519-Schlüsselpaar; Server-zu-Server-Anfragen werden
 * signiert und gegen den gespeicherten Peer-Schlüssel geprüft. Spiele bleiben auf
 * ihrem Herkunftsserver, der Downloads per signierter, direkter Datei-URL ausliefert.
 */
export class FederationService {
  private keys: { publicKey: string; privateKey: string } | null = null;
  /** Offene Pairing-Codes dieses Servers: Code -> Ablaufzeitpunkt (ms). */
  private readonly pairings = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly ctx: AppContext) {}

  async init(): Promise<void> {
    this.keys = await this.ctx.settings.federationKeys();
  }

  /** Öffentliche Basis-URL dieses Servers (aus PUBLIC_URL). */
  baseUrl(): string {
    return this.ctx.config.PUBLIC_URL.replace(/\/+$/, '');
  }

  private async myKeys(): Promise<{ publicKey: string; privateKey: string }> {
    if (!this.keys) this.keys = await this.ctx.settings.federationKeys();
    return this.keys;
  }

  /** Öffentliche Kennung dieses Servers (für Pairing/Anzeige). */
  async selfInfo(): Promise<FederationInfo> {
    const keys = await this.myKeys();
    const settings = await this.ctx.settings.get();
    return { name: settings.siteName, version: this.ctx.config.version, publicKey: keys.publicKey, baseUrl: this.baseUrl() };
  }

  // ---------------------------------------------------------------------------
  // Signatur (Ed25519)
  // ---------------------------------------------------------------------------
  private canonical(method: string, pathWithQuery: string, ts: number): string {
    return `${method.toUpperCase()}\n${pathWithQuery}\n${ts}`;
  }

  private async signString(data: string): Promise<string> {
    const keys = await this.myKeys();
    return edSign(null, Buffer.from(data), createPrivateKey(keys.privateKey)).toString('base64');
  }

  private verifyString(data: string, signature: string, publicKeyPem: string): boolean {
    try {
      return edVerify(null, Buffer.from(data), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64'));
    } catch {
      return false;
    }
  }

  /** Signierte Anfrage an einen Peer (Body wird bewusst nicht signiert – alle Parameter stehen im Pfad). */
  private async signedFetch(baseUrl: string, method: string, apiPath: string, timeoutMs = 20_000): Promise<Response> {
    const ts = Date.now();
    const sig = await this.signString(this.canonical(method, apiPath, ts));
    return fetch(`${baseUrl}${apiPath}`, {
      method,
      headers: {
        'X-GS-Server': this.baseUrl(),
        'X-GS-Timestamp': String(ts),
        'X-GS-Signature': sig,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  /** Prüft eine eingehende Peer-Anfrage und liefert den verbundenen Server. */
  async verifyPeer(headers: Record<string, unknown>, method: string, pathWithQuery: string): Promise<FederatedServer> {
    const peerUrl = String(headers['x-gs-server'] ?? '').replace(/\/+$/, '');
    const ts = Number(headers['x-gs-timestamp']);
    const sig = String(headers['x-gs-signature'] ?? '');
    if (!peerUrl || !Number.isFinite(ts) || !sig) throw forbidden('Signatur fehlt', 'federation_unsigned');
    if (Math.abs(Date.now() - ts) > CLOCK_SKEW_MS) throw forbidden('Zeitstempel abgelaufen', 'federation_stale');
    const server = await this.ctx.db.federatedServer.findUnique({ where: { baseUrl: peerUrl } });
    if (!server || server.status !== 'ACTIVE') throw forbidden('Unbekannter oder gesperrter Server', 'federation_unknown');
    if (!this.verifyString(this.canonical(method, pathWithQuery, ts), sig, server.publicKey)) {
      throw forbidden('Signatur ungültig', 'federation_badsig');
    }
    return server;
  }

  // ---------------------------------------------------------------------------
  // Pairing-Codes (kurzlebig, im Speicher)
  // ---------------------------------------------------------------------------
  createPairingCode(): { code: string; expiresAt: Date } {
    this.gcPairings();
    const code = randomBytes(18).toString('base64url');
    const exp = Date.now() + PAIRING_TTL_MS;
    this.pairings.set(code, exp);
    return { code, expiresAt: new Date(exp) };
  }

  consumePairingCode(code: string): boolean {
    this.gcPairings();
    const exp = this.pairings.get(code);
    if (!exp || exp < Date.now()) return false;
    this.pairings.delete(code);
    return true;
  }

  private gcPairings(): void {
    const now = Date.now();
    for (const [code, exp] of this.pairings) if (exp < now) this.pairings.delete(code);
  }

  // ---------------------------------------------------------------------------
  // Katalog
  // ---------------------------------------------------------------------------
  /** Öffentliche Spiele dieses Servers als Remote-Katalog (nur veröffentlichte, fertige Builds der neuesten Version). */
  async exportCatalog(): Promise<RemoteGameDto[]> {
    const games = await this.ctx.db.game.findMany({
      where: { visibility: 'PUBLIC' },
      include: {
        media: { where: { kind: 'COVER' }, orderBy: { sortOrder: 'asc' }, take: 1 },
        versions: {
          where: { published: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { builds: { where: { status: 'READY' }, include: { files: { select: { size: true } } } } },
        },
      },
    });
    const base = this.baseUrl();
    const out: RemoteGameDto[] = [];
    for (const g of games) {
      const version = g.versions[0];
      if (!version) continue;
      const builds: RemoteBuildDto[] = version.builds.map((b) => ({
        buildId: b.id,
        platform: b.platform,
        version: version.version,
        kind: b.kind,
        sizeBytes: b.files.reduce((s, f) => s + Number(f.size), 0),
      }));
      if (!builds.length) continue;
      const cover = g.media[0];
      out.push({
        slug: g.slug,
        title: g.title,
        shortDescription: g.shortDescription,
        coverUrl: cover ? `${base}/api/media/${cover.id}` : null,
        developer: g.developer,
        publisher: g.publisher,
        builds,
      });
    }
    return out;
  }

  /** Signierte, direkt beim Herkunftsserver ladbare Datei-URLs für einen öffentlichen Build. */
  async grantDownload(buildId: string): Promise<RemoteDownloadDto> {
    const build = await this.ctx.db.build.findUnique({
      where: { id: buildId },
      include: { version: { include: { game: true } }, files: { orderBy: { path: 'asc' } } },
    });
    if (!build) throw notFound('Build nicht gefunden');
    const game = build.version.game;
    if (game.visibility !== 'PUBLIC' || !build.version.published || build.status !== 'READY') {
      throw forbidden('Build ist nicht öffentlich verfügbar', 'not_public');
    }
    const base = this.baseUrl();
    return {
      kind: build.kind,
      files: build.files.map((f) => {
        const path = `/api/builds/${build.id}/files/${f.id}`;
        return { path: f.path, size: Number(f.size), sha256: f.sha256, url: `${base}${this.ctx.signer.sign(path, FILE_URL_TTL)}` };
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Verbundene Server (Admin) + Netzwerk-Katalog (Nutzer)
  // ---------------------------------------------------------------------------
  async listServers(): Promise<FederatedServerDto[]> {
    const rows = await this.ctx.db.federatedServer.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(federatedServerDto);
  }

  /** Verbindet sich mit einem Peer: holt dessen Info und meldet sich dort per Pairing-Code an. */
  async connect(peerBaseUrl: string, code: string): Promise<FederatedServerDto> {
    const base = normalizeBaseUrl(peerBaseUrl);
    if (base === this.baseUrl()) throw badRequest('Ein Server kann sich nicht mit sich selbst verbinden', 'federation_self');

    // 1) Öffentliche Kennung des Peers holen
    const infoRes = await fetch(`${base}/api/federation/info`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!infoRes || !infoRes.ok) throw badRequest('Peer-Server nicht erreichbar oder Föderation nicht aktiv', 'federation_unreachable');
    const info = (await infoRes.json()) as FederationInfo;
    if (!info?.publicKey || !info?.baseUrl) throw badRequest('Peer-Server lieferte keine gültige Kennung', 'federation_bad_info');

    // 2) Bei uns als ACTIVE speichern (damit die spätere Sync-Anfrage signiert akzeptiert wird)
    const me = await this.selfInfo();
    const server = await this.ctx.db.federatedServer.upsert({
      where: { baseUrl: base },
      create: { name: info.name || base, baseUrl: base, publicKey: info.publicKey, status: 'ACTIVE' },
      update: { name: info.name || base, publicKey: info.publicKey, status: 'ACTIVE', lastError: null },
    });

    // 3) Beim Peer per Pairing-Code anmelden (unsere Kennung übergeben)
    const pairRes = await fetch(`${base}/api/federation/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name: me.name, baseUrl: me.baseUrl, publicKey: me.publicKey }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!pairRes || !pairRes.ok) {
      // Rückgängig: wir speichern den Peer nicht, wenn er uns nicht akzeptiert hat
      await this.ctx.db.federatedServer.delete({ where: { id: server.id } }).catch(() => undefined);
      const reason = pairRes ? (await pairRes.json().catch(() => null))?.error ?? pairRes.status : 'unreachable';
      throw badRequest(`Pairing beim Peer fehlgeschlagen (${reason})`, 'federation_pair_failed');
    }

    // 4) Direkt einmal synchronisieren
    await this.syncOne(server.id).catch(() => undefined);
    const fresh = await this.ctx.db.federatedServer.findUnique({ where: { id: server.id } });
    return federatedServerDto(fresh ?? server);
  }

  /** Nimmt eine eingehende Pairing-Anmeldung eines anderen Servers an. */
  async acceptPairing(code: string, peer: { name: string; baseUrl: string; publicKey: string }): Promise<void> {
    if (!this.consumePairingCode(code)) throw forbidden('Pairing-Code ungültig oder abgelaufen', 'federation_bad_code');
    const base = normalizeBaseUrl(peer.baseUrl);
    if (base === this.baseUrl()) throw badRequest('Selbstverbindung nicht erlaubt', 'federation_self');
    try {
      createPublicKey(peer.publicKey); // validiert das Schlüsselformat
    } catch {
      throw badRequest('Ungültiger öffentlicher Schlüssel', 'federation_bad_key');
    }
    await this.ctx.db.federatedServer.upsert({
      where: { baseUrl: base },
      create: { name: peer.name || base, baseUrl: base, publicKey: peer.publicKey, status: 'ACTIVE' },
      update: { name: peer.name || base, publicKey: peer.publicKey, status: 'ACTIVE', lastError: null },
    });
  }

  async setStatus(id: string, status: FederatedServer['status']): Promise<FederatedServerDto> {
    const server = await this.ctx.db.federatedServer.update({ where: { id }, data: { status } });
    return federatedServerDto(server);
  }

  async remove(id: string): Promise<void> {
    await this.ctx.db.federatedServer.delete({ where: { id } });
  }

  /** Holt den Katalog eines verbundenen Servers und speichert ihn zwischen. */
  async syncOne(id: string): Promise<void> {
    const server = await this.ctx.db.federatedServer.findUnique({ where: { id } });
    if (!server || server.status !== 'ACTIVE') return;
    try {
      const res = await this.signedFetch(server.baseUrl, 'GET', '/api/federation/games');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const catalog = (await res.json()) as RemoteGameDto[];
      if (!Array.isArray(catalog)) throw new Error('Ungültige Antwort');
      await this.ctx.db.federatedServer.update({
        where: { id },
        data: { catalog: catalog as unknown as object, lastSyncedAt: new Date(), lastError: null },
      });
    } catch (err) {
      await this.ctx.db.federatedServer.update({ where: { id }, data: { lastError: String(err instanceof Error ? err.message : err) } });
    }
  }

  async syncAll(): Promise<void> {
    const servers = await this.ctx.db.federatedServer.findMany({ where: { status: 'ACTIVE' } });
    for (const s of servers) await this.syncOne(s.id);
  }

  /** Zusammengeführter Netzwerk-Katalog aller aktiven Server (aus dem Cache). */
  async networkGames(): Promise<NetworkGameDto[]> {
    const servers = await this.ctx.db.federatedServer.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' } });
    const out: NetworkGameDto[] = [];
    for (const s of servers) {
      const catalog = Array.isArray(s.catalog) ? (s.catalog as unknown as RemoteGameDto[]) : [];
      for (const g of catalog) out.push({ ...g, serverId: s.id, serverName: s.name, serverBaseUrl: s.baseUrl });
    }
    return out;
  }

  /** Fordert für einen Remote-Build signierte Download-URLs beim Herkunftsserver an. */
  async requestDownload(serverId: string, buildId: string): Promise<RemoteDownloadDto> {
    const server = await this.ctx.db.federatedServer.findUnique({ where: { id: serverId } });
    if (!server || server.status !== 'ACTIVE') throw notFound('Server nicht verbunden');
    const res = await this.signedFetch(server.baseUrl, 'POST', `/api/federation/download/${encodeURIComponent(buildId)}`);
    if (res.status === 404) throw notFound('Build auf dem Herkunftsserver nicht gefunden');
    if (!res.ok) throw badRequest(`Herkunftsserver lehnte den Download ab (HTTP ${res.status})`, 'federation_download_failed');
    return (await res.json()) as RemoteDownloadDto;
  }

  // ---------------------------------------------------------------------------
  // Periodischer Katalog-Abgleich
  // ---------------------------------------------------------------------------
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.syncAll().catch(() => undefined), SYNC_INTERVAL_MS);
    this.timer.unref();
    // Kurz nach dem Start einmal abgleichen
    setTimeout(() => void this.syncAll().catch(() => undefined), 10_000).unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
