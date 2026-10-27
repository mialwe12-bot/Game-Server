import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Activity, Game, GameMedia, User } from '@prisma/client';
import type { ActivityDto, ActivityType, NotificationDto } from '@gameserver/shared';
import { forbidden } from '../lib/errors.js';
import { sendStoredFile } from '../lib/image-upload.js';
import { requireAuth } from '../plugins/auth.js';
import { viewableWhere } from '../services/access.js';
import { mediaUrl, userPublic } from '../services/dto.js';
import { notificationDto } from '../services/notify.js';
import { friendIds } from '../services/social.js';

type ActivityRow = Activity & { user: User; game: (Game & { media: GameMedia[] }) | null };

export const activityInclude = {
  user: true,
  game: { include: { media: { where: { kind: 'COVER' as const }, take: 1 } } },
};

export function activityDto(a: ActivityRow): ActivityDto {
  return {
    id: a.id,
    user: userPublic(a.user),
    type: a.type as ActivityType,
    data: (a.data ?? {}) as Record<string, string>,
    game: a.game
      ? { id: a.game.id, slug: a.game.slug, title: a.game.title, coverUrl: a.game.media[0] ? mediaUrl(a.game.media[0]) : null }
      : null,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Benachrichtigungen, Aktivitäts-Feed und signierte Nutzerdateien. */
export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;

  app.get(
    '/notifications',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Benachrichtigungen (neueste zuerst)',
        querystring: z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }),
      },
    },
    async (req): Promise<{ items: NotificationDto[]; unread: number }> => {
      const { user } = requireAuth(req);
      const { before, limit } = req.query;
      const [rows, unread] = await Promise.all([
        ctx.db.notification.findMany({
          where: { userId: user.id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        ctx.db.notification.count({ where: { userId: user.id, readAt: null } }),
      ]);
      return { items: rows.map(notificationDto), unread };
    },
  );

  app.post(
    '/notifications/read',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Als gelesen markieren (ohne IDs = alle)',
        body: z.object({ ids: z.array(z.string()).max(200).optional() }),
      },
    },
    async (req) => {
      const { user } = requireAuth(req);
      await ctx.db.notification.updateMany({
        where: { userId: user.id, readAt: null, ...(req.body.ids ? { id: { in: req.body.ids } } : {}) },
        data: { readAt: new Date() },
      });
      return { ok: true };
    },
  );

  app.delete(
    '/notifications/:id',
    { schema: { tags: ['notifications'], summary: 'Benachrichtigung löschen', params: z.object({ id: z.string() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      await ctx.db.notification.deleteMany({ where: { id: req.params.id, userId: user.id } });
      return { ok: true };
    },
  );

  app.delete('/notifications', { schema: { tags: ['notifications'], summary: 'Alle gelesenen Benachrichtigungen löschen' } }, async (req) => {
    const { user } = requireAuth(req);
    await ctx.db.notification.deleteMany({ where: { userId: user.id, readAt: { not: null } } });
    return { ok: true };
  });

  app.get(
    '/feed',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Aktivitäts-Feed (eigene und Freunde)',
        querystring: z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }),
      },
    },
    async (req): Promise<ActivityDto[]> => {
      const { user } = requireAuth(req);
      const ids = [user.id, ...(await friendIds(ctx.db, user.id))];
      const rows = await ctx.db.activity.findMany({
        where: {
          userId: { in: ids },
          ...(req.query.before ? { createdAt: { lt: new Date(req.query.before) } } : {}),
          // Aktivitäten zu Spielen, die der Betrachter nicht sehen darf, ausblenden
          OR: [{ gameId: null }, { game: viewableWhere(user) }],
          // Privat geschaltete Profile tauchen im Feed der Freunde nicht auf
          AND: [{ OR: [{ userId: user.id }, { user: { profileVisibility: { not: 'PRIVATE' } } }] }],
        },
        include: activityInclude,
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return rows.map(activityDto);
    },
  );

  // Signierte Nutzerdateien (Chat-Anhänge, Profilhintergründe, Gruppen- und Community-Bilder).
  app.get(
    '/files/*',
    {
      schema: {
        tags: ['system'],
        summary: 'Signierte Nutzerdatei',
        querystring: z.object({ exp: z.string(), sig: z.string() }),
      },
      config: { rateLimit: false },
    },
    async (req, reply) => {
      const key = (req.params as { '*': string })['*'];
      if (!key.startsWith('social/') || key.includes('..')) throw forbidden();
      if (!ctx.signer.verify(`/api/files/${key}`, req.query.exp, req.query.sig)) throw forbidden('Link ungültig oder abgelaufen', 'invalid_signature');
      return sendStoredFile(req, reply, ctx.storage, key);
    },
  );
};
