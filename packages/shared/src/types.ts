// Gemeinsame API-Typen für Server, Web-Frontend und Desktop-Client.

export type Role = 'ADMIN' | 'UPLOADER' | 'USER';
export type Platform = 'WINDOWS' | 'LINUX' | 'MACOS';
export type BuildKind = 'ZIP' | 'SEVEN_ZIP' | 'FOLDER' | 'INSTALLER';
export type BuildStatus = 'DRAFT' | 'READY';
export type LinuxRunner = 'NONE' | 'PROTON' | 'WINE';
export type GameVisibility = 'PUBLIC' | 'UNLISTED' | 'RESTRICTED' | 'HIDDEN';
export type MediaKind = 'COVER' | 'HEADER' | 'BACKGROUND' | 'SCREENSHOT' | 'ARTWORK';
export type RegistrationMode = 'open' | 'invite' | 'closed';
export type SessionKind = 'WEB' | 'DEVICE';
export type UploadStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type BackupStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';
export type DiscoveryAction = 'SKIPPED' | 'WISHLISTED' | 'ADDED';
export type MetadataProvider = 'igdb' | 'rawg';

export const PLATFORMS: Platform[] = ['WINDOWS', 'LINUX', 'MACOS'];
export const BUILD_KINDS: BuildKind[] = ['ZIP', 'SEVEN_ZIP', 'FOLDER', 'INSTALLER'];
export const ROLES: Role[] = ['ADMIN', 'UPLOADER', 'USER'];
export const VISIBILITIES: GameVisibility[] = ['PUBLIC', 'UNLISTED', 'RESTRICTED', 'HIDDEN'];

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserPublic {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: Role;
  bio: string | null;
  createdAt: string;
}

export interface CurrentUser extends UserPublic {
  email: string;
  locale: string;
  totpEnabled: boolean;
  hasPassword: boolean;
  oidcLinked: boolean;
}

export interface AuthSuccess {
  user: CurrentUser;
  /** Nur bei Web-Login: CSRF-Token, das bei schreibenden Requests als Header X-CSRF-Token gesendet wird. */
  csrfToken?: string;
  /** Nur bei Device-Login: Bearer-Token für den Desktop-Client. */
  token?: string;
  sessionId: string;
}

export interface MfaRequired {
  mfaRequired: true;
  challengeToken: string;
}

export type LoginResponse = AuthSuccess | MfaRequired;

export interface MeResponse {
  user: CurrentUser | null;
  csrfToken: string | null;
}

export interface SessionInfo {
  id: string;
  kind: SessionKind;
  name: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
}

export interface PublicSettings {
  siteName: string;
  siteDescription: string;
  registrationMode: RegistrationMode;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  storePublic: boolean;
  oidcEnabled: boolean;
  oidcName: string;
  smtpEnabled: boolean;
  metadataProviders: { igdb: boolean; rawg: boolean };
  version: string;
}

export interface BackupSchedule {
  enabled: boolean;
  intervalHours: number;
  includeFiles: boolean;
  keep: number;
}

export interface AdminSettings {
  siteName: string;
  siteDescription: string;
  registrationMode: RegistrationMode;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  storePublic: boolean;
  maxUploadFileBytes: number;
  defaultUploadQuotaBytes: number;
  maxConcurrentUploadsPerUser: number;
  downloadRateLimitKbps: number;
  uploadChunkBytes: number;
  backupSchedule: BackupSchedule;
}

export interface GenreDto {
  id: string;
  slug: string;
  name: string;
}

export type TagDto = GenreDto;

export interface MediaDto {
  id: string;
  kind: MediaKind;
  url: string;
  mimeType: string;
  sortOrder: number;
}

export interface GameSummary {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  coverUrl: string | null;
  headerUrl: string | null;
  developer: string | null;
  releaseDate: string | null;
  genres: GenreDto[];
  tags: TagDto[];
  platforms: Platform[];
  visibility: GameVisibility;
  featured: boolean;
}

export interface RequirementsBlock {
  minimum?: string;
  recommended?: string;
}

export type SystemRequirements = Partial<Record<'windows' | 'linux' | 'macos', RequirementsBlock>>;

export interface BuildDto {
  id: string;
  versionId: string;
  platform: Platform;
  kind: BuildKind;
  status: BuildStatus;
  executable: string;
  launchArgs: string;
  workingDir: string;
  installerArgs: string;
  linuxRunner: LinuxRunner;
  installSize: number;
  totalSize: number;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface VersionDto {
  id: string;
  gameId: string;
  version: string;
  changelog: string;
  published: boolean;
  createdAt: string;
  publishedAt: string | null;
  builds: BuildDto[];
}

export interface AnnouncementDto {
  id: string;
  title: string;
  body: string;
  published: boolean;
  pinned: boolean;
  gameId: string | null;
  gameTitle: string | null;
  author: UserPublic | null;
  createdAt: string;
  updatedAt: string;
}

export interface GameDetail extends GameSummary {
  description: string;
  publisher: string | null;
  website: string | null;
  trailerUrls: string[];
  systemRequirements: SystemRequirements;
  backgroundUrl: string | null;
  media: MediaDto[];
  versions: VersionDto[];
  latestVersion: VersionDto | null;
  libraryCount: number;
  downloadCount: number;
  inLibrary: boolean;
  inWishlist: boolean;
  favorite: boolean;
  playtimeSeconds: number;
  canEdit: boolean;
  announcements: AnnouncementDto[];
  createdAt: string;
  updatedAt: string;
}

/** Vollständige Spieldaten für die Verwaltung (Admin/Uploader). */
export interface ManagedGame extends GameDetail {
  igdbId: string | null;
  rawgId: string | null;
  maintainers: UserPublic[];
  accessUsers: UserPublic[];
  storageBytes: number;
}

export interface BuildFileDto {
  id: string;
  path: string;
  size: number;
  sha256: string;
  downloadUrl: string;
}

export interface BuildManifest {
  game: { id: string; slug: string; title: string };
  version: { id: string; version: string; changelog: string; publishedAt: string | null };
  build: BuildDto;
  files: BuildFileDto[];
}

export interface UploadDto {
  id: string;
  buildId: string;
  path: string;
  size: number;
  offset: number;
  status: UploadStatus;
  sha256: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryEntryDto {
  game: GameSummary;
  favorite: boolean;
  hidden: boolean;
  playtimeSeconds: number;
  lastPlayedAt: string | null;
  addedAt: string;
  collectionIds: string[];
}

export interface CollectionDto {
  id: string;
  name: string;
  gameIds: string[];
  createdAt: string;
}

export interface StoreHome {
  featured: GameSummary[];
  recommended: GameSummary[];
  newReleases: GameSummary[];
  popular: GameSummary[];
  announcements: AnnouncementDto[];
}

export type StoreSort = 'relevance' | 'title' | 'release' | 'newest' | 'popular';

export interface StoreSearchQuery {
  q?: string;
  genres?: string[];
  tags?: string[];
  platforms?: Platform[];
  sort?: StoreSort;
  page?: number;
  pageSize?: number;
}

export interface StoreFacets {
  genres: (GenreDto & { count: number })[];
  tags: (TagDto & { count: number })[];
}

export interface InviteDto {
  id: string;
  code: string;
  url: string;
  role: Role;
  maxUses: number;
  uses: number;
  note: string | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
  createdBy: UserPublic | null;
}

export interface AdminUserDto extends UserPublic {
  email: string;
  disabled: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  uploadQuotaBytes: number | null;
  usedUploadBytes: number;
  libraryCount: number;
}

export interface StorageOverview {
  disk: { total: number; free: number; used: number };
  builds: number;
  media: number;
  avatars: number;
  pendingUploads: number;
  backups: number;
  games: { id: string; slug: string; title: string; bytes: number; versions: number }[];
}

export interface AuditLogDto {
  id: string;
  action: string;
  target: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
  user: UserPublic | null;
}

export interface ServerLogLine {
  time: string;
  level: string;
  msg: string;
  data?: Record<string, unknown>;
}

export interface BackupDto {
  id: string;
  filename: string;
  size: number;
  includesFiles: boolean;
  status: BackupStatus;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface MetadataSearchResult {
  provider: MetadataProvider;
  externalId: string;
  title: string;
  releaseDate: string | null;
  coverUrl: string | null;
}

export type MetadataField =
  | 'title'
  | 'description'
  | 'releaseDate'
  | 'developer'
  | 'publisher'
  | 'genres'
  | 'tags'
  | 'cover'
  | 'screenshots'
  | 'trailers'
  | 'systemRequirements'
  | 'website';

export const METADATA_FIELDS: MetadataField[] = [
  'title',
  'description',
  'releaseDate',
  'developer',
  'publisher',
  'genres',
  'tags',
  'cover',
  'screenshots',
  'trailers',
  'systemRequirements',
  'website',
];

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

export type WsEvent =
  | { type: 'hello'; data: { userId: string | null; serverTime: string } }
  | { type: 'maintenance'; data: { enabled: boolean; message: string } }
  | { type: 'upload.completed'; data: UploadDto }
  | { type: 'upload.failed'; data: UploadDto }
  | { type: 'backup.updated'; data: BackupDto }
  | { type: 'announcement.created'; data: AnnouncementDto }
  | { type: 'library.updated'; data: { gameId: string } }
  | { type: 'session.revoked'; data: { sessionId: string } }
  | { type: 'pong'; data: { time: string } };

// ---- Phase 2: Desktop-Client ----

export type ClientFileFormat = 'MSI' | 'NSIS' | 'APPIMAGE' | 'DEB' | 'RPM' | 'DMG' | 'APP_TARBALL';

export interface ClientReleaseFileDto {
  id: string;
  platform: Platform;
  arch: string;
  format: ClientFileFormat;
  filename: string;
  size: number;
  sha256: string;
  hasSignature: boolean;
  downloadUrl: string;
}

export interface ClientReleaseDto {
  id: string;
  version: string;
  notes: string;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  files: ClientReleaseFileDto[];
}
