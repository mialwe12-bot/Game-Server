// Typen für die Server-Föderation (Stufe 1): Netzwerk aus mehreren Servern,
// geteilter Katalog und serverübergreifende Downloads.
import type { BuildKind, Platform } from './types.js';

/** Öffentliche Kennung eines Servers – wird beim Pairing ausgetauscht. */
export interface FederationInfo {
  name: string;
  version: string;
  publicKey: string;
  baseUrl: string;
}

export type FederationStatus = 'PENDING' | 'ACTIVE' | 'BLOCKED';

/** Ein Build eines Remote-Spiels im Verbund. */
export interface RemoteBuildDto {
  buildId: string;
  platform: Platform;
  version: string;
  kind: BuildKind;
  sizeBytes: number;
}

/** Ein Spiel, das auf einem anderen Server im Verbund liegt. */
export interface RemoteGameDto {
  slug: string;
  title: string;
  shortDescription: string;
  coverUrl: string | null;
  developer: string | null;
  publisher: string | null;
  builds: RemoteBuildDto[];
}

/** Remote-Spiel inkl. Herkunftsserver (lokaler Netzwerk-Katalog). */
export interface NetworkGameDto extends RemoteGameDto {
  serverId: string;
  serverName: string;
  serverBaseUrl: string;
}

/** Admin-Sicht auf einen verbundenen Server. */
export interface FederatedServerDto {
  id: string;
  name: string;
  baseUrl: string;
  status: FederationStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  gameCount: number;
  createdAt: string;
}

/** Vom Admin erzeugter Pairing-Code zum Verbinden eines zweiten Servers. */
export interface FederationPairingCode {
  code: string;
  baseUrl: string;
  name: string;
  expiresAt: string;
}

/** Eine signierte, direkt vom Herkunftsserver ladbare Datei. */
export interface RemoteFileDto {
  path: string;
  size: number;
  sha256: string;
  /** Absolute, signierte URL beim Herkunftsserver (kein Token nötig). */
  url: string;
}

/** Antwort auf die Download-Anfrage eines Remote-Builds. */
export interface RemoteDownloadDto {
  kind: BuildKind;
  files: RemoteFileDto[];
}

// --- Stufe 2: geteilte Accounts (föderierter Login) ---

/** Öffentlich sichtbarer verbundener Server (für den Login-Auswahldialog). */
export interface FederationPeer {
  id: string;
  name: string;
  baseUrl: string;
}

/** Identität eines Nutzers, die der Heimat-Server beim föderierten Login übergibt. */
export interface FederatedIdentity {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}
