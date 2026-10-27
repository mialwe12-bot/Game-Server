# Projektnotizen für Claude (Gedächtnis zwischen Sitzungen)

Antworte dem Nutzer immer auf **Deutsch**. Der Nutzer möchte, dass möglichst viele Infos festgehalten werden – diese Datei
bei jeder Phase/Architekturentscheidung aktualisieren.

## Auftrag (Kurzfassung)

Selbst gehostete Steam-ähnliche Plattform für DRM-freie Spiele: Server + Web-Store/Admin-Panel + Desktop-Client
(Tauri, Windows/Linux). 100 % Open Source, keine Paywall/Premium/Telemetrie/Zahlungen. Strikt phasenweise (1–4, siehe
`docs/ROADMAP.md`). Bei technisch eingeschränkten Features (Overlay, Remote Play, Delta-Updates, …) **vorher** darauf hinweisen
und pragmatische Lösung vorschlagen. Am Ende jeder Phase: Liste „fertig / nächste Phase“. Tests für API-Kern und
Download-Manager sind Pflicht.

## Repositories & Branches

- `mialwe12-bot/Game-Server` (dieses Repo): Server, Web, shared. Entwicklungsbranch: `claude/magical-archimedes-jb34jz`.
- `mialwe12-bot/game-client`: Desktop-Client (Tauri) ab Phase 2 – war bei Phase-1-Abschluss noch leer.
  Plan: Web-Frontend + `packages/shared` aus diesem Repo einbinden (Git-Submodul oder Workspace), „Client-Modus“ im Frontend.

## Stand

- **Phase 1 fertig** (Server, Web-Store, Admin, Docker, Tests, CI, README).
- **Phase 2 fertig** (Desktop-Client im Repo `game-client`, siehe dessen CLAUDE.md; Frontend-Desktop-Modus hier in
  `apps/web/src/desktop/`, Client-Releases/Updater in `apps/server/src/routes/client.ts`).
- **Phase 3 fertig** (Soziales, siehe Abschnitt unten). Version noch 0.2.0 (bei Release auf 0.3.0 heben).
- Nächster Schritt: **Phase 4 – Steam-Features** – erst auf Anweisung des Nutzers starten; Hinweise zu Einschränkungen stehen in
  `docs/ROADMAP.md` (Overlay, Remote Play, Hotkey-Screenshots, Cloud-Saves, Achievements, Discord).

## Architektur & Entscheidungen

- Monorepo mit pnpm-Workspaces: `apps/server`, `apps/web`, `packages/shared`. Node ≥ 22, pnpm 10, TypeScript 5.9.
- Server: Fastify 5 + `fastify-type-provider-zod` (Zod 4) → OpenAPI über `@fastify/swagger` (`/api/openapi.json`, UI `/api/docs`).
  Antworten haben keine Zod-Response-Schemas (nur Requests), Typen kommen aus `@gameserver/shared`.
- Prisma 6 (bewusst nicht 7/8), Schema `apps/server/prisma/schema.prisma`, Migrationen unter `prisma/migrations`.
  binaryTargets inkl. `linux-musl-openssl-3.0.x` (Alpine-Docker).
- `@gameserver/shared` exportiert per Condition `source` (Vite/Web nutzt TS-Quellen) bzw. `dist` (Server). Der Server braucht
  daher `pnpm --filter @gameserver/shared build` vor Typecheck/Start.
- Auth: Session-Tabelle für Web (Cookie `gs_session` httpOnly + `gs_csrf`, Header `X-CSRF-Token`) und Device-Tokens
  (`Authorization: Bearer gsd_…`, Kind `DEVICE`). Tokens nur als SHA-256 gespeichert. 2FA: eigene TOTP-Implementierung
  (`src/lib/totp.ts`, RFC-Testvektoren), Login-Challenge-Tabelle für zweiten Faktor. Argon2id via `@node-rs/argon2`.
- Rollen ADMIN/UPLOADER/USER. Rechte pro Spiel: `GameMaintainer` (bearbeiten, nur mit Rolle Uploader/Admin) und `GameAccess`
  (Sichtbarkeit RESTRICTED). Sichtbarkeiten: PUBLIC, UNLISTED, RESTRICTED, HIDDEN (Entwurf). `publishedAt` beim ersten Verlassen von HIDDEN.
- Spiele → `GameVersion` → `Build` (unique je Version+Plattform) → `BuildFile` (Pfad, Größe, SHA-256, storageKey
  `builds/<buildId>/<fileId>`). ZIP/7z/Installer = genau eine Datei (neuer Upload ersetzt), FOLDER = viele Dateien
  (Basis für Datei-Delta-Updates in Phase 2).
- Upload-Protokoll (tus-ähnlich, eigene Implementierung `src/services/uploads.ts`): POST anlegen, PATCH mit `Upload-Offset`
  und Content-Type `application/offset+octet-stream`, GET für Offset. Überlauf wird verworfen statt Stream abzubrechen
  (sonst hängt die Antwort). Inkrementeller SHA-256 im Speicher, sonst Neuberechnung beim Abschluss. Magic-Byte-Prüfung ZIP/7z.
- Downloads: `src/lib/send.ts` (Range, HEAD, ETag/If-Range, Drossel `ThrottleStream`). HEAD-Trick: leerer Stream senden,
  sonst setzt Fastify Content-Length 0. Download-Zähler max. 1×/Std./Nutzer/Build.
- Einstellungen in Tabelle `Setting` (JSON pro Key), Defaults in `src/services/settings.ts`.
- Backups: `pg_dump --format=custom` (libpq-Env aus DATABASE_URL) + `tar -czf` in `DATA_DIR/backups`, Zeitplan-Check alle 15 min.
- Echtzeit: `/api/ws` (Hub in `src/services/hub.ts`), Ereignistypen in `packages/shared/src/types.ts` (`WsEvent`).
- Web: React 19, React Router 7 (`react-router-dom`), TanStack Query 5, Tailwind 4 (Tokens als CSS-Variablen in `src/index.css`,
  Dark-Mode per Klasse `.dark`), i18next (DE/EN in `src/i18n/de.ts`/`en.ts`, EN typisiert gegen DE), lucide-react.
  Admin-Bereich lazy geladen. Globale Upload-Warteschlange `src/lib/uploads.ts` (3 parallel).
  `window.__GS_API_BASE__`/`__GS_TOKEN__` sind Hooks für den Tauri-Client.
- Deployment: `docker-compose.yml` (postgres:17, server, web=nginx), Container-Namen `gameserver-server`/`gameserver-web`
  im externen Netz `reverse-proxy`; Caddy-Eintrag `deploy/Caddyfile`. Server-Image Alpine mit `postgresql17-client`,
  Entrypoint wendet Migrationen an und wechselt per su-exec zu `node`.
- Lizenz: AGPL-3.0-or-later.

## Befehle

```bash
pnpm install
pnpm --filter @gameserver/shared build
pnpm typecheck
pnpm test                       # braucht Postgres-DB gameserver_test (DATABASE_URL_TEST)
pnpm dev                        # Server :3000 + Web :5173
pnpm seed --username admin --email a@b.de --password '...' [--demo]
```

In der Cloud-Sandbox: `service postgresql start`, User/DB `gs`/`gs`, DBs `gameserver` + `gameserver_test`.
`prisma migrate reset` ist für KI-Agenten gesperrt → DB stattdessen per `psql` droppen/neu anlegen (nur lokale Test-DBs!).
Kein Docker-Daemon in der Sandbox → Images nicht baubar; Deploy-Artefakt per `pnpm --filter @gameserver/server deploy --prod --legacy <dir>` getestet.

## Phase 2 – Ergänzungen
- Frontend erkennt Tauri (`isDesktop` in `apps/web/src/desktop/bridge.ts`), lädt Config vor dem Rendern (main.tsx),
  HashRouter im Desktop, `DesktopProvider` hält installierte Spiele/Downloads/laufende Spiele (Tauri-Ereignisse).
- `AuthProvider.offline` → `OfflinePage`; 401 im Desktop → Token löschen.
- Übersetzungen: Test `apps/web/src/i18n/i18n.test.ts` prüft alle statischen `t('…')`-Schlüssel (DE/EN).
  Achtung beim Einfügen per Skript: Teilstring-Treffer (z. B. `errors:` auch in `auth.errors`) – ist einmal passiert.
- Server: Modelle `ClientRelease`/`ClientReleaseFile`; Updater bevorzugt NSIS > MSI (Windows), AppImage (Linux).
- Playtime-Endpunkt akzeptiert `startedAt` mit Offset (`datetime({ offset: true })`).
- CORS-Standard: `tauri://localhost,http://tauri.localhost,https://tauri.localhost`; CORP global `cross-origin`.

## Phase 3 – Soziales (Architektur)
- Schema-Migration `social`: Friendship (PENDING/ACCEPTED), Block, Conversation (DIRECT mit `directKey` = sortierte IDs,
  GROUP, CHANNEL mit `groupId`), ConversationMember (lastReadAt, muted, isAdmin), Message (Soft-Delete), Group/GroupMember
  (Rolle + Status ACTIVE/PENDING/INVITED), GroupAnnouncement, GroupEvent(+Rsvp, `reminded`), Review(+Vote), ForumTopic/Post,
  CommunityItem(+Like; SCREENSHOT/ARTWORK/GUIDE), Notification, Activity. User: profile*-Felder, showcases/notificationPrefs (JSON).
- Typen: `packages/shared/src/social.ts`; `WsEvent` erweitert, neu `WsClientMessage`; ApiClient: `friends`, `profiles`,
  `notifications`, `chat`, `groups`, `community`, `wsSend()`.
- Server-Dienste: `services/social.ts` (Relation, Blockieren, PresenceService, Abzeichen), `services/notify.ts`
  (NotificationService: DB + WS + E-Mail nur wenn offline & Kategorie an; ActivityService), `services/chat.ts` (ChatService,
  ICE/TURN-HMAC), `services/groups.ts` (Kanal-Sync, Event-Erinnerungen alle 5 min), `services/social-dto.ts`.
  Hub (`services/hub.ts`) verwaltet Präsenz (onPresence) und Sprachräume (Signal-Relay).
- Routen: `friends.ts` (/friends, /users/search, /blocks, /presence), `profiles.ts` (/profiles/:username, /me/profile),
  `notifications.ts` (/notifications, /feed, **/files/*** = signierte Dateien), `chat.ts` (/chat), `groups.ts` (/groups),
  `community.ts` (/community). Nutzer-Uploads in Storage-Bereich `social/…`, Auslieferung nur per `UrlSigner`
  (`lib/sign.ts`, HMAC mit APP_SECRET bzw. auto-generiert in Setting `internal.appSecret`, Gültigkeit 7 Tage).
- Chat-E-Mails nur für die erste ungelesene Nachricht (lastReadAt < vorheriges lastMessageAt); Kanäle nie per Mail.
- Sprachchat: WebRTC-Mesh (`apps/web/src/pages/chat/voice.ts`), Initiator = kleinere User-ID; Admin-Schalter `voiceEnabled`;
  ICE aus WEBRTC_STUN_URLS/WEBRTC_TURN_URLS/WEBRTC_TURN_SECRET; coturn per `docker compose --profile voice`.
  Echt getestet mit zwei Chromium-Kontexten (Fake-Mikrofon) – Audio in beide Richtungen.
- GIFs: Tenor v2 über Server-Proxy (`TENOR_API_KEY` + Setting `gifsEnabled`), nur URLs von *.tenor.com im Chat erlaubt.
- Web: Ereignis-Bus `lib/events.ts` (useWsEvent), `lib/social.ts` (Cache-Invalidierung, Toasts, Systembenachrichtigungen),
  Seiten in `pages/social`, `pages/chat` (lazy), `pages/groups` (lazy), `pages/community` (Tabs auf der Spieleseite:
  Routen `/game/:slug/:tab` und `/game/:slug/forum/:topicId`), Konto-Einstellungen `pages/account/SocialSettings.tsx`.
  Desktop: `DesktopProvider` meldet laufendes Spiel als Präsenz (auch nach WS-Reconnect bei `hello`).
- Benachrichtigungs-`path` muss eine existierende Web-Route sein (z. B. `/groups/<slug>`, `/game/<slug>/reviews`).
- E2E-Skripte (Playwright) lagen nur im Scratchpad; Testnutzer in der Dev-DB: admin/admin-passwort-123, bob/testpasswort-123.

## Konventionen

- Code-Kommentare und UI-Texte auf Deutsch (UI zusätzlich Englisch), Fehlermeldungen der API auf Deutsch mit maschinenlesbarem `error`-Code.
- Neue API-Routen: Zod-Schemas für body/query/params, `tags` + `summary` für OpenAPI, Audit-Log bei Admin-/Sicherheitsaktionen.
- Neue Strings immer in `de.ts` **und** `en.ts`.
- Commits mit Attribution-Trailer laut Sitzungsvorgabe; kein Modellname in Commits/Code.
