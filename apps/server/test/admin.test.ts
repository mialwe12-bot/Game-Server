import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, login, PASSWORD, publishedGame, resetDb, type Client, type TestApp } from './helpers.js';

let t: TestApp;
let admin: Client;
let user: Client;

beforeEach(async () => {
  t ??= await createTestApp();
  await resetDb(t.app);
  await createUser(t.app, 'admin', 'ADMIN');
  await createUser(t.app, 'user');
  admin = await login(t.app, 'admin');
  user = await login(t.app, 'user');
});
afterAll(async () => t?.close());

const hasPgDump = (() => {
  try {
    execSync('pg_dump --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('Admin-Bereich', () => {
  it('ist nur für Admins zugänglich', async () => {
    expect((await user.req('GET', '/api/admin/users')).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/users' })).statusCode).toBe(401);
    expect((await admin.req('GET', '/api/admin/overview')).json().users).toBe(2);
  });

  it('Nutzerverwaltung: Rolle, Sperre, letzter Admin, Löschen', async () => {
    const list = (await admin.req('GET', '/api/admin/users?q=use')).json();
    expect(list.total).toBe(1);
    const target = list.items[0];
    const promoted = await admin.req('PATCH', `/api/admin/users/${target.id}`, { role: 'UPLOADER', uploadQuotaBytes: 1000 });
    expect(promoted.json().role).toBe('UPLOADER');
    expect(promoted.json().uploadQuotaBytes).toBe(1000);
    // Sperren beendet alle Sessions
    await admin.req('PATCH', `/api/admin/users/${target.id}`, { disabled: true });
    expect((await user.req('GET', '/api/auth/me')).json().user).toBeNull();
    // Selbst-Aussperren und letzter Admin
    expect((await admin.req('PATCH', `/api/admin/users/${admin.userId}`, { role: 'USER' })).json().error).toBe('self_lockout');
    const created = await admin.req('POST', '/api/admin/users', { username: 'neu', email: 'neu@example.test', password: PASSWORD, role: 'ADMIN' });
    expect(created.statusCode).toBe(200);
    const neu = await login(t.app, 'neu');
    expect((await neu.req('PATCH', `/api/admin/users/${admin.userId}`, { role: 'USER' })).statusCode).toBe(200);
    expect((await neu.req('PATCH', `/api/admin/users/${neu.userId}`, { role: 'USER' })).json().error).toBe('self_lockout');
    expect((await neu.req('DELETE', `/api/admin/users/${target.id}`)).statusCode).toBe(200);
    // Audit-Log
    const audit = (await neu.req('GET', '/api/admin/logs/audit?action=admin.')).json();
    expect(audit.items.map((a: { action: string }) => a.action)).toContain('admin.user_deleted');
  });

  it('Einladungen erzeugen und widerrufen', async () => {
    const invite = (await admin.req('POST', '/api/admin/invites', { role: 'UPLOADER', maxUses: 2, expiresInDays: 7 })).json();
    expect(invite.url).toContain(`/register?invite=${invite.code}`);
    expect((await t.app.inject({ method: 'GET', url: `/api/auth/invite/${invite.code}` })).json()).toEqual({ valid: true, role: 'UPLOADER' });
    await admin.req('DELETE', `/api/admin/invites/${invite.id}`);
    expect((await t.app.inject({ method: 'GET', url: `/api/auth/invite/${invite.code}` })).json().valid).toBe(false);
  });

  it('Einstellungen ändern und validieren', async () => {
    const res = await admin.req('PATCH', '/api/admin/settings', { siteName: 'Meine Spiele', registrationMode: 'open', downloadRateLimitKbps: 1024 });
    expect(res.json().siteName).toBe('Meine Spiele');
    expect((await t.app.inject({ method: 'GET', url: '/api/settings/public' })).json().registrationMode).toBe('open');
    expect((await admin.req('PATCH', '/api/admin/settings', { registrationMode: 'weird' })).statusCode).toBe(400);
    expect((await admin.req('PATCH', '/api/admin/settings', { uploadChunkBytes: 10 })).statusCode).toBe(400);
  });

  it('Speicherübersicht und Logs', async () => {
    await publishedGame(admin, 'Speicher');
    const storage = (await admin.req('GET', '/api/admin/storage')).json();
    expect(storage.disk.total).toBeGreaterThan(0);
    expect(storage.games[0].bytes).toBeGreaterThan(0);
    const logs = (await admin.req('GET', '/api/admin/logs/server?limit=10')).json();
    expect(Array.isArray(logs)).toBe(true);
  });

  it.skipIf(!hasPgDump)('Backup (DB + Dateien) erstellen, herunterladen, löschen', async () => {
    await publishedGame(admin, 'Backup-Spiel');
    const started = (await admin.req('POST', '/api/admin/backups', { includeFiles: true })).json();
    expect(started.status).toBe('RUNNING');
    let backup = started;
    for (let i = 0; i < 100 && backup.status === 'RUNNING'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      backup = (await admin.req('GET', '/api/admin/backups')).json()[0];
    }
    expect(backup.error).toBeNull();
    expect(backup.status).toBe('COMPLETED');
    const file = path.join(t.dataDir, 'backups', backup.filename);
    const listing = execSync(`tar -tzf ${file}`).toString();
    expect(listing).toContain('database.dump');
    expect(listing).toMatch(/builds\//);
    const dl = await admin.req('GET', `/api/admin/backups/${backup.id}/download`, undefined, { range: 'bytes=0-1' });
    expect(dl.statusCode).toBe(206);
    expect(dl.rawPayload.equals(Buffer.from([0x1f, 0x8b]))).toBe(true); // gzip
    await admin.req('DELETE', `/api/admin/backups/${backup.id}`);
    await expect(fs.stat(file)).rejects.toThrow();
  });
});

describe('System', () => {
  it('Healthcheck, OpenAPI und 404', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/health' })).json().status).toBe('ok');
    const spec = (await t.app.inject({ method: 'GET', url: '/api/openapi.json' })).json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths)).toContain('/api/store/search');
    expect((await t.app.inject({ method: 'GET', url: '/api/gibts-nicht' })).statusCode).toBe(404);
  });

  it('Sicherheitsheader sind gesetzt', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('Rate-Limiting greift beim Login', async () => {
    const limited = await createTestApp({ AUTH_RATE_LIMIT_MAX: '3' });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await limited.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'x', password: 'y' } });
        codes.push(r.statusCode);
      }
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
      expect(codes[4]).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
