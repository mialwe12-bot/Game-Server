import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { api } from '../../lib/api';

/**
 * Voice-Medienschicht über einen eigenen LiveKit-SFU. Die Teilnehmer-Anzeige läuft weiterhin über den
 * WebSocket-Hub (voice.join/leave → voice.participants); LiveKit liefert nur das Audio (skaliert besser als Mesh).
 */
export interface LivekitSession {
  setMuted(muted: boolean): Promise<void>;
  disconnect(): Promise<void>;
}

export async function connectLivekit(conversationId: string): Promise<LivekitSession> {
  const { url, token } = await api.chat.voiceToken(conversationId);
  const room = new Room({ adaptiveStream: true, dynacast: true });
  const audios = new Set<HTMLAudioElement>();

  const attach = (track: RemoteTrack) => {
    if (track.kind !== Track.Kind.Audio) return;
    const el = track.attach() as HTMLAudioElement;
    el.autoplay = true;
    el.style.display = 'none';
    document.body.appendChild(el);
    audios.add(el);
    void el.play().catch(() => undefined);
  };

  room.on(RoomEvent.TrackSubscribed, (track) => attach(track));
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    for (const el of track.detach()) {
      el.remove();
      if (el instanceof HTMLAudioElement) audios.delete(el);
    }
  });

  await room.connect(url, token);
  await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, autoGainControl: true });

  return {
    async setMuted(muted: boolean) {
      await room.localParticipant.setMicrophoneEnabled(!muted);
    },
    async disconnect() {
      for (const el of audios) el.remove();
      audios.clear();
      await room.disconnect();
    },
  };
}
