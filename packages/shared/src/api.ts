import type {
  AdminSettings,
  AdminUserDto,
  AnnouncementDto,
  ApiErrorBody,
  AuditLogDto,
  BackupDto,
  BuildDto,
  BuildFileDto,
  BuildManifest,
  ClientReleaseDto,
  CollectionDto,
  CurrentUser,
  DiscoveryAction,
  GameDetail,
  GameSummary,
  InviteDto,
  LibraryEntryDto,
  LoginResponse,
  AuthSuccess,
  ManagedGame,
  MediaDto,
  MediaKind,
  MeResponse,
  MetadataField,
  MetadataProvider,
  MetadataSearchResult,
  Paginated,
  Platform,
  PublicSettings,
  Role,
  ServerLogLine,
  SessionInfo,
  StorageOverview,
  ServerUpdateStatus,
  StoreFacets,
  StoreHome,
  StoreSearchQuery,
  TotpSetup,
  UploadDto,
  UserPublic,
  VersionDto,
  WsClientMessage,
  WsEvent,
} from './types.js';
import type {
  ActivityDto,
  ChatConfig,
  CommunityItemDto,
  CommunityItemType,
  ConversationDto,
  ForumPostDto,
  ForumTopicDto,
  FriendsOverview,
  GifResult,
  GroupAnnouncementDto,
  GroupDetail,
  GroupEventDto,
  GroupJoinPolicy,
  GroupMemberDto,
  GroupRole,
  GroupSummary,
  GroupVisibility,
  MessageDto,
  NotificationDto,
  NotificationPrefs,
  ProfileDto,
  ProfileSettings,
  ProfileVisibility,
  ReviewDto,
  ReviewSummary,
  RsvpStatus,
  ShowcaseConfig,
  UserSearchResult,
} from './social.js';
import type {
  AchievementDetection,
  AchievementUnlockResult,
  ActivationCodeDto,
  AdminAchievementDto,
  CardItemDto,
  CloudSaveDto,
  CloudSaveFile,
  CloudSaveOverview,
  CloudSaveStatus,
  FamilyDto,
  FamilyInviteDto,
  FamilyLibraryEntry,
  FamilyRole,
  GameAchievements,
  GameBadgeDto,
  GameNoteDto,
  GameRef,
  GiftDto,
  InventoryDto,
  MarketListingDto,
  ParentalSettings,
  ParentalStatus,
  PlayStartResponse,
  PlaytimeStats,
  ProfileLevel,
  RemoteDeviceDto,
  TopLists,
  TradeOfferDto,
  TradingCardDto,
  WorkshopCommentDto,
  WorkshopItemDto,
  WorkshopKind,
  WorkshopSubscriptionDto,
  WorkshopVersionDto,
  YearReview,
} from './steam.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ApiClientOptions {
  /** Basis-URL des Servers, z. B. "https://games.example.com". Leer = gleiche Origin (Web). */
  baseUrl?: string;
  /** Device-Token (Desktop-Client). Ohne Token wird Cookie-Auth + CSRF verwendet. */
  token?: string | null;
  fetch?: typeof fetch;
  onUnauthorized?: () => void;
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

interface RequestOptions {
  body?: unknown;
  query?: Query;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) params.set(k, v.join(','));
    } else params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export type AdminUserUpdate = Partial<{
  role: Role;
  disabled: boolean;
  uploadQuotaBytes: number | null;
  resetTotp: boolean;
  password: string;
  email: string;
  displayName: string | null;
}>;

export type GameInput = Partial<{
  title: string;
  slug: string;
  shortDescription: string;
  description: string;
  developer: string | null;
  publisher: string | null;
  releaseDate: string | null;
  website: string | null;
  trailerUrls: string[];
  systemRequirements: GameDetail['systemRequirements'];
  visibility: GameSummary['visibility'];
  featured: boolean;
  genres: string[];
  tags: string[];
  ageRating: number;
  savePaths: import('./steam.js').SavePathConfig[];
  workshopPath: string | null;
}>;

export type BuildInput = Partial<{
  platform: Platform;
  kind: BuildDto['kind'];
  executable: string;
  launchArgs: string;
  workingDir: string;
  installerArgs: string;
  linuxRunner: BuildDto['linuxRunner'];
  installSize: number;
  status: BuildDto['status'];
}>;

export interface ManagedGameListItem extends GameSummary {
  versionCount: number;
  libraryCount: number;
  downloadCount: number;
  updatedAt: string;
}

export interface AdminOverview {
  users: number;
  games: number;
  publicGames: number;
  readyBuilds: number;
  activeUploads: number;
  libraryEntries: number;
  downloads30d: number;
  activeSessions: number;
  onlineConnections: number;
  disk: { total: number; free: number; used: number };
  version: string;
}

export interface AdminUploadDto {
  id: string;
  path: string;
  size: number;
  offset: number;
  updatedAt: string;
  user: UserPublic;
  game: { id: string; title: string };
  version: string;
  platform: Platform;
}

export interface AchievementInput {
  apiName?: string;
  name?: string;
  description?: string;
  hidden?: boolean;
  progressMax?: number | null;
  detection?: AchievementDetection | null;
}

export interface GroupInput {
  name?: string;
  summary?: string;
  description?: string;
  joinPolicy?: GroupJoinPolicy;
  visibility?: GroupVisibility;
}

export interface GroupEventInput {
  title: string;
  description?: string;
  startsAt: string;
  endsAt?: string | null;
  gameId?: string | null;
}

/** Typisierter Client für die REST-API. */
export class ApiClient {
  baseUrl: string;
  token: string | null;
  csrfToken: string | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly onUnauthorized?: () => void;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? '').replace(/\/+$/, '');
    this.token = opts.token ?? null;
    this.fetchImpl = opts.fetch ?? ((...args) => globalThis.fetch(...args));
    this.onUnauthorized = opts.onUnauthorized;
  }

  /** Absolute URL für relative API-Pfade (z. B. Bilder) – wichtig für den Desktop-Client. */
  url(path: string | null | undefined): string {
    if (!path) return '';
    if (/^https?:\/\//.test(path)) return path;
    return `${this.baseUrl}${path}`;
  }

  authHeaders(method = 'GET'): Record<string, string> {
    if (this.token) return { Authorization: `Bearer ${this.token}` };
    if (method !== 'GET' && method !== 'HEAD') {
      const csrf = this.csrfToken ?? readCookie('gs_csrf');
      if (csrf) return { 'X-CSRF-Token': csrf };
    }
    return {};
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { ...this.authHeaders(method), ...opts.headers };
    let body: BodyInit | undefined;
    if (opts.body instanceof FormData || opts.body instanceof Blob) {
      body = opts.body;
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const res = await this.fetchImpl(`${this.baseUrl}/api${path}${buildQuery(opts.query)}`, {
      method,
      headers,
      body,
      signal: opts.signal,
      // Cookies nur same-origin (Browser ohne baseUrl). Desktop-Client spricht eine eigene Server-Adresse an
      // (cross-origin) und nutzt immer das Device-Token – dort würde 'include' ohne Allow-Credentials an CORS scheitern.
      credentials: this.baseUrl || this.token ? 'omit' : 'include',
    });
    if (!res.ok) {
      let err: ApiErrorBody = { error: 'http_error', message: res.statusText };
      try {
        err = (await res.json()) as ApiErrorBody;
      } catch {
        // kein JSON
      }
      if (res.status === 401) this.onUnauthorized?.();
      throw new ApiError(res.status, err.error, err.message, err.details);
    }
    if (res.status === 204) return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('application/json') ? await res.json() : await res.text()) as T;
  }

  get<T>(path: string, query?: Query, signal?: AbortSignal) {
    return this.request<T>('GET', path, { query, signal });
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, { body: body ?? {} });
  }
  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, { body: body ?? {} });
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, { body: body ?? {} });
  }
  del<T>(path: string) {
    return this.request<T>('DELETE', path);
  }

  // ---- System ----
  publicSettings = () => this.get<PublicSettings>('/settings/public');
  health = () => this.get<{ status: string; version: string }>('/health');

  // ---- Auth ----
  auth = {
    me: async () => {
      const r = await this.get<MeResponse>('/auth/me');
      this.csrfToken = r.csrfToken;
      return r;
    },
    login: async (login: string, password: string, device?: { name: string }) => {
      const r = await this.post<LoginResponse>('/auth/login', { login, password, device });
      if ('csrfToken' in r && r.csrfToken) this.csrfToken = r.csrfToken;
      return r;
    },
    login2fa: async (challengeToken: string, code: string) => {
      const r = await this.post<AuthSuccess>('/auth/login/2fa', { challengeToken, code });
      if (r.csrfToken) this.csrfToken = r.csrfToken;
      return r;
    },
    register: async (data: { username: string; email: string; password: string; inviteCode?: string; locale?: string }) => {
      const r = await this.post<AuthSuccess>('/auth/register', data);
      if (r.csrfToken) this.csrfToken = r.csrfToken;
      return r;
    },
    logout: async () => {
      await this.post('/auth/logout');
      this.csrfToken = null;
    },
    forgotPassword: (email: string) => this.post<{ ok: true }>('/auth/password/forgot', { email }),
    resetPassword: (token: string, password: string) => this.post<{ ok: true }>('/auth/password/reset', { token, password }),
    checkInvite: (code: string) => this.get<{ valid: boolean; role: Role | null }>(`/auth/invite/${encodeURIComponent(code)}`),
    oidcStartUrl: (redirect = '/') => `${this.baseUrl}/api/auth/oidc/start${buildQuery({ redirect })}`,
  };

  // ---- Eigenes Konto ----
  me = {
    update: (data: Partial<{ displayName: string | null; bio: string | null; locale: string; email: string; currentPassword: string }>) =>
      this.patch<CurrentUser>('/me', data),
    uploadAvatar: (file: Blob) => {
      const fd = new FormData();
      fd.append('file', file);
      return this.request<CurrentUser>('POST', '/me/avatar', { body: fd });
    },
    deleteAvatar: () => this.del<CurrentUser>('/me/avatar'),
    changePassword: (currentPassword: string | undefined, newPassword: string) =>
      this.post<{ ok: true }>('/me/password', { currentPassword, newPassword }),
    sessions: () => this.get<SessionInfo[]>('/me/sessions'),
    revokeSession: (id: string) => this.del<{ ok: true }>(`/me/sessions/${id}`),
    revokeOtherSessions: () => this.del<{ revoked: number }>('/me/sessions'),
    createDeviceToken: (name: string) => this.post<{ token: string; sessionId: string }>('/me/devices', { name }),
    totpSetup: () => this.post<TotpSetup>('/me/2fa/setup'),
    totpEnable: (code: string) => this.post<{ recoveryCodes: string[] }>('/me/2fa/enable', { code }),
    totpDisable: (code: string, password?: string) => this.post<{ ok: true }>('/me/2fa/disable', { code, password }),
    recoveryCodes: (code: string) => this.post<{ recoveryCodes: string[] }>('/me/2fa/recovery-codes', { code }),
    uploadQuota: () => this.get<{ quota: number; used: number }>('/me/upload-quota'),
  };

  users = {
    byName: (username: string) =>
      this.get<UserPublic & { libraryCount: number; playtimeSeconds: number }>(`/users/by-name/${encodeURIComponent(username)}`),
  };

  // ---- Store ----
  store = {
    home: () => this.get<StoreHome>('/store/home'),
    search: (q: StoreSearchQuery, signal?: AbortSignal) => this.get<Paginated<GameSummary>>('/store/search', q as Query, signal),
    facets: () => this.get<StoreFacets>('/store/facets'),
    recommendations: (limit = 12) => this.get<GameSummary[]>('/store/recommendations', { limit }),
    discovery: (size = 12) => this.get<GameSummary[]>('/store/discovery', { size }),
    discoveryAction: (gameId: string, action: DiscoveryAction) => this.post<{ ok: true }>(`/store/discovery/${gameId}`, { action }),
    resetDiscovery: () => this.del<{ ok: true }>('/store/discovery'),
    game: (idOrSlug: string) => this.get<GameDetail>(`/store/games/${encodeURIComponent(idOrSlug)}`),
    similar: (idOrSlug: string) => this.get<GameSummary[]>(`/store/games/${encodeURIComponent(idOrSlug)}/similar`),
    announcements: (page = 1, pageSize = 10) => this.get<Paginated<AnnouncementDto>>('/store/announcements', { page, pageSize }),
  };

  // ---- Bibliothek ----
  library = {
    list: (q: { sort?: 'title' | 'lastPlayed' | 'playtime' | 'added'; collection?: string; favorites?: boolean; hidden?: boolean; q?: string } = {}) =>
      this.get<LibraryEntryDto[]>('/library', q as Query),
    add: (gameId: string) => this.put<{ ok: true }>(`/library/${gameId}`),
    remove: (gameId: string) => this.del<{ ok: true }>(`/library/${gameId}`),
    update: (gameId: string, data: { favorite?: boolean; hidden?: boolean }) => this.patch<{ ok: true }>(`/library/${gameId}`, data),
    reportPlaytime: (gameId: string, seconds: number, startedAt?: string) =>
      this.post<{ playtimeSeconds: number }>(`/library/${gameId}/playtime`, { seconds, startedAt }),
    wishlist: () => this.get<(GameSummary & { addedAt: string })[]>('/library/wishlist'),
    addToWishlist: (gameId: string) => this.put<{ ok: true }>(`/library/wishlist/${gameId}`),
    removeFromWishlist: (gameId: string) => this.del<{ ok: true }>(`/library/wishlist/${gameId}`),
    collections: () => this.get<CollectionDto[]>('/library/collections'),
    createCollection: (name: string) => this.post<CollectionDto>('/library/collections', { name }),
    renameCollection: (id: string, name: string) => this.patch<CollectionDto>(`/library/collections/${id}`, { name }),
    deleteCollection: (id: string) => this.del<{ ok: true }>(`/library/collections/${id}`),
    addToCollection: (id: string, gameId: string) => this.put<CollectionDto>(`/library/collections/${id}/games/${gameId}`),
    removeFromCollection: (id: string, gameId: string) => this.del<CollectionDto>(`/library/collections/${id}/games/${gameId}`),
  };

  // ---- Downloads ----
  builds = {
    manifest: (buildId: string) => this.get<BuildManifest>(`/builds/${buildId}/manifest`),
    downloadUrl: (buildId: string) => `${this.baseUrl}/api/builds/${buildId}/download`,
  };

  // ---- Verwaltung (Admin/Uploader) ----
  manage = {
    games: (q?: string) => this.get<ManagedGameListItem[]>('/manage/games', { q }),
    createGame: (data: GameInput & { title: string }) => this.post<ManagedGame>('/manage/games', data),
    game: (id: string) => this.get<ManagedGame>(`/manage/games/${id}`),
    updateGame: (id: string, data: GameInput) => this.patch<ManagedGame>(`/manage/games/${id}`, data),
    deleteGame: (id: string) => this.del<{ ok: true }>(`/manage/games/${id}`),
    addMaintainer: (id: string, username: string) => this.post<ManagedGame>(`/manage/games/${id}/maintainers`, { username }),
    removeMaintainer: (id: string, userId: string) => this.del<ManagedGame>(`/manage/games/${id}/maintainers/${userId}`),
    grantAccess: (id: string, username: string) => this.post<ManagedGame>(`/manage/games/${id}/access`, { username }),
    revokeAccess: (id: string, userId: string) => this.del<ManagedGame>(`/manage/games/${id}/access/${userId}`),
    uploadMedia: (id: string, kind: MediaKind, file: Blob) => {
      const fd = new FormData();
      fd.append('file', file);
      return this.request<MediaDto>('POST', `/manage/games/${id}/media`, { body: fd, query: { kind } });
    },
    deleteMedia: (id: string, mediaId: string) => this.del<{ ok: true }>(`/manage/games/${id}/media/${mediaId}`),
    orderMedia: (id: string, ids: string[]) => this.put<{ ok: true }>(`/manage/games/${id}/media/order`, { ids }),
    metadataSearch: (provider: MetadataProvider, q: string) => this.get<MetadataSearchResult[]>('/manage/metadata/search', { provider, q }),
    metadataImport: (id: string, provider: MetadataProvider, externalId: string, fields: MetadataField[]) =>
      this.post<ManagedGame>(`/manage/games/${id}/metadata/import`, { provider, externalId, fields }),
    createVersion: (gameId: string, version: string, changelog?: string) =>
      this.post<VersionDto>(`/manage/games/${gameId}/versions`, { version, changelog }),
    updateVersion: (versionId: string, data: { version?: string; changelog?: string; published?: boolean }) =>
      this.patch<VersionDto>(`/manage/versions/${versionId}`, data),
    deleteVersion: (versionId: string) => this.del<{ ok: true }>(`/manage/versions/${versionId}`),
    createBuild: (versionId: string, data: BuildInput & { platform: Platform; kind: BuildDto['kind'] }) =>
      this.post<BuildDto>(`/manage/versions/${versionId}/builds`, data),
    updateBuild: (buildId: string, data: BuildInput) => this.patch<BuildDto>(`/manage/builds/${buildId}`, data),
    deleteBuild: (buildId: string) => this.del<{ ok: true }>(`/manage/builds/${buildId}`),
    buildFiles: (buildId: string) => this.get<BuildFileDto[]>(`/manage/builds/${buildId}/files`),
    deleteBuildFile: (buildId: string, fileId: string) => this.del<{ ok: true }>(`/manage/builds/${buildId}/files/${fileId}`),
  };

  // ---- Uploads ----
  uploads = {
    create: (data: { buildId: string; path: string; size: number; sha256?: string }) =>
      this.post<UploadDto & { chunkSize: number }>('/uploads', data),
    get: (id: string) => this.get<UploadDto>(`/uploads/${id}`),
    list: () => this.get<UploadDto[]>('/uploads'),
    cancel: (id: string) => this.del<{ ok: true }>(`/uploads/${id}`),
  };

  // ---- Administration ----
  admin = {
    overview: () => this.get<AdminOverview>('/admin/overview'),
    users: (q: { q?: string; role?: Role; page?: number; pageSize?: number } = {}) => this.get<Paginated<AdminUserDto>>('/admin/users', q as Query),
    createUser: (data: { username: string; email: string; password: string; role: Role }) => this.post<AdminUserDto>('/admin/users', data),
    updateUser: (id: string, data: AdminUserUpdate) => this.patch<AdminUserDto>(`/admin/users/${id}`, data),
    deleteUser: (id: string) => this.del<{ ok: true }>(`/admin/users/${id}`),
    userSessions: (id: string) => this.get<SessionInfo[]>(`/admin/users/${id}/sessions`),
    revokeUserSession: (id: string, sessionId: string) => this.del<{ ok: true }>(`/admin/users/${id}/sessions/${sessionId}`),
    invites: () => this.get<InviteDto[]>('/admin/invites'),
    createInvite: (data: { role: Role; maxUses: number; expiresInDays: number | null; note?: string }) => this.post<InviteDto>('/admin/invites', data),
    revokeInvite: (id: string) => this.del<{ ok: true }>(`/admin/invites/${id}`),
    settings: () => this.get<AdminSettings>('/admin/settings'),
    updateSettings: (data: Partial<AdminSettings>) => this.patch<AdminSettings>('/admin/settings', data),
    testMail: () => this.post<{ ok: true }>('/admin/settings/test-mail'),
    uploadLogo: (kind: 'logo' | 'client-logo', file: Blob) => {
      const fd = new FormData();
      fd.append('file', file);
      return this.request<AdminSettings>('POST', `/admin/branding/${kind}`, { body: fd });
    },
    removeLogo: (kind: 'logo' | 'client-logo') => this.del<AdminSettings>(`/admin/branding/${kind}`),
    checkUpdate: () => this.get<ServerUpdateStatus>('/admin/update/check'),
    applyUpdate: () => this.post<{ started: boolean }>('/admin/update/apply'),
    announcements: () => this.get<AnnouncementDto[]>('/admin/announcements'),
    createAnnouncement: (data: { title: string; body: string; published?: boolean; pinned?: boolean; gameId?: string | null }) =>
      this.post<AnnouncementDto>('/admin/announcements', data),
    updateAnnouncement: (id: string, data: Partial<{ title: string; body: string; published: boolean; pinned: boolean; gameId: string | null }>) =>
      this.patch<AnnouncementDto>(`/admin/announcements/${id}`, data),
    deleteAnnouncement: (id: string) => this.del<{ ok: true }>(`/admin/announcements/${id}`),
    storage: () => this.get<StorageOverview>('/admin/storage'),
    uploads: () => this.get<AdminUploadDto[]>('/admin/uploads'),
    cancelUpload: (id: string) => this.del<{ ok: true }>(`/admin/uploads/${id}`),
    auditLogs: (q: { action?: string; userId?: string; page?: number; pageSize?: number } = {}) =>
      this.get<Paginated<AuditLogDto>>('/admin/logs/audit', q as Query),
    serverLogs: (q: { level?: string; q?: string; limit?: number } = {}) => this.get<ServerLogLine[]>('/admin/logs/server', q as Query),
    backups: () => this.get<BackupDto[]>('/admin/backups'),
    startBackup: (includeFiles: boolean) => this.post<BackupDto>('/admin/backups', { includeFiles }),
    deleteBackup: (id: string) => this.del<{ ok: true }>(`/admin/backups/${id}`),
    backupDownloadUrl: (id: string) => `${this.baseUrl}/api/admin/backups/${id}/download`,
  };

  // ---- Desktop-Client-Releases ----
  client = {
    latest: () => this.get<ClientReleaseDto | null>('/client/releases/latest'),
    releases: () => this.get<ClientReleaseDto[]>('/admin/client-releases'),
    createRelease: (version: string, notes: string) => this.post<ClientReleaseDto>('/admin/client-releases', { version, notes }),
    updateRelease: (id: string, data: { notes?: string; published?: boolean }) => this.patch<ClientReleaseDto>(`/admin/client-releases/${id}`, data),
    deleteRelease: (id: string) => this.del<{ ok: true }>(`/admin/client-releases/${id}`),
    uploadFile: (id: string, file: Blob, filename: string) => {
      const fd = new FormData();
      fd.append('file', file, filename);
      return this.request<ClientReleaseDto>('POST', `/admin/client-releases/${id}/files`, { body: fd });
    },
    setSignature: (fileId: string, signature: string | null) => this.patch<ClientReleaseDto>(`/admin/client-files/${fileId}`, { signature }),
    deleteFile: (fileId: string) => this.del<{ ok: true }>(`/admin/client-files/${fileId}`),
  };

  // ---- Phase 3: Soziales ----
  friends = {
    overview: () => this.get<FriendsOverview>('/friends'),
    search: (q: string) => this.get<UserSearchResult[]>('/users/search', { q }),
    request: (username: string) => this.post<{ status: 'outgoing' | 'friends' }>('/friends/requests', { username }),
    accept: (requestId: string) => this.post<{ ok: true }>(`/friends/requests/${requestId}/accept`),
    decline: (requestId: string) => this.del<{ ok: true }>(`/friends/requests/${requestId}`),
    remove: (userId: string) => this.del<{ ok: true }>(`/friends/${userId}`),
    block: (userId: string) => this.post<{ ok: true }>(`/blocks/${userId}`),
    unblock: (userId: string) => this.del<{ ok: true }>(`/blocks/${userId}`),
    invite: (userId: string, gameId: string) => this.post<{ ok: true }>(`/friends/${userId}/invite`, { gameId }),
    setPresence: (gameId: string | null) => this.put<{ ok: true }>('/presence', { gameId }),
  };

  profiles = {
    get: (username: string) => this.get<ProfileDto>(`/profiles/${encodeURIComponent(username)}`),
    settings: () => this.get<ProfileSettings>('/me/profile'),
    updateSettings: (data: {
      accent?: string | null;
      visibility?: ProfileVisibility;
      allowFriendRequests?: boolean;
      showcases?: ShowcaseConfig[];
      notificationPrefs?: { email: Partial<NotificationPrefs['email']> };
    }) => this.patch<ProfileSettings>('/me/profile', data),
    uploadBackground: (file: Blob) => {
      const fd = new FormData();
      fd.append('file', file);
      return this.request<ProfileSettings>('POST', '/me/profile/background', { body: fd });
    },
    deleteBackground: () => this.del<ProfileSettings>('/me/profile/background'),
  };

  notifications = {
    list: (before?: string) => this.get<{ items: NotificationDto[]; unread: number }>('/notifications', { before }),
    markRead: (ids?: string[]) => this.post<{ ok: true }>('/notifications/read', { ids }),
    remove: (id: string) => this.del<{ ok: true }>(`/notifications/${id}`),
    clearRead: () => this.del<{ ok: true }>('/notifications'),
    feed: (before?: string) => this.get<ActivityDto[]>('/feed', { before }),
  };

  chat = {
    config: () => this.get<ChatConfig>('/chat/config'),
    conversations: () => this.get<ConversationDto[]>('/chat/conversations'),
    conversation: (id: string) => this.get<ConversationDto>(`/chat/conversations/${id}`),
    unread: () => this.get<{ count: number }>('/chat/unread'),
    direct: (userId: string) => this.post<ConversationDto>('/chat/direct', { userId }),
    createGroup: (userIds: string[], title?: string) => this.post<ConversationDto>('/chat/conversations', { userIds, title }),
    update: (id: string, data: { title?: string | null; muted?: boolean }) => this.patch<ConversationDto>(`/chat/conversations/${id}`, data),
    addMembers: (id: string, userIds: string[]) => this.post<ConversationDto>(`/chat/conversations/${id}/members`, { userIds }),
    removeMember: (id: string, userId: string) => this.del<{ ok: true }>(`/chat/conversations/${id}/members/${userId}`),
    messages: (id: string, before?: string) => this.get<MessageDto[]>(`/chat/conversations/${id}/messages`, { before }),
    send: (id: string, body: string, gifUrl?: string) => this.post<MessageDto>(`/chat/conversations/${id}/messages`, { body, gifUrl }),
    sendImage: (id: string, file: Blob, caption?: string) => {
      const fd = new FormData();
      fd.append('file', file);
      return this.request<MessageDto>('POST', `/chat/conversations/${id}/attachments`, { body: fd, query: { caption } });
    },
    edit: (messageId: string, body: string) => this.patch<MessageDto>(`/chat/messages/${messageId}`, { body }),
    remove: (messageId: string) => this.del<{ ok: true }>(`/chat/messages/${messageId}`),
    read: (id: string) => this.post<{ ok: true }>(`/chat/conversations/${id}/read`),
    gifs: (q: string) => this.get<GifResult[]>('/chat/gifs', { q }),
  };

  groups = {
    list: (q: { q?: string; mine?: boolean } = {}) => this.get<GroupSummary[]>('/groups', q as Query),
    create: (data: GroupInput & { name: string }) => this.post<GroupDetail>('/groups', data),
    get: (idOrSlug: string) => this.get<GroupDetail>(`/groups/${encodeURIComponent(idOrSlug)}`),
    update: (id: string, data: GroupInput) => this.patch<GroupDetail>(`/groups/${id}`, data),
    remove: (id: string) => this.del<{ ok: true }>(`/groups/${id}`),
    uploadImage: (id: string, kind: 'avatar' | 'banner', file: Blob) => {
      const fd = new FormData();
      fd.append('file', file);
      return this.request<GroupDetail>('POST', `/groups/${id}/${kind}`, { body: fd });
    },
    join: (id: string) => this.post<GroupDetail>(`/groups/${id}/join`),
    leave: (id: string) => this.post<{ ok: true }>(`/groups/${id}/leave`),
    members: (id: string) => this.get<GroupMemberDto[]>(`/groups/${id}/members`),
    invite: (id: string, userId: string) => this.post<{ ok: true }>(`/groups/${id}/invites`, { userId }),
    approve: (id: string, userId: string) => this.post<{ ok: true }>(`/groups/${id}/members/${userId}/approve`),
    removeMember: (id: string, userId: string) => this.del<{ ok: true }>(`/groups/${id}/members/${userId}`),
    setRole: (id: string, userId: string, role: GroupRole) => this.patch<{ ok: true }>(`/groups/${id}/members/${userId}`, { role }),
    announcements: (id: string) => this.get<GroupAnnouncementDto[]>(`/groups/${id}/announcements`),
    announce: (id: string, title: string, body: string) => this.post<GroupAnnouncementDto>(`/groups/${id}/announcements`, { title, body }),
    deleteAnnouncement: (id: string, aid: string) => this.del<{ ok: true }>(`/groups/${id}/announcements/${aid}`),
    events: (id: string, past = false) => this.get<GroupEventDto[]>(`/groups/${id}/events`, { past: past || undefined }),
    createEvent: (id: string, data: GroupEventInput) => this.post<GroupEventDto>(`/groups/${id}/events`, data),
    updateEvent: (id: string, eventId: string, data: Partial<GroupEventInput>) => this.patch<GroupEventDto>(`/groups/${id}/events/${eventId}`, data),
    deleteEvent: (id: string, eventId: string) => this.del<{ ok: true }>(`/groups/${id}/events/${eventId}`),
    rsvp: (eventId: string, status: RsvpStatus | null) => this.put<GroupEventDto>(`/groups/events/${eventId}/rsvp`, { status }),
    createChannel: (id: string, title: string) => this.post<{ id: string; title: string }>(`/groups/${id}/channels`, { title }),
    deleteChannel: (id: string, channelId: string) => this.del<{ ok: true }>(`/groups/${id}/channels/${channelId}`),
  };

  community = {
    reviews: (gameId: string, q: { sort?: 'helpful' | 'recent'; filter?: 'all' | 'positive' | 'negative'; page?: number; pageSize?: number } = {}) =>
      this.get<{ summary: ReviewSummary; items: ReviewDto[]; total: number; mine: ReviewDto | null }>(`/community/games/${gameId}/reviews`, q as Query),
    reviewSummary: (gameId: string) => this.get<ReviewSummary>(`/community/games/${gameId}/reviews/summary`),
    saveReview: (gameId: string, recommended: boolean, body: string) => this.put<ReviewDto>(`/community/games/${gameId}/reviews/mine`, { recommended, body }),
    deleteMyReview: (gameId: string) => this.del<{ ok: true }>(`/community/games/${gameId}/reviews/mine`),
    deleteReview: (id: string) => this.del<{ ok: true }>(`/community/reviews/${id}`),
    vote: (id: string, helpful: boolean | null, funny = false) => this.put<ReviewDto>(`/community/reviews/${id}/vote`, { helpful, funny }),
    topics: (gameId: string, q: { q?: string; page?: number; pageSize?: number } = {}) =>
      this.get<{ items: ForumTopicDto[]; total: number }>(`/community/games/${gameId}/topics`, q as Query),
    createTopic: (gameId: string, title: string, body: string) => this.post<ForumTopicDto>(`/community/games/${gameId}/topics`, { title, body }),
    topic: (id: string, page = 1) =>
      this.get<{ topic: ForumTopicDto; game: { id: string; slug: string; title: string }; posts: ForumPostDto[]; total: number; canModerate: boolean }>(
        `/community/topics/${id}`,
        { page },
      ),
    reply: (topicId: string, body: string) => this.post<ForumPostDto>(`/community/topics/${topicId}/posts`, { body }),
    updateTopic: (id: string, data: { title?: string; pinned?: boolean; locked?: boolean }) => this.patch<ForumTopicDto>(`/community/topics/${id}`, data),
    deleteTopic: (id: string) => this.del<{ ok: true }>(`/community/topics/${id}`),
    editPost: (id: string, body: string) => this.patch<ForumPostDto>(`/community/posts/${id}`, { body }),
    deletePost: (id: string) => this.del<{ ok: true }>(`/community/posts/${id}`),
    items: (gameId: string, q: { type?: CommunityItemType; sort?: 'recent' | 'popular'; page?: number; pageSize?: number } = {}) =>
      this.get<{ items: CommunityItemDto[]; total: number }>(`/community/games/${gameId}/items`, q as Query),
    uploadImage: (gameId: string, file: Blob, data: { type: 'SCREENSHOT' | 'ARTWORK'; title?: string; body?: string }) => {
      const fd = new FormData();
      fd.append('file', file);
      return this.request<CommunityItemDto>('POST', `/community/games/${gameId}/items/image`, { body: fd, query: data });
    },
    createGuide: (gameId: string, title: string, body: string) => this.post<CommunityItemDto>(`/community/games/${gameId}/guides`, { title, body }),
    item: (id: string) => this.get<CommunityItemDto & { canEdit: boolean }>(`/community/items/${id}`),
    updateItem: (id: string, data: { title?: string; body?: string }) => this.patch<CommunityItemDto>(`/community/items/${id}`, data),
    deleteItem: (id: string) => this.del<{ ok: true }>(`/community/items/${id}`),
    like: (id: string) => this.put<{ likes: number; liked: boolean }>(`/community/items/${id}/like`),
    unlike: (id: string) => this.del<{ likes: number; liked: boolean }>(`/community/items/${id}/like`),
    news: (gameId: string) => this.get<AnnouncementDto[]>(`/community/games/${gameId}/news`),
  };

  // ---- Phase 4: Steam-Funktionen ----
  cloud = {
    list: () => this.get<CloudSaveOverview[]>('/cloud'),
    status: (gameId: string) => this.get<CloudSaveStatus>(`/cloud/${gameId}`),
    version: (gameId: string, version: number) => this.get<CloudSaveDto & { manifest: CloudSaveFile[] }>(`/cloud/${gameId}/versions/${version}`),
    downloadUrl: (gameId: string, version: number) => `${this.baseUrl}/api/cloud/${gameId}/versions/${version}/download`,
    restore: (gameId: string, version: number) => this.post<CloudSaveDto>(`/cloud/${gameId}/versions/${version}/restore`),
    remove: (gameId: string) => this.del<{ ok: true; deleted: number }>(`/cloud/${gameId}`),
  };

  achievements = {
    forGame: (gameIdOrSlug: string) => this.get<GameAchievements>(`/achievements/games/${encodeURIComponent(gameIdOrSlug)}`),
    forUser: (username: string) => this.get<(GameAchievements & { lastUnlockedAt: string | null })[]>(`/achievements/users/${encodeURIComponent(username)}`),
    detect: (gameId: string, apiName: string) => this.post<AchievementUnlockResult>('/achievements/detect', { gameId, apiName }),
    manage: (gameId: string) => this.get<AdminAchievementDto[]>(`/achievements/manage/${gameId}`),
    create: (gameId: string, data: AchievementInput & { apiName: string; name: string }) => this.post<AdminAchievementDto[]>(`/achievements/manage/${gameId}`, data),
    update: (gameId: string, id: string, data: AchievementInput) => this.patch<AdminAchievementDto[]>(`/achievements/manage/${gameId}/${id}`, data),
    remove: (gameId: string, id: string) => this.del<AdminAchievementDto[]>(`/achievements/manage/${gameId}/${id}`),
    uploadIcon: (gameId: string, id: string, file: Blob) => {
      const fd = new FormData();
      fd.append('file', file);
      return this.request<AdminAchievementDto[]>('POST', `/achievements/manage/${gameId}/${id}/icon`, { body: fd });
    },
    order: (gameId: string, ids: string[]) => this.put<AdminAchievementDto[]>(`/achievements/manage/${gameId}/order`, { ids }),
    grant: (gameId: string, id: string, username: string) => this.post<AchievementUnlockResult>(`/achievements/manage/${gameId}/${id}/users/${encodeURIComponent(username)}`),
    revoke: (gameId: string, id: string, username: string) => this.del<{ ok: true }>(`/achievements/manage/${gameId}/${id}/users/${encodeURIComponent(username)}`),
  };

  play = {
    start: (gameId: string) => this.post<PlayStartResponse>(`/play/${gameId}/start`),
    parental: () => this.get<ParentalStatus>('/me/parental'),
  };

  workshop = {
    list: (gameIdOrSlug: string, q: { q?: string; kind?: WorkshopKind; sort?: 'popular' | 'recent' | 'rating'; page?: number; pageSize?: number } = {}) =>
      this.get<{ items: WorkshopItemDto[]; total: number; enabled: boolean }>(`/workshop/games/${encodeURIComponent(gameIdOrSlug)}`, q as Query),
    item: (id: string) => this.get<WorkshopItemDto & { versions: WorkshopVersionDto[] }>(`/workshop/items/${id}`),
    create: (gameId: string, data: { title: string; description?: string; kind?: WorkshopKind; tags?: string[] }) => this.post<WorkshopItemDto>(`/workshop/games/${gameId}`, data),
    update: (id: string, data: { title?: string; description?: string; kind?: WorkshopKind; tags?: string[] }) => this.patch<WorkshopItemDto>(`/workshop/items/${id}`, data),
    remove: (id: string) => this.del<{ ok: true }>(`/workshop/items/${id}`),
    moderate: (id: string, hidden: boolean) => this.post<WorkshopItemDto>(`/workshop/items/${id}/moderate`, { hidden }),
    uploadPreview: (id: string, file: Blob) => {
      const fd = new FormData();
      fd.append('file', file);
      return this.request<WorkshopItemDto>('POST', `/workshop/items/${id}/preview`, { body: fd });
    },
    uploadVersion: (id: string, file: Blob, filename: string, version: string, changelog = '') => {
      const fd = new FormData();
      fd.append('file', file, filename);
      return this.request<WorkshopVersionDto>('POST', `/workshop/items/${id}/versions`, { body: fd, query: { version, changelog } });
    },
    deleteVersion: (id: string, versionId: string) => this.del<{ ok: true }>(`/workshop/items/${id}/versions/${versionId}`),
    rate: (id: string, up: boolean | null) => this.put<WorkshopItemDto>(`/workshop/items/${id}/rating`, { up }),
    subscribe: (id: string) => this.put<WorkshopItemDto>(`/workshop/items/${id}/subscription`),
    unsubscribe: (id: string) => this.del<{ ok: true }>(`/workshop/items/${id}/subscription`),
    subscriptions: (gameId?: string) => this.get<WorkshopSubscriptionDto[]>('/workshop/subscriptions', { gameId }),
    mine: () => this.get<{ published: WorkshopItemDto[]; subscribed: WorkshopItemDto[] }>('/workshop/mine'),
    comments: (id: string) => this.get<WorkshopCommentDto[]>(`/workshop/items/${id}/comments`),
    comment: (id: string, body: string) => this.post<WorkshopCommentDto>(`/workshop/items/${id}/comments`, { body }),
    deleteComment: (commentId: string) => this.del<{ ok: true }>(`/workshop/comments/${commentId}`),
  };

  cards = {
    inventory: () => this.get<InventoryDto>('/cards/inventory'),
    userItems: (username: string) => this.get<CardItemDto[]>(`/cards/users/${encodeURIComponent(username)}/items`),
    userBadges: (username: string) => this.get<{ level: ProfileLevel; badges: GameBadgeDto[] }>(`/cards/users/${encodeURIComponent(username)}/badges`),
    craft: (gameId: string) => this.post<{ level: number; xp: number; profile: ProfileLevel }>(`/cards/badges/${gameId}/craft`),
    trades: () => this.get<TradeOfferDto[]>('/cards/trades'),
    offer: (toUserId: string, give: string[], receive: string[], message = '') => this.post<TradeOfferDto>('/cards/trades', { toUserId, give, receive, message }),
    acceptTrade: (id: string) => this.post<TradeOfferDto>(`/cards/trades/${id}/accept`),
    declineTrade: (id: string) => this.post<{ ok: true }>(`/cards/trades/${id}/decline`),
    cancelTrade: (id: string) => this.post<{ ok: true }>(`/cards/trades/${id}/cancel`),
    market: (q: { gameId?: string; mine?: boolean; fulfillable?: boolean } = {}) => this.get<MarketListingDto[]>('/cards/market', q as Query),
    list: (itemId: string, wantCardId: string) => this.post<MarketListingDto>('/cards/market', { itemId, wantCardId }),
    fulfil: (id: string) => this.post<{ ok: true }>(`/cards/market/${id}/fulfil`),
    unlist: (id: string) => this.del<{ ok: true }>(`/cards/market/${id}`),
    manage: (gameId: string) => this.get<(TradingCardDto & { sortOrder: number; inCirculation: number })[]>(`/cards/manage/${gameId}`),
    createCard: (gameId: string, name: string) => this.post<(TradingCardDto & { sortOrder: number; inCirculation: number })[]>(`/cards/manage/${gameId}`, { name }),
    renameCard: (gameId: string, id: string, name: string) => this.patch<(TradingCardDto & { sortOrder: number; inCirculation: number })[]>(`/cards/manage/${gameId}/${id}`, { name }),
    deleteCard: (gameId: string, id: string) => this.del<(TradingCardDto & { sortOrder: number; inCirculation: number })[]>(`/cards/manage/${gameId}/${id}`),
    uploadCardImage: (gameId: string, id: string, file: Blob) => {
      const fd = new FormData();
      fd.append('file', file);
      return this.request<(TradingCardDto & { sortOrder: number; inCirculation: number })[]>('POST', `/cards/manage/${gameId}/${id}/image`, { body: fd });
    },
  };

  family = {
    get: () => this.get<FamilyDto | null>('/family'),
    create: (name: string) => this.post<FamilyDto>('/family', { name }),
    rename: (name: string) => this.patch<FamilyDto>('/family', { name }),
    invite: (username: string, role: FamilyRole) => this.post<FamilyDto>('/family/invites', { username, role }),
    invites: () => this.get<FamilyInviteDto[]>('/family/invites'),
    acceptInvite: (id: string) => this.post<FamilyDto>(`/family/invites/${id}/accept`),
    deleteInvite: (id: string) => this.del<{ ok: true }>(`/family/invites/${id}`),
    updateMember: (userId: string, data: Partial<ParentalSettings> & { role?: FamilyRole }) => this.patch<FamilyDto>(`/family/members/${userId}`, data),
    removeMember: (userId: string) => this.del<{ ok: true }>(`/family/members/${userId}`),
    library: () => this.get<FamilyLibraryEntry[]>('/family/library'),
  };

  gifts = {
    list: () => this.get<{ received: GiftDto[]; sent: GiftDto[] }>('/gifts'),
    send: (gameId: string, toUserId: string, message = '') => this.post<GiftDto>('/gifts', { gameId, toUserId, message }),
    accept: (id: string) => this.post<GiftDto>(`/gifts/${id}/accept`),
    remove: (id: string) => this.del<{ ok: true }>(`/gifts/${id}`),
    redeem: (code: string) => this.post<{ game: GameRef }>('/codes/redeem', { code }),
    codes: (gameId: string, batch?: string) => this.get<ActivationCodeDto[]>(`/codes/manage/${gameId}`, { batch }),
    createCodes: (gameId: string, data: { count: number; batch?: string; note?: string; maxUses?: number; expiresAt?: string | null }) =>
      this.post<ActivationCodeDto[]>(`/codes/manage/${gameId}`, data),
    revokeCode: (gameId: string, id: string, revoked: boolean) => this.patch<{ ok: true }>(`/codes/manage/${gameId}/${id}`, { revoked }),
    exportUrl: (gameId: string, batch?: string) => `${this.baseUrl}/api/codes/manage/${gameId}/export${buildQuery({ batch })}`,
  };

  stats = {
    me: (weeks = 12) => this.get<PlaytimeStats>('/stats/me', { weeks }),
    user: (username: string, weeks = 12) => this.get<PlaytimeStats>(`/stats/users/${encodeURIComponent(username)}`, { weeks }),
    myYear: (year: number) => this.get<YearReview>(`/stats/me/year/${year}`),
    userYear: (username: string, year: number) => this.get<YearReview>(`/stats/users/${encodeURIComponent(username)}/year/${year}`),
    top: (period: TopLists['period'] = 'month') => this.get<TopLists>('/stats/top', { period }),
  };

  devices = {
    list: () => this.get<RemoteDeviceDto[]>('/devices'),
    command: (sessionId: string, action: 'install' | 'launch', gameId: string) => this.post<{ ok: true }>(`/devices/${sessionId}/command`, { action, gameId }),
  };

  notes = {
    get: (gameId: string) => this.get<GameNoteDto>(`/notes/${gameId}`),
    save: (gameId: string, body: string) => this.put<GameNoteDto>(`/notes/${gameId}`, { body }),
  };

  private socket: WebSocket | null = null;

  /** Nachricht über den bestehenden WebSocket senden (Tipp-Hinweise, Sprachchat-Signalisierung). */
  wsSend(msg: WsClientMessage): boolean {
    if (this.socket?.readyState !== 1) return false;
    this.socket.send(JSON.stringify(msg));
    return true;
  }

  /**
   * WebSocket-Verbindung. Browser: Cookie-Auth; Desktop-Client: Device-Token als Subprotokoll "bearer.<token>".
   * Verbindet bei Abbruch automatisch neu.
   */
  connectEvents(onEvent: (e: WsEvent) => void): () => void {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 1000;
    let ping: ReturnType<typeof setInterval> | undefined;
    const base = this.baseUrl || (typeof location !== 'undefined' ? location.origin : '');
    const wsUrl = `${base.replace(/^http/, 'ws')}/api/ws`;
    const connect = () => {
      if (closed) return;
      ws = this.token ? new WebSocket(wsUrl, ['gs.v1', `bearer.${this.token}`]) : new WebSocket(wsUrl);
      this.socket = ws;
      ws.onopen = () => {
        retry = 1000;
        ping = setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'ping' })), 30_000);
      };
      ws.onmessage = (m) => {
        try {
          onEvent(JSON.parse(String(m.data)) as WsEvent);
        } catch {
          // ignorieren
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (!closed) setTimeout(connect, (retry = Math.min(retry * 2, 30_000)));
      };
    };
    connect();
    return () => {
      closed = true;
      clearInterval(ping);
      if (this.socket === ws) this.socket = null;
      ws?.close();
    };
  }
}
