// Vertrag zwischen Web-Frontend und dem Rust-Teil des Desktop-Clients (Tauri-Befehle und -Ereignisse).
import type { BuildKind, LinuxRunner, Platform } from './types.js';

export interface DownloadSchedule {
  enabled: boolean;
  /** Stunde 0–23, ab der geladen werden darf */
  startHour: number;
  /** Stunde 0–23, bis zu der geladen werden darf (exklusiv; start > end = über Mitternacht) */
  endHour: number;
}

export interface DesktopConfig {
  serverUrl: string | null;
  token: string | null;
  username: string | null;
  libraryFolders: string[];
  defaultLibraryFolder: string | null;
  maxConcurrentChunks: number;
  bandwidthLimitKbps: number;
  schedule: DownloadSchedule;
  autoUpdateGames: boolean;
  closeToTray: boolean;
  startMinimized: boolean;
  autostart: boolean;
  notifications: boolean;
  defaultRunnerId: string | null;
}

export interface PlatformInfo {
  os: 'windows' | 'linux' | 'macos';
  arch: string;
  platform: Platform;
  steamDeck: boolean;
  gamingMode: boolean;
  clientVersion: string;
  updaterEnabled: boolean;
  hostname: string;
}

export interface RunnerInfo {
  id: string;
  name: string;
  kind: 'proton' | 'wine' | 'umu';
  path: string;
}

export interface LaunchOptions {
  args: string;
  env: Record<string, string>;
  runnerId: string | null;
  useRunner: boolean;
}

export interface InstalledGame {
  gameId: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  headerUrl: string | null;
  buildId: string;
  versionId: string;
  version: string;
  platform: Platform;
  kind: BuildKind;
  installDir: string;
  libraryFolder: string;
  sizeOnDisk: number;
  installedAt: string;
  executable: string;
  launchArgs: string;
  workingDir: string;
  linuxRunner: LinuxRunner;
  options: LaunchOptions;
  autoUpdate: boolean;
  /** Feste Version (Rollback); null = immer neueste */
  pinnedVersionId: string | null;
  lastPlayedAt: string | null;
  localPlaytimeSeconds: number;
  updateAvailable: { versionId: string; version: string } | null;
  shortcuts: { desktop: boolean; menu: boolean };
}

export type DownloadState =
  | 'queued'
  | 'waitingSchedule'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'extracting'
  | 'installing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type DownloadKind = 'install' | 'update' | 'repair';

export interface DownloadJob {
  id: string;
  gameId: string;
  title: string;
  coverUrl: string | null;
  version: string;
  kind: DownloadKind;
  state: DownloadState;
  totalBytes: number;
  downloadedBytes: number;
  /** Bytes pro Sekunde */
  speed: number;
  filesTotal: number;
  filesDone: number;
  error: string | null;
  createdAt: string;
}

export interface InstallRequest {
  gameId: string;
  /** Bestimmte Version (Versionswahl/Rollback); sonst neueste */
  versionId?: string | null;
  libraryFolder?: string | null;
}

export interface RunningGame {
  gameId: string;
  startedAt: string;
}

export interface ClientUpdateInfo {
  available: boolean;
  version: string | null;
  notes: string | null;
  canInstall: boolean;
  downloadUrl: string | null;
}

export interface DiskSpace {
  path: string;
  free: number;
  total: number;
}

/** Ereignisnamen (Rust → Frontend) */
export const DESKTOP_EVENTS = {
  downloads: 'gs://downloads',
  library: 'gs://library',
  running: 'gs://running',
  authToken: 'gs://auth-token',
  launchRequest: 'gs://launch-request',
} as const;
