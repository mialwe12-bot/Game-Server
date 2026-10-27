import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma, User } from '@prisma/client';
import type { CommunityItemDto, ForumPostDto, ForumTopicDto, ReviewDto, ReviewSummary } from '@gameserver/shared';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { saveImageUpload } from '../lib/image-upload.js';
import { requireAuth } from '../plugins/auth.js';
import { canEditGame, canViewGame } from '../services/access.js';
import { announcementDto, announcementInclude } from '../services/dto.js';
import {
  communityItemDto,
  communityItemInclude,
  postDto,
  reviewDto,
  reviewInclude,
  reviewSummary,
  topicDto,
} from '../services/social-dto.js';
import { assertCommunityAllowed } from '../services/family.js';

const gameParams = z.object({ gameId: z.string().max(100) });
const idParams = z.object({ id: z.string() });
const page = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) });
const IMAGE_LIMIT = 15 * 1024 ** 2;

/** Community pro Spiel: Reviews mit Hilfreich-Bewertung, Foren, Screenshots, Artworks, Guides, News. */
export const communityRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const { db } = ctx;

  async function viewableGame(idOrSlug: string, viewer: User | null) {
    const game = await db.game.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
    if (!game || !(await canViewGame(db, viewer, game))) throw notFound('Spiel nicht gefunden');
    return game;
  }

  const isModerator = (user: User, gameId: string) => canEditGame(db, user, gameId);

  // ---- Reviews ----

  async function summaryOf(gameId: string): Promise<ReviewSummary> {
    const [total, positive] = await Promise.all([db.review.count({ where: { gameId } }), db.review.count({ where: { gameId, recommended: true } })]);
    return reviewSummary(total, positive);
  }

  app.get(
    '/games/:gameId/reviews',
    {
      schema: {
        tags: ['community'],
        summary: 'Reviews eines Spiels mit Zusammenfassung',
        params: gameParams,
        querystring: page.extend({
          sort: z.enum(['helpful', 'recent']).default('helpful'),
          filter: z.enum(['all', 'positive', 'negative']).default('all'),
        }),
      },
    },
    async (req): Promise<{ summary: ReviewSummary; items: ReviewDto[]; total: number; mine: ReviewDto | null }> => {
      const viewer = req.auth?.user ?? null;
      const game = await viewableGame(req.params.gameId, viewer);
      const { sort, filter, page: p, pageSize } = req.query;
      const where: Prisma.ReviewWhereInput = { gameId: game.id, ...(filter === 'all' ? {} : { recommended: filter === 'positive' }) };
      const [rows, total, summary, mine] = await Promise.all([
        db.review.findMany({ where, include: reviewInclude }),
        db.review.count({ where }),
        summaryOf(game.id),
        viewer ? db.review.findUnique({ where: { gameId_userId: { gameId: game.id, userId: viewer.id } }, include: reviewInclude }) : null,
      ]);
      const dtos = rows.map((r) => reviewDto(r, viewer?.id ?? null));
      dtos.sort((a, b) =>
        sort === 'helpful'
          ? b.helpful - b.notHelpful - (a.helpful - a.notHelpful) || b.createdAt.localeCompare(a.createdAt)
          : b.createdAt.localeCompare(a.createdAt),
      );
      return { summary, items: dtos.slice((p - 1) * pageSize, p * pageSize), total, mine: mine ? reviewDto(mine, viewer!.id) : null };
    },
  );

  app.get('/games/:gameId/reviews/summary', { schema: { tags: ['community'], summary: 'Review-Zusammenfassung', params: gameParams } }, async (req) => {
    const game = await viewableGame(req.params.gameId, req.auth?.user ?? null);
    return summaryOf(game.id);
  });

  app.put(
    '/games/:gameId/reviews/mine',
    {
      schema: {
        tags: ['community'],
        summary: 'Eigenes Review schreiben/ändern (Spiel muss in der Bibliothek sein)',
        params: gameParams,
        body: z.object({ recommended: z.boolean(), body: z.string().trim().min(10).max(10000) }),
      },
    },
    async (req): Promise<ReviewDto> => {
      const { user } = requireAuth(req);
      const game = await viewableGame(req.params.gameId, user);
      await assertCommunityAllowed(db, user);
      const entry = await db.libraryEntry.findUnique({ where: { userId_gameId: { userId: user.id, gameId: game.id } } });
      if (!entry) throw forbidden('Nur Spiele aus deiner Bibliothek können bewertet werden', 'not_in_library');
      const existing = await db.review.findUnique({ where: { gameId_userId: { gameId: game.id, userId: user.id } } });
      const review = await db.review.upsert({
        where: { gameId_userId: { gameId: game.id, userId: user.id } },
        create: { gameId: game.id, userId: user.id, ...req.body, playtimeAtReview: entry.playtimeSeconds },
        update: { ...req.body, playtimeAtReview: entry.playtimeSeconds },
        include: reviewInclude,
      });
      if (!existing) await ctx.activity.record(user.id, 'review.created', { recommended: String(review.recommended) }, game.id);
      return reviewDto(review, user.id);
    },
  );

  app.delete('/games/:gameId/reviews/mine', { schema: { tags: ['community'], summary: 'Eigenes Review löschen', params: gameParams } }, async (req) => {
    const { user } = requireAuth(req);
    const game = await viewableGame(req.params.gameId, user);
    await db.review.deleteMany({ where: { gameId: game.id, userId: user.id } });
    return { ok: true };
  });

  app.delete('/reviews/:id', { schema: { tags: ['community'], summary: 'Review entfernen (Moderation)', params: idParams } }, async (req) => {
    const { user } = requireAuth(req);
    const review = await db.review.findUnique({ where: { id: req.params.id } });
    if (!review) throw notFound('Review nicht gefunden');
    if (review.userId !== user.id && !(await isModerator(user, review.gameId))) throw forbidden();
    await db.review.delete({ where: { id: review.id } });
    if (review.userId !== user.id) await ctx.audit.log({ userId: user.id, action: 'review.delete', target: review.id, meta: { gameId: review.gameId }, ip: req.ip });
    return { ok: true };
  });

  app.put(
    '/reviews/:id/vote',
    {
      schema: {
        tags: ['community'],
        summary: 'Review bewerten (hilfreich ja/nein, lustig; helpful=null entfernt die Stimme)',
        params: idParams,
        body: z.object({ helpful: z.boolean().nullable(), funny: z.boolean().default(false) }),
      },
    },
    async (req): Promise<ReviewDto> => {
      const { user } = requireAuth(req);
      const review = await db.review.findUnique({ where: { id: req.params.id }, include: { game: true } });
      if (!review || !(await canViewGame(db, user, review.game))) throw notFound('Review nicht gefunden');
      if (review.userId === user.id) throw badRequest('Eigene Reviews können nicht bewertet werden', 'own_review');
      const key = { reviewId_userId: { reviewId: review.id, userId: user.id } };
      const before = await db.reviewVote.findUnique({ where: key });
      if (req.body.helpful === null) {
        await db.reviewVote.deleteMany({ where: { reviewId: review.id, userId: user.id } });
      } else {
        const data = { helpful: req.body.helpful, funny: req.body.funny };
        await db.reviewVote.upsert({ where: key, create: { reviewId: review.id, userId: user.id, ...data }, update: data });
        if (req.body.helpful && !before?.helpful) {
          await ctx.notifications.notify(review.userId, 'review.helpful', { gameTitle: review.game.title, path: `/game/${review.game.slug}/reviews` });
        }
      }
      return reviewDto(await db.review.findUniqueOrThrow({ where: { id: review.id }, include: reviewInclude }), user.id);
    },
  );

  // ---- Forum ----

  const topicInclude = { author: true, _count: { select: { posts: true } } };

  app.get(
    '/games/:gameId/topics',
    { schema: { tags: ['community'], summary: 'Forenthemen eines Spiels', params: gameParams, querystring: page.extend({ q: z.string().trim().max(100).optional() }) } },
    async (req): Promise<{ items: ForumTopicDto[]; total: number }> => {
      const game = await viewableGame(req.params.gameId, req.auth?.user ?? null);
      const where: Prisma.ForumTopicWhereInput = { gameId: game.id, ...(req.query.q ? { title: { contains: req.query.q, mode: 'insensitive' } } : {}) };
      const [rows, total] = await Promise.all([
        db.forumTopic.findMany({
          where,
          include: topicInclude,
          orderBy: [{ pinned: 'desc' }, { lastPostAt: 'desc' }],
          skip: (req.query.page - 1) * req.query.pageSize,
          take: req.query.pageSize,
        }),
        db.forumTopic.count({ where }),
      ]);
      return { items: rows.map(topicDto), total };
    },
  );

  app.post(
    '/games/:gameId/topics',
    {
      schema: {
        tags: ['community'],
        summary: 'Thema eröffnen',
        params: gameParams,
        body: z.object({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(1).max(20000) }),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req): Promise<ForumTopicDto> => {
      const { user } = requireAuth(req);
      const game = await viewableGame(req.params.gameId, user);
      await assertCommunityAllowed(db, user);
      const topic = await db.forumTopic.create({
        data: { gameId: game.id, authorId: user.id, title: req.body.title, posts: { create: { authorId: user.id, body: req.body.body } } },
        include: topicInclude,
      });
      await ctx.activity.record(user.id, 'forum.topic', { title: topic.title, topicId: topic.id }, game.id);
      return topicDto(topic);
    },
  );

  async function loadTopic(id: string, viewer: User | null) {
    const topic = await db.forumTopic.findUnique({ where: { id }, include: { ...topicInclude, game: true } });
    if (!topic || !(await canViewGame(db, viewer, topic.game))) throw notFound('Thema nicht gefunden');
    return topic;
  }

  app.get(
    '/topics/:id',
    { schema: { tags: ['community'], summary: 'Thema mit Beiträgen', params: idParams, querystring: z.object({ page: z.coerce.number().int().min(1).default(1) }) } },
    async (req): Promise<{ topic: ForumTopicDto; game: { id: string; slug: string; title: string }; posts: ForumPostDto[]; total: number; canModerate: boolean }> => {
      const viewer = req.auth?.user ?? null;
      const topic = await loadTopic(req.params.id, viewer);
      const pageSize = 50;
      const posts = await db.forumPost.findMany({
        where: { topicId: topic.id },
        include: { author: true },
        orderBy: { createdAt: 'asc' },
        skip: (req.query.page - 1) * pageSize,
        take: pageSize,
      });
      return {
        topic: topicDto(topic),
        game: { id: topic.game.id, slug: topic.game.slug, title: topic.game.title },
        posts: posts.map(postDto),
        total: topic._count.posts,
        canModerate: !!viewer && (await isModerator(viewer, topic.gameId)),
      };
    },
  );

  app.post(
    '/topics/:id/posts',
    {
      schema: { tags: ['community'], summary: 'Antworten', params: idParams, body: z.object({ body: z.string().trim().min(1).max(20000) }) },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req): Promise<ForumPostDto> => {
      const { user } = requireAuth(req);
      const topic = await loadTopic(req.params.id, user);
      await assertCommunityAllowed(db, user);
      if (topic.locked && !(await isModerator(user, topic.gameId))) throw forbidden('Thema ist geschlossen', 'locked');
      const post = await db.forumPost.create({ data: { topicId: topic.id, authorId: user.id, body: req.body.body }, include: { author: true } });
      await db.forumTopic.update({ where: { id: topic.id }, data: { lastPostAt: post.createdAt } });
      // Ersteller und bisherige Teilnehmer benachrichtigen
      const participants = await db.forumPost.findMany({ where: { topicId: topic.id, authorId: { not: null } }, distinct: ['authorId'], select: { authorId: true } });
      for (const p of participants) {
        if (p.authorId && p.authorId !== user.id) {
          await ctx.notifications.notify(p.authorId, 'forum.reply', {
            username: user.displayName ?? user.username,
            title: topic.title,
            gameTitle: topic.game.title,
            preview: post.body.slice(0, 200),
            path: `/game/${topic.game.slug}/forum/${topic.id}`,
          });
        }
      }
      return postDto(post);
    },
  );

  app.patch(
    '/topics/:id',
    {
      schema: {
        tags: ['community'],
        summary: 'Thema bearbeiten (Titel: Autor; anheften/schließen: Moderation)',
        params: idParams,
        body: z.object({ title: z.string().trim().min(3).max(160).optional(), pinned: z.boolean().optional(), locked: z.boolean().optional() }),
      },
    },
    async (req): Promise<ForumTopicDto> => {
      const { user } = requireAuth(req);
      const topic = await loadTopic(req.params.id, user);
      const mod = await isModerator(user, topic.gameId);
      if ((req.body.pinned !== undefined || req.body.locked !== undefined) && !mod) throw forbidden();
      if (req.body.title !== undefined && topic.authorId !== user.id && !mod) throw forbidden();
      const updated = await db.forumTopic.update({ where: { id: topic.id }, data: req.body, include: topicInclude });
      return topicDto(updated);
    },
  );

  app.delete('/topics/:id', { schema: { tags: ['community'], summary: 'Thema löschen (Moderation)', params: idParams } }, async (req) => {
    const { user } = requireAuth(req);
    const topic = await loadTopic(req.params.id, user);
    if (!(await isModerator(user, topic.gameId))) throw forbidden();
    await db.forumTopic.delete({ where: { id: topic.id } });
    await ctx.audit.log({ userId: user.id, action: 'forum.topic.delete', target: topic.id, meta: { title: topic.title }, ip: req.ip });
    return { ok: true };
  });

  async function loadPost(id: string, user: User) {
    const post = await db.forumPost.findUnique({ where: { id }, include: { topic: { include: { game: true } } } });
    if (!post || !(await canViewGame(db, user, post.topic.game))) throw notFound('Beitrag nicht gefunden');
    return post;
  }

  app.patch(
    '/posts/:id',
    { schema: { tags: ['community'], summary: 'Eigenen Beitrag bearbeiten', params: idParams, body: z.object({ body: z.string().trim().min(1).max(20000) }) } },
    async (req): Promise<ForumPostDto> => {
      const { user } = requireAuth(req);
      const post = await loadPost(req.params.id, user);
      if (post.authorId !== user.id && !(await isModerator(user, post.topic.gameId))) throw forbidden();
      const updated = await db.forumPost.update({ where: { id: post.id }, data: { body: req.body.body, editedAt: new Date() }, include: { author: true } });
      return postDto(updated);
    },
  );

  app.delete('/posts/:id', { schema: { tags: ['community'], summary: 'Beitrag löschen (Autor/Moderation)', params: idParams } }, async (req) => {
    const { user } = requireAuth(req);
    const post = await loadPost(req.params.id, user);
    if (post.authorId !== user.id && !(await isModerator(user, post.topic.gameId))) throw forbidden();
    const first = await db.forumPost.findFirst({ where: { topicId: post.topicId }, orderBy: { createdAt: 'asc' } });
    if (first?.id === post.id) {
      // Erster Beitrag = Thema
      await db.forumTopic.delete({ where: { id: post.topicId } });
    } else {
      await db.forumPost.delete({ where: { id: post.id } });
    }
    return { ok: true };
  });

  // ---- Screenshots, Artworks, Guides ----

  app.get(
    '/games/:gameId/items',
    {
      schema: {
        tags: ['community'],
        summary: 'Community-Inhalte eines Spiels',
        params: gameParams,
        querystring: page.extend({ type: z.enum(['SCREENSHOT', 'ARTWORK', 'GUIDE']).optional(), sort: z.enum(['recent', 'popular']).default('recent') }),
      },
    },
    async (req): Promise<{ items: CommunityItemDto[]; total: number }> => {
      const viewer = req.auth?.user ?? null;
      const game = await viewableGame(req.params.gameId, viewer);
      const { type, sort, page: p, pageSize } = req.query;
      const where: Prisma.CommunityItemWhereInput = { gameId: game.id, ...(type ? { type } : {}) };
      const [rows, total] = await Promise.all([
        db.communityItem.findMany({
          where,
          include: communityItemInclude,
          orderBy: sort === 'popular' ? [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }] : { createdAt: 'desc' },
          skip: (p - 1) * pageSize,
          take: pageSize,
        }),
        db.communityItem.count({ where }),
      ]);
      return { items: rows.map((i) => communityItemDto(ctx.signer, i, viewer?.id ?? null)), total };
    },
  );

  app.post(
    '/games/:gameId/items/image',
    {
      schema: {
        tags: ['community'],
        summary: 'Screenshot/Artwork hochladen (multipart, Feld „file“)',
        params: gameParams,
        querystring: z.object({
          type: z.enum(['SCREENSHOT', 'ARTWORK']).default('SCREENSHOT'),
          title: z.string().trim().max(160).default(''),
          body: z.string().max(2000).default(''),
        }),
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req): Promise<CommunityItemDto> => {
      const { user } = requireAuth(req);
      const game = await viewableGame(req.params.gameId, user);
      await assertCommunityAllowed(db, user);
      const saved = await saveImageUpload(req, ctx.storage, `social/community/${game.id}`, IMAGE_LIMIT);
      const item = await db.communityItem.create({
        data: { gameId: game.id, authorId: user.id, type: req.query.type, title: req.query.title, body: req.query.body, imageKey: saved.key, imageMime: saved.mime },
        include: communityItemInclude,
      });
      await ctx.activity.record(user.id, 'community.posted', { itemType: item.type, itemId: item.id, title: item.title }, game.id);
      return communityItemDto(ctx.signer, item, user.id);
    },
  );

  app.post(
    '/games/:gameId/guides',
    {
      schema: {
        tags: ['community'],
        summary: 'Guide veröffentlichen (Markdown)',
        params: gameParams,
        body: z.object({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(20).max(100000) }),
      },
    },
    async (req): Promise<CommunityItemDto> => {
      const { user } = requireAuth(req);
      const game = await viewableGame(req.params.gameId, user);
      await assertCommunityAllowed(db, user);
      const item = await db.communityItem.create({ data: { gameId: game.id, authorId: user.id, type: 'GUIDE', ...req.body }, include: communityItemInclude });
      await ctx.activity.record(user.id, 'community.posted', { itemType: 'GUIDE', itemId: item.id, title: item.title }, game.id);
      return communityItemDto(ctx.signer, item, user.id);
    },
  );

  async function loadItem(id: string, viewer: User | null) {
    const item = await db.communityItem.findUnique({ where: { id }, include: communityItemInclude });
    if (!item || !(await canViewGame(db, viewer, item.game))) throw notFound('Inhalt nicht gefunden');
    return item;
  }

  app.get('/items/:id', { schema: { tags: ['community'], summary: 'Community-Inhalt', params: idParams } }, async (req): Promise<CommunityItemDto & { canEdit: boolean }> => {
    const viewer = req.auth?.user ?? null;
    const item = await loadItem(req.params.id, viewer);
    const canEdit = !!viewer && (item.authorId === viewer.id || (await isModerator(viewer, item.gameId)));
    return { ...communityItemDto(ctx.signer, item, viewer?.id ?? null), canEdit };
  });

  app.patch(
    '/items/:id',
    {
      schema: {
        tags: ['community'],
        summary: 'Eigenen Inhalt bearbeiten',
        params: idParams,
        body: z.object({ title: z.string().trim().max(160).optional(), body: z.string().max(100000).optional() }),
      },
    },
    async (req): Promise<CommunityItemDto> => {
      const { user } = requireAuth(req);
      const item = await loadItem(req.params.id, user);
      if (item.authorId !== user.id && !(await isModerator(user, item.gameId))) throw forbidden();
      const updated = await db.communityItem.update({ where: { id: item.id }, data: req.body, include: communityItemInclude });
      return communityItemDto(ctx.signer, updated, user.id);
    },
  );

  app.delete('/items/:id', { schema: { tags: ['community'], summary: 'Inhalt löschen (Autor/Moderation)', params: idParams } }, async (req) => {
    const { user } = requireAuth(req);
    const item = await loadItem(req.params.id, user);
    if (item.authorId !== user.id && !(await isModerator(user, item.gameId))) throw forbidden();
    await db.communityItem.delete({ where: { id: item.id } });
    if (item.imageKey) await ctx.storage.remove(item.imageKey).catch(() => undefined);
    return { ok: true };
  });

  app.put('/items/:id/like', { schema: { tags: ['community'], summary: 'Gefällt mir', params: idParams } }, async (req) => {
    const { user } = requireAuth(req);
    const item = await loadItem(req.params.id, user);
    await db.communityLike.upsert({ where: { itemId_userId: { itemId: item.id, userId: user.id } }, create: { itemId: item.id, userId: user.id }, update: {} });
    return { likes: await db.communityLike.count({ where: { itemId: item.id } }), liked: true };
  });

  app.delete('/items/:id/like', { schema: { tags: ['community'], summary: 'Gefällt mir entfernen', params: idParams } }, async (req) => {
    const { user } = requireAuth(req);
    const item = await loadItem(req.params.id, user);
    await db.communityLike.deleteMany({ where: { itemId: item.id, userId: user.id } });
    return { likes: await db.communityLike.count({ where: { itemId: item.id } }), liked: false };
  });

  // ---- News (veröffentlichte Ankündigungen zum Spiel) ----

  app.get('/games/:gameId/news', { schema: { tags: ['community'], summary: 'News zum Spiel', params: gameParams } }, async (req) => {
    const game = await viewableGame(req.params.gameId, req.auth?.user ?? null);
    const rows = await db.announcement.findMany({
      where: { gameId: game.id, published: true },
      include: announcementInclude,
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    return rows.map(announcementDto);
  });
};
