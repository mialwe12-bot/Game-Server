import type { Game, User, WorkshopItem, WorkshopVersion } from '@prisma/client';
import type { WorkshopItemDto, WorkshopVersionDto } from '@gameserver/shared';
import type { AppContext } from '../context.js';
import { fileUrl } from '../lib/image-upload.js';
import { canEditGame } from './access.js';
import { gameRef } from './achievements.js';
import { userPublic } from './dto.js';

export const itemInclude = {
  game: true,
  author: true,
  versions: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  ratings: { select: { up: true, userId: true } },
  _count: { select: { subscriptions: true } },
};

export type ItemRow = WorkshopItem & {
  game: Game;
  author: User | null;
  versions: WorkshopVersion[];
  ratings: { up: boolean; userId: string }[];
  _count: { subscriptions: number };
};

export const versionDto = (v: WorkshopVersion): WorkshopVersionDto => ({
  id: v.id,
  version: v.version,
  changelog: v.changelog,
  fileName: v.fileName,
  size: Number(v.size),
  sha256: v.sha256,
  createdAt: v.createdAt.toISOString(),
  downloadUrl: `/api/workshop/items/${v.itemId}/versions/${v.id}/download`,
});

export async function workshopItemDto(ctx: AppContext, i: ItemRow, viewer: User | null): Promise<WorkshopItemDto> {
  const { db } = ctx;
  const subscribed = viewer ? !!(await db.workshopSubscription.findUnique({ where: { itemId_userId: { itemId: i.id, userId: viewer.id } } })) : false;
  const mine = i.ratings.find((r) => r.userId === viewer?.id);
  return {
    id: i.id,
    game: gameRef(i.game),
    author: i.author ? userPublic(i.author) : null,
    title: i.title,
    description: i.description,
    kind: i.kind,
    tags: i.tags,
    previewUrl: fileUrl(ctx.signer, i.previewKey),
    hidden: i.hidden,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    latestVersion: i.versions[0] ? versionDto(i.versions[0]) : null,
    up: i.ratings.filter((r) => r.up).length,
    down: i.ratings.filter((r) => !r.up).length,
    myRating: mine ? mine.up : null,
    subscribers: i._count.subscriptions,
    subscribed,
    canEdit: !!viewer && (i.authorId === viewer.id || (await canEditGame(db, viewer, i.gameId))),
  };
}
