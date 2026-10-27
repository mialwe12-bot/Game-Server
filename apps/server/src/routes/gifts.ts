import { randomInt } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Game, Prisma, User } from '@prisma/client';
import type { ActivationCodeDto, GiftDto } from '@gameserver/shared';
import type { Db } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { requireAuth } from '../plugins/auth.js';
import { assertCanEditGame, canViewGame } from '../services/access.js';
import { gameRef } from '../services/achievements.js';
import { userPublic } from '../services/dto.js';
import { familyMemberIds } from '../services/family.js';
import { areFriends, assertNotBlocked } from '../services/social.js';

/** Zeichen ohne Verwechslungsgefahr (kein 0/O, 1/I/L) */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateCode(): string {
  const block = () => Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `${block()}-${block()}-${block()}`;
}

export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{5})(?=.)/g, '$1-');

/** Spiel in die Bibliothek legen; bei eingeschränkten Spielen zusätzlich Zugriff gewähren. */
async function grantGame(db: Db, userId: string, game: Game) {
  if (game.visibility === 'RESTRICTED') {
    await db.gameAccess.upsert({ where: { gameId_userId: { gameId: game.id, userId } }, create: { gameId: game.id, userId }, update: {} });
  }
  await db.libraryEntry.upsert({ where: { userId_gameId: { userId, gameId: game.id } }, create: { userId, gameId: game.id }, update: {} });
  await db.wishlistEntry.deleteMany({ where: { userId, gameId: game.id } });
}

/** Geschenke (Spiel an Freunde/Familie) und Aktivierungscodes. */
export const giftRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const { db } = ctx;

  const giftInclude = { game: true, from: true, to: true } satisfies Prisma.GiftInclude;
  const giftDto = (g: Prisma.GiftGetPayload<{ include: typeof giftInclude }>): GiftDto => ({
    id: g.id,
    game: gameRef(g.game),
    from: g.from ? userPublic(g.from) : null,
    to: userPublic(g.to),
    message: g.message,
    createdAt: g.createdAt.toISOString(),
    opened: !!g.openedAt,
  });

  app.get('/gifts', { schema: { tags: ['gifts'], summary: 'Erhaltene und gesendete Geschenke' } }, async (req) => {
    const { user } = requireAuth(req);
    const [received, sent] = await Promise.all([
      db.gift.findMany({ where: { toId: user.id }, include: giftInclude, orderBy: { createdAt: 'desc' }, take: 100 }),
      db.gift.findMany({ where: { fromId: user.id }, include: giftInclude, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    return { received: received.map(giftDto), sent: sent.map(giftDto) };
  });

  app.post(
    '/gifts',
    {
      schema: {
        tags: ['gifts'],
        summary: 'Spiel verschenken (an Freunde oder Familienmitglieder)',
        body: z.object({ gameId: z.string(), toUserId: z.string(), message: z.string().max(500).default('') }),
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req): Promise<GiftDto> => {
      const { user } = requireAuth(req);
      const s = await ctx.settings.get();
      if (!s.giftsEnabled) throw forbidden('Geschenke sind deaktiviert', 'gifts_disabled');
      const { gameId, toUserId, message } = req.body;
      if (toUserId === user.id) throw badRequest('Kein Geschenk an dich selbst', 'self');
      const to = await db.user.findUnique({ where: { id: toUserId } });
      if (!to || to.disabled) throw notFound('Nutzer nicht gefunden');
      await assertNotBlocked(db, user.id, to.id);
      const family = await familyMemberIds(db, user.id);
      if (!(await areFriends(db, user.id, to.id)) && !family.includes(to.id)) throw forbidden('Geschenke nur an Freunde oder Familie', 'not_friends');
      const game = await db.game.findUnique({ where: { id: gameId } });
      if (!game || game.visibility === 'HIDDEN' || !(await canViewGame(db, user, game))) throw notFound('Spiel nicht gefunden');
      // Der Empfänger muss das Spiel sehen dürfen (Altersfreigabe); eingeschränkte Spiele gibt der Schenkende frei
      const toFamily = await db.familyMember.findUnique({ where: { userId: to.id } });
      if (toFamily?.role === 'CHILD' && game.ageRating > toFamily.maxAgeRating) throw forbidden('Das Spiel ist für den Empfänger nicht freigegeben', 'age_restricted');
      if (await db.libraryEntry.findUnique({ where: { userId_gameId: { userId: to.id, gameId } } })) throw conflict('Der Empfänger besitzt das Spiel bereits', 'already_owned');
      if (await db.gift.findFirst({ where: { toId: to.id, gameId, openedAt: null } })) throw conflict('Dieses Spiel wurde bereits verschenkt', 'already_gifted');
      const gift = await db.gift.create({ data: { gameId, fromId: user.id, toId: to.id, message }, include: giftInclude });
      await ctx.notifications.notify(to.id, 'gift.received', { username: user.displayName ?? user.username, gameTitle: game.title, path: '/gifts' });
      return giftDto(gift);
    },
  );

  app.post('/gifts/:id/accept', { schema: { tags: ['gifts'], summary: 'Geschenk annehmen', params: z.object({ id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    const gift = await db.gift.findUnique({ where: { id: req.params.id }, include: giftInclude });
    if (!gift || gift.toId !== user.id) throw notFound('Geschenk nicht gefunden');
    if (gift.openedAt) throw badRequest('Bereits angenommen', 'already_opened');
    await grantGame(db, user.id, gift.game);
    await db.gift.update({ where: { id: gift.id }, data: { openedAt: new Date() } });
    await ctx.activity.record(user.id, 'library.added', { gift: 'true' }, gift.gameId);
    ctx.hub.toUser(user.id, { type: 'library.updated', data: { gameId: gift.gameId } });
    return giftDto({ ...gift, openedAt: new Date() });
  });

  app.delete('/gifts/:id', { schema: { tags: ['gifts'], summary: 'Geschenk ablehnen bzw. zurückziehen (solange nicht angenommen)', params: z.object({ id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    const gift = await db.gift.findUnique({ where: { id: req.params.id } });
    if (!gift || (gift.toId !== user.id && gift.fromId !== user.id)) throw notFound('Geschenk nicht gefunden');
    if (gift.openedAt) throw badRequest('Bereits angenommen', 'already_opened');
    await db.gift.delete({ where: { id: gift.id } });
    return { ok: true };
  });

  // ---- Aktivierungscodes ----

  app.post(
    '/codes/redeem',
    { schema: { tags: ['gifts'], summary: 'Aktivierungscode einlösen', body: z.object({ code: z.string().trim().min(5).max(40) }) }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { user } = requireAuth(req);
      const code = await db.activationCode.findUnique({ where: { code: normalizeCode(req.body.code) }, include: { game: true } });
      if (!code || code.revoked || (code.expiresAt && code.expiresAt < new Date()) || code.game.visibility === 'HIDDEN') {
        throw notFound('Code ungültig oder abgelaufen', 'invalid_code');
      }
      if (await db.codeRedemption.findUnique({ where: { codeId_userId: { codeId: code.id, userId: user.id } } })) throw conflict('Du hast diesen Code bereits eingelöst', 'already_redeemed');
      const fam = (user as User & { familyMember?: { role: string; maxAgeRating: number } | null }).familyMember;
      if (fam?.role === 'CHILD' && code.game.ageRating > fam.maxAgeRating) throw forbidden('Das Spiel ist für dich nicht freigegeben', 'age_restricted');
      const claimed = await db.activationCode.updateMany({ where: { id: code.id, uses: { lt: code.maxUses } }, data: { uses: { increment: 1 } } });
      if (!claimed.count) throw conflict('Der Code wurde bereits vollständig eingelöst', 'code_used');
      await db.codeRedemption.create({ data: { codeId: code.id, userId: user.id } });
      await grantGame(db, user.id, code.game);
      await ctx.audit.log({ userId: user.id, action: 'code.redeemed', target: code.gameId, meta: { batch: code.batch }, ip: req.ip });
      ctx.hub.toUser(user.id, { type: 'library.updated', data: { gameId: code.gameId } });
      return { game: gameRef(code.game) };
    },
  );

  const codeDto = (c: Prisma.ActivationCodeGetPayload<{ include: { game: true } }>): ActivationCodeDto => ({
    id: c.id,
    code: c.code,
    game: gameRef(c.game),
    batch: c.batch,
    note: c.note,
    maxUses: c.maxUses,
    uses: c.uses,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    revoked: c.revoked,
    createdAt: c.createdAt.toISOString(),
  });

  app.get(
    '/codes/manage/:gameId',
    { schema: { tags: ['gifts'], summary: 'Aktivierungscodes eines Spiels', params: z.object({ gameId: z.string() }), querystring: z.object({ batch: z.string().optional() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      await assertCanEditGame(db, user, req.params.gameId);
      const rows = await db.activationCode.findMany({
        where: { gameId: req.params.gameId, ...(req.query.batch ? { batch: req.query.batch } : {}) },
        include: { game: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });
      return rows.map(codeDto);
    },
  );

  app.post(
    '/codes/manage/:gameId',
    {
      schema: {
        tags: ['gifts'],
        summary: 'Aktivierungscodes erzeugen',
        params: z.object({ gameId: z.string() }),
        body: z.object({
          count: z.number().int().min(1).max(1000),
          batch: z.string().trim().max(60).default(''),
          note: z.string().max(200).default(''),
          maxUses: z.number().int().min(1).max(100_000).default(1),
          expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
        }),
      },
    },
    async (req) => {
      const { user } = requireAuth(req);
      await assertCanEditGame(db, user, req.params.gameId);
      const { count, batch, note, maxUses, expiresAt } = req.body;
      const codes = new Set<string>();
      while (codes.size < count) codes.add(generateCode());
      await db.activationCode.createMany({
        data: [...codes].map((code) => ({
          code,
          gameId: req.params.gameId,
          batch,
          note,
          maxUses,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          createdById: user.id,
        })),
        skipDuplicates: true,
      });
      await ctx.audit.log({ userId: user.id, action: 'codes.created', target: req.params.gameId, meta: { count, batch }, ip: req.ip });
      const rows = await db.activationCode.findMany({ where: { code: { in: [...codes] } }, include: { game: true } });
      return rows.map(codeDto);
    },
  );

  app.patch(
    '/codes/manage/:gameId/:id',
    { schema: { tags: ['gifts'], summary: 'Code sperren/entsperren', params: z.object({ gameId: z.string(), id: z.string() }), body: z.object({ revoked: z.boolean() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      await assertCanEditGame(db, user, req.params.gameId);
      const res = await db.activationCode.updateMany({ where: { id: req.params.id, gameId: req.params.gameId }, data: { revoked: req.body.revoked } });
      if (!res.count) throw notFound('Code nicht gefunden');
      await ctx.audit.log({ userId: user.id, action: 'code.revoked', target: req.params.id, meta: req.body, ip: req.ip });
      return { ok: true };
    },
  );

  app.get(
    '/codes/manage/:gameId/export',
    { schema: { tags: ['gifts'], summary: 'Codes als CSV', params: z.object({ gameId: z.string() }), querystring: z.object({ batch: z.string().optional() }) } },
    async (req, reply) => {
      const { user } = requireAuth(req);
      const game = await assertCanEditGame(db, user, req.params.gameId);
      const rows = await db.activationCode.findMany({ where: { gameId: game.id, ...(req.query.batch ? { batch: req.query.batch } : {}) }, orderBy: { createdAt: 'asc' } });
      const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const csv = ['code,batch,note,uses,max_uses,expires_at,revoked', ...rows.map((c) => [c.code, esc(c.batch), esc(c.note), c.uses, c.maxUses, c.expiresAt?.toISOString() ?? '', c.revoked].join(','))].join('\n');
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="codes-${game.slug}.csv"`)
        .send(csv + '\n');
    },
  );
};
