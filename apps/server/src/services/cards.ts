import type { CardItem, Game, TradingCard } from '@prisma/client';
import type { CardItemDto, ProfileLevel, TradingCardDto } from '@gameserver/shared';
import type { AppContext } from '../context.js';
import type { Db } from '../db.js';
import { badRequest } from '../lib/errors.js';
import { fileUrl } from '../lib/image-upload.js';
import type { UrlSigner } from '../lib/sign.js';
import { gameRef } from './achievements.js';

/** Höchste Abzeichen-Stufe pro Spiel */
export const MAX_BADGE_LEVEL = 5;
/** XP pro hergestellter Abzeichen-Stufe */
export const BADGE_XP = 100;
/** Wahrscheinlichkeit für eine Folienkarte pro Drop */
export const FOIL_CHANCE = 0.02;

/** XP-Kosten, um von Level L auf L+1 zu steigen: 100 für Level 0–9, 200 für 10–19 usw. */
export const levelCost = (level: number) => 100 * (Math.floor(level / 10) + 1);

export function profileLevel(xp: number): ProfileLevel {
  let level = 0;
  let levelXp = 0;
  while (xp >= levelXp + levelCost(level)) {
    levelXp += levelCost(level);
    level++;
  }
  return { level, xp, levelXp, nextLevelXp: levelXp + levelCost(level) };
}

/** Maximale Anzahl Drops pro Spiel: halbes Set (aufgerundet) */
export const maxDrops = (setSize: number) => Math.ceil(setSize / 2);

export function cardDto(signer: UrlSigner, c: TradingCard): TradingCardDto {
  return { id: c.id, gameId: c.gameId, name: c.name, imageUrl: fileUrl(signer, c.imageKey) };
}

export const cardItemInclude = {
  card: { include: { game: true } },
  listing: { select: { status: true } },
  tradeItems: { select: { offer: { select: { status: true } } } },
};

export function isLocked(item: { listing?: { status: string } | null; tradeItems?: { offer: { status: string } }[] }): boolean {
  return item.listing?.status === 'OPEN' || !!item.tradeItems?.some((t) => t.offer.status === 'PENDING');
}

export function cardItemDto(
  signer: UrlSigner,
  i: CardItem & { card: TradingCard & { game: Game }; listing?: { status: string } | null; tradeItems?: { offer: { status: string } }[] },
): CardItemDto {
  return {
    id: i.id,
    card: cardDto(signer, i.card),
    game: gameRef(i.card.game),
    foil: i.foil,
    source: i.source,
    acquiredAt: i.acquiredAt.toISOString(),
    locked: isLocked(i),
  };
}

/** Frei verfügbare (nicht gesperrte) Karten eines Nutzers */
export async function freeItems(db: Db, ownerId: string, where: { cardId?: string; gameId?: string; ids?: string[] } = {}) {
  const items = await db.cardItem.findMany({
    where: {
      ownerId,
      ...(where.cardId ? { cardId: where.cardId } : {}),
      ...(where.gameId ? { card: { gameId: where.gameId } } : {}),
      ...(where.ids ? { id: { in: where.ids } } : {}),
    },
    include: cardItemInclude,
    orderBy: { acquiredAt: 'asc' },
  });
  return items.filter((i) => !isLocked(i));
}

export class CardService {
  constructor(private readonly ctx: AppContext) {}

  /**
   * Karten-Drops anhand der Gesamtspielzeit: alle `cardDropMinutes` eine zufällige Karte, höchstens ein halbes Set pro Spiel.
   * Gibt die neuen Karten zurück.
   */
  async dropForPlaytime(userId: string, gameId: string, playtimeSeconds: number): Promise<CardItem[]> {
    const { db, settings } = this.ctx;
    const s = await settings.get();
    if (!s.cardsEnabled) return [];
    const cards = await db.tradingCard.findMany({ where: { gameId }, include: { game: true } });
    if (!cards.length) return [];
    const state = await db.cardDropState.upsert({
      where: { userId_gameId: { userId, gameId } },
      create: { userId, gameId },
      update: {},
    });
    const interval = s.cardDropMinutes * 60;
    const earned = Math.min(maxDrops(cards.length), Math.floor(playtimeSeconds / interval));
    const toGive = earned - state.drops;
    if (toGive <= 0) return [];
    // Optimistische Sperre gegen doppelte Drops bei parallelen Meldungen
    const claimed = await db.cardDropState.updateMany({
      where: { userId, gameId, drops: state.drops },
      data: { drops: earned, creditedSeconds: earned * interval },
    });
    if (claimed.count === 0) return [];
    const created: CardItem[] = [];
    for (let n = 0; n < toGive; n++) {
      const card = cards[Math.floor(Math.random() * cards.length)];
      const item = await db.cardItem.create({ data: { ownerId: userId, cardId: card.id, foil: Math.random() < FOIL_CHANCE, source: 'drop' } });
      created.push(item);
      await this.ctx.notifications.notify(userId, 'card.drop', { title: card.name, gameTitle: card.game.title, path: '/inventory' });
    }
    this.ctx.hub.toUser(userId, { type: 'inventory.changed', data: {} });
    return created;
  }

  /** Abzeichen herstellen: verbraucht je eine freie Normalkarte jeder Karte des Sets. */
  async craftBadge(userId: string, gameId: string): Promise<{ level: number; xp: number }> {
    const { db } = this.ctx;
    const cards = await db.tradingCard.findMany({ where: { gameId } });
    if (!cards.length) throw badRequest('Für dieses Spiel gibt es keine Sammelkarten', 'no_cards');
    const badge = await db.gameBadge.findUnique({ where: { userId_gameId: { userId, gameId } } });
    if ((badge?.level ?? 0) >= MAX_BADGE_LEVEL) throw badRequest('Höchste Abzeichen-Stufe erreicht', 'max_level');
    const items = (await freeItems(db, userId, { gameId })).filter((i) => !i.foil);
    const pick: string[] = [];
    for (const c of cards) {
      const item = items.find((i) => i.cardId === c.id);
      if (!item) throw badRequest('Das Kartenset ist nicht vollständig', 'incomplete_set');
      pick.push(item.id);
    }
    const [, updated, user] = await db.$transaction([
      db.cardItem.deleteMany({ where: { id: { in: pick }, ownerId: userId } }),
      db.gameBadge.upsert({
        where: { userId_gameId: { userId, gameId } },
        create: { userId, gameId, level: 1 },
        update: { level: { increment: 1 } },
      }),
      db.user.update({ where: { id: userId }, data: { xp: { increment: BADGE_XP } } }),
    ]);
    await this.ctx.activity.record(userId, 'badge.crafted', { level: String(updated.level) }, gameId);
    this.ctx.hub.toUser(userId, { type: 'inventory.changed', data: {} });
    return { level: updated.level, xp: user.xp };
  }
}
