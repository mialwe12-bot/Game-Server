import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { FamilyDto, FamilyInviteDto, FamilyLibraryEntry } from '@gameserver/shared';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { requireAuth } from '../plugins/auth.js';
import { viewableWhere } from '../services/access.js';
import { gameSummary, gameSummaryInclude, userPublic } from '../services/dto.js';
import { parentalOf } from '../services/family.js';
import { assertNotBlocked } from '../services/social.js';

const familyInclude = {
  members: { include: { user: true }, orderBy: { joinedAt: 'asc' as const } },
  invites: { include: { user: true }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.FamilyGroupInclude;

const parentalBody = z.object({
  maxAgeRating: z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(16), z.literal(18)]).optional(),
  dailyMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  chatAllowed: z.boolean().optional(),
  communityAllowed: z.boolean().optional(),
});

/** Familiengruppe mit Familienbibliothek und Kindersicherung (Erwachsene verwalten Kinderkonten). */
export const familyRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const { db } = ctx;

  function dto(f: Prisma.FamilyGroupGetPayload<{ include: typeof familyInclude }>, viewerId: string): FamilyDto {
    return {
      id: f.id,
      name: f.name,
      members: f.members.map((m) => ({ user: userPublic(m.user), role: m.role, joinedAt: m.joinedAt.toISOString(), parental: parentalOf(m) })),
      invites: f.invites.map((i) => ({ id: i.id, user: userPublic(i.user), role: i.role, createdAt: i.createdAt.toISOString() })),
      myRole: f.members.find((m) => m.userId === viewerId)!.role,
    };
  }

  async function mine(userId: string) {
    const m = await db.familyMember.findUnique({ where: { userId } });
    if (!m) return null;
    return { member: m, family: await db.familyGroup.findUniqueOrThrow({ where: { id: m.familyId }, include: familyInclude }) };
  }

  async function adult(userId: string) {
    const f = await mine(userId);
    if (!f) throw notFound('Du bist in keiner Familie', 'no_family');
    if (f.member.role !== 'ADULT') throw forbidden('Nur Erwachsene können die Familie verwalten', 'not_adult');
    return f;
  }

  app.get('/', { schema: { tags: ['family'], summary: 'Eigene Familie' } }, async (req): Promise<FamilyDto | null> => {
    const { user } = requireAuth(req);
    const f = await mine(user.id);
    return f ? dto(f.family, user.id) : null;
  });

  app.post('/', { schema: { tags: ['family'], summary: 'Familie gründen', body: z.object({ name: z.string().trim().min(1).max(60) }) } }, async (req) => {
    const { user } = requireAuth(req);
    if (await mine(user.id)) throw conflict('Du bist bereits in einer Familie', 'already_in_family');
    const f = await db.familyGroup.create({ data: { name: req.body.name, members: { create: { userId: user.id, role: 'ADULT' } } }, include: familyInclude });
    return dto(f, user.id);
  });

  app.patch('/', { schema: { tags: ['family'], summary: 'Familie umbenennen', body: z.object({ name: z.string().trim().min(1).max(60) }) } }, async (req) => {
    const { user } = requireAuth(req);
    const f = await adult(user.id);
    return dto(await db.familyGroup.update({ where: { id: f.family.id }, data: { name: req.body.name }, include: familyInclude }), user.id);
  });

  app.post(
    '/invites',
    { schema: { tags: ['family'], summary: 'Mitglied einladen', body: z.object({ username: z.string().trim().min(1).max(64), role: z.enum(['ADULT', 'CHILD']) }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const f = await adult(user.id);
      const target = await db.user.findFirst({ where: { username: { equals: req.body.username, mode: 'insensitive' }, disabled: false } });
      if (!target) throw notFound('Nutzer nicht gefunden');
      if (target.id === user.id) throw badRequest('Du bist bereits Mitglied', 'self');
      await assertNotBlocked(db, user.id, target.id);
      if (await db.familyMember.findUnique({ where: { userId: target.id } })) throw conflict('Der Nutzer ist bereits in einer Familie', 'already_in_family');
      if (f.family.members.length + f.family.invites.length >= 12) throw badRequest('Höchstens 12 Mitglieder', 'family_full');
      await db.familyInvite.upsert({
        where: { familyId_userId: { familyId: f.family.id, userId: target.id } },
        create: { familyId: f.family.id, userId: target.id, role: req.body.role },
        update: { role: req.body.role },
      });
      await ctx.notifications.notify(target.id, 'family.invite', { username: user.displayName ?? user.username, familyName: f.family.name, path: '/family' });
      return dto((await mine(user.id))!.family, user.id);
    },
  );

  app.get('/invites', { schema: { tags: ['family'], summary: 'Eigene Familien-Einladungen' } }, async (req): Promise<FamilyInviteDto[]> => {
    const { user } = requireAuth(req);
    const rows = await db.familyInvite.findMany({
      where: { userId: user.id },
      include: { family: { include: { members: { where: { role: 'ADULT' }, include: { user: true } } } } },
    });
    return rows.map((i) => ({
      id: i.id,
      family: { id: i.family.id, name: i.family.name },
      role: i.role,
      invitedBy: i.family.members.map((m) => userPublic(m.user)),
      createdAt: i.createdAt.toISOString(),
    }));
  });

  app.post('/invites/:id/accept', { schema: { tags: ['family'], summary: 'Einladung annehmen', params: z.object({ id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    const inv = await db.familyInvite.findUnique({ where: { id: req.params.id } });
    if (!inv || inv.userId !== user.id) throw notFound('Einladung nicht gefunden');
    if (await mine(user.id)) throw conflict('Du bist bereits in einer Familie', 'already_in_family');
    await db.$transaction([
      db.familyMember.create({ data: { familyId: inv.familyId, userId: user.id, role: inv.role } }),
      db.familyInvite.deleteMany({ where: { userId: user.id } }),
    ]);
    return dto((await mine(user.id))!.family, user.id);
  });

  app.delete('/invites/:id', { schema: { tags: ['family'], summary: 'Einladung ablehnen bzw. zurückziehen', params: z.object({ id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    const inv = await db.familyInvite.findUnique({ where: { id: req.params.id } });
    if (!inv) throw notFound('Einladung nicht gefunden');
    if (inv.userId !== user.id) {
      const f = await adult(user.id);
      if (f.family.id !== inv.familyId) throw forbidden();
    }
    await db.familyInvite.delete({ where: { id: inv.id } });
    return { ok: true };
  });

  app.patch(
    '/members/:userId',
    {
      schema: {
        tags: ['family'],
        summary: 'Rolle und Kindersicherung eines Mitglieds ändern',
        params: z.object({ userId: z.string() }),
        body: parentalBody.extend({ role: z.enum(['ADULT', 'CHILD']).optional() }),
      },
    },
    async (req) => {
      const { user } = requireAuth(req);
      const f = await adult(user.id);
      const m = f.family.members.find((x) => x.userId === req.params.userId);
      if (!m) throw notFound('Mitglied nicht gefunden');
      const { role, ...parental } = req.body;
      if (role === 'CHILD' && m.role === 'ADULT' && f.family.members.filter((x) => x.role === 'ADULT').length <= 1) {
        throw badRequest('Die Familie braucht mindestens einen Erwachsenen', 'last_adult');
      }
      await db.familyMember.update({ where: { userId: m.userId }, data: { ...parental, ...(role ? { role } : {}) } });
      await ctx.audit.log({ userId: user.id, action: 'family.member.updated', target: m.userId, meta: req.body, ip: req.ip });
      return dto((await mine(user.id))!.family, user.id);
    },
  );

  app.delete('/members/:userId', { schema: { tags: ['family'], summary: 'Mitglied entfernen bzw. Familie verlassen', params: z.object({ userId: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    const f = await mine(user.id);
    if (!f) throw notFound('Du bist in keiner Familie', 'no_family');
    const self = req.params.userId === user.id;
    // Kinder können die Familie nicht selbst verlassen (sonst wäre die Kindersicherung wirkungslos)
    if (!self || f.member.role === 'CHILD') {
      if (f.member.role !== 'ADULT') throw forbidden('Nur Erwachsene können Mitglieder entfernen', 'not_adult');
    }
    const target = f.family.members.find((x) => x.userId === req.params.userId);
    if (!target) throw notFound('Mitglied nicht gefunden');
    const adults = f.family.members.filter((x) => x.role === 'ADULT');
    const rest = f.family.members.filter((x) => x.userId !== target.userId);
    if (target.role === 'ADULT' && adults.length <= 1 && rest.length > 0) {
      throw badRequest('Die Familie braucht mindestens einen Erwachsenen – erst Kinder entfernen oder einen Erwachsenen ernennen', 'last_adult');
    }
    if (rest.length === 0) await db.familyGroup.delete({ where: { id: f.family.id } });
    else await db.familyMember.delete({ where: { userId: target.userId } });
    await ctx.audit.log({ userId: user.id, action: 'family.member.removed', target: target.userId, ip: req.ip });
    return { ok: true };
  });

  app.get('/library', { schema: { tags: ['family'], summary: 'Familienbibliothek (Spiele der anderen Mitglieder)' } }, async (req): Promise<FamilyLibraryEntry[]> => {
    const { user } = requireAuth(req);
    const f = await mine(user.id);
    if (!f) return [];
    const others = f.family.members.filter((m) => m.userId !== user.id).map((m) => m.userId);
    const games = await db.game.findMany({
      where: { AND: [viewableWhere(user), { libraryEntries: { some: { userId: { in: others } } } }] },
      include: { ...gameSummaryInclude, libraryEntries: { where: { userId: { in: [...others, user.id] } }, include: { user: true } } },
      orderBy: { title: 'asc' },
    });
    return games.map((g) => ({
      game: gameSummary(g),
      owners: g.libraryEntries.filter((e) => e.userId !== user.id).map((e) => userPublic(e.user)),
      inMyLibrary: g.libraryEntries.some((e) => e.userId === user.id),
    }));
  });
};
