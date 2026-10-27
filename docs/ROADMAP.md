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

## ⏭️ Phase 2 – Desktop-Client (Kern) – Repository `mialwe12-bot/game-client`

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

## Phase 3 – Soziales

Freunde, Anfragen, Online-Status/„spielt gerade“, Blockieren, anpassbare Profile; Chat (direkt, Gruppen, Kanäle, Bilder, Emojis,
optional GIFs), optional Sprachchat per WebRTC; Gruppen mit Seiten/Ankündigungen/Events; Community pro Spiel (Reviews mit
Hilfreich-Votes, Foren, Screenshots, Guides, Artwork, News); Benachrichtigungen (In-App, Client, E-Mail), Aktivitäts-Feed.

> Hinweis: **Sprachchat** benötigt für Nutzer hinter NAT einen TURN-Server (z. B. coturn als zusätzlicher Container).
> GIF-Suche (Tenor/Giphy) wäre eine externe Abhängigkeit und bleibt deshalb optional/abschaltbar.

## Phase 4 – Steam-Features

Cloud-Saves, Achievements (+ SDK), Workshop, Sammelkarten/Abzeichen/Level/Marktplatz (ohne Geld), Screenshots per Hotkey,
Overlay, Familienfreigabe/Geschenke/Codes/Kindersicherung, Big-Picture-Modus (Gamepad API), Remote Play, Steam-Integration
(Non-Steam-Shortcuts, Discord Rich Presence, Import vorhandener Ordner), Statistiken/Jahresrückblick/Top-Listen.

Vorab-Hinweise zu technisch eingeschränkten Features:

- **Ingame-Overlay**: Ein echtes Overlay erfordert DLL-/Vulkan-/OpenGL-Hooking pro Grafik-API (und wird von Anti-Cheat
  teils blockiert). Pragmatisch: ein eigenständiges **Always-on-top-Fenster** (Tauri), per globalem Hotkey ein-/ausblendbar;
  unter Linux zusätzlich optional MangoHud-/gamescope-Integration. Funktioniert nicht über exklusiven Vollbildmodus.
- **Remote Play**: Eigenes Video-Streaming mit niedriger Latenz ist sehr aufwändig. Pragmatisch: Anbindung an
  **Sunshine/Moonlight** (Client startet Spiel und registriert es bei Sunshine) sowie **Remote-Download** (Download auf einem
  anderen eigenen Gerät per WebSocket-Befehl auslösen).
- **Screenshots per Hotkey im Spiel**: Ohne Overlay-Hook nur über globale Hotkeys + System-Screenshot-APIs (funktioniert in
  Fenster/Borderless, nicht zuverlässig im exklusiven Vollbild).
- **Cloud-Saves**: Nur für Spiele mit vom Admin definierten Save-Pfaden; Konflikterkennung über Zeitstempel + Hash.
- **Achievement-Erkennung per Datei/Log**: Heuristisch und spielspezifisch – zuverlässig ist nur das SDK.
- **Discord Rich Presence** benötigt eine (kostenlose) Discord-Application-ID des Betreibers.
