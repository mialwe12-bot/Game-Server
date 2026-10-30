import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLivekitToken } from '../src/lib/livekit.js';
import { resolveVoiceServers, VoiceFailover, type ResolvedVoiceServer } from '../src/services/voice.js';
import { createTestApp, createUser, login, resetDb, type Client, type TestApp } from './helpers.js';

const env = { LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret123' };
const srv = (url: string, extra: Partial<ResolvedVoiceServer> = {}): ResolvedVoiceServer => ({
  name: url,
  url,
  apiKey: 'k',
  apiSecret: 's',
  ...extra,
});

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

describe('resolveVoiceServers', () => {
  it('fällt auf das alte Einzelfeld livekitUrl zurück und ergänzt Umgebungs-Zugangsdaten', () => {
    const list = resolveVoiceServers({ voiceServers: [], livekitUrl: 'wss://voice.example' }, env);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ url: 'wss://voice.example', apiKey: 'devkey', apiSecret: 'secret123', name: 'Primär' });
  });

  it('nutzt die Liste in Reihenfolge und ergänzt leere Zugangsdaten aus der Umgebung', () => {
    const list = resolveVoiceServers(
      {
        voiceServers: [
          { name: 'Main', url: 'wss://a' },
          { url: 'wss://b', apiKey: 'bk', apiSecret: 'bs' },
        ],
        livekitUrl: '',
      },
      env,
    );
    expect(list.map((s) => [s.name, s.url, s.apiKey, s.apiSecret])).toEqual([
      ['Main', 'wss://a', 'devkey', 'secret123'],
      ['Server 2', 'wss://b', 'bk', 'bs'],
    ]);
  });

  it('verwirft ungültige URLs und Einträge ohne auflösbare Zugangsdaten', () => {
    const list = resolveVoiceServers(
      { voiceServers: [{ url: 'http://no-ws' }, { url: 'wss://ok' }], livekitUrl: '' },
      { LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '' },
    );
    // http:// (kein ws) raus; wss://ok bleibt zwar URL-gültig, hat aber keine Zugangsdaten → ebenfalls raus
    expect(list).toHaveLength(0);
  });
});

describe('VoiceFailover', () => {
  it('nimmt bei einem einzigen Server keine Probe vor', async () => {
    const probe = vi.fn(async () => false);
    const fo = new VoiceFailover(probe, 0);
    const chosen = await fo.pick([srv('wss://only')]);
    expect(chosen?.url).toBe('wss://only');
    expect(probe).not.toHaveBeenCalled();
  });

  it('wählt den ersten erreichbaren Server (Primär bevorzugt)', async () => {
    const probe = vi.fn(async (url: string) => url === 'wss://a');
    const fo = new VoiceFailover(probe, 0);
    expect((await fo.pick([srv('wss://a'), srv('wss://b')]))?.url).toBe('wss://a');
  });

  it('springt auf den Fallback, wenn der Primär nicht erreichbar ist', async () => {
    const probe = vi.fn(async (url: string) => url === 'wss://b');
    const fo = new VoiceFailover(probe, 0);
    expect((await fo.pick([srv('wss://a'), srv('wss://b')]))?.url).toBe('wss://b');
  });

  it('nimmt den Primär (best effort), wenn kein Server erreichbar ist', async () => {
    const fo = new VoiceFailover(async () => false, 0);
    expect((await fo.pick([srv('wss://a'), srv('wss://b')]))?.url).toBe('wss://a');
  });

  it('liefert null für eine leere Liste', async () => {
    expect(await new VoiceFailover(async () => true).pick([])).toBeNull();
  });

  it('cacht den Erreichbarkeits-Status innerhalb des TTL', async () => {
    const probe = vi.fn(async () => true);
    const fo = new VoiceFailover(probe, 60_000);
    await fo.pick([srv('wss://a'), srv('wss://b')]);
    await fo.pick([srv('wss://a'), srv('wss://b')]);
    expect(probe).toHaveBeenCalledTimes(1); // wss://a nur einmal geprüft
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

  it('wählt bei mehreren Servern per Failover den ersten erreichbaren', async () => {
    await admin.req('PATCH', '/api/admin/settings', {
      voiceEnabled: true,
      voiceBackend: 'LIVEKIT',
      voiceServers: [
        { name: 'Main', url: 'wss://voice-1.example' },
        { name: 'Backup', url: 'wss://voice-2.example' },
      ],
    });
    // Erreichbarkeit mocken: Primär (1) aus, Fallback (2) an
    (t.app.ctx.chat as unknown as { voiceFailover: VoiceFailover }).voiceFailover = new VoiceFailover(
      async (url: string) => url === 'wss://voice-2.example',
      0,
    );
    const res = await bob.req('GET', `/api/chat/voice/token?conversationId=${convId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBe('wss://voice-2.example');
    expect(body.name).toBe('Backup');
  });

  it('maskiert die Voice-Server-Secrets in den Admin-Einstellungen', async () => {
    await admin.req('PATCH', '/api/admin/settings', {
      voiceServers: [{ name: 'Main', url: 'wss://voice-1.example', apiKey: 'k1', apiSecret: 'topsecret' }],
    });
    const res = await admin.req('GET', '/api/admin/settings');
    const server = res.json().voiceServers[0];
    expect(server.apiKey).toBe('k1');
    expect(server.apiSecret).toBe('********'); // Secret nie im Klartext an den Browser

    // Erneutes Speichern mit maskiertem Secret behält das bisherige Secret
    await admin.req('PATCH', '/api/admin/settings', {
      voiceServers: [{ name: 'Main umbenannt', url: 'wss://voice-1.example', apiKey: 'k1', apiSecret: '********' }],
    });
    // Token muss weiterhin mit dem echten Secret signiert sein
    await admin.req('PATCH', '/api/admin/settings', { voiceEnabled: true, voiceBackend: 'LIVEKIT' });
    const tok = await bob.req('GET', `/api/chat/voice/token?conversationId=${convId}`);
    const sig = tok.json().token.split('.');
    const signingInput = `${sig[0]}.${sig[1]}`;
    expect(sig[2]).toBe(createHmac('sha256', 'topsecret').update(signingInput).digest('base64url'));
  });
});
