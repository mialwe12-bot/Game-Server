import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseRange } from './range.js';
import { ThrottleStream } from './throttle.js';

export interface SendFileOptions {
  filePath: string;
  size: number;
  filename?: string;
  contentType?: string;
  etag?: string;
  /** Bandbreitenlimit in KiB/s (0 = unbegrenzt). */
  rateKbps?: number;
  cacheControl?: string;
  inline?: boolean;
}

function contentDisposition(filename: string, inline: boolean): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Liefert eine Datei mit Unterstützung für HTTP Range (Fortsetzen, parallele Chunks), HEAD,
 * ETag/If-Range und optionaler Bandbreitendrosselung.
 */
export function sendFile(req: FastifyRequest, reply: FastifyReply, opts: SendFileOptions) {
  const { size } = opts;
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', opts.contentType ?? 'application/octet-stream');
  reply.header('X-Content-Type-Options', 'nosniff');
  if (opts.etag) reply.header('ETag', `"${opts.etag}"`);
  if (opts.cacheControl) reply.header('Cache-Control', opts.cacheControl);
  if (opts.filename) reply.header('Content-Disposition', contentDisposition(opts.filename, !!opts.inline));

  if (opts.etag && req.headers['if-none-match'] === `"${opts.etag}"` && !req.headers.range) {
    return reply.code(304).send();
  }

  let rangeHeader = req.headers.range;
  const ifRange = req.headers['if-range'];
  if (rangeHeader && ifRange && opts.etag && ifRange !== `"${opts.etag}"`) rangeHeader = undefined;

  const range = parseRange(rangeHeader, size);
  if (range === 'unsatisfiable') {
    reply.header('Content-Range', `bytes */${size}`);
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.removeHeader('Content-Disposition');
    return reply.code(416).send({ error: 'range_not_satisfiable', message: 'Ungültiger Byte-Bereich' });
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  const length = size === 0 ? 0 : end - start + 1;
  reply.header('Content-Length', String(length));
  if (range) {
    reply.code(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  // Leerer Stream statt undefined, damit Fastifys HEAD-Handler die Content-Length nicht auf 0 setzt.
  if (req.method === 'HEAD') return reply.send(Readable.from([]));
  if (length === 0) return reply.send('');

  const stream = createReadStream(opts.filePath, { start, end, highWaterMark: 256 * 1024 });
  const rate = (opts.rateKbps ?? 0) * 1024;
  if (rate > 0) {
    const throttle = new ThrottleStream(rate);
    stream.on('error', (err) => throttle.destroy(err));
    return reply.send(stream.pipe(throttle));
  }
  return reply.send(stream);
}
