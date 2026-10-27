import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SessionInfo, TotpSetup } from '@gameserver/shared';
import { readableCode, sha256Hex } from '../lib/crypto.js';
import { badRequest, HttpError, notFound, unauthorized } from '../lib/errors.js';
import { detectImage } from '../lib/images.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp.js';
import { requireAuth } from '../plugins/auth.js';
import { currentUser } from '../services/dto.js';
import { createSession } from '../services/sessions.js';
import { checkSecondFactor, passwordSchema } from './auth.js';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function newRecoveryCodes(): { plain: string[]; hashed: string[] } {
  const plain = Array.from({ length: 10 }, () => {
    const c = readableCode(10);
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
  return { plain, hashed: plain.map((c) => sha256Hex(c.replace('-', ''))) };
}

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;

  app.patch(
    '/',
    {
      schema: {
        tags: ['me'],
        summary: 'Profil bearbeiten',
        body: z.object({
          displayName: z.string().trim().max(64).nullable().optional(),
          bio: z.string().max(2000).nullable().optional(),
          locale: z.enum(['de', 'en']).optional(),
          email: z.string().trim().toLowerCase().email().max(254).optional(),
          currentPassword: z.string().max(256).optional(),
        }),
      },
    },
    async (req) => {
      const { user } = requireAuth(req);
      const { email, currentPassword, ...rest } = req.body;
      const data: Record<string, unknown> = { ...rest };
      if (email && email !== user.email) {
        if (user.passwordHash && !(await verifyPassword(user.passwordHash, currentPassword ?? ''))) {
          throw unauthorized('Aktuelles Passwort ist falsch', 'invalid_password');
        }
        if (await ctx.db.user.findUnique({ where: { email } })) throw new HttpError(409, 'email_taken', 'E-Mail ist bereits vergeben');
        data.email = email;
      }
      const updated = await ctx.db.user.update({ where: { id: user.id }, data });
      return currentUser(updated);
    },
  );

  app.post('/avatar', { schema: { tags: ['me'], summary: 'Avatar hochladen (PNG/JPEG/WebP/GIF, max. 2 MB)' } }, async (req) => {
    const { user } = requireAuth(req);
    const file = await req.file({ limits: { fileSize: MAX_AVATAR_BYTES } });
    if (!file) throw badRequest('Keine Datei', 'no_file');
    const data = await file.toBuffer();
    if (file.file.truncated) throw new HttpError(413, 'too_large', 'Avatar ist zu groß (max. 2 MB)');
    const type = detectImage(data);
    if (!type) throw badRequest('Nur PNG, JPEG, WebP, GIF oder AVIF erlaubt', 'invalid_image');
    const key = `avatars/${user.id}-${Date.now().toString(36)}.${type.ext}`;
    await ctx.storage.write(key, data);
    if (user.avatarKey) await ctx.storage.remove(user.avatarKey);
    const updated = await ctx.db.user.update({ where: { id: user.id }, data: { avatarKey: key } });
    return currentUser(updated);
  });

  app.delete('/avatar', { schema: { tags: ['me'], summary: 'Avatar entfernen' } }, async (req) => {
    const { user } = requireAuth(req);
    if (user.avatarKey) await ctx.storage.remove(user.avatarKey);
    return currentUser(await ctx.db.user.update({ where: { id: user.id }, data: { avatarKey: null } }));
  });

  app.post(
    '/password',
    {
      schema: {
        tags: ['me'],
        summary: 'Passwort ändern (meldet alle anderen Sessions ab)',
        body: z.object({ currentPassword: z.string().max(256).optional(), newPassword: passwordSchema }),
      },
      config: { rateLimit: { max: ctx.config.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { user, session } = requireAuth(req);
      if (user.passwordHash && !(await verifyPassword(user.passwordHash, req.body.currentPassword ?? ''))) {
        throw unauthorized('Aktuelles Passwort ist falsch', 'invalid_password');
      }
      await ctx.db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(req.body.newPassword) } });
      await ctx.db.session.deleteMany({ where: { userId: user.id, id: { not: session.id } } });
      await ctx.audit.log({ userId: user.id, action: 'auth.password_changed', ip: req.ip });
      return { ok: true };
    },
  );

  // ---- Sessions & Device-Tokens ----

  app.get('/sessions', { schema: { tags: ['me'], summary: 'Aktive Sessions und Geräte' } }, async (req): Promise<SessionInfo[]> => {
    const { user, session } = requireAuth(req);
    const sessions = await ctx.db.session.findMany({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      kind: s.kind,
      name: s.name,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === session.id,
    }));
  });

  app.delete(
    '/sessions/:id',
    { schema: { tags: ['me'], summary: 'Session/Device-Token widerrufen', params: z.object({ id: z.string() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const res = await ctx.db.session.deleteMany({ where: { id: req.params.id, userId: user.id } });
      if (res.count === 0) throw notFound('Session nicht gefunden');
      ctx.hub.toSession(req.params.id, { type: 'session.revoked', data: { sessionId: req.params.id } });
      await ctx.audit.log({ userId: user.id, action: 'auth.session_revoked', target: req.params.id, ip: req.ip });
      return { ok: true };
    },
  );

  app.delete('/sessions', { schema: { tags: ['me'], summary: 'Alle anderen Sessions widerrufen' } }, async (req) => {
    const { user, session } = requireAuth(req);
    const res = await ctx.db.session.deleteMany({ where: { userId: user.id, id: { not: session.id } } });
    await ctx.audit.log({ userId: user.id, action: 'auth.sessions_revoked', meta: { count: res.count }, ip: req.ip });
    return { revoked: res.count };
  });

  app.post(
    '/devices',
    {
      schema: {
        tags: ['me'],
        summary: 'Device-Token für einen Client erzeugen (z. B. für SSO-Nutzer)',
        body: z.object({ name: z.string().trim().min(1).max(100) }),
      },
    },
    async (req) => {
      const { user } = requireAuth(req);
      const { token, session } = await createSession(ctx, user, 'DEVICE', req, req.body.name);
      await ctx.audit.log({ userId: user.id, action: 'auth.device_token_created', target: req.body.name, ip: req.ip });
      return { token, sessionId: session.id };
    },
  );

  // ---- Zwei-Faktor-Authentifizierung (TOTP) ----

  app.post('/2fa/setup', { schema: { tags: ['me'], summary: '2FA einrichten: Secret erzeugen' } }, async (req): Promise<TotpSetup> => {
    const { user } = requireAuth(req);
    if (user.totpEnabled) throw badRequest('2FA ist bereits aktiv', 'totp_enabled');
    const secret = generateTotpSecret();
    await ctx.db.user.update({ where: { id: user.id }, data: { totpSecret: secret } });
    const settings = await ctx.settings.get();
    return { secret, otpauthUrl: otpauthUrl(secret, user.username, settings.siteName) };
  });

  app.post(
    '/2fa/enable',
    { schema: { tags: ['me'], summary: '2FA aktivieren', body: z.object({ code: z.string().trim().min(6).max(8) }) } },
    async (req) => {
      const { user } = requireAuth(req);
      if (user.totpEnabled) throw badRequest('2FA ist bereits aktiv', 'totp_enabled');
      if (!user.totpSecret) throw badRequest('Zuerst /2fa/setup aufrufen', 'totp_not_setup');
      const counter = verifyTotp(user.totpSecret, req.body.code);
      if (counter === null) throw badRequest('Code ist ungültig', 'invalid_code');
      const codes = newRecoveryCodes();
      await ctx.db.user.update({
        where: { id: user.id },
        data: { totpEnabled: true, totpLastCounter: counter, recoveryCodes: codes.hashed },
      });
      await ctx.audit.log({ userId: user.id, action: 'auth.2fa_enabled', ip: req.ip });
      return { recoveryCodes: codes.plain };
    },
  );

  app.post(
    '/2fa/disable',
    {
      schema: {
        tags: ['me'],
        summary: '2FA deaktivieren',
        body: z.object({ code: z.string().trim().min(6).max(32), password: z.string().max(256).optional() }),
      },
    },
    async (req) => {
      const { user } = requireAuth(req);
      if (!user.totpEnabled) throw badRequest('2FA ist nicht aktiv', 'totp_disabled');
      if (user.passwordHash && !(await verifyPassword(user.passwordHash, req.body.password ?? ''))) {
        throw unauthorized('Passwort ist falsch', 'invalid_password');
      }
      if (!(await checkSecondFactor(ctx, user, req.body.code))) throw badRequest('Code ist ungültig', 'invalid_code');
      await ctx.db.user.update({
        where: { id: user.id },
        data: { totpEnabled: false, totpSecret: null, totpLastCounter: null, recoveryCodes: [] },
      });
      await ctx.audit.log({ userId: user.id, action: 'auth.2fa_disabled', ip: req.ip });
      return { ok: true };
    },
  );

  app.post(
    '/2fa/recovery-codes',
    {
      schema: { tags: ['me'], summary: 'Neue Recovery-Codes erzeugen', body: z.object({ code: z.string().trim().min(6).max(32) }) },
    },
    async (req) => {
      const { user } = requireAuth(req);
      if (!(await checkSecondFactor(ctx, user, req.body.code))) throw badRequest('Code ist ungültig', 'invalid_code');
      const codes = newRecoveryCodes();
      await ctx.db.user.update({ where: { id: user.id }, data: { recoveryCodes: codes.hashed } });
      return { recoveryCodes: codes.plain };
    },
  );

  app.get('/upload-quota', { schema: { tags: ['me'], summary: 'Upload-Kontingent' } }, async (req) => {
    const { user } = requireAuth(req);
    return ctx.uploads.quotaFor(user);
  });
};
