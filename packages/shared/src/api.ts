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
  StoreFacets,
  StoreHome,
  StoreSearchQuery,
  TotpSetup,
  UploadDto,
  UserPublic,
  VersionDto,
  WsEvent,
} from './types.js';

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
      credentials: this.token ? 'omit' : 'include',
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

  /** WebSocket-Verbindung (Browser: Cookie-Auth). Verbindet bei Abbruch automatisch neu. */
  connectEvents(onEvent: (e: WsEvent) => void): () => void {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 1000;
    let ping: ReturnType<typeof setInterval> | undefined;
    const base = this.baseUrl || (typeof location !== 'undefined' ? location.origin : '');
    const wsUrl = `${base.replace(/^http/, 'ws')}/api/ws`;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(wsUrl);
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
      ws?.close();
    };
  }
}
