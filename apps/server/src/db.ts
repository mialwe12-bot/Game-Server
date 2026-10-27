import { PrismaClient } from '@prisma/client';

export type Db = PrismaClient;

export function createDb(url?: string): Db {
  return new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
}
