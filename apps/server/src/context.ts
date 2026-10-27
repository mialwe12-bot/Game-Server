import type { Session, User } from '@prisma/client';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { LogBuffer } from './logger.js';
import type { AuditService } from './services/audit.js';
import type { BackupService } from './services/backups.js';
import type { Hub } from './services/hub.js';
import type { Mailer } from './services/mailer.js';
import type { MetadataService } from './services/metadata/index.js';
import type { OidcService } from './services/oidc.js';
import type { SettingsService } from './services/settings.js';
import type { Storage } from './services/storage.js';
import type { UploadService } from './services/uploads.js';

export interface AppContext {
  config: Config;
  db: Db;
  storage: Storage;
  settings: SettingsService;
  audit: AuditService;
  mailer: Mailer;
  hub: Hub;
  logs: LogBuffer;
  uploads: UploadService;
  backups: BackupService;
  metadata: MetadataService;
  oidc: OidcService;
}

export interface AuthInfo {
  user: User;
  session: Session;
  via: 'cookie' | 'bearer';
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    auth: AuthInfo | null;
  }
  interface FastifyContextConfig {
    /** Route ist auch im Wartungsmodus für alle erreichbar. */
    allowInMaintenance?: boolean;
    /** CSRF-Prüfung überspringen (nur für Routen ohne Cookie-Seiteneffekte). */
    skipCsrf?: boolean;
  }
}
