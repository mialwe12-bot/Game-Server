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
});
