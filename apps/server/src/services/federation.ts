import { createHash, createHmac, createPrivateKey, createPublicKey, randomBytes, sign as edSign, timingSafeEqual, verify as edVerify } from 'node:crypto';
import type { FederatedServer, User } from '@prisma/client';
import type {
  FederatedIdentity,
  FederatedServerDto,
  FederationInfo,
  FederationPeer,
  NetworkGameDto,
  RemoteAdminOverview,
  RemoteBuildDto,
  RemoteDownloadDto,
  RemoteGameDto,
  RemoteUserDto,
  Role,
} from '@gameserver/shared';
import type { AppContext } from '../context.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { iso } from '../lib/time.js';
import { messageDto } from './social-dto.js';

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
    adminGranted: s.adminGranted,
    adminAllowed: s.adminAllowed,
  };
}

/** Kompakte Nutzer-DTO für die Fernverwaltung. */
export function remoteUserDto(u: User): RemoteUserDto {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    // Avatar bewusst null: der relative Pfad des Herkunftsservers lädt auf dem Hub nicht (Initialen-Fallback).
    avatarUrl: null,
    email: u.email,
    role: u.role as Role,
    disabled: u.disabled,
    createdAt: iso(u.createdAt)!,
    lastLoginAt: iso(u.lastLoginAt),
    federated: u.federationServerId !== null,
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
  private appSecret = '';
  /** Offene Pairing-Codes dieses Servers: Code -> Ablaufzeitpunkt (ms). */
  private readonly pairings = new Map<string, number>();
  /** Offene Login-Codes (Stufe 2): Code -> {userId, peerId, Ablauf}. */
  private readonly authCodes = new Map<string, { userId: string; peerId: string; exp: number }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly ctx: AppContext) {}

  async init(): Promise<void> {
    this.keys = await this.ctx.settings.federationKeys();
    this.appSecret = await this.ctx.settings.appSecret(this.ctx.config.APP_SECRET);
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

  /**
   * Signierte Anfrage an einen Peer. Signiert werden Methode, Pfad und Zeitstempel (nicht der Body).
   * Chat-Zustellung (Stufe 3) überträgt einen JSON-Body; dessen Integrität ruht auf TLS + vertrauenswürdigem
   * Peer + Dedup per federationId (Replay innerhalb des Zeitfensters erzeugt keine Doppelnachricht).
   */
  private async signedFetch(baseUrl: string, method: string, apiPath: string, body?: unknown, timeoutMs = 20_000): Promise<Response> {
    const ts = Date.now();
    const sig = await this.signString(this.canonical(method, apiPath, ts));
    const headers: Record<string, string> = {
      'X-GS-Server': this.baseUrl(),
      'X-GS-Timestamp': String(ts),
      'X-GS-Signature': sig,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(`${baseUrl}${apiPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
      buildId: build.id,
      platform: build.platform,
      version: build.version.version,
      kind: build.kind,
      executable: build.executable,
      launchArgs: build.launchArgs,
      workingDir: build.workingDir,
      installerArgs: build.installerArgs,
      linuxRunner: build.linuxRunner,
      installSize: Number(build.installSize),
      totalSize: Number(build.totalSize),
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
      // Zusätzlich: erlaubt uns dieser Server die Fernverwaltung? (best effort)
      let adminAllowed = server.adminAllowed;
      try {
        const st = await this.signedFetch(server.baseUrl, 'GET', '/api/federation/admin/status');
        if (st.ok) adminAllowed = Boolean(((await st.json()) as { granted?: boolean })?.granted);
      } catch {
        /* Peer kennt die Route evtl. nicht – alten Wert behalten */
      }
      await this.ctx.db.federatedServer.update({
        where: { id },
        data: { catalog: catalog as unknown as object, lastSyncedAt: new Date(), lastError: null, adminAllowed },
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
  // Stufe 2: geteilte Accounts (föderierter Login)
  // ---------------------------------------------------------------------------

  /** Öffentliche Liste aktiver verbundener Server (für den Login-Auswahldialog). */
  async listPeers(): Promise<FederationPeer[]> {
    const rows = await this.ctx.db.federatedServer.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' } });
    return rows.map((s) => ({ id: s.id, name: s.name, baseUrl: s.baseUrl }));
  }

  private hmac(data: string): string {
    return createHmac('sha256', this.appSecret).update(data).digest('base64url');
  }

  /** Zustandsloser, signierter Login-State (bindet Peer-ID + Ablauf; kein Cookie nötig). */
  signLoginState(serverId: string): string {
    const payload = Buffer.from(JSON.stringify({ s: serverId, e: Date.now() + 10 * 60_000, n: randomBytes(9).toString('base64url') })).toString('base64url');
    return `${payload}.${this.hmac(payload)}`;
  }

  verifyLoginState(state: string): string | null {
    const [payload, sig] = String(state).split('.');
    if (!payload || !sig) return null;
    const expected = this.hmac(payload);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
      const { s, e } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { s: string; e: number };
      if (typeof s !== 'string' || typeof e !== 'number' || e < Date.now()) return null;
      return s;
    } catch {
      return null;
    }
  }

  /** Erzeugt einen einmaligen Login-Code (auf dem Heimat-Server), gebunden an den anfragenden Peer. */
  createAuthCode(userId: string, peerId: string): string {
    this.gcAuthCodes();
    const code = randomBytes(24).toString('base64url');
    this.authCodes.set(code, { userId, peerId, exp: Date.now() + 5 * 60_000 });
    return code;
  }

  private consumeAuthCode(code: string, peerId: string): string | null {
    this.gcAuthCodes();
    const e = this.authCodes.get(code);
    if (!e || e.exp < Date.now() || e.peerId !== peerId) return null;
    this.authCodes.delete(code);
    return e.userId;
  }

  private gcAuthCodes(): void {
    const now = Date.now();
    for (const [code, e] of this.authCodes) if (e.exp < now) this.authCodes.delete(code);
  }

  /** Identität eines lokalen Nutzers, die an einen Peer übergeben wird. */
  buildIdentity(user: User): FederatedIdentity {
    // Avatar bewusst weggelassen (serverübergreifende signierte Avatare in einer späteren Stufe).
    return { userId: user.id, username: user.username, displayName: user.displayName ?? user.username, avatarUrl: null };
  }

  /** Auf dem Heimat-Server: Login-Code gegen Identität eintauschen (nur für den ausstellenden Peer). */
  async exchangeAuthCode(code: string, peerId: string): Promise<FederatedIdentity> {
    const userId = this.consumeAuthCode(code, peerId);
    if (!userId) throw forbidden('Login-Code ungültig oder abgelaufen', 'federation_bad_code');
    const user = await this.ctx.db.user.findUnique({ where: { id: userId } });
    if (!user || user.disabled) throw forbidden('Konto nicht verfügbar', 'account_unavailable');
    return this.buildIdentity(user);
  }

  /** Auf dem Heimat-Server: Zustimmung erteilen und Rücksprung-URL mit Code bauen. */
  async authorizeApprove(user: User, origin: string, redirect: string, state: string): Promise<{ redirectUrl: string }> {
    const peer = await this.ctx.db.federatedServer.findUnique({ where: { baseUrl: normalizeBaseUrl(origin) } });
    if (!peer || peer.status !== 'ACTIVE') throw forbidden('Unbekannter oder gesperrter Server', 'federation_unknown');
    // Schutz vor offenen Weiterleitungen: Rücksprung muss zum anfragenden Peer gehören.
    if (redirect !== peer.baseUrl && !redirect.startsWith(`${peer.baseUrl}/`)) throw badRequest('Ungültige Rücksprungadresse', 'federation_bad_redirect');
    const code = this.createAuthCode(user.id, peer.id);
    const sep = redirect.includes('?') ? '&' : '?';
    return { redirectUrl: `${redirect}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}` };
  }

  /** Auf dem besuchenden Server: Login über einen verbundenen Server starten (liefert die Authorize-URL). */
  async startFederatedLogin(serverId: string): Promise<{ url: string }> {
    const peer = await this.ctx.db.federatedServer.findUnique({ where: { id: serverId } });
    if (!peer || peer.status !== 'ACTIVE') throw notFound('Server nicht verbunden');
    const state = this.signLoginState(peer.id);
    const me = this.baseUrl();
    const url = `${peer.baseUrl}/federated-authorize?origin=${encodeURIComponent(me)}&redirect=${encodeURIComponent(`${me}/federated-login`)}&state=${encodeURIComponent(state)}`;
    return { url };
  }

  /** Auf dem besuchenden Server: Code beim Heimat-Server gegen die Identität eintauschen. */
  async exchangeWithPeer(peer: FederatedServer, code: string): Promise<FederatedIdentity> {
    const res = await this.signedFetch(peer.baseUrl, 'POST', `/api/federation/auth/exchange/${encodeURIComponent(code)}`);
    if (!res.ok) throw badRequest(`Identitätsabgleich fehlgeschlagen (HTTP ${res.status})`, 'federation_exchange_failed');
    return (await res.json()) as FederatedIdentity;
  }

  /** Legt das lokale Schatten-Konto eines Remote-Nutzers an oder aktualisiert es. */
  async provisionFederatedUser(serverId: string, identity: FederatedIdentity): Promise<User> {
    const existing = await this.ctx.db.user.findFirst({ where: { federationServerId: serverId, federationUserId: identity.userId } });
    const displayName = identity.displayName ?? identity.username;
    if (existing) return this.ctx.db.user.update({ where: { id: existing.id }, data: { displayName } });

    const server = await this.ctx.db.federatedServer.findUnique({ where: { id: serverId } });
    const tag = createHash('sha1').update(server?.baseUrl ?? serverId).digest('hex').slice(0, 6);
    const base = (identity.username || 'user').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 24) || 'user';
    let username = `${base}-${tag}`.slice(0, 36);
    for (let i = 2; await this.ctx.db.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } }); i++) {
      username = `${base}${i}-${tag}`.slice(0, 36);
    }
    const host = server ? new URL(server.baseUrl).host : serverId;
    const email = `fed_${identity.userId}_${tag}@${host}.federated`.toLowerCase().slice(0, 180);
    return this.ctx.db.user.create({
      data: { username, email, displayName, role: 'USER', federationServerId: serverId, federationUserId: identity.userId },
    });
  }

  // ---------------------------------------------------------------------------
  // Stufe 3: föderierter Chat (Direktnachrichten über Servergrenzen)
  // ---------------------------------------------------------------------------

  /** Heimat-Server: Identität eines lokalen (echten) Nutzers per Username (für Netzwerk-DMs). */
  async localUserIdentity(username: string): Promise<FederatedIdentity | null> {
    const user = await this.ctx.db.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' }, federationServerId: null, disabled: false },
    });
    return user ? this.buildIdentity(user) : null;
  }

  /** Besuchender Server: Remote-Nutzer suchen und lokales Schatten-Konto anlegen (um eine DM zu starten). */
  async lookupRemoteUser(serverId: string, username: string): Promise<User> {
    const peer = await this.ctx.db.federatedServer.findUnique({ where: { id: serverId } });
    if (!peer || peer.status !== 'ACTIVE') throw notFound('Server nicht verbunden');
    const res = await this.signedFetch(peer.baseUrl, 'GET', `/api/federation/users/${encodeURIComponent(username)}`);
    if (res.status === 404) throw notFound('Nutzer nicht gefunden');
    if (!res.ok) throw badRequest(`Suche fehlgeschlagen (HTTP ${res.status})`, 'federation_lookup_failed');
    return this.provisionFederatedUser(peer.id, (await res.json()) as FederatedIdentity);
  }

  /** Leitet eine in einer Direkt-Konversation gepostete Nachricht an den Heimat-Server des Remote-Partners weiter. */
  async forwardChatMessage(author: User, shadowOther: User, msg: { id: string; body: string; gifUrl: string | null; createdAt: Date }): Promise<void> {
    if (!shadowOther.federationServerId || !shadowOther.federationUserId) return;
    const peer = await this.ctx.db.federatedServer.findUnique({ where: { id: shadowOther.federationServerId } });
    if (!peer || peer.status !== 'ACTIVE') return;
    const body = {
      federationId: msg.id,
      from: { userId: author.id, username: author.username, displayName: author.displayName ?? author.username },
      toUserId: shadowOther.federationUserId,
      body: msg.body,
      gifUrl: msg.gifUrl,
      sentAt: msg.createdAt.toISOString(),
    };
    try {
      await this.signedFetch(peer.baseUrl, 'POST', '/api/federation/chat/deliver', body);
    } catch (err) {
      this.ctx.logs.push({ time: new Date().toISOString(), level: 'warn', msg: `Föderierte Chat-Zustellung fehlgeschlagen: ${String(err)}` });
    }
  }

  /** Empfängt eine föderierte Chat-Nachricht von einem Peer und legt sie lokal an (mit Dedup). */
  async deliverIncomingChat(
    peer: FederatedServer,
    payload: { federationId: string; from: { userId: string; username: string; displayName: string | null }; toUserId: string; body: string; gifUrl: string | null; sentAt: string },
  ): Promise<{ ok: true; duplicate?: boolean }> {
    const { db } = this.ctx;
    if (await db.message.findUnique({ where: { federationId: payload.federationId } })) return { ok: true, duplicate: true };
    const local = await db.user.findFirst({ where: { id: payload.toUserId, federationServerId: null } });
    if (!local || local.disabled) throw notFound('Empfänger nicht gefunden');
    const sender = await this.provisionFederatedUser(peer.id, { userId: payload.from.userId, username: payload.from.username, displayName: payload.from.displayName, avatarUrl: null });
    const blocked = await db.block.findFirst({ where: { OR: [{ blockerId: local.id, blockedId: sender.id }, { blockerId: sender.id, blockedId: local.id }] } });
    if (blocked) return { ok: true };
    const conv = await this.ctx.chat.ensureDirect(local.id, sender.id, sender.id);
    const createdAt = Number.isFinite(Date.parse(payload.sentAt)) ? new Date(payload.sentAt) : new Date();
    const msg = await db.message.create({
      data: { conversationId: conv.id, authorId: sender.id, body: payload.body, gifUrl: payload.gifUrl, federationId: payload.federationId, createdAt },
      include: { author: true },
    });
    await db.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: msg.createdAt } });
    const dto = messageDto(this.ctx.signer, msg);
    this.ctx.hub.toUsers([local.id, sender.id], { type: 'chat.message', data: dto });
    const preview = payload.body ? payload.body.slice(0, 200) : payload.gifUrl ? 'GIF' : '📷';
    await this.ctx.notifications.notify(
      local.id,
      'message',
      { username: sender.displayName ?? sender.username, conversationId: conv.id, preview, path: `/chat/${conv.id}` },
      { store: false },
    );
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Fern-Administration (beidseitiges Opt-in)
  //
  // Ein Server kann nur fernverwaltet werden, wenn er den Hub ausdrücklich dazu
  // berechtigt (adminGranted auf seiner Seite). Der Hub lernt diese Erlaubnis beim
  // Sync (adminAllowed) und kann dann über peer-signierte /federation/admin/*-Routen
  // Übersicht und Nutzer des Peers verwalten. Mutationen tragen ihre Parameter in der
  // signierten URL (Query), nicht im unsignierten Body.
  // ---------------------------------------------------------------------------

  /** Wir erlauben/entziehen diesem Peer die Fernverwaltung über uns. */
  async setAdminGranted(id: string, granted: boolean): Promise<FederatedServerDto> {
    const server = await this.ctx.db.federatedServer.update({ where: { id }, data: { adminGranted: granted } });
    return federatedServerDto(server);
  }

  /** Peer-signiert: verifiziert den Aufrufer UND prüft, dass er uns fernverwalten darf. */
  async verifyPeerAdmin(headers: Record<string, unknown>, method: string, pathWithQuery: string): Promise<FederatedServer> {
    const peer = await this.verifyPeer(headers, method, pathWithQuery);
    if (!peer.adminGranted) throw forbidden('Dieser Server hat keine Fernverwaltung erlaubt', 'federation_admin_denied');
    return peer;
  }

  /** Peer-signiert: meldet dem aufrufenden Hub, ob er uns fernverwalten darf. */
  async adminStatusFor(headers: Record<string, unknown>, method: string, pathWithQuery: string): Promise<{ granted: boolean }> {
    const peer = await this.verifyPeer(headers, method, pathWithQuery);
    return { granted: peer.adminGranted };
  }

  /** R-Seite: kompakte Übersicht dieses Servers (für die Fernverwaltung). */
  async localOverview(): Promise<RemoteAdminOverview> {
    const [userCount, adminCount, gameCount, storage, fedCount, settings] = await Promise.all([
      this.ctx.db.user.count(),
      this.ctx.db.user.count({ where: { role: 'ADMIN', disabled: false } }),
      this.ctx.db.game.count(),
      this.ctx.db.buildFile.aggregate({ _sum: { size: true } }),
      this.ctx.db.federatedServer.count({ where: { status: 'ACTIVE' } }),
      this.ctx.settings.get(),
    ]);
    return {
      siteName: settings.siteName,
      version: this.ctx.config.version,
      userCount,
      adminCount,
      gameCount,
      storageBytes: Number(storage._sum.size ?? 0n),
      federatedServerCount: fedCount,
      maintenanceMode: settings.maintenanceMode,
    };
  }

  /** R-Seite: Nutzer dieses Servers auflisten (für die Fernverwaltung). */
  async localUsers(q?: string): Promise<RemoteUserDto[]> {
    const users = await this.ctx.db.user.findMany({
      where: q ? { OR: [{ username: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] } : undefined,
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return users.map((u) => remoteUserDto(u));
  }

  /** R-Seite: Rolle/Deaktivierung eines Nutzers ändern (Last-Admin-Schutz). */
  async localUpdateUser(id: string, data: { role?: Role; disabled?: boolean }): Promise<RemoteUserDto> {
    const target = await this.ctx.db.user.findUnique({ where: { id } });
    if (!target) throw notFound('Nutzer nicht gefunden');
    // Letzten aktiven Admin nicht herabstufen/deaktivieren
    const losesAdmin = target.role === 'ADMIN' && ((data.role && data.role !== 'ADMIN') || data.disabled === true);
    if (losesAdmin) {
      const admins = await this.ctx.db.user.count({ where: { role: 'ADMIN', disabled: false } });
      if (admins <= 1) throw badRequest('Es muss mindestens ein aktiver Admin bleiben', 'last_admin');
    }
    const updated = await this.ctx.db.user.update({
      where: { id },
      data: { ...(data.role ? { role: data.role } : {}), ...(data.disabled !== undefined ? { disabled: data.disabled } : {}) },
    });
    return remoteUserDto(updated);
  }

  /** Hub-Seite: prüft, dass uns der Zielserver die Fernverwaltung erlaubt. */
  private async requireRemoteAllowed(serverId: string): Promise<FederatedServer> {
    const s = await this.ctx.db.federatedServer.findUnique({ where: { id: serverId } });
    if (!s || s.status !== 'ACTIVE') throw notFound('Server nicht gefunden');
    if (!s.adminAllowed) throw forbidden('Dieser Server erlaubt dir keine Fernverwaltung', 'federation_admin_not_allowed');
    return s;
  }

  private async remoteJson<T>(serverId: string, method: string, apiPath: string): Promise<T> {
    const s = await this.requireRemoteAllowed(serverId);
    const res = await this.signedFetch(s.baseUrl, method, apiPath);
    if (!res.ok) {
      const reason = (await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`;
      throw badRequest(`Fernverwaltung fehlgeschlagen (${reason})`, 'federation_admin_remote_error');
    }
    return (await res.json()) as T;
  }

  /** Hub-Seite: Übersicht eines fernverwalteten Servers. */
  remoteOverview(serverId: string): Promise<RemoteAdminOverview> {
    return this.remoteJson<RemoteAdminOverview>(serverId, 'GET', '/api/federation/admin/overview');
  }

  /** Hub-Seite: Nutzer eines fernverwalteten Servers. */
  remoteUsers(serverId: string, q?: string): Promise<RemoteUserDto[]> {
    const query = q ? `?q=${encodeURIComponent(q)}` : '';
    return this.remoteJson<RemoteUserDto[]>(serverId, 'GET', `/api/federation/admin/users${query}`);
  }

  /** Hub-Seite: Nutzer eines fernverwalteten Servers ändern (Parameter in der signierten URL). */
  remoteUpdateUser(serverId: string, userId: string, data: { role?: Role; disabled?: boolean }): Promise<RemoteUserDto> {
    const params = new URLSearchParams();
    if (data.role) params.set('role', data.role);
    if (data.disabled !== undefined) params.set('disabled', String(data.disabled));
    return this.remoteJson<RemoteUserDto>(serverId, 'POST', `/api/federation/admin/users/${encodeURIComponent(userId)}?${params.toString()}`);
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
