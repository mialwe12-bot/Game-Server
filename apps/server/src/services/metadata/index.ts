import type { MediaKind } from '@prisma/client';
import type { MetadataField, MetadataProvider, MetadataSearchResult } from '@gameserver/shared';
import type { AppContext } from '../../context.js';
import { badRequest } from '../../lib/errors.js';
import { detectImage } from '../../lib/images.js';
import { slugify } from '../../lib/slug.js';
import { IgdbProvider } from './igdb.js';
import { RawgProvider } from './rawg.js';
import type { MetadataProviderImpl, MetadataRecord } from './types.js';

const MAX_IMAGE_BYTES = 20 * 1024 ** 2;
const MAX_SCREENSHOTS = 12;

export class MetadataService {
  private providers: Partial<Record<MetadataProvider, MetadataProviderImpl>> = {};

  constructor(private readonly ctx: AppContext) {
    const c = ctx.config;
    if (c.RAWG_API_KEY) this.providers.rawg = new RawgProvider(c.RAWG_API_KEY);
    if (c.IGDB_CLIENT_ID && c.IGDB_CLIENT_SECRET) this.providers.igdb = new IgdbProvider(c.IGDB_CLIENT_ID, c.IGDB_CLIENT_SECRET);
  }

  available(): { igdb: boolean; rawg: boolean } {
    return { igdb: !!this.providers.igdb, rawg: !!this.providers.rawg };
  }

  /** Für Tests: Provider ersetzen. */
  setProvider(name: MetadataProvider, impl: MetadataProviderImpl): void {
    this.providers[name] = impl;
  }

  private provider(name: MetadataProvider): MetadataProviderImpl {
    const p = this.providers[name];
    if (!p) throw badRequest(`Metadaten-Anbieter ${name} ist nicht konfiguriert`, 'provider_unavailable');
    return p;
  }

  search(name: MetadataProvider, q: string): Promise<MetadataSearchResult[]> {
    return this.provider(name).search(q);
  }

  fetch(name: MetadataProvider, id: string): Promise<MetadataRecord> {
    return this.provider(name).fetch(id);
  }

  private async downloadImage(url: string): Promise<{ data: Buffer; mime: string; ext: string } | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return null;
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > MAX_IMAGE_BYTES) return null;
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > MAX_IMAGE_BYTES) return null;
      const type = detectImage(data);
      return type ? { data, mime: type.mime, ext: type.ext } : null;
    } catch {
      return null;
    }
  }

  private async storeImage(gameId: string, kind: MediaKind, url: string, sortOrder: number): Promise<boolean> {
    const img = await this.downloadImage(url);
    if (!img) return false;
    const media = await this.ctx.db.gameMedia.create({
      data: { gameId, kind, storageKey: 'pending', mimeType: img.mime, size: img.data.length, sortOrder },
    });
    const key = `media/${gameId}/${media.id}.${img.ext}`;
    await this.ctx.storage.write(key, img.data);
    await this.ctx.db.gameMedia.update({ where: { id: media.id }, data: { storageKey: key } });
    return true;
  }

  private async replaceSingle(gameId: string, kind: MediaKind, url: string | undefined): Promise<void> {
    if (!url) return;
    const old = await this.ctx.db.gameMedia.findMany({ where: { gameId, kind } });
    if (await this.storeImage(gameId, kind, url, 0)) {
      for (const m of old) {
        await this.ctx.db.gameMedia.delete({ where: { id: m.id } });
        await this.ctx.storage.remove(m.storageKey);
      }
    }
  }

  /** Übernimmt ausgewählte Felder eines Anbieters in ein Spiel. */
  async importInto(gameId: string, name: MetadataProvider, externalId: string, fields: MetadataField[]): Promise<void> {
    const { db } = this.ctx;
    const rec = await this.fetch(name, externalId);
    const want = new Set(fields);
    const data: Record<string, unknown> = name === 'igdb' ? { igdbId: rec.externalId } : { rawgId: rec.externalId };
    if (want.has('title') && rec.title) data.title = rec.title;
    if (want.has('description') && rec.description) {
      data.description = rec.description;
      data.shortDescription = rec.description.split(/\n/)[0].slice(0, 280);
    }
    if (want.has('releaseDate') && rec.releaseDate) data.releaseDate = new Date(rec.releaseDate);
    if (want.has('developer') && rec.developer) data.developer = rec.developer;
    if (want.has('publisher') && rec.publisher) data.publisher = rec.publisher;
    if (want.has('website') && rec.website) data.website = rec.website;
    if (want.has('trailers') && rec.trailerUrls?.length) data.trailerUrls = rec.trailerUrls.slice(0, 5);
    if (want.has('systemRequirements') && rec.systemRequirements && Object.keys(rec.systemRequirements).length)
      data.systemRequirements = rec.systemRequirements;
    const toConnect = (names: string[]) =>
      names
        .filter((n) => slugify(n))
        .map((n) => ({ where: { slug: slugify(n) }, create: { slug: slugify(n), name: n } }));
    if (want.has('genres') && rec.genres?.length) data.genres = { connectOrCreate: toConnect(rec.genres) };
    if (want.has('tags') && rec.tags?.length) data.tags = { connectOrCreate: toConnect(rec.tags) };
    await db.game.update({ where: { id: gameId }, data });

    if (want.has('cover')) {
      await this.replaceSingle(gameId, 'COVER', rec.coverUrl);
      await this.replaceSingle(gameId, 'HEADER', rec.headerUrl);
      await this.replaceSingle(gameId, 'BACKGROUND', rec.backgroundUrl);
    }
    if (want.has('screenshots') && rec.screenshotUrls?.length) {
      const count = await db.gameMedia.count({ where: { gameId, kind: 'SCREENSHOT' } });
      let i = count;
      for (const url of rec.screenshotUrls.slice(0, MAX_SCREENSHOTS)) {
        if (await this.storeImage(gameId, 'SCREENSHOT', url, i)) i++;
      }
    }
  }
}
