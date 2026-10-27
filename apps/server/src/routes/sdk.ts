import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AchievementDetection, PlayStartResponse } from '@gameserver/shared';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { DAY_MS } from '../lib/time.js';
import { GAME_TOKEN_PREFIX, requireAuth } from '../plugins/auth.js';
import { canViewGame } from '../services/access.js';
import { gameRef } from '../services/achievements.js';
import { parentalStatus } from '../services/family.js';
import { extractBearer } from '../services/sessions.js';
import { savePathsOf } from './cloud.js';

/**
 * Spielstart (Desktop-Client) und Achievement-SDK.
 *
 * Der Client ruft beim Start `POST /api/play/:gameId/start` auf und übergibt dem Spiel per Umgebungsvariablen
 * `GS_API_URL`, `GS_GAME_ID` und `GS_GAME_TOKEN`. Mit diesem Token (gültig 24 h, nur dieses Spiel) kann das Spiel über
 * `/api/sdk/*` Achievements lesen und freischalten – ohne Zugriff auf das restliche Konto.
 */
export const playRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const { db } = ctx;

  app.post(
    '/play/:gameId/start',
    { schema: { tags: ['sdk'], summary: 'Spielstart vorbereiten: SDK-Token, Kindersicherung, Erkennungsregeln, Cloud-Stand', params: z.object({ gameId: z.string() }) } },
    async (req): Promise<PlayStartResponse> => {
      const { user } = requireAuth(req);
      const game = await db.game.findUnique({ where: { id: req.params.gameId } });
      if (!game || !(await canViewGame(db, user, game))) throw notFound('Spiel nicht gefunden');
      const entry = await db.libraryEntry.findUnique({ where: { userId_gameId: { userId: user.id, gameId: game.id } } });
      if (!entry) throw forbidden('Spiel ist nicht in der Bibliothek', 'not_in_library');
      const parental = await parentalStatus(db, user);
      if (parental.remainingSeconds === 0) throw forbidden('Das tägliche Spielzeitlimit ist erreicht', 'playtime_limit');
      // Abgelaufene Tokens des Nutzers aufräumen
      await db.gameToken.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
      const token = GAME_TOKEN_PREFIX + randomToken(32);
      const expiresAt = new Date(Date.now() + DAY_MS);
      await db.gameToken.create({ data: { tokenHash: sha256Hex(token), userId: user.id, gameId: game.id, expiresAt } });
      const [detections, latest, settings] = await Promise.all([
        db.achievement.findMany({ where: { gameId: game.id }, select: { apiName: true, detection: true } }),
        db.cloudSave.findFirst({ where: { userId: user.id, gameId: game.id }, orderBy: { version: 'desc' } }),
        ctx.settings.get(),
      ]);
      return {
        gameToken: { token, expiresAt: expiresAt.toISOString(), gameId: game.id },
        parental,
        detection: detections.filter((d) => d.detection).map((d) => ({ apiName: d.apiName, detection: d.detection as unknown as AchievementDetection })),
        savePaths: savePathsOf(game.savePaths),
        cloud: { enabled: settings.cloudSavesEnabled, latestVersion: latest?.version ?? null, latestHash: latest?.contentHash ?? null },
        workshopPath: settings.workshopEnabled ? game.workshopPath : null,
      };
    },
  );

  app.get('/me/parental', { schema: { tags: ['sdk'], summary: 'Wirksame Kindersicherung (Spielzeit heute, Limits)' } }, async (req) => {
    const { user } = requireAuth(req);
    return parentalStatus(db, user);
  });
};

/** Prüft das Spiel-Token aus dem Authorization-Header. */
async function gameAuth(req: FastifyRequest) {
  const token = extractBearer(req);
  if (!token?.startsWith(GAME_TOKEN_PREFIX)) throw unauthorized('Spiel-Token fehlt', 'game_token_missing');
  const row = await req.server.ctx.db.gameToken.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true, game: true } });
  if (!row || row.expiresAt < new Date() || row.user.disabled) throw unauthorized('Spiel-Token ungültig oder abgelaufen', 'game_token_invalid');
  return row;
}

export const sdkRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const sdkConfig = { rateLimit: { max: 300, timeWindow: '1 minute' }, skipCsrf: true };

  app.get('/me', { schema: { tags: ['sdk'], summary: 'SDK: Nutzer und Spiel des Tokens' }, config: sdkConfig }, async (req) => {
    const t = await gameAuth(req);
    return { user: { id: t.user.id, username: t.user.username, displayName: t.user.displayName }, game: gameRef(t.game), expiresAt: t.expiresAt.toISOString() };
  });

  app.get('/achievements', { schema: { tags: ['sdk'], summary: 'SDK: Achievements des Spiels mit Fortschritt' }, config: sdkConfig }, async (req) => {
    const t = await gameAuth(req);
    // Das Spiel kennt seine eigenen Achievements – versteckte werden hier nicht maskiert
    return ctx.achievements.forUser(t.gameId, t.userId, true);
  });

  app.post(
    '/achievements/:apiName/unlock',
    { schema: { tags: ['sdk'], summary: 'SDK: Achievement freischalten', params: z.object({ apiName: z.string().max(64) }) }, config: sdkConfig },
    async (req) => {
      const t = await gameAuth(req);
      return ctx.achievements.unlock(t.userId, t.gameId, req.params.apiName, { source: 'sdk' });
    },
  );

  app.post(
    '/achievements/:apiName/progress',
    {
      schema: {
        tags: ['sdk'],
        summary: 'SDK: Fortschritt melden (schaltet bei Erreichen des Zielwerts frei)',
        params: z.object({ apiName: z.string().max(64) }),
        body: z.object({ progress: z.number().int().min(0).max(1_000_000_000) }),
      },
      config: sdkConfig,
    },
    async (req) => {
      const t = await gameAuth(req);
      return ctx.achievements.unlock(t.userId, t.gameId, req.params.apiName, { source: 'sdk', progress: req.body.progress });
    },
  );
};
