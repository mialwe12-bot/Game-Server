import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { DESKTOP_EVENTS, type CloudSyncResult, type DesktopConfig, type DownloadJob, type InstalledGame, type LocalScreenshot, type PlatformInfo, type RunningGame } from '@gameserver/shared';
import i18n from '../i18n';
import { CloudConflictDialog } from './CloudConflictDialog';
import { api } from '../lib/api';
import { useWsEvent } from '../lib/events';
import { toast } from '../lib/toast';
import { desktop, desktopError, isDesktop, isOverlayWindow } from './bridge';

interface DesktopState {
  config: DesktopConfig;
  platform: PlatformInfo | null;
  installed: InstalledGame[];
  installedById: Map<string, InstalledGame>;
  downloads: DownloadJob[];
  running: Set<string>;
  updateConfig: (patch: Partial<DesktopConfig>) => Promise<void>;
  reload: () => Promise<void>;
  /** Spiel starten mit Fehlermeldung als Toast */
  play: (gameId: string) => Promise<void>;
}

const Ctx = createContext<DesktopState | null>(null);

/** Initiale Konfiguration wird in main.tsx vor dem ersten Rendern geladen. */
export function DesktopProvider({ initialConfig, children }: { initialConfig: DesktopConfig; children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [config, setConfig] = useState(initialConfig);
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [installed, setInstalled] = useState<InstalledGame[]>([]);
  const [downloads, setDownloads] = useState<DownloadJob[]>([]);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const installedRef = useRef(installed);
  installedRef.current = installed;

  const reload = useCallback(async () => {
    const [cfg, games, jobs, run, plat] = await Promise.all([
      desktop.getConfig(),
      desktop.installedGames(),
      desktop.listDownloads(),
      desktop.runningGames(),
      desktop.getPlatform(),
    ]);
    setConfig(cfg);
    setInstalled(games);
    setDownloads(jobs);
    setRunning(new Set(run.map((r) => r.gameId)));
    setPlatform(plat);
  }, []);

  // „Spielt gerade“ an den Server melden (Präsenz für Freunde); nach WebSocket-Neuverbindung erneut senden.
  const presenceGame = running.size ? [...running][0] : null;
  const reportPresence = useCallback(() => {
    if (api.token && !isOverlayWindow) void api.friends.setPresence(presenceGame).catch(() => undefined);
  }, [presenceGame]);
  useEffect(reportPresence, [reportPresence]);
  useWsEvent((e) => {
    if (e.type === 'hello' && presenceGame) reportPresence();
  });

  useEffect(() => {
    void reload();
    const subs = [
      desktop.on<DownloadJob[]>(DESKTOP_EVENTS.downloads, setDownloads),
      desktop.on<InstalledGame[]>(DESKTOP_EVENTS.library, (games) => {
        setInstalled(games);
        void qc.invalidateQueries({ queryKey: ['library'] });
      }),
      desktop.on<RunningGame[]>(DESKTOP_EVENTS.running, (r) => setRunning(new Set(r.map((x) => x.gameId)))),
      desktop.on<{ token: string; username: string | null }>(DESKTOP_EVENTS.authToken, async ({ token, username }) => {
        const cfg = await desktop.setSession(api.baseUrl, token, username);
        api.token = token;
        setConfig(cfg);
        await qc.invalidateQueries();
        navigate('/', { replace: true });
      }),
      desktop.on<string>(DESKTOP_EVENTS.launchRequest, (gameId) => {
        const game = installedRef.current.find((g) => g.gameId === gameId);
        navigate(game ? `/game/${game.slug}` : '/library');
      }),
      // Cloud-Konflikt nach Spielende (Upload) – Dialog im Hauptfenster
      desktop.on<CloudSyncResult>(DESKTOP_EVENTS.cloud, (r) => {
        if (r.status === 'conflict' && !isOverlayWindow) setConflict({ result: r, launchAfter: false });
      }),
      desktop.on<LocalScreenshot>(DESKTOP_EVENTS.screenshot, (shot) => {
        if (!isOverlayWindow) toast.success(i18n.t('screenshots.taken', { title: shot.gameTitle ?? '' }));
      }),
    ];
    // Start über Verknüpfung, der beim Hochfahren nicht direkt gelang
    void desktop.takeLaunchRequest().then((id) => id && navigate(`/library?game=${id}`));
    return () => {
      for (const s of subs) void s.then((un) => un());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateConfig = useCallback(async (patch: Partial<DesktopConfig>) => {
    try {
      setConfig(await desktop.setConfig(patch));
    } catch (err) {
      toast.error(desktopError(err));
    }
  }, []);

  const play = useCallback(async (gameId: string) => {
    try {
      await desktop.launchGame(gameId);
    } catch (err) {
      const msg = desktopError(err);
      // Cloud-Konflikt vor dem Start: Nutzer entscheiden lassen, danach erneut starten
      if (msg.startsWith('cloud_conflict')) {
        const status = await desktop.cloudStatus(gameId).catch(() => null);
        if (status) {
          setConflict({ result: { ...status, status: 'conflict' }, launchAfter: true });
          return;
        }
      }
      toast.error(msg.replace(/^cloud_conflict:?\s*/, ''));
    }
  }, []);

  // Fernbefehle von anderen eigenen Geräten (Web/zweiter Client) und Workshop-Aktualisierungen
  const configRef = useRef(config);
  configRef.current = config;
  useWsEvent((e) => {
    if (isOverlayWindow) return;
    if (e.type === 'remote.command') {
      const label = i18n.t(e.data.action === 'install' ? 'devices.remoteInstall' : 'devices.remoteLaunch', { from: e.data.from });
      toast.info(label);
      void (e.data.action === 'install' ? desktop.installGame({ gameId: e.data.gameId }) : play(e.data.gameId)).catch((err) => toast.error(desktopError(err)));
    } else if (e.type === 'workshop.updated' && configRef.current.workshopAutoSync) {
      void desktop.workshopSync().catch(() => undefined);
    }
  });

  // Steam Deck/Gaming-Mode bzw. Einstellung: im Big-Picture-Modus starten
  const bigPictureChecked = useRef(false);
  useEffect(() => {
    if (bigPictureChecked.current || isOverlayWindow || !platform) return;
    bigPictureChecked.current = true;
    if (platform.gamingMode || config.startInBigPicture) navigate('/big-picture');
  }, [platform, config.startInBigPicture, navigate]);

  const [conflict, setConflict] = useState<{ result: CloudSyncResult; launchAfter: boolean } | null>(null);

  const value = useMemo<DesktopState>(
    () => ({
      config,
      platform,
      installed,
      installedById: new Map(installed.map((g) => [g.gameId, g])),
      downloads,
      running,
      updateConfig,
      reload,
      play,
    }),
    [config, platform, installed, downloads, running, updateConfig, reload, play],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      {conflict && (
        <CloudConflictDialog
          conflict={conflict.result}
          title={installed.find((g) => g.gameId === conflict.result.gameId)?.title ?? ''}
          onDone={(resolved) => {
            const after = conflict.launchAfter;
            setConflict(null);
            if (resolved && after) void desktop.launchGame(conflict.result.gameId).catch((err) => toast.error(desktopError(err)));
          }}
        />
      )}
    </Ctx.Provider>
  );
}

/** Desktop-Zustand oder null im Browser. */
export function useDesktop(): DesktopState | null {
  const ctx = useContext(Ctx);
  return isDesktop ? ctx : null;
}

export function useDesktopRequired(): DesktopState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('Nur im Desktop-Client verfügbar');
  return ctx;
}

export function activeDownloads(jobs: DownloadJob[]): DownloadJob[] {
  return jobs.filter((j) => !['completed', 'failed', 'cancelled'].includes(j.state));
}
