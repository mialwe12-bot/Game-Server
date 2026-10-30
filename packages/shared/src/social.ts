// Phase 3 – Soziales: Freunde, Profile, Chat, Gruppen, Community, Benachrichtigungen, Aktivitäten.
import type { GameSummary, UserPublic } from './types.js';

export type ProfileVisibility = 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
export type RelationState = 'self' | 'none' | 'friends' | 'outgoing' | 'incoming' | 'blocked' | 'blockedBy';

export interface Presence {
  userId: string;
  online: boolean;
  /** Läuft gerade ein Spiel (vom Desktop-Client gemeldet) */
  game: { id: string; slug: string; title: string } | null;
  lastSeenAt: string | null;
}

export interface FriendDto {
  user: UserPublic;
  presence: Presence;
  since: string;
}

export interface FriendRequestDto {
  id: string;
  user: UserPublic;
  direction: 'incoming' | 'outgoing';
  createdAt: string;
}

export interface FriendsOverview {
  friends: FriendDto[];
  incoming: FriendRequestDto[];
  outgoing: FriendRequestDto[];
  blocked: UserPublic[];
}

export interface UserSearchResult {
  user: UserPublic;
  relation: RelationState;
}

export type ShowcaseKind =
  | 'favoriteGame'
  | 'stats'
  | 'recentGames'
  | 'screenshots'
  | 'reviews'
  | 'groups'
  | 'badges'
  | 'text'
  | 'achievements'
  | 'gameBadges'
  | 'workshop';
export const SHOWCASE_KINDS: ShowcaseKind[] = [
  'favoriteGame',
  'stats',
  'recentGames',
  'screenshots',
  'reviews',
  'groups',
  'badges',
  'text',
  'achievements',
  'gameBadges',
  'workshop',
];

export interface ShowcaseConfig {
  kind: ShowcaseKind;
  gameId?: string;
  title?: string;
  text?: string;
}

export interface BadgeDto {
  id: string;
  level: number;
  /** Fortschrittswert, z. B. Anzahl Spiele */
  value: number;
}

export interface ProfileStats {
  achievements: number;
  games: number;
  playtimeSeconds: number;
  reviews: number;
  friends: number;
  screenshots: number;
  groups: number;
}

export interface ResolvedShowcase {
  kind: ShowcaseKind;
  title: string | null;
  text: string | null;
  game: GameSummary | null;
  games: { game: GameSummary; playtimeSeconds: number; lastPlayedAt: string | null }[];
  items: CommunityItemDto[];
  reviews: ReviewDto[];
  groups: GroupSummary[];
  /** Phase 4 */
  achievements: (import('./steam.js').AchievementDto & { game: import('./steam.js').GameRef })[];
  gameBadges: import('./steam.js').GameBadgeDto[];
  workshopItems: import('./steam.js').WorkshopItemDto[];
}

export interface ProfileDto {
  user: UserPublic;
  backgroundUrl: string | null;
  accent: string | null;
  visibility: ProfileVisibility;
  /** Profil wegen Privatsphäre nur eingeschränkt sichtbar */
  restricted: boolean;
  relation: RelationState;
  presence: Presence | null;
  stats: ProfileStats | null;
  badges: BadgeDto[];
  showcases: ResolvedShowcase[];
  activity: ActivityDto[];
  /** Phase 4 */
  level: import('./steam.js').ProfileLevel | null;
  achievementCount: number;
}

export interface ProfileSettings {
  accent: string | null;
  backgroundUrl: string | null;
  visibility: ProfileVisibility;
  allowFriendRequests: boolean;
  showcases: ShowcaseConfig[];
  notificationPrefs: NotificationPrefs;
}

// ---- Chat ----

export type ConversationType = 'DIRECT' | 'GROUP' | 'CHANNEL';

export interface MessageDto {
  id: string;
  conversationId: string;
  author: UserPublic | null;
  body: string;
  attachmentUrl: string | null;
  attachmentMime: string | null;
  gifUrl: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

export interface ConversationDto {
  id: string;
  type: ConversationType;
  title: string;
  avatarUrl: string | null;
  group: { id: string; slug: string; name: string } | null;
  members: UserPublic[];
  unread: number;
  lastMessage: MessageDto | null;
  lastMessageAt: string;
  muted: boolean;
  canManage: boolean;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Voice-Backend: eingebautes WebRTC-Mesh oder ein eigener LiveKit-SFU. */
export type VoiceBackend = 'MESH' | 'LIVEKIT';

export interface ChatConfig {
  gifsEnabled: boolean;
  voiceEnabled: boolean;
  /** Welches Voice-Backend aktiv ist. */
  voiceBackend: VoiceBackend;
  /** Öffentliche wss-URL des LiveKit-Servers (nur bei Backend LIVEKIT). */
  livekitUrl: string;
  iceServers: IceServer[];
  maxImageBytes: number;
}

/** Zugangsdaten, um einem LiveKit-Voice-Raum beizutreten. */
export interface VoiceToken {
  url: string;
  token: string;
  room: string;
  /** Name des gewählten Voice-Servers (für Anzeige, z. B. bei Failover auf einen Fallback). */
  name?: string;
}

export interface GifResult {
  id: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
}

// ---- Gruppen ----

export type GroupJoinPolicy = 'OPEN' | 'REQUEST' | 'INVITE';
export type GroupVisibility = 'PUBLIC' | 'HIDDEN';
export type GroupRole = 'OWNER' | 'MODERATOR' | 'MEMBER';
export type GroupMemberStatus = 'ACTIVE' | 'PENDING' | 'INVITED';
export type RsvpStatus = 'GOING' | 'MAYBE' | 'DECLINED';

export interface GroupSummary {
  id: string;
  slug: string;
  name: string;
  summary: string;
  avatarUrl: string | null;
  memberCount: number;
  joinPolicy: GroupJoinPolicy;
  visibility: GroupVisibility;
}

export interface GroupAnnouncementDto {
  id: string;
  title: string;
  body: string;
  author: UserPublic | null;
  createdAt: string;
}

export interface GroupEventDto {
  id: string;
  groupId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  game: { id: string; slug: string; title: string } | null;
  rsvp: { going: number; maybe: number; declined: number };
  myRsvp: RsvpStatus | null;
}

export interface GroupDetail extends GroupSummary {
  description: string;
  bannerUrl: string | null;
  createdAt: string;
  myRole: GroupRole | null;
  myStatus: GroupMemberStatus | null;
  canManage: boolean;
  announcements: GroupAnnouncementDto[];
  upcomingEvents: GroupEventDto[];
  channels: { id: string; title: string }[];
}

export interface GroupMemberDto {
  user: UserPublic;
  role: GroupRole;
  status: GroupMemberStatus;
  joinedAt: string;
}

// ---- Community pro Spiel ----

export interface ReviewDto {
  id: string;
  gameId: string;
  game: { id: string; slug: string; title: string } | null;
  author: UserPublic;
  recommended: boolean;
  body: string;
  playtimeAtReview: number;
  createdAt: string;
  updatedAt: string;
  helpful: number;
  notHelpful: number;
  funny: number;
  myVote: { helpful: boolean; funny: boolean } | null;
}

export type ReviewScore =
  | 'none'
  | 'overwhelmingly_positive'
  | 'very_positive'
  | 'positive'
  | 'mostly_positive'
  | 'mixed'
  | 'mostly_negative'
  | 'negative'
  | 'very_negative'
  | 'overwhelmingly_negative';

export interface ReviewSummary {
  total: number;
  positive: number;
  percent: number;
  score: ReviewScore;
}

export interface ForumTopicDto {
  id: string;
  gameId: string;
  title: string;
  author: UserPublic | null;
  pinned: boolean;
  locked: boolean;
  createdAt: string;
  lastPostAt: string;
  postCount: number;
}

export interface ForumPostDto {
  id: string;
  topicId: string;
  author: UserPublic | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

export type CommunityItemType = 'SCREENSHOT' | 'ARTWORK' | 'GUIDE';

export interface CommunityItemDto {
  id: string;
  type: CommunityItemType;
  game: { id: string; slug: string; title: string };
  title: string;
  body: string;
  imageUrl: string | null;
  author: UserPublic | null;
  likes: number;
  liked: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Benachrichtigungen & Aktivitäten ----

export type NotificationType =
  | 'friend.request'
  | 'friend.accepted'
  | 'game.invite'
  | 'message'
  | 'group.invite'
  | 'group.request'
  | 'group.accepted'
  | 'group.announcement'
  | 'event.created'
  | 'event.reminder'
  | 'review.helpful'
  | 'forum.reply'
  // Phase 4
  | 'card.drop'
  | 'trade.offer'
  | 'trade.accepted'
  | 'market.completed'
  | 'gift.received'
  | 'family.invite'
  | 'workshop.comment';

export interface NotificationDto {
  id: string;
  type: NotificationType;
  /** Werte für die Anzeige (username, gameTitle, groupName, title, path, …) */
  data: Record<string, string>;
  read: boolean;
  createdAt: string;
}

export interface NotificationPrefs {
  email: { friends: boolean; messages: boolean; groups: boolean; events: boolean; community: boolean; trading: boolean };
}

export type ActivityType =
  | 'achievement.unlocked'
  | 'badge.crafted'
  | 'workshop.published'
  | 'library.added'
  | 'game.played'
  | 'review.created'
  | 'community.posted'
  | 'group.joined'
  | 'friend.added'
  | 'forum.topic';

export interface ActivityDto {
  id: string;
  user: UserPublic;
  type: ActivityType;
  data: Record<string, string>;
  game: { id: string; slug: string; title: string; coverUrl: string | null } | null;
  createdAt: string;
}
