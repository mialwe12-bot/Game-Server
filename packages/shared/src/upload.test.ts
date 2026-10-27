import { describe, expect, it } from 'vitest';
import { ApiClient } from './api.js';
import { ResumableUpload, type UploadProgress } from './upload.js';
import { formatBytes, trailerEmbed } from './format.js';

/** Minimaler Fake-Server für das Upload-Protokoll. */
function fakeServer(opts: { failEvery?: number } = {}) {
  let data = new Uint8Array(0);
  let size = 0;
  let calls = 0;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const dto = () => ({ id: 'u1', buildId: 'b', path: 'f', size, offset: data.length, status: data.length === size ? 'COMPLETED' : 'ACTIVE' });
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.endsWith('/api/uploads')) {
      size = JSON.parse(String(init!.body)).size;
      return json({ ...dto(), chunkSize: 1000 });
    }
    if (method === 'GET') return json(dto());
    if (method === 'PATCH') {
      calls++;
      if (opts.failEvery && calls % opts.failEvery === 0) throw new TypeError('Netzwerkfehler');
      const offset = Number((init!.headers as Record<string, string>)['Upload-Offset']);
      if (offset !== data.length) return json({ error: 'offset_mismatch', message: 'x', details: { offset: data.length } }, 409);
      const chunk = new Uint8Array(await (init!.body as Blob).arrayBuffer());
      const next = new Uint8Array(data.length + chunk.length);
      next.set(data);
      next.set(chunk, data.length);
      data = next;
      return json(dto());
    }
    return json({}, 404);
  };
  return { fetchImpl: fetchImpl as typeof fetch, received: () => data };
}

const payload = new Uint8Array(4500).map((_, i) => i % 256);

describe('ResumableUpload', () => {
  it('lädt in Chunks hoch und meldet Fortschritt', async () => {
    const server = fakeServer();
    const api = new ApiClient({ baseUrl: 'http://x', token: 't', fetch: server.fetchImpl });
    const progress: UploadProgress[] = [];
    const up = new ResumableUpload(api, new Blob([payload]), { buildId: 'b', path: 'f', onProgress: (p) => progress.push(p) });
    await up.start();
    expect(up.progress.state).toBe('completed');
    expect(Buffer.from(server.received()).equals(Buffer.from(payload))).toBe(true);
    expect(progress.map((p) => p.uploaded)).toContain(3000);
  });

  it('wiederholt nach Netzwerkfehlern und setzt am Server-Offset fort', async () => {
    const server = fakeServer({ failEvery: 2 });
    const api = new ApiClient({ baseUrl: 'http://x', token: 't', fetch: server.fetchImpl });
    const up = new ResumableUpload(api, new Blob([payload]), { buildId: 'b', path: 'f', maxRetries: 3 });
    // Backoff abkürzen
    const origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => origSetTimeout(fn, 0)) as typeof setTimeout;
    try {
      await up.start();
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
    expect(up.progress.state).toBe('completed');
    expect(server.received().length).toBe(payload.length);
  });

  it('Pause und Fortsetzen', async () => {
    const server = fakeServer();
    const api = new ApiClient({ baseUrl: 'http://x', token: 't', fetch: server.fetchImpl });
    let up!: ResumableUpload;
    let paused = false;
    up = new ResumableUpload(api, new Blob([payload]), {
      buildId: 'b',
      path: 'f',
      onProgress: (p) => {
        if (!paused && p.uploaded >= 2000 && p.state === 'uploading') {
          paused = true;
          up.pause();
        }
      },
    });
    await up.start();
    expect(up.progress.state).toBe('paused');
    expect(server.received().length).toBeLessThan(payload.length);
    await up.resume();
    expect(up.progress.state).toBe('completed');
    expect(Buffer.from(server.received()).equals(Buffer.from(payload))).toBe(true);
  });
});

describe('Formatierung', () => {
  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 3, 'en')).toBe('5 GB');
  });
  it('trailerEmbed', () => {
    expect(trailerEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      type: 'youtube',
      src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    });
    expect(trailerEmbed('https://cdn.example.com/t.mp4')?.type).toBe('video');
    expect(trailerEmbed('javascript:alert(1)')).toBeNull();
  });
});
