import type { Game, Prisma, User } from '@prisma/client';
import type { Db } from '../db.js';
import { forbidden, notFound } from '../lib/errors.js';

export const isAdmin = (user: User | null | undefined) => user?.role === 'ADMIN';
export const canUpload = (user: User | null | undefined) => user?.role === 'ADMIN' || user?.role === 'UPLOADER';

/** Bedingung für Spiele, die im Store gelistet werden dürfen. */
export function storeVisibleWhere(user: User | null): Prisma.GameWhereInput {
  const or: Prisma.GameWhereInput[] = [{ visibility: 'PUBLIC' }];
  if (user) or.push({ visibility: 'RESTRICTED', access: { some: { userId: user.id } } });
  return { OR: or };
}

/** Bedingung für Spiele, die direkt aufgerufen werden dürfen (zusätzlich UNLISTED). */
export function viewableWhere(user: User | null): Prisma.GameWhereInput {
  if (isAdmin(user)) return {};
  const or: Prisma.GameWhereInput[] = [{ visibility: { in: ['PUBLIC', 'UNLISTED'] } }];
  if (user) {
    or.push({ visibility: 'RESTRICTED', access: { some: { userId: user.id } } });
    if (canUpload(user)) or.push({ maintainers: { some: { userId: user.id } } });
  }
  return { OR: or };
}

export async function isMaintainer(db: Db, user: User, gameId: string): Promise<boolean> {
  if (!canUpload(user)) return false;
  const m = await db.gameMaintainer.findUnique({ where: { gameId_userId: { gameId, userId: user.id } } });
  return !!m;
}

export async function canEditGame(db: Db, user: User | null, gameId: string): Promise<boolean> {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return isMaintainer(db, user, gameId);
}

export async function assertCanEditGame(db: Db, user: User, gameId: string): Promise<Game> {
  const game = await db.game.findUnique({ where: { id: gameId } });
  if (!game) throw notFound('Spiel nicht gefunden');
  if (!(await canEditGame(db, user, gameId))) throw forbidden('Keine Rechte für dieses Spiel');
  return game;
}

export async function canViewGame(db: Db, user: User | null, game: Pick<Game, 'id' | 'visibility'>): Promise<boolean> {
  if (game.visibility === 'PUBLIC' || game.visibility === 'UNLISTED') return true;
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (await isMaintainer(db, user, game.id)) return true;
  if (game.visibility === 'RESTRICTED') {
    const a = await db.gameAccess.findUnique({ where: { gameId_userId: { gameId: game.id, userId: user.id } } });
    return !!a;
  }
  return false;
}
