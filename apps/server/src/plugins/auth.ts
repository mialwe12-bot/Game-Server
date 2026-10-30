import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Role } from '@prisma/client';
import type { AuthInfo } from '../context.js';
import { forbidden, HttpError, unauthorized } from '../lib/errors.js';
import { safeEqual, sha256Hex } from '../lib/crypto.js';
import { DAY_MS } from '../lib/time.js';
import { clearSessionCookies, extractBearer, SESSION_COOKIE } from '../services/sessions.js';

/** Präfix der Spiel-Tokens für das Achievement-SDK */
export const GAME_TOKEN_PREFIX = 'gsg_';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Löst die Anmeldung pro Request auf:
 *  - Web: httpOnly-Cookie + CSRF-Token (Header X-CSRF-Token) bei schreibenden Requests
 *  - Desktop-Client: "Authorization: Bearer gsd_…" (Device-Token, einzeln widerrufbar)
 */
export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req, reply) => {
    const { db, config } = app.ctx;
    const rawBearer = extractBearer(req);
    // Spiel-Tokens des Achievement-SDK (gsg_…) prüfen die SDK-Routen selbst
    const bearer = rawBearer?.startsWith(GAME_TOKEN_PREFIX) ? null : rawBearer;
    const cookie = rawBearer?.startsWith(GAME_TOKEN_PREFIX) ? undefined : req.cookies[SESSION_COOKIE];
    const token = bearer ?? cookie;
    if (!token) return;
    const session = await db.session.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: { include: { familyMember: true } } } });
    const expectedKind = bearer ? 'DEVICE' : 'WEB';
    if (!session || session.kind !== expectedKind || session.expiresAt < new Date() || session.user.disabled) {
      if (!bearer && cookie) clearSessionCookies(app.ctx, reply);
      if (bearer) throw unauthorized('Token ungültig oder widerrufen', 'invalid_token');
      return;
    }
    const { user, ...sess } = session;
    req.auth = { user, session: sess, via: bearer ? 'bearer' : 'cookie' };

    if (!bearer && !SAFE_METHODS.has(req.method) && !req.routeOptions.config?.skipCsrf) {
      const header = req.headers['x-csrf-token'];
      if (typeof header !== 'string' || !sess.csrfToken || !safeEqual(header, sess.csrfToken)) {
        throw new HttpError(403, 'csrf', 'CSRF-Token fehlt oder ist ungültig');
      }
    }

    if (Date.now() - sess.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      const ttl = (sess.kind === 'DEVICE' ? config.DEVICE_TTL_DAYS : config.SESSION_TTL_DAYS) * DAY_MS;
      await db.session.update({
        where: { id: sess.id },
        data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + ttl), ip: req.ip },
      });
    }
  });
});

export function requireAuth(req: FastifyRequest): AuthInfo {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): AuthInfo {
  const auth = requireAuth(req);
  if (!roles.includes(auth.user.role)) throw forbidden();
  return auth;
}

export const requireAdmin = (req: FastifyRequest) => requireRole(req, 'ADMIN');

/** Netzwerk-Admin: darf serverübergreifend (Fern-)Administration ausführen und weitere Netzwerk-Admins ernennen. */
export function requireNetworkAdmin(req: FastifyRequest): AuthInfo {
  const auth = requireAuth(req);
  if (!auth.user.networkAdmin) throw forbidden('Nur für Netzwerk-Admins', 'network_admin_required');
  return auth;
}
