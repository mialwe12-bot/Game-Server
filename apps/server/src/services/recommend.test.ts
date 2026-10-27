import { describe, expect, it } from 'vitest';
import { preferenceWeights, rankCandidates, scoreGame } from './recommend.js';

describe('Empfehlungen', () => {
  const played = [
    { id: 'a', genreIds: ['rpg'], tagIds: ['fantasy'], playtimeSeconds: 50 * 3600 },
    { id: 'b', genreIds: ['racing'], tagIds: ['cars'], playtimeSeconds: 600 },
  ];

  it('gewichtet viel gespielte Genres stärker', () => {
    const w = preferenceWeights(played);
    expect(w.get('g:rpg')!).toBeGreaterThan(w.get('g:racing')!);
    expect(w.get('t:fantasy')!).toBeLessThan(w.get('g:rpg')!);
  });

  it('Favoriten und Wunschliste erhöhen das Gewicht', () => {
    const base = preferenceWeights([{ ...played[1] }]).get('g:racing')!;
    const fav = preferenceWeights([{ ...played[1], favorite: true }]).get('g:racing')!;
    expect(fav).toBeGreaterThan(base);
    const wish = preferenceWeights([], [{ id: 'w', genreIds: ['puzzle'], tagIds: [] }]);
    expect(wish.get('g:puzzle')).toBeGreaterThan(0);
  });

  it('rankt passende Spiele nach oben', () => {
    const w = preferenceWeights(played);
    const candidates = [
      { id: 'c1', genreIds: ['racing'], tagIds: [] },
      { id: 'c2', genreIds: ['rpg'], tagIds: ['fantasy'] },
      { id: 'c3', genreIds: ['sports'], tagIds: [] },
    ];
    expect(rankCandidates(w, candidates).map((c) => c.id)).toEqual(['c2', 'c1', 'c3']);
    expect(scoreGame(w, { id: 'x', genreIds: [], tagIds: [] })).toBe(0);
  });

  it('nutzt Popularität als Tie-Breaker', () => {
    const candidates = [
      { id: 'p1', genreIds: [], tagIds: [] },
      { id: 'p2', genreIds: [], tagIds: [] },
    ];
    const ranked = rankCandidates(new Map(), candidates, new Map([['p2', 10]]));
    expect(ranked[0].id).toBe('p2');
  });
});
