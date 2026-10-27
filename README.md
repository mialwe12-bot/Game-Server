# 🎮 Game Server – selbst gehostete, DRM-freie Spieleplattform

Eine Spieleplattform nach dem Vorbild von Steam – aber **komplett selbst gehostet, 100 % Open Source,
ohne Paywall, ohne Premium-Features, ohne Telemetrie und ohne Zahlungsabwicklung**. Alle Spiele sind für
die Nutzer kostenlos; die Plattform verteilt DRM-freie Spiele, die du selbst hochlädst.

| Komponente | Technik | Ort |
| --- | --- | --- |
| Server (REST + OpenAPI + WebSocket) | Node.js 22, TypeScript, Fastify 5, Prisma 6, PostgreSQL | `apps/server` |
| Web-Store + Admin-Panel | React 19, Vite, Tailwind CSS 4, TanStack Query, i18next (DE/EN), Dark/Light | `apps/web` |
| Gemeinsame Typen + API-Client + fortsetzbarer Upload | TypeScript | `packages/shared` |
| Desktop-Client (Windows/Linux, Tauri) | **Phase 2** – eigenes Repository [`mialwe12-bot/game-client`](https://github.com/mialwe12-bot/game-client) | – |

> **Status:** Phase 1 (Server, Web-Store, Admin-Panel) ist fertig. Siehe [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Inhalt

- [Funktionen (Phase 1)](#funktionen-phase-1)
- [Schnellstart mit Docker Compose + Caddy](#schnellstart-mit-docker-compose--caddy)
- [Erster Admin (Seed-Skript)](#erster-admin-seed-skript)
- [Konfiguration](#konfiguration)
- [Spiele hochladen – Ablauf](#spiele-hochladen--ablauf)
- [Entwicklung](#entwicklung)
- [Tests](#tests)
- [Build](#build)
- [Backups & Wiederherstellung](#backups--wiederherstellung)
- [Sicherheit](#sicherheit)
- [API](#api)
- [Bekannte Einschränkungen](#bekannte-einschränkungen)
- [Lizenz](#lizenz)

---

## Funktionen (Phase 1)

**Accounts**
- Registrierung mit drei Modi (Admin-Einstellung): offen, nur mit Einladung, geschlossen
- Login per Benutzername oder E-Mail, Passwörter mit **Argon2id**
- **2FA (TOTP)** mit QR-Code, Replay-Schutz und 10 Recovery-Codes
- Passwort-Reset per **SMTP** (Link 1 h gültig, beendet alle Sitzungen)
- Optional **OIDC/SSO** (Authentik, Keycloak, Authelia …) mit Auto-Registrierung, E-Mail-Verknüpfung und Admin-Gruppe
- Rollen **Admin, Uploader, Nutzer**; Profil mit Avatar, Anzeigename, Bio, Sprache
- Sitzungsverwaltung: Web-Sessions (Cookie) und **Device-Tokens** für den Desktop-Client – einzeln widerrufbar

**Admin-Panel**
- **Chunked, fortsetzbarer Upload** mehrerer GB direkt im Browser: Fortschritt, Geschwindigkeit, Restzeit, Pause/Fortsetzen,
  automatische Wiederholung nach Netzwerkfehlern, Warteschlange (3 parallel), Fortsetzen nach Reload durch erneute Dateiauswahl
- Pro Spiel mehrere **Versionen** (Changelog, veröffentlichen/zurückziehen) und je Version ein **Build pro Plattform**
  (Windows/Linux/macOS)
- Formate: **ZIP, 7z, Ordner (Einzeldateien, per Ordner-Upload) oder fertiger Installer**; Dateiendungs- und Magic-Byte-Prüfung,
  **SHA-256-Prüfsumme** jeder Datei (optional gegen erwartete Prüfsumme validiert)
- **Startkonfiguration** pro Build: Startdatei, Startparameter, Arbeitsverzeichnis, Installer-Parameter, Installationsgröße,
  **Linux-Start per Proton/Wine** (für Windows-Builds)
- **Metadaten** manuell (Markdown) und automatisch von **IGDB** oder **RAWG**: Titel, Beschreibung, Cover/Header/Hintergrund,
  Screenshots, Trailer, Genres, Tags, Entwickler, Publisher, Release, Systemanforderungen, Webseite – feldweise auswählbar
- Medienverwaltung: Cover, Header, Hintergrund, Screenshots, Artworks (sortierbar), Trailer (YouTube/MP4)
- **Rechte pro Spiel**: Maintainer (dürfen bearbeiten/hochladen) und Zugriffsliste für eingeschränkte Spiele;
  Sichtbarkeit Öffentlich / Nicht gelistet / Eingeschränkt / Versteckt (Entwurf)
- Nutzer-, Rollen- und Rechteverwaltung (sperren, 2FA zurücksetzen, Passwort setzen, Sitzungen widerrufen, Upload-Kontingent)
- **Einladungslinks** (Rolle, max. Nutzungen, Ablaufdatum, Notiz)
- **Speicherübersicht** (Datenträger, pro Spiel, Medien, unfertige Uploads, Backups) und Liste aktiver Uploads
- **Limits**: max. Dateigröße, Standard-Kontingent pro Uploader, parallele Uploads, Chunkgröße, **Download-Bandbreitenlimit**
- **Logs**: Audit-Log (alle sicherheitsrelevanten Aktionen) und Server-Log (Live-Ansicht)
- **Backups** (Datenbank oder Datenbank + Dateien) manuell oder per Zeitplan, mit Aufbewahrungsregel, Download im Browser
- **Wartungsmodus** (nur Admins haben Zugriff, Nachricht in Markdown, Live-Benachrichtigung per WebSocket)
- Ankündigungen (Markdown, angeheftet, optional einem Spiel zugeordnet)

**Store**
- Startseite: hervorgehobene Spiele (Karussell), **Empfehlungen anhand der Spielzeit**, Neuzugänge, Beliebtes, Ankündigungen
- Suche mit Relevanz-Ranking, Filter nach Genres, Tags und Plattform, Sortierung, Paginierung
- Detailseite: Galerie mit Screenshots und Trailern, Beschreibung, Systemanforderungen pro Plattform, Versionen/Changelogs,
  Downloads pro Plattform (HTTP-Range-fähig), ähnliche Spiele
- **Wunschliste** und **Entdeckungs-Queue** (Nicht interessiert / Wunschliste / Bibliothek)

**Bibliothek (Web)**
- Alle Spiele, Favoriten, ausgeblendete Spiele, **Sammlungen**
- Spielzeit und „zuletzt gespielt“ (vom Desktop-Client gemeldet), Sortierung nach Name/zuletzt gespielt/Spielzeit/hinzugefügt,
  Raster- und Listenansicht

**Allgemein**
- Responsive, Dark/Light/System-Theme, Deutsch/Englisch
- REST-API mit **OpenAPI 3** (`/api/openapi.json`, Swagger-UI unter `/api/docs`) und **WebSocket** (`/api/ws`)

---

## Schnellstart mit Docker Compose + Caddy

Voraussetzungen: Docker mit Compose-Plugin und ein laufender **Caddy** im externen Docker-Netzwerk `reverse-proxy`.

```bash
git clone https://github.com/mialwe12-bot/Game-Server.git
cd Game-Server

# Netzwerk anlegen (falls noch nicht vorhanden) – Caddy muss ebenfalls darin hängen
docker network create reverse-proxy

# Konfiguration
cp .env.example .env
#   PUBLIC_URL, POSTGRES_PASSWORD (z. B. `openssl rand -hex 24`), optional SMTP/OIDC/IGDB/RAWG anpassen
#   DATA_PATH auf eine große Platte zeigen lassen (Spieldateien!)

docker compose up -d --build
```

**Caddyfile-Eintrag** (Datei [`deploy/Caddyfile`](deploy/Caddyfile)) in die Caddy-Konfiguration übernehmen und Caddy neu laden:

```caddyfile
games.example.com {
	encode zstd gzip
	handle /api/* {
		reverse_proxy gameserver-server:3000 {
			flush_interval -1
			transport http {
				read_timeout 0
				write_timeout 0
			}
		}
	}
	handle {
		reverse_proxy gameserver-web:80
	}
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		-Server
	}
}
```

Die Container `gameserver-server` und `gameserver-web` hängen im Netzwerk `reverse-proxy`, Postgres nur im internen Netz.
Datenbankmigrationen werden beim Start des Servers automatisch angewendet.

### Erster Admin (Seed-Skript)

```bash
# interaktiv (fragt Benutzername, E-Mail, Passwort)
docker compose exec server node dist/seed.js

# oder nicht-interaktiv, optional mit Demo-Einträgen
docker compose exec server node dist/seed.js --username admin --email admin@example.com --password 'mind. 10 Zeichen' --demo
```

Das Skript legt den Admin an (oder macht einen bestehenden Nutzer zum Admin und setzt dessen Passwort) und erzeugt Standard-Genres.
`--demo` legt zusätzlich einige Demo-Spieleinträge (ohne Dateien) und eine Ankündigung an.

Danach unter `https://games.example.com/login` anmelden → **Verwaltung → Einladungen** für weitere Nutzer.

---

## Konfiguration

Alle Optionen stehen kommentiert in [`.env.example`](.env.example). Die wichtigsten:

| Variable | Bedeutung |
| --- | --- |
| `PUBLIC_URL` | Öffentliche URL (Links in E-Mails/Einladungen, SSO-Redirect) |
| `POSTGRES_*` | Datenbank-Zugang (für Postgres-Container und Server) |
| `DATA_PATH` | Host-Pfad für Spieldateien, Medien, Avatare, Backups (`/data` im Container) |
| `COOKIE_SECURE` | `true` hinter HTTPS |
| `SESSION_TTL_DAYS` / `DEVICE_TTL_DAYS` | Gültigkeit von Web-Sessions / Device-Tokens (gleitend) |
| `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` | Anfragen pro Minute und IP (global / Login, Registrierung, Reset) |
| `CORS_ORIGINS` | Origins des Desktop-Clients (Tauri) |
| `SMTP_*` | E-Mail-Versand (Passwort-Reset). Leer = deaktiviert |
| `OIDC_*` | Optionales SSO. Redirect-URI: `${PUBLIC_URL}/api/auth/oidc/callback` |
| `RAWG_API_KEY`, `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` | Optionaler Metadaten-Import |

Laufzeit-Einstellungen (Registrierungsmodus, Wartungsmodus, Limits, Backup-Zeitplan, öffentlicher Store) werden im
Admin-Panel unter **Verwaltung → Einstellungen** gesetzt und in der Datenbank gespeichert.

---

## Spiele hochladen – Ablauf

1. **Verwaltung → Spiele → Neues Spiel** – Titel eingeben.
2. **Details** ausfüllen oder unter **Metadaten-Import** von IGDB/RAWG übernehmen; **Medien** hochladen.
3. **Versionen & Builds → Neue Version** (z. B. `1.0.0`, Changelog in Markdown).
4. **Build hinzufügen** pro Plattform und Format:
   - *ZIP / 7z*: Archiv hochladen; Startdatei = Pfad **nach dem Entpacken** (z. B. `Game/Game.exe`)
   - *Ordner*: kompletten Spielordner per „Ordner hochladen“ wählen (der oberste Ordnername wird entfernt) – ideal für
     spätere Delta-Updates, weil jede Datei einzeln mit Prüfsumme gespeichert wird
   - *Installer*: `.exe/.msi/.sh/.run/.deb/.AppImage/…` plus optionale Installer-Parameter (z. B. `/S`)
   - Windows-Builds: optional „Unter Linux per Proton/Wine starten“
5. Startkonfiguration speichern → **Als bereit markieren** (prüft u. a., ob die Startdatei im Ordner-Build existiert).
6. **Veröffentlichen** und unter **Details → Sichtbarkeit** auf *Öffentlich* stellen.

Uploads laufen in einer Warteschlange weiter, während du im Admin-Panel navigierst. Wird die Seite geschlossen oder die
Verbindung unterbrochen, einfach dieselbe Datei erneut auswählen – der Upload wird am Server-Offset fortgesetzt.

---

## Entwicklung

Voraussetzungen: **Node.js ≥ 22**, **pnpm 10** (`corepack enable`), **PostgreSQL 16/17** (lokal oder per Docker).

```bash
pnpm install

# Datenbank bereitstellen, z. B.:
docker run -d --name gs-postgres -e POSTGRES_USER=gs -e POSTGRES_PASSWORD=gs -e POSTGRES_DB=gameserver -p 5432:5432 postgres:17-alpine

# .env für die Entwicklung
cat > .env <<'ENV'
DATABASE_URL=postgresql://gs:gs@localhost:5432/gameserver
DATA_DIR=./data
PUBLIC_URL=http://localhost:5173
COOKIE_SECURE=false
ENV

pnpm --filter @gameserver/shared build      # Typen für den Server
pnpm db:migrate                              # Migrationen anwenden
pnpm seed --username admin --email admin@example.com --password admin-passwort-123 --demo
pnpm dev                                     # Server :3000 + Web :5173 (Vite-Proxy für /api inkl. WebSocket)
```

Danach <http://localhost:5173> öffnen. Swagger-UI: <http://localhost:5173/api/docs>.

Nützliche Befehle:

| Befehl | Zweck |
| --- | --- |
| `pnpm typecheck` | TypeScript-Prüfung aller Pakete |
| `pnpm test` | Alle Tests |
| `pnpm --filter @gameserver/server db:migrate:dev --name <name>` | Neue Prisma-Migration erzeugen |
| `pnpm --filter @gameserver/server openapi openapi.json` | OpenAPI-Spezifikation exportieren |

Projektstruktur:

```
apps/server     Fastify-API (src/routes, src/services, src/lib), Prisma-Schema + Migrationen, Tests (test/)
apps/web        React-Frontend: Store, Bibliothek, Konto, Admin-Panel (src/pages/admin)
packages/shared API-Typen, typisierter ApiClient, ResumableUpload (Browser + Tauri), Formatierer
deploy/         Caddyfile-Eintrag
docs/           Roadmap, Architekturentscheidungen
```

---

## Tests

```bash
# Testdatenbank anlegen (einmalig), Standard: postgresql://gs:gs@localhost:5432/gameserver_test
createdb -U gs gameserver_test        # oder per psql/Docker
pnpm test
```

- `apps/server`: Unit-Tests (TOTP nach RFC 6238, HTTP-Range-Parser, Bandbreitendrossel, Pfad-Normalisierung, Empfehlungslogik)
  und **API-Integrationstests** gegen eine echte PostgreSQL: Registrierungsmodi, Login, CSRF, Device-Tokens/Widerruf, 2FA inkl.
  Replay-Schutz und Recovery-Codes, Passwort-Reset, Wartungsmodus, Rechte pro Spiel, Sichtbarkeiten, **chunked Upload mit
  Pause/Fortsetzen, Offset-Konflikt, Prüfsummen, Archivprüfung, Kontingent**, **Downloads mit Range/HEAD/ETag/Drosselung**,
  Medien, Store-Suche/Filter/Empfehlungen/Entdeckungs-Queue, Bibliothek/Sammlungen/Spielzeit, Admin (Nutzer, Einladungen,
  Einstellungen, Speicher, Backups mit `pg_dump`), OpenAPI, Sicherheitsheader und Rate-Limiting.
  Andere Testdatenbank: `DATABASE_URL_TEST=… pnpm test`.
- `packages/shared`: Upload-Client (Chunks, Wiederholung nach Netzwerkfehler, Pause/Fortsetzen) und Formatierer.
- Die Tests für den **Download-Manager des Desktop-Clients** folgen mit Phase 2.

---

## Build

```bash
pnpm build                      # shared → server (dist/) → web (apps/web/dist)
docker compose build            # Container-Images gameserver-server und gameserver-web
```

Der Server-Container enthält `pg_dump` (PostgreSQL 17) für Backups und startet als unprivilegierter Nutzer `node`.

---

## Backups & Wiederherstellung

Backups liegen als `.tar.gz` in `DATA_PATH/backups` und enthalten `database.dump` (pg_dump Custom-Format), `backup.json` und –
bei vollständigen Backups – die Ordner `builds/`, `media/`, `avatars/`.

Wiederherstellung (Beispiel):

```bash
docker compose stop server
mkdir restore && tar -xzf data/backups/backup-<datum>-full.tar.gz -C restore

# Datenbank zurückspielen
docker compose exec -T postgres pg_restore -U gameserver -d gameserver --clean --if-exists --no-owner < restore/database.dump

# Dateien zurückkopieren (nur bei vollständigen Backups)
cp -a restore/builds restore/media restore/avatars data/

docker compose start server
```

Für große Spielebibliotheken empfiehlt sich zusätzlich ein dateibasiertes Backup von `DATA_PATH` (z. B. restic, borg).

---

## Sicherheit

- **Argon2id** (OWASP-Parameter), Timing-Schutz bei unbekannten Konten
- Web: **httpOnly-SameSite-Cookie** + **CSRF-Token** (Header `X-CSRF-Token`) für alle schreibenden Requests;
  Desktop-Client: **Bearer-Device-Token** (`gsd_…`), nur als SHA-256-Hash gespeichert, einzeln widerrufbar
- **Rate-Limiting** global und verschärft für Login/Registrierung/Reset/2FA
- **XSS-Schutz**: React-Escaping, Markdown ohne rohes HTML, strikte **CSP** im Web-Container, Uploads nur mit geprüften
  Bild-Magic-Bytes (kein SVG), `X-Content-Type-Options: nosniff`, Helmet-Header auf der API
- **Path-Traversal-Schutz** für Build-Dateipfade und Storage-Keys
- **Rechte pro Spiel** (Maintainer, Zugriffsliste, Sichtbarkeit) und Audit-Log aller sicherheitsrelevanten Aktionen
- Keine Telemetrie, keine externen Aufrufe außer optional SMTP, OIDC, IGDB/RAWG (nur auf Admin-Aktion) und eingebettete YouTube-Trailer
  (über `youtube-nocookie.com`)

---

## API

- OpenAPI 3: `GET /api/openapi.json`, Swagger-UI: `/api/docs`
- Authentifizierung: Cookie (`gs_session`) + `X-CSRF-Token` oder `Authorization: Bearer gsd_…`
- WebSocket `/api/ws` (JSON-Ereignisse: `maintenance`, `upload.completed`, `backup.updated`, `announcement.created`,
  `library.updated`, `session.revoked`)
- Upload-Protokoll: `POST /api/uploads` → `PATCH /api/uploads/:id` (Header `Upload-Offset`, Body
  `application/offset+octet-stream`) → bei Abbruch `GET /api/uploads/:id` für den aktuellen Offset
- Downloads: `GET /api/builds/:id/manifest` (Dateien mit Größe und SHA-256), `GET /api/builds/:id/files/:fileId` mit
  HTTP-Range, `HEAD`, `ETag`/`If-Range`

Ein typisierter Client steht in `packages/shared` (`ApiClient`, `ResumableUpload`) bereit.

---

## Bekannte Einschränkungen

- **Ordner-Builds im Browser herunterladen**: Der Browser kann keinen ganzen Ordner auf einmal speichern; der Store zeigt die
  Einzeldateien. Komfortabel geht das mit dem Desktop-Client (Phase 2).
- **Ordner-Upload** nutzt `webkitdirectory` (Chrome, Edge, Firefox, Safari). Bei sehr vielen kleinen Dateien ist ein Archiv schneller.
- **Fortsetzen nach Reload**: Aus Sicherheitsgründen darf eine Webseite Dateien nicht selbst erneut öffnen – die Datei muss nach einem
  Reload neu ausgewählt werden; der Upload setzt dann am Server-Offset fort.
- **Archivinhalt** (ZIP/7z) wird serverseitig nur auf das Format geprüft, nicht entpackt; die Startdatei wird daher erst vom
  Desktop-Client verifiziert.
- **Metadaten-Import** benötigt eigene API-Schlüssel für IGDB (Twitch) bzw. RAWG.
- **Vollständige Backups** kopieren alle Spieldateien und benötigen entsprechend Platz und Zeit.

---

## Lizenz

[GNU AGPL-3.0-or-later](LICENSE) – freie Software. Wer eine veränderte Version als Netzwerkdienst betreibt, muss den
Quellcode der Änderungen ebenfalls bereitstellen.
