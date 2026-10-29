#!/usr/bin/env bash
# =====================================================================================================
# Host-Watcher für das Ein-Klick-Update aus dem Admin-Panel.
#
# Der Server-Container kann sich nicht selbst neu bauen. Stattdessen schreibt „Jetzt aktualisieren“ im Panel
# eine Markierungsdatei in das gemounteste Datenverzeichnis (UPDATE_COMMAND=touch /data/.update-requested).
# Dieser Watcher läuft auf dem Host, erkennt die Markierung und ruft self-update.sh auf.
#
# Wird von install.sh als systemd-Dienst eingerichtet; kann auch manuell gestartet werden:
#   GS_INSTALL_DIR=/opt/gameserver bash deploy/update-watcher.sh /pfad/zu/data/.update-requested
# =====================================================================================================
set -euo pipefail

INSTALL_DIR="${GS_INSTALL_DIR:-/opt/gameserver}"
FLAG="${1:?Pfad zur Markierungsdatei angeben}"

echo "Update-Watcher gestartet – beobachtet $FLAG"
while true; do
  if [[ -f "$FLAG" ]]; then
    rm -f "$FLAG"
    echo "[$(date -Is)] Update angefordert – starte self-update.sh"
    bash "$INSTALL_DIR/deploy/self-update.sh" || echo "[$(date -Is)] Update fehlgeschlagen"
  fi
  sleep 15
done
