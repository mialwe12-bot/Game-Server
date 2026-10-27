import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { detectImage } from './images.js';
import { normalizeRelPath } from './paths.js';
import { parseRange } from './range.js';
import { slugify } from './slug.js';
import { ThrottleStream } from './throttle.js';
import { base32Decode, base32Encode, hotp, totpAt, verifyTotp } from './totp.js';

describe('TOTP (RFC 6238)', () => {
  // RFC-6238-Testvektor: Secret "12345678901234567890" (ASCII), SHA-1
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('Base32 ist umkehrbar', () => {
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('erzeugt die RFC-Testwerte', () => {
    expect(totpAt(secret, 59_000)).toBe('287082');
    expect(totpAt(secret, 1111111109_000)).toBe('081804');
    expect(totpAt(secret, 1234567890_000)).toBe('005924');
    expect(hotp(secret, 0)).toBe('755224');
  });

  it('akzeptiert ±1 Zeitfenster und liefert den Zähler', () => {
    const t = 1_700_000_000_000;
    const code = totpAt(secret, t - 30_000);
    expect(verifyTotp(secret, code, t)).toBe(Math.floor(t / 30_000) - 1);
    expect(verifyTotp(secret, totpAt(secret, t - 90_000), t)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', t)).toBeNull();
  });
});

describe('parseRange', () => {
  it('parst gültige Bereiche', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });
  it('erkennt ungültige Bereiche', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=50-10', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable');
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange('bytes=0-1,5-6', 1000)).toBeNull();
    expect(parseRange('items=0-1', 1000)).toBeNull();
  });
});

describe('normalizeRelPath', () => {
  it('normalisiert und verhindert Path Traversal', () => {
    expect(normalizeRelPath('bin\\game.exe')).toBe('bin/game.exe');
    expect(normalizeRelPath('/data/./file.pak')).toBe('data/file.pak');
    expect(normalizeRelPath('../etc/passwd')).toBeNull();
    expect(normalizeRelPath('a/../../b')).toBeNull();
    expect(normalizeRelPath('')).toBeNull();
    expect(normalizeRelPath('a\0b')).toBeNull();
    expect(normalizeRelPath('C:/x')).toBeNull();
  });
});

describe('slugify', () => {
  it('erzeugt URL-sichere Slugs', () => {
    expect(slugify('Die Siedler: Größenwahn!')).toBe('die-siedler-grossenwahn');
    expect(slugify('0 A.D.')).toBe('0-a-d');
    expect(slugify('???')).toBe('spiel');
  });
});

describe('detectImage', () => {
  it('erkennt Bildformate anhand der Magic Bytes', () => {
    expect(detectImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe('image/png');
    expect(detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(detectImage(Buffer.from('RIFF0000WEBPVP8 '))?.mime).toBe('image/webp');
    expect(detectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });
});

describe('ThrottleStream', () => {
  it('begrenzt den Durchsatz', async () => {
    const data = Buffer.alloc(64 * 1024, 1);
    const throttle = new ThrottleStream(128 * 1024); // 128 KiB/s, Burst 128 KiB
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (c) => chunks.push(c));
    const start = Date.now();
    // 3 × 64 KiB = 192 KiB → nach dem Burst mindestens ~0,5 s
    await new Promise<void>((resolve, reject) => {
      Readable.from([data, data, data]).pipe(throttle).pipe(out).on('finish', resolve).on('error', reject);
    });
    const elapsed = Date.now() - start;
    expect(Buffer.concat(chunks).length).toBe(3 * data.length);
    expect(elapsed).toBeGreaterThanOrEqual(400);
  });

  it('ist ohne Limit transparent', async () => {
    const throttle = new ThrottleStream(0);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve) => {
      Readable.from([Buffer.from('abc'), Buffer.from('def')]).pipe(throttle).on('data', (c) => chunks.push(c)).on('end', resolve);
    });
    expect(Buffer.concat(chunks).toString()).toBe('abcdef');
  });
});
