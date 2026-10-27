import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FriendDto, FriendRequestDto, FriendsOverview, UserSearchResult } from '@gameserver/shared';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { requireAuth } from '../plugins/auth.js';
import { canViewGame } from '../services/access.js';
import { userPublic } from '../services/dto.js';
import { assertNotBlocked, relation } from '../services/social.js';

const userParams = z.object({ userId: z.string() });

/** Freunde, Freundschaftsanfragen, Blockieren, Nutzersuche, Präsenz und Spieleinladungen. */
export const friendRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;

  app.get('/friends', { schema: { tags: ['friends'], summary: 'Freunde, offene Anfragen und blockierte Nutzer' } }, async (req): Promise<FriendsOverview> => {
    const { user } = requireAuth(req);
    const [rows, blocks] = await Promise.all([
      ctx.db.friendship.findMany({
        where: { OR: [{ requesterId: user.id }, { addresseeId: user.id }] },
        include: { requester: true, addressee: true },
        orderBy: { createdAt: 'desc' },
      }),
      ctx.db.block.findMany({ where: { blockerId: user.id }, include: { blocked: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    const friends: FriendDto[] = [];
    const incoming: FriendRequestDto[] = [];
    const outgoing: FriendRequestDto[] = [];
    for (const f of rows) {
      const other = f.requesterId === user.id ? f.addressee : f.requester;
      if (other.disabled) continue;
      if (f.status === 'ACCEPTED') {
        friends.push({ user: userPublic(other), presence: await ctx.presence.presence(other), since: (f.acceptedAt ?? f.createdAt).toISOString() });
      } else {
        const dto: FriendRequestDto = {
          id: f.id,
          user: userPublic(other),
          direction: f.requesterId === user.id ? 'outgoing' : 'incoming',
          createdAt: f.createdAt.toISOString(),
        };
        (dto.direction === 'incoming' ? incoming : outgoing).push(dto);
      }
    }
    // Online zuerst, dann spielend, dann alphabetisch
    friends.sort(
      (a, b) =>
        Number(b.presence.online) - Number(a.presence.online) ||
        Number(!!b.presence.game) - Number(!!a.presence.game) ||
        (a.user.displayName ?? a.user.username).localeCompare(b.user.displayName ?? b.user.username, undefined, { sensitivity: 'base' }),
    );
    return { friends, incoming, outgoing, blocked: blocks.map((b) => userPublic(b.blocked)) };
  });

  app.get(
    '/users/search',
    { schema: { tags: ['friends'], summary: 'Nutzer suchen', querystring: z.object({ q: z.string().trim().min(2).max(64) }) } },
    async (req): Promise<UserSearchResult[]> => {
      const { user } = requireAuth(req);
      const q = req.query.q;
      const users = await ctx.db.user.findMany({
        where: {
          disabled: false,
          id: { not: user.id },
          OR: [{ username: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }],
          // Wer mich blockiert hat, taucht nicht auf
          blocking: { none: { blockedId: user.id } },
        },
        orderBy: { username: 'asc' },
        take: 20,
      });
      return Promise.all(users.map(async (u) => ({ user: userPublic(u), relation: await relation(ctx.db, user.id, u.id) })));
    },
  );

  app.post(
    '/friends/requests',
    { schema: { tags: ['friends'], summary: 'Freundschaftsanfrage senden', body: z.object({ username: z.string().trim().min(1).max(64) }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const target = await ctx.db.user.findFirst({ where: { username: { equals: req.body.username, mode: 'insensitive' }, disabled: false } });
      if (!target) throw notFound('Nutzer nicht gefunden');
      if (target.id === user.id) throw badRequest('Du kannst dich nicht selbst hinzufügen', 'self');
      await assertNotBlocked(ctx.db, user.id, target.id);
      const existing = await ctx.db.friendship.findFirst({
        where: { OR: [{ requesterId: user.id, addresseeId: target.id }, { requesterId: target.id, addresseeId: user.id }] },
      });
      if (existing?.status === 'ACCEPTED') throw conflict('Ihr seid bereits befreundet', 'already_friends');
      if (existing && existing.requesterId === user.id) throw conflict('Anfrage wurde bereits gesendet', 'already_requested');
      if (existing) {
        // Gegenseitige Anfrage → direkt annehmen
        await acceptFriendship(existing.id, user.id, target.id);
        return { status: 'friends' as const };
      }
      if (!target.allowFriendRequests) throw forbidden('Dieser Nutzer nimmt keine Freundschaftsanfragen an', 'requests_disabled');
      await ctx.db.friendship.create({ data: { requesterId: user.id, addresseeId: target.id } });
      await ctx.notifications.notify(target.id, 'friend.request', { username: user.displayName ?? user.username, userId: user.id, path: '/friends' });
      ctx.hub.toUsers([user.id, target.id], { type: 'friends.changed', data: {} });
      return { status: 'outgoing' as const };
    },
  );

  async function acceptFriendship(id: string, accepterId: string, requesterId: string) {
    await ctx.db.friendship.update({ where: { id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    const accepter = await ctx.db.user.findUniqueOrThrow({ where: { id: accepterId } });
    const requester = await ctx.db.user.findUniqueOrThrow({ where: { id: requesterId } });
    await ctx.notifications.notify(requesterId, 'friend.accepted', { username: accepter.displayName ?? accepter.username, userId: accepterId, path: `/u/${accepter.username}` });
    await ctx.activity.record(accepterId, 'friend.added', { username: requester.username, displayName: requester.displayName ?? requester.username });
    await ctx.activity.record(requesterId, 'friend.added', { username: accepter.username, displayName: accepter.displayName ?? accepter.username });
    ctx.hub.toUsers([accepterId, requesterId], { type: 'friends.changed', data: {} });
  }

  app.post(
    '/friends/requests/:id/accept',
    { schema: { tags: ['friends'], summary: 'Anfrage annehmen', params: z.object({ id: z.string() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const f = await ctx.db.friendship.findUnique({ where: { id: req.params.id } });
      if (!f || f.addresseeId !== user.id || f.status !== 'PENDING') throw notFound('Anfrage nicht gefunden');
      await acceptFriendship(f.id, user.id, f.requesterId);
      return { ok: true };
    },
  );

  app.delete(
    '/friends/requests/:id',
    { schema: { tags: ['friends'], summary: 'Anfrage ablehnen bzw. zurückziehen', params: z.object({ id: z.string() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const f = await ctx.db.friendship.findUnique({ where: { id: req.params.id } });
      if (!f || f.status !== 'PENDING' || (f.addresseeId !== user.id && f.requesterId !== user.id)) throw notFound('Anfrage nicht gefunden');
      await ctx.db.friendship.delete({ where: { id: f.id } });
      ctx.hub.toUsers([f.requesterId, f.addresseeId], { type: 'friends.changed', data: {} });
      return { ok: true };
    },
  );

  app.delete('/friends/:userId', { schema: { tags: ['friends'], summary: 'Freundschaft beenden', params: userParams } }, async (req) => {
    const { user } = requireAuth(req);
    const other = req.params.userId;
    await ctx.db.friendship.deleteMany({
      where: { OR: [{ requesterId: user.id, addresseeId: other }, { requesterId: other, addresseeId: user.id }] },
    });
    ctx.hub.toUsers([user.id, other], { type: 'friends.changed', data: {} });
    return { ok: true };
  });

  app.post('/blocks/:userId', { schema: { tags: ['friends'], summary: 'Nutzer blockieren', params: userParams } }, async (req) => {
    const { user } = requireAuth(req);
    const other = req.params.userId;
    if (other === user.id) throw badRequest('Du kannst dich nicht selbst blockieren', 'self');
    const target = await ctx.db.user.findUnique({ where: { id: other } });
    if (!target) throw notFound('Nutzer nicht gefunden');
    await ctx.db.$transaction([
      ctx.db.block.upsert({ where: { blockerId_blockedId: { blockerId: user.id, blockedId: other } }, create: { blockerId: user.id, blockedId: other }, update: {} }),
      ctx.db.friendship.deleteMany({ where: { OR: [{ requesterId: user.id, addresseeId: other }, { requesterId: other, addresseeId: user.id }] } }),
    ]);
    ctx.hub.toUsers([user.id, other], { type: 'friends.changed', data: {} });
    return { ok: true };
  });

  app.delete('/blocks/:userId', { schema: { tags: ['friends'], summary: 'Blockierung aufheben', params: userParams } }, async (req) => {
    const { user } = requireAuth(req);
    await ctx.db.block.deleteMany({ where: { blockerId: user.id, blockedId: req.params.userId } });
    ctx.hub.toUser(user.id, { type: 'friends.changed', data: {} });
    return { ok: true };
  });

  app.put(
    '/presence',
    {
      schema: {
        tags: ['friends'],
        summary: 'Laufendes Spiel melden (Desktop-Client; null = keins)',
        body: z.object({ gameId: z.string().nullable() }),
      },
    },
    async (req) => {
      const { user } = requireAuth(req);
      let gameId = req.body.gameId;
      if (gameId) {
        const game = await ctx.db.game.findUnique({ where: { id: gameId } });
        if (!game || !(await canViewGame(ctx.db, user, game))) gameId = null;
      }
      ctx.hub.setGame(user.id, gameId);
      return { ok: true };
    },
  );

  app.post(
    '/friends/:userId/invite',
    { schema: { tags: ['friends'], summary: 'Freund zu einem Spiel einladen', params: userParams, body: z.object({ gameId: z.string() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const friend = await ctx.db.friendship.findFirst({
        where: { status: 'ACCEPTED', OR: [{ requesterId: user.id, addresseeId: req.params.userId }, { requesterId: req.params.userId, addresseeId: user.id }] },
      });
      if (!friend) throw forbidden('Nur Freunde können eingeladen werden', 'not_friends');
      const game = await ctx.db.game.findUnique({ where: { id: req.body.gameId } });
      const target = await ctx.db.user.findUnique({ where: { id: req.params.userId } });
      if (!game || !target || !(await canViewGame(ctx.db, target, game))) throw notFound('Spiel nicht gefunden');
      await ctx.notifications.notify(target.id, 'game.invite', {
        username: user.displayName ?? user.username,
        userId: user.id,
        gameId: game.id,
        gameTitle: game.title,
        path: `/game/${game.slug}`,
      });
      return { ok: true };
    },
  );
};
