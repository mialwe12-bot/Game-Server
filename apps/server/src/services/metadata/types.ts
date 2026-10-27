import type { MetadataSearchResult, SystemRequirements } from '@gameserver/shared';

export interface MetadataRecord {
  title?: string;
  description?: string;
  releaseDate?: string | null;
  developer?: string;
  publisher?: string;
  genres?: string[];
  tags?: string[];
  coverUrl?: string;
  headerUrl?: string;
  backgroundUrl?: string;
  screenshotUrls?: string[];
  trailerUrls?: string[];
  systemRequirements?: SystemRequirements;
  website?: string;
  externalId: string;
}

export interface MetadataProviderImpl {
  search(query: string): Promise<MetadataSearchResult[]>;
  fetch(externalId: string): Promise<MetadataRecord>;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Metadaten-Anfrage fehlgeschlagen (${res.status}): ${url.split('?')[0]}`);
  return (await res.json()) as T;
}
