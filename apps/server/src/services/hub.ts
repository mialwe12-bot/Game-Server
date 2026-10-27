import type { WsEvent } from '@gameserver/shared';

export interface HubSocket {
  send(data: string): void;
  readyState: number;
}

export interface HubClient {
  socket: HubSocket;
  userId: string | null;
  sessionId: string | null;
  isAdmin: boolean;
}

export interface PresenceChange {
  userId: string;
  online: boolean;
  gameId: string | null;
}

/**
 * Verteilt Echtzeit-Ereignisse an verbundene WebSocket-Clients, verwaltet die Online-Präsenz
 * („online“, „spielt gerade“) und die Teilnehmer von Sprachchats (Signalisierung für WebRTC).
 */
export class Hub {
  private clients = new Set<HubClient>();
  private games = new Map<string, string>();
  private voice = new Map<string, Map<string, HubClient>>();
  private presenceListeners: ((change: PresenceChange) => void)[] = [];

  onPresence(listener: (change: PresenceChange) => void): void {
    this.presenceListeners.push(listener);
  }

  private emitPresence(userId: string) {
    const change = { userId, online: this.isOnline(userId), gameId: this.games.get(userId) ?? null };
    for (const l of this.presenceListeners) l(change);
  }

  add(client: HubClient): () => void {
    const wasOnline = client.userId ? this.isOnline(client.userId) : true;
    this.clients.add(client);
    if (client.userId && !wasOnline) this.emitPresence(client.userId);
    return () => this.remove(client);
  }

  private remove(client: HubClient): void {
    this.clients.delete(client);
    for (const [convId, members] of this.voice) {
      if (client.userId && members.get(client.userId) === client) this.leaveVoice(convId, client);
    }
    if (client.userId && !this.isOnline(client.userId)) {
      this.games.delete(client.userId);
      this.emitPresence(client.userId);
    }
  }

  private sendTo(filter: (c: HubClient) => boolean, event: WsEvent) {
    const payload = JSON.stringify(event);
    for (const c of this.clients) {
      if (c.socket.readyState === 1 && filter(c)) c.socket.send(payload);
    }
  }

  broadcast(event: WsEvent) {
    this.sendTo(() => true, event);
  }

  toUser(userId: string, event: WsEvent) {
    this.sendTo((c) => c.userId === userId, event);
  }

  toUsers(userIds: Iterable<string>, event: WsEvent) {
    const set = new Set(userIds);
    this.sendTo((c) => !!c.userId && set.has(c.userId), event);
  }

  toSession(sessionId: string, event: WsEvent) {
    this.sendTo((c) => c.sessionId === sessionId, event);
  }

  toAdmins(event: WsEvent) {
    this.sendTo((c) => c.isAdmin, event);
  }

  get size(): number {
    return this.clients.size;
  }

  isOnline(userId: string): boolean {
    for (const c of this.clients) if (c.userId === userId) return true;
    return false;
  }

  onlineUserIds(): Set<string> {
    return new Set([...this.clients].map((c) => c.userId).filter((x): x is string => !!x));
  }

  /** Vom Desktop-Client gemeldetes laufendes Spiel (null = keins). */
  setGame(userId: string, gameId: string | null): void {
    const before = this.games.get(userId) ?? null;
    if (gameId) this.games.set(userId, gameId);
    else this.games.delete(userId);
    if (before !== gameId) this.emitPresence(userId);
  }

  gameOf(userId: string): string | null {
    return this.games.get(userId) ?? null;
  }

  // ---- Sprachchat (WebRTC-Mesh, der Server vermittelt nur die Signalisierung) ----

  voiceParticipants(conversationId: string): string[] {
    return [...(this.voice.get(conversationId)?.keys() ?? [])];
  }

  joinVoice(conversationId: string, client: HubClient): string[] {
    if (!client.userId) return [];
    let room = this.voice.get(conversationId);
    if (!room) {
      room = new Map();
      this.voice.set(conversationId, room);
    }
    room.set(client.userId, client);
    return this.voiceParticipants(conversationId);
  }

  leaveVoice(conversationId: string, client: HubClient): string[] {
    const room = this.voice.get(conversationId);
    if (!room || !client.userId) return [];
    if (room.get(client.userId) === client) room.delete(client.userId);
    if (room.size === 0) this.voice.delete(conversationId);
    for (const l of this.voiceListeners) l(conversationId);
    return this.voiceParticipants(conversationId);
  }

  private voiceListeners: ((conversationId: string) => void)[] = [];
  onVoiceChange(listener: (conversationId: string) => void): void {
    this.voiceListeners.push(listener);
  }

  /** Leitet ein WebRTC-Signal (SDP/ICE) an genau einen Teilnehmer desselben Raums weiter. */
  relaySignal(conversationId: string, from: HubClient, to: string, signal: unknown): boolean {
    const room = this.voice.get(conversationId);
    if (!room || !from.userId || room.get(from.userId) !== from) return false;
    const target = room.get(to);
    if (!target || target.socket.readyState !== 1) return false;
    target.socket.send(JSON.stringify({ type: 'voice.signal', data: { conversationId, from: from.userId, signal } } satisfies WsEvent));
    return true;
  }
}
