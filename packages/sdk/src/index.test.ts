import { describe, expect, it } from 'vitest';
import { GameServerSdk, SdkError } from './index.js';

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown } | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const result = (apiName: string, progress = 0) => ({ newlyUnlocked: true, achievement: { apiName, progress, unlocked: true } });

describe('GameServerSdk', () => {
  it('liest die Umgebung des Clients', () => {
    expect(GameServerSdk.fromEnv({})).toBeNull();
    const sdk = GameServerSdk.fromEnv({ GS_API_URL: 'https://games.example/', GS_GAME_TOKEN: 'gsg_x', GS_GAME_ID: 'g1' })!;
    expect(sdk.apiUrl).toBe('https://games.example');
    expect(sdk.gameId).toBe('g1');
    expect(GameServerSdk.fromUrl('https://x/index.html?gs_api=https://a&gs_token=gsg_y')?.apiUrl).toBe('https://a');
  });

  it('sendet Freischaltung und Fortschritt mit Spiel-Token', async () => {
    const { fn, calls } = fakeFetch((url) => ({ status: 200, body: result(url.includes('COLLECT') ? 'COLLECT' : 'WIN', 3) }));
    const sdk = new GameServerSdk({ apiUrl: 'https://g', token: 'gsg_t', fetch: fn });
    await sdk.unlock('WIN');
    await sdk.setProgress('COLLECT', 3.7);
    expect(calls[0].url).toBe('https://g/api/sdk/achievements/WIN/unlock');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer gsg_t');
    expect(calls[1].url).toBe('https://g/api/sdk/achievements/COLLECT/progress');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ progress: 3 });
  });

  it('merkt Meldungen offline vor und holt sie nach', async () => {
    let online = false;
    const { fn, calls } = fakeFetch((url) => (online ? { status: 200, body: result(url) } : new TypeError('fetch failed')));
    const sdk = new GameServerSdk({ apiUrl: 'https://g', token: 'gsg_t', fetch: fn });
    expect(await sdk.unlock('A')).toBeNull();
    expect(await sdk.setProgress('B', 2)).toBeNull();
    expect(await sdk.setProgress('B', 5)).toBeNull();
    expect(await sdk.setProgress('B', 4)).toBeNull();
    expect(sdk.pendingCount).toBe(2);
    online = true;
    expect(await sdk.flush()).toBe(2);
    expect(sdk.pendingCount).toBe(0);
    expect(JSON.parse(String(calls.at(-1)!.init.body))).toEqual({ progress: 5 });
  });

  it('wirft fachliche Fehler (unbekanntes Achievement, ungültiges Token)', async () => {
    const { fn } = fakeFetch(() => ({ status: 404, body: { error: 'achievement_not_found', message: 'nicht gefunden' } }));
    const sdk = new GameServerSdk({ apiUrl: 'https://g', token: 'gsg_t', fetch: fn });
    await expect(sdk.unlock('NOPE')).rejects.toBeInstanceOf(SdkError);
    expect(sdk.pendingCount).toBe(0);
  });
});
