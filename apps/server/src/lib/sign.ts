import { createHmac } from 'node:crypto';
import { safeEqual } from './crypto.js';

/**
 * Signierte, zeitlich begrenzte URLs für Nutzer-Uploads (Chat-Bilder, Community-Bilder nicht öffentlicher Spiele).
 * Nötig, weil <img>-Tags im Desktop-Client kein Bearer-Token mitsenden können.
 */
export class UrlSigner {
  constructor(private readonly secret: string) {}

  private mac(path: string, exp: number): string {
    return createHmac('sha256', this.secret).update(`${path}\n${exp}`).digest('base64url').slice(0, 32);
  }

  /** Signiert einen Pfad; die Gültigkeit wird auf volle Stunden gerundet (bessere Cache-Nutzung). */
  sign(path: string, ttlSeconds = 24 * 3600, now = Date.now()): string {
    const exp = Math.ceil((now / 1000 + ttlSeconds) / 3600) * 3600;
    return `${path}?exp=${exp}&sig=${this.mac(path, exp)}`;
  }

  verify(path: string, exp: unknown, sig: unknown, now = Date.now()): boolean {
    const e = Number(exp);
    if (!Number.isFinite(e) || typeof sig !== 'string' || e * 1000 < now) return false;
    return safeEqual(sig, this.mac(path, e));
  }
}
