import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type {
  FederatedServerDto,
  FederationInfo,
  FederationPairingCode,
  NetworkGameDto,
  RemoteDownloadDto,
  RemoteGameDto,
} from '@gameserver/shared';
import { requireAdmin, requireAuth } from '../plugins/auth.js';
import { iso } from '../lib/time.js';

/**
 * Föderation (Stufe 1): Netzwerk aus mehreren Servern.
 * - Öffentlich: /federation/info (Kennung für das Pairing)
 * - Peer-signiert: /federation/games, /federation/download/:buildId
 * - Per Pairing-Code: /federation/pair
 * - Admin: /admin/federation/* (Server verwalten)
 * - Nutzer: /network/* (Netzwerk-Katalog + Download anfordern)
 */
export const federationRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const fed = ctx.federation;

  // --- Öffentlich: eigene Kennung (für das Pairing) ---
  app.get(
    '/federation/info',
    { schema: { tags: ['federation'], summary: 'Öffentliche Kennung dieses Servers' }, config: { allowInMaintenance: true } },
    async (): Promise<FederationInfo> => fed.selfInfo(),
  );

  // --- Peer-signiert: Katalog ausliefern ---
  app.get(
    '/federation/games',
    { schema: { tags: ['federation'], summary: 'Öffentlicher Katalog für verbundene Server' }, config: { skipCsrf: true } },
    async (req): Promise<RemoteGameDto[]> => {
      await fed.verifyPeer(req.headers as Record<string, unknown>, req.method, req.url);
      return fed.exportCatalog();
    },
  );

  // --- Peer-signiert: signierte Download-URLs für einen Build ---
  app.post(
    '/federation/download/:buildId',
    { schema: { tags: ['federation'], summary: 'Signierte Datei-URLs für einen öffentlichen Build', params: z.object({ buildId: z.string() }) }, config: { skipCsrf: true } },
    async (req): Promise<RemoteDownloadDto> => {
      await fed.verifyPeer(req.headers as Record<string, unknown>, req.method, req.url);
      return fed.grantDownload(req.params.buildId);
    },
  );

  // --- Per Pairing-Code: eingehende Anmeldung eines anderen Servers ---
  app.post(
    '/federation/pair',
    {
      schema: {
        tags: ['federation'],
        summary: 'Mit Pairing-Code bei diesem Server anmelden',
        body: z.object({
          code: z.string().min(10).max(100),
          name: z.string().min(1).max(100),
          baseUrl: z.string().url().max(300),
          publicKey: z.string().min(20).max(2000),
        }),
      },
      config: { skipCsrf: true, allowInMaintenance: true },
    },
    async (req): Promise<{ ok: true }> => {
      const { code, name, baseUrl, publicKey } = req.body;
      await fed.acceptPairing(code, { name, baseUrl, publicKey });
      return { ok: true };
    },
  );

  // --- Admin: verbundene Server verwalten (requireAdmin je Handler) ---
  app.get('/admin/federation/self', { schema: { tags: ['federation'], summary: 'Eigene Föderations-Kennung' } }, async (req): Promise<FederationInfo> => {
    requireAdmin(req);
    return fed.selfInfo();
  });

  app.get('/admin/federation/servers', { schema: { tags: ['federation'], summary: 'Verbundene Server auflisten' } }, async (req): Promise<FederatedServerDto[]> => {
    requireAdmin(req);
    return fed.listServers();
  });

  app.post('/admin/federation/pairing-code', { schema: { tags: ['federation'], summary: 'Pairing-Code erzeugen' } }, async (req): Promise<FederationPairingCode> => {
    requireAdmin(req);
    const { code, expiresAt } = fed.createPairingCode();
    const me = await fed.selfInfo();
    await ctx.audit.log({ userId: req.auth!.user.id, action: 'federation.pairing_code', ip: req.ip });
    return { code, baseUrl: me.baseUrl, name: me.name, expiresAt: iso(expiresAt)! };
  });

  app.post(
    '/admin/federation/connect',
    { schema: { tags: ['federation'], summary: 'Mit einem anderen Server verbinden', body: z.object({ baseUrl: z.string().url().max(300), code: z.string().min(10).max(100) }) } },
    async (req): Promise<FederatedServerDto> => {
      requireAdmin(req);
      const server = await fed.connect(req.body.baseUrl, req.body.code);
      await ctx.audit.log({ userId: req.auth!.user.id, action: 'federation.connect', target: server.id, meta: { baseUrl: server.baseUrl }, ip: req.ip });
      return server;
    },
  );

  app.post('/admin/federation/servers/:id/sync', { schema: { tags: ['federation'], summary: 'Katalog eines Servers jetzt abgleichen', params: z.object({ id: z.string() }) } }, async (req): Promise<FederatedServerDto> => {
    requireAdmin(req);
    await fed.syncOne(req.params.id);
    const list = await fed.listServers();
    const found = list.find((s) => s.id === req.params.id);
    if (!found) throw new Error('not_found');
    return found;
  });

  app.patch(
    '/admin/federation/servers/:id',
    { schema: { tags: ['federation'], summary: 'Status eines verbundenen Servers ändern', params: z.object({ id: z.string() }), body: z.object({ status: z.enum(['ACTIVE', 'BLOCKED', 'PENDING']) }) } },
    async (req): Promise<FederatedServerDto> => {
      requireAdmin(req);
      const server = await fed.setStatus(req.params.id, req.body.status);
      await ctx.audit.log({ userId: req.auth!.user.id, action: 'federation.set_status', target: server.id, meta: { status: req.body.status }, ip: req.ip });
      return server;
    },
  );

  app.delete('/admin/federation/servers/:id', { schema: { tags: ['federation'], summary: 'Verbundenen Server entfernen', params: z.object({ id: z.string() }) } }, async (req): Promise<{ ok: true }> => {
    requireAdmin(req);
    await fed.remove(req.params.id);
    await ctx.audit.log({ userId: req.auth!.user.id, action: 'federation.remove', target: req.params.id, ip: req.ip });
    return { ok: true };
  });

  // --- Nutzer: Netzwerk-Katalog + Download anfordern ---
  app.get('/network/games', { schema: { tags: ['federation'], summary: 'Spiele im verbundenen Netzwerk' } }, async (req): Promise<NetworkGameDto[]> => {
    requireAuth(req);
    return fed.networkGames();
  });

  app.post(
    '/network/games/:serverId/builds/:buildId/download',
    { schema: { tags: ['federation'], summary: 'Signierte Download-URLs für ein Netzwerk-Spiel anfordern', params: z.object({ serverId: z.string(), buildId: z.string() }) } },
    async (req): Promise<RemoteDownloadDto> => {
      requireAuth(req);
      return fed.requestDownload(req.params.serverId, req.params.buildId);
    },
  );
};
