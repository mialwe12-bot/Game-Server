import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { totpAt } from '../src/lib/totp.js';
import { cookieHeader, createTestApp, createUser, deviceLogin, login, PASSWORD, resetDb, type TestApp } from './helpers.js';

let t: TestApp;

beforeEach(async () => {
  t ??= await createTestApp();
  await resetDb(t.app);
});
afterAll(async () => t?.close());

const register = (body: Record<string, unknown>) => t.app.inject({ method: 'POST', url: '/api/auth/register', payload: body });

describe('Registrierung', () => {
  it('ist standardmäßig nur mit Einladung möglich', async () => {
    const res = await register({ username: 'alice', email: 'alice@example.test', password: PASSWORD });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('invite_required');
  });

  it('funktioniert mit Einladung und respektiert maxUses und Rolle', async () => {
    const admin = await createUser(t.app, 'admin', 'ADMIN');
    const invite = await t.app.ctx.db.invite.create({ data: { code: 'ABCDEF', role: 'UPLOADER', maxUses: 1, createdById: admin.id } });
    const ok = await register({ username: 'alice', email: 'alice@example.test', password: PASSWORD, inviteCode: invite.code.toLowerCase() });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.role).toBe('UPLOADER');
    expect(ok.cookies.find((c) => c.name === 'gs_session')?.httpOnly).toBe(true);
    const again = await register({ username: 'bob', email: 'bob@example.test', password: PASSWORD, inviteCode: invite.code });
    expect(again.statusCode).toBe(400);
    expect(again.json().error).toBe('invalid_invite');
  });

  it('offen/geschlossen und Validierung', async () => {
    await t.app.ctx.settings.update({ registrationMode: 'open' });
    expect((await register({ username: 'alice', email: 'alice@example.test', password: PASSWORD })).statusCode).toBe(200);
    expect((await register({ username: 'ALICE', email: 'other@example.test', password: PASSWORD })).statusCode).toBe(409);
    expect((await register({ username: 'x', email: 'x@example.test', password: PASSWORD })).statusCode).toBe(400);
    expect((await register({ username: 'carol', email: 'carol@example.test', password: 'kurz' })).statusCode).toBe(400);
    await t.app.ctx.settings.update({ registrationMode: 'closed' });
    expect((await register({ username: 'dave', email: 'dave@example.test', password: PASSWORD })).json().error).toBe('registration_closed');
  });

  it('speichert Passwörter als Argon2id', async () => {
    await t.app.ctx.settings.update({ registrationMode: 'open' });
    await register({ username: 'alice', email: 'alice@example.test', password: PASSWORD });
    const u = await t.app.ctx.db.user.findUniqueOrThrow({ where: { username: 'alice' } });
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
  });
});

describe('Login & Sessions', () => {
  it('lehnt falsche Zugangsdaten ab und erlaubt Login per E-Mail', async () => {
    await createUser(t.app, 'alice');
    const bad = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'alice', password: 'falsch-falsch' } });
    expect(bad.statusCode).toBe(401);
    const unknown = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'nobody', password: PASSWORD } });
    expect(unknown.statusCode).toBe(401);
    const ok = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'alice@example.test', password: PASSWORD } });
    expect(ok.statusCode).toBe(200);
  });

  it('/auth/me liefert Nutzer und CSRF-Token', async () => {
    await createUser(t.app, 'alice');
    const c = await login(t.app, 'alice');
    const me = await c.req('GET', '/api/auth/me');
    expect(me.json().user.username).toBe('alice');
    expect(me.json().csrfToken).toBe(c.csrf);
    const anon = await t.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anon.json().user).toBeNull();
  });

  it('verlangt CSRF-Token bei schreibenden Cookie-Requests', async () => {
    await createUser(t.app, 'alice');
    const c = await login(t.app, 'alice');
    const without = await t.app.inject({ method: 'PATCH', url: '/api/me', headers: { cookie: c.cookie }, payload: { bio: 'x' } });
    expect(without.statusCode).toBe(403);
    expect(without.json().error).toBe('csrf');
    const wrong = await t.app.inject({ method: 'PATCH', url: '/api/me', headers: { cookie: c.cookie, 'x-csrf-token': 'nope' }, payload: { bio: 'x' } });
    expect(wrong.statusCode).toBe(403);
    const ok = await c.req('PATCH', '/api/me', { bio: 'Hallo' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().bio).toBe('Hallo');
  });

  it('Logout invalidiert die Session', async () => {
    await createUser(t.app, 'alice');
    const c = await login(t.app, 'alice');
    expect((await c.req('POST', '/api/auth/logout')).statusCode).toBe(200);
    const me = await c.req('GET', '/api/auth/me');
    expect(me.json().user).toBeNull();
  });

  it('gesperrte Nutzer können sich nicht anmelden', async () => {
    await createUser(t.app, 'alice', 'USER', { disabled: true });
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'alice', password: PASSWORD } });
    expect(res.statusCode).toBe(403);
  });
});

describe('Device-Tokens', () => {
  it('Bearer-Token funktioniert ohne CSRF und ist einzeln widerrufbar', async () => {
    await createUser(t.app, 'alice');
    const token = await deviceLogin(t.app, 'alice');
    expect(token.startsWith('gsd_')).toBe(true);
    const auth = { authorization: `Bearer ${token}` };
    const patch = await t.app.inject({ method: 'PATCH', url: '/api/me', headers: auth, payload: { bio: 'vom Client' } });
    expect(patch.statusCode).toBe(200);

    const web = await login(t.app, 'alice');
    const sessions = (await web.req('GET', '/api/me/sessions')).json();
    const device = sessions.find((s: { kind: string }) => s.kind === 'DEVICE');
    expect(device.name).toBe('Test-PC');
    expect((await web.req('DELETE', `/api/me/sessions/${device.id}`)).statusCode).toBe(200);

    const after = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: auth });
    expect(after.statusCode).toBe(401);
    expect(after.json().error).toBe('invalid_token');
    // Web-Session bleibt gültig
    expect((await web.req('GET', '/api/auth/me')).json().user.username).toBe('alice');
  });

  it('Web-Cookie-Token wird nicht als Bearer akzeptiert', async () => {
    await createUser(t.app, 'alice');
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'alice', password: PASSWORD } });
    const sessionCookie = res.cookies.find((c) => c.name === 'gs_session')!.value;
    const bearer = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${sessionCookie}` } });
    expect(bearer.statusCode).toBe(401);
  });

  it('Device-Token kann aus Web-Session erzeugt werden', async () => {
    await createUser(t.app, 'alice');
    const web = await login(t.app, 'alice');
    const res = await web.req('POST', '/api/me/devices', { name: 'Steam Deck' });
    expect(res.statusCode).toBe(200);
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${res.json().token}` } });
    expect(me.json().user.username).toBe('alice');
  });
});

describe('Zwei-Faktor-Authentifizierung', () => {
  it('vollständiger TOTP-Ablauf inkl. Replay-Schutz und Recovery-Code', async () => {
    await createUser(t.app, 'alice');
    const c = await login(t.app, 'alice');
    const setup = (await c.req('POST', '/api/me/2fa/setup')).json();
    expect(setup.otpauthUrl).toContain('otpauth://totp/');
    expect((await c.req('POST', '/api/me/2fa/enable', { code: '000000' })).statusCode).toBe(400);
    // Code des vorherigen Fensters, damit der aktuelle beim Login noch unbenutzt ist
    const enable = await c.req('POST', '/api/me/2fa/enable', { code: totpAt(setup.secret, Date.now() - 30_000) });
    expect(enable.statusCode).toBe(200);
    const recovery: string[] = enable.json().recoveryCodes;
    expect(recovery).toHaveLength(10);

    const step1 = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'alice', password: PASSWORD } });
    expect(step1.json().mfaRequired).toBe(true);
    expect(step1.cookies.find((x) => x.name === 'gs_session')).toBeUndefined();
    const challengeToken = step1.json().challengeToken;

    const wrong = await t.app.inject({ method: 'POST', url: '/api/auth/login/2fa', payload: { challengeToken, code: '123456' } });
    expect(wrong.statusCode).toBe(401);
    const code = totpAt(setup.secret);
    const ok = await t.app.inject({ method: 'POST', url: '/api/auth/login/2fa', payload: { challengeToken, code } });
    expect(ok.statusCode).toBe(200);
    expect(cookieHeader(ok)).toContain('gs_session=');

    // Gleicher Code darf nicht erneut verwendet werden
    const step1b = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'alice', password: PASSWORD } });
    const replay = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login/2fa',
      payload: { challengeToken: step1b.json().challengeToken, code },
    });
    expect(replay.statusCode).toBe(401);
    // Recovery-Code funktioniert genau einmal
    const viaRecovery = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login/2fa',
      payload: { challengeToken: step1b.json().challengeToken, code: recovery[0].toLowerCase() },
    });
    expect(viaRecovery.statusCode).toBe(200);
    const step1c = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'alice', password: PASSWORD } });
    const reused = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login/2fa',
      payload: { challengeToken: step1c.json().challengeToken, code: recovery[0] },
    });
    expect(reused.statusCode).toBe(401);
  });

  it('Device-Login mit 2FA liefert Token nach zweitem Faktor', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    await createUser(t.app, 'alice', 'USER', { totpEnabled: true, totpSecret: secret });
    const step1 = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'alice', password: PASSWORD, device: { name: 'Laptop' } },
    });
    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login/2fa',
      payload: { challengeToken: step1.json().challengeToken, code: totpAt(secret) },
    });
    expect(ok.json().token).toMatch(/^gsd_/);
  });
});

describe('Passwort-Reset', () => {
  it('sendet Link per Mail und setzt Passwort, alte Sessions werden beendet', async () => {
    await createUser(t.app, 'alice');
    const c = await login(t.app, 'alice');
    t.app.ctx.mailer.outbox.length = 0;
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: 'alice@example.test' } });
    expect(res.statusCode).toBe(200);
    // Unbekannte Adresse → gleiche Antwort, keine Mail
    await t.app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: 'nobody@example.test' } });
    expect(t.app.ctx.mailer.outbox).toHaveLength(1);
    const token = /token=([^\s]+)/.exec(t.app.ctx.mailer.outbox[0].text)![1];
    const reset = await t.app.inject({
      method: 'POST',
      url: '/api/auth/password/reset',
      payload: { token: decodeURIComponent(token), password: 'ein-neues-passwort' },
    });
    expect(reset.statusCode).toBe(200);
    expect((await c.req('GET', '/api/auth/me')).json().user).toBeNull();
    await expect(login(t.app, 'alice', 'ein-neues-passwort')).resolves.toBeTruthy();
    const reuse = await t.app.inject({
      method: 'POST',
      url: '/api/auth/password/reset',
      payload: { token: decodeURIComponent(token), password: 'noch-ein-passwort' },
    });
    expect(reuse.statusCode).toBe(400);
  });
});

describe('Wartungsmodus', () => {
  it('blockiert Nutzer, aber nicht Admins und Login', async () => {
    await createUser(t.app, 'admin', 'ADMIN');
    await createUser(t.app, 'alice');
    await t.app.ctx.settings.update({ maintenanceMode: true });
    const alice = await login(t.app, 'alice');
    const blocked = await alice.req('GET', '/api/library');
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json().error).toBe('maintenance');
    const admin = await login(t.app, 'admin');
    expect((await admin.req('GET', '/api/library')).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/settings/public' })).json().maintenanceMode).toBe(true);
  });
});
