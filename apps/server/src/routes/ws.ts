import type { FastifyPluginAsync } from 'fastify';
import type { WsEvent } from '@gameserver/shared';

/** WebSocket-Endpunkt für Echtzeit-Ereignisse (Uploads, Wartung, Ankündigungen, Bibliothek). */
export const wsRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  app.get('/ws', { websocket: true, schema: { tags: ['system'], summary: 'WebSocket (JSON-Ereignisse)' }, config: { allowInMaintenance: true } }, (socket, req) => {
    const auth = req.auth;
    const remove = ctx.hub.add({
      socket,
      userId: auth?.user.id ?? null,
      sessionId: auth?.session.id ?? null,
      isAdmin: auth?.user.role === 'ADMIN',
    });
    const send = (e: WsEvent) => socket.send(JSON.stringify(e));
    send({ type: 'hello', data: { userId: auth?.user.id ?? null, serverTime: new Date().toISOString() } });
    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === 'ping') send({ type: 'pong', data: { time: new Date().toISOString() } });
      } catch {
        // Ungültige Nachrichten ignorieren
      }
    });
    socket.on('close', remove);
  });
};
