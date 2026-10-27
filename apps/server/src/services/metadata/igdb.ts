import type { MetadataSearchResult } from '@gameserver/shared';
import { fetchJson, type MetadataProviderImpl, type MetadataRecord } from './types.js';

// IGDB (Twitch) – https://api-docs.igdb.com (Twitch Client-ID + Secret erforderlich)
const API = 'https://api.igdb.com/v4';
const img = (id: string, size: string) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;

interface IgdbGame {
  id: number;
  name: string;
  summary?: string;
  storyline?: string;
  first_release_date?: number;
  cover?: { image_id: string };
  screenshots?: { image_id: string }[];
  artworks?: { image_id: string }[];
  genres?: { name: string }[];
  themes?: { name: string }[];
  keywords?: { name: string }[];
  involved_companies?: { company: { name: string }; developer: boolean; publisher: boolean }[];
  videos?: { video_id: string }[];
  websites?: { url: string; category?: number; type?: number }[];
}

export class IgdbProvider implements MetadataProviderImpl {
  private token: { value: string; expires: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'client_credentials',
    });
    const data = await fetchJson<{ access_token: string; expires_in: number }>(`https://id.twitch.tv/oauth2/token?${params}`, {
      method: 'POST',
    });
    this.token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  private async query<T>(endpoint: string, body: string): Promise<T> {
    return fetchJson<T>(`${API}/${endpoint}`, {
      method: 'POST',
      headers: { 'Client-ID': this.clientId, Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'text/plain' },
      body,
    });
  }

  async search(q: string): Promise<MetadataSearchResult[]> {
    const safe = q.replace(/["\\]/g, ' ');
    const games = await this.query<IgdbGame[]>('games', `search "${safe}"; fields name,first_release_date,cover.image_id; limit 12;`);
    return games.map((g) => ({
      provider: 'igdb' as const,
      externalId: String(g.id),
      title: g.name,
      releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
      coverUrl: g.cover ? img(g.cover.image_id, 'cover_big') : null,
    }));
  }

  async fetch(id: string): Promise<MetadataRecord> {
    if (!/^\d+$/.test(id)) throw new Error('Ungültige IGDB-ID');
    const [g] = await this.query<IgdbGame[]>(
      'games',
      `fields name,summary,storyline,first_release_date,cover.image_id,screenshots.image_id,artworks.image_id,genres.name,themes.name,keywords.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,videos.video_id,websites.url,websites.category,websites.type; where id = ${id};`,
    );
    if (!g) throw new Error('Spiel bei IGDB nicht gefunden');
    const description = [g.summary, g.storyline].filter(Boolean).join('\n\n');
    const companies = g.involved_companies ?? [];
    const art = g.artworks?.[0] ?? g.screenshots?.[0];
    const official = g.websites?.find((w) => w.category === 1 || w.type === 1) ?? g.websites?.[0];
    return {
      externalId: String(g.id),
      title: g.name,
      description,
      releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
      developer: companies.filter((c) => c.developer).map((c) => c.company.name).join(', ') || undefined,
      publisher: companies.filter((c) => c.publisher).map((c) => c.company.name).join(', ') || undefined,
      genres: g.genres?.map((x) => x.name) ?? [],
      tags: [...(g.themes ?? []), ...(g.keywords ?? [])].slice(0, 15).map((t) => t.name),
      coverUrl: g.cover ? img(g.cover.image_id, 'cover_big') : undefined,
      headerUrl: art ? img(art.image_id, 'screenshot_big') : undefined,
      backgroundUrl: art ? img(art.image_id, '1080p') : undefined,
      screenshotUrls: (g.screenshots ?? []).map((s) => img(s.image_id, '1080p')),
      trailerUrls: (g.videos ?? []).map((v) => `https://www.youtube.com/watch?v=${v.video_id}`),
      website: official?.url,
    };
  }
}
