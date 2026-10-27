import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { User } from '@prisma/client';
import type { GroupDetail, GroupEventDto, GroupMemberDto, GroupSummary } from '@gameserver/shared';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { fileUrl, saveImageUpload } from '../lib/image-upload.js';
import { randomToken } from '../lib/crypto.js';
import { slugify } from '../lib/slug.js';
import { requireAuth } from '../plugins/auth.js';
import { canViewGame } from '../services/access.js';
import { userPublic } from '../services/dto.js';
import { activeMemberIds, assertModerator, canModerate, isActive, loadGroup, syncChannels, type GroupWithMe } from '../services/groups.js';
import { announcementDto, eventDto, groupCountInclude, groupSummary } from '../services/social-dto.js';
import { assertNotBlocked } from '../services/social.js';

const idParams = z.object({ id: z.string().max(100) });
const memberParams = z.object({ id: z.string(), userId: z.string() });
const groupBody = z.object({
  name: z.string().trim().min(2).max(80),
  summary: z.string().trim().max(300).default(''),
  description: z.string().max(20000).default(''),
  joinPolicy: z.enum(['OPEN', 'REQUEST', 'INVITE']).default('OPEN'),
  visibility: z.enum(['PUBLIC', 'HIDDEN']).default('PUBLIC'),
});
const eventBody = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(10000).default(''),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  gameId: z.string().nullable().optional(),
});

/** Gruppen mit Seite, Mitgliedern/Rollen, Ankündigungen, Events (mit Zusagen) und Chat-Kanälen. */
export const groupRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const { db } = ctx;

  async function uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    let slug = base;
    while (await db.group.findUnique({ where: { slug } })) slug = `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
    return slug;
  }

  async function detail(g: GroupWithMe, viewer: User | null): Promise<GroupDetail> {
    const full = await db.group.findUniqueOrThrow({
      where: { id: g.id },
      include: {
        ...groupCountInclude,
        announcements: { include: { author: true }, orderBy: { createdAt: 'desc' }, take: 5 },
        events: { where: { startsAt: { gte: new Date(Date.now() - 6 * 3600_000) } }, include: { game: true, rsvps: true }, orderBy: { startsAt: 'asc' }, take: 5 },
        channels: { where: { type: 'CHANNEL' }, orderBy: { createdAt: 'asc' } },
      },
    });
    const member = isActive(g.me);
    return {
      ...groupSummary(ctx.signer, full),
      description: full.description,
      bannerUrl: fileUrl(ctx.signer, full.bannerKey),
      createdAt: full.createdAt.toISOString(),
      myRole: g.me?.role ?? null,
      myStatus: g.me?.status ?? null,
      canManage: !!viewer && canModerate(g, viewer),
      announcements: full.announcements.map(announcementDto),
      upcomingEvents: full.events.map((e) => eventDto(e, viewer?.id ?? null)),
      channels: member || viewer?.role === 'ADMIN' ? full.channels.map((c) => ({ id: c.id, title: c.title ?? '' })) : [],
    };
  }

  async function notifyModerators(groupId: string, type: 'group.request', data: Record<string, string>) {
    const mods = await db.groupMember.findMany({ where: { groupId, status: 'ACTIVE', role: { in: ['OWNER', 'MODERATOR'] } } });
    for (const m of mods) await ctx.notifications.notify(m.userId, type, data);
  }

  async function activate(g: GroupWithMe, userId: string) {
    await db.groupMember.upsert({
      where: { groupId_userId: { groupId: g.id, userId } },
      create: { groupId: g.id, userId, status: 'ACTIVE' },
      update: { status: 'ACTIVE', joinedAt: new Date() },
    });
    await syncChannels(ctx, g.id);
    if (g.visibility === 'PUBLIC') await ctx.activity.record(userId, 'group.joined', { groupName: g.name, groupSlug: g.slug });
  }

  app.get(
    '/',
    {
      schema: {
        tags: ['groups'],
        summary: 'Gruppen (öffentliche bzw. eigene)',
        querystring: z.object({ q: z.string().trim().max(100).optional(), mine: z.coerce.boolean().optional() }),
      },
    },
    async (req): Promise<GroupSummary[]> => {
      const viewer = req.auth?.user ?? null;
      const { q, mine } = req.query;
      if (mine && !viewer) return [];
      const rows = await db.group.findMany({
        where: {
          ...(mine ? { members: { some: { userId: viewer!.id, status: { in: ['ACTIVE', 'INVITED', 'PENDING'] } } } } : { visibility: 'PUBLIC' }),
          ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { summary: { contains: q, mode: 'insensitive' } }] } : {}),
        },
        include: groupCountInclude,
        orderBy: mine ? { name: 'asc' } : { members: { _count: 'desc' } },
        take: 100,
      });
      return rows.map((g) => groupSummary(ctx.signer, g));
    },
  );

  app.post('/', { schema: { tags: ['groups'], summary: 'Gruppe gründen', body: groupBody } }, async (req): Promise<GroupDetail> => {
    const { user } = requireAuth(req);
    const group = await db.group.create({
      data: {
        ...req.body,
        slug: await uniqueSlug(req.body.name),
        createdById: user.id,
        members: { create: { userId: user.id, role: 'OWNER', status: 'ACTIVE' } },
        channels: { create: { type: 'CHANNEL', title: 'allgemein', createdById: user.id, members: { create: { userId: user.id, isAdmin: true } } } },
      },
    });
    if (group.visibility === 'PUBLIC') await ctx.activity.record(user.id, 'group.joined', { groupName: group.name, groupSlug: group.slug });
    return detail(await loadGroup(db, group.id, user), user);
  });

  app.get('/:id', { schema: { tags: ['groups'], summary: 'Gruppenseite (ID oder Slug)', params: idParams } }, async (req): Promise<GroupDetail> => {
    const viewer = req.auth?.user ?? null;
    return detail(await loadGroup(db, req.params.id, viewer), viewer);
  });

  app.patch('/:id', { schema: { tags: ['groups'], summary: 'Gruppe bearbeiten (Moderatoren)', params: idParams, body: groupBody.partial() } }, async (req) => {
    const { user } = requireAuth(req);
    const g = await loadGroup(db, req.params.id, user);
    assertModerator(g, user);
    const b = Object.fromEntries(Object.entries(req.body).filter(([, v]) => v !== undefined));
    await db.group.update({ where: { id: g.id }, data: b });
    return detail(await loadGroup(db, g.id, user), user);
  });

  app.delete('/:id', { schema: { tags: ['groups'], summary: 'Gruppe auflösen (Gründer/Admin)', params: idParams } }, async (req) => {
    const { user } = requireAuth(req);
    const g = await loadGroup(db, req.params.id, user);
    if (user.role !== 'ADMIN' && g.me?.role !== 'OWNER') throw forbidden('Nur der Gründer kann die Gruppe auflösen', 'not_owner');
    const members = await activeMemberIds(db, g.id);
    for (const key of [g.avatarKey, g.bannerKey]) if (key) await ctx.storage.remove(key).catch(() => undefined);
    await db.group.delete({ where: { id: g.id } });
    if (user.role === 'ADMIN' && g.me?.role !== 'OWNER') {
      await ctx.audit.log({ userId: user.id, action: 'group.delete', target: g.id, meta: { name: g.name }, ip: req.ip });
    }
    ctx.hub.toUsers(members, { type: 'chat.conversation', data: { conversationId: '' } });
    return { ok: true };
  });

  for (const kind of ['avatar', 'banner'] as const) {
    app.post(`/:id/${kind}`, { schema: { tags: ['groups'], summary: kind === 'avatar' ? 'Gruppenbild hochladen' : 'Banner hochladen', params: idParams } }, async (req) => {
      const { user } = requireAuth(req);
      const g = await loadGroup(db, req.params.id, user);
      assertModerator(g, user);
      const saved = await saveImageUpload(req, ctx.storage, `social/groups/${g.id}`, (kind === 'avatar' ? 2 : 8) * 1024 ** 2);
      const old = kind === 'avatar' ? g.avatarKey : g.bannerKey;
      if (old) await ctx.storage.remove(old).catch(() => undefined);
      await db.group.update({ where: { id: g.id }, data: kind === 'avatar' ? { avatarKey: saved.key } : { bannerKey: saved.key } });
      return detail(await loadGroup(db, g.id, user), user);
    });
  }

  // ---- Mitgliedschaft ----

  app.post('/:id/join', { schema: { tags: ['groups'], summary: 'Beitreten bzw. Beitritt anfragen / Einladung annehmen', params: idParams } }, async (req) => {
    const { user } = requireAuth(req);
    const g = await loadGroup(db, req.params.id, user);
    if (isActive(g.me)) return detail(g, user);
    if (g.me?.status === 'INVITED' || g.joinPolicy === 'OPEN') {
      await activate(g, user.id);
    } else if (g.joinPolicy === 'REQUEST') {
      if (!g.me) {
        await db.groupMember.create({ data: { groupId: g.id, userId: user.id, status: 'PENDING' } });
        await notifyModerators(g.id, 'group.request', { username: user.displayName ?? user.username, groupName: g.name, path: `/groups/${g.slug}` });
      }
    } else {
      throw forbidden('Beitritt nur auf Einladung', 'invite_only');
    }
    return detail(await loadGroup(db, g.id, user), user);
  });

  app.post('/:id/leave', { schema: { tags: ['groups'], summary: 'Gruppe verlassen / Anfrage zurückziehen / Einladung ablehnen', params: idParams } }, async (req) => {
    const { user } = requireAuth(req);
    const g = await loadGroup(db, req.params.id, user);
    if (!g.me) return { ok: true };
    if (g.me.role === 'OWNER' && g.me.status === 'ACTIVE') {
      const others = await db.groupMember.count({ where: { groupId: g.id, status: 'ACTIVE', userId: { not: user.id } } });
      if (others > 0) throw badRequest('Übertrage zuerst die Leitung an ein anderes Mitglied', 'owner_must_transfer');
      await db.group.delete({ where: { id: g.id } });
      return { ok: true };
    }
    await db.groupMember.delete({ where: { groupId_userId: { groupId: g.id, userId: user.id } } });
    await syncChannels(ctx, g.id);
    return { ok: true };
  });

  app.get(
    '/:id/members',
    { schema: { tags: ['groups'], summary: 'Mitglieder (Anfragen/Einladungen nur für Moderatoren)', params: idParams } },
    async (req): Promise<GroupMemberDto[]> => {
      const viewer = req.auth?.user ?? null;
      const g = await loadGroup(db, req.params.id, viewer);
      const mod = !!viewer && canModerate(g, viewer);
      const rows = await db.groupMember.findMany({
        where: { groupId: g.id, ...(mod ? {} : { status: 'ACTIVE' }) },
        include: { user: true },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        take: 1000,
      });
      return rows.filter((r) => !r.user.disabled).map((r) => ({ user: userPublic(r.user), role: r.role, status: r.status, joinedAt: r.joinedAt.toISOString() }));
    },
  );

  app.post(
    '/:id/invites',
    { schema: { tags: ['groups'], summary: 'Nutzer einladen (Mitglieder; bei „nur Einladung“ Moderatoren)', params: idParams, body: z.object({ userId: z.string() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const g = await loadGroup(db, req.params.id, user);
      if (!isActive(g.me) && user.role !== 'ADMIN') throw forbidden('Nur Mitglieder können einladen', 'not_member');
      if (g.joinPolicy === 'INVITE') assertModerator(g, user);
      const target = await db.user.findUnique({ where: { id: req.body.userId } });
      if (!target || target.disabled) throw notFound('Nutzer nicht gefunden');
      await assertNotBlocked(db, user.id, target.id);
      const existing = await db.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId: target.id } } });
      if (existing?.status === 'ACTIVE') throw conflict('Bereits Mitglied', 'already_member');
      if (existing?.status === 'PENDING') {
        // Offene Beitrittsanfrage → Einladung eines Moderators gilt als Zustimmung
        if (canModerate(g, user)) await activate(g, target.id);
        return { ok: true };
      }
      await db.groupMember.upsert({
        where: { groupId_userId: { groupId: g.id, userId: target.id } },
        create: { groupId: g.id, userId: target.id, status: 'INVITED' },
        update: {},
      });
      await ctx.notifications.notify(target.id, 'group.invite', { username: user.displayName ?? user.username, groupName: g.name, path: `/groups/${g.slug}` });
      return { ok: true };
    },
  );

  app.post('/:id/members/:userId/approve', { schema: { tags: ['groups'], summary: 'Beitrittsanfrage annehmen', params: memberParams } }, async (req) => {
    const { user } = requireAuth(req);
    const g = await loadGroup(db, req.params.id, user);
    assertModerator(g, user);
    const m = await db.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId: req.params.userId } } });
    if (!m || m.status !== 'PENDING') throw notFound('Anfrage nicht gefunden');
    await activate(g, m.userId);
    await ctx.notifications.notify(m.userId, 'group.accepted', { groupName: g.name, path: `/groups/${g.slug}` });
    return { ok: true };
  });

  app.delete('/:id/members/:userId', { schema: { tags: ['groups'], summary: 'Mitglied entfernen / Anfrage ablehnen / Einladung zurückziehen', params: memberParams } }, async (req) => {
    const { user } = requireAuth(req);
    const g = await loadGroup(db, req.params.id, user);
    assertModerator(g, user);
    const m = await db.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId: req.params.userId } } });
    if (!m) throw notFound('Mitglied nicht gefunden');
    if (m.role === 'OWNER') throw forbidden('Der Gründer kann nicht entfernt werden', 'is_owner');
    if (m.role === 'MODERATOR' && g.me?.role !== 'OWNER' && user.role !== 'ADMIN') throw forbidden('Nur der Gründer kann Moderatoren entfernen');
    await db.groupMember.delete({ where: { groupId_userId: { groupId: g.id, userId: m.userId } } });
    await syncChannels(ctx, g.id);
    return { ok: true };
  });

  app.patch(
    '/:id/members/:userId',
    {
      schema: {
        tags: ['groups'],
        summary: 'Rolle ändern (Gründer); OWNER überträgt die Leitung',
        params: memberParams,
        body: z.object({ role: z.enum(['OWNER', 'MODERATOR', 'MEMBER']) }),
      },
    },
    async (req) => {
      const { user } = requireAuth(req);
      const g = await loadGroup(db, req.params.id, user);
      if (g.me?.role !== 'OWNER' && user.role !== 'ADMIN') throw forbidden('Nur der Gründer kann Rollen vergeben', 'not_owner');
      const m = await db.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId: req.params.userId } } });
      if (!m || m.status !== 'ACTIVE') throw notFound('Mitglied nicht gefunden');
      if (req.body.role === 'OWNER') {
        await db.$transaction([
          db.groupMember.updateMany({ where: { groupId: g.id, role: 'OWNER' }, data: { role: 'MODERATOR' } }),
          db.groupMember.update({ where: { groupId_userId: { groupId: g.id, userId: m.userId } }, data: { role: 'OWNER' } }),
        ]);
      } else {
        if (m.role === 'OWNER') throw badRequest('Übertrage die Leitung, statt den Gründer herabzustufen', 'is_owner');
        await db.groupMember.update({ where: { groupId_userId: { groupId: g.id, userId: m.userId } }, data: { role: req.body.role } });
      }
      return { ok: true };
    },
  );

  // ---- Ankündigungen ----

  app.get('/:id/announcements', { schema: { tags: ['groups'], summary: 'Ankündigungen', params: idParams } }, async (req) => {
    const g = await loadGroup(db, req.params.id, req.auth?.user ?? null);
    const rows = await db.groupAnnouncement.findMany({ where: { groupId: g.id }, include: { author: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map(announcementDto);
  });

  app.post(
    '/:id/announcements',
    { schema: { tags: ['groups'], summary: 'Ankündigung veröffentlichen', params: idParams, body: z.object({ title: z.string().trim().min(1).max(160), body: z.string().max(20000) }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const g = await loadGroup(db, req.params.id, user);
      assertModerator(g, user);
      const a = await db.groupAnnouncement.create({ data: { groupId: g.id, authorId: user.id, ...req.body }, include: { author: true } });
      for (const id of await activeMemberIds(db, g.id)) {
        if (id !== user.id) await ctx.notifications.notify(id, 'group.announcement', { groupName: g.name, title: a.title, path: `/groups/${g.slug}` });
      }
      return announcementDto(a);
    },
  );

  app.delete('/:id/announcements/:aid', { schema: { tags: ['groups'], summary: 'Ankündigung löschen', params: z.object({ id: z.string(), aid: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    const g = await loadGroup(db, req.params.id, user);
    assertModerator(g, user);
    await db.groupAnnouncement.deleteMany({ where: { id: req.params.aid, groupId: g.id } });
    return { ok: true };
  });

  // ---- Events ----

  async function checkGame(user: User, gameId: string | null | undefined) {
    if (!gameId) return null;
    const game = await db.game.findUnique({ where: { id: gameId } });
    if (!game || !(await canViewGame(db, user, game))) throw notFound('Spiel nicht gefunden');
    return game.id;
  }

  app.get(
    '/:id/events',
    { schema: { tags: ['groups'], summary: 'Events', params: idParams, querystring: z.object({ past: z.coerce.boolean().optional() }) } },
    async (req): Promise<GroupEventDto[]> => {
      const viewer = req.auth?.user ?? null;
      const g = await loadGroup(db, req.params.id, viewer);
      const now = new Date();
      const rows = await db.groupEvent.findMany({
        where: { groupId: g.id, startsAt: req.query.past ? { lt: now } : { gte: new Date(now.getTime() - 6 * 3600_000) } },
        include: { game: true, rsvps: true },
        orderBy: { startsAt: req.query.past ? 'desc' : 'asc' },
        take: 100,
      });
      return rows.map((e) => eventDto(e, viewer?.id ?? null));
    },
  );

  app.post('/:id/events', { schema: { tags: ['groups'], summary: 'Event anlegen', params: idParams, body: eventBody } }, async (req): Promise<GroupEventDto> => {
    const { user } = requireAuth(req);
    const g = await loadGroup(db, req.params.id, user);
    assertModerator(g, user);
    const b = req.body;
    if (b.endsAt && new Date(b.endsAt) <= new Date(b.startsAt)) throw badRequest('Ende muss nach dem Beginn liegen', 'invalid_range');
    const e = await db.groupEvent.create({
      data: {
        groupId: g.id,
        title: b.title,
        description: b.description,
        startsAt: new Date(b.startsAt),
        endsAt: b.endsAt ? new Date(b.endsAt) : null,
        gameId: await checkGame(user, b.gameId),
        createdById: user.id,
        rsvps: { create: { userId: user.id, status: 'GOING' } },
      },
      include: { game: true, rsvps: true },
    });
    for (const id of await activeMemberIds(db, g.id)) {
      if (id !== user.id) await ctx.notifications.notify(id, 'event.created', { groupName: g.name, title: e.title, startsAt: e.startsAt.toISOString(), path: `/groups/${g.slug}` });
    }
    return eventDto(e, user.id);
  });

  app.patch(
    '/:id/events/:eventId',
    { schema: { tags: ['groups'], summary: 'Event bearbeiten', params: z.object({ id: z.string(), eventId: z.string() }), body: eventBody.partial() } },
    async (req): Promise<GroupEventDto> => {
      const { user } = requireAuth(req);
      const g = await loadGroup(db, req.params.id, user);
      assertModerator(g, user);
      const existing = await db.groupEvent.findFirst({ where: { id: req.params.eventId, groupId: g.id } });
      if (!existing) throw notFound('Event nicht gefunden');
      const b = req.body;
      const startsAt = b.startsAt ? new Date(b.startsAt) : existing.startsAt;
      const e = await db.groupEvent.update({
        where: { id: existing.id },
        data: {
          ...(b.title !== undefined ? { title: b.title } : {}),
          ...(b.description !== undefined ? { description: b.description } : {}),
          ...(b.startsAt ? { startsAt, reminded: startsAt.getTime() === existing.startsAt.getTime() ? existing.reminded : false } : {}),
          ...(b.endsAt !== undefined ? { endsAt: b.endsAt ? new Date(b.endsAt) : null } : {}),
          ...(b.gameId !== undefined ? { gameId: await checkGame(user, b.gameId) } : {}),
        },
        include: { game: true, rsvps: true },
      });
      return eventDto(e, user.id);
    },
  );

  app.delete('/:id/events/:eventId', { schema: { tags: ['groups'], summary: 'Event löschen', params: z.object({ id: z.string(), eventId: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    const g = await loadGroup(db, req.params.id, user);
    assertModerator(g, user);
    await db.groupEvent.deleteMany({ where: { id: req.params.eventId, groupId: g.id } });
    return { ok: true };
  });

  app.put(
    '/events/:eventId/rsvp',
    {
      schema: {
        tags: ['groups'],
        summary: 'Zusage zu einem Event (null = zurückziehen)',
        params: z.object({ eventId: z.string() }),
        body: z.object({ status: z.enum(['GOING', 'MAYBE', 'DECLINED']).nullable() }),
      },
    },
    async (req): Promise<GroupEventDto> => {
      const { user } = requireAuth(req);
      const event = await db.groupEvent.findUnique({ where: { id: req.params.eventId } });
      if (!event) throw notFound('Event nicht gefunden');
      const g = await loadGroup(db, event.groupId, user);
      if (!isActive(g.me)) throw forbidden('Nur Mitglieder können zusagen', 'not_member');
      const key = { eventId_userId: { eventId: event.id, userId: user.id } };
      if (req.body.status) {
        await db.groupEventRsvp.upsert({ where: key, create: { eventId: event.id, userId: user.id, status: req.body.status }, update: { status: req.body.status } });
      } else {
        await db.groupEventRsvp.deleteMany({ where: { eventId: event.id, userId: user.id } });
      }
      return eventDto(await db.groupEvent.findUniqueOrThrow({ where: { id: event.id }, include: { game: true, rsvps: true } }), user.id);
    },
  );

  // ---- Kanäle ----

  app.post(
    '/:id/channels',
    { schema: { tags: ['groups'], summary: 'Chat-Kanal anlegen', params: idParams, body: z.object({ title: z.string().trim().min(1).max(40) }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const g = await loadGroup(db, req.params.id, user);
      assertModerator(g, user);
      const count = await db.conversation.count({ where: { groupId: g.id, type: 'CHANNEL' } });
      if (count >= 20) throw badRequest('Höchstens 20 Kanäle pro Gruppe', 'too_many_channels');
      const title = req.body.title.toLowerCase().replace(/\s+/g, '-');
      const ch = await db.conversation.create({ data: { type: 'CHANNEL', groupId: g.id, title, createdById: user.id } });
      await syncChannels(ctx, g.id);
      return { id: ch.id, title };
    },
  );

  app.delete('/:id/channels/:channelId', { schema: { tags: ['groups'], summary: 'Chat-Kanal löschen', params: z.object({ id: z.string(), channelId: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    const g = await loadGroup(db, req.params.id, user);
    assertModerator(g, user);
    const count = await db.conversation.count({ where: { groupId: g.id, type: 'CHANNEL' } });
    if (count <= 1) throw badRequest('Der letzte Kanal kann nicht gelöscht werden', 'last_channel');
    const members = await activeMemberIds(db, g.id);
    await db.conversation.deleteMany({ where: { id: req.params.channelId, groupId: g.id, type: 'CHANNEL' } });
    ctx.hub.toUsers(members, { type: 'chat.conversation', data: { conversationId: req.params.channelId } });
    return { ok: true };
  });
};
