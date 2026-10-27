import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createGameWithBuild,
  createTestApp,
  createUser,
  deviceLogin,
  login,
  publishedGame,
  resetDb,
  uploadFile,
  type Client,
  type TestApp,
} from './helpers.js';

let t: TestApp;
let admin: Client;
let uploader: Client;
let user: Client;

beforeEach(async () => {
  t ??= await createTestApp();
  await resetDb(t.app);
  await createUser(t.app, 'admin', 'ADMIN');
  await createUser(t.app, 'uploader', 'UPLOADER');
  await createUser(t.app, 'user');
  admin = await login(t.app, 'admin');
  uploader = await login(t.app, 'uploader');
  user = await login(t.app, 'user');
});
afterAll(async () => t?.close());

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const octet = (offset: number) => ({ 'content-type': 'application/offset+octet-stream', 'upload-offset': String(offset) });

describe('Spieleverwaltung & Rechte', () => {
  it('nur Admins/Uploader dürfen Spiele anlegen; Uploader nur eigene bearbeiten', async () => {
    expect((await user.req('POST', '/api/manage/games', { title: 'X' })).statusCode).toBe(403);
    const game = (await uploader.req('POST', '/api/manage/games', { title: 'Mein Spiel', genres: ['RPG'] })).json();
    expect(game.slug).toBe('mein-spiel');
    expect(game.visibility).toBe('HIDDEN');
    expect(game.maintainers.map((m: { username: string }) => m.username)).toEqual(['uploader']);

    await createUser(t.app, 'uploader2', 'UPLOADER');
    const other = await login(t.app, 'uploader2');
    expect((await other.req('PATCH', `/api/manage/games/${game.id}`, { title: 'Gehackt' })).statusCode).toBe(403);
    expect((await other.req('GET', '/api/manage/games')).json()).toHaveLength(0);

    // Admin gibt uploader2 Maintainer-Rechte
    const added = await admin.req('POST', `/api/manage/games/${game.id}/maintainers`, { username: 'uploader2' });
    expect(added.statusCode).toBe(200);
    expect((await other.req('PATCH', `/api/manage/games/${game.id}`, { title: 'Gemeinsam' })).json().title).toBe('Gemeinsam');
    // Normale Nutzer können nicht Maintainer werden
    expect((await admin.req('POST', `/api/manage/games/${game.id}/maintainers`, { username: 'user' })).statusCode).toBe(400);
    // Featured darf nur der Admin setzen
    await uploader.req('PATCH', `/api/manage/games/${game.id}`, { featured: true });
    expect((await admin.req('GET', `/api/manage/games/${game.id}`)).json().featured).toBe(false);
  });

  it('Slug-Kollisionen werden aufgelöst', async () => {
    const a = (await admin.req('POST', '/api/manage/games', { title: 'Doppelt' })).json();
    const b = (await admin.req('POST', '/api/manage/games', { title: 'Doppelt' })).json();
    expect(a.slug).toBe('doppelt');
    expect(b.slug).toBe('doppelt-2');
  });

  it('Sichtbarkeit: HIDDEN, UNLISTED, RESTRICTED', async () => {
    const { gameId } = await publishedGame(admin, 'Sichtbar');
    await admin.req('PATCH', `/api/manage/games/${gameId}`, { visibility: 'HIDDEN' });
    expect((await user.req('GET', `/api/store/games/${gameId}`)).statusCode).toBe(403);

    await admin.req('PATCH', `/api/manage/games/${gameId}`, { visibility: 'UNLISTED' });
    expect((await user.req('GET', `/api/store/games/sichtbar`)).statusCode).toBe(200);
    expect((await user.req('GET', '/api/store/search')).json().total).toBe(0);

    await admin.req('PATCH', `/api/manage/games/${gameId}`, { visibility: 'RESTRICTED' });
    expect((await user.req('GET', `/api/store/games/${gameId}`)).statusCode).toBe(403);
    await admin.req('POST', `/api/manage/games/${gameId}/access`, { username: 'user' });
    expect((await user.req('GET', `/api/store/games/${gameId}`)).statusCode).toBe(200);
    expect((await user.req('GET', '/api/store/search')).json().total).toBe(1);
  });

  it('Build-Konfiguration wird validiert', async () => {
    const { buildId, versionId } = await createGameWithBuild(admin, { kind: 'FOLDER' });
    expect((await admin.req('PATCH', `/api/manage/builds/${buildId}`, { status: 'READY' })).json().error).toBe('no_files');
    await uploadFile(admin, buildId, 'data/game.pak', Buffer.from('pak'));
    expect((await admin.req('PATCH', `/api/manage/builds/${buildId}`, { status: 'READY' })).json().error).toBe('executable_missing');
    expect((await admin.req('PATCH', `/api/manage/versions/${versionId}`, { published: true })).json().error).toBe('no_ready_build');
    await uploadFile(admin, buildId, 'bin/game', Buffer.from('elf'));
    const ready = await admin.req('PATCH', `/api/manage/builds/${buildId}`, { status: 'READY', launchArgs: '--fullscreen' });
    expect(ready.json().status).toBe('READY');
    expect(ready.json().fileCount).toBe(2);
    // Proton nur für Windows-Builds
    expect((await admin.req('PATCH', `/api/manage/builds/${buildId}`, { linuxRunner: 'PROTON' })).statusCode).toBe(400);
    const win = await admin.req('POST', `/api/manage/versions/${versionId}/builds`, { platform: 'WINDOWS', kind: 'ZIP', linuxRunner: 'PROTON', executable: 'Game.exe' });
    expect(win.json().linuxRunner).toBe('PROTON');
    // Pro Version nur ein Build je Plattform
    expect((await admin.req('POST', `/api/manage/versions/${versionId}/builds`, { platform: 'WINDOWS', kind: 'ZIP' })).statusCode).toBe(409);
  });
});

describe('Fortsetzbarer Upload', () => {
  it('Chunks, Pause/Fortsetzen über Offset, Prüfsumme', async () => {
    const { buildId } = await createGameWithBuild(admin, { kind: 'FOLDER' });
    const data = Buffer.alloc(300_000);
    for (let i = 0; i < data.length; i++) data[i] = i % 251;
    const created = await admin.req('POST', '/api/uploads', { buildId, path: 'bin\\game', size: data.length, sha256: sha(data) });
    expect(created.statusCode).toBe(200);
    const { id, chunkSize } = created.json();
    expect(chunkSize).toBeGreaterThan(0);
    expect(created.json().path).toBe('bin/game');

    // erster Chunk
    const c1 = await admin.req('PATCH', `/api/uploads/${id}`, data.subarray(0, 100_000), octet(0));
    expect(c1.json().offset).toBe(100_000);
    expect(c1.headers['upload-offset']).toBe('100000');
    // falscher Offset → 409 mit aktuellem Stand
    const mismatch = await admin.req('PATCH', `/api/uploads/${id}`, data.subarray(0, 10), octet(0));
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().details.offset).toBe(100_000);
    // "Pause": Status abfragen und fortsetzen
    const status = await admin.req('GET', `/api/uploads/${id}`);
    expect(status.json().offset).toBe(100_000);
    // Erneutes Anlegen derselben Datei liefert den laufenden Upload
    const resumed = await admin.req('POST', '/api/uploads', { buildId, path: 'bin/game', size: data.length });
    expect(resumed.json().id).toBe(id);
    expect((await admin.req('GET', '/api/uploads')).json()).toHaveLength(1);

    const c2 = await admin.req('PATCH', `/api/uploads/${id}`, data.subarray(100_000), octet(100_000));
    expect(c2.json().status).toBe('COMPLETED');
    expect(c2.json().sha256).toBe(sha(data));
    // zu viele Bytes werden abgelehnt
    const files = (await admin.req('GET', `/api/manage/builds/${buildId}/files`)).json();
    expect(files).toEqual([expect.objectContaining({ path: 'bin/game', size: data.length, sha256: sha(data) })]);
  });

  it('Prüfsummenfehler, Größenüberschreitung und Archivformat werden erkannt', async () => {
    const { buildId } = await createGameWithBuild(admin, { kind: 'FOLDER' });
    const created = await admin.req('POST', '/api/uploads', { buildId, path: 'x.bin', size: 4, sha256: 'a'.repeat(64) });
    const done = await admin.req('PATCH', `/api/uploads/${created.json().id}`, Buffer.from('abcd'), octet(0));
    expect(done.json().status).toBe('FAILED');
    expect(done.json().error).toContain('Prüfsumme');

    const small = await admin.req('POST', '/api/uploads', { buildId, path: 'y.bin', size: 2 });
    const tooBig = await admin.req('PATCH', `/api/uploads/${small.json().id}`, Buffer.from('abcd'), octet(0));
    expect(tooBig.statusCode).toBe(413);
    expect((await admin.req('GET', `/api/uploads/${small.json().id}`)).json().offset).toBe(0);

    const zip = await createGameWithBuild(admin, { kind: 'ZIP', title: 'Zip-Spiel' });
    expect((await admin.req('POST', '/api/uploads', { buildId: zip.buildId, path: 'game.rar', size: 4 })).json().error).toBe('invalid_extension');
    const fake = await uploadFile(admin, zip.buildId, 'game.zip', Buffer.from('not a zip'));
    expect(fake.status).toBe('FAILED');
    const real = await uploadFile(admin, zip.buildId, 'game.zip', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]));
    expect(real.status).toBe('COMPLETED');
    // Ein neuer Upload ersetzt die Archivdatei
    const real2 = await uploadFile(admin, zip.buildId, 'game-v2.zip', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(30)]));
    expect(real2.status).toBe('COMPLETED');
    const files = (await admin.req('GET', `/api/manage/builds/${zip.buildId}/files`)).json();
    expect(files.map((f: { path: string }) => f.path)).toEqual(['game-v2.zip']);
  });

  it('verhindert Path Traversal und Uploads in fremde Spiele', async () => {
    const { buildId } = await createGameWithBuild(admin, { kind: 'FOLDER' });
    expect((await admin.req('POST', '/api/uploads', { buildId, path: '../../etc/passwd', size: 1 })).json().error).toBe('invalid_path');
    expect((await uploader.req('POST', '/api/uploads', { buildId, path: 'a', size: 1 })).statusCode).toBe(403);
    expect((await user.req('POST', '/api/uploads', { buildId, path: 'a', size: 1 })).statusCode).toBe(403);
  });

  it('respektiert Upload-Kontingent und Maximalgröße', async () => {
    await t.app.ctx.settings.update({ defaultUploadQuotaBytes: 100, maxUploadFileBytes: 1024 * 1024 });
    const game = (await uploader.req('POST', '/api/manage/games', { title: 'Quota' })).json();
    const v = (await uploader.req('POST', `/api/manage/games/${game.id}/versions`, { version: '1' })).json();
    const b = (await uploader.req('POST', `/api/manage/versions/${v.id}/builds`, { platform: 'LINUX', kind: 'FOLDER' })).json();
    expect((await uploader.req('POST', '/api/uploads', { buildId: b.id, path: 'a', size: 200 })).json().error).toBe('quota_exceeded');
    await uploadFile(uploader, b.id, 'a', Buffer.alloc(80));
    expect((await uploader.req('POST', '/api/uploads', { buildId: b.id, path: 'b', size: 30 })).json().error).toBe('quota_exceeded');
    expect((await admin.req('POST', '/api/uploads', { buildId: b.id, path: 'c', size: 2 * 1024 * 1024 })).statusCode).toBe(413);
    expect((await uploader.req('GET', '/api/me/upload-quota')).json()).toEqual({ quota: 100, used: 80 });
  });

  it('Abbrechen entfernt den Upload', async () => {
    const { buildId } = await createGameWithBuild(admin);
    const created = await admin.req('POST', '/api/uploads', { buildId, path: 'big', size: 1000 });
    await admin.req('PATCH', `/api/uploads/${created.json().id}`, Buffer.alloc(100), octet(0));
    expect((await admin.req('DELETE', `/api/uploads/${created.json().id}`)).statusCode).toBe(200);
    expect((await admin.req('GET', `/api/uploads/${created.json().id}`)).json().status).toBe('CANCELLED');
  });
});

describe('Downloads', () => {
  it('Manifest, Range-Requests, HEAD, ETag und Download-Zähler', async () => {
    const { gameId, buildId } = await publishedGame(admin, 'Download-Test');
    const token = await deviceLogin(t.app, 'user');
    const auth = { authorization: `Bearer ${token}` };

    const manifest = await t.app.inject({ method: 'GET', url: `/api/builds/${buildId}/manifest`, headers: auth });
    expect(manifest.statusCode).toBe(200);
    const file = manifest.json().files[0];
    expect(file.path).toBe('bin/game');
    const content = Buffer.from('#!/bin/sh\necho hi\n');
    expect(file.sha256).toBe(sha(content));

    const full = await t.app.inject({ method: 'GET', url: file.downloadUrl, headers: auth });
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload.equals(content)).toBe(true);
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers.etag).toBe(`"${file.sha256}"`);
    expect(full.headers['content-disposition']).toContain('filename="game"');

    const part = await t.app.inject({ method: 'GET', url: file.downloadUrl, headers: { ...auth, range: 'bytes=2-5' } });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 2-5/${content.length}`);
    expect(part.rawPayload.toString()).toBe(content.subarray(2, 6).toString());

    const bad = await t.app.inject({ method: 'GET', url: file.downloadUrl, headers: { ...auth, range: 'bytes=999-' } });
    expect(bad.statusCode).toBe(416);

    // If-Range mit veraltetem ETag → komplette Datei
    const stale = await t.app.inject({ method: 'GET', url: file.downloadUrl, headers: { ...auth, range: 'bytes=2-5', 'if-range': '"alt"' } });
    expect(stale.statusCode).toBe(200);

    // HEAD über echten HTTP-Server prüfen (inject berechnet Content-Length aus dem leeren Body)
    const address = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const head = await fetch(`${address}${file.downloadUrl}`, { method: 'HEAD', headers: auth });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(content.length));
    const ranged = await fetch(`${address}${file.downloadUrl}`, { headers: { ...auth, range: 'bytes=10-' } });
    expect(ranged.status).toBe(206);
    expect(Buffer.from(await ranged.arrayBuffer()).equals(content.subarray(10))).toBe(true);

    // Mehrere Requests in kurzer Zeit zählen nur einmal
    const detail = (await user.req('GET', `/api/store/games/${gameId}`)).json();
    expect(detail.downloadCount).toBe(1);
  });

  it('Downloads erfordern Anmeldung und veröffentlichte Builds', async () => {
    const { buildId, versionId } = await publishedGame(admin, 'Geschützt');
    const manifest = (await admin.req('GET', `/api/builds/${buildId}/manifest`)).json();
    expect((await t.app.inject({ method: 'GET', url: manifest.files[0].downloadUrl })).statusCode).toBe(401);
    await admin.req('PATCH', `/api/manage/versions/${versionId}`, { published: false });
    expect((await user.req('GET', `/api/builds/${buildId}/manifest`)).statusCode).toBe(403);
    // Maintainer können unveröffentlichte Builds testen
    expect((await admin.req('GET', `/api/builds/${buildId}/manifest`)).statusCode).toBe(200);
  });

  it('Bandbreitenlimit drosselt Downloads', async () => {
    const { buildId } = await createGameWithBuild(admin);
    await uploadFile(admin, buildId, 'bin/game', Buffer.alloc(96 * 1024, 7));
    await t.app.ctx.settings.update({ downloadRateLimitKbps: 64 });
    const manifest = (await admin.req('GET', `/api/builds/${buildId}/manifest`)).json();
    const start = Date.now();
    const res = await admin.req('GET', manifest.files[0].downloadUrl);
    expect(res.rawPayload.length).toBe(96 * 1024);
    // 64 KiB Burst + 32 KiB bei 64 KiB/s ≈ 0,5 s
    expect(Date.now() - start).toBeGreaterThanOrEqual(400);
  });
});

describe('Medien', () => {
  it('Cover-Upload akzeptiert nur echte Bilder und ersetzt das alte Cover', async () => {
    const game = (await admin.req('POST', '/api/manage/games', { title: 'Bilder', visibility: 'PUBLIC' })).json();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const boundary = '----gs';
    const body = (data: Buffer, name: string) =>
      Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`),
        data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
    const headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
    const svg = await admin.req('POST', `/api/manage/games/${game.id}/media?kind=COVER`, body(Buffer.from('<svg/>'), 'x.svg'), headers);
    expect(svg.statusCode).toBe(400);
    const first = (await admin.req('POST', `/api/manage/games/${game.id}/media?kind=COVER`, body(png, 'a.png'), headers)).json();
    const second = (await admin.req('POST', `/api/manage/games/${game.id}/media?kind=COVER`, body(png, 'b.png'), headers)).json();
    const detail = (await user.req('GET', `/api/store/games/${game.id}`)).json();
    expect(detail.coverUrl).toBe(second.url);
    expect(detail.media).toHaveLength(1);
    expect((await t.app.inject({ method: 'GET', url: first.url })).statusCode).toBe(404);
    const img = await t.app.inject({ method: 'GET', url: second.url });
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
  });
});
