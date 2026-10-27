import { createHash, type Hash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { BuildKind, Upload, User } from '@prisma/client';
import type { AppContext } from '../context.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { normalizeRelPath } from '../lib/paths.js';
import { DAY_MS } from '../lib/time.js';
import { assertCanEditGame, isAdmin } from './access.js';
import { uploadDto } from './dto.js';

const SINGLE_FILE_KINDS: BuildKind[] = ['ZIP', 'SEVEN_ZIP', 'INSTALLER'];
const EXTENSIONS: Partial<Record<BuildKind, string[]>> = {
  ZIP: ['.zip'],
  SEVEN_ZIP: ['.7z'],
  INSTALLER: ['.exe', '.msi', '.sh', '.run', '.deb', '.rpm', '.appimage', '.pkg', '.dmg'],
};
const MAGIC: Partial<Record<BuildKind, Buffer[]>> = {
  ZIP: [Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from([0x50, 0x4b, 0x05, 0x06])],
  SEVEN_ZIP: [Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])],
};
/** Sicherheitsreserve, die beim Anlegen eines Uploads frei bleiben muss. */
const DISK_RESERVE = 512 * 1024 ** 2;

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

/**
 * Fortsetzbare, Chunk-basierte Uploads (ähnlich tus):
 *  1. POST   /api/uploads            → Upload anlegen (Größe, Ziel-Build, Pfad)
 *  2. PATCH  /api/uploads/:id        → Chunk anhängen (Header Upload-Offset)
 *  3. GET    /api/uploads/:id        → aktuellen Offset abfragen (Fortsetzen nach Pause/Abbruch)
 * Nach dem letzten Chunk wird die SHA-256-Prüfsumme berechnet und die Datei dem Build zugeordnet.
 */
export class UploadService {
  private locks = new Set<string>();
  private hashes = new Map<string, { hash: Hash; offset: number }>();

  constructor(private readonly ctx: AppContext) {}

  tmpPath(id: string): string {
    return this.ctx.storage.resolve(`uploads/${id}`);
  }

  async quotaFor(user: User): Promise<{ quota: number; used: number }> {
    const settings = await this.ctx.settings.get();
    const quota = user.uploadQuotaBytes !== null ? Number(user.uploadQuotaBytes) : settings.defaultUploadQuotaBytes;
    const [files, active] = await Promise.all([
      this.ctx.db.buildFile.aggregate({ where: { uploadedById: user.id }, _sum: { size: true } }),
      this.ctx.db.upload.aggregate({ where: { userId: user.id, status: 'ACTIVE' }, _sum: { size: true } }),
    ]);
    return { quota, used: Number(files._sum.size ?? 0n) + Number(active._sum.size ?? 0n) };
  }

  async create(user: User, input: { buildId: string; path: string; size: number; sha256?: string | null }) {
    const { db, storage } = this.ctx;
    const build = await db.build.findUnique({ where: { id: input.buildId }, include: { version: true } });
    if (!build) throw notFound('Build nicht gefunden');
    await assertCanEditGame(db, user, build.version.gameId);

    const relPath = normalizeRelPath(input.path);
    if (!relPath) throw badRequest('Ungültiger Dateipfad', 'invalid_path');
    if (SINGLE_FILE_KINDS.includes(build.kind)) {
      if (relPath.includes('/')) throw badRequest('Archive/Installer müssen eine einzelne Datei sein', 'invalid_path');
      const allowed = EXTENSIONS[build.kind] ?? [];
      if (allowed.length && !allowed.some((ext) => relPath.toLowerCase().endsWith(ext))) {
        throw badRequest(`Erlaubte Dateiendungen für ${build.kind}: ${allowed.join(', ')}`, 'invalid_extension');
      }
    }

    const settings = await this.ctx.settings.get();
    if (input.size > settings.maxUploadFileBytes) {
      throw new HttpError(413, 'too_large', `Datei überschreitet das Upload-Limit (${settings.maxUploadFileBytes} Bytes)`);
    }

    // Laufenden Upload derselben Datei fortsetzen statt neu anzulegen
    const existing = await db.upload.findFirst({
      where: { userId: user.id, buildId: build.id, path: relPath, size: BigInt(input.size), status: 'ACTIVE' },
    });
    if (existing) return uploadDto(existing);

    const active = await db.upload.count({ where: { userId: user.id, status: 'ACTIVE' } });
    if (active >= settings.maxConcurrentUploadsPerUser) {
      throw new HttpError(429, 'too_many_uploads', 'Zu viele gleichzeitige Uploads');
    }
    if (!isAdmin(user)) {
      const { quota, used } = await this.quotaFor(user);
      if (quota > 0 && used + input.size > quota) throw new HttpError(413, 'quota_exceeded', 'Upload-Kontingent überschritten');
    }
    const disk = await storage.disk();
    if (disk.free - DISK_RESERVE < input.size) throw new HttpError(507, 'disk_full', 'Nicht genügend Speicherplatz');

    const upload = await db.upload.create({
      data: {
        userId: user.id,
        buildId: build.id,
        path: relPath,
        size: BigInt(input.size),
        expectedSha256: input.sha256?.toLowerCase() ?? null,
      },
    });
    await fs.writeFile(this.tmpPath(upload.id), Buffer.alloc(0));
    if (input.size === 0) return uploadDto(await this.finalize(upload));
    return uploadDto(upload);
  }

  async get(user: User, id: string): Promise<Upload> {
    const upload = await this.ctx.db.upload.findUnique({ where: { id } });
    if (!upload) throw notFound('Upload nicht gefunden');
    if (upload.userId !== user.id && !isAdmin(user)) throw forbidden();
    return upload;
  }

  async append(user: User, id: string, offset: number, body: Readable): Promise<Upload> {
    if (this.locks.has(id)) throw conflict('Für diesen Upload läuft bereits ein Chunk', 'upload_locked');
    this.locks.add(id);
    try {
      const upload = await this.get(user, id);
      if (upload.status !== 'ACTIVE') throw conflict('Upload ist nicht aktiv', 'upload_not_active');
      const current = Number(upload.offset);
      const size = Number(upload.size);
      if (offset !== current) {
        throw new HttpError(409, 'offset_mismatch', `Offset stimmt nicht überein (Server: ${current})`, { offset: current });
      }
      const file = this.tmpPath(id);
      // Nach Abbruch/Absturz liegen evtl. mehr Bytes vor als bestätigt → abschneiden.
      const stat = await fs.stat(file).catch(() => null);
      if (!stat) await fs.writeFile(file, Buffer.alloc(0));
      else if (stat.size !== current) await fs.truncate(file, current);

      let state = this.hashes.get(id);
      if (current === 0) state = { hash: createHash('sha256'), offset: 0 };
      if (state && state.offset !== current) state = undefined;
      this.hashes.delete(id);

      const remaining = size - current;
      let written = 0;
      let overflow = false;
      // Bei Überschreitung wird der Rest verworfen (nicht abgebrochen), damit die Verbindung sauber
      // mit 413 beantwortet werden kann.
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          if (overflow || written + chunk.length > remaining) {
            overflow = true;
            cb();
            return;
          }
          written += chunk.length;
          state?.hash.update(chunk);
          cb(null, chunk);
        },
      });

      try {
        await pipeline(body, counter, createWriteStream(file, { flags: 'a' }));
      } catch {
        await fs.truncate(file, current).catch(() => undefined);
        throw new HttpError(400, 'chunk_aborted', 'Chunk-Übertragung abgebrochen');
      }
      if (overflow) {
        await fs.truncate(file, current).catch(() => undefined);
        throw new HttpError(413, 'chunk_too_large', 'Chunk überschreitet die angekündigte Dateigröße');
      }

      const newOffset = current + written;
      const updated = await this.ctx.db.upload.update({ where: { id }, data: { offset: BigInt(newOffset) } });
      if (state) this.hashes.set(id, { hash: state.hash, offset: newOffset });
      if (newOffset === size) return await this.finalize(updated);
      return updated;
    } finally {
      this.locks.delete(id);
    }
  }

  private async fail(upload: Upload, message: string): Promise<Upload> {
    await fs.rm(this.tmpPath(upload.id), { force: true });
    const failed = await this.ctx.db.upload.update({ where: { id: upload.id }, data: { status: 'FAILED', error: message } });
    this.ctx.hub.toUser(upload.userId, { type: 'upload.failed', data: uploadDto(failed) });
    return failed;
  }

  private async finalize(upload: Upload): Promise<Upload> {
    const { db, storage } = this.ctx;
    const file = this.tmpPath(upload.id);
    const state = this.hashes.get(upload.id);
    this.hashes.delete(upload.id);
    const sha256 = state && state.offset === Number(upload.size) ? state.hash.digest('hex') : await hashFile(file);

    if (upload.expectedSha256 && upload.expectedSha256 !== sha256) {
      return this.fail(upload, `Prüfsumme stimmt nicht (erwartet ${upload.expectedSha256}, erhalten ${sha256})`);
    }
    const build = await db.build.findUnique({ where: { id: upload.buildId } });
    if (!build) return this.fail(upload, 'Build wurde gelöscht');

    const magic = MAGIC[build.kind];
    if (magic && upload.size > 0n) {
      const fh = await fs.open(file, 'r');
      const head = Buffer.alloc(8);
      await fh.read(head, 0, 8, 0);
      await fh.close();
      if (!magic.some((m) => head.subarray(0, m.length).equals(m))) {
        return this.fail(upload, `Datei ist kein gültiges ${build.kind === 'ZIP' ? 'ZIP' : '7z'}-Archiv`);
      }
    }

    // Alte Datei(en) ersetzen: bei Einzeldatei-Builds alle, bei Ordnern nur gleicher Pfad.
    const replaced = await db.buildFile.findMany({
      where: SINGLE_FILE_KINDS.includes(build.kind) ? { buildId: build.id } : { buildId: build.id, path: upload.path },
    });
    const created = await db.$transaction(async (tx) => {
      if (replaced.length) await tx.buildFile.deleteMany({ where: { id: { in: replaced.map((r) => r.id) } } });
      const bf = await tx.buildFile.create({
        data: {
          buildId: build.id,
          path: upload.path,
          size: upload.size,
          sha256,
          storageKey: 'pending',
          uploadedById: upload.userId,
        },
      });
      return tx.buildFile.update({ where: { id: bf.id }, data: { storageKey: `builds/${build.id}/${bf.id}` } });
    });
    await storage.move(file, created.storageKey);
    for (const r of replaced) await storage.remove(r.storageKey);
    await this.recalcBuild(build.id);

    const done = await db.upload.update({ where: { id: upload.id }, data: { status: 'COMPLETED', sha256 } });
    this.ctx.hub.toUser(upload.userId, { type: 'upload.completed', data: uploadDto(done) });
    return done;
  }

  async recalcBuild(buildId: string): Promise<void> {
    const agg = await this.ctx.db.buildFile.aggregate({ where: { buildId }, _sum: { size: true } });
    const total = agg._sum.size ?? 0n;
    const build = await this.ctx.db.build.findUnique({ where: { id: buildId } });
    if (!build) return;
    await this.ctx.db.build.update({
      where: { id: buildId },
      data: {
        totalSize: total,
        // Installationsgröße mindestens Downloadgröße (für Ordner-Builds identisch)
        installSize: build.installSize < total && build.kind === 'FOLDER' ? total : build.installSize,
      },
    });
  }

  async cancel(user: User, id: string): Promise<void> {
    const upload = await this.get(user, id);
    if (this.locks.has(id)) throw conflict('Upload ist gerade aktiv', 'upload_locked');
    if (upload.status === 'ACTIVE') {
      await this.ctx.db.upload.update({ where: { id }, data: { status: 'CANCELLED' } });
    }
    this.hashes.delete(id);
    await fs.rm(this.tmpPath(id), { force: true });
  }

  /** Bricht Uploads ab, die seit `days` Tagen nicht fortgesetzt wurden. */
  async cleanupStale(days = 7): Promise<number> {
    const stale = await this.ctx.db.upload.findMany({
      where: { status: 'ACTIVE', updatedAt: { lt: new Date(Date.now() - days * DAY_MS) } },
    });
    for (const u of stale) {
      await this.ctx.db.upload.update({ where: { id: u.id }, data: { status: 'CANCELLED', error: 'Abgelaufen' } });
      await fs.rm(this.tmpPath(u.id), { force: true });
    }
    return stale.length;
  }
}
