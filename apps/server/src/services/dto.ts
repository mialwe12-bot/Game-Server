import type {
  Announcement,
  Build,
  Game,
  GameMedia,
  GameVersion,
  Genre,
  Prisma,
  Tag,
  Upload,
  User,
} from '@prisma/client';
import type {
  AnnouncementDto,
  BuildDto,
  CurrentUser,
  GameSummary,
  MediaDto,
  Platform,
  SystemRequirements,
  UploadDto,
  UserPublic,
  VersionDto,
} from '@gameserver/shared';
import { iso } from '../lib/time.js';

export function avatarUrl(user: Pick<User, 'id' | 'avatarKey'>): string | null {
  if (!user.avatarKey) return null;
  const v = user.avatarKey.split('/').pop()?.split('.')[0] ?? '';
  return `/api/users/${user.id}/avatar?v=${v}`;
}

export function userPublic(user: User): UserPublic {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: avatarUrl(user),
    role: user.role,
    bio: user.bio,
    createdAt: user.createdAt.toISOString(),
  };
}

export function currentUser(user: User): CurrentUser {
  return {
    ...userPublic(user),
    email: user.email,
    locale: user.locale,
    totpEnabled: user.totpEnabled,
    hasPassword: !!user.passwordHash,
    oidcLinked: !!user.oidcSubject,
    networkAdmin: user.networkAdmin,
  };
}

export const mediaUrl = (m: Pick<GameMedia, 'id'>) => `/api/media/${m.id}`;

export function mediaDto(m: GameMedia): MediaDto {
  return { id: m.id, kind: m.kind, url: mediaUrl(m), mimeType: m.mimeType, sortOrder: m.sortOrder };
}

/** Standard-Include für Spielzusammenfassungen. */
export const gameSummaryInclude = {
  genres: true,
  tags: true,
  media: { where: { kind: { in: ['COVER', 'HEADER'] } }, orderBy: { sortOrder: 'asc' } },
  versions: {
    where: { published: true },
    select: { builds: { where: { status: 'READY' }, select: { platform: true } } },
  },
} satisfies Prisma.GameInclude;

export type GameWithSummary = Game & {
  genres: Genre[];
  tags: Tag[];
  media: GameMedia[];
  versions: { builds: { platform: Platform }[] }[];
};

export function gameSummary(g: GameWithSummary): GameSummary {
  const platforms = new Set<Platform>();
  for (const v of g.versions) for (const b of v.builds) platforms.add(b.platform);
  const cover = g.media.find((m) => m.kind === 'COVER');
  const header = g.media.find((m) => m.kind === 'HEADER');
  return {
    id: g.id,
    slug: g.slug,
    title: g.title,
    shortDescription: g.shortDescription,
    coverUrl: cover ? mediaUrl(cover) : null,
    headerUrl: header ? mediaUrl(header) : cover ? mediaUrl(cover) : null,
    developer: g.developer,
    releaseDate: iso(g.releaseDate),
    genres: g.genres.map(({ id, slug, name }) => ({ id, slug, name })),
    tags: g.tags.map(({ id, slug, name }) => ({ id, slug, name })),
    platforms: (['WINDOWS', 'LINUX', 'MACOS'] as Platform[]).filter((p) => platforms.has(p)),
    visibility: g.visibility,
    featured: g.featured,
  };
}

export function buildDto(b: Build & { _count?: { files: number } }): BuildDto {
  return {
    id: b.id,
    versionId: b.versionId,
    platform: b.platform,
    kind: b.kind,
    status: b.status,
    executable: b.executable,
    launchArgs: b.launchArgs,
    workingDir: b.workingDir,
    installerArgs: b.installerArgs,
    linuxRunner: b.linuxRunner,
    installSize: Number(b.installSize),
    totalSize: Number(b.totalSize),
    fileCount: b._count?.files ?? 0,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export function versionDto(v: GameVersion & { builds: (Build & { _count?: { files: number } })[] }): VersionDto {
  return {
    id: v.id,
    gameId: v.gameId,
    version: v.version,
    changelog: v.changelog,
    published: v.published,
    createdAt: v.createdAt.toISOString(),
    publishedAt: iso(v.publishedAt),
    builds: v.builds.map(buildDto),
  };
}

export function uploadDto(u: Upload): UploadDto {
  return {
    id: u.id,
    buildId: u.buildId,
    path: u.path,
    size: Number(u.size),
    offset: Number(u.offset),
    status: u.status,
    sha256: u.sha256,
    error: u.error,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

export function announcementDto(a: Announcement & { author: User | null; game: Game | null }): AnnouncementDto {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    published: a.published,
    pinned: a.pinned,
    gameId: a.gameId,
    gameTitle: a.game?.title ?? null,
    author: a.author ? userPublic(a.author) : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export const announcementInclude = { author: true, game: true } satisfies Prisma.AnnouncementInclude;

export function systemRequirements(value: unknown): SystemRequirements {
  if (!value || typeof value !== 'object') return {};
  return value as SystemRequirements;
}
