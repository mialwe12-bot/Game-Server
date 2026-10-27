// Phase 4 – Steam-Funktionen: Cloud-Saves, Achievements, Workshop, Karten/Level/Handel, Familie, Statistiken.
import type { GameSummary, Platform, UserPublic } from './types.js';

export type GameRef = { id: string; slug: string; title: string; coverUrl?: string | null };

// ---- Cloud-Saves ----

export type SavePlatform = 'WINDOWS' | 'LINUX' | 'ANY';

/**
 * Save-Pfad eines Spiels. Platzhalter: %APPDATA%, %LOCALAPPDATA%, %USERPROFILE%, %DOCUMENTS%, %SAVEDGAMES% (Windows bzw.
 * im Proton/Wine-Prefix), $HOME, $XDG_DATA_HOME, $XDG_CONFIG_HOME (Linux), {install} (Installationsordner).
 * include/exclude sind Glob-Muster relativ zum Pfad (Standard: alles).
 */
export interface SavePathConfig {
  platform: SavePlatform;
  path: string;
  include?: string[];
  exclude?: string[];
}

export interface CloudSaveFile {
  /** Index des Save-Pfads in `savePaths` */
  root: number;
  path: string;
  size: number;
  sha256: string;
  /** Änderungszeit (ms seit Epoch) */
  mtime: number;
}

export interface CloudSaveDto {
  id: string;
  gameId: string;
  version: number;
  size: number;
  contentHash: string;
  fileCount: number;
  deviceName: string | null;
  platform: Platform | null;
  createdAt: string;
  downloadUrl: string;
}

export interface CloudSaveStatus {
  enabled: boolean;
  savePaths: SavePathConfig[];
  latest: (CloudSaveDto & { manifest: CloudSaveFile[] }) | null;
  versions: CloudSaveDto[];
  quotaBytes: number;
  usedBytes: number;
}

export interface CloudSaveOverview {
  game: GameRef;
  latest: CloudSaveDto;
  versions: number;
  totalBytes: number;
}

// ---- Achievements ----

export type AchievementDetectionType = 'file_exists' | 'file_regex' | 'log_regex';

export interface AchievementDetection {
  type: AchievementDetectionType;
  /** Pfad mit denselben Platzhaltern wie Save-Pfade */
  path: string;
  /** Regulärer Ausdruck (für file_regex/log_regex) */
  pattern?: string;
}

export interface AchievementDto {
  id: string;
  gameId: string;
  apiName: string;
  /** Bei versteckten, nicht freigeschalteten Achievements leer */
  name: string;
  description: string;
  iconUrl: string | null;
  hidden: boolean;
  progressMax: number | null;
  /** Anteil der Besitzer mit Freischaltung (0–100) */
  rarity: number;
  unlocked: boolean;
  unlockedAt: string | null;
  progress: number;
}

export interface AdminAchievementDto extends AchievementDto {
  sortOrder: number;
  detection: AchievementDetection | null;
  unlockCount: number;
}

export interface GameAchievements {
  game: GameRef;
  total: number;
  unlocked: number;
  achievements: AchievementDto[];
}

export interface AchievementUnlockResult {
  achievement: AchievementDto;
  /** true, wenn durch diesen Aufruf neu freigeschaltet */
  newlyUnlocked: boolean;
}

export interface GameTokenResponse {
  token: string;
  expiresAt: string;
  gameId: string;
}

// ---- Workshop ----

export type WorkshopKind = 'MOD' | 'MAP' | 'OTHER';

export interface WorkshopVersionDto {
  id: string;
  version: string;
  changelog: string;
  fileName: string;
  size: number;
  sha256: string;
  createdAt: string;
  downloadUrl: string;
}

export interface WorkshopItemDto {
  id: string;
  game: GameRef;
  author: UserPublic | null;
  title: string;
  description: string;
  kind: WorkshopKind;
  tags: string[];
  previewUrl: string | null;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
  latestVersion: WorkshopVersionDto | null;
  up: number;
  down: number;
  myRating: boolean | null;
  subscribers: number;
  subscribed: boolean;
  canEdit: boolean;
}

export interface WorkshopCommentDto {
  id: string;
  author: UserPublic | null;
  body: string;
  createdAt: string;
}

/** Für den Client: abonnierte Inhalte installierter Spiele */
export interface WorkshopSubscriptionDto {
  itemId: string;
  gameId: string;
  title: string;
  workshopPath: string;
  version: WorkshopVersionDto;
}

// ---- Sammelkarten, Abzeichen, Level, Handel ----

export interface TradingCardDto {
  id: string;
  gameId: string;
  name: string;
  imageUrl: string | null;
}

export interface CardItemDto {
  id: string;
  card: TradingCardDto;
  game: GameRef;
  foil: boolean;
  source: string;
  acquiredAt: string;
  /** Im Marktplatz angeboten oder in einem offenen Tauschangebot */
  locked: boolean;
}

export interface GameCardSet {
  game: GameRef;
  cards: (TradingCardDto & { owned: number })[];
  drops: { received: number; max: number; nextInSeconds: number | null };
  badgeLevel: number;
  canCraft: boolean;
}

export interface ProfileLevel {
  level: number;
  xp: number;
  /** XP, ab denen das aktuelle Level gilt */
  levelXp: number;
  /** XP für das nächste Level */
  nextLevelXp: number;
}

export interface InventoryDto {
  items: CardItemDto[];
  sets: GameCardSet[];
  level: ProfileLevel;
}

export interface GameBadgeDto {
  game: GameRef;
  level: number;
  craftedAt: string;
}

export type TradeStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';

export interface TradeOfferDto {
  id: string;
  from: UserPublic;
  to: UserPublic;
  message: string;
  status: TradeStatus;
  createdAt: string;
  decidedAt: string | null;
  give: CardItemDto[];
  receive: CardItemDto[];
  direction: 'incoming' | 'outgoing';
}

export interface MarketListingDto {
  id: string;
  seller: UserPublic;
  item: CardItemDto;
  wantCard: TradingCardDto & { game: GameRef };
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  /** Der Betrachter besitzt die gesuchte Karte (frei verfügbar) */
  canFulfil: boolean;
  mine: boolean;
}

// ---- Familie, Geschenke, Codes, Kindersicherung ----

export type FamilyRole = 'ADULT' | 'CHILD';

export interface ParentalSettings {
  maxAgeRating: number;
  dailyMinutes: number | null;
  chatAllowed: boolean;
  communityAllowed: boolean;
}

export interface FamilyMemberDto {
  user: UserPublic;
  role: FamilyRole;
  joinedAt: string;
  parental: ParentalSettings;
}

export interface FamilyDto {
  id: string;
  name: string;
  members: FamilyMemberDto[];
  invites: { id: string; user: UserPublic; role: FamilyRole; createdAt: string }[];
  myRole: FamilyRole;
}

export interface FamilyInviteDto {
  id: string;
  family: { id: string; name: string };
  role: FamilyRole;
  invitedBy: UserPublic[];
  createdAt: string;
}

export interface FamilyLibraryEntry {
  game: GameSummary;
  owners: UserPublic[];
  inMyLibrary: boolean;
}

/** Wirksame Einschränkungen des angemeldeten Nutzers (Kinderkonto) */
export interface ParentalStatus {
  restricted: boolean;
  maxAgeRating: number;
  dailyMinutes: number | null;
  playedTodaySeconds: number;
  remainingSeconds: number | null;
  chatAllowed: boolean;
  communityAllowed: boolean;
}

export interface GiftDto {
  id: string;
  game: GameRef;
  from: UserPublic | null;
  to: UserPublic;
  message: string;
  createdAt: string;
  opened: boolean;
}

export interface ActivationCodeDto {
  id: string;
  code: string;
  game: GameRef;
  batch: string;
  note: string;
  maxUses: number;
  uses: number;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}

export const AGE_RATINGS = [0, 6, 12, 16, 18] as const;

// ---- Notizen, Geräte ----

export interface GameNoteDto {
  gameId: string;
  body: string;
  updatedAt: string | null;
}

export interface RemoteDeviceDto {
  sessionId: string;
  name: string;
  online: boolean;
  lastUsedAt: string;
  current: boolean;
}

export type RemoteCommand = { action: 'install'; gameId: string } | { action: 'launch'; gameId: string };

// ---- Statistiken ----

export interface PlaytimeWeek {
  weekStart: string;
  seconds: number;
  games: { gameId: string; seconds: number }[];
}

export interface PlaytimeStats {
  totalSeconds: number;
  weeks: PlaytimeWeek[];
  games: { game: GameRef; seconds: number; sessions: number; lastPlayedAt: string | null; recentSeconds: number }[];
}

export interface YearReview {
  year: number;
  totalSeconds: number;
  sessions: number;
  gamesPlayed: number;
  newGames: number;
  months: number[];
  topGames: { game: GameRef; seconds: number; sessions: number }[];
  longestSession: { game: GameRef; seconds: number; date: string } | null;
  mostActiveDay: { date: string; seconds: number } | null;
  achievementsUnlocked: number;
  reviewsWritten: number;
  friendsAdded: number;
  screenshotsShared: number;
  /** Anteil an der gesamten Spielzeit aller Nutzer (Perzentil, 0–100) */
  percentile: number | null;
}

export interface TopLists {
  period: 'week' | 'month' | 'year' | 'all';
  mostPlayed: { game: GameRef; seconds: number; players: number }[];
  mostOwned: { game: GameRef; owners: number }[];
  topRated: { game: GameRef; percent: number; total: number }[];
  mostAchievements: { user: UserPublic; unlocked: number }[];
  topLevels: { user: UserPublic; level: number; xp: number }[];
}

/** Antwort auf den Spielstart (Desktop-Client): SDK-Token, Kindersicherung, Erkennungsregeln, Cloud-Stand */
export interface PlayStartResponse {
  gameToken: GameTokenResponse;
  parental: ParentalStatus;
  detection: { apiName: string; detection: AchievementDetection }[];
  savePaths: SavePathConfig[];
  cloud: { enabled: boolean; latestVersion: number | null; latestHash: string | null };
  workshopPath: string | null;
}
