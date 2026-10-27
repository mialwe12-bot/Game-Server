// Empfehlungslogik: Gewichtung von Genres/Tags anhand der Spielzeit des Nutzers.

export interface FeatureGame {
  id: string;
  genreIds: string[];
  tagIds: string[];
}

export interface PlayedGame extends FeatureGame {
  playtimeSeconds: number;
  favorite?: boolean;
}

const GENRE_FACTOR = 1;
const TAG_FACTOR = 0.6;

/**
 * Erzeugt Präferenzgewichte. Spielzeit wirkt logarithmisch (10 h zählen nicht 10× so viel wie 1 h),
 * Besitz und Favoriten geben einen Grundwert, Wunschlisteneinträge ein schwächeres Signal.
 */
export function preferenceWeights(played: PlayedGame[], wishlist: FeatureGame[] = []): Map<string, number> {
  const weights = new Map<string, number>();
  const add = (key: string, w: number) => weights.set(key, (weights.get(key) ?? 0) + w);
  for (const g of played) {
    const hours = g.playtimeSeconds / 3600;
    const w = 0.5 + Math.log2(1 + hours) + (g.favorite ? 1 : 0);
    for (const id of g.genreIds) add(`g:${id}`, w * GENRE_FACTOR);
    for (const id of g.tagIds) add(`t:${id}`, w * TAG_FACTOR);
  }
  for (const g of wishlist) {
    for (const id of g.genreIds) add(`g:${id}`, 0.5 * GENRE_FACTOR);
    for (const id of g.tagIds) add(`t:${id}`, 0.5 * TAG_FACTOR);
  }
  return weights;
}

/** Bewertet ein Spiel anhand der Präferenzgewichte (normalisiert nach Merkmalsanzahl). */
export function scoreGame(weights: Map<string, number>, game: FeatureGame): number {
  const keys = [...game.genreIds.map((id) => `g:${id}`), ...game.tagIds.map((id) => `t:${id}`)];
  if (keys.length === 0) return 0;
  let sum = 0;
  for (const k of keys) sum += weights.get(k) ?? 0;
  return sum / Math.sqrt(keys.length);
}

/**
 * Sortiert Kandidaten nach Empfehlungswert; bei Gleichstand entscheidet die Popularität.
 * `jitter` (0–1) mischt Zufall bei, z. B. für die Entdeckungs-Queue.
 */
export function rankCandidates<T extends FeatureGame>(
  weights: Map<string, number>,
  candidates: T[],
  popularity: Map<string, number> = new Map(),
  jitter = 0,
  random: () => number = Math.random,
): T[] {
  const maxPop = Math.max(1, ...popularity.values());
  return candidates
    .map((g) => {
      const base = scoreGame(weights, g);
      const pop = (popularity.get(g.id) ?? 0) / maxPop;
      return { g, score: base + pop * 0.25 + (jitter > 0 ? random() * jitter * Math.max(1, base) : 0) };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.g);
}
