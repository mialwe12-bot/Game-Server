import type {
  CommunityItem,
  ForumPost,
  ForumTopic,
  Game,
  Group,
  GroupAnnouncement,
  GroupEvent,
  GroupEventRsvp,
  Message,
  Review,
  ReviewVote,
  User,
} from '@prisma/client';
import type {
  CommunityItemDto,
  ForumPostDto,
  ForumTopicDto,
  GroupAnnouncementDto,
  GroupEventDto,
  GroupSummary,
  MessageDto,
  ReviewDto,
  ReviewScore,
  ReviewSummary,
} from '@gameserver/shared';
import { fileUrl } from '../lib/image-upload.js';
import type { UrlSigner } from '../lib/sign.js';
import { iso } from '../lib/time.js';
import { userPublic } from './dto.js';

const gameRef = (g: Pick<Game, 'id' | 'slug' | 'title'>) => ({ id: g.id, slug: g.slug, title: g.title });

export function messageDto(signer: UrlSigner, m: Message & { author: User | null }): MessageDto {
  const deleted = !!m.deletedAt;
  return {
    id: m.id,
    conversationId: m.conversationId,
    author: m.author ? userPublic(m.author) : null,
    body: deleted ? '' : m.body,
    attachmentUrl: deleted ? null : fileUrl(signer, m.attachmentKey),
    attachmentMime: deleted ? null : m.attachmentMime,
    gifUrl: deleted ? null : m.gifUrl,
    createdAt: m.createdAt.toISOString(),
    editedAt: iso(m.editedAt),
    deleted,
  };
}

export function groupSummary(signer: UrlSigner, g: Group & { _count: { members: number } }): GroupSummary {
  return {
    id: g.id,
    slug: g.slug,
    name: g.name,
    summary: g.summary,
    avatarUrl: fileUrl(signer, g.avatarKey),
    memberCount: g._count.members,
    joinPolicy: g.joinPolicy,
    visibility: g.visibility,
  };
}

/** _count nur aktiver Mitglieder */
export const groupCountInclude = { _count: { select: { members: { where: { status: 'ACTIVE' as const } } } } };

export function announcementDto(a: GroupAnnouncement & { author: User | null }): GroupAnnouncementDto {
  return { id: a.id, title: a.title, body: a.body, author: a.author ? userPublic(a.author) : null, createdAt: a.createdAt.toISOString() };
}

export function eventDto(e: GroupEvent & { game: Game | null; rsvps: GroupEventRsvp[] }, viewerId: string | null): GroupEventDto {
  const count = (s: GroupEventRsvp['status']) => e.rsvps.filter((r) => r.status === s).length;
  return {
    id: e.id,
    groupId: e.groupId,
    title: e.title,
    description: e.description,
    startsAt: e.startsAt.toISOString(),
    endsAt: iso(e.endsAt),
    game: e.game ? gameRef(e.game) : null,
    rsvp: { going: count('GOING'), maybe: count('MAYBE'), declined: count('DECLINED') },
    myRsvp: e.rsvps.find((r) => r.userId === viewerId)?.status ?? null,
  };
}

export const reviewInclude = { user: true, game: true, votes: true };

export function reviewDto(r: Review & { user: User; game: Game; votes: ReviewVote[] }, viewerId: string | null): ReviewDto {
  const mine = r.votes.find((v) => v.userId === viewerId);
  return {
    id: r.id,
    gameId: r.gameId,
    game: gameRef(r.game),
    author: userPublic(r.user),
    recommended: r.recommended,
    body: r.body,
    playtimeAtReview: r.playtimeAtReview,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    helpful: r.votes.filter((v) => v.helpful).length,
    notHelpful: r.votes.filter((v) => !v.helpful).length,
    funny: r.votes.filter((v) => v.funny).length,
    myVote: mine ? { helpful: mine.helpful, funny: mine.funny } : null,
  };
}

/** Bewertungsstufe nach dem bekannten Schema (Anteil positiver Reviews und Anzahl). */
export function reviewScore(total: number, positive: number): ReviewScore {
  if (total === 0) return 'none';
  const pct = (positive / total) * 100;
  if (pct >= 95 && total >= 500) return 'overwhelmingly_positive';
  if (pct >= 80 && total >= 50) return 'very_positive';
  if (pct >= 80) return 'positive';
  if (pct >= 70) return 'mostly_positive';
  if (pct >= 40) return 'mixed';
  if (pct >= 20) return 'mostly_negative';
  if (total >= 500) return 'overwhelmingly_negative';
  if (total >= 50) return 'very_negative';
  return 'negative';
}

export function reviewSummary(total: number, positive: number): ReviewSummary {
  return { total, positive, percent: total ? Math.round((positive / total) * 100) : 0, score: reviewScore(total, positive) };
}

export function topicDto(t: ForumTopic & { author: User | null; _count: { posts: number } }): ForumTopicDto {
  return {
    id: t.id,
    gameId: t.gameId,
    title: t.title,
    author: t.author ? userPublic(t.author) : null,
    pinned: t.pinned,
    locked: t.locked,
    createdAt: t.createdAt.toISOString(),
    lastPostAt: t.lastPostAt.toISOString(),
    postCount: t._count.posts,
  };
}

export function postDto(p: ForumPost & { author: User | null }): ForumPostDto {
  return { id: p.id, topicId: p.topicId, author: p.author ? userPublic(p.author) : null, body: p.body, createdAt: p.createdAt.toISOString(), editedAt: iso(p.editedAt) };
}

export const communityItemInclude = { author: true, game: true, likes: { select: { userId: true } } };

export function communityItemDto(
  signer: UrlSigner,
  i: CommunityItem & { author: User | null; game: Game; likes: { userId: string }[] },
  viewerId: string | null,
): CommunityItemDto {
  return {
    id: i.id,
    type: i.type,
    game: gameRef(i.game),
    title: i.title,
    body: i.body,
    imageUrl: fileUrl(signer, i.imageKey),
    author: i.author ? userPublic(i.author) : null,
    likes: i.likes.length,
    liked: !!viewerId && i.likes.some((l) => l.userId === viewerId),
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}
