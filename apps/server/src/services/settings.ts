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
    for (const r of rows) values[r.key] = r.value;
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
}
