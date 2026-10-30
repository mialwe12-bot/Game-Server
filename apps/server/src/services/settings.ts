import type { AdminSettings } from '@gameserver/shared';
import type { Db } from '../db.js';

export const DEFAULT_SETTINGS: AdminSettings = {
  siteName: 'Game Server',
  siteDescription: 'Selbst gehostete, DRM-freie Spieleplattform',
  registrationMode: 'invite',
  maintenanceMode: false,
  maintenanceMessage: 'Wartungsarbeiten – wir sind gleich zurück.',
  storePublic: true,
  maxUploadFileBytes: 200 * 1024 ** 3,
  defaultUploadQuotaBytes: 0,
  maxConcurrentUploadsPerUser: 16,
  downloadRateLimitKbps: 0,
  uploadChunkBytes: 16 * 1024 ** 2,
  backupSchedule: { enabled: false, intervalHours: 24, includeFiles: false, keep: 7 },
  voiceEnabled: false,
  voiceBackend: 'MESH',
  livekitUrl: '',
  gifsEnabled: true,
  maxChatImageBytes: 8 * 1024 ** 2,
  cloudSavesEnabled: true,
  cloudSaveVersions: 10,
  cloudQuotaBytes: 1024 ** 3,
  workshopEnabled: true,
  maxWorkshopFileBytes: 2 * 1024 ** 3,
  cardsEnabled: true,
  marketEnabled: true,
  giftsEnabled: true,
  cardDropMinutes: 30,
  discordAppId: '',
  logoUrl: '',
  clientLogoUrl: '',
  customCss: '',
};

/** Persistente Admin-Einstellungen mit In-Memory-Cache. */
export class SettingsService {
  private cache: AdminSettings | null = null;
  private listeners: ((s: AdminSettings, prev: AdminSettings) => void)[] = [];

  constructor(private readonly db: Db) {}

  async get(): Promise<AdminSettings> {
    if (this.cache) return this.cache;
    const rows = await this.db.setting.findMany();
    const values: Record<string, unknown> = {};
    // Nur bekannte Einstellungen übernehmen (interne Schlüssel wie „internal.*“ bleiben verborgen)
    for (const r of rows) if (r.key in DEFAULT_SETTINGS) values[r.key] = r.value;
    this.cache = { ...DEFAULT_SETTINGS, ...values } as AdminSettings;
    this.cache.backupSchedule = { ...DEFAULT_SETTINGS.backupSchedule, ...(this.cache.backupSchedule ?? {}) };
    return this.cache;
  }

  async update(patch: Partial<AdminSettings>): Promise<AdminSettings> {
    const prev = await this.get();
    await this.db.$transaction(
      Object.entries(patch)
        .filter(([, v]) => v !== undefined)
        .map(([key, value]) =>
          this.db.setting.upsert({
            where: { key },
            create: { key, value: value as never },
            update: { value: value as never },
          }),
        ),
    );
    this.cache = null;
    const next = await this.get();
    for (const l of this.listeners) l(next, prev);
    return next;
  }

  onChange(listener: (s: AdminSettings, prev: AdminSettings) => void): void {
    this.listeners.push(listener);
  }

  invalidate(): void {
    this.cache = null;
  }

  /** Server-Geheimnis (für signierte URLs): APP_SECRET aus der Umgebung oder einmalig erzeugt und gespeichert. */
  async appSecret(fromEnv: string): Promise<string> {
    if (fromEnv) return fromEnv;
    const row = await this.db.setting.findUnique({ where: { key: 'internal.appSecret' } });
    if (row && typeof row.value === 'string') return row.value;
    const { randomToken } = await import('../lib/crypto.js');
    const secret = randomToken(48);
    await this.db.setting.upsert({ where: { key: 'internal.appSecret' }, create: { key: 'internal.appSecret', value: secret }, update: {} });
    const again = await this.db.setting.findUnique({ where: { key: 'internal.appSecret' } });
    return String(again?.value ?? secret);
  }

  /** Ed25519-Schlüsselpaar dieses Servers für die Föderation (einmalig erzeugt und gespeichert, PEM). */
  async federationKeys(): Promise<{ publicKey: string; privateKey: string }> {
    const pubRow = await this.db.setting.findUnique({ where: { key: 'internal.federationPublicKey' } });
    const privRow = await this.db.setting.findUnique({ where: { key: 'internal.federationPrivateKey' } });
    if (pubRow && privRow && typeof pubRow.value === 'string' && typeof privRow.value === 'string') {
      return { publicKey: pubRow.value, privateKey: privRow.value };
    }
    const { generateKeyPairSync } = await import('node:crypto');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    await this.db.$transaction([
      this.db.setting.upsert({ where: { key: 'internal.federationPublicKey' }, create: { key: 'internal.federationPublicKey', value: publicKey }, update: {} }),
      this.db.setting.upsert({ where: { key: 'internal.federationPrivateKey' }, create: { key: 'internal.federationPrivateKey', value: privateKey }, update: {} }),
    ]);
    const pub = await this.db.setting.findUnique({ where: { key: 'internal.federationPublicKey' } });
    const priv = await this.db.setting.findUnique({ where: { key: 'internal.federationPrivateKey' } });
    return { publicKey: String(pub?.value ?? publicKey), privateKey: String(priv?.value ?? privateKey) };
  }
}
