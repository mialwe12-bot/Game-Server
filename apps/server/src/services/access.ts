import type { FamilyMember, Game, Prisma, User } from '@prisma/client';
import type { Db } from '../db.js';
import { forbidden, notFound } from '../lib/errors.js';

export const isAdmin = (user: User | null | undefined) => user?.role === 'ADMIN';
export const canUpload = (user: User | null | undefined) => user?.role === 'ADMIN' || user?.role === 'UPLOADER';

/** Nutzer mit (optional) geladener Familienmitgliedschaft – der Auth-Plugin lädt sie immer mit. */
export type UserWithFamily = User & { familyMember?: FamilyMember | null };

/** Altersgrenze für Kinderkonten (null = keine Beschränkung). */
export function maxAgeRating(user: User | null | undefined): number | null {
  const m = (user as UserWithFamily | null | undefined)?.familyMember;
  return m?.role === 'CHILD' ? m.maxAgeRating : null;
}

/** Zugriff auf eingeschränkte Spiele: eigener Zugriff oder Zugriff eines Familienmitglieds (Familienbibliothek). */
function accessWhere(user: User): Prisma.GameWhereInput {
  return {
    visibility: 'RESTRICTED',
    access: {
      some: {
        OR: [{ userId: user.id }, { user: { familyMember: { family: { members: { some: { userId: user.id } } } } } }],
      },
    },
  };
}

function ageWhere(user: User | null): Prisma.GameWhereInput {
  const max = maxAgeRating(user);
  return max === null ? {} : { ageRating: { lte: max } };
}

/** Bedingung für Spiele, die im Store gelistet werden dürfen. */
export function storeVisibleWhere(user: User | null): Prisma.GameWhereInput {
  const or: Prisma.GameWhereInput[] = [{ visibility: 'PUBLIC' }];
  if (user) or.push(accessWhere(user));
  return { AND: [{ OR: or }, ageWhere(user)] };
}

/** Bedingung für Spiele, die direkt aufgerufen werden dürfen (zusätzlich UNLISTED). */
export function viewableWhere(user: User | null): Prisma.GameWhereInput {
  if (isAdmin(user)) return {};
  const or: Prisma.GameWhereInput[] = [{ visibility: { in: ['PUBLIC', 'UNLISTED'] } }];
  if (user) {
    or.push(accessWhere(user));
    if (canUpload(user)) or.push({ maintainers: { some: { userId: user.id } } });
  }
  return { AND: [{ OR: or }, ageWhere(user)] };
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

/** Familienmitgliedschaft nachladen, falls der Nutzer nicht aus dem Auth-Plugin stammt. */
async function withFamily(db: Db, user: User): Promise<UserWithFamily> {
  if ('familyMember' in user) return user as UserWithFamily;
  return { ...user, familyMember: await db.familyMember.findUnique({ where: { userId: user.id } }) };
}

export async function canViewGame(db: Db, user: User | null, game: Pick<Game, 'id' | 'visibility'> & { ageRating?: number }): Promise<boolean> {
  if (user && !isAdmin(user)) {
    const max = maxAgeRating(await withFamily(db, user));
    if (max !== null) {
      const rating = game.ageRating ?? (await db.game.findUnique({ where: { id: game.id }, select: { ageRating: true } }))?.ageRating ?? 0;
      if (rating > max) return false;
    }
  }
  if (game.visibility === 'PUBLIC' || game.visibility === 'UNLISTED') return true;
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (await isMaintainer(db, user, game.id)) return true;
  if (game.visibility === 'RESTRICTED') {
    const a = await db.gameAccess.findFirst({ where: { gameId: game.id, ...accessWhere(user).access!.some } });
    return !!a;
  }
  return false;
}
