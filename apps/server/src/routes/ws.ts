import type { FastifyPluginAsync } from 'fastify';
import type { WsClientMessage, WsEvent } from '@gameserver/shared';
import type { HubClient } from '../services/hub.js';

/** Höchstens ein Tipp-Hinweis pro Unterhaltung alle 2 s weiterleiten. */
const TYPING_INTERVAL_MS = 2000;

/**
 * WebSocket-Endpunkt für Echtzeit-Ereignisse (Uploads, Wartung, Bibliothek, Präsenz, Chat, Benachrichtigungen)
 * sowie Signalisierung für Sprachchats (WebRTC-Mesh: SDP/ICE werden nur durchgereicht).
 */
export const wsRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;

  ctx.hub.onVoiceChange((conversationId) => {
    void ctx.chat
      .memberIds(conversationId)
      .then((ids) => ctx.hub.toUsers(ids, { type: 'voice.participants', data: { conversationId, userIds: ctx.hub.voiceParticipants(conversationId) } }))
      .catch(() => undefined);
  });

  const isMember = async (conversationId: string, userId: string) =>
    !!(await ctx.db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } }));

  app.get('/ws', { websocket: true, schema: { tags: ['system'], summary: 'WebSocket (JSON-Ereignisse)' }, config: { allowInMaintenance: true } }, (socket, req) => {
    const auth = req.auth;
    const client: HubClient = {
      socket,
      userId: auth?.user.id ?? null,
      sessionId: auth?.session.id ?? null,
      isAdmin: auth?.user.role === 'ADMIN',
    };
    const remove = ctx.hub.add(client);
    const send = (e: WsEvent) => socket.send(JSON.stringify(e));
    send({ type: 'hello', data: { userId: auth?.user.id ?? null, serverTime: new Date().toISOString() } });
    const lastTyping = new Map<string, number>();

    async function handle(msg: WsClientMessage) {
      if (msg.type === 'ping') return send({ type: 'pong', data: { time: new Date().toISOString() } });
      if (!auth) return;
      const userId = auth.user.id;
      const conversationId = typeof msg.data?.conversationId === 'string' ? msg.data.conversationId : '';
      if (!conversationId) return;
      switch (msg.type) {
        case 'chat.typing': {
          const now = Date.now();
          if (now - (lastTyping.get(conversationId) ?? 0) < TYPING_INTERVAL_MS) return;
          lastTyping.set(conversationId, now);
          if (!(await isMember(conversationId, userId))) return;
          const ids = (await ctx.chat.memberIds(conversationId)).filter((id) => id !== userId);
          ctx.hub.toUsers(ids, { type: 'chat.typing', data: { conversationId, userId, username: auth.user.displayName ?? auth.user.username } });
          return;
        }
        case 'voice.join': {
          const { voiceEnabled } = await ctx.settings.get();
          if (!voiceEnabled || !(await isMember(conversationId, userId))) return;
          ctx.hub.joinVoice(conversationId, client);
          const ids = await ctx.chat.memberIds(conversationId);
          ctx.hub.toUsers(ids, { type: 'voice.participants', data: { conversationId, userIds: ctx.hub.voiceParticipants(conversationId) } });
          return;
        }
        case 'voice.leave':
          ctx.hub.leaveVoice(conversationId, client);
          return;
        case 'voice.signal':
          if (typeof msg.data.to === 'string') ctx.hub.relaySignal(conversationId, client, msg.data.to, msg.data.signal);
          return;
      }
    }

    socket.on('message', (raw: Buffer) => {
      let msg: WsClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // Ungültige Nachrichten ignorieren
      }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
      void handle(msg).catch(() => undefined);
    });
    socket.on('close', remove);
  });
};
