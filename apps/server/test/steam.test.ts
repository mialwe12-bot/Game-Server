import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { contentHash } from '../src/routes/cloud.js';
import { generateCode, normalizeCode } from '../src/routes/gifts.js';
import { weekStart } from '../src/routes/stats.js';
import { levelCost, maxDrops, profileLevel } from '../src/services/cards.js';
import { createTestApp, createUser, login, publishedGame, resetDb, type Client, type TestApp } from './helpers.js';

/** Leeres, gültiges ZIP-Archiv (End-of-Central-Directory) */
const EMPTY_ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]);
const zipWith = (n: number) => Buffer.concat([EMPTY_ZIP, Buffer.alloc(n)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const sha = (c: string) => c.repeat(64);

function multipart(fields: Record<string, string>, file: { name: string; data: Buffer; type?: string }) {
  const boundary = '----gssteam';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type ?? 'application/zip'}\r\n\r\n`));
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

let t: TestApp;
let admin: Client;
let bob: Client;
let carol: Client;
let gameId: string;

async function befriend(a: Client, b: Client, bName: string) {
  await a.req('POST', '/api/friends/requests', { username: bName });
  const req = (await b.req('GET', '/api/friends')).json().incoming[0];
  await b.req('POST', `/api/friends/requests/${req.id}/accept`);
}

beforeEach(async () => {
  if (!t) t = await createTestApp();
  else await resetDb(t.app);
  await createUser(t.app, 'admin', 'ADMIN');
  await createUser(t.app, 'bob');
  await createUser(t.app, 'carol');
  admin = await login(t.app, 'admin');
  bob = await login(t.app, 'bob');
  carol = await login(t.app, 'carol');
  gameId = (await publishedGame(admin, 'Steamig')).gameId;
});

afterAll(async () => {
  await t?.close();
});

describe('Hilfsfunktionen', () => {
  it('Profil-Level, Drops, Codes, Wochen, Inhalts-Hash', () => {
    expect(levelCost(0)).toBe(100);
    expect(levelCost(10)).toBe(200);
    expect(profileLevel(0)).toEqual({ level: 0, xp: 0, levelXp: 0, nextLevelXp: 100 });
    expect(profileLevel(250).level).toBe(2);
    expect(profileLevel(1000).level).toBe(10);
    expect(profileLevel(1199).level).toBe(10);
    expect(profileLevel(1200).level).toBe(11);
    expect(maxDrops(5)).toBe(3);
    expect(generateCode()).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(normalizeCode('abcde fghjk-mnpqr')).toBe('ABCDE-FGHJK-MNPQR');
    expect(weekStart(new Date(2026, 9, 29, 15)).getDay()).toBe(1);
    const m = [
      { root: 0, path: 'a.sav', size: 1, sha256: sha('a'), mtime: 1 },
      { root: 1, path: 'b.sav', size: 1, sha256: sha('b'), mtime: 2 },
    ];
    expect(contentHash(m)).toBe(contentHash([{ ...m[1], mtime: 99 }, m[0]]));
    expect(contentHash(m)).not.toBe(contentHash([m[0]]));
  });
});

describe('Cloud-Saves', () => {
  const upload = (c: Client, query: string, manifest: unknown[], data = EMPTY_ZIP) => {
    const m = multipart({ manifest: JSON.stringify(manifest) }, { name: 'save.zip', data });
    return c.req('POST', `/api/cloud/${gameId}?${query}`, m.payload, m.headers);
  };
  const file = (hash: string) => ({ root: 0, path: 'slot1.sav', size: 10, sha256: sha(hash), mtime: Date.now() });

  it('Versionierung, unverändert, Konflikt, Erzwingen, Download, Wiederherstellen', async () => {
    await admin.req('PATCH', `/api/manage/games/${gameId}`, { savePaths: [{ platform: 'ANY', path: '{install}/saves' }] });
    const first = await upload(bob, 'baseVersion=0&deviceName=PC', [file('a')]);
    expect(first.statusCode).toBe(200);
    expect(first.json().save.version).toBe(1);
    // Gleicher Inhalt → keine neue Version
    expect((await upload(bob, 'baseVersion=1', [file('a')])).json().unchanged).toBe(true);
    // Neue Version auf Basis 1
    expect((await upload(bob, 'baseVersion=1&deviceName=Laptop', [file('b')])).json().save.version).toBe(2);
    // Zweites Gerät kennt nur Version 1 → Konflikt
    const conflict = await upload(bob, 'baseVersion=1', [file('c')]);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().details.latest.version).toBe(2);
    expect((await upload(bob, 'baseVersion=1&force=true', [file('c')])).json().save.version).toBe(3);

    const status = (await bob.req('GET', `/api/cloud/${gameId}`)).json();
    expect(status.savePaths[0].path).toBe('{install}/saves');
    expect(status.latest.manifest[0].sha256).toBe(sha('c'));
    expect(status.versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);

    const dl = await bob.req('GET', `/api/cloud/${gameId}/versions/1/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.equals(EMPTY_ZIP)).toBe(true);
    expect((await carol.req('GET', `/api/cloud/${gameId}/versions/1/download`)).statusCode).toBe(404);

    const restored = (await bob.req('POST', `/api/cloud/${gameId}/versions/1/restore`)).json();
    expect(restored.version).toBe(4);
    expect(restored.contentHash).toBe(contentHash([file('a')]));
    expect((await bob.req('GET', '/api/cloud')).json()[0].versions).toBe(4);
  });

  it('alte Versionen werden entfernt, Kontingent und ungültige Daten', async () => {
    await admin.req('PATCH', '/api/admin/settings', { cloudSaveVersions: 2, cloudQuotaBytes: 1000 });
    for (const h of ['a', 'b', 'c']) await upload(bob, 'baseVersion=99', [file(h)]);
    expect((await bob.req('GET', `/api/cloud/${gameId}`)).json().versions.map((v: { version: number }) => v.version)).toEqual([3, 2]);
    expect((await upload(bob, 'baseVersion=99', [file('d')], zipWith(2000))).statusCode).toBe(413);
    expect((await upload(bob, 'baseVersion=99', [file('e')], Buffer.from('kein zip'))).json().error).toBe('invalid_archive');
    expect((await upload(bob, 'baseVersion=99', [{ ...file('f'), path: '../evil' }])).json().error).toBe('invalid_manifest');
    await admin.req('PATCH', '/api/admin/settings', { cloudSavesEnabled: false });
    expect((await upload(bob, 'baseVersion=99', [file('g')])).json().error).toBe('cloud_disabled');
  });
});

describe('Achievements & SDK', () => {
  it('Verwaltung, Spielstart-Token, SDK-Freischaltung, Fortschritt, Seltenheit, versteckt', async () => {
    const base = `/api/achievements/manage/${gameId}`;
    expect((await bob.req('POST', base, { apiName: 'X', name: 'X' })).statusCode).toBe(403);
    await admin.req('POST', base, { apiName: 'FIRST_STEP', name: 'Erster Schritt', description: 'Starte das Spiel' });
    await admin.req('POST', base, { apiName: 'COLLECTOR', name: 'Sammler', progressMax: 10 });
    await admin.req('POST', base, { apiName: 'SECRET', name: 'Geheim', hidden: true });
    const bad = await admin.req('POST', base, { apiName: 'LOG', name: 'Log', detection: { type: 'log_regex', path: '{install}/log.txt' } });
    expect(bad.statusCode).toBe(400);
    const list = (await admin.req('POST', base, { apiName: 'LOG', name: 'Log', detection: { type: 'log_regex', path: '{install}/log.txt', pattern: 'BOSS (DEFEATED|KILLED)' } })).json();
    expect(list).toHaveLength(4);
    const icon = multipart({}, { name: 'i.png', data: PNG, type: 'image/png' });
    expect((await admin.req('POST', `${base}/${list[0].id}/icon`, icon.payload, icon.headers)).json()[0].iconUrl).toMatch(/^\/api\/files\//);

    // Spielstart ohne Bibliothekseintrag nicht möglich
    expect((await bob.req('POST', `/api/play/${gameId}/start`)).json().error).toBe('not_in_library');
    await bob.req('PUT', `/api/library/${gameId}`);
    await carol.req('PUT', `/api/library/${gameId}`);
    const start = (await bob.req('POST', `/api/play/${gameId}/start`)).json();
    expect(start.gameToken.token).toMatch(/^gsg_/);
    expect(start.detection).toEqual([{ apiName: 'LOG', detection: { type: 'log_regex', path: '{install}/log.txt', pattern: 'BOSS (DEFEATED|KILLED)' } }]);
    expect(start.parental.restricted).toBe(false);
    const sdk = (method: string, url: string, body?: unknown) =>
      t.app.inject({ method: method as never, url, payload: body as never, headers: { authorization: `Bearer ${start.gameToken.token}` } });

    expect((await sdk('GET', '/api/sdk/me')).json()).toMatchObject({ user: { username: 'bob' }, game: { id: gameId } });
    // Das Token gilt nicht für normale API-Routen
    expect((await sdk('GET', '/api/library')).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/api/sdk/me', headers: { authorization: 'Bearer gsg_falsch' } })).statusCode).toBe(401);

    const unlock = (await sdk('POST', '/api/sdk/achievements/FIRST_STEP/unlock')).json();
    expect(unlock).toMatchObject({ newlyUnlocked: true, achievement: { unlocked: true, rarity: 50 } });
    expect((await sdk('POST', '/api/sdk/achievements/FIRST_STEP/unlock')).json().newlyUnlocked).toBe(false);
    expect((await sdk('POST', '/api/sdk/achievements/NOPE/unlock')).statusCode).toBe(404);
    const p1 = (await sdk('POST', '/api/sdk/achievements/COLLECTOR/progress', { progress: 4 })).json();
    expect(p1).toMatchObject({ newlyUnlocked: false, achievement: { progress: 4, unlocked: false } });
    // Fortschritt sinkt nicht
    expect((await sdk('POST', '/api/sdk/achievements/COLLECTOR/progress', { progress: 2 })).json().achievement.progress).toBe(4);
    expect((await sdk('POST', '/api/sdk/achievements/COLLECTOR/progress', { progress: 12 })).json()).toMatchObject({ newlyUnlocked: true, achievement: { progress: 10 } });

    // Versteckte Achievements sind für andere maskiert, das SDK sieht sie
    const carolView = (await carol.req('GET', `/api/achievements/games/${gameId}`)).json();
    const secret = carolView.achievements.find((a: { hidden: boolean }) => a.hidden);
    expect(secret).toMatchObject({ name: '', apiName: '', iconUrl: null });
    expect((await sdk('GET', '/api/sdk/achievements')).json().find((a: { apiName: string }) => a.apiName === 'SECRET').name).toBe('Geheim');

    // Erkennung per Client nur bei hinterlegter Regel
    expect((await bob.req('POST', '/api/achievements/detect', { gameId, apiName: 'SECRET' })).json().error).toBe('no_detection');
    expect((await bob.req('POST', '/api/achievements/detect', { gameId, apiName: 'LOG' })).json().newlyUnlocked).toBe(true);

    const bobView = (await bob.req('GET', `/api/achievements/games/${gameId}`)).json();
    expect(bobView).toMatchObject({ total: 4, unlocked: 3 });
    const userView = (await carol.req('GET', '/api/achievements/users/bob')).json();
    expect(userView[0]).toMatchObject({ unlocked: 3, total: 4 });
    // XP fürs Profil-Level
    expect((await carol.req('GET', '/api/profiles/bob')).json()).toMatchObject({ achievementCount: 3, level: { xp: 15 } });
    // Support: entziehen
    const logId = list.find((a: { apiName: string }) => a.apiName === 'LOG').id;
    expect((await admin.req('DELETE', `${base}/${logId}/users/bob`)).statusCode).toBe(200);
  });
});

describe('Workshop', () => {
  it('Inhalt, Versionen, Abos, Bewertung, Kommentare, Moderation', async () => {
    const create = () => bob.req('POST', `/api/workshop/games/${gameId}`, { title: 'Neue Karte', kind: 'MAP', tags: ['Koop'] });
    expect((await create()).json().error).toBe('workshop_not_configured');
    await admin.req('PATCH', `/api/manage/games/${gameId}`, { workshopPath: 'mods' });
    expect((await admin.req('PATCH', `/api/manage/games/${gameId}`, { workshopPath: '../etc' })).statusCode).toBe(400);
    const item = (await create()).json();
    expect(item).toMatchObject({ title: 'Neue Karte', kind: 'MAP', tags: ['koop'], latestVersion: null, canEdit: true });

    const up = (version: string, data = EMPTY_ZIP, c = bob) => {
      const m = multipart({}, { name: 'karte.zip', data });
      return c.req('POST', `/api/workshop/items/${item.id}/versions?version=${version}&changelog=Erste`, m.payload, m.headers);
    };
    expect((await up('1.0', Buffer.from('nope'))).json().error).toBe('invalid_archive');
    expect((await up('1.0', EMPTY_ZIP, carol)).statusCode).toBe(403);
    const v1 = (await up('1.0')).json();
    expect(v1).toMatchObject({ version: '1.0', size: EMPTY_ZIP.length });
    expect((await up('1.0')).json().error).toBe('version_exists');
    await up('1.1');

    // Abo → Client-Liste
    await carol.req('PUT', `/api/workshop/items/${item.id}/subscription`);
    const subs = (await carol.req('GET', '/api/workshop/subscriptions')).json();
    expect(subs).toEqual([expect.objectContaining({ itemId: item.id, workshopPath: 'mods', version: expect.objectContaining({ version: '1.1' }) })]);
    const dl = await carol.req('GET', subs[0].version.downloadUrl);
    expect(dl.statusCode).toBe(200);

    expect((await bob.req('PUT', `/api/workshop/items/${item.id}/rating`, { up: true })).json().error).toBe('own_item');
    expect((await carol.req('PUT', `/api/workshop/items/${item.id}/rating`, { up: true })).json()).toMatchObject({ up: 1, myRating: true, subscribers: 1 });
    await carol.req('POST', `/api/workshop/items/${item.id}/comments`, { body: 'Super Karte!' });
    expect((await bob.req('GET', '/api/notifications')).json().items[0].type).toBe('workshop.comment');
    expect((await bob.req('GET', `/api/workshop/items/${item.id}`)).json().versions).toHaveLength(2);

    const listed = (await carol.req('GET', `/api/workshop/games/${gameId}?sort=rating`)).json();
    expect(listed).toMatchObject({ total: 1, enabled: true });

    // Moderation durch Maintainer/Admin
    await admin.req('POST', `/api/workshop/items/${item.id}/moderate`, { hidden: true });
    expect((await carol.req('GET', `/api/workshop/items/${item.id}`)).statusCode).toBe(404);
    expect((await carol.req('GET', '/api/workshop/subscriptions')).json()).toHaveLength(0);
    expect((await bob.req('GET', `/api/workshop/items/${item.id}`)).statusCode).toBe(200);
  });
});

describe('Sammelkarten, Abzeichen, Tausch, Marktplatz', () => {
  it('Drops nach Spielzeit, Abzeichen herstellen, Tausch und Marktplatz', async () => {
    await admin.req('PATCH', '/api/admin/settings', { cardDropMinutes: 1 });
    let cards = [];
    for (const name of ['Held', 'Drache', 'Burg', 'Schatz']) cards = (await admin.req('POST', `/api/cards/manage/${gameId}`, { name })).json();
    expect(cards).toHaveLength(4);
    await bob.req('PUT', `/api/library/${gameId}`);
    await carol.req('PUT', `/api/library/${gameId}`);
    const play = (c: Client, seconds: number) => c.req('POST', `/api/library/${gameId}/playtime`, { seconds });
    // 4 Karten → max. 2 Drops
    expect((await play(bob, 600)).json().cardDrops).toBe(2);
    expect((await play(bob, 600)).json().cardDrops).toBe(0);
    expect((await bob.req('GET', '/api/notifications')).json().items[0].type).toBe('card.drop');
    const inv = (await bob.req('GET', '/api/cards/inventory')).json();
    expect(inv.items).toHaveLength(2);
    expect(inv.sets[0]).toMatchObject({ drops: { received: 2, max: 2, nextInSeconds: null }, badgeLevel: 0, canCraft: false });

    // Fehlende Karten gezielt geben (Admin-Hilfe über die DB), dann Abzeichen herstellen
    const db = t.app.ctx.db;
    const bobId = bob.userId;
    for (const c of cards) await db.cardItem.create({ data: { ownerId: bobId, cardId: c.id, source: 'admin' } });
    const craft = (await bob.req('POST', `/api/cards/badges/${gameId}/craft`)).json();
    expect(craft).toMatchObject({ level: 1, profile: { xp: 100, level: 1 } });
    expect((await bob.req('POST', `/api/cards/badges/${gameId}/craft`)).json().error).toBe('incomplete_set');
    expect((await carol.req('GET', '/api/cards/users/bob/badges')).json().badges[0]).toMatchObject({ level: 1 });

    // Tausch
    const bobItems = (await bob.req('GET', '/api/cards/inventory')).json().items;
    expect(bobItems).toHaveLength(2);
    await carol.req('POST', `/api/library/${gameId}/playtime`, { seconds: 120 });
    const carolItems = (await carol.req('GET', '/api/cards/inventory')).json().items;
    expect(carolItems).toHaveLength(2);
    const offer = (
      await bob.req('POST', '/api/cards/trades', { toUserId: carol.userId, give: [bobItems[0].id], receive: [carolItems[0].id], message: 'Tausch?' })
    ).json();
    expect(offer).toMatchObject({ status: 'PENDING', direction: 'outgoing' });
    expect((await bob.req('GET', '/api/cards/inventory')).json().items.find((i: { id: string }) => i.id === bobItems[0].id).locked).toBe(true);
    expect((await bob.req('POST', `/api/cards/trades/${offer.id}/accept`)).statusCode).toBe(403);
    expect((await carol.req('POST', `/api/cards/trades/${offer.id}/accept`)).json().status).toBe('ACCEPTED');
    expect((await carol.req('GET', '/api/cards/inventory')).json().items.some((i: { id: string }) => i.id === bobItems[0].id)).toBe(true);
    expect((await bob.req('GET', '/api/notifications')).json().items[0].type).toBe('trade.accepted');

    // Marktplatz: Bob bietet eine Karte an und sucht die Karte, die Carol besitzt
    const bobNow = (await bob.req('GET', '/api/cards/inventory')).json().items;
    const carolNow = (await carol.req('GET', '/api/cards/inventory')).json().items;
    const wantCardId = carolNow.find((i: { card: { id: string } }) => i.card.id !== bobNow[0].card.id)?.card.id ?? carolNow[0].card.id;
    const listing = (await bob.req('POST', '/api/cards/market', { itemId: bobNow[0].id, wantCardId })).json();
    const market = (await carol.req('GET', '/api/cards/market?fulfillable=true')).json();
    expect(market.map((l: { id: string }) => l.id)).toContain(listing.id);
    expect((await carol.req('POST', `/api/cards/market/${listing.id}/fulfil`)).json().ok).toBe(true);
    expect((await carol.req('POST', `/api/cards/market/${listing.id}/fulfil`)).statusCode).toBe(404);
    expect((await carol.req('GET', '/api/cards/inventory')).json().items.some((i: { id: string }) => i.id === bobNow[0].id)).toBe(true);
    expect((await bob.req('GET', '/api/notifications')).json().items[0].type).toBe('market.completed');

    await admin.req('PATCH', '/api/admin/settings', { marketEnabled: false });
    expect((await bob.req('GET', '/api/cards/trades')).json().error).toBe('market_disabled');
    await admin.req('PATCH', '/api/admin/settings', { cardsEnabled: false });
    expect((await bob.req('GET', '/api/cards/inventory')).json().error).toBe('cards_disabled');
    expect((await play(bob, 600)).json().cardDrops).toBe(0);
  });
});

describe('Familie, Kindersicherung, Geschenke, Codes', () => {
  it('Familie mit Kinderkonto: Altersfreigabe, Spielzeitlimit, Chat-Sperre, Familienbibliothek', async () => {
    const adult = await createUser(t.app, 'mama');
    await createUser(t.app, 'kind');
    const mama = await login(t.app, 'mama');
    const kind = await login(t.app, 'kind');
    const fam = (await mama.req('POST', '/api/family', { name: 'Familie Muster' })).json();
    expect(fam.myRole).toBe('ADULT');
    await mama.req('POST', '/api/family/invites', { username: 'kind', role: 'CHILD' });
    const inv = (await kind.req('GET', '/api/family/invites')).json();
    expect(inv[0]).toMatchObject({ role: 'CHILD', family: { name: 'Familie Muster' } });
    expect((await kind.req('POST', `/api/family/invites/${inv[0].id}/accept`)).json().members).toHaveLength(2);
    // Kinder können die Familie nicht verlassen
    expect((await kind.req('DELETE', `/api/family/members/${kind.userId}`)).json().error).toBe('not_adult');

    const adultGame = (await publishedGame(admin, 'Ab 18')).gameId;
    await admin.req('PATCH', `/api/manage/games/${adultGame}`, { ageRating: 18 });
    await mama.req('PATCH', `/api/family/members/${kind.userId}`, { maxAgeRating: 12, dailyMinutes: 1, chatAllowed: false });
    const search = (await kind.req('GET', '/api/store/search')).json();
    expect(search.items.map((g: { id: string }) => g.id)).not.toContain(adultGame);
    expect((await kind.req('GET', `/api/store/games/${adultGame}`)).statusCode).toBe(403);
    expect((await kind.req('PUT', `/api/library/${adultGame}`)).statusCode).toBe(404);
    expect((await mama.req('GET', `/api/store/games/${adultGame}`)).statusCode).toBe(200);

    // Spielzeitlimit (1 Minute)
    await kind.req('PUT', `/api/library/${gameId}`);
    expect((await kind.req('POST', `/api/play/${gameId}/start`)).json().parental).toMatchObject({ restricted: true, remainingSeconds: 60, chatAllowed: false });
    await kind.req('POST', `/api/library/${gameId}/playtime`, { seconds: 90 });
    expect((await kind.req('POST', `/api/play/${gameId}/start`)).json().error).toBe('playtime_limit');
    expect((await kind.req('GET', '/api/me/parental')).json()).toMatchObject({ remainingSeconds: 0, playedTodaySeconds: 90 });

    // Chat gesperrt
    await befriend(kind, bob, 'bob');
    expect((await kind.req('POST', '/api/chat/direct', { userId: bob.userId })).json().error).toBe('parental_chat');

    // Familienbibliothek: eingeschränktes Spiel, auf das Mama Zugriff hat
    const restricted = (await publishedGame(admin, 'Beta')).gameId;
    await admin.req('PATCH', `/api/manage/games/${restricted}`, { visibility: 'RESTRICTED' });
    await admin.req('POST', `/api/manage/games/${restricted}/access`, { username: 'mama' });
    await mama.req('PUT', `/api/library/${restricted}`);
    const famLib = (await kind.req('GET', '/api/family/library')).json();
    expect(famLib).toEqual([expect.objectContaining({ game: expect.objectContaining({ id: restricted }), inMyLibrary: false })]);
    expect((await kind.req('GET', `/api/store/games/${restricted}`)).statusCode).toBe(200);
    expect((await bob.req('GET', `/api/store/games/${restricted}`)).statusCode).toBe(403);
    expect(adult.id).toBeTruthy();
  });

  it('Geschenke nur an Freunde, Annahme legt das Spiel in die Bibliothek', async () => {
    expect((await bob.req('POST', '/api/gifts', { gameId, toUserId: carol.userId })).json().error).toBe('not_friends');
    await befriend(bob, carol, 'carol');
    const gift = (await bob.req('POST', '/api/gifts', { gameId, toUserId: carol.userId, message: 'Viel Spaß!' })).json();
    expect(gift).toMatchObject({ opened: false, message: 'Viel Spaß!' });
    expect((await bob.req('POST', '/api/gifts', { gameId, toUserId: carol.userId })).json().error).toBe('already_gifted');
    expect((await carol.req('GET', '/api/notifications')).json().items[0].type).toBe('gift.received');
    const received = (await carol.req('GET', '/api/gifts')).json().received;
    expect(received).toHaveLength(1);
    await carol.req('POST', `/api/gifts/${gift.id}/accept`);
    expect((await carol.req('GET', '/api/library')).json().map((e: { game: { id: string } }) => e.game.id)).toContain(gameId);
    expect((await bob.req('POST', '/api/gifts', { gameId, toUserId: carol.userId })).json().error).toBe('already_owned');
  });

  it('Aktivierungscodes: erzeugen, einlösen, Mehrfachnutzung, sperren, CSV', async () => {
    const beta = (await publishedGame(admin, 'Geheimprojekt')).gameId;
    await admin.req('PATCH', `/api/manage/games/${beta}`, { visibility: 'RESTRICTED' });
    const codes = (await admin.req('POST', `/api/codes/manage/${beta}`, { count: 3, batch: 'Presse', maxUses: 1 })).json();
    expect(codes).toHaveLength(3);
    expect((await bob.req('GET', `/api/store/games/${beta}`)).statusCode).toBe(403);
    const redeemed = (await bob.req('POST', '/api/codes/redeem', { code: codes[0].code.toLowerCase().replace(/-/g, ' ') })).json();
    expect(redeemed.game.id).toBe(beta);
    expect((await bob.req('GET', `/api/store/games/${beta}`)).json().inLibrary).toBe(true);
    expect((await carol.req('POST', '/api/codes/redeem', { code: codes[0].code })).json().error).toBe('code_used');
    await admin.req('PATCH', `/api/codes/manage/${beta}/${codes[1].id}`, { revoked: true });
    expect((await carol.req('POST', '/api/codes/redeem', { code: codes[1].code })).json().error).toBe('invalid_code');
    expect((await carol.req('POST', '/api/codes/redeem', { code: 'AAAAA-BBBBB-CCCCC' })).statusCode).toBe(404);
    const csv = await admin.req('GET', `/api/codes/manage/${beta}/export`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.trim().split('\n')).toHaveLength(4);
    expect((await bob.req('POST', `/api/codes/manage/${beta}`, { count: 1 })).statusCode).toBe(403);
  });
});

describe('Statistiken, Geräte, Notizen', () => {
  it('Spielzeit pro Woche, Jahresrückblick, Top-Listen', async () => {
    await bob.req('PUT', `/api/library/${gameId}`);
    await bob.req('POST', `/api/library/${gameId}/playtime`, { seconds: 3600 });
    await bob.req('POST', `/api/library/${gameId}/playtime`, { seconds: 1800 });
    const stats = (await bob.req('GET', '/api/stats/me?weeks=4')).json();
    expect(stats.totalSeconds).toBe(5400);
    expect(stats.weeks).toHaveLength(4);
    expect(stats.weeks[3].seconds).toBe(5400);
    expect(stats.games[0]).toMatchObject({ seconds: 5400, sessions: 2, recentSeconds: 5400 });

    const year = new Date().getFullYear();
    const review = (await bob.req('GET', `/api/stats/me/year/${year}`)).json();
    expect(review).toMatchObject({ year, totalSeconds: 5400, sessions: 2, gamesPlayed: 1, newGames: 1, longestSession: { seconds: 3600 } });
    expect(review.months.reduce((a: number, b: number) => a + b, 0)).toBe(5400);

    await bob.req('PATCH', '/api/me/profile', { visibility: 'PRIVATE' });
    expect((await carol.req('GET', `/api/stats/users/bob/year/${year}`)).statusCode).toBe(403);

    const top = (await carol.req('GET', '/api/stats/top?period=week')).json();
    expect(top.mostPlayed[0]).toMatchObject({ game: { id: gameId }, seconds: 5400, players: 1 });
    expect(top.mostOwned[0]).toMatchObject({ owners: 1 });
  });

  it('Geräteliste, Befehl an Offline-Gerät, Notizen', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'bob', password: 'correct-horse-battery', device: { name: 'Wohnzimmer-PC' } } });
    expect(res.statusCode).toBe(200);
    const devices = (await bob.req('GET', '/api/devices')).json();
    expect(devices).toEqual([expect.objectContaining({ name: 'Wohnzimmer-PC', online: false, current: false })]);
    expect((await bob.req('POST', `/api/devices/${devices[0].sessionId}/command`, { action: 'install', gameId })).json().error).toBe('device_offline');
    expect((await carol.req('POST', `/api/devices/${devices[0].sessionId}/command`, { action: 'install', gameId })).statusCode).toBe(404);

    expect((await bob.req('GET', `/api/notes/${gameId}`)).json()).toMatchObject({ body: '', updatedAt: null });
    await bob.req('PUT', `/api/notes/${gameId}`, { body: 'Code für die Tür: 4711' });
    expect((await bob.req('GET', `/api/notes/${gameId}`)).json().body).toBe('Code für die Tür: 4711');
    expect((await carol.req('GET', `/api/notes/${gameId}`)).json().body).toBe('');
  });

  it('öffentliche Einstellungen enthalten Feature-Schalter', async () => {
    await admin.req('PATCH', '/api/admin/settings', { discordAppId: '123456789', workshopEnabled: false });
    const pub = (await t.app.inject({ method: 'GET', url: '/api/settings/public' })).json();
    expect(pub.features).toMatchObject({ workshop: false, cloudSaves: true, cards: true });
    expect(pub.discordAppId).toBe('123456789');
    await resetDb(t.app);
  });
});
