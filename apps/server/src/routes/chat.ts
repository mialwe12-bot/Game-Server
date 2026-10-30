import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ChatConfig, ConversationDto, GifResult, MessageDto, VoiceToken } from '@gameserver/shared';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import { saveImageUpload } from '../lib/image-upload.js';
import { requireAuth } from '../plugins/auth.js';
import { conversationInclude, directKey } from '../services/chat.js';
import { messageDto } from '../services/social-dto.js';
import { areFriends, assertNotBlocked } from '../services/social.js';
import { assertChatAllowed } from '../services/family.js';

const convParams = z.object({ id: z.string() });
const MAX_BODY = 4000;
const MAX_GROUP_CHAT_MEMBERS = 50;

/** GIF-URLs nur von Tenor zulassen (keine beliebigen Fremd-Bilder/Tracking-Pixel im Chat). */
function isAllowedGif(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'media.tenor.com' || u.hostname.endsWith('.tenor.com'));
  } catch {
    return false;
  }
}

/** Chat: Direktnachrichten, Gruppenchats, Gruppenkanäle, Bilder, GIFs, Lesestatus. */
export const chatRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const chat = ctx.chat;

  app.get('/config', { schema: { tags: ['chat'], summary: 'Chat-Konfiguration (GIFs, Sprachchat, ICE-Server)' } }, async (req): Promise<ChatConfig> => {
    const { user } = requireAuth(req);
    return chat.config(user.id);
  });

  app.get(
    '/voice/token',
    { schema: { tags: ['chat'], summary: 'LiveKit-Voice-Token für eine Unterhaltung', querystring: z.object({ conversationId: z.string() }) } },
    async (req): Promise<VoiceToken> => {
      const { user } = requireAuth(req);
      return chat.voiceToken(user, req.query.conversationId);
    },
  );

  app.get('/conversations', { schema: { tags: ['chat'], summary: 'Eigene Unterhaltungen' } }, async (req): Promise<ConversationDto[]> => {
    const { user } = requireAuth(req);
    const rows = await ctx.db.conversation.findMany({
      where: { members: { some: { userId: user.id } } },
      include: conversationInclude,
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    });
    return Promise.all(rows.map((c) => chat.dto(c, user)));
  });

  app.get('/unread', { schema: { tags: ['chat'], summary: 'Anzahl ungelesener Nachrichten' } }, async (req) => {
    const { user } = requireAuth(req);
    const members = await ctx.db.conversationMember.findMany({ where: { userId: user.id, muted: false } });
    let count = 0;
    for (const m of members) {
      count += await ctx.db.message.count({
        where: { conversationId: m.conversationId, createdAt: { gt: m.lastReadAt }, authorId: { not: user.id }, deletedAt: null },
      });
    }
    return { count };
  });

  app.get('/conversations/:id', { schema: { tags: ['chat'], summary: 'Unterhaltung', params: convParams } }, async (req): Promise<ConversationDto> => {
    const { user } = requireAuth(req);
    await chat.membership(req.params.id, user.id);
    return chat.load(req.params.id, user);
  });

  app.post(
    '/direct',
    { schema: { tags: ['chat'], summary: 'Direktnachricht öffnen (nur mit Freunden)', body: z.object({ userId: z.string() }) } },
    async (req): Promise<ConversationDto> => {
      const { user } = requireAuth(req);
      await assertChatAllowed(ctx.db, user);
      const other = req.body.userId;
      if (other === user.id) throw badRequest('Keine Unterhaltung mit dir selbst', 'self');
      await assertNotBlocked(ctx.db, user.id, other);
      const key = directKey(user.id, other);
      let conv = await ctx.db.conversation.findUnique({ where: { directKey: key } });
      if (!conv) {
        if (!(await areFriends(ctx.db, user.id, other))) throw forbidden('Direktnachrichten nur unter Freunden', 'not_friends');
        conv = await ctx.db.conversation.create({
          data: { type: 'DIRECT', directKey: key, createdById: user.id, members: { create: [{ userId: user.id }, { userId: other }] } },
        });
      }
      return chat.load(conv.id, user);
    },
  );

  app.post(
    '/conversations',
    {
      schema: {
        tags: ['chat'],
        summary: 'Gruppenchat mit Freunden anlegen',
        body: z.object({ title: z.string().trim().max(80).optional(), userIds: z.array(z.string()).min(1).max(MAX_GROUP_CHAT_MEMBERS - 1) }),
      },
    },
    async (req): Promise<ConversationDto> => {
      const { user } = requireAuth(req);
      await assertChatAllowed(ctx.db, user);
      const ids = [...new Set(req.body.userIds.filter((id) => id !== user.id))];
      for (const id of ids) {
        if (!(await areFriends(ctx.db, user.id, id))) throw forbidden('Nur Freunde können hinzugefügt werden', 'not_friends');
      }
      const conv = await ctx.db.conversation.create({
        data: {
          type: 'GROUP',
          title: req.body.title || null,
          createdById: user.id,
          members: { create: [{ userId: user.id, isAdmin: true }, ...ids.map((userId) => ({ userId }))] },
        },
      });
      ctx.hub.toUsers([user.id, ...ids], { type: 'chat.conversation', data: { conversationId: conv.id } });
      return chat.load(conv.id, user);
    },
  );

  app.patch(
    '/conversations/:id',
    {
      schema: {
        tags: ['chat'],
        summary: 'Titel ändern (Admins) bzw. stummschalten',
        params: convParams,
        body: z.object({ title: z.string().trim().max(80).nullable().optional(), muted: z.boolean().optional() }),
      },
    },
    async (req): Promise<ConversationDto> => {
      const { user } = requireAuth(req);
      const m = await chat.membership(req.params.id, user.id);
      if (req.body.muted !== undefined) {
        await ctx.db.conversationMember.update({
          where: { conversationId_userId: { conversationId: m.conversationId, userId: user.id } },
          data: { muted: req.body.muted },
        });
      }
      if (req.body.title !== undefined) {
        if (m.conversation.type !== 'GROUP' || !m.isAdmin) throw forbidden();
        await ctx.db.conversation.update({ where: { id: m.conversationId }, data: { title: req.body.title || null } });
        ctx.hub.toUsers(await chat.memberIds(m.conversationId), { type: 'chat.conversation', data: { conversationId: m.conversationId } });
      }
      return chat.load(m.conversationId, user);
    },
  );

  app.post(
    '/conversations/:id/members',
    { schema: { tags: ['chat'], summary: 'Freunde zum Gruppenchat hinzufügen', params: convParams, body: z.object({ userIds: z.array(z.string()).min(1).max(49) }) } },
    async (req): Promise<ConversationDto> => {
      const { user } = requireAuth(req);
      const m = await chat.membership(req.params.id, user.id);
      if (m.conversation.type !== 'GROUP') throw badRequest('Nur in Gruppenchats möglich', 'not_group_chat');
      const existing = await chat.memberIds(m.conversationId);
      const ids = req.body.userIds.filter((id) => !existing.includes(id));
      if (existing.length + ids.length > MAX_GROUP_CHAT_MEMBERS) throw badRequest(`Höchstens ${MAX_GROUP_CHAT_MEMBERS} Mitglieder`, 'too_many_members');
      for (const id of ids) {
        if (!(await areFriends(ctx.db, user.id, id))) throw forbidden('Nur Freunde können hinzugefügt werden', 'not_friends');
      }
      await ctx.db.conversationMember.createMany({ data: ids.map((userId) => ({ conversationId: m.conversationId, userId })), skipDuplicates: true });
      ctx.hub.toUsers([...existing, ...ids], { type: 'chat.conversation', data: { conversationId: m.conversationId } });
      return chat.load(m.conversationId, user);
    },
  );

  app.delete(
    '/conversations/:id/members/:userId',
    { schema: { tags: ['chat'], summary: 'Gruppenchat verlassen bzw. Mitglied entfernen (Admins)', params: z.object({ id: z.string(), userId: z.string() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      const m = await chat.membership(req.params.id, user.id);
      if (m.conversation.type !== 'GROUP') throw badRequest('Nur in Gruppenchats möglich', 'not_group_chat');
      if (req.params.userId !== user.id && !m.isAdmin) throw forbidden();
      const before = await chat.memberIds(m.conversationId);
      await ctx.db.conversationMember.deleteMany({ where: { conversationId: m.conversationId, userId: req.params.userId } });
      const rest = await ctx.db.conversationMember.findMany({ where: { conversationId: m.conversationId } });
      if (rest.length === 0) {
        await ctx.db.conversation.delete({ where: { id: m.conversationId } });
      } else if (!rest.some((r) => r.isAdmin)) {
        // Letzter Admin gegangen → ältestes Mitglied wird Admin
        const next = rest.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0];
        await ctx.db.conversationMember.update({ where: { conversationId_userId: { conversationId: next.conversationId, userId: next.userId } }, data: { isAdmin: true } });
      }
      ctx.hub.toUsers(before, { type: 'chat.conversation', data: { conversationId: m.conversationId } });
      return { ok: true };
    },
  );

  app.get(
    '/conversations/:id/messages',
    {
      schema: {
        tags: ['chat'],
        summary: 'Nachrichten (neueste zuerst, seitenweise)',
        params: convParams,
        querystring: z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }),
      },
    },
    async (req): Promise<MessageDto[]> => {
      const { user } = requireAuth(req);
      await chat.membership(req.params.id, user.id);
      const rows = await ctx.db.message.findMany({
        where: { conversationId: req.params.id, ...(req.query.before ? { createdAt: { lt: new Date(req.query.before) } } : {}) },
        include: { author: true },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return rows.map((m) => messageDto(ctx.signer, m));
    },
  );

  app.post(
    '/conversations/:id/messages',
    {
      schema: {
        tags: ['chat'],
        summary: 'Nachricht senden (Text und/oder GIF)',
        params: convParams,
        body: z.object({ body: z.string().max(MAX_BODY).default(''), gifUrl: z.string().url().max(500).optional() }),
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req): Promise<MessageDto> => {
      const { user } = requireAuth(req);
      await assertChatAllowed(ctx.db, user);
      const body = req.body.body.trim();
      const gifUrl = req.body.gifUrl;
      if (!body && !gifUrl) throw badRequest('Nachricht ist leer', 'empty');
      if (gifUrl) {
        const cfg = await chat.config(user.id);
        if (!cfg.gifsEnabled) throw forbidden('GIFs sind deaktiviert', 'gifs_disabled');
        if (!isAllowedGif(gifUrl)) throw badRequest('Ungültige GIF-Adresse', 'invalid_gif');
      }
      return chat.post(user, req.params.id, { body, gifUrl });
    },
  );

  app.post(
    '/conversations/:id/attachments',
    {
      schema: {
        tags: ['chat'],
        summary: 'Bild senden (multipart, Feld „file“; optional ?caption=)',
        params: convParams,
        querystring: z.object({ caption: z.string().max(MAX_BODY).optional() }),
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req): Promise<MessageDto> => {
      const { user } = requireAuth(req);
      await assertChatAllowed(ctx.db, user);
      await chat.membership(req.params.id, user.id);
      const { maxChatImageBytes } = await ctx.settings.get();
      const saved = await saveImageUpload(req, ctx.storage, `social/chat/${req.params.id}`, maxChatImageBytes);
      try {
        return await chat.post(user, req.params.id, { body: (req.query.caption ?? '').trim(), attachmentKey: saved.key, attachmentMime: saved.mime });
      } catch (err) {
        await ctx.storage.remove(saved.key).catch(() => undefined);
        throw err;
      }
    },
  );

  async function ownMessage(id: string, userId: string, allowModerator = false) {
    const msg = await ctx.db.message.findUnique({ where: { id }, include: { conversation: true } });
    if (!msg || msg.deletedAt) throw notFound('Nachricht nicht gefunden');
    const member = await ctx.db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: msg.conversationId, userId } } });
    if (!member) throw notFound('Nachricht nicht gefunden');
    if (msg.authorId !== userId) {
      if (!allowModerator || !(await chat.canManage(msg.conversation, userId, member))) throw forbidden();
    }
    return msg;
  }

  app.patch(
    '/messages/:id',
    { schema: { tags: ['chat'], summary: 'Eigene Nachricht bearbeiten', params: convParams, body: z.object({ body: z.string().trim().min(1).max(MAX_BODY) }) } },
    async (req): Promise<MessageDto> => {
      const { user } = requireAuth(req);
      const msg = await ownMessage(req.params.id, user.id);
      const updated = await ctx.db.message.update({ where: { id: msg.id }, data: { body: req.body.body, editedAt: new Date() }, include: { author: true } });
      const dto = messageDto(ctx.signer, updated);
      ctx.hub.toUsers(await chat.memberIds(msg.conversationId), { type: 'chat.message.updated', data: dto });
      return dto;
    },
  );

  app.delete('/messages/:id', { schema: { tags: ['chat'], summary: 'Nachricht löschen (eigene bzw. als Moderator)', params: convParams } }, async (req) => {
    const { user } = requireAuth(req);
    const msg = await ownMessage(req.params.id, user.id, true);
    if (msg.attachmentKey) await ctx.storage.remove(msg.attachmentKey).catch(() => undefined);
    const updated = await ctx.db.message.update({
      where: { id: msg.id },
      data: { deletedAt: new Date(), body: '', attachmentKey: null, attachmentMime: null, gifUrl: null },
      include: { author: true },
    });
    ctx.hub.toUsers(await chat.memberIds(msg.conversationId), { type: 'chat.message.updated', data: messageDto(ctx.signer, updated) });
    return { ok: true };
  });

  app.post('/conversations/:id/read', { schema: { tags: ['chat'], summary: 'Unterhaltung als gelesen markieren', params: convParams } }, async (req) => {
    const { user } = requireAuth(req);
    await chat.membership(req.params.id, user.id);
    await ctx.db.conversationMember.update({
      where: { conversationId_userId: { conversationId: req.params.id, userId: user.id } },
      data: { lastReadAt: new Date() },
    });
    return { ok: true };
  });

  app.get(
    '/gifs',
    { schema: { tags: ['chat'], summary: 'GIF-Suche (Tenor, serverseitig vermittelt)', querystring: z.object({ q: z.string().trim().max(100).default('') }) } },
    async (req): Promise<GifResult[]> => {
      const { user } = requireAuth(req);
      const cfg = await chat.config(user.id);
      if (!cfg.gifsEnabled) throw forbidden('GIFs sind deaktiviert', 'gifs_disabled');
      const params = new URLSearchParams({
        key: ctx.config.TENOR_API_KEY,
        client_key: 'gameserver',
        limit: '24',
        media_filter: 'gif,tinygif',
        contentfilter: 'medium',
        locale: user.locale === 'en' ? 'en_US' : 'de_DE',
      });
      const endpoint = req.query.q ? 'search' : 'featured';
      if (req.query.q) params.set('q', req.query.q);
      const res = await fetch(`https://tenor.googleapis.com/v2/${endpoint}?${params}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (!res?.ok) throw new HttpError(502, 'gif_provider', 'GIF-Dienst nicht erreichbar');
      const json = (await res.json()) as {
        results?: { id: string; media_formats: Record<string, { url: string; dims: [number, number] }> }[];
      };
      return (json.results ?? [])
        .filter((r) => r.media_formats.gif && r.media_formats.tinygif)
        .map((r) => ({
          id: r.id,
          url: r.media_formats.gif.url,
          previewUrl: r.media_formats.tinygif.url,
          width: r.media_formats.gif.dims[0],
          height: r.media_formats.gif.dims[1],
        }));
    },
  );
};
