import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type {
  FederatedServerDto,
  FederationInfo,
  FederationPairingCode,
  NetworkGameDto,
  RemoteAdminOverview,
  RemoteDownloadDto,
  RemoteGameDto,
  RemoteSettingsDto,
  RemoteUserDto,
} from '@gameserver/shared';
import { requireAdmin, requireAuth, requireNetworkAdmin } from '../plugins/auth.js';
import { notFound } from '../lib/errors.js';
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

  // --- Stufe 2: öffentliche Liste aktiver Peers (für den Login-Auswahldialog) ---
  app.get('/federation/peers', { schema: { tags: ['federation'], summary: 'Verbundene Server (für föderierten Login)' }, config: { allowInMaintenance: true } }, async () => fed.listPeers());

  // --- Stufe 2: Heimat-Server tauscht Login-Code gegen Identität (peer-signiert) ---
  app.post(
    '/federation/auth/exchange/:code',
    { schema: { tags: ['federation'], summary: 'Login-Code gegen Nutzeridentität eintauschen', params: z.object({ code: z.string().min(10).max(200) }) }, config: { skipCsrf: true } },
    async (req) => {
      const peer = await fed.verifyPeer(req.headers as Record<string, unknown>, req.method, req.url);
      return fed.exchangeAuthCode(req.params.code, peer.id);
    },
  );

  // --- Stufe 2: Heimat-Server erteilt Zustimmung (angemeldeter Nutzer) ---
  app.post(
    '/federation/authorize/approve',
    { schema: { tags: ['federation'], summary: 'Föderierten Login für einen anderen Server bestätigen', body: z.object({ origin: z.string().url().max(300), redirect: z.string().url().max(400), state: z.string().max(600) }) } },
    async (req) => {
      const { user } = requireAuth(req);
      return fed.authorizeApprove(user, req.body.origin, req.body.redirect, req.body.state);
    },
  );

  // --- Stufe 3: Heimat-Server liefert Identität eines lokalen Nutzers (peer-signiert) ---
  app.get(
    '/federation/users/:username',
    { schema: { tags: ['federation'], summary: 'Nutzeridentität für Netzwerk-DM', params: z.object({ username: z.string().min(1).max(60) }) }, config: { skipCsrf: true } },
    async (req) => {
      await fed.verifyPeer(req.headers as Record<string, unknown>, req.method, req.url);
      const identity = await fed.localUserIdentity(req.params.username);
      if (!identity) throw notFound('Nutzer nicht gefunden');
      return identity;
    },
  );

  // --- Stufe 3: eingehende föderierte Chat-Nachricht (peer-signiert) ---
  app.post(
    '/federation/chat/deliver',
    {
      schema: {
        tags: ['federation'],
        summary: 'Föderierte Chat-Nachricht zustellen',
        body: z.object({
          federationId: z.string().min(5).max(60),
          from: z.object({ userId: z.string().max(60), username: z.string().max(60), displayName: z.string().max(200).nullable() }),
          toUserId: z.string().max(60),
          body: z.string().max(4000),
          gifUrl: z.string().url().max(500).nullable(),
          sentAt: z.string().max(40),
        }),
      },
      config: { skipCsrf: true },
    },
    async (req) => {
      const peer = await fed.verifyPeer(req.headers as Record<string, unknown>, req.method, req.url);
      return fed.deliverIncomingChat(peer, req.body);
    },
  );

  // --- Fern-Administration, R-Seite (peer-signiert; jeder ACTIVE-Peer, Berechtigung liegt beim Netzwerk-Admin auf der Hub-Seite) ---
  // Mutationen tragen ihre Parameter in der signierten URL (Query), nicht im unsignierten Body.
  app.get('/federation/admin/overview', { schema: { tags: ['federation'], summary: 'Übersicht für die Fernverwaltung' }, config: { skipCsrf: true } }, async (req): Promise<RemoteAdminOverview> => {
    await fed.verifyPeer(req.headers as Record<string, unknown>, req.method, req.url);
    return fed.localOverview();
  });

  app.get(
    '/federation/admin/users',
    { schema: { tags: ['federation'], summary: 'Nutzerliste für die Fernverwaltung', querystring: z.object({ q: z.string().trim().max(100).optional() }) }, config: { skipCsrf: true } },
    async (req): Promise<RemoteUserDto[]> => {
      await fed.verifyPeer(req.headers as Record<string, unknown>, req.method, req.url);
      return fed.localUsers(req.query.q);
    },
  );

  app.post(
    '/federation/admin/users/:id',
    {
      schema: {
        tags: ['federation'],
        summary: 'Nutzer per Fernverwaltung ändern',
        params: z.object({ id: z.string() }),
        querystring: z.object({
          role: z.enum(['ADMIN', 'UPLOADER', 'USER']).optional(),
          disabled: z.enum(['true', 'false']).optional(),
          networkAdmin: z.enum(['true', 'false']).optional(),
        }),
      },
      config: { skipCsrf: true },
    },
    async (req): Promise<RemoteUserDto> => {
      await fed.verifyPeer(req.headers as Record<string, unknown>, req.method, req.url);
      const disabled = req.query.disabled === undefined ? undefined : req.query.disabled === 'true';
      const networkAdmin = req.query.networkAdmin === undefined ? undefined : req.query.networkAdmin === 'true';
      return fed.localUpdateUser(req.params.id, { role: req.query.role, disabled, networkAdmin });
    },
  );

  app.get('/federation/admin/settings', { schema: { tags: ['federation'], summary: 'Betriebseinstellungen für die Fernverwaltung' }, config: { skipCsrf: true } }, async (req): Promise<RemoteSettingsDto> => {
    await fed.verifyPeer(req.headers as Record<string, unknown>, req.method, req.url);
    return fed.localSettings();
  });

  app.post(
    '/federation/admin/settings',
    {
      schema: {
        tags: ['federation'],
        summary: 'Betriebseinstellungen per Fernverwaltung ändern',
        querystring: z.object({
          siteName: z.string().trim().min(1).max(100).optional(),
          siteDescription: z.string().max(500).optional(),
          registrationMode: z.enum(['open', 'invite', 'closed']).optional(),
          storePublic: z.enum(['true', 'false']).optional(),
          maintenanceMode: z.enum(['true', 'false']).optional(),
          maintenanceMessage: z.string().max(1000).optional(),
        }),
      },
      config: { skipCsrf: true },
    },
    async (req): Promise<RemoteSettingsDto> => {
      await fed.verifyPeer(req.headers as Record<string, unknown>, req.method, req.url);
      const q = req.query;
      return fed.localUpdateSettings({
        siteName: q.siteName,
        siteDescription: q.siteDescription,
        registrationMode: q.registrationMode,
        storePublic: q.storePublic === undefined ? undefined : q.storePublic === 'true',
        maintenanceMode: q.maintenanceMode === undefined ? undefined : q.maintenanceMode === 'true',
        maintenanceMessage: q.maintenanceMessage,
      });
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

  // --- Fern-Administration, Hub-Seite (nur Netzwerk-Admins; jeder ACTIVE-Server im Verbund) ---
  app.get('/admin/federation/servers/:id/remote/overview', { schema: { tags: ['federation'], summary: 'Übersicht eines fernverwalteten Servers', params: z.object({ id: z.string() }) } }, async (req): Promise<RemoteAdminOverview> => {
    requireNetworkAdmin(req);
    return fed.remoteOverview(req.params.id);
  });

  app.get(
    '/admin/federation/servers/:id/remote/users',
    { schema: { tags: ['federation'], summary: 'Nutzer eines fernverwalteten Servers', params: z.object({ id: z.string() }), querystring: z.object({ q: z.string().trim().max(100).optional() }) } },
    async (req): Promise<RemoteUserDto[]> => {
      requireNetworkAdmin(req);
      return fed.remoteUsers(req.params.id, req.query.q);
    },
  );

  app.patch(
    '/admin/federation/servers/:id/remote/users/:userId',
    {
      schema: {
        tags: ['federation'],
        summary: 'Nutzer eines fernverwalteten Servers ändern',
        params: z.object({ id: z.string(), userId: z.string() }),
        body: z.object({ role: z.enum(['ADMIN', 'UPLOADER', 'USER']).optional(), disabled: z.boolean().optional(), networkAdmin: z.boolean().optional() }),
      },
    },
    async (req): Promise<RemoteUserDto> => {
      requireNetworkAdmin(req);
      const server = await fed.remoteUpdateUser(req.params.id, req.params.userId, req.body);
      await ctx.audit.log({ userId: req.auth!.user.id, action: 'federation.remote_user_update', target: req.params.id, meta: { userId: req.params.userId, ...req.body }, ip: req.ip });
      return server;
    },
  );

  app.get('/admin/federation/servers/:id/remote/settings', { schema: { tags: ['federation'], summary: 'Betriebseinstellungen eines fernverwalteten Servers', params: z.object({ id: z.string() }) } }, async (req): Promise<RemoteSettingsDto> => {
    requireNetworkAdmin(req);
    return fed.remoteSettings(req.params.id);
  });

  app.patch(
    '/admin/federation/servers/:id/remote/settings',
    {
      schema: {
        tags: ['federation'],
        summary: 'Betriebseinstellungen eines fernverwalteten Servers ändern',
        params: z.object({ id: z.string() }),
        body: z.object({
          siteName: z.string().trim().min(1).max(100).optional(),
          siteDescription: z.string().max(500).optional(),
          registrationMode: z.enum(['open', 'invite', 'closed']).optional(),
          storePublic: z.boolean().optional(),
          maintenanceMode: z.boolean().optional(),
          maintenanceMessage: z.string().max(1000).optional(),
        }),
      },
    },
    async (req): Promise<RemoteSettingsDto> => {
      requireNetworkAdmin(req);
      const server = await fed.remoteUpdateSettings(req.params.id, req.body);
      await ctx.audit.log({ userId: req.auth!.user.id, action: 'federation.remote_settings_update', target: req.params.id, meta: req.body, ip: req.ip });
      return server;
    },
  );

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

  // --- Stufe 3: Remote-Nutzer suchen, um eine Netzwerk-DM zu starten ---
  app.post(
    '/network/users/lookup',
    { schema: { tags: ['federation'], summary: 'Nutzer auf einem verbundenen Server suchen', body: z.object({ serverId: z.string(), username: z.string().min(1).max(60) }) } },
    async (req): Promise<{ userId: string; username: string; displayName: string | null }> => {
      requireAuth(req);
      const user = await fed.lookupRemoteUser(req.body.serverId, req.body.username);
      return { userId: user.id, username: user.username, displayName: user.displayName };
    },
  );
};
