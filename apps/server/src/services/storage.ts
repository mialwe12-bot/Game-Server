import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export type StorageArea = 'builds' | 'media' | 'avatars' | 'uploads' | 'backups' | 'tmp';

/** Dateiablage auf dem Volume (DATA_DIR). Keys sind relative Pfade wie "builds/<buildId>/<fileId>". */
export class Storage {
  constructor(public readonly root: string) {}

  async init(): Promise<void> {
    for (const area of ['builds', 'media', 'avatars', 'uploads', 'backups', 'tmp'] as StorageArea[]) {
      await fs.mkdir(path.join(this.root, area), { recursive: true });
    }
  }

  resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Ungültiger Storage-Key');
    return full;
  }

  async write(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }

  async move(fromPath: string, key: string): Promise<void> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.rename(fromPath, full);
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true, recursive: true });
  }

  async stat(key: string) {
    return fs.stat(this.resolve(key));
  }

  read(key: string, opts?: { start?: number; end?: number }) {
    return createReadStream(this.resolve(key), opts);
  }

  async dirSize(area: StorageArea | string): Promise<number> {
    return dirSize(this.resolve(area));
  }

  async disk(): Promise<{ total: number; free: number; used: number }> {
    const s = await fs.statfs(this.root);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total, free, used: total - free };
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await fs.stat(p)).size;
  }
  return total;
}
