import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, deviceLogin, login, publishedGame, resetDb, type Client, type TestApp } from './helpers.js';

let t: TestApp;
let admin: Client;
let user: Client;

beforeEach(async () => {
  t ??= await createTestApp();
  await resetDb(t.app);
  await createUser(t.app, 'admin', 'ADMIN');
  await createUser(t.app, 'user');
  admin = await login(t.app, 'admin');
  user = await login(t.app, 'user');
});
afterAll(async () => t?.close());

async function catalog() {
  const rpg = await publishedGame(admin, 'Drachenwelt', { genres: ['RPG'], tags: ['Fantasy'], releaseDate: '2020-01-01', featured: true });
  const race = await publishedGame(admin, 'Turbo Racer', { genres: ['Racing'], tags: ['Cars'], releaseDate: '2023-05-05' });
  const rpg2 = await publishedGame(admin, 'Drachenwelt II', { genres: ['RPG'], tags: ['Fantasy', 'Open World'], releaseDate: '2024-01-01' });
  const puzzle = await publishedGame(admin, 'Klötzchen', { genres: ['Puzzle'], tags: [] });
  return { rpg, race, rpg2, puzzle };
}

describe('Store', () => {
  it('Startseite enthält Featured, Neuzugänge und Ankündigungen', async () => {
    await catalog();
    await admin.req('POST', '/api/admin/announcements', { title: 'Hallo', body: '**Neu**' });
    const home = (await user.req('GET', '/api/store/home')).json();
    expect(home.featured.map((g: { title: string }) => g.title)).toEqual(['Drachenwelt']);
    expect(home.newReleases).toHaveLength(4);
    expect(home.popular.length).toBeGreaterThan(0);
    expect(home.announcements[0].title).toBe('Hallo');
    expect(home.newReleases[0].platforms).toEqual(['LINUX']);
  });

  it('Suche mit Text, Genre-, Tag- und Plattformfilter sowie Sortierung', async () => {
    await catalog();
    const q = (qs: string) => user.req('GET', `/api/store/search?${qs}`).then((r) => r.json());
    expect((await q('q=drachen')).items.map((g: { title: string }) => g.title)).toEqual(['Drachenwelt', 'Drachenwelt II']);
    expect((await q('genres=rpg')).total).toBe(2);
    expect((await q('tags=open-world')).total).toBe(1);
    expect((await q('platforms=WINDOWS')).total).toBe(0);
    expect((await q('platforms=LINUX')).total).toBe(4);
    expect((await q('sort=release')).items[0].title).toBe('Drachenwelt II');
    expect((await q('sort=title&pageSize=2&page=2')).items.map((g: { title: string }) => g.title)).toEqual(['Klötzchen', 'Turbo Racer']);
    const facets = (await user.req('GET', '/api/store/facets')).json();
    expect(facets.genres.find((g: { slug: string }) => g.slug === 'rpg').count).toBe(2);
  });

  it('Anonymer Zugriff hängt von storePublic ab', async () => {
    await catalog();
    expect((await t.app.inject({ method: 'GET', url: '/api/store/home' })).statusCode).toBe(200);
    await t.app.ctx.settings.update({ storePublic: false });
    expect((await t.app.inject({ method: 'GET', url: '/api/store/home' })).statusCode).toBe(401);
    expect((await user.req('GET', '/api/store/home')).statusCode).toBe(200);
  });

  it('Empfehlungen basieren auf der Spielzeit', async () => {
    const { rpg, race } = await catalog();
    await user.req('PUT', `/api/library/${rpg.gameId}`);
    await user.req('PUT', `/api/library/${race.gameId}`);
    await user.req('POST', `/api/library/${rpg.gameId}/playtime`, { seconds: 20 * 3600 });
    await user.req('POST', `/api/library/${race.gameId}/playtime`, { seconds: 60 });
    const recs = (await user.req('GET', '/api/store/recommendations')).json();
    expect(recs[0].title).toBe('Drachenwelt II');
    // bereits besessene Spiele werden nicht empfohlen
    expect(recs.map((g: { id: string }) => g.id)).not.toContain(rpg.gameId);
    const similar = (await user.req('GET', `/api/store/games/${rpg.gameId}/similar`)).json();
    expect(similar[0].title).toBe('Drachenwelt II');
  });

  it('Entdeckungs-Queue: Spiele werden nach Aktion nicht erneut gezeigt', async () => {
    const { rpg, race } = await catalog();
    const queue = (await user.req('GET', '/api/store/discovery')).json();
    expect(queue).toHaveLength(4);
    await user.req('POST', `/api/store/discovery/${rpg.gameId}`, { action: 'SKIPPED' });
    await user.req('POST', `/api/store/discovery/${race.gameId}`, { action: 'WISHLISTED' });
    const next = (await user.req('GET', '/api/store/discovery')).json();
    expect(next.map((g: { id: string }) => g.id)).not.toContain(rpg.gameId);
    expect(next.map((g: { id: string }) => g.id)).not.toContain(race.gameId);
    expect((await user.req('GET', '/api/library/wishlist')).json()[0].id).toBe(race.gameId);
    await user.req('DELETE', '/api/store/discovery');
    expect((await user.req('GET', '/api/store/discovery')).json()).toHaveLength(3); // Wunschliste bleibt ausgeschlossen
  });

  it('Spieldetails enthalten Bibliotheks- und Wunschlistenstatus', async () => {
    const { rpg } = await catalog();
    await user.req('PUT', `/api/library/wishlist/${rpg.gameId}`);
    let d = (await user.req('GET', `/api/store/games/drachenwelt`)).json();
    expect(d.inWishlist).toBe(true);
    expect(d.latestVersion.version).toBe('1.0.0');
    expect(d.latestVersion.builds[0].executable).toBe('bin/game');
    expect(d.canEdit).toBe(false);
    await user.req('PUT', `/api/library/${rpg.gameId}`);
    d = (await user.req('GET', `/api/store/games/drachenwelt`)).json();
    expect(d.inLibrary).toBe(true);
    expect(d.inWishlist).toBe(false); // beim Hinzufügen von der Wunschliste entfernt
    expect(d.libraryCount).toBe(1);
  });
});

describe('Bibliothek', () => {
  it('Favoriten, Spielzeit, Sortierung, Ausblenden', async () => {
    const { rpg, race, puzzle } = await catalog();
    for (const g of [rpg, race, puzzle]) await user.req('PUT', `/api/library/${g.gameId}`);
    // Spielzeit vom Desktop-Client (Device-Token)
    const token = await deviceLogin(t.app, 'user');
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/library/${race.gameId}/playtime`,
      headers: { authorization: `Bearer ${token}` },
      payload: { seconds: 3600 },
    });
    expect(res.json().playtimeSeconds).toBe(3600);
    expect(
      (await t.app.inject({
        method: 'POST',
        url: `/api/library/${race.gameId}/playtime`,
        headers: { authorization: `Bearer ${token}` },
        payload: { seconds: 999999 },
      })).statusCode,
    ).toBe(400);
    await user.req('PATCH', `/api/library/${puzzle.gameId}`, { favorite: true });
    await user.req('PATCH', `/api/library/${rpg.gameId}`, { hidden: true });

    const byTitle = (await user.req('GET', '/api/library')).json();
    expect(byTitle.map((e: { game: { title: string } }) => e.game.title)).toEqual(['Klötzchen', 'Turbo Racer']);
    const byPlaytime = (await user.req('GET', '/api/library?sort=playtime')).json();
    expect(byPlaytime[0].game.title).toBe('Turbo Racer');
    expect(byPlaytime[0].lastPlayedAt).not.toBeNull();
    const favs = (await user.req('GET', '/api/library?favorites=true')).json();
    expect(favs.map((e: { game: { title: string } }) => e.game.title)).toEqual(['Klötzchen']);
    const hidden = (await user.req('GET', '/api/library?hidden=true')).json();
    expect(hidden.map((e: { game: { title: string } }) => e.game.title)).toEqual(['Drachenwelt']);
  });

  it('Sammlungen', async () => {
    const { rpg, rpg2, race } = await catalog();
    await user.req('PUT', `/api/library/${rpg.gameId}`);
    await user.req('PUT', `/api/library/${rpg2.gameId}`);
    const col = (await user.req('POST', '/api/library/collections', { name: 'Rollenspiele' })).json();
    expect((await user.req('PUT', `/api/library/collections/${col.id}/games/${race.gameId}`)).json().error).toBe('not_in_library');
    await user.req('PUT', `/api/library/collections/${col.id}/games/${rpg.gameId}`);
    const updated = (await user.req('PUT', `/api/library/collections/${col.id}/games/${rpg2.gameId}`)).json();
    expect(updated.gameIds).toHaveLength(2);
    const filtered = (await user.req('GET', `/api/library?collection=${col.id}`)).json();
    expect(filtered).toHaveLength(2);
    expect(filtered[0].collectionIds).toEqual([col.id]);
    expect((await user.req('POST', '/api/library/collections', { name: 'Rollenspiele' })).statusCode).toBe(409);
    // fremde Sammlungen sind nicht zugreifbar
    const other = await login(t.app, 'admin');
    expect((await other.req('DELETE', `/api/library/collections/${col.id}`)).statusCode).toBe(404);
    await user.req('DELETE', `/api/library/${rpg.gameId}`);
    expect((await user.req('GET', '/api/library/collections')).json()[0].gameIds).toEqual([rpg2.gameId]);
  });

  it('Spiele ohne Zugriff können nicht hinzugefügt werden', async () => {
    const game = (await admin.req('POST', '/api/manage/games', { title: 'Geheim' })).json();
    expect((await user.req('PUT', `/api/library/${game.id}`)).statusCode).toBe(404);
  });
});
