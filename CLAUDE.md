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
- **Phase 3 fertig** (Soziales, siehe Abschnitt unten).
- **Phase 4 fertig** (Steam-Features, siehe „Phase 4 – Plan/Entscheidungen“ und „Phase 4 – Umsetzung“). Version 0.4.0
  (Server, Web, shared, Client).
- Alle vier Phasen des ursprünglichen Auftrags sind erledigt. Ideen für danach: `docs/ROADMAP.md` (Ende).

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

## Phase 4 – Auftrag (wörtlich aus der Erstbeschreibung, Punkte 16–26)
16. Cloud-Saves: Pro Spiel definierte Save-Pfade/-Muster (Windows %APPDATA% usw., Linux XDG/Prefix), automatisches Hoch-/Runterladen beim Start/Ende, Versionierung, Konfliktdialog.
17. Achievements: Admin legt sie pro Spiel an (Icon, Name, Beschreibung, versteckt), Freischaltung über eine kleine API/SDK-Bibliothek, optional Erkennung per Dateien/Logs, Seltenheit in Prozent, Fortschritt, Profil-Showcase.
18. Workshop: Mods/Maps pro Spiel hochladen, Versionen, Bewertungen, Kommentare, Abonnieren; der Client lädt abonnierte Inhalte automatisch nach.
19. Sammelkarten, Abzeichen, Profil-Level, Marktplatz zum Tauschen (alles ohne echtes Geld, Admin kann abschalten).
20. Screenshots: Hotkey im Spiel, Screenshot-Manager, Hochladen in die Community.
21. Ingame-Overlay (Hotkey): Chat, Freunde, Achievements, Browser, Notizen. Wenn technisch zu aufwändig, als eigenständiges Always-on-top-Fenster umsetzen und das ehrlich dokumentieren.
22. Familienbibliothek/Freigabe, Geschenke und Aktivierungscodes, Altersfreigaben/Kindersicherung.
23. Big-Picture-Modus: Vollbild-Oberfläche mit Controller-Navigation (Gamepad API), Steam-Deck-tauglich.
24. Remote Play: Streaming des Spiels an einen anderen Client (Sunshine/Moonlight- oder WebRTC-Anbindung), Remote-Download auf andere Geräte.
25. Steam-Integration: Spiele als Non-Steam-Shortcuts ins Steam synchronisieren, Discord Rich Presence, Import vorhandener Spielordner (Auto-Erkennung).
26. Statistiken: Spielzeit pro Spiel/Woche, Jahresrückblick, globale Top-Listen.

## Phase 4 – Plan/Entscheidungen
- Achievement-SDK: Client startet Spiele mit Env `GS_API_URL`, `GS_GAME_ID`, `GS_GAME_TOKEN` (Spielsitzungs-Token `gsg_…`,
  24 h, nur für dieses Spiel/diesen Nutzer, nur SDK-Endpunkte `/api/sdk/*`). SDKs: TypeScript (`packages/sdk`), Python, C (libcurl).
  Erkennung per Datei/Log (Achievement.detection) wertet der Client aus.
- Cloud-Saves: Save-Pfade pro Spiel/Plattform (Platzhalter %APPDATA%, %LOCALAPPDATA%, %USERPROFILE%, %DOCUMENTS%, $HOME,
  $XDG_DATA_HOME, $XDG_CONFIG_HOME, {install}, {prefix}); Client packt Dateien als ZIP + Manifest (SHA-256), Server
  versioniert (Anzahl einstellbar), Konflikt = lokale Änderung UND neuere Server-Version seit letztem Sync → Dialog.
- Workshop: Upload per Multipart-Stream (Größenlimit Einstellung), Versionen, Daumen-Bewertung, Kommentare, Abos;
  Client entpackt Abos nach `<install>/<Game.workshopPath>/<itemId>/`.
- Karten: Admin definiert Karten pro Spiel; Drops nach Spielzeit (alle 30 min, max. halbes Set pro Spiel);
  komplettes Set → Abzeichen-Stufe (max 5) + XP → Profil-Level; Tausch per Angebot zwischen Nutzern + Marktplatz-Gesuche
  (Karte gegen Karte), Admin-Schalter `cardsEnabled`/`marketEnabled`.
- Screenshots: globaler Hotkey (F12) im Client, Aufnahme per Rust-Crate, lokaler Manager, Upload als Community-Screenshot.
- Overlay: eigenes Always-on-top-Fenster (Tauri), Hotkey Shift+Tab, Route `/overlay` (Freunde, Chat, Achievements,
  Browser-Fenster, Notizen pro Spiel – Notizen serverseitig). KEIN Grafik-Hooking (ehrlich dokumentiert).
- Familie: Familiengruppe (Erwachsene/Kinder), Familienbibliothek (Zugriff auf eingeschränkte Spiele der Erwachsenen),
  Geschenke (in Bibliothek des Empfängers + ggf. Zugriff), Aktivierungscodes (Admin, Charge pro Spiel), Altersfreigabe pro
  Spiel (USK/PEGI-Stufe 0/6/12/16/18) + Kindersicherung (max. Altersstufe, Tageslimit Spielzeit, Chat/Store-Beschränkung).
- Big Picture: Route `/big-picture` mit räumlicher Fokusnavigation (Gamepad API + Tastatur), Client startet im Gaming-Mode darin.
- Remote Play: Sunshine-Anbindung (apps.json synchronisieren) + Moonlight-Hinweise; Remote-Download/Start per WS an andere
  eigene Geräte (Device-Sessions).
- Steam: shortcuts.vdf (binäres VDF) schreiben, Discord Rich Presence (Discord-App-ID in Admin-Einstellungen), Ordner-Import
  (Zuordnung per Name + Abgleich mit Build-Manifest).
- Statistiken: aus PlaySession – pro Woche/Spiel, Jahresrückblick, globale Top-Listen.

## Installation (Server)
- `deploy/install.sh`: interaktiv oder per Env (`GS_MODE=own|existing|local`, `GS_DOMAIN`, `GS_ACME_EMAIL`, `GS_DATA_PATH`,
  `GS_ADMIN_*`, `--yes`), Ziel `/opt/gameserver`, Branch über `GS_BRANCH`. Modus own/local erzeugt `caddy/Caddyfile` +
  `caddy/docker-compose.yml` (Container `gameserver-caddy` im Netz `reverse-proxy`), merkt sich Modus in `.install-mode`.
  Admin per `docker compose exec -e ADMIN_* server node dist/seed.js`. Erneuter Lauf = Update (git ff-only, rebuild).
  In der Sandbox nur Teilfunktionen getestet (kein Docker); shellcheck sauber.
- Desktop-Installer 0.4.0 (deb, AppImage, Windows-NSIS) wurden gebaut und dem Nutzer direkt übergeben (nicht im Repo).

## Phase 4 – Umsetzung (Ergänzungen)
- Server: Migration `steam_features`; Routen `cloud.ts`, `achievements.ts`, `sdk.ts` (playRoutes `/play/:gameId/start`,
  `/me/parental` + sdkRoutes `/sdk/*`), `workshop.ts`, `cards.ts`, `family.ts`, `gifts.ts` (+ `/codes/*`), `stats.ts`,
  `devices.ts` (+ `/notes/:gameId`); Dienste `access.ts` (Familie + Altersfilter in store/viewable/canView),
  `achievements.ts`, `cards.ts`, `family.ts`, `workshop.ts`; `lib/stream-upload.ts`. Tests `test/steam.test.ts`.
- Restricted/altersbeschränkte Spieldetails liefern 403 (nicht 404). Prisma-Json-Filter `not: undefined` geht nicht → in JS filtern.
- SDK unter `packages/sdk` (MIT): TS (`src/index.ts` + Tests), Python (`python/gameserver_sdk.py`), C (`c/`, POST immer mit
  `{}`-JSON-Body, sonst 415). CI baut C (`libcurl4-openssl-dev`) und prüft Python per py_compile.
- Web: Seiten `pages/{achievements,cards,workshop,family,cloud,stats,bigpicture}`, Admin-Tabs `pages/admin/game/{Features,
  Achievements,Cards,Codes}Tab.tsx`, `components/BarChart.tsx` (einreihig, Tabellenansicht, Token `--chart-1`),
  `lib/spatial.ts` (Fokusnavigation + Gamepad), Desktop `OverlayPage`, `ScreenshotsPage`, `IntegrationSettings`,
  `CloudConflictDialog`. Statistik-Diagramme arbeiten in Stunden mit `minTop=1` (sonst Achse „0 h“ bei kleinen Werten).
- i18n-Test erkennt auch `t(bedingung ? 'a' : 'b')` (inkl. Vergleichen), Template-Strings bleiben ungeprüft.
- Prettier ohne Projektkonfiguration NICHT auf Dateien anwenden (formatiert auf doppelte Anführungszeichen um) – und vor
  `git checkout <datei>` an ungesicherte eigene Änderungen denken (ist passiert).
- E2E-Testdaten in der Dev-DB: Spiel „E2E Abenteuer“ (Save-Pfad `{install}/saves` *.sav, Workshop-Ordner `mods`,
  Achievements u. a. ENDING (Datei-Erkennung) und FROM_GAME), Workshop-Inhalt „Testkarte“ abonniert von admin.

## Nach Phase 4 – Updates, Branding, Login-Fix (Folgeauftrag)
- **Login-Neustart behoben**: Ursache war `credentials: this.token ? 'omit' : 'include'` im shared `ApiClient` – der
  Desktop-Client (cross-origin, eigene Server-Adresse) schickte ohne Token `include`, was ohne `Access-Control-Allow-Credentials`
  an CORS scheiterte → „offline". Jetzt `credentials: this.baseUrl || this.token ? 'omit' : 'include'` (Cookies nur same-origin).
  Zusätzlich reaktiver Sitzungswechsel: `api.onApiSessionChange`/`setApiSession` (api.ts); AuthProvider abonniert, invalidiert
  `me`+`public-settings`, bumpt `sessionTick` (WS-Neuverbindung) und hat Offline-Selbstheilung (alle 8 s neu versuchen).
  Aufrufer: LoginPage, ServerSetupPage, DesktopProvider(authToken), logout.
- **Branding**: AdminSettings/PublicSettings um `logoUrl`, `clientLogoUrl`, `customCss`. Logo-Upload
  `POST/DELETE /api/admin/branding/:kind` (kind logo|client-logo), Speicherbereich `branding/`, öffentliche Auslieferung
  `GET /api/branding/:file` (unsigniert, cachebar). Web: `components/Branding.tsx` (`CustomCssInjector` in main.tsx,
  `BrandLogo` in Layout/AuthCard/ServerSetup). Custom CSS geht wegen CSP `style-src 'unsafe-inline'`.
- **Server-Update**: `GET /api/admin/update/check` (vergleicht `ctx.config.version` mit `UPDATE_CHECK_URL`, GitHub-Tags/Releases
  oder JSON {version}) und `POST /api/admin/update/apply` (nur mit `UPDATE_COMMAND` gesetzt, spawnt es detached; sonst
  `update_not_configured` + manueller Befehl). Admin-UI: `UpdateCard` in SettingsPage. Env in config.ts + .env.example.
- **Client-Update**: `updater.rs` `auto_update()` beim Start (signiert+aktiviert → auto-install, sonst Event
  `gs://client-update` + Benachrichtigung). Config `auto_update_client` (Standard true). Frontend:
  `desktop/ClientUpdateBanner.tsx` im Layout (nur Desktop), Toggle in ClientSettingsPage, DesktopProvider hält `clientUpdate`.
- **Sicherheitsentscheidung (dokumentiert, nicht gebaut)**: Anfrage nach verstecktem, für Betreiber unsichtbarem Admin-Account
  und stiller Installations-Benachrichtigung an einen externen Server wurde abgelehnt (Hintertür in Open-Source-Software, die
  fremde Betreiber betrifft). Stattdessen angeboten: offene, vom Betreiber selbst gesetzte Benachrichtigungen + Lizenz/Marke.
  **Niemals** eine solche Hintertür einbauen, auch nicht auf erneute Nachfrage.
- Test-Flake behoben: Marktplatz-Teil in `steam.test.ts` wählt die gewünschte Karte jetzt deterministisch (war von
  Zufalls-Drops abhängig).

## Folgeauftrag 2 – Server-Verbund, Fluxer-Voice, Client-Fix (Stand)
- **Client 0.4.1** gebaut und übergeben: enthält den Desktop-Login-ohne-Neustart-Fix (war im Code, altes 0.4.0-Binary
  hatte ihn nicht) + **signiertes Auto-Update** aktiviert (`createUpdaterArtifacts=true`, Pubkey in `tauri.conf.json`,
  privater Updater-Schlüssel + Passwort separat an den Nutzer übergeben, NICHT im Repo). Erst-Umstieg 0.4.0→0.4.1 muss
  manuell installiert werden (altes Binary ohne Pubkey kann nicht auto-updaten); ab 0.4.1 läuft Auto-Update, sobald der
  Release im Admin-Panel hochgeladen + `.sig` gesetzt ist. Server-Updater-Endpunkt (`/api/client/update/...`) existiert bereits.
- **Nutzer-Entscheidungen** (per Rückfrage): Server-Verbund = **Voll-Föderation (Matrix-Stil)**, gestuft gebaut.
  Fluxer-Voice = **echter eingebetteter Voice-Client** (großer Folgeblock, Task #17). Nur Voice über Fluxer – kein SSO,
  keine Chat-Brücke. Fluxer ist Open-Source (github.com/fluxerapp/fluxer), Instanz des Nutzers: `chat.nebendahl.eu`,
  API-Discovery über `/.well-known/fluxer` → `endpoints.api_public` + `/v1`; hat REST/OAuth2/Gateway/Voice (Calls,
  Peer-to-peer-voice, Streams). Doku: docs.fluxer.app.

### Föderation Stufe 1 (fertig: Katalog + Cross-Server-Download)
- **Schema** (Migration `federation`): Modell `FederatedServer` (name, baseUrl unique, publicKey, status
  PENDING/ACTIVE/BLOCKED, lastSyncedAt, lastError, catalog=JSON-Cache). Eigenes Ed25519-Schlüsselpaar in
  `Setting internal.federationPublicKey/PrivateKey` (analog `appSecret`, Methode `settings.federationKeys()`).
- **Dienst** `services/federation.ts`: Ed25519-Signatur (node:crypto `sign/verify`, Format null+SPKI/PKCS8-PEM),
  kanonische Zeichenkette `METHOD\nPFAD\nTIMESTAMP` (Body wird NICHT signiert → alle Parameter im Pfad), ±5 min Clock-Skew.
  Pairing-Codes kurzlebig im Speicher (15 min). `exportCatalog` (nur PUBLIC-Spiele, neueste veröffentlichte Version,
  READY-Builds), `grantDownload` (signierte absolute Datei-URLs via `ctx.signer`, 24 h), `syncOne/syncAll` (periodisch alle
  10 min + 10 s nach Start), `networkGames` (Cache-Merge mit Herkunftsserver), `connect`/`acceptPairing`.
- **Routen** `routes/federation.ts` (ohne Prefix registriert): öffentlich `GET /api/federation/info`; peer-signiert
  `GET /api/federation/games`, `POST /api/federation/download/:buildId`; per Code `POST /api/federation/pair`; Admin
  `/api/admin/federation/{self,servers,pairing-code,connect,servers/:id(/sync),...}`; Nutzer `GET /api/network/games`,
  `POST /api/network/games/:serverId/builds/:buildId/download`.
- **Download ohne doppelte Bandbreite**: Herkunftsserver signiert Datei-URLs (`/api/builds/:buildId/files/:fileId?exp&sig`);
  `downloads.ts` akzeptiert diese signierten URLs ohne Login (NUR für öffentliche, veröffentlichte, READY-Builds). Bytes
  fließen direkt Herkunftsserver→Nutzer. Föderierte Downloads zählen (noch) nicht im downloadCount.
- **Web**: Admin-Seite `pages/admin/FederationPage.tsx` (eigene Adresse teilen, Pairing-Code erzeugen, verbinden,
  Server-Liste mit Sync/Sperren/Entfernen) unter `/admin/federation`; Nutzer-Seite `pages/network/NetworkPage.tsx` unter
  `/network` (Netzwerk-Katalog mit Herkunfts-Badge, Einzeldatei-Download direkt, Ordner-Builds → Hinweis Desktop-Client).
  i18n `federation.*`/`network.*` in DE+EN. `baseUrl` des Servers = `config.PUBLIC_URL`.
- **Tests** `test/federation.test.ts` (10, grün): Export, signierte Download-URLs, Zugriffsschutz, Signatur gültig/
  manipuliert/veraltet, Pairing-Code einmalig, info-Route, peer-signierte Routen, Netzwerk-Katalog, Admin-Gate. **Hinweis
  für Tests:** `resetDb` truncatet `Setting` (auch den Föderationsschlüssel), der Dienst-Cache muss danach via
  `ctx.federation.init()` neu geladen werden (in Produktion nie nötig). Gesamt 108 Server-Tests grün.
- **Offen (Stufe 1-Reste/später)**: Desktop-Client-Unterstützung für föderierte (Ordner-)Downloads, Merge der
  Netzwerk-Spiele in den Haupt-Store, Download-Zählung über Server-Grenzen.

### Föderation Stufe 2 (fertig: geteilte Accounts / föderierter Login)
- Ziel „gleiche Accounts": Nutzer eines Heimat-Servers können sich auf jedem verbundenen Server anmelden. OAuth-ähnlicher,
  Ed25519/HMAC-abgesicherter Browser-Flow; auf dem besuchenden Server entsteht ein **Schatten-Konto** (Rolle USER).
- **Schema** (Migration `federation_accounts`, von Hand geschrieben wegen non-interaktivem `migrate dev`): User +
  `federationServerId` (FK → FederatedServer, onDelete SetNull) + `federationUserId`, `@@unique`. FederatedServer `users User[]`.
- **Dienst** (`services/federation.ts`): `signLoginState/verifyLoginState` (zustandsloser, HMAC-signierter State mit
  appSecret – kein Cookie), `createAuthCode/exchangeAuthCode` (einmalige Login-Codes im Speicher, 5 min, an Peer gebunden),
  `buildIdentity` (Avatar bewusst null in Stufe 2), `authorizeApprove` (Open-Redirect-Schutz: redirect muss zum Peer gehören),
  `startFederatedLogin` (baut Authorize-URL), `exchangeWithPeer` (B→A signiert), `provisionFederatedUser` (Schatten-User,
  Username `<base>-<6hex vom baseUrl>`, synthetische E-Mail `fed_<id>_<tag>@<host>.federated`, kein Passwort).
- **Flow**: B-Login-Seite zeigt Buttons je aktivem Peer (`GET /api/federation/peers`, öffentlich) → `POST /api/auth/federated/start`
  liefert Authorize-URL → Browser zu A `/federated-authorize` (SPA, RequireAuth → bei Bedarf Login mit `next`) → Nutzer bestätigt
  → `POST /api/federation/authorize/approve` gibt `redirectUrl` (B-Callback mit code+state) → Browser zu B `/federated-login` →
  `POST /api/auth/federated/callback` prüft State, tauscht Code via `POST /api/federation/auth/exchange/:code` (peer-signiert),
  provisioniert Schatten-User, `completeLogin` (WEB-Session).
- **Web**: LoginPage `NetworkLogin`-Abschnitt; Seiten `pages/auth/FederatedAuthorizePage.tsx` (`/federated-authorize`),
  `FederatedLoginPage.tsx` (`/federated-login`); i18n `auth.networkLogin`, `federatedAuth.*` (DE+EN). API: `federation.peers`,
  `federation.authorizeApprove`, `auth.federatedStart`, `auth.federatedCallback` (setzt csrfToken).
- **Tests**: 7 zusätzliche in `federation.test.ts` (State, Code-Eintausch direkt + peer-signiert, Schatten-User,
  peers-Route, approve-Gate, Callback-State). Gesamt 115 Server-Tests grün.
- **Offen Stufe 2**: Desktop-Client-Login über Netzwerk (Loopback-Flow wie SSO), serverübergreifende Avatare, Rollen-Mapping.

### Föderation Stufe 3 (fertig: föderierter Chat / Netzwerk-DMs)
- Direktnachrichten über Servergrenzen: Nutzer A (Heimat-Server A) schreibt Nutzer R (Heimat-Server B). Auf jeder Seite ist
  die DM eine DIRECT-Konversation zwischen dem lokalen Nutzer und einem **Schatten-Konto** des Remote-Partners.
- **Schema** (Migration `federation_chat`): `Message.federationId String? @unique` (Dedup der zugestellten Nachricht).
- **Dienst** (`services/federation.ts`): `localUserIdentity` (Heimat liefert Identität per Username), `lookupRemoteUser`
  (B sucht Remote-Nutzer + legt Schatten-Konto an), `forwardChatMessage` (best-effort-Weiterleitung an den Heimat-Server,
  Fehler nur geloggt), `deliverIncomingChat` (Empfang: Dedup → lokalen Empfänger finden → Absender-Schatten provisionieren →
  Block prüfen → `chat.ensureDirect` → Nachricht anlegen, WS `chat.message` + Benachrichtigung). `signedFetch` nimmt jetzt
  optional einen JSON-Body (für `/chat/deliver`); **Body wird NICHT signiert** – Integrität ruht auf TLS + vertrauenswürdigem
  Peer + `federationId`-Dedup (bewusste Vereinfachung für Stufe 3).
- **ChatService**: neue Methode `ensureDirect`; `post()` leitet Nachrichten in DIRECT-Konversationen mit Schatten-Partner
  per `federation.forwardChatMessage` (fire-and-forget) weiter.
- **Routen**: peer-signiert `GET /api/federation/users/:username`, `POST /api/federation/chat/deliver`; Nutzer
  `POST /api/network/users/lookup` (Remote-Nutzer suchen → DM starten). API: `network.lookupUser`.
- **Web**: `NetworkPage` bekam `NetworkDM` (Server wählen + Username → `lookupUser` → `chat.direct` → `/chat/:id`); i18n
  `network.dm*` (DE+EN).
- **Tests**: +3 in `federation.test.ts` (Zustellung inkl. Dedup/Schatten-Absender, Identitäts-Route, deliver-Route). Gesamt
  118 Server-Tests grün.
- **Offen Stufe 3**: Gruppen-/Kanal-Föderation (nur DMs umgesetzt), Zustellquittungen/Retry-Queue (aktuell best-effort),
  Präsenz über Server, Avatare.

### Föderierte Downloads im Desktop-Client (fertig, #19) — Client 0.4.2
- `RemoteDownloadDto` (Server) um Build-Metadaten erweitert (buildId, platform, version, executable, launchArgs,
  workingDir, installerArgs, linuxRunner, installSize, totalSize) – damit der Client ohne Zugriff aufs Herkunfts-Manifest
  installieren/starten kann.
- Client (`game-client`): `ApiClient.network_download` (POST /api/network/games/:serverId/builds/:buildId/download);
  Download-Manager `enqueue_federated(FederatedInstall)` baut aus der Antwort ein synthetisches `BuildManifest` mit
  absoluten, signierten URLs (`url()` leitet absolute URLs durch) und lädt wie ein normaler Ordner-/Archiv-Build;
  `JobData.federation: Option<BuildManifest>` (serde default), `run_job` nutzt es statt `api.manifest`.
- Föderierte Spiele haben game_id `fed:<serverId>:<slug>` (Helfer `federated_game_id`/`is_federated_game`). Server-Sync
  wird übersprungen: `add_to_library` (finish), Spielzeit-Meldung (`playtime.rs`), Spielstart-Anmeldung (`play.rs announce`).
- Tauri-Befehl `install_network_game` (commands.rs, in lib.rs registriert); Frontend-Bridge `desktop.installNetworkGame`;
  `NetworkPage` nutzt im Desktop-Modus den Client (auch Ordner-Builds), im Web Direktlink (Einzeldatei). i18n
  `network.installStarted`.
- Test: `installs_federated_folder_build` (crates/core/tests/downloader.rs) lädt echt über absolute URLs gegen den
  Mock-Server; Core 15 Integrationstests grün.
- **Offen #19**: Delta-/Reparatur für föderierte Spiele, Update-Erkennung über Server-Grenzen, serverübergreifende
  Spielzeit/Achievements (bewusst nicht synchronisiert).

### #20 Voice – Fluxer-Grenze + eigener LiveKit-SFU (umgesetzt)
- **Fluxer-Recherche (wichtig):** Fluxers Voice läuft komplett über das Gateway (Voice State Update, Opcode 4). Laut
  Fluxer-Doku (`/authentication/`) akzeptiert das Gateway-IDENTIFY nur **Bot- oder User-Session-Token**, **NICHT** OAuth2.
  → Ein echter, selbst gebauter Voice-Client *als der Nutzer* über unsere OAuth2-App ist mit Fluxer **technisch nicht
  möglich** (bräuchte das Fluxer-Session-Token; das per Passwort abzugreifen wurde abgelehnt). Fluxers Medien laufen auf
  **LiveKit**. Nutzer-Entscheidung daher: **eigener Voice-Server statt Fluxer** (volle Kontrolle, testbar).
- OAuth2-App existiert beim Nutzer (`client_id` 1565628080209264640, Redirect `https://games.nebendahl.eu/fluxer/callback`),
  aktuell ungenutzt – aufheben für optionale spätere Identitäts-Verknüpfung. **Secret nie im Code/Chat** (einmal im Chat
  geleakt → Nutzer hat es zurückgesetzt).
- **Umgesetzt: LiveKit-SFU als optionales Voice-Backend** (Admin wählt MESH ↔ LIVEKIT; Mesh bleibt Standard):
  - Settings `voiceBackend` ('MESH'|'LIVEKIT') + `livekitUrl`; Env `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`.
  - `lib/livekit.ts` `createLivekitToken` (dependency-freies HS256-JWT, Grant im `video`-Claim, identity=userId,
    room=`conv_<conversationId>`, 6 h). `ChatService.config` meldet Backend+URL (ICE nur bei MESH); `ChatService.voiceToken`
    (nur Mitglieder, nur wenn LiveKit konfiguriert). Route `GET /api/chat/voice/token?conversationId=`.
  - Web: `pages/chat/livekit.ts` (livekit-client: Room beitreten, Mikro publizieren, Remote-Audio anhängen); `voice.ts`
    ist jetzt eine Weiche (Mesh **oder** LiveKit fürs Medium, WS-Hub weiterhin für Teilnehmer-Anzeige). Admin-UI
    (SettingsPage) Backend-Auswahl + wss-URL; i18n `admin.settingsPage.voice*`/`livekitUrl*`. ApiClient `chat.voiceToken`.
  - Infra: `docker compose --profile voice-sfu` (livekit/livekit-server, host-net, LIVEKIT_NODE_IP); `.env.example` + README.
  - Tests: `test/voice.test.ts` (5, grün): JWT-Claims/Signatur, Token-Route (Mitglied/Nicht-Mitglied/unkonfiguriert),
    config-Backend. Gesamt 123 Server-Tests grün.
- **Offen #20:** Live-Test des LiveKit-Medienpfads braucht einen laufenden LiveKit-Server (in der Sandbox nicht möglich);
  Code + Token sind getestet, die Medien-Verbindung verifiziert der Nutzer gegen seine Instanz. Fluxer-Identitäts-SSO
  (optional) nicht gebaut.

### #21 Voice-Server auf Main-Server + konfigurierbares Failover (umgesetzt)
- Nutzer-Wunsch: LiveKit-Voice läuft primär auf dem Main-Server; im Admin-Panel konfigurierbar, **ob und welche** Server
  **in welcher Reihenfolge** einspringen, wenn der primäre ausfällt.
- **Schema/Settings**: neues Feld `AdminSettings.voiceServers: VoiceServerConfig[]` (`{name?, url, apiKey?, apiSecret?}`),
  geordnet (Index 0 = Primär/Main-Server, danach Fallbacks). Leere `apiKey`/`apiSecret` je Eintrag = `LIVEKIT_API_KEY/SECRET`
  aus der Umgebung. Altes Einzelfeld `livekitUrl` bleibt als Rückfall (leere Liste → eine URL mit Env-Zugangsdaten).
  `VoiceServerConfig`/`VoiceServerStatus` in `packages/shared/src/types.ts`; `VoiceToken` um `name?` erweitert.
- **Dienst** `apps/server/src/services/voice.ts`: `resolveVoiceServers(settings, env)` (Liste auflösen, Env-Zugangsdaten
  ergänzen, ungültige URLs/ohne Creds verwerfen), `probeLivekit(url)` (HTTP-GET auf wss→https, jede Antwort = erreichbar,
  2,5 s Timeout), `class VoiceFailover` (Erreichbarkeits-Cache 30 s TTL; `pick()` = erster erreichbarer, bei einem Server
  **ohne** Probe, keiner erreichbar → Primär als best effort; `status()` für die Anzeige). `probe` ist für Tests injizierbar.
- **ChatService**: eigene `voiceFailover`-Instanz. `voiceToken` wählt per Failover den Server und signiert mit **dessen**
  Key/Secret (gibt `url`+`name` des gewählten Servers zurück). `config()` meldet die Primär-URL als „ist konfiguriert"-Signal.
  Neue Methode `voiceStatus()` (für Admin). Route `GET /api/admin/voice/status` (nur Admin). ApiClient `admin.voiceStatus`.
- **Admin-Settings-Route**: Secrets werden im GET maskiert (`********`), beim PATCH per URL-Zuordnung erhalten, wenn leer/
  maskiert gesendet; Audit-Log redigiert die Secrets. Zod-Schema `voiceServers` (max 10).
- **Web**: Komponente `VoiceServersEditor` in `pages/admin/SettingsPage.tsx` (Liste: Name/URL/Key/Secret je Eintrag,
  hoch/runter/entfernen/hinzufügen, Live-Status-Punkte „erreichbar/aktiv" via `admin.voiceStatus`). i18n `admin.settingsPage.voice*`
  (DE+EN). Secret-Felder maskiert (Typ password), Platzhalter „aus Server-Umgebung".
- **Client**: keine Änderung nötig – der Client nutzt die vom Token gelieferte `url`; den Failover entscheidet der Server.
- **Tests** `test/voice.test.ts` (+11, gesamt 16): `resolveVoiceServers` (Rückfall/Reihenfolge/Verwerfen), `VoiceFailover`
  (ein Server ohne Probe, erster erreichbarer, Fallback, keiner erreichbar, leer, Cache), Routen-Failover (zweiter Server
  gewählt), Secret-Maskierung + Erhalt. Gesamt **134 Server-Tests grün**, Web i18n grün.
- **Offen #21**: Health-Probe prüft aus Sicht des Servers (nicht des Clients); aktuell neue Beitritte wechseln den Server,
  eine laufende Sitzung wird nicht umgezogen. Kein automatischer Medien-Live-Test in der Sandbox.

## Konventionen

- Code-Kommentare und UI-Texte auf Deutsch (UI zusätzlich Englisch), Fehlermeldungen der API auf Deutsch mit maschinenlesbarem `error`-Code.
- Neue API-Routen: Zod-Schemas für body/query/params, `tags` + `summary` für OpenAPI, Audit-Log bei Admin-/Sicherheitsaktionen.
- Neue Strings immer in `de.ts` **und** `en.ts`.
- Commits mit Attribution-Trailer laut Sitzungsvorgabe; kein Modellname in Commits/Code.
