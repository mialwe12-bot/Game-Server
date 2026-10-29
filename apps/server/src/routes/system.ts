import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PublicSettings } from '@gameserver/shared';
import { notFound } from '../lib/errors.js';
import { sendFile } from '../lib/send.js';
import { sendStoredFile } from '../lib/image-upload.js';
import { canEditGame, canViewGame } from '../services/access.js';
import { userPublic } from '../services/dto.js';

export const systemRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;

  app.get(
    '/health',
    { schema: { tags: ['system'], summary: 'Healthcheck' }, config: { allowInMaintenance: true, rateLimit: false } },
    async () => {
      await ctx.db.$queryRaw`SELECT 1`;
      return { status: 'ok', version: ctx.config.version };
    },
  );

  app.get(
    '/settings/public',
    { schema: { tags: ['system'], summary: 'Öffentliche Einstellungen (Name, Registrierung, Wartung, SSO)' }, config: { allowInMaintenance: true } },
    async (): Promise<PublicSettings> => {
      const s = await ctx.settings.get();
      return {
        siteName: s.siteName,
        siteDescription: s.siteDescription,
        registrationMode: s.registrationMode,
        maintenanceMode: s.maintenanceMode,
        maintenanceMessage: s.maintenanceMessage,
        storePublic: s.storePublic,
        oidcEnabled: ctx.oidc.enabled,
        oidcName: ctx.config.OIDC_NAME,
        smtpEnabled: ctx.mailer.enabled,
        metadataProviders: ctx.metadata.available(),
        version: ctx.config.version,
        features: {
          cloudSaves: s.cloudSavesEnabled,
          workshop: s.workshopEnabled,
          cards: s.cardsEnabled,
          market: s.cardsEnabled && s.marketEnabled,
          gifts: s.giftsEnabled,
        },
        discordAppId: s.discordAppId,
        logoUrl: s.logoUrl,
        clientLogoUrl: s.clientLogoUrl,
        customCss: s.customCss,
      };
    },
  );

  // Öffentliches Branding-Logo (ohne Signatur, cachebar – Dateiname ist eindeutig)
  app.get(
    '/branding/:file',
    { schema: { tags: ['system'], summary: 'Branding-Logo', params: z.object({ file: z.string().regex(/^[\w.-]+$/) }) }, config: { allowInMaintenance: true, rateLimit: false } },
    async (req, reply) => sendStoredFile(req, reply, ctx.storage, `branding/${req.params.file}`),
  );

  app.get(
    '/media/:id',
    { schema: { tags: ['system'], summary: 'Spielbild', params: z.object({ id: z.string() }) }, config: { rateLimit: false } },
    async (req, reply) => {
      const media = await ctx.db.gameMedia.findUnique({ where: { id: req.params.id }, include: { game: true } });
      if (!media) throw notFound();
      const user = req.auth?.user ?? null;
      if (!(await canViewGame(ctx.db, user, media.game)) && !(await canEditGame(ctx.db, user, media.gameId))) throw notFound();
      const isPublic = media.game.visibility === 'PUBLIC' || media.game.visibility === 'UNLISTED';
      return sendFile(req, reply, {
        filePath: ctx.storage.resolve(media.storageKey),
        size: media.size,
        contentType: media.mimeType,
        etag: media.id,
        cacheControl: isPublic ? 'public, max-age=31536000, immutable' : 'private, max-age=3600',
      });
    },
  );

  app.get(
    '/users/:id/avatar',
    { schema: { tags: ['users'], summary: 'Avatar', params: z.object({ id: z.string() }) }, config: { rateLimit: false } },
    async (req, reply) => {
      const user = await ctx.db.user.findUnique({ where: { id: req.params.id } });
      if (!user?.avatarKey) throw notFound();
      const stat = await ctx.storage.stat(user.avatarKey).catch(() => null);
      if (!stat) throw notFound();
      const ext = user.avatarKey.split('.').pop();
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return sendFile(req, reply, {
        filePath: ctx.storage.resolve(user.avatarKey),
        size: stat.size,
        contentType: mime,
        etag: user.avatarKey.split('/').pop(),
        cacheControl: 'public, max-age=86400',
      });
    },
  );

  app.get(
    '/users/by-name/:username',
    { schema: { tags: ['users'], summary: 'Öffentliches Profil', params: z.object({ username: z.string().max(64) }) } },
    async (req) => {
      const user = await ctx.db.user.findFirst({ where: { username: { equals: req.params.username, mode: 'insensitive' }, disabled: false } });
      if (!user) throw notFound('Nutzer nicht gefunden');
      const [libraryCount, playtime] = await Promise.all([
        ctx.db.libraryEntry.count({ where: { userId: user.id } }),
        ctx.db.libraryEntry.aggregate({ where: { userId: user.id }, _sum: { playtimeSeconds: true } }),
      ]);
      return { ...userPublic(user), libraryCount, playtimeSeconds: playtime._sum.playtimeSeconds ?? 0 };
    },
  );
};
