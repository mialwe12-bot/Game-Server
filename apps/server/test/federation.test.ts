import { createPrivateKey, sign as edSign } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, login, publishedGame, resetDb, type Client, type TestApp } from './helpers.js';

let t: TestApp;
let admin: Client;
let user: Client;
let buildId: string;

/** Signiert eine kanonische Peer-Anfrage mit dem eigenen Föderationsschlüssel dieses Servers. */
async function selfSignedHeaders(method: string, path: string, ts = Date.now()) {
  const keys = await t.app.ctx.settings.federationKeys();
  const sig = edSign(null, Buffer.from(`${method.toUpperCase()}\n${path}\n${ts}`), createPrivateKey(keys.privateKey)).toString('base64');
  return { 'x-gs-server': 'https://peer.example', 'x-gs-timestamp': String(ts), 'x-gs-signature': sig };
}

/** Legt einen Peer an, der denselben öffentlichen Schlüssel wie dieser Server nutzt (für Signaturtests). */
async function selfAsPeer(baseUrl = 'https://peer.example', catalog: unknown[] = []) {
  const self = await t.app.ctx.federation.selfInfo();
  return t.app.ctx.db.federatedServer.create({
    data: { name: 'Peer', baseUrl, publicKey: self.publicKey, status: 'ACTIVE', catalog: catalog as object },
  });
}

beforeEach(async () => {
  if (!t) t = await createTestApp();
  else await resetDb(t.app);
  // resetDb leert die Setting-Tabelle (auch den Föderationsschlüssel); Dienst-Cache neu aus der DB laden.
  await t.app.ctx.federation.init();
  await createUser(t.app, 'admin', 'ADMIN');
  await createUser(t.app, 'bob');
  admin = await login(t.app, 'admin');
  user = await login(t.app, 'bob');
  buildId = (await publishedGame(admin, 'Netzwerkspiel')).buildId;
});

afterAll(async () => {
  await t?.close();
});

describe('Föderation Stufe 1', () => {
  it('exportiert öffentliche Spiele mit Builds', async () => {
    const catalog = await t.app.ctx.federation.exportCatalog();
    const game = catalog.find((g) => g.title === 'Netzwerkspiel');
    expect(game).toBeTruthy();
    expect(game!.builds.length).toBeGreaterThan(0);
    expect(game!.builds[0].buildId).toBeTruthy();
    expect(game!.builds[0].sizeBytes).toBeGreaterThan(0);
  });

  it('grantDownload liefert signierte URLs, die ohne Login laden', async () => {
    const grant = await t.app.ctx.federation.grantDownload(buildId);
    expect(grant.files).toHaveLength(1);
    const u = new URL(grant.files[0].url);
    const res = await t.app.inject({ method: 'GET', url: u.pathname + u.search });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.length).toBe(grant.files[0].size);
  });

  it('verweigert den Datei-Zugriff ohne Signatur und ohne Login', async () => {
    const grant = await t.app.ctx.federation.grantDownload(buildId);
    const path = new URL(grant.files[0].url).pathname; // ohne exp/sig
    const res = await t.app.inject({ method: 'GET', url: path });
    expect(res.statusCode).toBe(401);
  });

  it('weist manipulierte oder veraltete Signaturen zurück, akzeptiert gültige', async () => {
    const peer = await selfAsPeer();
    const path = '/api/federation/games';
    const headers = await selfSignedHeaders('GET', path);
    const server = await t.app.ctx.federation.verifyPeer(headers, 'GET', path);
    expect(server.id).toBe(peer.id);

    await expect(t.app.ctx.federation.verifyPeer({ ...headers, 'x-gs-signature': 'AAAA' }, 'GET', path)).rejects.toThrow();
    const stale = await selfSignedHeaders('GET', path, Date.now() - 10 * 60_000);
    await expect(t.app.ctx.federation.verifyPeer(stale, 'GET', path)).rejects.toThrow();
  });

  it('Pairing-Code ist genau einmal gültig', () => {
    const { code } = t.app.ctx.federation.createPairingCode();
    expect(t.app.ctx.federation.consumePairingCode(code)).toBe(true);
    expect(t.app.ctx.federation.consumePairingCode(code)).toBe(false);
    expect(t.app.ctx.federation.consumePairingCode('unbekannt')).toBe(false);
  });

  it('liefert die öffentliche Kennung unter /api/federation/info', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/federation/info' });
    expect(res.statusCode).toBe(200);
    const info = res.json();
    expect(info.publicKey).toContain('PUBLIC KEY');
    expect(info.baseUrl).toBeTruthy();
  });

  it('/api/federation/games verlangt eine gültige Peer-Signatur', async () => {
    const unsigned = await t.app.inject({ method: 'GET', url: '/api/federation/games' });
    expect(unsigned.statusCode).toBe(403);

    await selfAsPeer();
    const headers = await selfSignedHeaders('GET', '/api/federation/games');
    const ok = await t.app.inject({ method: 'GET', url: '/api/federation/games', headers });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().some((g: { title: string }) => g.title === 'Netzwerkspiel')).toBe(true);
  });

  it('/api/federation/download/:buildId liefert signierte Datei-URLs an Peers', async () => {
    await selfAsPeer();
    const path = `/api/federation/download/${buildId}`;
    const headers = await selfSignedHeaders('POST', path);
    const res = await t.app.inject({ method: 'POST', url: path, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().files[0].url).toContain('sig=');
  });

  it('führt Remote-Kataloge mit Herkunftsserver zusammen (Netzwerk-Katalog)', async () => {
    await selfAsPeer('https://b.example', [
      { slug: 'remote', title: 'Remote-Spiel', shortDescription: '', coverUrl: null, developer: null, publisher: null, builds: [{ buildId: 'b1', platform: 'LINUX', version: '1.0.0', kind: 'ZIP', sizeBytes: 10 }] },
    ]);
    const net = await t.app.ctx.federation.networkGames();
    const remote = net.find((g) => g.title === 'Remote-Spiel');
    expect(remote?.serverName).toBe('Peer');
    expect(remote?.serverBaseUrl).toBe('https://b.example');

    const res = await user.req('GET', '/api/network/games');
    expect(res.statusCode).toBe(200);
    expect(res.json().some((g: { title: string }) => g.title === 'Remote-Spiel')).toBe(true);
  });

  it('Admin kann einen Pairing-Code erzeugen, Nicht-Admins nicht', async () => {
    const res = await admin.req('POST', '/api/admin/federation/pairing-code');
    expect(res.statusCode).toBe(200);
    expect(res.json().code).toBeTruthy();
    const denied = await user.req('POST', '/api/admin/federation/pairing-code');
    expect(denied.statusCode).toBe(403);
  });

  // --- Stufe 2: geteilte Accounts (föderierter Login) ---

  it('signiert und prüft den Login-State (zustandslos)', () => {
    const fed = t.app.ctx.federation;
    const state = fed.signLoginState('srv123');
    expect(fed.verifyLoginState(state)).toBe('srv123');
    expect(fed.verifyLoginState(`${state}x`)).toBeNull();
    expect(fed.verifyLoginState('kaputt')).toBeNull();
  });

  it('tauscht einen Login-Code nur für den ausstellenden Peer ein', async () => {
    const peer = await selfAsPeer();
    const adminUser = await t.app.ctx.db.user.findUnique({ where: { username: 'admin' } });
    const code = t.app.ctx.federation.createAuthCode(adminUser!.id, peer.id);
    const identity = await t.app.ctx.federation.exchangeAuthCode(code, peer.id);
    expect(identity.username).toBe('admin');
    // einmalig
    await expect(t.app.ctx.federation.exchangeAuthCode(code, peer.id)).rejects.toThrow();
    // falscher Peer
    const code2 = t.app.ctx.federation.createAuthCode(adminUser!.id, peer.id);
    await expect(t.app.ctx.federation.exchangeAuthCode(code2, 'anderer-peer')).rejects.toThrow();
  });

  it('legt ein Schatten-Konto an und aktualisiert es beim erneuten Login', async () => {
    const peer = await selfAsPeer();
    const fed = t.app.ctx.federation;
    const u1 = await fed.provisionFederatedUser(peer.id, { userId: 'remote1', username: 'alice', displayName: 'Alice', avatarUrl: null });
    expect(u1.federationServerId).toBe(peer.id);
    expect(u1.federationUserId).toBe('remote1');
    const u2 = await fed.provisionFederatedUser(peer.id, { userId: 'remote1', username: 'alice', displayName: 'Alice Neu', avatarUrl: null });
    expect(u2.id).toBe(u1.id);
    expect(u2.displayName).toBe('Alice Neu');
  });

  it('listet aktive Peers öffentlich unter /api/federation/peers', async () => {
    await selfAsPeer();
    const res = await t.app.inject({ method: 'GET', url: '/api/federation/peers' });
    expect(res.statusCode).toBe(200);
    expect(res.json().some((p: { name: string }) => p.name === 'Peer')).toBe(true);
  });

  it('tauscht den Login-Code über die peer-signierte Route ein', async () => {
    const peer = await selfAsPeer();
    const adminUser = await t.app.ctx.db.user.findUnique({ where: { username: 'admin' } });
    const code = t.app.ctx.federation.createAuthCode(adminUser!.id, peer.id);
    const path = `/api/federation/auth/exchange/${code}`;
    const headers = await selfSignedHeaders('POST', path);
    const res = await t.app.inject({ method: 'POST', url: path, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe('admin');
  });

  it('bestätigt den Login nur angemeldet und mit gültiger Rücksprungadresse', async () => {
    await selfAsPeer('https://peer.example');
    const body = { origin: 'https://peer.example', redirect: 'https://peer.example/federated-login', state: 'abc' };
    const ok = await admin.req('POST', '/api/federation/authorize/approve', body);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().redirectUrl).toContain('code=');
    // fremde Rücksprungadresse → abgelehnt
    const bad = await admin.req('POST', '/api/federation/authorize/approve', { ...body, redirect: 'https://boese.example/klau' });
    expect(bad.statusCode).toBe(400);
    // ohne Login → 401
    const anon = await t.app.inject({ method: 'POST', url: '/api/federation/authorize/approve', payload: body });
    expect(anon.statusCode).toBe(401);
  });

  it('startet föderierten Login und weist ungültigen State im Callback ab', async () => {
    const peer = await selfAsPeer();
    const start = await t.app.inject({ method: 'POST', url: '/api/auth/federated/start', payload: { serverId: peer.id } });
    expect(start.statusCode).toBe(200);
    expect(start.json().url).toContain('/federated-authorize');
    const cb = await t.app.inject({ method: 'POST', url: '/api/auth/federated/callback', payload: { code: 'xxxxxxxxxx', state: 'ungueltig' } });
    expect(cb.statusCode).toBe(400);
  });

  // --- Stufe 3: föderierter Chat ---

  it('stellt eine föderierte Chat-Nachricht zu (Konversation, Schatten-Absender, Dedup)', async () => {
    const peer = await selfAsPeer();
    const bob = await t.app.ctx.db.user.findUnique({ where: { username: 'bob' } });
    const payload = { federationId: 'msg-abc-1', from: { userId: 'remoteU', username: 'carla', displayName: 'Carla' }, toUserId: bob!.id, body: 'Hallo!', gifUrl: null, sentAt: new Date().toISOString() };
    const r1 = await t.app.ctx.federation.deliverIncomingChat(peer, payload);
    expect(r1).toEqual({ ok: true });
    const shadow = await t.app.ctx.db.user.findFirst({ where: { federationServerId: peer.id, federationUserId: 'remoteU' } });
    expect(shadow).toBeTruthy();
    const msg = await t.app.ctx.db.message.findUnique({ where: { federationId: 'msg-abc-1' } });
    expect(msg?.body).toBe('Hallo!');
    expect(msg?.authorId).toBe(shadow!.id);
    const r2 = await t.app.ctx.federation.deliverIncomingChat(peer, payload);
    expect(r2.duplicate).toBe(true);
  });

  it('liefert lokale Nutzeridentität per Username (peer-signiert)', async () => {
    await selfAsPeer();
    const okHeaders = await selfSignedHeaders('GET', '/api/federation/users/admin');
    const ok = await t.app.inject({ method: 'GET', url: '/api/federation/users/admin', headers: okHeaders });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().username).toBe('admin');
    const missHeaders = await selfSignedHeaders('GET', '/api/federation/users/gibtsnicht');
    const miss = await t.app.inject({ method: 'GET', url: '/api/federation/users/gibtsnicht', headers: missHeaders });
    expect(miss.statusCode).toBe(404);
  });

  it('nimmt eine föderierte Chat-Nachricht über die peer-signierte Route an', async () => {
    await selfAsPeer();
    const bob = await t.app.ctx.db.user.findUnique({ where: { username: 'bob' } });
    const path = '/api/federation/chat/deliver';
    const headers = await selfSignedHeaders('POST', path);
    const payload = { federationId: 'msg-http-1', from: { userId: 'rem2', username: 'dora', displayName: 'Dora' }, toUserId: bob!.id, body: 'Via HTTP', gifUrl: null, sentAt: new Date().toISOString() };
    const res = await t.app.inject({ method: 'POST', url: path, headers, payload });
    expect(res.statusCode).toBe(200);
    const msg = await t.app.ctx.db.message.findUnique({ where: { federationId: 'msg-http-1' } });
    expect(msg?.body).toBe('Via HTTP');
  });
});

describe('Föderation Fern-Administration', () => {
  const signedGet = async (path: string) => t.app.inject({ method: 'GET', url: path, headers: await selfSignedHeaders('GET', path) });
  const signedPost = async (path: string) => t.app.inject({ method: 'POST', url: path, headers: await selfSignedHeaders('POST', path) });

  it('sperrt die Fernverwaltung ohne Freigabe und meldet den Status', async () => {
    await selfAsPeer(); // adminGranted standardmäßig false
    expect((await signedGet('/api/federation/admin/overview')).statusCode).toBe(403);
    const st = await signedGet('/api/federation/admin/status');
    expect(st.statusCode).toBe(200);
    expect(st.json().granted).toBe(false);
  });

  it('liefert nach Freigabe Übersicht und Nutzerliste', async () => {
    const peer = await selfAsPeer();
    await t.app.ctx.db.federatedServer.update({ where: { id: peer.id }, data: { adminGranted: true } });

    const ov = await signedGet('/api/federation/admin/overview');
    expect(ov.statusCode).toBe(200);
    expect(ov.json().userCount).toBeGreaterThanOrEqual(2);
    expect(ov.json().adminCount).toBeGreaterThanOrEqual(1);

    const users = await signedGet('/api/federation/admin/users');
    expect(users.statusCode).toBe(200);
    expect(users.json().map((u: { username: string }) => u.username)).toEqual(expect.arrayContaining(['admin', 'bob']));

    const status = await signedGet('/api/federation/admin/status');
    expect(status.json().granted).toBe(true);
  });

  it('ändert einen Nutzer per signierter URL und schützt den letzten Admin', async () => {
    const peer = await selfAsPeer();
    await t.app.ctx.db.federatedServer.update({ where: { id: peer.id }, data: { adminGranted: true } });
    const bob = await t.app.ctx.db.user.findUniqueOrThrow({ where: { username: 'bob' } });
    const adminUser = await t.app.ctx.db.user.findUniqueOrThrow({ where: { username: 'admin' } });

    const up = await signedPost(`/api/federation/admin/users/${bob.id}?role=UPLOADER`);
    expect(up.statusCode).toBe(200);
    expect(up.json().role).toBe('UPLOADER');
    expect((await t.app.ctx.db.user.findUniqueOrThrow({ where: { id: bob.id } })).role).toBe('UPLOADER');

    // Letzten aktiven Admin nicht herabstufen
    const demote = await signedPost(`/api/federation/admin/users/${adminUser.id}?role=USER`);
    expect(demote.statusCode).toBe(400);
    expect(demote.json().error).toBe('last_admin');
  });

  it('Hub-Proxy verweigert Fernverwaltung, wenn der Zielserver sie nicht erlaubt', async () => {
    const peer = await selfAsPeer(); // adminAllowed false
    await expect(t.app.ctx.federation.remoteOverview(peer.id)).rejects.toThrow();
  });

  it('liest und ändert Betriebseinstellungen per Fernverwaltung', async () => {
    const peer = await selfAsPeer();
    await t.app.ctx.db.federatedServer.update({ where: { id: peer.id }, data: { adminGranted: true } });

    const get = await signedGet('/api/federation/admin/settings');
    expect(get.statusCode).toBe(200);
    expect(typeof get.json().siteName).toBe('string');

    const post = await signedPost('/api/federation/admin/settings?maintenanceMode=true&siteName=Umbenannt');
    expect(post.statusCode).toBe(200);
    expect(post.json().maintenanceMode).toBe(true);
    expect(post.json().siteName).toBe('Umbenannt');

    const s = await t.app.ctx.settings.get();
    expect(s.maintenanceMode).toBe(true);
    expect(s.siteName).toBe('Umbenannt');
  });

  it('sperrt die Einstellungen-Route ohne Freigabe', async () => {
    await selfAsPeer();
    expect((await signedGet('/api/federation/admin/settings')).statusCode).toBe(403);
  });

  it('spiegelt die Freigabe-Flags in der Server-DTO', async () => {
    const peer = await selfAsPeer();
    await t.app.ctx.federation.setAdminGranted(peer.id, true);
    const list = await t.app.ctx.federation.listServers();
    const dto = list.find((s) => s.id === peer.id);
    expect(dto?.adminGranted).toBe(true);
    expect(dto?.adminAllowed).toBe(false);
  });
});
