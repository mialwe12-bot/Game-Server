import type { ChatConfig, IceServer, WsEvent } from '@gameserver/shared';
import { api } from '../../lib/api';
import { onWsEvent } from '../../lib/events';
import { connectLivekit, type LivekitSession } from './livekit';

type Signal = { sdp: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit };

export interface VoiceState {
  conversationId: string | null;
  joined: boolean;
  muted: boolean;
  error: string | null;
  /** Teilnehmer (User-IDs) je Unterhaltung – auch für nicht beigetretene Mitglieder sichtbar */
  participants: Record<string, string[]>;
  /** Verbindungsstatus je Gegenstelle */
  peers: Record<string, RTCPeerConnectionState>;
}

/**
 * Sprachchat als WebRTC-Mesh (jeder mit jedem, sinnvoll bis ca. 6 Personen). Der Server vermittelt nur die
 * Signalisierung über den WebSocket; Audio fließt direkt zwischen den Teilnehmern (bzw. über TURN, falls konfiguriert).
 * Es initiiert immer der Teilnehmer mit der kleineren User-ID, damit keine doppelten Verbindungen entstehen.
 */
class VoiceManager {
  state: VoiceState = { conversationId: null, joined: false, muted: false, error: null, participants: {}, peers: {} };
  private listeners = new Set<() => void>();
  private selfId: string | null = null;
  private iceServers: IceServer[] = [];
  private backend: 'MESH' | 'LIVEKIT' = 'MESH';
  private lk: LivekitSession | null = null;
  private stream: MediaStream | null = null;
  private pcs = new Map<string, RTCPeerConnection>();
  private audio = new Map<string, HTMLAudioElement>();
  private pending = new Map<string, RTCIceCandidateInit[]>();

  constructor() {
    onWsEvent((e) => this.onEvent(e));
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private set(patch: Partial<VoiceState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  async join(conversationId: string, selfId: string, config: ChatConfig): Promise<void> {
    if (this.state.joined) await this.leave();
    this.selfId = selfId;
    this.backend = config.voiceBackend;
    this.iceServers = config.iceServers;
    try {
      if (this.backend === 'LIVEKIT') {
        // Audio über den eigenen LiveKit-SFU; der Hub liefert nur die Teilnehmer-Anzeige.
        this.lk = await connectLivekit(conversationId);
      } else {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      }
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    this.set({ conversationId, joined: true, muted: false, error: null, peers: {} });
    api.wsSend({ type: 'voice.join', data: { conversationId } });
  }

  async leave(): Promise<void> {
    const id = this.state.conversationId;
    if (id) api.wsSend({ type: 'voice.leave', data: { conversationId: id } });
    if (this.lk) {
      await this.lk.disconnect().catch(() => undefined);
      this.lk = null;
    }
    for (const pc of this.pcs.values()) pc.close();
    this.pcs.clear();
    for (const a of this.audio.values()) {
      a.srcObject = null;
      a.remove();
    }
    this.audio.clear();
    this.pending.clear();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.set({ conversationId: null, joined: false, muted: false, peers: {} });
  }

  toggleMute(): void {
    const muted = !this.state.muted;
    if (this.lk) void this.lk.setMuted(muted);
    else this.stream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.set({ muted });
  }

  private onEvent(e: WsEvent) {
    if (e.type === 'voice.participants') {
      this.set({ participants: { ...this.state.participants, [e.data.conversationId]: e.data.userIds } });
      // Mesh baut pro Teilnehmer eine PeerConnection auf; bei LiveKit übernimmt der SFU die Medien.
      if (this.backend === 'MESH' && this.state.joined && e.data.conversationId === this.state.conversationId) this.syncPeers(e.data.userIds);
    } else if (e.type === 'voice.signal' && this.state.joined && e.data.conversationId === this.state.conversationId) {
      void this.onSignal(e.data.from, e.data.signal as Signal);
    } else if (e.type === 'hello' && this.state.joined && this.state.conversationId) {
      // Nach WebSocket-Neuverbindung erneut anmelden
      api.wsSend({ type: 'voice.join', data: { conversationId: this.state.conversationId } });
    }
  }

  private syncPeers(userIds: string[]) {
    const others = new Set(userIds.filter((id) => id !== this.selfId));
    for (const [id, pc] of this.pcs) {
      if (!others.has(id)) {
        pc.close();
        this.pcs.delete(id);
        this.audio.get(id)?.remove();
        this.audio.delete(id);
        const peers = { ...this.state.peers };
        delete peers[id];
        this.set({ peers });
      }
    }
    for (const id of others) {
      if (!this.pcs.has(id) && this.selfId! < id) void this.call(id);
    }
  }

  private peer(id: string): RTCPeerConnection {
    let pc = this.pcs.get(id);
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pcs.set(id, pc);
    this.stream?.getTracks().forEach((t) => pc!.addTrack(t, this.stream!));
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.send(id, { candidate: ev.candidate.toJSON() });
    };
    pc.ontrack = (ev) => {
      let el = this.audio.get(id);
      if (!el) {
        el = document.createElement('audio');
        el.autoplay = true;
        el.style.display = 'none';
        document.body.appendChild(el);
        this.audio.set(id, el);
      }
      el.srcObject = ev.streams[0];
      void el.play().catch(() => undefined);
    };
    pc.onconnectionstatechange = () => this.set({ peers: { ...this.state.peers, [id]: pc!.connectionState } });
    return pc;
  }

  private send(to: string, signal: Signal) {
    if (!this.state.conversationId) return;
    api.wsSend({ type: 'voice.signal', data: { conversationId: this.state.conversationId, to, signal } });
  }

  private async call(id: string) {
    const pc = this.peer(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send(id, { sdp: pc.localDescription!.toJSON() });
  }

  private async onSignal(from: string, signal: Signal) {
    const pc = this.peer(from);
    if ('sdp' in signal) {
      await pc.setRemoteDescription(signal.sdp);
      for (const c of this.pending.get(from) ?? []) await pc.addIceCandidate(c).catch(() => undefined);
      this.pending.delete(from);
      if (signal.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send(from, { sdp: pc.localDescription!.toJSON() });
      }
    } else if ('candidate' in signal) {
      if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate).catch(() => undefined);
      else this.pending.set(from, [...(this.pending.get(from) ?? []), signal.candidate]);
    }
  }
}

export const voice = new VoiceManager();
