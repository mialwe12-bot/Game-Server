import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Storage } from '../services/storage.js';
import { randomToken } from './crypto.js';
import { badRequest, HttpError, notFound } from './errors.js';
import { detectImage } from './images.js';
import { sendFile } from './send.js';
import type { UrlSigner } from './sign.js';

export interface SavedImage {
  key: string;
  mime: string;
  size: number;
}

/** Liest ein Bild aus einem multipart-Request (Feld „file“), prüft die Magic Bytes und speichert es. */
export async function saveImageUpload(req: FastifyRequest, storage: Storage, prefix: string, maxBytes: number): Promise<SavedImage> {
  const file = await req.file({ limits: { fileSize: maxBytes } });
  if (!file) throw badRequest('Keine Datei', 'no_file');
  const data = await file.toBuffer();
  if (file.file.truncated) throw new HttpError(413, 'too_large', `Bild ist zu groß (max. ${Math.round(maxBytes / 1024 / 1024)} MB)`);
  const type = detectImage(data);
  if (!type) throw badRequest('Nur PNG, JPEG, WebP, GIF oder AVIF erlaubt', 'invalid_image');
  const key = `${prefix}/${Date.now().toString(36)}-${randomToken(6)}.${type.ext}`;
  await storage.write(key, data);
  return { key, mime: type.mime, size: data.length };
}

export function mimeFromKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
}

/** Gültigkeit signierter Datei-URLs (Profilhintergründe, Gruppenbilder, Chat-/Community-Bilder). */
export const FILE_URL_TTL = 7 * 24 * 3600;

/** Signierte URL für eine gespeicherte Nutzerdatei im Bereich „social“. */
export function fileUrl(signer: UrlSigner, key: string | null | undefined): string | null {
  if (!key) return null;
  return signer.sign(`/api/files/${key}`, FILE_URL_TTL);
}

export async function sendStoredFile(req: FastifyRequest, reply: FastifyReply, storage: Storage, key: string, mime?: string | null) {
  const stat = await storage.stat(key).catch(() => null);
  if (!stat) throw notFound();
  return sendFile(req, reply, {
    filePath: storage.resolve(key),
    size: stat.size,
    contentType: mime ?? mimeFromKey(key),
    etag: key.split('/').pop(),
    cacheControl: 'private, max-age=86400, immutable',
    inline: true,
  });
}
