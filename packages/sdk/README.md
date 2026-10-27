# Game-Server-SDK (Achievements)

Kleine Bibliotheken, mit denen ein Spiel Achievements auf einer selbst gehosteten Game-Server-Plattform freischaltet.
**Lizenz: MIT** – das SDK darf in Spiele mit beliebiger Lizenz eingebunden werden (die Plattform selbst ist AGPL).

## Funktionsweise

1. Ein Admin/Maintainer legt im Admin-Panel unter *Spiel → Achievements* die Achievements an (stabiler `apiName`,
   z. B. `FIRST_BLOOD`, optional Zielwert für Fortschritt, Icon, „versteckt“).
2. Der **Desktop-Client** ruft beim Start `POST /api/play/:gameId/start` auf und startet das Spiel mit den
   Umgebungsvariablen:

   | Variable | Inhalt |
   | --- | --- |
   | `GS_API_URL` | Adresse des Servers, z. B. `https://games.example.com` |
   | `GS_GAME_ID` | ID des Spiels |
   | `GS_GAME_TOKEN` | Spiel-Token `gsg_…` – 24 h gültig, **nur** für dieses Spiel und nur für die SDK-Endpunkte |

3. Das Spiel meldet Freischaltungen über das SDK. Ohne Client (z. B. beim Entwickeln) fehlen die Variablen –
   `fromEnv()` liefert dann `null`/`None`/`NULL` und das Spiel läuft normal weiter.
4. Netzwerkfehler sind kein Problem: Meldungen werden vorgemerkt und mit `flush()` erneut gesendet.

## HTTP-API (für eigene Implementierungen, z. B. Unity/Godot)

Alle Anfragen mit `Authorization: Bearer <GS_GAME_TOKEN>`:

| Methode | Pfad | Body | Ergebnis |
| --- | --- | --- | --- |
| `GET` | `/api/sdk/me` | – | `{ user, game, expiresAt }` |
| `GET` | `/api/sdk/achievements` | – | Liste mit `apiName`, `name`, `unlocked`, `progress`, `progressMax`, `rarity` |
| `POST` | `/api/sdk/achievements/{apiName}/unlock` | `{}` | `{ achievement, newlyUnlocked }` |
| `POST` | `/api/sdk/achievements/{apiName}/progress` | `{ "progress": 7 }` | `{ achievement, newlyUnlocked }` – schaltet bei `progress >= progressMax` frei |

Fehler: JSON `{ "error": "<code>", "message": "…" }`, z. B. `404 achievement_not_found`, `401 game_token_invalid`.
Fortschritt kann nur steigen; bereits freigeschaltete Achievements bleiben freigeschaltet.

## TypeScript / JavaScript

```ts
import { GameServerSdk } from '@gameserver/sdk';

const sdk = GameServerSdk.fromEnv();          // Node/Electron/NW.js
// const sdk = GameServerSdk.fromUrl(location.href); // HTML5: ?gs_api=…&gs_token=…
await sdk?.unlock('FIRST_BLOOD');
await sdk?.setProgress('COLLECTOR', 7);
await sdk?.flush();
```

## Python

`python/gameserver_sdk.py` – nur Standardbibliothek, einfach ins Spiel kopieren:

```python
import gameserver_sdk
sdk = gameserver_sdk.from_env()
if sdk:
    sdk.unlock("FIRST_BLOOD")
    sdk.set_progress("COLLECTOR", 7)
```

Kommandozeile zum Testen: `python3 gameserver_sdk.py unlock FIRST_BLOOD`.

## C / C++

`c/gameserver_sdk.h` + `c/gameserver_sdk.c`, benötigt **libcurl** (Linux: `libcurl4-openssl-dev`, Windows: vcpkg `curl`).

```c
gs_sdk *sdk = gs_sdk_from_env();
if (sdk) {
    gs_unlock_info info;
    if (gs_sdk_unlock(sdk, "FIRST_BLOOD", &info) == GS_OK && info.newly_unlocked) { /* Popup zeigen */ }
    gs_sdk_set_progress(sdk, "COLLECTOR", 7, NULL);
    gs_sdk_free(sdk);
}
```

Rückgabewerte: `GS_OK`, `GS_QUEUED` (Netzwerkfehler, vorgemerkt), `GS_ERROR` (Details: `gs_sdk_last_error()`),
`GS_INVALID_ARGUMENT`. Die Aufrufe blockieren – am besten aus einem Hintergrund-Thread aufrufen.

```bash
cd c && make            # baut libgameserver_sdk.a und das Beispiel ./example
GS_API_URL=… GS_GAME_TOKEN=… ./example unlock FIRST_BLOOD
```

## Erkennung ohne SDK

Für Spiele ohne Quellcode-Zugriff kann ein Achievement eine **Erkennungsregel** bekommen (Admin-Panel):
`file_exists` (Datei existiert), `file_regex` (Dateiinhalt passt auf Muster) oder `log_regex` (Logdatei enthält Muster).
Pfade nutzen dieselben Platzhalter wie Cloud-Saves (`{install}`, `%APPDATA%`, `$XDG_DATA_HOME` …). Der Desktop-Client prüft
die Regeln während das Spiel läuft und nach dem Beenden. Das ist heuristisch und spielspezifisch – zuverlässig ist nur das SDK.
