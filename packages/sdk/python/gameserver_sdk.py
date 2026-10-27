"""Game-Server-SDK für Python (MIT-Lizenz) – Achievements aus dem Spiel heraus freischalten.

Keine Abhängigkeiten außer der Standardbibliothek. Beispiel::

    import gameserver_sdk

    sdk = gameserver_sdk.from_env()      # None, wenn das Spiel nicht über den Desktop-Client gestartet wurde
    if sdk:
        sdk.unlock("FIRST_BLOOD")
        sdk.set_progress("COLLECTOR", 7)

Der Desktop-Client übergibt GS_API_URL, GS_GAME_ID und GS_GAME_TOKEN als Umgebungsvariablen.
Bei Netzwerkfehlern werden Meldungen vorgemerkt und mit ``flush()`` erneut gesendet.
"""

from __future__ import annotations

import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

__all__ = ["GameServerSdk", "SdkError", "from_env"]
__version__ = "0.4.0"


class SdkError(Exception):
    """Fachlicher Fehler des Servers (z. B. unbekanntes Achievement oder ungültiges Token)."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class GameServerSdk:
    def __init__(self, api_url: str, token: str, game_id: Optional[str] = None, timeout: float = 10.0) -> None:
        self.api_url = api_url.rstrip("/")
        self.game_id = game_id
        self._token = token
        self._timeout = timeout
        self._pending: dict[str, Optional[int]] = {}
        self._lock = threading.Lock()

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self.api_url}/api/sdk{path}", data=data, method=method)
        req.add_header("Authorization", f"Bearer {self._token}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as err:
            try:
                payload = json.loads(err.read() or b"{}")
            except ValueError:
                payload = {}
            raise SdkError(err.code, payload.get("error", "http_error"), payload.get("message", str(err))) from None

    def me(self) -> dict:
        return self._request("GET", "/me")

    def achievements(self) -> list[dict]:
        return self._request("GET", "/achievements")

    def unlock(self, api_name: str) -> Optional[dict]:
        """Achievement freischalten. Gibt None zurück, wenn die Meldung offline vorgemerkt wurde."""
        return self._send(api_name, None)

    def set_progress(self, api_name: str, progress: int) -> Optional[dict]:
        """Fortschritt melden; bei Erreichen des Zielwerts wird freigeschaltet."""
        return self._send(api_name, max(0, int(progress)))

    def _send(self, api_name: str, progress: Optional[int]) -> Optional[dict]:
        name = urllib.parse.quote(api_name, safe="")
        try:
            if progress is None:
                return self._request("POST", f"/achievements/{name}/unlock")
            return self._request("POST", f"/achievements/{name}/progress", {"progress": progress})
        except SdkError as err:
            if err.status != 429 and err.status < 500:
                raise
        except (urllib.error.URLError, OSError, TimeoutError):
            pass
        with self._lock:
            if api_name not in self._pending or progress is None:
                self._pending[api_name] = progress
            elif self._pending[api_name] is not None:
                self._pending[api_name] = max(self._pending[api_name] or 0, progress)
        return None

    @property
    def pending_count(self) -> int:
        return len(self._pending)

    def flush(self) -> int:
        """Vorgemerkte Meldungen erneut senden; liefert die Anzahl erfolgreicher Übertragungen."""
        with self._lock:
            queue, self._pending = self._pending, {}
        sent = 0
        for api_name, progress in queue.items():
            try:
                if self._send(api_name, progress) is not None:
                    sent += 1
            except SdkError:
                pass
        return sent


def from_env(env: Optional[dict] = None) -> Optional[GameServerSdk]:
    """SDK aus den Umgebungsvariablen des Desktop-Clients; None, wenn sie fehlen."""
    env = os.environ if env is None else env
    api_url, token = env.get("GS_API_URL"), env.get("GS_GAME_TOKEN")
    if not api_url or not token:
        return None
    return GameServerSdk(api_url, token, env.get("GS_GAME_ID"))


if __name__ == "__main__":  # Kleines Kommandozeilen-Werkzeug zum Testen
    import sys

    sdk = from_env()
    if sdk is None:
        sys.exit("GS_API_URL und GS_GAME_TOKEN fehlen (Spiel über den Desktop-Client starten)")
    if len(sys.argv) >= 3 and sys.argv[1] == "unlock":
        print(json.dumps(sdk.unlock(sys.argv[2]), ensure_ascii=False))
    elif len(sys.argv) >= 4 and sys.argv[1] == "progress":
        print(json.dumps(sdk.set_progress(sys.argv[2], int(sys.argv[3])), ensure_ascii=False))
    else:
        print(json.dumps(sdk.achievements(), ensure_ascii=False, indent=2))
