import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Backup } from '@prisma/client';
import type { BackupDto } from '@gameserver/shared';
import type { AppContext } from '../context.js';
import { conflict, notFound } from '../lib/errors.js';
import { iso } from '../lib/time.js';

export function backupDto(b: Backup): BackupDto {
  return {
    id: b.id,
    filename: b.filename,
    size: Number(b.size),
    includesFiles: b.includesFiles,
    status: b.status,
    error: b.error,
    createdAt: b.createdAt.toISOString(),
    finishedAt: iso(b.finishedAt),
  };
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} beendet mit Code ${code}: ${stderr.trim().slice(0, 500)}`)),
    );
  });
}

/** Zerlegt die DATABASE_URL in libpq-Umgebungsvariablen (Prisma-Parameter wie ?schema= versteht pg_dump nicht). */
export function pgEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const u = new URL(databaseUrl);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.replace(/^\//, ''),
  };
}

/**
 * Backups: pg_dump (Custom-Format) + optional alle Dateien (Builds, Medien, Avatare) als .tar.gz in DATA_DIR/backups.
 * Wiederherstellung: siehe README (pg_restore + Entpacken).
 */
export class BackupService {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly ctx: AppContext) {}

  get dir(): string {
    return this.ctx.storage.resolve('backups');
  }

  async list(): Promise<BackupDto[]> {
    const rows = await this.ctx.db.backup.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(backupDto);
  }

  async start(includeFiles: boolean, userId?: string | null): Promise<BackupDto> {
    if (this.running) throw conflict('Es läuft bereits ein Backup', 'backup_running');
    this.running = true;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${stamp}${includeFiles ? '-full' : '-db'}.tar.gz`;
    const backup = await this.ctx.db.backup.create({ data: { filename, includesFiles: includeFiles } });
    this.ctx.hub.toAdmins({ type: 'backup.updated', data: backupDto(backup) });
    void this.execute(backup, userId ?? null).finally(() => {
      this.running = false;
    });
    return backupDto(backup);
  }

  private async execute(backup: Backup, userId: string | null): Promise<void> {
    const { config, storage, db, audit, hub } = this.ctx;
    const work = storage.resolve(`tmp/backup-${backup.id}`);
    try {
      await fs.mkdir(work, { recursive: true });
      await run(config.PG_DUMP_PATH, ['--format=custom', '--no-owner', `--file=${path.join(work, 'database.dump')}`], pgEnv(config.DATABASE_URL));
      await fs.writeFile(
        path.join(work, 'backup.json'),
        JSON.stringify({ createdAt: backup.createdAt, version: config.version, includesFiles: backup.includesFiles }, null, 2),
      );
      const target = path.join(this.dir, backup.filename);
      const args = ['-czf', target, '-C', work, 'database.dump', 'backup.json'];
      if (backup.includesFiles) args.push('-C', storage.root, 'builds', 'media', 'avatars');
      await run('tar', args);
      const stat = await fs.stat(target);
      const done = await db.backup.update({
        where: { id: backup.id },
        data: { status: 'COMPLETED', size: BigInt(stat.size), finishedAt: new Date() },
      });
      hub.toAdmins({ type: 'backup.updated', data: backupDto(done) });
      await audit.log({ userId, action: 'backup.completed', target: backup.filename, meta: { size: stat.size } });
      await this.prune();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = await db.backup.update({
        where: { id: backup.id },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      });
      hub.toAdmins({ type: 'backup.updated', data: backupDto(failed) });
      await audit.log({ userId, action: 'backup.failed', target: backup.filename, meta: { error: message } });
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  }

  async get(id: string): Promise<Backup> {
    const b = await this.ctx.db.backup.findUnique({ where: { id } });
    if (!b) throw notFound('Backup nicht gefunden');
    return b;
  }

  filePath(b: Backup): string {
    return path.join(this.dir, b.filename);
  }

  async remove(id: string): Promise<void> {
    const b = await this.get(id);
    if (b.status === 'RUNNING') throw conflict('Backup läuft noch', 'backup_running');
    await fs.rm(this.filePath(b), { force: true });
    await this.ctx.db.backup.delete({ where: { id } });
  }

  /** Löscht alte, erfolgreiche Backups über der eingestellten Anzahl. */
  async prune(): Promise<void> {
    const { keep } = (await this.ctx.settings.get()).backupSchedule;
    if (keep <= 0) return;
    const done = await this.ctx.db.backup.findMany({ where: { status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } });
    for (const b of done.slice(keep)) await this.remove(b.id);
  }

  /** Prüft stündlich, ob laut Zeitplan ein Backup fällig ist. */
  startScheduler(): void {
    const tick = async () => {
      try {
        const { backupSchedule } = await this.ctx.settings.get();
        if (!backupSchedule.enabled || this.running) return;
        const last = await this.ctx.db.backup.findFirst({ where: { status: { not: 'FAILED' } }, orderBy: { createdAt: 'desc' } });
        const due = !last || Date.now() - last.createdAt.getTime() >= backupSchedule.intervalHours * 3600_000;
        if (due) await this.start(backupSchedule.includeFiles, null);
      } catch (err) {
        this.ctx.logs.push({ time: new Date().toISOString(), level: 'error', msg: `Backup-Zeitplan: ${String(err)}` });
      }
    };
    this.timer = setInterval(tick, 15 * 60_000);
    this.timer.unref();
  }

  stopScheduler(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Beim Start: hängengebliebene Backups (Server-Neustart) als fehlgeschlagen markieren. */
  async recover(): Promise<void> {
    await this.ctx.db.backup.updateMany({
      where: { status: 'RUNNING' },
      data: { status: 'FAILED', error: 'Server wurde während des Backups neu gestartet', finishedAt: new Date() },
    });
  }
}
