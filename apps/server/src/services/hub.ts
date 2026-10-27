import type { WsEvent } from '@gameserver/shared';

export interface HubSocket {
  send(data: string): void;
  readyState: number;
}

interface Client {
  socket: HubSocket;
  userId: string | null;
  sessionId: string | null;
  isAdmin: boolean;
}

/** Verteilt Echtzeit-Ereignisse an verbundene WebSocket-Clients. */
export class Hub {
  private clients = new Set<Client>();

  add(client: Client): () => void {
    this.clients.add(client);
    return () => this.clients.delete(client);
  }

  private sendTo(filter: (c: Client) => boolean, event: WsEvent) {
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

  toSession(sessionId: string, event: WsEvent) {
    this.sendTo((c) => c.sessionId === sessionId, event);
  }

  toAdmins(event: WsEvent) {
    this.sendTo((c) => c.isAdmin, event);
  }

  get size(): number {
    return this.clients.size;
  }

  onlineUserIds(): Set<string> {
    return new Set([...this.clients].map((c) => c.userId).filter((x): x is string => !!x));
  }
}
