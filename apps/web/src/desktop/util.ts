import type { BuildDto, GameDetail, Platform, VersionDto } from '@gameserver/shared';

/** Spiegelt die Build-Auswahl des Rust-Kerns: nativer Build, unter Linux ersatzweise Windows (Proton/Wine). */
export function buildFor(version: VersionDto, host: Platform): BuildDto | undefined {
  const ready = version.builds.filter((b) => b.status === 'READY');
  return ready.find((b) => b.platform === host) ?? (host === 'LINUX' ? ready.find((b) => b.platform === 'WINDOWS') : undefined);
}

export function installableVersions(game: GameDetail, host: Platform): { version: VersionDto; build: BuildDto }[] {
  return game.versions
    .filter((v) => v.published)
    .map((version) => ({ version, build: buildFor(version, host) }))
    .filter((x): x is { version: VersionDto; build: BuildDto } => !!x.build);
}

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

export const envToText = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
