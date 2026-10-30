# 🎮 Game Server – selbst gehostete, DRM-freie Spieleplattform

Eine Spieleplattform nach dem Vorbild von Steam – aber **komplett selbst gehostet, 100 % Open Source,
ohne Paywall, ohne Premium-Features, ohne Telemetrie und ohne Zahlungsabwicklung**. Alle Spiele sind für
die Nutzer kostenlos; die Plattform verteilt DRM-freie Spiele, die du selbst hochlädst.

| Komponente | Technik | Ort |
| --- | --- | --- |
| Server (REST + OpenAPI + WebSocket) | Node.js 22, TypeScript, Fastify 5, Prisma 6, PostgreSQL | `apps/server` |
| Web-Store + Admin-Panel | React 19, Vite, Tailwind CSS 4, TanStack Query, i18next (DE/EN), Dark/Light | `apps/web` |
| Gemeinsame Typen + API-Client + fortsetzbarer Upload | TypeScript | `packages/shared` |
| Desktop-Client (Windows/Linux, Tauri 2 + Rust) | eigenes Repository [`mialwe12-bot/game-client`](https://github.com/mialwe12-bot/game-client), nutzt `apps/web` als Submodul | – |

> **Status:** Phase 1 (Server, Web-Store, Admin-Panel), Phase 2 (Desktop-Client-Kern) und Phase 3 (Soziales) sind fertig.
> Siehe [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Inhalt

- [Funktionen (Phase 1)](#funktionen-phase-1)
- [Soziale Funktionen (Phase 3)](#soziale-funktionen-phase-3)
- [Steam-Funktionen (Phase 4)](#steam-funktionen-phase-4)
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
- [Desktop-Client](#desktop-client)
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

## Soziale Funktionen (Phase 3)

**Freunde & Präsenz**
- Freundschaftsanfragen (per Suche oder Profil), annehmen/ablehnen/zurückziehen, gegenseitige Anfrage = sofort befreundet
- **Online-Status** und **„spielt gerade …“** (meldet der Desktop-Client beim Spielstart), „zuletzt online“
- Freunde zu einem Spiel **einladen**, Nutzer **blockieren** (beendet Freundschaft, verhindert Anfragen, Chat, Einladungen und Suche)
- Freundschaftsanfragen lassen sich im Profil abschalten

**Profile**
- Hintergrundbild, Akzentfarbe, bis zu sechs **Vitrinen** (Lieblingsspiel, Statistiken, zuletzt gespielt, Screenshots, Reviews,
  Gruppen, Abzeichen, Freitext in Markdown)
- **Abzeichen** aus Meilensteinen (Sammler, Vielspieler, Kritiker, Gesellig, Fotograf, Veteran – je mit Stufen),
  **Statistiken** und **Aktivitäten**
- Privatsphäre: Profil für alle, nur Freunde oder nur mich

**Chat**
- **Direktnachrichten** (nur unter Freunden), **Gruppenchats** (bis 50 Personen) und **Kanäle** in Gruppen
- Text mit Links, **Emoji-Auswahl**, **Bilder** (Upload oder Einfügen aus der Zwischenablage), optional **GIFs** (Tenor),
  Bearbeiten/Löschen, Lesestatus/Ungelesen-Zähler, Tipp-Anzeige, Stummschalten
- Optionaler **Sprachchat** (WebRTC) in jeder Unterhaltung – siehe [Sprachchat](#sprachchat-webrtc)

**Gruppen**
- Gruppenseite mit Banner, Bild, Beschreibung (Markdown); offen, auf Anfrage oder nur auf Einladung; öffentlich oder versteckt
- Rollen Gründer/Moderator/Mitglied, Leitung übertragen, Einladungen, Beitrittsanfragen
- **Ankündigungen**, **Events** (mit Spiel, Zusagen „dabei/vielleicht/kann nicht“ und automatischer **Erinnerung** ~1 h vorher),
  **Chat-Kanäle** (Mitgliedschaft folgt automatisch der Gruppe)

**Community pro Spiel** (Tabs auf der Spieleseite)
- **Reviews** (Daumen hoch/runter + Text, nur mit Spiel in der Bibliothek, Spielzeit zum Zeitpunkt des Reviews), Bewertung
  „hilfreich/nicht hilfreich/lustig“, Gesamtbewertung („Sehr positiv“, „Ausgeglichen“ …)
- **Forum** mit Themen, Antworten (Markdown), Anheften/Schließen/Löschen durch Admins und Maintainer des Spiels
- **Screenshots**, **Artworks** und **Guides** (Markdown) mit „Gefällt mir“, **News** (Ankündigungen zum Spiel)

**Benachrichtigungen & Feed**
- In-App (Glocke, Live per WebSocket), im Desktop-Client als **Systembenachrichtigung**, im Browser optional per
  Notification-API, per **E-Mail** (nur wenn offline; pro Kategorie abschaltbar)
- **Aktivitäts-Feed** mit eigenen Aktivitäten und denen von Freunden

### Sprachchat (WebRTC)

Der Sprachchat ist ein **Mesh** – jeder Teilnehmer verbindet sich direkt mit jedem anderen; der Server vermittelt nur die
Signalisierung über den WebSocket. Das ist ohne Medienserver betreibbar und eignet sich gut für **bis ca. 6 Personen**.

1. In **Verwaltung → Einstellungen → Soziales** „Sprachchat erlauben“ aktivieren.
2. Im selben Netzwerk funktioniert das sofort. Über das Internet (NAT) wird ein STUN/TURN-Server benötigt. Standardmäßig ist
   **kein** externer STUN-Server eingetragen (keine Daten an Dritte). Mitgeliefert ist ein optionaler **coturn**-Container:

   ```bash
   # .env
   WEBRTC_TURN_SECRET=$(openssl rand -hex 32)
   WEBRTC_STUN_URLS=stun:games.example.com:3478
   WEBRTC_TURN_URLS=turn:games.example.com:3478?transport=udp,turn:games.example.com:3478?transport=tcp
   docker compose --profile voice up -d
   ```

   Ports `3478/udp+tcp` und `49160-49200/udp` freigeben. Die TURN-Zugangsdaten erzeugt der Server zeitlich begrenzt (12 h)
   per HMAC (`use-auth-secret`).
3. Browser verlangen für das Mikrofon HTTPS (oder `localhost`). Im Desktop-Client fragt Windows (WebView2) nach der Freigabe;
   unter Linux gibt der Client nur das **Mikrofon** frei (Kamera bleibt gesperrt).

#### Eigener Voice-SFU (LiveKit)

Das Mesh ist bis ca. 6 Personen sinnvoll. Für größere Räume, bessere Qualität und Screenshare kannst du einen eigenen
**LiveKit-SFU** als Voice-Backend betreiben – alles selbst gehostet, keine Fremd-API:

1. In `.env` setzen: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (frei wählbar), `LIVEKIT_NODE_IP` (öffentliche Server-IP).
2. Starten: `docker compose --profile voice-sfu up -d`. Ports `7880/tcp`, `7881/tcp`, `50000-60000/udp` freigeben; `7880`
   per Caddy als `wss://voice.<deine-domain>` terminieren.
3. In **Verwaltung → Einstellungen → Soziales**: „Sprachchat erlauben“ an, **Voice-Backend = LiveKit**, Adresse
   `wss://voice.<deine-domain>` eintragen.

Der Server stellt pro Unterhaltung ein zeitlich begrenztes LiveKit-Token aus (nur Mitglieder); die Teilnehmer-Anzeige
läuft weiter über den WebSocket-Hub. Umschalten Mesh ↔ LiveKit geht jederzeit im Admin-Panel.

### GIFs

Mit `TENOR_API_KEY` (kostenlos, Google Cloud Console) und aktivierter Einstellung „GIF-Suche“ erscheint im Chat ein GIF-Knopf.
Die Suche läuft über den Server; beim **Anzeigen** lädt der Client die GIFs direkt von `media.tenor.com`. Ohne Schlüssel bleibt
die Funktion aus.

---

## Steam-Funktionen (Phase 4)

Alle Funktionen lassen sich unter **Verwaltung → Einstellungen → Steam-Funktionen** einzeln abschalten
(Cloud-Saves, Workshop, Sammelkarten, Marktplatz, Geschenke) – ohne echtes Geld, ohne Bezahlfunktionen.

**Cloud-Spielstände**
- Pro Spiel legt der Admin unter **Spiel bearbeiten → Funktionen** Save-Pfade fest, je Plattform (Windows/Linux/alle) mit
  Platzhaltern `%APPDATA%`, `%LOCALAPPDATA%`, `%USERPROFILE%`, `%DOCUMENTS%`, `%SAVEDGAMES%`, `$HOME`, `$XDG_DATA_HOME`,
  `$XDG_CONFIG_HOME`, `{install}`, `{prefix}` sowie Ein-/Ausschlussmustern (`*.sav`, `profiles/**/*.json`, …).
  Windows-Pfade werden unter Linux automatisch im Wine/Proton-Präfix des Spiels aufgelöst.
- Der Desktop-Client gleicht **vor dem Start** und **nach dem Beenden** ab (ZIP + Manifest mit SHA-256). Versionen pro Spiel
  (Anzahl einstellbar), Kontingent pro Nutzer, Wiederherstellen älterer Versionen unter **Cloud-Spielstände**.
- **Konflikt** = lokal geändert *und* seit dem letzten Abgleich neuere Version auf dem Server → Dialog „Lokal behalten /
  Cloud-Stand laden“; der verworfene Stand bleibt als ältere Version erhalten.

**Achievements**
- Admin/Maintainer legen sie pro Spiel an: Icon, Name, Beschreibung, **versteckt**, optional **Fortschritt** (z. B. 0/100),
  Reihenfolge (Pfeile), manuelle Vergabe/Entzug (Support).
- Freischaltung über das **SDK** (siehe unten) oder optional per **Erkennungsregel** (Datei existiert, Dateiinhalt bzw.
  Log-Zeile passt zu Regex) – der Client prüft die Regeln nach dem Spielende.
- **Seltenheit** in Prozent, Fortschrittsbalken, Toasts/Systembenachrichtigung beim Freischalten, Profil-Vitrine,
  Abzeichen „Jäger“, Übersicht pro Nutzer (`/u/<name>/achievements`).

**Workshop**
- Mods/Karten/Sonstiges pro Spiel hochladen (ZIP/7z, Größenlimit einstellbar), **Versionen** mit Änderungsnotizen,
  Vorschaubild, Tags, **Daumen-Bewertung**, **Kommentare**, **Abonnieren**.
- Der Client lädt abonnierte Inhalte automatisch nach `<Installation>/<Workshop-Ordner>/<Inhalt>/` (Prüfsumme, atomarer
  Austausch) – beim Start, vor dem Spielstart, nach einer Installation und sobald der Server ein Update meldet.

**Sammelkarten, Abzeichen, Level, Marktplatz**
- Admin legt Karten pro Spiel an; Spieler erhalten **Drops nach Spielzeit** (Intervall einstellbar, höchstens ein halbes Set
  pro Spiel). Ein vollständiges Set wird zu einem **Spiel-Abzeichen** (bis Stufe 5) verarbeitet und bringt **Erfahrung** →
  **Profil-Level** (auch Achievements geben etwas EP).
- **Tauschangebote** zwischen Nutzern und ein **Marktplatz** „Karte gegen Karte“ – ausdrücklich ohne Geld.

**Familie, Geschenke, Codes, Kindersicherung**
- **Familiengruppe** (Erwachsene/Kinder): Mitglieder sehen eingeschränkte Spiele der Familie (**Familienbibliothek**).
- **Geschenke** an Freunde oder Familienmitglieder (landen nach dem Annehmen in deren Bibliothek), **Aktivierungscodes**
  pro Spiel (Chargen, Mehrfachnutzung, Ablaufdatum, Sperren, CSV-Export), Einlösen unter **Geschenke & Codes**.
- **Altersfreigabe** pro Spiel (0/6/12/16/18) und **Kindersicherung** je Kind: höchste Altersstufe (Store, Suche, Bibliothek),
  **tägliches Spielzeitlimit** (Client warnt 5 Minuten vorher und beendet das Spiel), Chat bzw. Community-Beiträge erlauben.

**Big Picture, Overlay, Screenshots, Remote Play** (Desktop-Client, Details im Client-README)
- **Big-Picture-Modus** (`/big-picture`): Vollbild-Oberfläche mit räumlicher Fokus-Navigation per **Gamepad API**
  (Steuerkreuz/Stick, A/B, LB/RB) und Tastatur; Steam Deck im Gaming-Mode startet direkt darin.
- **Overlay** als eigenständiges Always-on-top-Fenster (Shift+Tab, nur während ein Spiel läuft): Freunde, Chat,
  Achievements, schwebender Browser, **Notizen pro Spiel** (serverseitig gespeichert), Screenshots.
- **Screenshots** per globalem Hotkey (F12), Screenshot-Manager, Upload in die Community des Spiels.
- **Remote Play** über **Sunshine/Moonlight** (Client trägt Spiele in Sunshine ein) und **Remote-Download/-Start** auf
  anderen eigenen Geräten („Auf anderem Gerät“ auf der Spieleseite, per WebSocket).

**Steam-Integration & Statistiken**
- Installierte Spiele als **Nicht-Steam-Verknüpfungen** in Steam eintragen (`shortcuts.vdf`, eigene Einträge werden erkannt
  und aktualisiert, fremde bleiben unangetastet), **Discord Rich Presence** (Anwendungs-ID in den Admin-Einstellungen),
  **Import vorhandener Spielordner** (Zuordnung per Name, Abgleich mit dem Build-Manifest).
- **Statistiken**: Spielzeit pro Woche (Diagramm mit Tabellenansicht) und pro Spiel, **Jahresrückblick** (Monate,
  Top-Spiele, längste Sitzung, Perzentil), **globale Top-Listen** (meistgespielt, meiste Besitzer, bestbewertet,
  Achievement-Jäger, höchste Level).

### Achievement-SDK

Der Desktop-Client startet jedes Spiel mit drei Umgebungsvariablen:

| Variable | Inhalt |
| --- | --- |
| `GS_API_URL` | Adresse des Servers |
| `GS_GAME_ID` | ID des Spiels |
| `GS_GAME_TOKEN` | Spielsitzungs-Token `gsg_…` (24 h gültig, nur für dieses Spiel/diesen Nutzer und nur `/api/sdk/*`) |

Kleine Bibliotheken (MIT-lizenziert, damit sie auch in proprietäre Spiele eingebunden werden dürfen) liegen unter
[`packages/sdk`](packages/sdk): **TypeScript/JavaScript** (`@gameserver/sdk`), **Python** (nur Standardbibliothek) und
**C** (libcurl; nutzbar aus C/C++, C#, Rust, Godot-GDExtension …). Alle puffern Freischaltungen offline und senden sie später.

```c
gs_sdk *sdk = gs_sdk_from_env();          /* NULL, wenn nicht über den Client gestartet */
gs_sdk_unlock(sdk, "FIRST_BLOOD", NULL);
gs_sdk_set_progress(sdk, "COLLECT_100", 42, NULL);
gs_sdk_flush(sdk);                        /* offline gepufferte Freischaltungen erneut senden */
gs_sdk_free(sdk);
```

HTTP direkt: `POST /api/sdk/achievements/<apiName>/unlock`, `POST /api/sdk/achievements/<apiName>/progress`
(`{"progress": 42}`), `GET /api/sdk/achievements` – jeweils mit `Authorization: Bearer $GS_GAME_TOKEN`.

---

## Schnellstart mit Docker Compose + Caddy

### Am einfachsten: Installationsskript

Auf einem Linux-Server (Debian/Ubuntu u. a.) als root:

```bash
curl -fsSL https://raw.githubusercontent.com/mialwe12-bot/Game-Server/claude/magical-archimedes-jb34jz/deploy/install.sh -o install.sh
sudo bash install.sh
```

Das Skript ([`deploy/install.sh`](deploy/install.sh)) installiert bei Bedarf Docker, lädt den Code nach `/opt/gameserver`,
erzeugt die `.env` mit zufälligen Passwörtern, richtet den Zugang ein (eigener Caddy mit automatischem HTTPS, vorhandener
Caddy oder HTTP auf Port 8080 zum Testen), startet alles und legt das erste Admin-Konto an. Erneut ausführen = Update.

### Manuell

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
| `APP_SECRET` | Geheimnis für signierte Bild-URLs (leer = automatisch erzeugt und in der DB gespeichert) |
| `TENOR_API_KEY` | Optionale GIF-Suche im Chat |
| `WEBRTC_STUN_URLS`, `WEBRTC_TURN_URLS`, `WEBRTC_TURN_SECRET` | STUN/TURN für den Sprachchat (siehe oben) |

Laufzeit-Einstellungen (Registrierungsmodus, Wartungsmodus, Limits, Backup-Zeitplan, öffentlicher Store, Sprachchat, GIFs,
max. Bildgröße im Chat, Cloud-Saves inkl. Versionen/Kontingent, Workshop inkl. Größenlimit, Sammelkarten/Marktplatz,
Geschenke, Karten-Drop-Intervall, Discord-Anwendungs-ID) werden im
Admin-Panel unter **Verwaltung → Einstellungen** gesetzt und in der Datenbank gespeichert.

### Branding

Unter **Verwaltung → Einstellungen → Branding** lassen sich der **angezeigte Name**, ein **Logo** (Web-Kopf und
Anmeldeseite), ein **Client-Logo** (Desktop-Client) und **eigenes CSS** festlegen. Das CSS wird in Web und Client
eingebunden und kann die Design-Variablen überschreiben, z. B. `:root { --accent: #e4572e; }`. Logos werden auf dem Server
gespeichert und unter `/api/branding/…` ausgeliefert.

### Updates

Unter **Verwaltung → Einstellungen → Updates** zeigt das Panel die laufende Version und prüft auf Knopfdruck, ob eine
neuere verfügbar ist (Quelle: `UPDATE_CHECK_URL`, Standard sind die offiziellen Releases dieses Projekts – es wird nur die
Versionsnummer abgefragt).

**Manuell aktualisieren** (immer möglich):

```bash
sudo bash /opt/gameserver/deploy/self-update.sh    # holt den neuesten Stand, baut die Container neu, startet sie
# gleichwertig: cd /opt/gameserver && git pull && docker compose up -d --build
```

Daten, `.env` und Datenbank bleiben erhalten; Migrationen laufen beim Serverstart automatisch.

**Ein-Klick-Update aus dem Panel**: Der Server-Container kann sich nicht selbst neu bauen, daher schreibt
„Jetzt aktualisieren“ nur eine Markierungsdatei (`UPDATE_COMMAND=touch /data/.update-requested`), die ein kleiner
**Host-Watcher** (`deploy/update-watcher.sh`) erkennt und dann `self-update.sh` ausführt. `install.sh` richtet das auf
Wunsch als systemd-Dienst ein (Frage bei der Installation, oder `GS_ONECLICK_UPDATE=yes`). Ohne diese Einrichtung zeigt
das Panel nur den manuellen Befehl an – es werden keine erhöhten Rechte in den Container gelegt.

Der **Desktop-Client** aktualisiert sich selbst (siehe Client-README): er prüft beim Start
auf Updates, zeigt eine Hinweisleiste mit Knopf und installiert signierte Updates auf Wunsch automatisch.

---

## Server-Verbund (Föderation)

Mehrere Server lassen sich zu einem **Netzwerk** verbinden. Ein Spiel liegt nur auf seinem
Herkunftsserver, ist aber von allen verbundenen Servern aus sichtbar und herunterladbar – die
Bytes kommen dabei direkt vom Herkunftsserver (keine doppelte Bandbreite).

**Verbinden (zwei Admins):**

1. Admin A öffnet **Verwaltung → Netzwerk** und erzeugt einen **Pairing-Code**.
2. Admin A gibt Admin B die **Server-Adresse** von A und den **Code** (Code ist 15 Minuten gültig).
3. Admin B öffnet **Verwaltung → Netzwerk**, trägt unter „Mit einem anderen Server verbinden"
   A's Adresse + Code ein und klickt **Verbinden**. Beide Server vertrauen sich nun gegenseitig.

Danach erscheinen die öffentlichen Spiele des jeweils anderen Servers unter **Netzwerk** (im
Nutzermenü). Downloads einzelner Dateien laufen direkt; Ordner-Builds am besten über den Desktop-Client.

**Technik:** Jeder Server hat ein Ed25519-Schlüsselpaar; Server-zu-Server-Anfragen sind signiert.
Nur Spiele mit Sichtbarkeit **PUBLIC** werden geteilt. Die eigene Adresse ist `PUBLIC_URL`.
(Geplant: geteilte Accounts und gemeinsamer Chat über Server hinweg.)

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
  **Phase 3**: Freunde/Blockieren/Präsenz, Profile mit Privatsphäre und Vitrinen, Abzeichen, Chat (Rechte, Ungelesen,
  E-Mail nur bei erster ungelesener Nachricht, Bilder per signierter URL, GIF-Sperre), TURN-HMAC, Gruppen (Anfragen, Rollen,
  versteckte Gruppen, Kanal-Synchronisation, Events, Erinnerungen), Reviews/Bewertungsstufen/Stimmen, Forum, Community-Inhalte.
  Andere Testdatenbank: `DATABASE_URL_TEST=… pnpm test`.
- `packages/shared`: Upload-Client (Chunks, Wiederholung nach Netzwerkfehler, Pause/Fortsetzen) und Formatierer.
- `apps/web`: Prüfung, dass alle im Code verwendeten Übersetzungsschlüssel auf Deutsch und Englisch existieren.
- Die Tests für den **Download-Manager** liegen im Client-Repository (`cargo test -p gameserver-core`).

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
bei vollständigen Backups – die Ordner `builds/`, `media/`, `avatars/`, `social/` (Chat-, Profil-, Gruppen- und Community-Bilder).

Wiederherstellung (Beispiel):

```bash
docker compose stop server
mkdir restore && tar -xzf data/backups/backup-<datum>-full.tar.gz -C restore

# Datenbank zurückspielen
docker compose exec -T postgres pg_restore -U gameserver -d gameserver --clean --if-exists --no-owner < restore/database.dump

# Dateien zurückkopieren (nur bei vollständigen Backups)
cp -a restore/builds restore/media restore/avatars restore/social data/

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
- Nutzer-Uploads (Chat, Profile, Gruppen, Community) nur über **signierte, zeitlich begrenzte URLs** (HMAC, 7 Tage)
- Chat/Profile/Gruppen respektieren **Blockierungen** und **Privatsphäre**; versteckte Spiele bleiben auch in Community und Feed verborgen
- Keine Telemetrie, keine externen Aufrufe außer optional SMTP, OIDC, IGDB/RAWG (nur auf Admin-Aktion), Tenor (nur mit Schlüssel)
  und eingebettete YouTube-Trailer (über `youtube-nocookie.com`)

---

## API

- OpenAPI 3: `GET /api/openapi.json`, Swagger-UI: `/api/docs`
- Authentifizierung: Cookie (`gs_session`) + `X-CSRF-Token` oder `Authorization: Bearer gsd_…`
- WebSocket `/api/ws` (JSON-Ereignisse: `maintenance`, `upload.completed`, `backup.updated`, `announcement.created`,
  `library.updated`, `session.revoked`, `notification`, `presence`, `friends.changed`, `chat.message`, `chat.message.updated`,
  `chat.typing`, `chat.conversation`, `voice.participants`, `voice.signal`). Client → Server: `ping`, `chat.typing`,
  `voice.join`, `voice.leave`, `voice.signal`
- Soziales: `/api/friends`, `/api/users/search`, `/api/blocks/:id`, `/api/presence`, `/api/profiles/:username`, `/api/me/profile`,
  `/api/notifications`, `/api/feed`, `/api/chat/*`, `/api/groups/*`, `/api/community/*`, signierte Dateien `/api/files/social/…`
- Upload-Protokoll: `POST /api/uploads` → `PATCH /api/uploads/:id` (Header `Upload-Offset`, Body
  `application/offset+octet-stream`) → bei Abbruch `GET /api/uploads/:id` für den aktuellen Offset
- Downloads: `GET /api/builds/:id/manifest` (Dateien mit Größe und SHA-256), `GET /api/builds/:id/files/:fileId` mit
  HTTP-Range, `HEAD`, `ETag`/`If-Range`

Ein typisierter Client steht in `packages/shared` (`ApiClient`, `ResumableUpload`) bereit.

---

## Desktop-Client

Der Tauri-Client (Repository [`game-client`](https://github.com/mialwe12-bot/game-client)) verwendet dasselbe Frontend:
`apps/web` erkennt die Tauri-WebView und blendet zusätzlich ein:

- **Server-Einrichtung** (Adresse eingeben) und Login per **Device-Token**; SSO/Browser-Login über `/desktop-link`
  (der Browser übergibt ein neues Device-Token an einen lokalen Loopback-Port des Clients)
- **Downloads** (Warteschlange, Pause/Fortsetzen, Reihenfolge), **Installieren/Spielen/Beenden** auf der Spielseite,
  **Verwalten** (Startoptionen, Proton/Wine-Version, Umgebungsvariablen, Version/Rollback, Reparieren, Verknüpfungen,
  Deinstallation), Bibliotheksansicht **Installiert**, **Client-Einstellungen**, **Offline-Modus**
- Phase 4: Cloud-Abgleich mit Konfliktdialog, Workshop-Abos, Overlay-Fenster (`#/overlay`), Screenshot-Manager,
  Big-Picture-Modus, Integrationen (Steam-Verknüpfungen, Sunshine, Discord, Ordner-Import), Kindersicherungs-Timer,
  Fernbefehle „Installieren/Starten“ von anderen eigenen Geräten

Serverseitig dazu:

- **Verwaltung → Desktop-Client**: Releases mit Installern und Updater-Signaturen hochladen und veröffentlichen
- Tauri-Updater-Endpunkt `GET /api/client/update/{target}/{arch}/{currentVersion}` (204 = kein Update)
- Öffentliche Download-Seite `/client` (Link im Footer)
- WebSocket-Authentifizierung per Subprotokoll `bearer.<token>`; CORS für die Tauri-Origins ist standardmäßig aktiv

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
- **Sprachchat** ist ein WebRTC-Mesh: sinnvoll bis ca. 6 Personen; über das Internet nur mit STUN/TURN (optionaler coturn-Container).
  Für große Sprachkanäle wäre ein SFU (z. B. LiveKit) nötig – bewusst nicht enthalten.
- **Ingame-Overlay** ist ein eigenes Always-on-top-Fenster, **kein** Grafik-Hook (DirectX/Vulkan/OpenGL). Es erscheint daher
  nicht über Spielen im exklusiven Vollbild und nicht unter Gamescope (Steam Deck Gaming-Mode); randloses Vollbild bzw.
  Fenstermodus funktioniert. Ein echter Hook wäre pro Grafik-API nötig und wird von Anti-Cheat-Systemen oft blockiert.
- **Screenshots per Hotkey** nehmen den Bildschirm über System-APIs auf (X11, Wayland-Portal, Windows); im exklusiven
  Vollbild kann je nach Treiber ein schwarzes Bild entstehen. Unter Wayland fragt das System ggf. einmalig nach Erlaubnis.
- **Globale Hotkeys** (Shift+Tab, F12) sind nur aktiv, solange ein Spiel läuft; unter reinem Wayland ohne XWayland-Fokus
  können Compositoren globale Kürzel verweigern.
- **Remote Play** streamt nicht selbst, sondern bindet **Sunshine/Moonlight** an (eigenes Streaming mit niedriger Latenz wäre
  ein eigenes Projekt). Remote-Download/-Start funktioniert nur zu Geräten, die gerade online sind.
- **Achievement-Erkennung per Datei/Log** ist eine Heuristik; zuverlässig ist nur das SDK.
- **Cloud-Saves** gelten nur für Spiele mit hinterlegten Save-Pfaden; laufende Spiele werden nicht während des Spielens
  gesichert, sondern beim Beenden.
- **Steam-Verknüpfungen**: Steam liest `shortcuts.vdf` nur beim Start und überschreibt die Datei beim Beenden – daher Steam
  vor dem Abgleich schließen (der Client warnt). Coverbilder für Steam/Sunshine werden nicht gesetzt.
- **Discord Rich Presence** benötigt eine (kostenlose) Discord-Anwendungs-ID des Betreibers und ein laufendes Discord.
- **Ordner-Import** gleicht Ordner-Builds dateiweise (Pfad + Größe) ab; bei Archiv-/Installer-Builds nur über den Namen –
  „Reparieren“ gleicht danach Unterschiede aus.
- **Bild-Links** aus Chat/Community sind 7 Tage gültig und werden beim Neuladen der Seite automatisch erneuert.

---

## Lizenz

[GNU AGPL-3.0-or-later](LICENSE) – freie Software. Wer eine veränderte Version als Netzwerkdienst betreibt, muss den
Quellcode der Änderungen ebenfalls bereitstellen.
