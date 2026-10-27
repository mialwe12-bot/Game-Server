import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AdminUserDto, AuditLogDto, InviteDto, Paginated, StorageOverview } from '@gameserver/shared';
import { readableCode } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { sendFile } from '../lib/send.js';
import { iso } from '../lib/time.js';
import { requireAdmin } from '../plugins/auth.js';
import { announcementDto, announcementInclude, userPublic } from '../services/dto.js';
import { passwordSchema, usernameSchema } from './auth.js';

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
};

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;

  // Alle Admin-Routen erfordern die Rolle ADMIN.
  app.addHook('preHandler', async (req) => {
    requireAdmin(req);
  });

  // ---- Übersicht ----

  app.get('/overview', { schema: { tags: ['admin'], summary: 'Dashboard-Kennzahlen' } }, async () => {
    const [users, games, publicGames, builds, activeUploads, library, downloads30, sessions] = await Promise.all([
      ctx.db.user.count(),
      ctx.db.game.count(),
      ctx.db.game.count({ where: { visibility: 'PUBLIC' } }),
      ctx.db.build.count({ where: { status: 'READY' } }),
      ctx.db.upload.count({ where: { status: 'ACTIVE' } }),
      ctx.db.libraryEntry.count(),
      ctx.db.downloadEvent.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } }),
      ctx.db.session.count({ where: { expiresAt: { gt: new Date() } } }),
    ]);
    const disk = await ctx.storage.disk();
    return {
      users,
      games,
      publicGames,
      readyBuilds: builds,
      activeUploads,
      libraryEntries: library,
      downloads30d: downloads30,
      activeSessions: sessions,
      onlineConnections: ctx.hub.size,
      disk,
      version: ctx.config.version,
    };
  });

  // ---- Nutzer & Rollen ----

  async function adminUser(id: string): Promise<AdminUserDto> {
    const u = await ctx.db.user.findUniqueOrThrow({ where: { id }, include: { _count: { select: { library: true } } } });
    const { used } = await ctx.uploads.quotaFor(u);
    return {
      ...userPublic(u),
      email: u.email,
      disabled: u.disabled,
      totpEnabled: u.totpEnabled,
      lastLoginAt: iso(u.lastLoginAt),
      uploadQuotaBytes: u.uploadQuotaBytes !== null ? Number(u.uploadQuotaBytes) : null,
      usedUploadBytes: used,
      libraryCount: u._count.library,
    };
  }

  app.get(
    '/users',
    {
      schema: {
        tags: ['admin'],
        summary: 'Nutzer auflisten',
        querystring: z.object({ q: z.string().trim().max(100).optional(), role: z.enum(['ADMIN', 'UPLOADER', 'USER']).optional(), ...pageQuery }),
      },
    },
    async (req): Promise<Paginated<AdminUserDto>> => {
      const { q, role, page, pageSize } = req.query;
      const where: Prisma.UserWhereInput = {
        ...(role ? { role } : {}),
        ...(q
          ? {
              OR: [
                { username: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { displayName: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        ctx.db.user.findMany({ where, orderBy: { createdAt: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true } }),
        ctx.db.user.count({ where }),
      ]);
      return { items: await Promise.all(rows.map((r) => adminUser(r.id))), total, page, pageSize };
    },
  );

  app.post(
    '/users',
    {
      schema: {
        tags: ['admin'],
        summary: 'Nutzer anlegen',
        body: z.object({
          username: usernameSchema,
          email: z.string().trim().toLowerCase().email(),
          password: passwordSchema,
          role: z.enum(['ADMIN', 'UPLOADER', 'USER']).default('USER'),
        }),
      },
    },
    async (req) => {
      const { password, ...rest } = req.body;
      const u = await ctx.db.user.create({ data: { ...rest, passwordHash: await hashPassword(password) } });
      await ctx.audit.log({ userId: req.auth!.user.id, action: 'admin.user_created', target: u.id, meta: { username: u.username, role: u.role }, ip: req.ip });
      return adminUser(u.id);
    },
  );

  app.patch(
    '/users/:id',
    {
      schema: {
        tags: ['admin'],
        summary: 'Nutzer bearbeiten (Rolle, Sperre, Kontingent, 2FA zurücksetzen, Passwort)',
        params: z.object({ id: z.string() }),
        body: z.object({
          role: z.enum(['ADMIN', 'UPLOADER', 'USER']).optional(),
          disabled: z.boolean().optional(),
          uploadQuotaBytes: z.number().int().min(0).nullable().optional(),
          resetTotp: z.boolean().optional(),
          password: passwordSchema.optional(),
          email: z.string().trim().toLowerCase().email().optional(),
          displayName: z.string().trim().max(64).nullable().optional(),
        }),
      },
    },
    async (req) => {
      const me = req.auth!.user;
      const target = await ctx.db.user.findUnique({ where: { id: req.params.id } });
      if (!target) throw notFound('Nutzer nicht gefunden');
      const { role, disabled, uploadQuotaBytes, resetTotp, password, ...rest } = req.body;
      if (target.id === me.id && ((role && role !== 'ADMIN') || disabled)) {
        throw badRequest('Du kannst dir selbst nicht die Admin-Rechte entziehen oder dich sperren', 'self_lockout');
      }
      if (target.role === 'ADMIN' && ((role && role !== 'ADMIN') || disabled)) {
        const admins = await ctx.db.user.count({ where: { role: 'ADMIN', disabled: false } });
        if (admins <= 1) throw badRequest('Es muss mindestens ein aktiver Admin bleiben', 'last_admin');
      }
      const data: Prisma.UserUpdateInput = { ...rest };
      if (role) data.role = role;
      if (disabled !== undefined) data.disabled = disabled;
      if (uploadQuotaBytes !== undefined) data.uploadQuotaBytes = uploadQuotaBytes === null ? null : BigInt(uploadQuotaBytes);
      if (resetTotp) Object.assign(data, { totpEnabled: false, totpSecret: null, totpLastCounter: null, recoveryCodes: [] });
      if (password) data.passwordHash = await hashPassword(password);
      await ctx.db.user.update({ where: { id: target.id }, data });
      if (disabled || password) await ctx.db.session.deleteMany({ where: { userId: target.id } });
      await ctx.audit.log({
        userId: me.id,
        action: 'admin.user_updated',
        target: target.id,
        meta: { username: target.username, fields: Object.keys(req.body) },
        ip: req.ip,
      });
      return adminUser(target.id);
    },
  );

  app.delete('/users/:id', { schema: { tags: ['admin'], summary: 'Nutzer löschen', params: z.object({ id: z.string() }) } }, async (req) => {
    const me = req.auth!.user;
    if (req.params.id === me.id) throw badRequest('Du kannst dich nicht selbst löschen', 'self_delete');
    const target = await ctx.db.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('Nutzer nicht gefunden');
    if (target.avatarKey) await ctx.storage.remove(target.avatarKey);
    await ctx.db.user.delete({ where: { id: target.id } });
    await ctx.audit.log({ userId: me.id, action: 'admin.user_deleted', target: target.id, meta: { username: target.username }, ip: req.ip });
    return { ok: true };
  });

  app.get('/users/:id/sessions', { schema: { tags: ['admin'], summary: 'Sessions eines Nutzers', params: z.object({ id: z.string() }) } }, async (req) => {
    const sessions = await ctx.db.session.findMany({ where: { userId: req.params.id }, orderBy: { lastUsedAt: 'desc' } });
    return sessions.map((s) => ({
      id: s.id,
      kind: s.kind,
      name: s.name,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: false,
    }));
  });

  app.delete(
    '/users/:id/sessions/:sessionId',
    { schema: { tags: ['admin'], summary: 'Session eines Nutzers widerrufen', params: z.object({ id: z.string(), sessionId: z.string() }) } },
    async (req) => {
      await ctx.db.session.deleteMany({ where: { id: req.params.sessionId, userId: req.params.id } });
      ctx.hub.toSession(req.params.sessionId, { type: 'session.revoked', data: { sessionId: req.params.sessionId } });
      await ctx.audit.log({ userId: req.auth!.user.id, action: 'admin.session_revoked', target: req.params.sessionId, ip: req.ip });
      return { ok: true };
    },
  );

  // ---- Einladungen ----

  const inviteDto = (i: Prisma.InviteGetPayload<{ include: { createdBy: true } }>): InviteDto => ({
    id: i.id,
    code: i.code,
    url: new URL(`/register?invite=${i.code}`, ctx.config.PUBLIC_URL).toString(),
    role: i.role,
    maxUses: i.maxUses,
    uses: i.uses,
    note: i.note,
    expiresAt: iso(i.expiresAt),
    revoked: i.revoked,
    createdAt: i.createdAt.toISOString(),
    createdBy: i.createdBy ? userPublic(i.createdBy) : null,
  });

  app.get('/invites', { schema: { tags: ['admin'], summary: 'Einladungen' } }, async () => {
    const list = await ctx.db.invite.findMany({ include: { createdBy: true }, orderBy: { createdAt: 'desc' } });
    return list.map(inviteDto);
  });

  app.post(
    '/invites',
    {
      schema: {
        tags: ['admin'],
        summary: 'Einladungslink erzeugen',
        body: z.object({
          role: z.enum(['ADMIN', 'UPLOADER', 'USER']).default('USER'),
          maxUses: z.number().int().min(1).max(10_000).default(1),
          expiresInDays: z.number().int().min(1).max(365).nullable().default(14),
          note: z.string().max(200).optional(),
        }),
      },
    },
    async (req) => {
      const { expiresInDays, ...rest } = req.body;
      const invite = await ctx.db.invite.create({
        data: {
          ...rest,
          code: readableCode(12),
          expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86400_000) : null,
          createdById: req.auth!.user.id,
        },
        include: { createdBy: true },
      });
      await ctx.audit.log({ userId: req.auth!.user.id, action: 'admin.invite_created', target: invite.id, meta: { role: invite.role }, ip: req.ip });
      return inviteDto(invite);
    },
  );

  app.delete('/invites/:id', { schema: { tags: ['admin'], summary: 'Einladung widerrufen', params: z.object({ id: z.string() }) } }, async (req) => {
    await ctx.db.invite.update({ where: { id: req.params.id }, data: { revoked: true } });
    await ctx.audit.log({ userId: req.auth!.user.id, action: 'admin.invite_revoked', target: req.params.id, ip: req.ip });
    return { ok: true };
  });

  // ---- Einstellungen ----

  app.get('/settings', { schema: { tags: ['admin'], summary: 'Einstellungen' }, config: { allowInMaintenance: true } }, async () => ctx.settings.get());

  app.patch(
    '/settings',
    {
      schema: {
        tags: ['admin'],
        summary: 'Einstellungen ändern',
        body: z
          .object({
            siteName: z.string().trim().min(1).max(100),
            siteDescription: z.string().max(500),
            registrationMode: z.enum(['open', 'invite', 'closed']),
            maintenanceMode: z.boolean(),
            maintenanceMessage: z.string().max(1000),
            storePublic: z.boolean(),
            maxUploadFileBytes: z.number().int().min(1024 ** 2),
            defaultUploadQuotaBytes: z.number().int().min(0),
            maxConcurrentUploadsPerUser: z.number().int().min(1).max(1000),
            downloadRateLimitKbps: z.number().int().min(0),
            uploadChunkBytes: z.number().int().min(1024 ** 2).max(256 * 1024 ** 2),
            backupSchedule: z.object({
              enabled: z.boolean(),
              intervalHours: z.number().int().min(1).max(24 * 30),
              includeFiles: z.boolean(),
              keep: z.number().int().min(0).max(1000),
            }),
          })
          .partial(),
      },
      config: { allowInMaintenance: true },
    },
    async (req) => {
      const updated = await ctx.settings.update(req.body);
      await ctx.audit.log({ userId: req.auth!.user.id, action: 'admin.settings_updated', meta: req.body, ip: req.ip });
      return updated;
    },
  );

  app.post(
    '/settings/test-mail',
    { schema: { tags: ['admin'], summary: 'Test-E-Mail an den eigenen Account senden' } },
    async (req) => {
      const me = req.auth!.user;
      const settings = await ctx.settings.get();
      try {
        await ctx.mailer.send({ to: me.email, subject: `${settings.siteName}: Test-E-Mail`, text: 'SMTP funktioniert. 🎮' });
      } catch (err) {
        throw badRequest(`E-Mail konnte nicht gesendet werden: ${err instanceof Error ? err.message : String(err)}`, 'smtp_error');
      }
      return { ok: true };
    },
  );

  // ---- Ankündigungen ----

  const announcementBody = z.object({
    title: z.string().trim().min(1).max(200),
    body: z.string().max(50_000),
    published: z.boolean().default(true),
    pinned: z.boolean().default(false),
    gameId: z.string().nullable().optional(),
  });

  app.get('/announcements', { schema: { tags: ['admin'], summary: 'Alle Ankündigungen' } }, async () => {
    const list = await ctx.db.announcement.findMany({ include: announcementInclude, orderBy: { createdAt: 'desc' } });
    return list.map(announcementDto);
  });

  app.post('/announcements', { schema: { tags: ['admin'], summary: 'Ankündigung erstellen', body: announcementBody } }, async (req) => {
    const a = await ctx.db.announcement.create({ data: { ...req.body, authorId: req.auth!.user.id }, include: announcementInclude });
    if (a.published) ctx.hub.broadcast({ type: 'announcement.created', data: announcementDto(a) });
    return announcementDto(a);
  });

  app.patch(
    '/announcements/:id',
    { schema: { tags: ['admin'], summary: 'Ankündigung bearbeiten', params: z.object({ id: z.string() }), body: announcementBody.partial() } },
    async (req) => {
      const a = await ctx.db.announcement.update({ where: { id: req.params.id }, data: req.body, include: announcementInclude });
      return announcementDto(a);
    },
  );

  app.delete('/announcements/:id', { schema: { tags: ['admin'], summary: 'Ankündigung löschen', params: z.object({ id: z.string() }) } }, async (req) => {
    await ctx.db.announcement.delete({ where: { id: req.params.id } });
    return { ok: true };
  });

  // ---- Speicher ----

  app.get('/storage', { schema: { tags: ['admin'], summary: 'Speicherübersicht' } }, async (): Promise<StorageOverview> => {
    const [disk, media, avatars, uploads, backups, perGame] = await Promise.all([
      ctx.storage.disk(),
      ctx.storage.dirSize('media'),
      ctx.storage.dirSize('avatars'),
      ctx.storage.dirSize('uploads'),
      ctx.storage.dirSize('backups'),
      ctx.db.game.findMany({
        select: {
          id: true,
          slug: true,
          title: true,
          _count: { select: { versions: true } },
          versions: { select: { builds: { select: { totalSize: true } } } },
        },
      }),
    ]);
    const games = perGame
      .map((g) => ({
        id: g.id,
        slug: g.slug,
        title: g.title,
        versions: g._count.versions,
        bytes: g.versions.reduce((s, v) => s + v.builds.reduce((t, b) => t + Number(b.totalSize), 0), 0),
      }))
      .sort((a, b) => b.bytes - a.bytes);
    return {
      disk,
      builds: games.reduce((s, g) => s + g.bytes, 0),
      media,
      avatars,
      pendingUploads: uploads,
      backups,
      games,
    };
  });

  app.get('/uploads', { schema: { tags: ['admin'], summary: 'Alle aktiven Uploads' } }, async () => {
    const list = await ctx.db.upload.findMany({
      where: { status: 'ACTIVE' },
      include: { user: true, build: { include: { version: { include: { game: true } } } } },
      orderBy: { updatedAt: 'desc' },
    });
    return list.map((u) => ({
      id: u.id,
      path: u.path,
      size: Number(u.size),
      offset: Number(u.offset),
      updatedAt: u.updatedAt.toISOString(),
      user: userPublic(u.user),
      game: { id: u.build.version.game.id, title: u.build.version.game.title },
      version: u.build.version.version,
      platform: u.build.platform,
    }));
  });

  app.delete('/uploads/:id', { schema: { tags: ['admin'], summary: 'Upload abbrechen', params: z.object({ id: z.string() }) } }, async (req) => {
    await ctx.uploads.cancel(req.auth!.user, req.params.id);
    return { ok: true };
  });

  // ---- Logs ----

  app.get(
    '/logs/audit',
    {
      schema: {
        tags: ['admin'],
        summary: 'Audit-Log',
        querystring: z.object({ action: z.string().max(100).optional(), userId: z.string().optional(), ...pageQuery }),
      },
    },
    async (req): Promise<Paginated<AuditLogDto>> => {
      const { action, userId, page, pageSize } = req.query;
      const where: Prisma.AuditLogWhereInput = {
        ...(action ? { action: { startsWith: action } } : {}),
        ...(userId ? { userId } : {}),
      };
      const [rows, total] = await Promise.all([
        ctx.db.auditLog.findMany({ where, include: { user: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        ctx.db.auditLog.count({ where }),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.id,
          action: r.action,
          target: r.target,
          meta: (r.meta ?? {}) as Record<string, unknown>,
          ip: r.ip,
          createdAt: r.createdAt.toISOString(),
          user: r.user ? userPublic(r.user) : null,
        })),
        total,
        page,
        pageSize,
      };
    },
  );

  app.get(
    '/logs/server',
    {
      schema: {
        tags: ['admin'],
        summary: 'Server-Log (Ringpuffer)',
        querystring: z.object({
          level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
          q: z.string().max(200).optional(),
          limit: z.coerce.number().int().min(1).max(2000).default(500),
        }),
      },
      config: { allowInMaintenance: true },
    },
    async (req) => ctx.logs.list(req.query),
  );

  // ---- Backups ----

  app.get('/backups', { schema: { tags: ['admin'], summary: 'Backups' } }, async () => ctx.backups.list());

  app.post(
    '/backups',
    { schema: { tags: ['admin'], summary: 'Backup starten', body: z.object({ includeFiles: z.boolean().default(false) }) } },
    async (req) => ctx.backups.start(req.body.includeFiles, req.auth!.user.id),
  );

  app.get(
    '/backups/:id/download',
    { schema: { tags: ['admin'], summary: 'Backup herunterladen', params: z.object({ id: z.string() }) }, config: { rateLimit: false } },
    async (req, reply) => {
      const b = await ctx.backups.get(req.params.id);
      if (b.status !== 'COMPLETED') throw badRequest('Backup ist nicht fertig', 'backup_not_ready');
      return sendFile(req, reply, { filePath: ctx.backups.filePath(b), size: Number(b.size), filename: b.filename, contentType: 'application/gzip' });
    },
  );

  app.delete('/backups/:id', { schema: { tags: ['admin'], summary: 'Backup löschen', params: z.object({ id: z.string() }) } }, async (req) => {
    await ctx.backups.remove(req.params.id);
    await ctx.audit.log({ userId: req.auth!.user.id, action: 'backup.deleted', target: req.params.id, ip: req.ip });
    return { ok: true };
  });

  // ---- Genres & Tags ----

  app.delete('/genres/:id', { schema: { tags: ['admin'], summary: 'Genre löschen', params: z.object({ id: z.string() }) } }, async (req) => {
    await ctx.db.genre.delete({ where: { id: req.params.id } });
    return { ok: true };
  });

  app.delete('/tags/:id', { schema: { tags: ['admin'], summary: 'Tag löschen', params: z.object({ id: z.string() }) } }, async (req) => {
    await ctx.db.tag.delete({ where: { id: req.params.id } });
    return { ok: true };
  });
};
