# Roadmap

Die Plattform wird strikt phasenweise gebaut. Jede Phase endet mit lauffähigem Code, Tests und Doku.

## ✅ Phase 1 – Server, Web-Store, Admin (fertig)

- Accounts: Registrierung (offen/Einladung/geschlossen), Login, 2FA (TOTP + Recovery-Codes), Passwort-Reset per SMTP,
  OIDC/SSO, Rollen Admin/Uploader/Nutzer, Profil mit Avatar, Sessions + Device-Tokens (einzeln widerrufbar)
- Admin-Panel: chunked/fortsetzbarer Browser-Upload (Pause/Fortsetzen), Versionen, Builds pro Plattform, ZIP/7z/Ordner/Installer,
  SHA-256, Startkonfiguration inkl. Proton/Wine-Flag, Metadaten (IGDB/RAWG + Markdown), Medien, Nutzer/Rollen/Rechte pro Spiel,
  Einladungen, Speicherübersicht, Upload-/Bandbreitenlimits, Audit- und Server-Log, Backups (manuell + Zeitplan), Wartungsmodus
- Store: Startseite (Featured, Empfehlungen nach Spielzeit, Neuzugänge, Beliebt, Ankündigungen), Suche + Filter, Detailseite,
  Wunschliste, Entdeckungs-Queue
- Bibliothek im Web: alle Spiele, Sammlungen, Favoriten, Ausblenden, Spielzeit, Sortierung
- Docker Compose (server, web, postgres) hinter Caddy im Netzwerk `reverse-proxy`, OpenAPI, WebSocket, Tests, CI

## ✅ Phase 2 – Desktop-Client (Kern) – Repository `mialwe12-bot/game-client` (fertig)

Umgesetzt wie unten geplant. Abweichungen/Details:
- Delta-Updates **auf Dateiebene** für Ordner-Builds; Archive/Installer werden vollständig geladen.
- Client-Auto-Update signiert nur mit eigenem Schlüssel (`GS_UPDATER_PUBKEY` beim Bauen), sonst Hinweis + Download.
- Spielstart über Verknüpfungen: `gameserver-client --launch <gameId>` (Einzelinstanz übernimmt den Start).
- Echte End-to-End-Prüfung unter Linux (Xvfb): Login, Installation, Start, Spielzeit, Offline-Modus.

Ursprünglicher Plan:

Geplanter Aufbau: **Tauri 2** (Rust-Backend) + dasselbe React-Frontend (`apps/web` als Git-Submodul bzw. Workspace-Abhängigkeit,
gebaut mit einem „Client-Modus“, der Download-Manager, Installationen und Einstellungen ergänzt). Der API-Client und der
fortsetzbare Upload aus `packages/shared` werden wiederverwendet.

| # | Feature | Umsetzung | Hinweis zu Einschränkungen |
| --- | --- | --- | --- |
| 5 | Store/Bibliothek/Community/Einstellungen eingebettet, Login per Server-URL | WebView lädt das gebaute Frontend lokal; API über Device-Token (`POST /api/auth/login` mit `device`) | SSO-Login im Client per Loopback-Redirect oder Device-Token aus dem Web-Konto |
| 6 | Download-Manager | Rust: parallele HTTP-Range-Chunks, Pause/Fortsetzen, SHA-256-Prüfung gegen das Manifest, Warteschlange, Bandbreitenlimit + Zeitplan, mehrere Bibliotheksordner/Laufwerke, Deinstallation, Reparieren/Verifizieren | Für ZIP/7z wird nach dem Download entpackt (zip/sevenz-rust); Installer werden ausgeführt – deren Installationspfad kann der Client nur über die Startkonfiguration kennen |
| 7 | Start/Stopp, Spielzeit, Startoptionen, Verknüpfungen | Prozess-Überwachung inkl. Kindprozesse; `.desktop`-Dateien (Linux) bzw. `.lnk` (Windows) | Spiele mit eigenem Launcher, der sich sofort beendet, erfordern Prozess-Erkennung per Name |
| 8 | Automatische Updates, Versionswahl, Rollback | Ordner-Builds: **Delta-Updates auf Dateiebene** (nur geänderte Dateien laut SHA-256-Manifest). Archive/Installer: Voll-Download | **Echte Binär-Deltas** (wie Steam) sind aufwändig; pragmatisch: Datei-Deltas für Ordner-Builds, optional später Chunk-Deltas (Content-Defined Chunking) |
| 9 | Linux: Proton/Wine mit Versionswahl, Prefix pro Spiel, Steam-Deck-Erkennung | Erkennung installierter Proton-Versionen (Steam `compatibilitytools.d`, `steamapps/common/Proton*`), `umu-launcher` falls vorhanden, eigener `WINEPREFIX` je Spiel; Gaming-Mode über `SteamDeck=1`/`gamescope` | Proton außerhalb von Steam funktioniert am zuverlässigsten mit umu-launcher |
| 10 | Offline-Modus, Tray, Autostart, Benachrichtigungen | Lokaler Cache der Bibliothek, Tauri-Plugins `tray`, `autostart`, `notification` | Spielzeit wird offline gepuffert und später gemeldet |
| – | Auto-Update des Clients über den eigenen Server | Tauri-Updater-Endpunkt am Server (`/api/client/update/...`) + Admin-Upload der signierten Client-Releases | Signaturschlüssel muss der Betreiber selbst erzeugen |
| – | Tests | Rust-Unit-/Integrationstests für den Download-Manager (Range, Resume, Prüfsumme, Warteschlange, Drosselung) gegen einen Test-HTTP-Server | |

## ✅ Phase 3 – Soziales (fertig)

- **Freunde**: Anfragen (Suche/Profil), gegenseitige Anfrage = sofort befreundet, Entfernen, **Blockieren**, Anfragen abschaltbar,
  **Präsenz** (online, „spielt gerade“ vom Desktop-Client über `PUT /api/presence`, zuletzt online), **Spieleinladungen**
- **Profile**: Hintergrundbild, Akzentfarbe, bis zu 6 Vitrinen, berechnete **Abzeichen** mit Stufen, Statistiken, Aktivitäten,
  Privatsphäre (alle/Freunde/privat)
- **Chat**: Direkt (nur Freunde), Gruppenchats, Gruppenkanäle; Text, Emojis, Bilder (signierte URLs), GIFs (Tenor, optional),
  Bearbeiten/Löschen, Lesestatus, Tippanzeige, Stummschalten; **Sprachchat** als WebRTC-Mesh mit Signalisierung über `/api/ws`
- **Gruppen**: Seite mit Banner/Bild, Beitrittsregeln (offen/Anfrage/Einladung), sichtbar/versteckt, Rollen und Leitungsübergabe,
  Ankündigungen, Events mit Zusagen und Erinnerung, Chat-Kanäle (Mitgliedschaft synchronisiert)
- **Community pro Spiel**: Reviews (nur mit Bibliothekseintrag) mit Hilfreich/Lustig-Stimmen und Bewertungsstufe, Forum mit
  Moderation (Admin/Maintainer), Screenshots, Artworks, Guides, Likes, News
- **Benachrichtigungen**: In-App + WebSocket, Systembenachrichtigungen im Client (`show_notification`), Browser-Notifications,
  E-Mail nur offline und pro Kategorie abschaltbar; **Aktivitäts-Feed**
- Optionaler **coturn**-Container (`docker compose --profile voice`), TURN-Zugangsdaten per HMAC

Bewusste Einschränkungen: Sprachchat-Mesh für kleine Runden (≤ ~6), kein eigener Medienserver; GIF-Suche nur mit Tenor-Schlüssel;
Abzeichen nur aus Meilensteinen (Sammelkarten/Level in Phase 4).

## ✅ Phase 4 – Steam-Features (fertig)

- **Cloud-Saves**: Save-Pfade pro Spiel/Plattform mit Platzhaltern (Windows-Pfade im Wine/Proton-Präfix), Ein-/Ausschluss-
  muster, Abgleich vor dem Start und nach dem Ende (ZIP + SHA-256-Manifest), Versionierung, Kontingent, Wiederherstellen,
  **Konfliktdialog** (lokal geändert und neuere Server-Version seit dem letzten Abgleich)
- **Achievements**: Verwaltung pro Spiel (Icon, versteckt, Fortschritt, Reihenfolge, Support-Vergabe), **SDK** in TypeScript,
  Python und C (Spielsitzungs-Token `gsg_…` per Umgebung, Offline-Puffer), optionale **Datei-/Log-Erkennung** im Client,
  Seltenheit, Profil-Vitrine, Abzeichen „Jäger“
- **Workshop**: Inhalte mit Versionen, Vorschaubild, Tags, Bewertung, Kommentaren, Abos; Client installiert Abos automatisch
- **Sammelkarten/Abzeichen/Level/Marktplatz** (ohne Geld, abschaltbar): Drops nach Spielzeit, Abzeichen bis Stufe 5, EP und
  Profil-Level, Tauschangebote, Marktplatz Karte gegen Karte
- **Screenshots** (globaler Hotkey F12, Manager, Upload in die Community)
- **Overlay** als eigenständiges Always-on-top-Fenster (Shift+Tab): Freunde, Chat, Achievements, Browser, Notizen, Screenshots
- **Familie**: Familienbibliothek, Geschenke, Aktivierungscodes (Chargen, CSV), Altersfreigaben, Kindersicherung
  (Altersstufe, Tageslimit mit Warnung und Spielende, Chat/Community)
- **Big Picture** (`/big-picture`) mit Gamepad-API-Fokusnavigation, Start im Gaming-Mode
- **Remote Play** über Sunshine/Moonlight (`apps.json`-Abgleich) und Remote-Download/-Start auf eigene Geräte
- **Steam-Integration**: `shortcuts.vdf` (binäres VDF), Discord Rich Presence, Import vorhandener Spielordner
- **Statistiken**: Spielzeit pro Woche/Spiel, Jahresrückblick, globale Top-Listen

Ehrlich dokumentierte Einschränkungen (Details im README): Overlay ohne Grafik-Hook (nicht über exklusivem Vollbild bzw.
Gamescope), Screenshots über System-APIs, Remote Play über Sunshine statt eigenem Streaming, Datei-/Log-Erkennung als
Heuristik, Discord benötigt eine Anwendungs-ID, Steam muss beim Verknüpfungs-Abgleich geschlossen sein.

## Mögliche nächste Schritte (außerhalb des ursprünglichen Auftrags)

- Coverbilder für Steam-Verknüpfungen (`grid/`) und Sunshine
- Echte Overlay-Integration unter Linux über MangoHud/vkBasalt-Layer bzw. Gamescope
- SFU (z. B. LiveKit) für große Sprachkanäle
