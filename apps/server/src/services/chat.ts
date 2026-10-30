import { createHmac } from 'node:crypto';
import type { Conversation, ConversationMember, Group, Message, User } from '@prisma/client';
import type { ChatConfig, ConversationDto, IceServer, VoiceToken } from '@gameserver/shared';
import type { AppContext } from '../context.js';
import { forbidden, notFound } from '../lib/errors.js';
import { createLivekitToken } from '../lib/livekit.js';
import { fileUrl } from '../lib/image-upload.js';
import { userPublic } from './dto.js';
import { messageDto } from './social-dto.js';

export const directKey = (a: string, b: string) => [a, b].sort().join(':');

type ConvRow = Conversation & {
  members: (ConversationMember & { user: User })[];
  group: Group | null;
  messages: (Message & { author: User | null })[];
};

export const conversationInclude = {
  members: { include: { user: true } },
  group: true,
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1, include: { author: true } },
};

export class ChatService {
  constructor(private readonly ctx: AppContext) {}

  /** ICE-Server für WebRTC: STUN aus der Konfiguration, TURN mit zeitlich begrenzten Zugangsdaten (coturn „use-auth-secret“). */
  iceServers(userId: string): IceServer[] {
    const { config } = this.ctx;
    const list = (s: string) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    const servers: IceServer[] = [];
    const stun = list(config.WEBRTC_STUN_URLS);
    if (stun.length) servers.push({ urls: stun });
    const turn = list(config.WEBRTC_TURN_URLS);
    if (turn.length && config.WEBRTC_TURN_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:${userId}`;
      const credential = createHmac('sha1', config.WEBRTC_TURN_SECRET).update(username).digest('base64');
      servers.push({ urls: turn, username, credential });
    }
    return servers;
  }

  async config(userId: string): Promise<ChatConfig> {
    const s = await this.ctx.settings.get();
    return {
      gifsEnabled: s.gifsEnabled && !!this.ctx.config.TENOR_API_KEY,
      voiceEnabled: s.voiceEnabled,
      voiceBackend: s.voiceBackend,
      livekitUrl: s.voiceBackend === 'LIVEKIT' ? s.livekitUrl : '',
      // ICE-Server nur beim eingebauten Mesh; LiveKit bringt seine eigene Aushandlung mit.
      iceServers: s.voiceEnabled && s.voiceBackend === 'MESH' ? this.iceServers(userId) : [],
      maxImageBytes: s.maxChatImageBytes,
    };
  }

  /** LiveKit-Zugangstoken für eine Voice-Konversation (nur Mitglieder, nur wenn LiveKit konfiguriert). */
  async voiceToken(user: User, conversationId: string): Promise<VoiceToken> {
    const s = await this.ctx.settings.get();
    const { config } = this.ctx;
    if (!s.voiceEnabled) throw forbidden('Sprachchat ist deaktiviert', 'voice_disabled');
    if (s.voiceBackend !== 'LIVEKIT' || !s.livekitUrl || !config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) {
      throw forbidden('LiveKit-Voice ist nicht konfiguriert', 'livekit_not_configured');
    }
    await this.membership(conversationId, user.id); // wirft 404, wenn kein Mitglied
    const room = `conv_${conversationId}`;
    const token = createLivekitToken({
      apiKey: config.LIVEKIT_API_KEY,
      apiSecret: config.LIVEKIT_API_SECRET,
      identity: user.id,
      name: user.displayName ?? user.username,
      room,
    });
    return { url: s.livekitUrl, token, room };
  }

  /** Mitgliedschaft prüfen (wirft 404, wenn der Nutzer nicht Mitglied ist). */
  async membership(conversationId: string, userId: string) {
    const m = await this.ctx.db.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      include: { conversation: true },
    });
    if (!m) throw notFound('Unterhaltung nicht gefunden');
    return m;
  }

  async canManage(conv: Conversation, userId: string, member: ConversationMember | null): Promise<boolean> {
    if (conv.type === 'DIRECT') return false;
    if (conv.type === 'CHANNEL' && conv.groupId) {
      const gm = await this.ctx.db.groupMember.findUnique({ where: { groupId_userId: { groupId: conv.groupId, userId } } });
      return gm?.status === 'ACTIVE' && (gm.role === 'OWNER' || gm.role === 'MODERATOR');
    }
    return !!member?.isAdmin;
  }

  async dto(c: ConvRow, viewer: User): Promise<ConversationDto> {
    const me = c.members.find((m) => m.userId === viewer.id) ?? null;
    const others = c.members.filter((m) => m.userId !== viewer.id).map((m) => m.user);
    const unread = me
      ? await this.ctx.db.message.count({
          where: { conversationId: c.id, createdAt: { gt: me.lastReadAt }, authorId: { not: viewer.id }, deletedAt: null },
        })
      : 0;
    let title = c.title ?? '';
    let avatarUrl: string | null = null;
    if (c.type === 'DIRECT') {
      const other = others[0];
      title = other ? (other.displayName ?? other.username) : '—';
      avatarUrl = other ? userPublic(other).avatarUrl : null;
    } else if (c.type === 'CHANNEL' && c.group) {
      title = `${c.group.name} · #${c.title ?? 'allgemein'}`;
      avatarUrl = fileUrl(this.ctx.signer, c.group.avatarKey);
    } else if (!title) {
      title = others
        .slice(0, 3)
        .map((u) => u.displayName ?? u.username)
        .join(', ');
    }
    const last = c.messages[0];
    return {
      id: c.id,
      type: c.type,
      title,
      avatarUrl,
      group: c.group ? { id: c.group.id, slug: c.group.slug, name: c.group.name } : null,
      // Bei großen Gruppenkanälen nur einen Ausschnitt der Mitglieder mitliefern
      members: c.members.slice(0, 50).map((m) => userPublic(m.user)),
      unread,
      lastMessage: last ? messageDto(this.ctx.signer, last) : null,
      lastMessageAt: c.lastMessageAt.toISOString(),
      muted: me?.muted ?? false,
      canManage: await this.canManage(c, viewer.id, me),
    };
  }

  async load(conversationId: string, viewer: User): Promise<ConversationDto> {
    const c = await this.ctx.db.conversation.findUnique({ where: { id: conversationId }, include: conversationInclude });
    if (!c) throw notFound('Unterhaltung nicht gefunden');
    return this.dto(c, viewer);
  }

  async memberIds(conversationId: string): Promise<string[]> {
    const rows = await this.ctx.db.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  /** Neue Nachricht speichern und an alle Mitglieder verteilen. */
  /** Findet oder erstellt die Direkt-Konversation zweier Nutzer. */
  async ensureDirect(aId: string, bId: string, createdById: string): Promise<Conversation> {
    const key = directKey(aId, bId);
    const existing = await this.ctx.db.conversation.findUnique({ where: { directKey: key } });
    if (existing) return existing;
    return this.ctx.db.conversation.create({
      data: { type: 'DIRECT', directKey: key, createdById, members: { create: [{ userId: aId }, { userId: bId }] } },
    });
  }

  async post(
    author: User,
    conversationId: string,
    content: { body: string; attachmentKey?: string; attachmentMime?: string; gifUrl?: string | null },
  ) {
    const { db, hub } = this.ctx;
    const member = await this.membership(conversationId, author.id);
    const conv = member.conversation;
    if (conv.type === 'DIRECT') {
      const otherId = (conv.directKey ?? '').split(':').find((id) => id !== author.id);
      if (otherId) {
        const blocked = await db.block.findFirst({
          where: { OR: [{ blockerId: author.id, blockedId: otherId }, { blockerId: otherId, blockedId: author.id }] },
        });
        if (blocked) throw forbidden('Mit diesem Nutzer ist keine Interaktion möglich', 'blocked');
      }
    }
    const previousLast = conv.lastMessageAt;
    const msg = await db.message.create({
      data: {
        conversationId,
        authorId: author.id,
        body: content.body,
        attachmentKey: content.attachmentKey ?? null,
        attachmentMime: content.attachmentMime ?? null,
        gifUrl: content.gifUrl ?? null,
      },
      include: { author: true },
    });
    await db.$transaction([
      db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: msg.createdAt } }),
      db.conversationMember.update({
        where: { conversationId_userId: { conversationId, userId: author.id } },
        data: { lastReadAt: msg.createdAt },
      }),
    ]);
    const dto = messageDto(this.ctx.signer, msg);
    const members = await db.conversationMember.findMany({ where: { conversationId } });
    hub.toUsers(
      members.map((m) => m.userId),
      { type: 'chat.message', data: dto },
    );
    // E-Mail nur für die erste ungelesene Nachricht (kein Spam bei längeren Unterhaltungen); Kanäle nie per Mail.
    if (conv.type !== 'CHANNEL') {
      const preview = content.body ? content.body.slice(0, 200) : content.gifUrl ? 'GIF' : '📷';
      for (const m of members) {
        if (m.userId === author.id || m.muted || m.lastReadAt < previousLast) continue;
        await this.ctx.notifications.notify(
          m.userId,
          'message',
          { username: author.displayName ?? author.username, conversationId, preview, path: `/chat/${conversationId}` },
          { store: false },
        );
      }
    }
    // Föderation Stufe 3: Direktnachricht an einen Remote-Partner an dessen Heimat-Server weiterleiten.
    if (conv.type === 'DIRECT') {
      const otherId = (conv.directKey ?? '').split(':').find((id) => id !== author.id);
      if (otherId) {
        const other = await db.user.findUnique({ where: { id: otherId } });
        if (other?.federationServerId && other.federationUserId) {
          void this.ctx.federation.forwardChatMessage(author, other, msg);
        }
      }
    }
    return dto;
  }
}
