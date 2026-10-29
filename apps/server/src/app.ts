import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { Prisma } from '@prisma/client';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { loadConfig, type Config } from './config.js';
import type { AppContext } from './context.js';
import { createDb, type Db } from './db.js';
import { HttpError } from './lib/errors.js';
import { createLogger, LogBuffer } from './logger.js';
import { authPlugin } from './plugins/auth.js';
import { maintenancePlugin } from './plugins/maintenance.js';
import { registerRoutes } from './routes/index.js';
import { AuditService } from './services/audit.js';
import { BackupService } from './services/backups.js';
import { Hub } from './services/hub.js';
import { Mailer } from './services/mailer.js';
import { MetadataService } from './services/metadata/index.js';
import { OidcService } from './services/oidc.js';
import { SettingsService } from './services/settings.js';
import { Storage } from './services/storage.js';
import { UploadService } from './services/uploads.js';
import { UrlSigner } from './lib/sign.js';
import { ActivityService, NotificationService } from './services/notify.js';
import { PresenceService } from './services/social.js';
import { ChatService } from './services/chat.js';
import { AchievementService } from './services/achievements.js';
import { CardService } from './services/cards.js';
import { FederationService } from './services/federation.js';
import { startEventReminders } from './services/groups.js';

// BigInt (Dateigrößen) sicher als Zahl serialisieren.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

export interface BuildOptions {
  config?: Config;
  db?: Db;
  /** Hintergrundjobs (Backup-Zeitplan, Aufräumen) starten. */
  jobs?: boolean;
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  const logs = new LogBuffer();
  const logger = createLogger(config.NODE_ENV === 'test' ? 'warn' : config.LOG_LEVEL, config.NODE_ENV === 'development', logs);

  const app = Fastify({
    loggerInstance: logger,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 0,
    routerOptions: { maxParamLength: 300 },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const db = opts.db ?? createDb(config.DATABASE_URL);
  const ctx = { config, db, logs } as AppContext;
  ctx.storage = new Storage(config.dataDir);
  ctx.settings = new SettingsService(db);
  ctx.audit = new AuditService(db);
  ctx.mailer = new Mailer(config);
  ctx.hub = new Hub();
  ctx.uploads = new UploadService(ctx);
  ctx.backups = new BackupService(ctx);
  ctx.metadata = new MetadataService(ctx);
  ctx.oidc = new OidcService(ctx);
  ctx.notifications = new NotificationService(ctx);
  ctx.activity = new ActivityService(ctx);
  ctx.presence = new PresenceService(ctx);
  ctx.chat = new ChatService(ctx);
  ctx.achievements = new AchievementService(ctx);
  ctx.cards = new CardService(ctx);
  ctx.signer = new UrlSigner(await ctx.settings.appSecret(config.APP_SECRET));
  ctx.federation = new FederationService(ctx);
  await ctx.federation.init();
  ctx.presence.start();
  app.decorate('ctx', ctx);
  await ctx.storage.init();

  ctx.settings.onChange((next, prev) => {
    if (next.maintenanceMode !== prev.maintenanceMode || next.maintenanceMessage !== prev.maintenanceMessage) {
      ctx.hub.broadcast({ type: 'maintenance', data: { enabled: next.maintenanceMode, message: next.maintenanceMessage } });
    }
  });

  await app.register(cookie);
  await app.register(helmet, {
    // Die API liefert JSON/Dateien; die CSP für die Weboberfläche setzt der Web-Container.
    contentSecurityPolicy: false,
    // Bilder/Dateien müssen auch in der WebView des Desktop-Clients (andere Origin) ladbar sein.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  if (config.corsOrigins.length) {
    // Für den Desktop-Client (Tauri-WebView) – Authentifizierung dort ausschließlich per Bearer-Token.
    await app.register(cors, {
      origin: config.corsOrigins,
      credentials: false,
      allowedHeaders: ['Authorization', 'Content-Type', 'Upload-Offset', 'Range'],
      exposedHeaders: ['Upload-Offset', 'Content-Range', 'Accept-Ranges', 'Content-Length'],
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    });
  }
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'rate_limited',
      message: `Zu viele Anfragen – bitte in ${Math.ceil(context.ttl / 1000)} s erneut versuchen`,
    }),
  });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 10 } });
  await app.register(websocket, {
    options: {
      maxPayload: 64 * 1024,
      // Desktop-Client authentifiziert sich per Subprotokoll "bearer.<token>" und erhält "gs.v1" zurück.
      handleProtocols: (protocols: Set<string>) => (protocols.has('gs.v1') ? 'gs.v1' : false),
    },
  });

  // Rohdaten-Chunks für fortsetzbare Uploads werden als Stream durchgereicht.
  app.addContentTypeParser('application/offset+octet-stream', (_req, payload, done) => done(null, payload));

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Game Server API',
        description: 'REST-API der selbst gehosteten Spieleplattform. Web: Cookie + X-CSRF-Token, Client: Bearer Device-Token.',
        version: config.version,
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          cookieAuth: { type: 'apiKey', in: 'cookie', name: 'gs_session' },
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  await app.register(authPlugin);
  await app.register(maintenancePlugin);

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: 'validation',
        message: 'Ungültige Eingabe',
        details: err.validation.map((v: { instancePath: string; message?: string }) => ({ path: v.instancePath, message: v.message })),
      });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return reply.code(409).send({ error: 'duplicate', message: 'Eintrag existiert bereits' });
      if (err.code === 'P2025') return reply.code(404).send({ error: 'not_found', message: 'Nicht gefunden' });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: (err as { code?: string }).code ?? 'error', message: err.message });
    }
    req.log.error({ err }, 'Unbehandelter Fehler');
    return reply.code(500).send({ error: 'internal', message: 'Interner Serverfehler' });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: 'not_found', message: `Route ${req.method} ${req.url.split('?')[0]} nicht gefunden` });
  });

  await app.register(registerRoutes, { prefix: '/api' });

  app.addHook('onClose', async () => {
    ctx.backups.stopScheduler();
    await db.$disconnect();
  });

  await ctx.backups.recover();
  if (opts.jobs) {
    ctx.backups.startScheduler();
    ctx.federation.start();
    const cleanup = setInterval(() => void ctx.uploads.cleanupStale().catch(() => undefined), 3600_000);
    cleanup.unref();
    const reminders = startEventReminders(ctx);
    app.addHook('onClose', async () => {
      clearInterval(cleanup);
      clearInterval(reminders);
      ctx.federation.stop();
    });
  }

  return app as unknown as FastifyInstance;
}
