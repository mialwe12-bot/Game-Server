import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Role } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { hashPassword } from '../src/lib/password.js';
import { TEST_DATABASE_URL } from './global-setup.js';

export const PASSWORD = 'correct-horse-battery';

export interface TestApp {
  app: FastifyInstance;
  dataDir: string;
  close(): Promise<void>;
}

export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    DATA_DIR: dataDir,
    PUBLIC_URL: 'http://localhost:5173',
    AUTH_RATE_LIMIT_MAX: '10000',
    RATE_LIMIT_MAX: '100000',
    ...env,
  } as NodeJS.ProcessEnv);
  const app = await buildApp({ config });
  await app.ready();
  await resetDb(app);
  return {
    app,
    dataDir,
    async close() {
      await app.close();
      await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}

export async function resetDb(app: FastifyInstance) {
  const tables = await app.ctx.db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await app.ctx.db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  app.ctx.settings.invalidate();
}

export async function createUser(app: FastifyInstance, username: string, role: Role = 'USER', extra: Record<string, unknown> = {}) {
  return app.ctx.db.user.create({
    data: { username, email: `${username}@example.test`, passwordHash: await hashPassword(PASSWORD), role, ...extra },
  });
}

/** Eingeloggter Web-Client: setzt Cookie + CSRF-Header automatisch. */
export interface Client {
  cookie: string;
  csrf: string;
  userId: string;
  req(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<LightMyRequestResponse>;
}

export function cookieHeader(res: LightMyRequestResponse): string {
  return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export async function login(app: FastifyInstance, username: string, password = PASSWORD): Promise<Client> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: username, password } });
  if (res.statusCode !== 200) throw new Error(`Login fehlgeschlagen: ${res.body}`);
  const body = res.json();
  const cookie = cookieHeader(res);
  return {
    cookie,
    csrf: body.csrfToken,
    userId: body.user.id,
    req: (method, url, payload, headers = {}) =>
      app.inject({
        method: method as never,
        url,
        payload: payload as never,
        headers: { cookie, 'x-csrf-token': body.csrfToken, ...headers },
      }),
  };
}

export async function deviceLogin(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { login: username, password: PASSWORD, device: { name: 'Test-PC' } },
  });
  if (res.statusCode !== 200) throw new Error(res.body);
  return res.json().token;
}

/** Legt Spiel + Version + Build an und gibt die IDs zurück. */
export async function createGameWithBuild(
  c: Client,
  opts: { kind?: 'ZIP' | 'SEVEN_ZIP' | 'FOLDER' | 'INSTALLER'; platform?: 'WINDOWS' | 'LINUX' | 'MACOS'; title?: string } = {},
) {
  const game = (await c.req('POST', '/api/manage/games', { title: opts.title ?? 'Testspiel', genres: ['Action'], tags: ['Coop'] })).json();
  const version = (await c.req('POST', `/api/manage/games/${game.id}/versions`, { version: '1.0.0' })).json();
  const build = (
    await c.req('POST', `/api/manage/versions/${version.id}/builds`, {
      platform: opts.platform ?? 'LINUX',
      kind: opts.kind ?? 'FOLDER',
      executable: 'bin/game',
    })
  ).json();
  return { gameId: game.id as string, versionId: version.id as string, buildId: build.id as string };
}

export async function uploadFile(c: Client, buildId: string, filePath: string, data: Buffer, chunk = data.length) {
  const created = await c.req('POST', '/api/uploads', { buildId, path: filePath, size: data.length });
  if (created.statusCode !== 200) throw new Error(created.body);
  const id = created.json().id;
  let offset = created.json().offset as number;
  let last = created;
  while (offset < data.length) {
    last = await c.req('PATCH', `/api/uploads/${id}`, data.subarray(offset, offset + chunk), {
      'content-type': 'application/offset+octet-stream',
      'upload-offset': String(offset),
    });
    if (last.statusCode !== 200) throw new Error(last.body);
    offset = last.json().offset;
  }
  return last.json();
}

/** Veröffentlicht ein Spiel mit einem fertigen Build (Datei bin/game). */
export async function publishedGame(c: Client, title = 'Testspiel', extra: Record<string, unknown> = {}) {
  const ids = await createGameWithBuild(c, { title });
  await uploadFile(c, ids.buildId, 'bin/game', Buffer.from('#!/bin/sh\necho hi\n'));
  await c.req('PATCH', `/api/manage/builds/${ids.buildId}`, { status: 'READY' });
  await c.req('PATCH', `/api/manage/versions/${ids.versionId}`, { published: true });
  await c.req('PATCH', `/api/manage/games/${ids.gameId}`, { visibility: 'PUBLIC', ...extra });
  return ids;
}
