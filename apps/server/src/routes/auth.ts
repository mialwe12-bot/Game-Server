import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { SessionKind, User } from '@prisma/client';
import { z } from 'zod';
import type { AuthSuccess, LoginResponse, MeResponse } from '@gameserver/shared';
import type { AppContext } from '../context.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { badRequest, forbidden, HttpError, unauthorized } from '../lib/errors.js';
import { dummyVerify, hashPassword, verifyPassword } from '../lib/password.js';
import { verifyTotp } from '../lib/totp.js';
import { currentUser } from '../services/dto.js';
import { clearSessionCookies, createSession, setSessionCookies } from '../services/sessions.js';

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_.-]{3,32}$/, 'Benutzername: 3–32 Zeichen, nur Buchstaben, Ziffern, _ . -');
export const passwordSchema = z.string().min(10, 'Passwort muss mindestens 10 Zeichen haben').max(256);
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const deviceSchema = z.object({ name: z.string().trim().min(1).max(100) }).optional();

const OIDC_COOKIE = 'gs_oidc';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

export async function completeLogin(
  ctx: AppContext,
  req: FastifyRequest,
  reply: FastifyReply,
  user: User,
  kind: SessionKind,
  deviceName?: string | null,
): Promise<AuthSuccess> {
  const { token, session, csrfToken } = await createSession(ctx, user, kind, req, deviceName);
  await ctx.audit.log({ userId: user.id, action: kind === 'DEVICE' ? 'auth.device_login' : 'auth.login', ip: req.ip, target: deviceName ?? null });
  if (kind === 'WEB') {
    setSessionCookies(ctx, reply, token, csrfToken!, session.expiresAt);
    return { user: currentUser(user), csrfToken: csrfToken!, sessionId: session.id };
  }
  return { user: currentUser(user), token, sessionId: session.id };
}

/** Prüft TOTP- oder Recovery-Code und schützt vor Wiederverwendung. */
export async function checkSecondFactor(ctx: AppContext, user: User, code: string): Promise<boolean> {
  if (!user.totpEnabled || !user.totpSecret) return false;
  const counter = verifyTotp(user.totpSecret, code);
  if (counter !== null) {
    if (user.totpLastCounter !== null && counter <= user.totpLastCounter) return false;
    await ctx.db.user.update({ where: { id: user.id }, data: { totpLastCounter: counter } });
    return true;
  }
  const hashed = sha256Hex(code.trim().toUpperCase().replace(/[\s-]/g, ''));
  if (user.recoveryCodes.includes(hashed)) {
    await ctx.db.user.update({
      where: { id: user.id },
      data: { recoveryCodes: user.recoveryCodes.filter((c) => c !== hashed) },
    });
    await ctx.audit.log({ userId: user.id, action: 'auth.recovery_code_used' });
    return true;
  }
  return false;
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const authLimit = { rateLimit: { max: ctx.config.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } };

  app.get(
    '/me',
    { schema: { tags: ['auth'], summary: 'Aktueller Nutzer (oder null)' }, config: { allowInMaintenance: true } },
    async (req): Promise<MeResponse> => {
      if (!req.auth) return { user: null, csrfToken: null };
      return { user: currentUser(req.auth.user), csrfToken: req.auth.session.csrfToken };
    },
  );

  app.post(
    '/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Registrierung (abhängig vom Registrierungsmodus)',
        body: z.object({
          username: usernameSchema,
          email: emailSchema,
          password: passwordSchema,
          inviteCode: z.string().trim().max(64).optional(),
          locale: z.enum(['de', 'en']).optional(),
        }),
      },
      config: authLimit,
    },
    async (req, reply) => {
      const settings = await ctx.settings.get();
      const { username, email, password, inviteCode, locale } = req.body;
      if (settings.registrationMode === 'closed') throw forbidden('Registrierung ist geschlossen', 'registration_closed');

      const passwordHash = await hashPassword(password);
      const user = await ctx.db.$transaction(async (tx) => {
        let role: User['role'] = 'USER';
        let invitedById: string | null = null;
        if (inviteCode) {
          const invite = await tx.invite.findUnique({ where: { code: inviteCode.toUpperCase() } });
          const valid =
            invite && !invite.revoked && invite.uses < invite.maxUses && (!invite.expiresAt || invite.expiresAt > new Date());
          if (!valid) throw badRequest('Einladung ist ungültig oder abgelaufen', 'invalid_invite');
          const updated = await tx.invite.updateMany({
            where: { id: invite.id, uses: { lt: invite.maxUses } },
            data: { uses: { increment: 1 } },
          });
          if (updated.count === 0) throw badRequest('Einladung ist bereits aufgebraucht', 'invalid_invite');
          role = invite.role;
          invitedById = invite.id;
        } else if (settings.registrationMode === 'invite') {
          throw forbidden('Registrierung nur mit Einladung möglich', 'invite_required');
        }
        const taken = await tx.user.findFirst({
          where: { OR: [{ username: { equals: username, mode: 'insensitive' } }, { email }] },
        });
        if (taken) throw new HttpError(409, 'user_exists', 'Benutzername oder E-Mail ist bereits vergeben');
        return tx.user.create({
          data: { username, email, passwordHash, role, invitedById, locale: locale ?? 'de' },
        });
      });
      await ctx.audit.log({ userId: user.id, action: 'auth.register', ip: req.ip, meta: { invite: !!inviteCode } });
      return completeLogin(ctx, req, reply, user, 'WEB');
    },
  );

  app.get(
    '/invite/:code',
    { schema: { tags: ['auth'], summary: 'Einladung prüfen', params: z.object({ code: z.string().max(64) }) }, config: authLimit },
    async (req) => {
      const invite = await ctx.db.invite.findUnique({ where: { code: req.params.code.toUpperCase() } });
      const valid = !!invite && !invite.revoked && invite.uses < invite.maxUses && (!invite.expiresAt || invite.expiresAt > new Date());
      return { valid, role: valid ? invite!.role : null };
    },
  );

  app.post(
    '/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Anmeldung (Web: Cookie, mit "device": Device-Token für den Client)',
        body: z.object({ login: z.string().trim().min(1).max(254), password: z.string().min(1).max(256), device: deviceSchema }),
      },
      config: { ...authLimit, allowInMaintenance: true, skipCsrf: true },
    },
    async (req, reply): Promise<LoginResponse> => {
      const { login, password, device } = req.body;
      const user = await ctx.db.user.findFirst({
        where: { OR: [{ username: { equals: login, mode: 'insensitive' } }, { email: login.toLowerCase() }] },
      });
      if (!user || !user.passwordHash) {
        await dummyVerify(password);
        throw unauthorized('Benutzername oder Passwort falsch', 'invalid_credentials');
      }
      if (!(await verifyPassword(user.passwordHash, password))) {
        await ctx.audit.log({ userId: user.id, action: 'auth.login_failed', ip: req.ip });
        throw unauthorized('Benutzername oder Passwort falsch', 'invalid_credentials');
      }
      if (user.disabled) throw forbidden('Konto ist deaktiviert', 'account_disabled');
      const kind: SessionKind = device ? 'DEVICE' : 'WEB';
      if (user.totpEnabled) {
        const challengeToken = randomToken(32);
        await ctx.db.loginChallenge.create({
          data: {
            userId: user.id,
            tokenHash: sha256Hex(challengeToken),
            kind,
            deviceName: device?.name ?? null,
            expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
          },
        });
        return { mfaRequired: true, challengeToken };
      }
      return completeLogin(ctx, req, reply, user, kind, device?.name);
    },
  );

  app.post(
    '/login/2fa',
    {
      schema: {
        tags: ['auth'],
        summary: 'Zweiter Faktor (TOTP oder Recovery-Code)',
        body: z.object({ challengeToken: z.string().min(10).max(200), code: z.string().trim().min(6).max(32) }),
      },
      config: { ...authLimit, allowInMaintenance: true, skipCsrf: true },
    },
    async (req, reply) => {
      const challenge = await ctx.db.loginChallenge.findUnique({
        where: { tokenHash: sha256Hex(req.body.challengeToken) },
        include: { user: true },
      });
      if (!challenge || challenge.expiresAt < new Date() || challenge.attempts >= 5) {
        throw unauthorized('Anmeldung abgelaufen – bitte erneut anmelden', 'challenge_expired');
      }
      if (!(await checkSecondFactor(ctx, challenge.user, req.body.code))) {
        await ctx.db.loginChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
        throw unauthorized('Code ist ungültig', 'invalid_code');
      }
      await ctx.db.loginChallenge.delete({ where: { id: challenge.id } });
      return completeLogin(ctx, req, reply, challenge.user, challenge.kind, challenge.deviceName);
    },
  );

  app.post(
    '/logout',
    { schema: { tags: ['auth'], summary: 'Abmelden (widerruft die aktuelle Session bzw. das Device-Token)' }, config: { allowInMaintenance: true } },
    async (req, reply) => {
      if (req.auth) await ctx.db.session.deleteMany({ where: { id: req.auth.session.id } });
      clearSessionCookies(ctx, reply);
      return { ok: true };
    },
  );

  app.post(
    '/password/forgot',
    {
      schema: { tags: ['auth'], summary: 'Passwort-Reset per E-Mail anfordern', body: z.object({ email: emailSchema }) },
      config: { ...authLimit, skipCsrf: true },
    },
    async (req) => {
      const user = await ctx.db.user.findUnique({ where: { email: req.body.email } });
      if (user && !user.disabled && ctx.mailer.enabled) {
        const token = randomToken(32);
        await ctx.db.passwordResetToken.create({
          data: { userId: user.id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
        });
        const settings = await ctx.settings.get();
        const link = new URL(`/reset-password?token=${encodeURIComponent(token)}`, ctx.config.PUBLIC_URL).toString();
        const de = user.locale !== 'en';
        try {
          await ctx.mailer.send({
            to: user.email,
            subject: de ? `${settings.siteName}: Passwort zurücksetzen` : `${settings.siteName}: Reset your password`,
            text: de
              ? `Hallo ${user.username},\n\nüber folgenden Link kannst du ein neues Passwort setzen (1 Stunde gültig):\n${link}\n\nFalls du das nicht angefordert hast, ignoriere diese E-Mail.`
              : `Hi ${user.username},\n\nuse this link to set a new password (valid for 1 hour):\n${link}\n\nIf you didn't request this, ignore this email.`,
          });
          await ctx.audit.log({ userId: user.id, action: 'auth.password_reset_requested', ip: req.ip });
        } catch (err) {
          req.log.error({ err }, 'Passwort-Reset-Mail konnte nicht gesendet werden');
        }
      }
      // Immer gleiche Antwort, um keine Konten zu verraten
      return { ok: true };
    },
  );

  app.post(
    '/password/reset',
    {
      schema: {
        tags: ['auth'],
        summary: 'Neues Passwort mit Reset-Token setzen',
        body: z.object({ token: z.string().min(10).max(200), password: passwordSchema }),
      },
      config: { ...authLimit, skipCsrf: true },
    },
    async (req) => {
      const record = await ctx.db.passwordResetToken.findUnique({ where: { tokenHash: sha256Hex(req.body.token) } });
      if (!record || record.usedAt || record.expiresAt < new Date()) {
        throw badRequest('Link ist ungültig oder abgelaufen', 'invalid_token');
      }
      const passwordHash = await hashPassword(req.body.password);
      await ctx.db.$transaction([
        ctx.db.user.update({ where: { id: record.userId }, data: { passwordHash } }),
        ctx.db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
        ctx.db.session.deleteMany({ where: { userId: record.userId } }),
      ]);
      await ctx.audit.log({ userId: record.userId, action: 'auth.password_reset', ip: req.ip });
      return { ok: true };
    },
  );

  // ---- OpenID Connect ----

  app.get(
    '/oidc/start',
    {
      schema: { tags: ['auth'], summary: 'SSO-Anmeldung starten', querystring: z.object({ redirect: z.string().max(500).optional() }) },
      config: { allowInMaintenance: true },
    },
    async (req, reply) => {
      const { url, state, verifier } = await ctx.oidc.start();
      const redirect = req.query.redirect?.startsWith('/') && !req.query.redirect.startsWith('//') ? req.query.redirect : '/';
      reply.setCookie(OIDC_COOKIE, JSON.stringify({ state, verifier, redirect }), {
        path: '/api/auth/oidc',
        httpOnly: true,
        secure: ctx.config.COOKIE_SECURE,
        sameSite: 'lax',
        maxAge: 600,
        signed: false,
      });
      return reply.redirect(url);
    },
  );

  app.get(
    '/oidc/callback',
    { schema: { tags: ['auth'], summary: 'SSO-Callback', hide: true }, config: { allowInMaintenance: true } },
    async (req, reply) => {
      const fail = (code: string) => reply.redirect(new URL(`/login?error=${code}`, ctx.config.PUBLIC_URL).toString());
      const raw = req.cookies[OIDC_COOKIE];
      reply.clearCookie(OIDC_COOKIE, { path: '/api/auth/oidc' });
      if (!raw) return fail('oidc_state');
      let stored: { state: string; verifier: string; redirect: string };
      try {
        stored = JSON.parse(raw);
      } catch {
        return fail('oidc_state');
      }
      const current = new URL(req.url, ctx.config.PUBLIC_URL);
      let claims;
      try {
        claims = await ctx.oidc.callback(current, stored.state, stored.verifier);
      } catch (err) {
        req.log.warn({ err }, 'OIDC-Anmeldung fehlgeschlagen');
        return fail('oidc_failed');
      }
      let user = await ctx.db.user.findUnique({ where: { oidcSubject: claims.sub } });
      if (!user && claims.email && claims.emailVerified && ctx.config.OIDC_LINK_BY_EMAIL) {
        const byEmail = await ctx.db.user.findUnique({ where: { email: claims.email.toLowerCase() } });
        if (byEmail) user = await ctx.db.user.update({ where: { id: byEmail.id }, data: { oidcSubject: claims.sub } });
      }
      if (!user) {
        const settings = await ctx.settings.get();
        if (!ctx.config.OIDC_AUTO_REGISTER || settings.registrationMode === 'closed') return fail('oidc_no_account');
        if (!claims.email) return fail('oidc_no_email');
        if (await ctx.db.user.findUnique({ where: { email: claims.email.toLowerCase() } })) return fail('oidc_email_taken');
        const base = (claims.username ?? claims.email.split('@')[0]).replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 28) || 'user';
        let username = base.length >= 3 ? base : `${base}user`;
        for (let i = 2; await ctx.db.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } }); i++) {
          username = `${base}${i}`;
        }
        user = await ctx.db.user.create({
          data: {
            username,
            email: claims.email.toLowerCase(),
            displayName: claims.name ?? null,
            oidcSubject: claims.sub,
            role: ctx.config.OIDC_ADMIN_GROUP && claims.groups.includes(ctx.config.OIDC_ADMIN_GROUP) ? 'ADMIN' : 'USER',
          },
        });
        await ctx.audit.log({ userId: user.id, action: 'auth.register_oidc', ip: req.ip });
      } else if (ctx.config.OIDC_ADMIN_GROUP && claims.groups.includes(ctx.config.OIDC_ADMIN_GROUP) && user.role !== 'ADMIN') {
        user = await ctx.db.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
      }
      if (user.disabled) return fail('account_disabled');
      const settings = await ctx.settings.get();
      if (settings.maintenanceMode && user.role !== 'ADMIN') return fail('maintenance');
      await completeLogin(ctx, req, reply, user, 'WEB');
      return reply.redirect(new URL(stored.redirect || '/', ctx.config.PUBLIC_URL).toString());
    },
  );
};
