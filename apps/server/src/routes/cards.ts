import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma, User } from '@prisma/client';
import type { CardItemDto, GameBadgeDto, GameCardSet, InventoryDto, MarketListingDto, TradeOfferDto } from '@gameserver/shared';
import type { Db } from '../db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { saveImageUpload } from '../lib/image-upload.js';
import { requireAuth } from '../plugins/auth.js';
import { assertCanEditGame, viewableWhere } from '../services/access.js';
import { gameRef } from '../services/achievements.js';
import { cardDto, cardItemDto, cardItemInclude, freeItems, MAX_BADGE_LEVEL, maxDrops, profileLevel } from '../services/cards.js';
import { userPublic } from '../services/dto.js';
import { assertNotBlocked, profileVisible, relation } from '../services/social.js';

/** Alle offenen Tauschangebote und Marktplatz-Angebote mit diesen Karten beenden (nach einem Besitzerwechsel). */
async function releaseItems(tx: Prisma.TransactionClient, itemIds: string[], exceptOfferId?: string) {
  await tx.tradeOffer.updateMany({
    where: { status: 'PENDING', id: exceptOfferId ? { not: exceptOfferId } : undefined, items: { some: { itemId: { in: itemIds } } } },
    data: { status: 'CANCELLED', decidedAt: new Date() },
  });
  await tx.marketListing.updateMany({ where: { status: 'OPEN', itemId: { in: itemIds } }, data: { status: 'CANCELLED', completedAt: new Date() } });
}

/** Sammelkarten, Abzeichen, Profil-Level, Tauschangebote und Marktplatz – ohne echtes Geld. */
export const cardRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const { db } = ctx;

  async function cardsOn() {
    const s = await ctx.settings.get();
    if (!s.cardsEnabled) throw forbidden('Sammelkarten sind deaktiviert', 'cards_disabled');
    return s;
  }
  async function marketOn() {
    const s = await cardsOn();
    if (!s.marketEnabled) throw forbidden('Tausch und Marktplatz sind deaktiviert', 'market_disabled');
    return s;
  }

  async function sets(user: User, interval: number): Promise<GameCardSet[]> {
    const games = await db.game.findMany({
      where: {
        AND: [
          viewableWhere(user),
          { tradingCards: { some: {} } },
          { OR: [{ libraryEntries: { some: { userId: user.id } } }, { tradingCards: { some: { items: { some: { ownerId: user.id } } } } }] },
        ],
      },
      include: {
        tradingCards: { orderBy: { sortOrder: 'asc' } },
        badges: { where: { userId: user.id } },
        cardDrops: { where: { userId: user.id } },
        libraryEntries: { where: { userId: user.id }, select: { playtimeSeconds: true } },
      },
      orderBy: { title: 'asc' },
    });
    const owned = await db.cardItem.findMany({ where: { ownerId: user.id }, include: cardItemInclude });
    return games.map((g) => {
      const max = maxDrops(g.tradingCards.length);
      const received = g.cardDrops[0]?.drops ?? 0;
      const playtime = g.libraryEntries[0]?.playtimeSeconds ?? 0;
      const free = owned.filter((i) => i.card.gameId === g.id && !i.foil && !(i.listing?.status === 'OPEN') && !i.tradeItems.some((t) => t.offer.status === 'PENDING'));
      const level = g.badges[0]?.level ?? 0;
      return {
        game: gameRef(g),
        cards: g.tradingCards.map((c) => ({ ...cardDto(ctx.signer, c), owned: owned.filter((i) => i.cardId === c.id).length })),
        drops: { received, max, nextInSeconds: received < max ? Math.max(0, (received + 1) * interval - playtime) : null },
        badgeLevel: level,
        canCraft: level < MAX_BADGE_LEVEL && g.tradingCards.every((c) => free.some((i) => i.cardId === c.id)),
      };
    });
  }

  app.get('/inventory', { schema: { tags: ['cards'], summary: 'Eigenes Inventar, Kartensets und Profil-Level' } }, async (req): Promise<InventoryDto> => {
    const { user } = requireAuth(req);
    const s = await cardsOn();
    const items = await db.cardItem.findMany({ where: { ownerId: user.id }, include: cardItemInclude, orderBy: { acquiredAt: 'desc' } });
    const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    return { items: items.map((i) => cardItemDto(ctx.signer, i)), sets: await sets(user, s.cardDropMinutes * 60), level: profileLevel(fresh.xp) };
  });

  async function visibleTarget(viewer: User | null, username: string) {
    const target = await db.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' }, disabled: false } });
    if (!target) throw notFound('Nutzer nicht gefunden');
    const rel = await relation(db, viewer?.id ?? null, target.id);
    if (!profileVisible(target, viewer, rel)) throw forbidden('Profil ist privat', 'profile_private');
    return target;
  }

  app.get(
    '/users/:username/items',
    { schema: { tags: ['cards'], summary: 'Karten eines Nutzers (für Tauschangebote)', params: z.object({ username: z.string().max(64) }) } },
    async (req): Promise<CardItemDto[]> => {
      await cardsOn();
      const target = await visibleTarget(req.auth?.user ?? null, req.params.username);
      const items = await db.cardItem.findMany({ where: { ownerId: target.id }, include: cardItemInclude, orderBy: { acquiredAt: 'desc' } });
      return items.map((i) => cardItemDto(ctx.signer, i));
    },
  );

  app.get(
    '/users/:username/badges',
    { schema: { tags: ['cards'], summary: 'Abzeichen und Level eines Nutzers', params: z.object({ username: z.string().max(64) }) } },
    async (req) => {
      const target = await visibleTarget(req.auth?.user ?? null, req.params.username);
      const badges = await db.gameBadge.findMany({ where: { userId: target.id, level: { gt: 0 } }, include: { game: true }, orderBy: { updatedAt: 'desc' } });
      return {
        level: profileLevel(target.xp),
        badges: badges.map((b): GameBadgeDto => ({ game: gameRef(b.game), level: b.level, craftedAt: b.updatedAt.toISOString() })),
      };
    },
  );

  app.post('/badges/:gameId/craft', { schema: { tags: ['cards'], summary: 'Abzeichen herstellen (verbraucht ein Kartenset)', params: z.object({ gameId: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    await cardsOn();
    const result = await ctx.cards.craftBadge(user.id, req.params.gameId);
    return { ...result, level: result.level, profile: profileLevel(result.xp) };
  });

  // ---- Tauschangebote ----

  const offerInclude = {
    from: true,
    to: true,
    items: { include: { item: { include: cardItemInclude } } },
  } satisfies Prisma.TradeOfferInclude;

  function offerDto(o: Prisma.TradeOfferGetPayload<{ include: typeof offerInclude }>, viewerId: string): TradeOfferDto {
    return {
      id: o.id,
      from: userPublic(o.from),
      to: userPublic(o.to),
      message: o.message,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      decidedAt: o.decidedAt?.toISOString() ?? null,
      give: o.items.filter((i) => i.side === 'GIVE').map((i) => cardItemDto(ctx.signer, i.item)),
      receive: o.items.filter((i) => i.side === 'RECEIVE').map((i) => cardItemDto(ctx.signer, i.item)),
      direction: o.fromId === viewerId ? 'outgoing' : 'incoming',
    };
  }

  app.get('/trades', { schema: { tags: ['cards'], summary: 'Tauschangebote (offen zuerst)' } }, async (req): Promise<TradeOfferDto[]> => {
    const { user } = requireAuth(req);
    await marketOn();
    const rows = await db.tradeOffer.findMany({
      where: { OR: [{ fromId: user.id }, { toId: user.id }] },
      include: offerInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows
      .map((o) => offerDto(o, user.id))
      .sort((a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING') || b.createdAt.localeCompare(a.createdAt));
  });

  app.post(
    '/trades',
    {
      schema: {
        tags: ['cards'],
        summary: 'Tauschangebot senden',
        body: z.object({
          toUserId: z.string(),
          give: z.array(z.string()).max(50).default([]),
          receive: z.array(z.string()).max(50).default([]),
          message: z.string().max(500).default(''),
        }),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req): Promise<TradeOfferDto> => {
      const { user } = requireAuth(req);
      await marketOn();
      const { toUserId, give, receive, message } = req.body;
      if (toUserId === user.id) throw badRequest('Kein Tausch mit dir selbst', 'self');
      if (!give.length && !receive.length) throw badRequest('Das Angebot ist leer', 'empty');
      if (new Set([...give, ...receive]).size !== give.length + receive.length) throw badRequest('Karten doppelt ausgewählt', 'duplicate');
      const to = await db.user.findUnique({ where: { id: toUserId } });
      if (!to || to.disabled) throw notFound('Nutzer nicht gefunden');
      await assertNotBlocked(db, user.id, to.id);
      if ((await freeItems(db, user.id, { ids: give })).length !== give.length) throw badRequest('Nicht alle angebotenen Karten sind verfügbar', 'items_unavailable');
      if ((await freeItems(db, to.id, { ids: receive })).length !== receive.length) throw badRequest('Nicht alle gewünschten Karten sind verfügbar', 'items_unavailable');
      const offer = await db.tradeOffer.create({
        data: {
          fromId: user.id,
          toId: to.id,
          message,
          items: { create: [...give.map((itemId) => ({ itemId, side: 'GIVE' as const })), ...receive.map((itemId) => ({ itemId, side: 'RECEIVE' as const }))] },
        },
        include: offerInclude,
      });
      await ctx.notifications.notify(to.id, 'trade.offer', { username: user.displayName ?? user.username, path: '/inventory/trades' });
      ctx.hub.toUsers([user.id, to.id], { type: 'inventory.changed', data: {} });
      return offerDto(offer, user.id);
    },
  );

  async function pendingOffer(id: string) {
    const o = await db.tradeOffer.findUnique({ where: { id }, include: offerInclude });
    if (!o) throw notFound('Angebot nicht gefunden');
    if (o.status !== 'PENDING') throw badRequest('Das Angebot ist nicht mehr offen', 'not_pending');
    return o;
  }

  app.post('/trades/:id/accept', { schema: { tags: ['cards'], summary: 'Tauschangebot annehmen', params: z.object({ id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    await marketOn();
    const o = await pendingOffer(req.params.id);
    if (o.toId !== user.id) throw forbidden();
    const give = o.items.filter((i) => i.side === 'GIVE').map((i) => i.itemId);
    const receive = o.items.filter((i) => i.side === 'RECEIVE').map((i) => i.itemId);
    await db.$transaction(async (tx) => {
      // Besitz erneut prüfen (Karten könnten inzwischen verbraucht oder getauscht sein)
      const giveOk = await tx.cardItem.count({ where: { id: { in: give }, ownerId: o.fromId } });
      const receiveOk = await tx.cardItem.count({ where: { id: { in: receive }, ownerId: o.toId } });
      if (giveOk !== give.length || receiveOk !== receive.length) {
        await tx.tradeOffer.update({ where: { id: o.id }, data: { status: 'CANCELLED', decidedAt: new Date() } });
        throw badRequest('Das Angebot ist nicht mehr gültig, weil Karten fehlen', 'items_unavailable');
      }
      await tx.cardItem.updateMany({ where: { id: { in: give } }, data: { ownerId: o.toId, source: 'trade', acquiredAt: new Date() } });
      await tx.cardItem.updateMany({ where: { id: { in: receive } }, data: { ownerId: o.fromId, source: 'trade', acquiredAt: new Date() } });
      await tx.tradeOffer.update({ where: { id: o.id }, data: { status: 'ACCEPTED', decidedAt: new Date() } });
      await releaseItems(tx, [...give, ...receive], o.id);
    });
    await ctx.notifications.notify(o.fromId, 'trade.accepted', { username: user.displayName ?? user.username, path: '/inventory' });
    ctx.hub.toUsers([o.fromId, o.toId], { type: 'inventory.changed', data: {} });
    return offerDto(await db.tradeOffer.findUniqueOrThrow({ where: { id: o.id }, include: offerInclude }), user.id);
  });

  for (const [action, who, status] of [
    ['decline', 'to', 'DECLINED'],
    ['cancel', 'from', 'CANCELLED'],
  ] as const) {
    app.post(`/trades/:id/${action}`, { schema: { tags: ['cards'], summary: action === 'decline' ? 'Ablehnen' : 'Zurückziehen', params: z.object({ id: z.string() }) } }, async (req) => {
      const { user } = requireAuth(req);
      const o = await pendingOffer(req.params.id);
      if ((who === 'to' ? o.toId : o.fromId) !== user.id) throw forbidden();
      await db.tradeOffer.update({ where: { id: o.id }, data: { status, decidedAt: new Date() } });
      ctx.hub.toUsers([o.fromId, o.toId], { type: 'inventory.changed', data: {} });
      return { ok: true };
    });
  }

  // ---- Marktplatz (Karte gegen Karte) ----

  const listingInclude = {
    seller: true,
    item: { include: cardItemInclude },
    wantCard: { include: { game: true } },
  } satisfies Prisma.MarketListingInclude;

  async function listingDtos(rows: Prisma.MarketListingGetPayload<{ include: typeof listingInclude }>[], viewer: User | null, dbc: Db = db): Promise<MarketListingDto[]> {
    const wanted = viewer ? await freeItems(dbc, viewer.id) : [];
    return rows.map((l) => ({
      id: l.id,
      seller: userPublic(l.seller),
      item: cardItemDto(ctx.signer, l.item),
      wantCard: { ...cardDto(ctx.signer, l.wantCard), game: gameRef(l.wantCard.game) },
      status: l.status,
      createdAt: l.createdAt.toISOString(),
      canFulfil: !!viewer && l.sellerId !== viewer.id && wanted.some((i) => i.cardId === l.wantCardId),
      mine: l.sellerId === viewer?.id,
    }));
  }

  app.get(
    '/market',
    {
      schema: {
        tags: ['cards'],
        summary: 'Offene Marktplatz-Angebote',
        querystring: z.object({ gameId: z.string().optional(), mine: z.coerce.boolean().optional(), fulfillable: z.coerce.boolean().optional() }),
      },
    },
    async (req): Promise<MarketListingDto[]> => {
      await marketOn();
      const viewer = req.auth?.user ?? null;
      const rows = await db.marketListing.findMany({
        where: {
          status: 'OPEN',
          ...(req.query.mine && viewer ? { sellerId: viewer.id } : {}),
          ...(req.query.gameId ? { OR: [{ item: { card: { gameId: req.query.gameId } } }, { wantCard: { gameId: req.query.gameId } }] } : {}),
          item: { card: { game: viewableWhere(viewer) } },
        },
        include: listingInclude,
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const dtos = await listingDtos(rows, viewer);
      return req.query.fulfillable ? dtos.filter((d) => d.canFulfil) : dtos;
    },
  );

  app.post(
    '/market',
    { schema: { tags: ['cards'], summary: 'Karte anbieten (gesuchte Karte angeben)', body: z.object({ itemId: z.string(), wantCardId: z.string() }) } },
    async (req) => {
      const { user } = requireAuth(req);
      await marketOn();
      const [item] = await freeItems(db, user.id, { ids: [req.body.itemId] });
      if (!item) throw badRequest('Karte ist nicht verfügbar', 'items_unavailable');
      const want = await db.tradingCard.findUnique({ where: { id: req.body.wantCardId } });
      if (!want) throw notFound('Gesuchte Karte nicht gefunden');
      if (want.id === item.cardId && !item.foil) throw badRequest('Gesuchte und angebotene Karte sind identisch', 'same_card');
      // Ein früheres (beendetes) Angebot derselben Karte ersetzen
      await db.marketListing.deleteMany({ where: { itemId: item.id, status: { not: 'OPEN' } } });
      const l = await db.marketListing.create({ data: { sellerId: user.id, itemId: item.id, wantCardId: want.id }, include: listingInclude });
      ctx.hub.toUser(user.id, { type: 'inventory.changed', data: {} });
      return (await listingDtos([l], user))[0];
    },
  );

  app.post('/market/:id/fulfil', { schema: { tags: ['cards'], summary: 'Angebot annehmen (gibt die gesuchte Karte ab)', params: z.object({ id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    await marketOn();
    const l = await db.marketListing.findUnique({ where: { id: req.params.id }, include: listingInclude });
    if (!l || l.status !== 'OPEN') throw notFound('Angebot nicht mehr verfügbar');
    if (l.sellerId === user.id) throw badRequest('Eigenes Angebot', 'own_listing');
    await assertNotBlocked(db, user.id, l.sellerId);
    const mine = (await freeItems(db, user.id, { cardId: l.wantCardId })).sort((a, b) => Number(a.foil) - Number(b.foil))[0];
    if (!mine) throw badRequest('Du besitzt die gesuchte Karte nicht (frei verfügbar)', 'items_unavailable');
    await db.$transaction(async (tx) => {
      const claimed = await tx.marketListing.updateMany({
        where: { id: l.id, status: 'OPEN' },
        data: { status: 'COMPLETED', buyerId: user.id, completedAt: new Date() },
      });
      if (!claimed.count) throw notFound('Angebot nicht mehr verfügbar');
      await tx.cardItem.update({ where: { id: l.itemId }, data: { ownerId: user.id, source: 'market', acquiredAt: new Date() } });
      await tx.cardItem.update({ where: { id: mine.id }, data: { ownerId: l.sellerId, source: 'market', acquiredAt: new Date() } });
      await releaseItems(tx, [mine.id, l.itemId]);
    });
    await ctx.notifications.notify(l.sellerId, 'market.completed', { username: user.displayName ?? user.username, title: l.item.card.name, path: '/inventory' });
    ctx.hub.toUsers([user.id, l.sellerId], { type: 'inventory.changed', data: {} });
    return { ok: true };
  });

  app.delete('/market/:id', { schema: { tags: ['cards'], summary: 'Eigenes Angebot zurückziehen', params: z.object({ id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    const res = await db.marketListing.updateMany({ where: { id: req.params.id, sellerId: user.id, status: 'OPEN' }, data: { status: 'CANCELLED', completedAt: new Date() } });
    if (!res.count) throw notFound('Angebot nicht gefunden');
    ctx.hub.toUser(user.id, { type: 'inventory.changed', data: {} });
    return { ok: true };
  });

  // ---- Verwaltung der Karten eines Spiels ----

  const gameParams = z.object({ gameId: z.string() });

  async function cardList(gameId: string) {
    const cards = await db.tradingCard.findMany({ where: { gameId }, orderBy: { sortOrder: 'asc' }, include: { _count: { select: { items: true } } } });
    return cards.map((c) => ({ ...cardDto(ctx.signer, c), sortOrder: c.sortOrder, inCirculation: c._count.items }));
  }

  app.get('/manage/:gameId', { schema: { tags: ['cards'], summary: 'Karten eines Spiels verwalten', params: gameParams } }, async (req) => {
    const { user } = requireAuth(req);
    await assertCanEditGame(db, user, req.params.gameId);
    return cardList(req.params.gameId);
  });

  app.post(
    '/manage/:gameId',
    { schema: { tags: ['cards'], summary: 'Karte anlegen', params: gameParams, body: z.object({ name: z.string().trim().min(1).max(80) }) } },
    async (req) => {
      const { user } = requireAuth(req);
      await assertCanEditGame(db, user, req.params.gameId);
      const count = await db.tradingCard.count({ where: { gameId: req.params.gameId } });
      if (count >= 15) throw badRequest('Höchstens 15 Karten pro Spiel', 'too_many_cards');
      await db.tradingCard.create({ data: { gameId: req.params.gameId, name: req.body.name, sortOrder: count } });
      return cardList(req.params.gameId);
    },
  );

  app.patch(
    '/manage/:gameId/:id',
    { schema: { tags: ['cards'], summary: 'Karte umbenennen', params: z.object({ gameId: z.string(), id: z.string() }), body: z.object({ name: z.string().trim().min(1).max(80) }) } },
    async (req) => {
      const { user } = requireAuth(req);
      await assertCanEditGame(db, user, req.params.gameId);
      await db.tradingCard.updateMany({ where: { id: req.params.id, gameId: req.params.gameId }, data: { name: req.body.name } });
      return cardList(req.params.gameId);
    },
  );

  app.delete('/manage/:gameId/:id', { schema: { tags: ['cards'], summary: 'Karte löschen (inkl. aller Exemplare)', params: z.object({ gameId: z.string(), id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    await assertCanEditGame(db, user, req.params.gameId);
    const c = await db.tradingCard.findFirst({ where: { id: req.params.id, gameId: req.params.gameId } });
    if (!c) throw notFound('Karte nicht gefunden');
    await db.tradingCard.delete({ where: { id: c.id } });
    if (c.imageKey) await ctx.storage.remove(c.imageKey).catch(() => undefined);
    await ctx.audit.log({ userId: user.id, action: 'card.deleted', target: c.gameId, meta: { name: c.name }, ip: req.ip });
    return cardList(req.params.gameId);
  });

  app.post('/manage/:gameId/:id/image', { schema: { tags: ['cards'], summary: 'Kartenbild hochladen', params: z.object({ gameId: z.string(), id: z.string() }) } }, async (req) => {
    const { user } = requireAuth(req);
    await assertCanEditGame(db, user, req.params.gameId);
    const c = await db.tradingCard.findFirst({ where: { id: req.params.id, gameId: req.params.gameId } });
    if (!c) throw notFound('Karte nicht gefunden');
    const saved = await saveImageUpload(req, ctx.storage, `social/cards/${c.gameId}`, 4 * 1024 ** 2);
    if (c.imageKey) await ctx.storage.remove(c.imageKey).catch(() => undefined);
    await db.tradingCard.update({ where: { id: c.id }, data: { imageKey: saved.key } });
    return cardList(req.params.gameId);
  });
};
