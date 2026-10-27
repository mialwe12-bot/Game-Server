import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  DATA_DIR: z.string().default('./data'),
  COOKIE_SECURE: bool.default(false),
  TRUST_PROXY: bool.default(false),
  // Origins der Tauri-WebView (Linux: tauri://localhost, Windows: http(s)://tauri.localhost)
  CORS_ORIGINS: z.string().default('tauri://localhost,http://tauri.localhost,https://tauri.localhost'),
  LOG_LEVEL: z.string().default('info'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  DEVICE_TTL_DAYS: z.coerce.number().int().positive().default(365),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().default('Game Server <noreply@localhost>'),
  OIDC_ISSUER: z.string().default(''),
  OIDC_CLIENT_ID: z.string().default(''),
  OIDC_CLIENT_SECRET: z.string().default(''),
  OIDC_NAME: z.string().default('SSO'),
  OIDC_SCOPES: z.string().default('openid email profile'),
  OIDC_AUTO_REGISTER: bool.default(true),
  OIDC_LINK_BY_EMAIL: bool.default(false),
  OIDC_ADMIN_GROUP: z.string().default(''),
  IGDB_CLIENT_ID: z.string().default(''),
  IGDB_CLIENT_SECRET: z.string().default(''),
  RAWG_API_KEY: z.string().default(''),
  PG_DUMP_PATH: z.string().default('pg_dump'),
});

export type Config = z.infer<typeof schema> & {
  dataDir: string;
  version: string;
  corsOrigins: string[];
};

function packageVersion(): string {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
  } catch {
    return '0.0.0';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Konfiguration:\n${issues}`);
  }
  const c = parsed.data;
  return {
    ...c,
    dataDir: path.resolve(c.DATA_DIR),
    version: packageVersion(),
    corsOrigins: c.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
