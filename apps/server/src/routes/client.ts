import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ClientFileFormat, ClientRelease, ClientReleaseFile, Platform } from '@prisma/client';
import { z } from 'zod';
import type { ClientReleaseDto } from '@gameserver/shared';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { sendFile } from '../lib/send.js';
import { compareVersions } from '../lib/semver.js';
import { iso } from '../lib/time.js';
import { requireAdmin } from '../plugins/auth.js';

const MAX_CLIENT_FILE = 2 * 1024 ** 3;

export function detectFormat(filename: string): { format: ClientFileFormat; platform: Platform } | null {
  const f = filename.toLowerCase();
  if (f.endsWith('.msi')) return { format: 'MSI', platform: 'WINDOWS' };
  if (f.endsWith('.exe')) return { format: 'NSIS', platform: 'WINDOWS' };
  if (f.endsWith('.appimage')) return { format: 'APPIMAGE', platform: 'LINUX' };
  if (f.endsWith('.deb')) return { format: 'DEB', platform: 'LINUX' };
  if (f.endsWith('.rpm')) return { format: 'RPM', platform: 'LINUX' };
  if (f.endsWith('.dmg')) return { format: 'DMG', platform: 'MACOS' };
  if (f.endsWith('.app.tar.gz')) return { format: 'APP_TARBALL', platform: 'MACOS' };
  return null;
}

export function detectArch(filename: string): string {
  return /aarch64|arm64/i.test(filename) ? 'aarch64' : 'x86_64';
}

const fileUrl = (id: string) => `/api/client/files/${id}/download`;

export function releaseDto(r: ClientRelease & { files: ClientReleaseFile[] }): ClientReleaseDto {
  return {
    id: r.id,
    version: r.version,
    notes: r.notes,
    published: r.published,
    publishedAt: iso(r.publishedAt),
    createdAt: r.createdAt.toISOString(),
    files: r.files
      .sort((a, b) => a.platform.localeCompare(b.platform) || a.format.localeCompare(b.format))
      .map((f) => ({
        id: f.id,
        platform: f.platform,
        arch: f.arch,
        format: f.format,
        filename: f.filename,
        size: Number(f.size),
        sha256: f.sha256,
        hasSignature: !!f.signature,
        downloadUrl: fileUrl(f.id),
      })),
  };
}

/** Bevorzugtes Update-Format pro Ziel (Tauri-Updater). */
const UPDATER_FORMATS: Record<string, { platform: Platform; formats: ClientFileFormat[] }> = {
  windows: { platform: 'WINDOWS', formats: ['NSIS', 'MSI'] },
  linux: { platform: 'LINUX', formats: ['APPIMAGE'] },
  darwin: { platform: 'MACOS', formats: ['APP_TARBALL'] },
};

export const clientRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;

  async function publishedReleases() {
    const list = await ctx.db.clientRelease.findMany({ where: { published: true }, include: { files: true } });
    return list.sort((a, b) => compareVersions(b.version, a.version));
  }

  // ---- Öffentlich (Download-Seite und Tauri-Updater) ----

  app.get('/client/releases/latest', { schema: { tags: ['client'], summary: 'Neueste veröffentlichte Client-Version' } }, async () => {
    const [latest] = await publishedReleases();
    return latest ? releaseDto(latest) : null;
  });

  app.get(
    '/client/update/:target/:arch/:currentVersion',
    {
      schema: {
        tags: ['client'],
        summary: 'Tauri-Updater-Endpunkt (204 = kein Update)',
        params: z.object({ target: z.string().max(20), arch: z.string().max(20), currentVersion: z.string().max(50) }),
      },
      config: { allowInMaintenance: true },
    },
    async (req, reply) => {
      const { target, arch, currentVersion } = req.params;
      const wanted = UPDATER_FORMATS[target];
      if (!wanted) return reply.code(204).send();
      for (const release of await publishedReleases()) {
        if (compareVersions(release.version, currentVersion) <= 0) break;
        for (const format of wanted.formats) {
          const file = release.files.find((f) => f.platform === wanted.platform && f.arch === arch && f.format === format && f.signature);
          if (file) {
            return {
              version: release.version,
              notes: release.notes,
              pub_date: (release.publishedAt ?? release.createdAt).toISOString(),
              url: new URL(fileUrl(file.id), ctx.config.PUBLIC_URL).toString(),
              signature: file.signature,
            };
          }
        }
      }
      return reply.code(204).send();
    },
  );

  app.get(
    '/client/files/:id/download',
    { schema: { tags: ['client'], summary: 'Client-Datei herunterladen', params: z.object({ id: z.string() }) }, config: { rateLimit: false } },
    async (req, reply) => {
      const file = await ctx.db.clientReleaseFile.findUnique({ where: { id: req.params.id }, include: { release: true } });
      if (!file || (!file.release.published && req.auth?.user.role !== 'ADMIN')) throw notFound();
      return sendFile(req, reply, {
        filePath: ctx.storage.resolve(file.storageKey),
        size: Number(file.size),
        filename: file.filename,
        etag: file.sha256,
      });
    },
  );

  // ---- Verwaltung (Admin) ----

  await app.register(async (scope) => {
    const admin = scope.withTypeProvider<ZodTypeProvider>();
    admin.addHook('preHandler', async (req) => {
      requireAdmin(req);
    });

    admin.get('/admin/client-releases', { schema: { tags: ['client'], summary: 'Alle Client-Releases' } }, async () => {
      const list = await ctx.db.clientRelease.findMany({ include: { files: true } });
      return list.sort((a, b) => compareVersions(b.version, a.version)).map(releaseDto);
    });

    admin.post(
      '/admin/client-releases',
      {
        schema: {
          tags: ['client'],
          summary: 'Client-Release anlegen',
          body: z.object({ version: z.string().trim().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, 'SemVer, z. B. 1.2.0'), notes: z.string().max(20_000).default('') }),
        },
      },
      async (req) => {
        const r = await ctx.db.clientRelease.create({ data: req.body, include: { files: true } });
        await ctx.audit.log({ userId: req.auth!.user.id, action: 'client.release_created', target: r.id, meta: { version: r.version }, ip: req.ip });
        return releaseDto(r);
      },
    );

    admin.patch(
      '/admin/client-releases/:id',
      {
        schema: {
          tags: ['client'],
          summary: 'Client-Release bearbeiten/veröffentlichen',
          params: z.object({ id: z.string() }),
          body: z.object({ notes: z.string().max(20_000).optional(), published: z.boolean().optional() }),
        },
      },
      async (req) => {
        const existing = await ctx.db.clientRelease.findUnique({ where: { id: req.params.id }, include: { files: true } });
        if (!existing) throw notFound();
        if (req.body.published && existing.files.length === 0) throw badRequest('Release enthält keine Dateien', 'no_files');
        const r = await ctx.db.clientRelease.update({
          where: { id: existing.id },
          data: { ...req.body, publishedAt: req.body.published && !existing.publishedAt ? new Date() : undefined },
          include: { files: true },
        });
        await ctx.audit.log({ userId: req.auth!.user.id, action: 'client.release_updated', target: r.id, meta: req.body, ip: req.ip });
        return releaseDto(r);
      },
    );

    admin.delete('/admin/client-releases/:id', { schema: { tags: ['client'], summary: 'Client-Release löschen', params: z.object({ id: z.string() }) } }, async (req) => {
      const r = await ctx.db.clientRelease.findUnique({ where: { id: req.params.id }, include: { files: true } });
      if (!r) throw notFound();
      await ctx.db.clientRelease.delete({ where: { id: r.id } });
      for (const f of r.files) await ctx.storage.remove(f.storageKey);
      return { ok: true };
    });

    admin.post(
      '/admin/client-releases/:id/files',
      {
        schema: {
          tags: ['client'],
          summary: 'Client-Datei hochladen (multipart, Feld "file"; Format/Plattform werden aus dem Dateinamen erkannt)',
          params: z.object({ id: z.string() }),
          querystring: z.object({ arch: z.enum(['x86_64', 'aarch64']).optional() }),
        },
        config: { rateLimit: false },
      },
      async (req) => {
        const release = await ctx.db.clientRelease.findUnique({ where: { id: req.params.id } });
        if (!release) throw notFound();
        const file = await req.file({ limits: { fileSize: MAX_CLIENT_FILE } });
        if (!file) throw badRequest('Keine Datei', 'no_file');
        const filename = path.basename(file.filename).replace(/[^\w.\-+ ]/g, '_');
        const detected = detectFormat(filename);
        if (!detected) {
          file.file.resume();
          throw badRequest('Unbekanntes Format (erlaubt: .msi, .exe, .AppImage, .deb, .rpm, .dmg, .app.tar.gz)', 'invalid_format');
        }
        const arch = req.query.arch ?? detectArch(filename);
        const tmp = ctx.storage.resolve(`tmp/client-${release.id}-${Date.now()}`);
        const hash = createHash('sha256');
        let size = 0;
        await pipeline(
          file.file,
          new Transform({
            transform(chunk: Buffer, _e, cb) {
              hash.update(chunk);
              size += chunk.length;
              cb(null, chunk);
            },
          }),
          createWriteStream(tmp),
        );
        if (file.file.truncated) {
          await fs.rm(tmp, { force: true });
          throw new HttpError(413, 'too_large', 'Datei ist zu groß (max. 2 GB)');
        }
        const old = await ctx.db.clientReleaseFile.findUnique({
          where: { releaseId_platform_arch_format: { releaseId: release.id, platform: detected.platform, arch, format: detected.format } },
        });
        if (old) {
          await ctx.db.clientReleaseFile.delete({ where: { id: old.id } });
          await ctx.storage.remove(old.storageKey);
        }
        const created = await ctx.db.clientReleaseFile.create({
          data: { releaseId: release.id, ...detected, arch, filename, size: BigInt(size), sha256: hash.digest('hex'), storageKey: 'pending' },
        });
        const key = `client/${release.id}/${created.id}-${filename}`;
        await ctx.storage.move(tmp, key);
        await ctx.db.clientReleaseFile.update({ where: { id: created.id }, data: { storageKey: key } });
        const r = await ctx.db.clientRelease.findUniqueOrThrow({ where: { id: release.id }, include: { files: true } });
        return releaseDto(r);
      },
    );

    admin.patch(
      '/admin/client-files/:id',
      {
        schema: {
          tags: ['client'],
          summary: 'Updater-Signatur (Inhalt der .sig-Datei) setzen',
          params: z.object({ id: z.string() }),
          body: z.object({ signature: z.string().trim().max(10_000).nullable() }),
        },
      },
      async (req) => {
        const f = await ctx.db.clientReleaseFile.update({ where: { id: req.params.id }, data: { signature: req.body.signature || null } });
        const r = await ctx.db.clientRelease.findUniqueOrThrow({ where: { id: f.releaseId }, include: { files: true } });
        return releaseDto(r);
      },
    );

    admin.delete('/admin/client-files/:id', { schema: { tags: ['client'], summary: 'Client-Datei löschen', params: z.object({ id: z.string() }) } }, async (req) => {
      const f = await ctx.db.clientReleaseFile.findUnique({ where: { id: req.params.id } });
      if (!f) throw notFound();
      await ctx.db.clientReleaseFile.delete({ where: { id: f.id } });
      await ctx.storage.remove(f.storageKey);
      return { ok: true };
    });
  });
};
