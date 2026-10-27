import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sendEventReminders } from '../src/services/groups.js';
import { reviewScore } from '../src/services/social-dto.js';
import { computeBadges } from '../src/services/social.js';
import { UrlSigner } from '../src/lib/sign.js';
import { createTestApp, createUser, login, publishedGame, resetDb, type Client, type TestApp } from './helpers.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

function imageUpload(data = PNG) {
  const boundary = '----gssocial';
  return {
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bild.png"\r\nContent-Type: image/png\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

let t: TestApp;
let alice: Client;
let bob: Client;
let carol: Client;

async function befriend(a: Client, b: Client, bName: string) {
  await a.req('POST', '/api/friends/requests', { username: bName });
  const overview = (await b.req('GET', '/api/friends')).json();
  const req = overview.incoming.find((r: { user: { id: string } }) => r.user.id === a.userId);
  return b.req('POST', `/api/friends/requests/${req.id}/accept`);
}

beforeEach(async () => {
  if (!t) t = await createTestApp();
  else await resetDb(t.app);
  t.app.ctx.mailer.outbox.length = 0;
  await createUser(t.app, 'alice', 'ADMIN');
  await createUser(t.app, 'bob');
  await createUser(t.app, 'carol');
  alice = await login(t.app, 'alice');
  bob = await login(t.app, 'bob');
  carol = await login(t.app, 'carol');
});

afterAll(async () => {
  await t?.close();
});

describe('Freunde', () => {
  it('Anfrage, Annahme, Benachrichtigungen, Präsenz und Entfernen', async () => {
    const sent = await alice.req('POST', '/api/friends/requests', { username: 'BOB' });
    expect(sent.json().status).toBe('outgoing');
    expect((await alice.req('POST', '/api/friends/requests', { username: 'bob' })).statusCode).toBe(409);

    const notes = (await bob.req('GET', '/api/notifications')).json();
    expect(notes.unread).toBe(1);
    expect(notes.items[0].type).toBe('friend.request');
    // Bob ist offline → E-Mail (Standard: friends an)
    expect(t.app.ctx.mailer.outbox.some((m) => m.to === 'bob@example.test')).toBe(true);

    const reqId = (await bob.req('GET', '/api/friends')).json().incoming[0].id;
    expect((await carol.req('POST', `/api/friends/requests/${reqId}/accept`)).statusCode).toBe(404);
    expect((await bob.req('POST', `/api/friends/requests/${reqId}/accept`)).statusCode).toBe(200);

    const overview = (await alice.req('GET', '/api/friends')).json();
    expect(overview.friends).toHaveLength(1);
    expect(overview.friends[0].user.username).toBe('bob');
    expect(overview.friends[0].presence.online).toBe(false);

    expect((await alice.req('GET', '/api/notifications')).json().items[0].type).toBe('friend.accepted');
    await bob.req('POST', '/api/notifications/read', {});
    expect((await bob.req('GET', '/api/notifications')).json().unread).toBe(0);

    // Feed enthält „friend.added“
    const feed = (await alice.req('GET', '/api/feed')).json();
    expect(feed.some((a: { type: string }) => a.type === 'friend.added')).toBe(true);

    // Gegenseitige Anfrage wird direkt angenommen
    await carol.req('POST', '/api/friends/requests', { username: 'alice' });
    expect((await alice.req('POST', '/api/friends/requests', { username: 'carol' })).json().status).toBe('friends');

    expect((await alice.req('DELETE', `/api/friends/${bob.userId}`)).statusCode).toBe(200);
    expect((await alice.req('GET', '/api/friends')).json().friends).toHaveLength(1);
  });

  it('Blockieren verhindert Anfragen, Suche und Chat', async () => {
    await befriend(alice, bob, 'bob');
    expect((await bob.req('POST', `/api/blocks/${alice.userId}`)).statusCode).toBe(200);
    // Freundschaft wurde beendet
    expect((await alice.req('GET', '/api/friends')).json().friends).toHaveLength(0);
    expect((await alice.req('POST', '/api/friends/requests', { username: 'bob' })).json().error).toBe('blocked');
    expect((await alice.req('GET', '/api/users/search?q=bo')).json()).toHaveLength(0);
    expect((await alice.req('POST', '/api/chat/direct', { userId: bob.userId })).statusCode).toBe(403);
    const search = (await bob.req('GET', '/api/users/search?q=ali')).json();
    expect(search[0].relation).toBe('blocked');
    await bob.req('DELETE', `/api/blocks/${alice.userId}`);
    expect((await alice.req('GET', '/api/users/search?q=bo')).json()[0].relation).toBe('none');
  });

  it('Freundschaftsanfragen lassen sich abschalten', async () => {
    await bob.req('PATCH', '/api/me/profile', { allowFriendRequests: false });
    expect((await alice.req('POST', '/api/friends/requests', { username: 'bob' })).json().error).toBe('requests_disabled');
  });

  it('Spieleinladung nur an Freunde, Präsenz über setGame', async () => {
    const { gameId } = await publishedGame(alice, 'Koop-Spiel');
    expect((await alice.req('POST', `/api/friends/${bob.userId}/invite`, { gameId })).statusCode).toBe(403);
    await befriend(alice, bob, 'bob');
    expect((await alice.req('POST', `/api/friends/${bob.userId}/invite`, { gameId })).statusCode).toBe(200);
    const note = (await bob.req('GET', '/api/notifications')).json().items[0];
    expect(note.type).toBe('game.invite');
    expect(note.data.gameTitle).toBe('Koop-Spiel');

    // Präsenz: ohne WebSocket gilt der Nutzer als offline → Spiel wird nicht angezeigt
    await bob.req('PUT', '/api/presence', { gameId });
    expect(t.app.ctx.hub.gameOf(bob.userId)).toBe(gameId);
    await bob.req('PUT', '/api/presence', { gameId: null });
    expect(t.app.ctx.hub.gameOf(bob.userId)).toBeNull();
  });
});

describe('Profile', () => {
  it('Privatsphäre, Vitrinen, Abzeichen und Hintergrund', async () => {
    const { gameId } = await publishedGame(alice, 'Lieblingsspiel');
    await bob.req('PUT', `/api/library/${gameId}`);
    const settings = await bob.req('PATCH', '/api/me/profile', {
      accent: '#ff8800',
      showcases: [{ kind: 'favoriteGame', gameId, text: 'Bestes Spiel' }, { kind: 'text', title: 'Über mich', text: 'Hallo' }, { kind: 'badges' }],
      notificationPrefs: { email: { messages: true } },
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().notificationPrefs.email).toMatchObject({ messages: true, friends: true });

    const bg = await bob.req('POST', '/api/me/profile/background', imageUpload().payload, imageUpload().headers);
    expect(bg.statusCode).toBe(200);
    const bgUrl: string = bg.json().backgroundUrl;
    expect(bgUrl).toMatch(/^\/api\/files\/social\/profiles\/.+\?exp=\d+&sig=/);
    const file = await t.app.inject({ method: 'GET', url: bgUrl });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect((await t.app.inject({ method: 'GET', url: bgUrl.replace(/sig=.*/, 'sig=falsch') })).statusCode).toBe(403);

    const profile = (await carol.req('GET', '/api/profiles/bob')).json();
    expect(profile.restricted).toBe(false);
    expect(profile.accent).toBe('#ff8800');
    expect(profile.stats.games).toBe(1);
    expect(profile.showcases[0].game.title).toBe('Lieblingsspiel');
    expect(profile.showcases[1].text).toBe('Hallo');
    expect(profile.activity.some((a: { type: string }) => a.type === 'library.added')).toBe(true);

    await bob.req('PATCH', '/api/me/profile', { visibility: 'FRIENDS' });
    const restricted = (await carol.req('GET', '/api/profiles/bob')).json();
    expect(restricted.restricted).toBe(true);
    expect(restricted.stats).toBeNull();
    await befriend(carol, bob, 'bob');
    expect((await carol.req('GET', '/api/profiles/bob')).json().restricted).toBe(false);
    // Anonym
    expect((await t.app.inject({ method: 'GET', url: '/api/profiles/bob' })).json().restricted).toBe(true);
  });

  it('Abzeichen werden aus Meilensteinen berechnet', () => {
    const badges = computeBadges({ games: 30, playtimeSeconds: 120 * 3600, reviews: 0, friends: 5, screenshots: 0, groups: 0 }, new Date(Date.now() - 400 * 86400_000));
    expect(badges).toEqual(
      expect.arrayContaining([
        { id: 'collector', level: 2, value: 30 },
        { id: 'player', level: 2, value: 120 },
        { id: 'social', level: 1, value: 5 },
        { id: 'veteran', level: 1, value: 1 },
      ]),
    );
    expect(badges.find((b) => b.id === 'reviewer')).toBeUndefined();
  });
});

describe('Chat', () => {
  it('Direktnachrichten nur unter Freunden, Ungelesen-Zähler, Bearbeiten/Löschen', async () => {
    expect((await alice.req('POST', '/api/chat/direct', { userId: bob.userId })).json().error).toBe('not_friends');
    await befriend(alice, bob, 'bob');
    const conv = (await alice.req('POST', '/api/chat/direct', { userId: bob.userId })).json();
    expect(conv.type).toBe('DIRECT');
    expect(conv.title).toBe('bob');
    // Gleiche Unterhaltung beim zweiten Aufruf
    expect((await bob.req('POST', '/api/chat/direct', { userId: alice.userId })).json().id).toBe(conv.id);

    t.app.ctx.mailer.outbox.length = 0;
    await bob.req('PATCH', '/api/me/profile', { notificationPrefs: { email: { messages: true } } });
    const m1 = await alice.req('POST', `/api/chat/conversations/${conv.id}/messages`, { body: 'Hallo Bob!' });
    expect(m1.statusCode).toBe(200);
    await alice.req('POST', `/api/chat/conversations/${conv.id}/messages`, { body: 'Bist du da?' });
    // Nur eine E-Mail für die erste ungelesene Nachricht
    expect(t.app.ctx.mailer.outbox.filter((m) => m.to === 'bob@example.test')).toHaveLength(1);

    expect((await bob.req('GET', '/api/chat/unread')).json().count).toBe(2);
    const list = (await bob.req('GET', '/api/chat/conversations')).json();
    expect(list[0].unread).toBe(2);
    expect(list[0].lastMessage.body).toBe('Bist du da?');
    await bob.req('POST', `/api/chat/conversations/${conv.id}/read`);
    expect((await bob.req('GET', '/api/chat/unread')).json().count).toBe(0);

    expect((await carol.req('GET', `/api/chat/conversations/${conv.id}/messages`)).statusCode).toBe(404);
    expect((await bob.req('PATCH', `/api/chat/messages/${m1.json().id}`, { body: 'gehackt' })).statusCode).toBe(403);
    const edited = await alice.req('PATCH', `/api/chat/messages/${m1.json().id}`, { body: 'Hallo, Bob!' });
    expect(edited.json().editedAt).not.toBeNull();
    await alice.req('DELETE', `/api/chat/messages/${m1.json().id}`);
    const msgs = (await bob.req('GET', `/api/chat/conversations/${conv.id}/messages`)).json();
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toMatchObject({ deleted: true, body: '' });
    expect((await alice.req('POST', `/api/chat/conversations/${conv.id}/messages`, { body: '  ' })).json().error).toBe('empty');
  });

  it('Bilder per signierter URL, GIFs nur mit API-Schlüssel', async () => {
    await befriend(alice, bob, 'bob');
    const conv = (await alice.req('POST', '/api/chat/direct', { userId: bob.userId })).json();
    const up = imageUpload();
    const res = await alice.req('POST', `/api/chat/conversations/${conv.id}/attachments?caption=Screenshot`, up.payload, up.headers);
    expect(res.statusCode).toBe(200);
    expect(res.json().body).toBe('Screenshot');
    const file = await t.app.inject({ method: 'GET', url: res.json().attachmentUrl });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(PNG)).toBe(true);

    const bad = imageUpload(Buffer.from('kein Bild'));
    expect((await alice.req('POST', `/api/chat/conversations/${conv.id}/attachments`, bad.payload, bad.headers)).json().error).toBe('invalid_image');

    const cfg = (await alice.req('GET', '/api/chat/config')).json();
    expect(cfg).toMatchObject({ gifsEnabled: false, voiceEnabled: false, iceServers: [] });
    expect((await alice.req('POST', `/api/chat/conversations/${conv.id}/messages`, { gifUrl: 'https://media.tenor.com/x.gif' })).statusCode).toBe(403);
  });

  it('Gruppenchat: anlegen, Mitglieder, verlassen', async () => {
    await befriend(alice, bob, 'bob');
    expect((await alice.req('POST', '/api/chat/conversations', { userIds: [carol.userId] })).statusCode).toBe(403);
    await befriend(alice, carol, 'carol');
    const conv = (await alice.req('POST', '/api/chat/conversations', { title: 'Raid', userIds: [bob.userId, carol.userId] })).json();
    expect(conv.members).toHaveLength(3);
    expect(conv.canManage).toBe(true);
    expect((await bob.req('PATCH', `/api/chat/conversations/${conv.id}`, { title: 'X' })).statusCode).toBe(403);
    await bob.req('PATCH', `/api/chat/conversations/${conv.id}`, { muted: true });
    expect((await bob.req('GET', `/api/chat/conversations/${conv.id}`)).json().muted).toBe(true);
    await alice.req('DELETE', `/api/chat/conversations/${conv.id}/members/${alice.userId}`);
    // Ältestes verbleibendes Mitglied wird Admin
    const after = (await bob.req('GET', `/api/chat/conversations/${conv.id}`)).json();
    expect(after.members).toHaveLength(2);
    expect(after.canManage || (await carol.req('GET', `/api/chat/conversations/${conv.id}`)).json().canManage).toBe(true);
  });

  it('TURN-Zugangsdaten werden per HMAC erzeugt', async () => {
    const t2 = await createTestApp({ WEBRTC_STUN_URLS: 'stun:stun.example:3478', WEBRTC_TURN_URLS: 'turn:turn.example:3478', WEBRTC_TURN_SECRET: 'geheim' });
    try {
      const servers = t2.app.ctx.chat.iceServers('u1');
      expect(servers[0]).toEqual({ urls: ['stun:stun.example:3478'] });
      expect(servers[1].username).toMatch(/^\d+:u1$/);
      expect(servers[1].credential).toBeTruthy();
    } finally {
      await t2.close();
      await resetDb(t.app);
    }
  });
});

describe('Gruppen', () => {
  it('Beitrittsanfrage, Kanäle, Ankündigungen, Rollen', async () => {
    const g = (await alice.req('POST', '/api/groups', { name: 'Die Raider', summary: 'Wir raiden', joinPolicy: 'REQUEST' })).json();
    expect(g.slug).toBe('die-raider');
    expect(g.myRole).toBe('OWNER');
    expect(g.channels).toHaveLength(1);
    const second = (await bob.req('POST', '/api/groups', { name: 'Die Raider' })).json();
    expect(second.slug).not.toBe('die-raider');

    const joined = (await bob.req('POST', `/api/groups/${g.slug}/join`)).json();
    expect(joined.myStatus).toBe('PENDING');
    expect(joined.channels).toHaveLength(0);
    expect((await alice.req('GET', '/api/notifications')).json().items[0].type).toBe('group.request');
    expect((await carol.req('POST', `/api/groups/${g.id}/members/${bob.userId}/approve`)).statusCode).toBe(403);
    await alice.req('POST', `/api/groups/${g.id}/members/${bob.userId}/approve`);
    const bobView = (await bob.req('GET', `/api/groups/${g.slug}`)).json();
    expect(bobView.myStatus).toBe('ACTIVE');
    expect(bobView.memberCount).toBe(2);

    // Kanal-Mitgliedschaft folgt der Gruppe
    const channelId = bobView.channels[0].id;
    expect((await bob.req('POST', `/api/chat/conversations/${channelId}/messages`, { body: 'Moin!' })).statusCode).toBe(200);
    const extra = (await alice.req('POST', `/api/groups/${g.id}/channels`, { title: 'Strategie Talk' })).json();
    expect(extra.title).toBe('strategie-talk');
    expect((await bob.req('GET', `/api/chat/conversations/${extra.id}`)).statusCode).toBe(200);

    await alice.req('POST', `/api/groups/${g.id}/announcements`, { title: 'Turnier', body: 'Am Samstag' });
    expect((await bob.req('GET', '/api/notifications')).json().items[0].type).toBe('group.announcement');

    expect((await alice.req('POST', `/api/groups/${g.id}/leave`)).json().error).toBe('owner_must_transfer');
    await alice.req('PATCH', `/api/groups/${g.id}/members/${bob.userId}`, { role: 'OWNER' });
    expect((await bob.req('GET', `/api/groups/${g.id}`)).json().myRole).toBe('OWNER');
    expect((await alice.req('GET', `/api/groups/${g.id}`)).json().myRole).toBe('MODERATOR');
    await alice.req('POST', `/api/groups/${g.id}/leave`);
    expect((await alice.req('GET', `/api/chat/conversations/${channelId}`)).statusCode).toBe(404);
  });

  it('Versteckte Gruppe nur auf Einladung', async () => {
    const g = (await alice.req('POST', '/api/groups', { name: 'Geheimbund', joinPolicy: 'INVITE', visibility: 'HIDDEN' })).json();
    expect((await bob.req('GET', `/api/groups/${g.slug}`)).statusCode).toBe(404);
    expect((await bob.req('GET', '/api/groups')).json()).toHaveLength(0);
    await alice.req('POST', `/api/groups/${g.id}/invites`, { userId: bob.userId });
    expect((await bob.req('GET', '/api/groups?mine=true')).json()).toHaveLength(1);
    expect((await bob.req('GET', `/api/groups/${g.slug}`)).json().myStatus).toBe('INVITED');
    expect((await carol.req('POST', `/api/groups/${g.id}/join`)).statusCode).toBe(404);
    expect((await bob.req('POST', `/api/groups/${g.id}/join`)).json().myStatus).toBe('ACTIVE');
  });

  it('Events mit Zusagen und Erinnerung', async () => {
    const { gameId } = await publishedGame(alice, 'Eventspiel');
    const g = (await alice.req('POST', '/api/groups', { name: 'Eventgruppe' })).json();
    await bob.req('POST', `/api/groups/${g.id}/join`);
    const startsAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const ev = (await alice.req('POST', `/api/groups/${g.id}/events`, { title: 'LAN-Abend', startsAt, gameId })).json();
    expect(ev.game.title).toBe('Eventspiel');
    expect(ev.rsvp.going).toBe(1);
    expect((await bob.req('GET', '/api/notifications')).json().items[0].type).toBe('event.created');
    const r = (await bob.req('PUT', `/api/groups/events/${ev.id}/rsvp`, { status: 'MAYBE' })).json();
    expect(r).toMatchObject({ myRsvp: 'MAYBE', rsvp: { going: 1, maybe: 1 } });
    expect((await carol.req('PUT', `/api/groups/events/${ev.id}/rsvp`, { status: 'GOING' })).statusCode).toBe(403);

    expect(await sendEventReminders(t.app.ctx)).toBe(1);
    expect(await sendEventReminders(t.app.ctx)).toBe(0);
    expect((await bob.req('GET', '/api/notifications')).json().items[0].type).toBe('event.reminder');
    expect((await alice.req('GET', '/api/notifications')).json().items[0].type).toBe('event.reminder');
  });
});

describe('Community', () => {
  it('Reviews: nur mit Bibliothek, Hilfreich-Stimmen, Zusammenfassung', async () => {
    const { gameId } = await publishedGame(alice, 'Bewertbar');
    const body = { recommended: true, body: 'Richtig gutes Spiel, klare Empfehlung!' };
    expect((await bob.req('PUT', `/api/community/games/${gameId}/reviews/mine`, body)).json().error).toBe('not_in_library');
    await bob.req('PUT', `/api/library/${gameId}`);
    await carol.req('PUT', `/api/library/${gameId}`);
    const review = (await bob.req('PUT', `/api/community/games/${gameId}/reviews/mine`, body)).json();
    await carol.req('PUT', `/api/community/games/${gameId}/reviews/mine`, { recommended: false, body: 'Leider nicht mein Fall gewesen.' });

    expect((await bob.req('PUT', `/api/community/reviews/${review.id}/vote`, { helpful: true })).statusCode).toBe(400);
    const voted = (await carol.req('PUT', `/api/community/reviews/${review.id}/vote`, { helpful: true, funny: true })).json();
    expect(voted).toMatchObject({ helpful: 1, funny: 1, myVote: { helpful: true, funny: true } });
    expect((await bob.req('GET', '/api/notifications')).json().items[0].type).toBe('review.helpful');

    const list = (await t.app.inject({ method: 'GET', url: `/api/community/games/${gameId}/reviews` })).json();
    expect(list.summary).toMatchObject({ total: 2, positive: 1, percent: 50, score: 'mixed' });
    expect(list.items[0].id).toBe(review.id);
    expect((await carol.req('GET', `/api/community/games/${gameId}/reviews?filter=negative`)).json().mine.recommended).toBe(false);

    // Moderation durch Admin/Maintainer
    expect((await bob.req('DELETE', `/api/community/reviews/${list.items[1].id}`)).statusCode).toBe(403);
    expect((await alice.req('DELETE', `/api/community/reviews/${list.items[1].id}`)).statusCode).toBe(200);
  });

  it('Bewertungsstufen', () => {
    expect(reviewScore(0, 0)).toBe('none');
    expect(reviewScore(600, 590)).toBe('overwhelmingly_positive');
    expect(reviewScore(60, 50)).toBe('very_positive');
    expect(reviewScore(10, 9)).toBe('positive');
    expect(reviewScore(10, 7)).toBe('mostly_positive');
    expect(reviewScore(10, 5)).toBe('mixed');
    expect(reviewScore(10, 3)).toBe('mostly_negative');
    expect(reviewScore(10, 1)).toBe('negative');
    expect(reviewScore(60, 5)).toBe('very_negative');
  });

  it('Forum: Thema, Antwort mit Benachrichtigung, Sperren', async () => {
    const { gameId } = await publishedGame(alice, 'Forenspiel');
    const topic = (await bob.req('POST', `/api/community/games/${gameId}/topics`, { title: 'Bug im Level 3', body: 'Tür geht nicht auf' })).json();
    expect(topic.postCount).toBe(1);
    await carol.req('POST', `/api/community/topics/${topic.id}/posts`, { body: 'Bei mir auch' });
    const note = (await bob.req('GET', '/api/notifications')).json().items[0];
    expect(note).toMatchObject({ type: 'forum.reply', data: { title: 'Bug im Level 3' } });

    expect((await bob.req('PATCH', `/api/community/topics/${topic.id}`, { locked: true })).statusCode).toBe(403);
    await alice.req('PATCH', `/api/community/topics/${topic.id}`, { locked: true, pinned: true });
    expect((await carol.req('POST', `/api/community/topics/${topic.id}/posts`, { body: 'Noch was' })).json().error).toBe('locked');
    const detail = (await carol.req('GET', `/api/community/topics/${topic.id}`)).json();
    expect(detail.posts).toHaveLength(2);
    expect(detail.topic).toMatchObject({ locked: true, pinned: true });
    expect(detail.canModerate).toBe(false);
    // Löschen des ersten Beitrags entfernt das Thema
    await bob.req('DELETE', `/api/community/posts/${detail.posts[0].id}`);
    expect((await bob.req('GET', `/api/community/topics/${topic.id}`)).statusCode).toBe(404);
  });

  it('Screenshots, Guides, Likes und Sichtbarkeit', async () => {
    const { gameId } = await publishedGame(alice, 'Bildspiel');
    const up = imageUpload();
    const shot = await bob.req('POST', `/api/community/games/${gameId}/items/image?type=SCREENSHOT&title=Aussicht`, up.payload, up.headers);
    expect(shot.statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: shot.json().imageUrl })).statusCode).toBe(200);
    const guide = (await carol.req('POST', `/api/community/games/${gameId}/guides`, { title: 'Komplettlösung', body: '# Kapitel 1\nGeh nach links und dann rechts.' })).json();
    expect(guide.type).toBe('GUIDE');
    expect((await carol.req('PUT', `/api/community/items/${shot.json().id}/like`)).json()).toEqual({ likes: 1, liked: true });
    const popular = (await bob.req('GET', `/api/community/games/${gameId}/items?sort=popular`)).json();
    expect(popular.items[0].id).toBe(shot.json().id);
    expect((await bob.req('GET', `/api/community/games/${gameId}/items?type=GUIDE`)).json().total).toBe(1);
    expect((await bob.req('PATCH', `/api/community/items/${guide.id}`, { title: 'Meins' })).statusCode).toBe(403);

    // Versteckte Spiele: Community nicht abrufbar
    await alice.req('PATCH', `/api/manage/games/${gameId}`, { visibility: 'HIDDEN' });
    expect((await bob.req('GET', `/api/community/games/${gameId}/items`)).statusCode).toBe(404);
    expect((await bob.req('GET', `/api/community/items/${guide.id}`)).statusCode).toBe(404);
  });
});

describe('Signierte URLs', () => {
  it('prüft Signatur und Ablauf', () => {
    const s = new UrlSigner('geheim');
    const url = s.sign('/api/files/social/a.png', 3600, 1_000_000_000_000);
    const [, query] = url.split('?');
    const p = new URLSearchParams(query);
    expect(s.verify('/api/files/social/a.png', p.get('exp'), p.get('sig'), 1_000_000_000_000)).toBe(true);
    expect(s.verify('/api/files/social/b.png', p.get('exp'), p.get('sig'), 1_000_000_000_000)).toBe(false);
    expect(s.verify('/api/files/social/a.png', p.get('exp'), p.get('sig'), 1_000_000_000_000 + 3 * 3600_000)).toBe(false);
    expect(new UrlSigner('anders').verify('/api/files/social/a.png', p.get('exp'), p.get('sig'), 1_000_000_000_000)).toBe(false);
  });
});
