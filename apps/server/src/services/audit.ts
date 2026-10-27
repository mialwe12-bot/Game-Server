import type { Db } from '../db.js';

export class AuditService {
  constructor(private readonly db: Db) {}

  async log(entry: { userId?: string | null; action: string; target?: string | null; meta?: Record<string, unknown>; ip?: string | null }) {
    await this.db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        target: entry.target ?? null,
        meta: (entry.meta ?? {}) as never,
        ip: entry.ip ?? null,
      },
    });
  }
}
