import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Storage } from '../services/storage.js';
import { randomToken } from './crypto.js';
import { HttpError } from './errors.js';

export interface StoredStream {
  key: string;
  size: number;
  sha256: string;
  /** Erste Bytes der Datei (für Formatprüfung) */
  head: Buffer;
}

/**
 * Schreibt einen Datenstrom (z. B. eine Multipart-Datei) mit Größenlimit und SHA-256 in den Speicher.
 * Erst nach vollständigem Empfang wird die Datei an ihren Zielort verschoben.
 */
export async function storeStream(storage: Storage, stream: Readable & { truncated?: boolean }, key: string, maxBytes: number): Promise<StoredStream> {
  const tmp = storage.resolve(`tmp/upload-${Date.now().toString(36)}-${randomToken(6)}`);
  await fs.mkdir(path.dirname(tmp), { recursive: true });
  const hash = createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  let tooLarge = false;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        // Rest verwerfen statt abzubrechen, damit die Anfrage sauber beantwortet werden kann
        return cb();
      }
      if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(stream, counter, createWriteStream(tmp));
    if (tooLarge || stream.truncated) {
      throw new HttpError(413, 'too_large', `Datei ist zu groß (max. ${Math.round(maxBytes / 1024 / 1024)} MB)`);
    }
    await storage.move(tmp, key);
    return { key, size, sha256: hash.digest('hex'), head };
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

export const isZip = (head: Buffer) => head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05);
export const is7z = (head: Buffer) => head.length >= 6 && head.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));
