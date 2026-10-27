import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionKind, User } from '@prisma/client';
import type { AppContext } from '../context.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { DAY_MS } from '../lib/time.js';

export const SESSION_COOKIE = 'gs_session';
export const CSRF_COOKIE = 'gs_csrf';
export const DEVICE_TOKEN_PREFIX = 'gsd_';

export async function createSession(
  ctx: AppContext,
  user: User,
  kind: SessionKind,
  req: FastifyRequest,
  name?: string | null,
) {
  const raw = randomToken(32);
  const token = kind === 'DEVICE' ? DEVICE_TOKEN_PREFIX + raw : raw;
  const csrfToken = kind === 'WEB' ? randomToken(24) : null;
  const ttlDays = kind === 'DEVICE' ? ctx.config.DEVICE_TTL_DAYS : ctx.config.SESSION_TTL_DAYS;
  const session = await ctx.db.session.create({
    data: {
      userId: user.id,
      kind,
      tokenHash: sha256Hex(token),
      csrfToken,
      name: name ?? null,
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 300) || null,
      ip: req.ip,
      expiresAt: new Date(Date.now() + ttlDays * DAY_MS),
    },
  });
  await ctx.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { token, session, csrfToken };
}

export function setSessionCookies(ctx: AppContext, reply: FastifyReply, token: string, csrfToken: string, expires: Date) {
  const base = { path: '/', secure: ctx.config.COOKIE_SECURE, sameSite: 'lax' as const, expires };
  reply.setCookie(SESSION_COOKIE, token, { ...base, httpOnly: true });
  reply.setCookie(CSRF_COOKIE, csrfToken, { ...base, httpOnly: false });
}

export function clearSessionCookies(ctx: AppContext, reply: FastifyReply) {
  const base = { path: '/', secure: ctx.config.COOKIE_SECURE, sameSite: 'lax' as const };
  reply.clearCookie(SESSION_COOKIE, base);
  reply.clearCookie(CSRF_COOKIE, base);
}

export function extractBearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}
