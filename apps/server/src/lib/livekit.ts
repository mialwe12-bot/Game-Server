import { createHmac } from 'node:crypto';

/**
 * Erzeugt ein LiveKit-Zugangstoken (JWT, HS256), signiert mit dem API-Secret.
 * LiveKit erwartet den Grant im `video`-Claim und die Teilnehmer-Identität in `sub`.
 * Dependency-frei, damit der Server kein zusätzliches SDK braucht.
 */
export function createLivekitToken(opts: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  room: string;
  name?: string;
  ttlSeconds?: number;
  canPublish?: boolean;
  canSubscribe?: boolean;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    exp: now + (opts.ttlSeconds ?? 6 * 3600),
    iss: opts.apiKey,
    nbf: now,
    sub: opts.identity,
    ...(opts.name ? { name: opts.name } : {}),
    video: {
      room: opts.room,
      roomJoin: true,
      canPublish: opts.canPublish ?? true,
      canSubscribe: opts.canSubscribe ?? true,
      canPublishData: true,
    },
  };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const sig = createHmac('sha256', opts.apiSecret).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}
