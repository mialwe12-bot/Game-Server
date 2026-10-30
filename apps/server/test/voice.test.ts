import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLivekitToken } from '../src/lib/livekit.js';
import { createTestApp, createUser, login, resetDb, type Client, type TestApp } from './helpers.js';

function decodeJwt(token: string) {
  const [h, p, s] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString()),
    sig: s,
    signingInput: `${h}.${p}`,
  };
}

describe('LiveKit-Token', () => {
  it('erzeugt ein signiertes JWT mit korrektem Grant', () => {
    const token = createLivekitToken({ apiKey: 'devkey', apiSecret: 'secret123', identity: 'u1', name: 'Bob', room: 'conv_x' });
    const { header, payload, sig, signingInput } = decodeJwt(token);
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(payload.iss).toBe('devkey');
    expect(payload.sub).toBe('u1');
    expect(payload.name).toBe('Bob');
    expect(payload.video).toMatchObject({ room: 'conv_x', roomJoin: true, canPublish: true, canSubscribe: true });
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(sig).toBe(createHmac('sha256', 'secret123').update(signingInput).digest('base64url'));
  });
});

describe('Voice-Token-Route (LiveKit)', () => {
  let t: TestApp;
  let admin: Client;
  let bob: Client;
  let carol: Client;
  let adminId: string;
  let convId: string;

  beforeEach(async () => {
    if (!t) t = await createTestApp({ LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret123' });
    else await resetDb(t.app);
    adminId = (await createUser(t.app, 'admin', 'ADMIN')).id;
    const bobId = (await createUser(t.app, 'bob')).id;
    await createUser(t.app, 'carol');
    admin = await login(t.app, 'admin');
    bob = await login(t.app, 'bob');
    carol = await login(t.app, 'carol');
    // Direkt-Konversation ohne Freundschaftsprüfung anlegen (für den Test)
    convId = (await t.app.ctx.chat.ensureDirect(bobId, adminId, bobId)).id;
  });

  afterAll(async () => {
    await t?.close();
  });

  const enableLivekit = () => admin.req('PATCH', '/api/admin/settings', { voiceEnabled: true, voiceBackend: 'LIVEKIT', livekitUrl: 'wss://voice.example' });

  it('liefert kein Token, solange LiveKit nicht konfiguriert ist', async () => {
    const res = await bob.req('GET', `/api/chat/voice/token?conversationId=${convId}`);
    expect(res.statusCode).toBe(403);
  });

  it('liefert ein Token für Mitglieder, wenn LiveKit aktiv ist', async () => {
    await enableLivekit();
    const res = await bob.req('GET', `/api/chat/voice/token?conversationId=${convId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBe('wss://voice.example');
    expect(body.room).toBe(`conv_${convId}`);
    expect(body.token.split('.')).toHaveLength(3);
    expect(decodeJwt(body.token).payload.sub).toBeTruthy();
  });

  it('verweigert Nicht-Mitgliedern das Token', async () => {
    await enableLivekit();
    const res = await carol.req('GET', `/api/chat/voice/token?conversationId=${convId}`);
    expect(res.statusCode).toBe(404);
  });

  it('config meldet das aktive Voice-Backend', async () => {
    await enableLivekit();
    const res = await bob.req('GET', '/api/chat/config');
    expect(res.statusCode).toBe(200);
    expect(res.json().voiceBackend).toBe('LIVEKIT');
    expect(res.json().livekitUrl).toBe('wss://voice.example');
  });
});
