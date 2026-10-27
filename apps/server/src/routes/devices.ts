import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { GameNoteDto, RemoteDeviceDto } from '@gameserver/shared';
import { badRequest, notFound } from '../lib/errors.js';
import { requireAuth } from '../plugins/auth.js';
import { canViewGame } from '../services/access.js';

/** Remote-Download/-Start auf eigenen Geräten (Desktop-Clients) und Spielnotizen (Overlay). */
export const deviceRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const { db } = ctx;

  app.get('/devices', { schema: { tags: ['devices'], summary: 'Eigene Desktop-Clients (Device-Tokens) mit Online-Status' } }, async (req): Promise<RemoteDeviceDto[]> => {
    const { user, session } = requireAuth(req);
    const rows = await db.session.findMany({
      where: { userId: user.id, kind: 'DEVICE', expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return rows.map((s) => ({
      sessionId: s.id,
      name: s.name ?? 'Desktop-Client',
      online: ctx.hub.isSessionOnline(s.id),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === session.id,
    }));
  });

  app.post(
    '/devices/:sessionId/command',
    {
      schema: {
        tags: ['devices'],
        summary: 'Befehl an ein eigenes Gerät senden (Spiel installieren oder starten)',
        params: z.object({ sessionId: z.string() }),
        body: z.object({ action: z.enum(['install', 'launch']), gameId: z.string() }),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { user, session } = requireAuth(req);
      const target = await db.session.findFirst({ where: { id: req.params.sessionId, userId: user.id, kind: 'DEVICE', expiresAt: { gt: new Date() } } });
      if (!target) throw notFound('Gerät nicht gefunden');
      if (!ctx.hub.isSessionOnline(target.id)) throw badRequest('Das Gerät ist nicht online', 'device_offline');
      const game = await db.game.findUnique({ where: { id: req.body.gameId } });
      if (!game || !(await canViewGame(db, user, game))) throw notFound('Spiel nicht gefunden');
      // Für die Installation muss das Spiel in der Bibliothek sein
      await db.libraryEntry.upsert({ where: { userId_gameId: { userId: user.id, gameId: game.id } }, create: { userId: user.id, gameId: game.id }, update: {} });
      ctx.hub.toSession(target.id, {
        type: 'remote.command',
        data: { action: req.body.action, gameId: game.id, from: session.name ?? (session.kind === 'WEB' ? 'Web' : 'Desktop-Client') },
      });
      await ctx.audit.log({ userId: user.id, action: `remote.${req.body.action}`, target: target.id, meta: { gameId: game.id }, ip: req.ip });
      return { ok: true };
    },
  );

  app.get('/notes/:gameId', { schema: { tags: ['devices'], summary: 'Eigene Notizen zu einem Spiel', params: z.object({ gameId: z.string() }) } }, async (req): Promise<GameNoteDto> => {
    const { user } = requireAuth(req);
    const note = await db.gameNote.findUnique({ where: { userId_gameId: { userId: user.id, gameId: req.params.gameId } } });
    return { gameId: req.params.gameId, body: note?.body ?? '', updatedAt: note?.updatedAt.toISOString() ?? null };
  });

  app.put(
    '/notes/:gameId',
    { schema: { tags: ['devices'], summary: 'Notizen speichern', params: z.object({ gameId: z.string() }), body: z.object({ body: z.string().max(100_000) }) } },
    async (req): Promise<GameNoteDto> => {
      const { user } = requireAuth(req);
      const game = await db.game.findUnique({ where: { id: req.params.gameId } });
      if (!game || !(await canViewGame(db, user, game))) throw notFound('Spiel nicht gefunden');
      const note = await db.gameNote.upsert({
        where: { userId_gameId: { userId: user.id, gameId: game.id } },
        create: { userId: user.id, gameId: game.id, body: req.body.body },
        update: { body: req.body.body },
      });
      return { gameId: game.id, body: note.body, updatedAt: note.updatedAt.toISOString() };
    },
  );
};
