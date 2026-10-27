import type { MetadataSearchResult, SystemRequirements } from '@gameserver/shared';
import { fetchJson, type MetadataProviderImpl, type MetadataRecord } from './types.js';

// RAWG Video Games Database – https://rawg.io/apidocs (kostenloser API-Key erforderlich)
const BASE = 'https://api.rawg.io/api';

interface RawgGame {
  id: number;
  name: string;
  released: string | null;
  background_image: string | null;
  background_image_additional?: string | null;
  description_raw?: string;
  website?: string;
  developers?: { name: string }[];
  publishers?: { name: string }[];
  genres?: { name: string }[];
  tags?: { name: string; language: string }[];
  platforms?: { platform: { slug: string }; requirements_en?: { minimum?: string; recommended?: string } | null }[];
}

export class RawgProvider implements MetadataProviderImpl {
  constructor(private readonly key: string) {}

  private url(path: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ key: this.key, ...params });
    return `${BASE}${path}?${q.toString()}`;
  }

  async search(query: string): Promise<MetadataSearchResult[]> {
    const data = await fetchJson<{ results: RawgGame[] }>(this.url('/games', { search: query, page_size: '12' }));
    return data.results.map((g) => ({
      provider: 'rawg' as const,
      externalId: String(g.id),
      title: g.name,
      releaseDate: g.released,
      coverUrl: g.background_image,
    }));
  }

  async fetch(id: string): Promise<MetadataRecord> {
    const [g, shots, movies] = await Promise.all([
      fetchJson<RawgGame>(this.url(`/games/${encodeURIComponent(id)}`)),
      fetchJson<{ results: { image: string }[] }>(this.url(`/games/${encodeURIComponent(id)}/screenshots`)).catch(() => ({ results: [] })),
      fetchJson<{ results: { data: { max?: string; '480'?: string } }[] }>(this.url(`/games/${encodeURIComponent(id)}/movies`)).catch(() => ({
        results: [],
      })),
    ]);
    const req: SystemRequirements = {};
    for (const p of g.platforms ?? []) {
      const r = p.requirements_en;
      if (!r || (!r.minimum && !r.recommended)) continue;
      const key = p.platform.slug === 'pc' ? 'windows' : p.platform.slug === 'linux' ? 'linux' : p.platform.slug === 'macos' ? 'macos' : null;
      if (key) req[key] = { minimum: r.minimum ?? undefined, recommended: r.recommended ?? undefined };
    }
    return {
      externalId: String(g.id),
      title: g.name,
      description: g.description_raw ?? '',
      releaseDate: g.released,
      developer: g.developers?.map((d) => d.name).join(', ') || undefined,
      publisher: g.publishers?.map((d) => d.name).join(', ') || undefined,
      genres: g.genres?.map((x) => x.name) ?? [],
      tags: (g.tags ?? []).filter((t) => t.language === 'eng').slice(0, 15).map((t) => t.name),
      headerUrl: g.background_image ?? undefined,
      backgroundUrl: g.background_image_additional ?? g.background_image ?? undefined,
      screenshotUrls: shots.results.map((s) => s.image).filter((u) => u !== g.background_image),
      trailerUrls: movies.results.map((m) => m.data.max ?? m.data['480']).filter((u): u is string => !!u),
      systemRequirements: req,
      website: g.website || undefined,
    };
  }
}
