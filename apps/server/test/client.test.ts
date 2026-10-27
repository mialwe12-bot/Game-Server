import WebSocket from 'ws';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, deviceLogin, login, resetDb, type Client, type TestApp } from './helpers.js';

let t: TestApp;
let admin: Client;

beforeEach(async () => {
  t ??= await createTestApp();
  await resetDb(t.app);
  await createUser(t.app, 'admin', 'ADMIN');
  await createUser(t.app, 'user');
  admin = await login(t.app, 'admin');
});
afterAll(async () => t?.close());

function multipart(filename: string, data: Buffer) {
  const boundary = '----gsclient';
  return {
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function release(version: string, files: string[], signed = true, publish = true) {
  const r = (await admin.req('POST', '/api/admin/client-releases', { version, notes: `Version ${version}` })).json();
  let last = r;
  for (const name of files) {
    const m = multipart(name, Buffer.from(`binary ${name}`));
    const res = await admin.req('POST', `/api/admin/client-releases/${r.id}/files`, m.body, m.headers);
    expect(res.statusCode).toBe(200);
    last = res.json();
  }
  if (signed) for (const f of last.files) await admin.req('PATCH', `/api/admin/client-files/${f.id}`, { signature: `sig-${f.filename}` });
  if (publish) await admin.req('PATCH', `/api/admin/client-releases/${r.id}`, { published: true });
  return (await admin.req('GET', '/api/admin/client-releases')).json().find((x: { id: string }) => x.id === r.id);
}

describe('Client-Releases & Auto-Update', () => {
  it('erkennt Formate, liefert Update-JSON und 204 ohne Update', async () => {
    const r = await release('1.1.0', ['GameServer_1.1.0_x64-setup.exe', 'GameServer_1.1.0_x64_en-US.msi', 'game-server_1.1.0_amd64.AppImage', 'game-server_1.1.0_amd64.deb']);
    expect(r.files.map((f: { format: string }) => f.format).sort()).toEqual(['APPIMAGE', 'DEB', 'MSI', 'NSIS']);
    expect(r.files.every((f: { arch: string }) => f.arch === 'x86_64')).toBe(true);

    const win = await t.app.inject({ method: 'GET', url: '/api/client/update/windows/x86_64/1.0.0' });
    expect(win.statusCode).toBe(200);
    expect(win.json()).toMatchObject({ version: '1.1.0', signature: 'sig-GameServer_1.1.0_x64-setup.exe', notes: 'Version 1.1.0' });
    expect(win.json().url).toMatch(/^http:\/\/localhost:5173\/api\/client\/files\/.+\/download$/);

    const linux = await t.app.inject({ method: 'GET', url: '/api/client/update/linux/x86_64/1.0.0' });
    expect(linux.json().signature).toBe('sig-game-server_1.1.0_amd64.AppImage');
    expect((await t.app.inject({ method: 'GET', url: '/api/client/update/linux/x86_64/1.1.0' })).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: '/api/client/update/linux/aarch64/1.0.0' })).statusCode).toBe(204);

    // Datei-Download öffentlich, mit Range
    const url = new URL(linux.json().url).pathname;
    const dl = await t.app.inject({ method: 'GET', url, headers: { range: 'bytes=0-5' } });
    expect(dl.statusCode).toBe(206);
    expect(dl.rawPayload.toString()).toBe('binary');

    const latest = (await t.app.inject({ method: 'GET', url: '/api/client/releases/latest' })).json();
    expect(latest.version).toBe('1.1.0');
  });

  it('unveröffentlichte oder unsignierte Releases werden nicht angeboten', async () => {
    await release('1.0.5', ['a_amd64.AppImage'], true, true);
    await release('2.0.0', ['b_amd64.AppImage'], true, false);
    await release('1.5.0', ['c_amd64.AppImage'], false, true);
    const res = await t.app.inject({ method: 'GET', url: '/api/client/update/linux/x86_64/1.0.0' });
    expect(res.json().version).toBe('1.0.5');
    expect((await t.app.inject({ method: 'GET', url: '/api/client/releases/latest' })).json().version).toBe('1.5.0');
  });

  it('nur Admins verwalten Releases; ungültige Formate werden abgelehnt', async () => {
    const user = await login(t.app, 'user');
    expect((await user.req('GET', '/api/admin/client-releases')).statusCode).toBe(403);
    expect((await admin.req('POST', '/api/admin/client-releases', { version: 'eins' })).statusCode).toBe(400);
    const r = (await admin.req('POST', '/api/admin/client-releases', { version: '3.0.0' })).json();
    const m = multipart('virus.zip', Buffer.from('x'));
    expect((await admin.req('POST', `/api/admin/client-releases/${r.id}/files`, m.body, m.headers)).json().error).toBe('invalid_format');
    expect((await admin.req('PATCH', `/api/admin/client-releases/${r.id}`, { published: true })).json().error).toBe('no_files');
  });
});

describe('WebSocket-Authentifizierung per Device-Token', () => {
  it('akzeptiert bearer.<token> als Subprotokoll', async () => {
    const token = await deviceLogin(t.app, 'user');
    const address = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(`${address.replace('http', 'ws')}/api/ws`, ['gs.v1', `bearer.${token}`]);
    const hello = await new Promise<{ type: string; data: { userId: string } }>((resolve, reject) => {
      ws.once('message', (m) => resolve(JSON.parse(String(m))));
      ws.once('error', reject);
    });
    expect(ws.protocol).toBe('gs.v1');
    expect(hello.type).toBe('hello');
    expect(hello.data.userId).toBeTruthy();
    ws.close();
  });
});

describe('CORS & CORP für den Desktop-Client', () => {
  it('Medien sind cross-origin ladbar', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});

describe('CORS für die Tauri-WebView', () => {
  it('erlaubt Bearer-Requests von tauri://localhost inkl. Preflight', async () => {
    const pre = await t.app.inject({
      method: 'OPTIONS',
      url: '/api/uploads/x',
      headers: { origin: 'tauri://localhost', 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization,upload-offset,content-type' },
    });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('tauri://localhost');
    expect(String(pre.headers['access-control-allow-headers']).toLowerCase()).toContain('upload-offset');
    const evil = await t.app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://evil.example' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});
