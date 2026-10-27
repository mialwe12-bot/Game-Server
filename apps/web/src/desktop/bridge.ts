// Brücke zum Rust-Teil des Desktop-Clients (Tauri). Im Browser ist `isDesktop` false und nichts davon wird genutzt.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  CloudSyncResult,
  ImportCandidate,
  LocalScreenshot,
  SteamStatus,
  SunshineStatus,
  SyncCounts,
  WorkshopSyncResult,
  ClientUpdateInfo,
  DesktopConfig,
  DiskSpace,
  DownloadJob,
  InstalledGame,
  InstallRequest,
  LaunchOptions,
  PlatformInfo,
  PublicSettings,
  RunnerInfo,
  RunningGame,
} from '@gameserver/shared';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Läuft dieses Frontend im Overlay-Fenster des Clients? (Das Overlay lädt `#/overlay`.) */
export const isOverlayWindow = isDesktop && window.location.hash.startsWith('#/overlay');

export const desktop = {
  getConfig: () => invoke<DesktopConfig>('get_config'),
  setConfig: (patch: Partial<DesktopConfig>) => invoke<DesktopConfig>('set_config', { patch }),
  setSession: (serverUrl: string, token: string | null, username?: string | null) =>
    invoke<DesktopConfig>('set_session', { serverUrl, token, username: username ?? null }),
  clearSession: () => invoke<DesktopConfig>('clear_session'),
  testServer: (url: string) => invoke<PublicSettings>('test_server', { url }),
  getPlatform: () => invoke<PlatformInfo>('get_platform'),
  listRunners: (refresh = false) => invoke<RunnerInfo[]>('list_runners', { refresh }),
  pickFolder: () => invoke<string | null>('pick_folder'),
  diskSpace: (path: string) => invoke<DiskSpace | null>('disk_space', { path }),
  openPath: (path: string) => invoke<void>('open_path', { path }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
  startSsoLogin: () => invoke<string>('start_sso_login'),

  installedGames: () => invoke<InstalledGame[]>('installed_games'),
  installGame: (req: InstallRequest) => invoke<DownloadJob>('install_game', { req }),
  updateGame: (gameId: string, versionId?: string | null) => invoke<DownloadJob>('update_game', { gameId, versionId: versionId ?? null }),
  repairGame: (gameId: string) => invoke<DownloadJob>('repair_game', { gameId }),
  uninstallGame: (gameId: string, removePrefix: boolean, removeAll: boolean) => invoke<void>('uninstall_game', { gameId, removePrefix, removeAll }),
  setGameOptions: (gameId: string, options: LaunchOptions, autoUpdate?: boolean) =>
    invoke<InstalledGame>('set_game_options', { gameId, options, autoUpdate: autoUpdate ?? null }),
  createShortcuts: (gameId: string, desktopShortcut: boolean, menu: boolean) =>
    invoke<{ desktop: boolean; menu: boolean }>('create_shortcuts', { gameId, desktop: desktopShortcut, menu }),
  checkGameUpdates: () => invoke<InstalledGame[]>('check_game_updates'),

  listDownloads: () => invoke<DownloadJob[]>('list_downloads'),
  pauseDownload: (id: string) => invoke<void>('pause_download', { id }),
  resumeDownload: (id: string) => invoke<void>('resume_download', { id }),
  cancelDownload: (id: string) => invoke<void>('cancel_download', { id }),
  reorderDownload: (id: string, delta: number) => invoke<void>('reorder_download', { id, delta }),
  pauseAll: () => invoke<void>('pause_all_downloads'),
  resumeAll: () => invoke<void>('resume_all_downloads'),
  clearFinished: () => invoke<void>('clear_finished_downloads'),

  launchGame: (gameId: string) => invoke<void>('launch_game', { gameId }),
  stopGame: (gameId: string) => invoke<void>('stop_game', { gameId }),
  runningGames: () => invoke<RunningGame[]>('running_games'),
  takeLaunchRequest: () => invoke<string | null>('take_launch_request'),
  syncPlaytime: () => invoke<number>('sync_playtime'),
  pendingPlaytime: () => invoke<number>('pending_playtime'),

  checkClientUpdate: () => invoke<ClientUpdateInfo>('check_client_update'),
  installClientUpdate: () => invoke<void>('install_client_update'),
  showNotification: (title: string, body: string) => invoke<void>('show_notification', { title, body }),

  // ---- Phase 4 ----
  toggleOverlay: (show?: boolean) => invoke<boolean>('toggle_overlay', { show: show ?? null }),
  openOverlayBrowser: (url: string) => invoke<void>('open_overlay_browser', { url }),
  takeScreenshot: () => invoke<LocalScreenshot>('take_screenshot'),
  listScreenshots: () => invoke<LocalScreenshot[]>('list_screenshots'),
  /** PNG-Bytes eines lokalen Screenshots (für Vorschau/Upload) */
  readScreenshot: (path: string) => invoke<ArrayBuffer>('read_screenshot', { path }),
  deleteScreenshot: (path: string) => invoke<void>('delete_screenshot', { path }),
  openScreenshotFolder: () => invoke<void>('open_screenshot_folder'),
  cloudSync: (gameId: string, mode: 'auto' | 'upload' | 'download') => invoke<CloudSyncResult>('cloud_sync', { gameId, mode }),
  cloudStatus: (gameId: string) => invoke<CloudSyncResult>('cloud_status', { gameId }),
  workshopSync: () => invoke<WorkshopSyncResult>('workshop_sync'),
  steamStatus: () => invoke<SteamStatus>('steam_status'),
  steamSyncShortcuts: (userId: string | null) => invoke<SyncCounts>('steam_sync_shortcuts', { userId }),
  sunshineStatus: () => invoke<SunshineStatus>('sunshine_status'),
  sunshineSync: () => invoke<SyncCounts>('sunshine_sync'),
  scanFolder: (path: string) => invoke<ImportCandidate[]>('scan_folder', { path }),
  importGame: (path: string, gameId: string, buildId: string) => invoke<InstalledGame>('import_game', { path, gameId, buildId }),

  on: <T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> => listen<T>(event, (e) => cb(e.payload)),
};

/** Fehlermeldung aus einem Tauri-Befehl (Rust liefert Strings). */
export function desktopError(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return String(err);
}
