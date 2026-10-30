// Typen für die Server-Föderation (Stufe 1): Netzwerk aus mehreren Servern,
// geteilter Katalog und serverübergreifende Downloads.
import type { BuildKind, Platform, RegistrationMode, Role } from './types.js';

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
  /** Wir erlauben diesem Peer, uns fernzuverwalten. */
  adminGranted: boolean;
  /** Dieser Peer erlaubt uns, ihn fernzuverwalten (zwischengespeichert aus dem Sync). */
  adminAllowed: boolean;
}

/** Kompakte Übersicht eines fernverwalteten Servers. */
export interface RemoteAdminOverview {
  siteName: string;
  version: string;
  userCount: number;
  adminCount: number;
  gameCount: number;
  storageBytes: number;
  federatedServerCount: number;
  maintenanceMode: boolean;
}

/** Bearbeitbare Betriebseinstellungen eines fernverwalteten Servers. */
export interface RemoteSettingsDto {
  siteName: string;
  siteDescription: string;
  registrationMode: RegistrationMode;
  storePublic: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
}

/** Ein Nutzer eines fernverwalteten Servers (kompakt). */
export interface RemoteUserDto {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /** Schatten-Konto (von einem weiteren Server föderiert). */
  federated: boolean;
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

/** Antwort auf die Download-Anfrage eines Remote-Builds (inkl. Metadaten zum Installieren/Starten). */
export interface RemoteDownloadDto {
  buildId: string;
  platform: Platform;
  version: string;
  kind: BuildKind;
  executable: string;
  launchArgs: string;
  workingDir: string;
  installerArgs: string;
  linuxRunner: string;
  installSize: number;
  totalSize: number;
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
