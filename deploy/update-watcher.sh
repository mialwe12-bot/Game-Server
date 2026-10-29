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

# Installationsverzeichnis: GS_INSTALL_DIR > Ordner dieses Skripts (falls dort docker-compose.yml liegt) > Standard
if ! _self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"; then _self_dir=""; fi
if [[ -n "${GS_INSTALL_DIR:-}" ]]; then
  INSTALL_DIR="$GS_INSTALL_DIR"
elif [[ -n "$_self_dir" && -f "$_self_dir/docker-compose.yml" ]]; then
  INSTALL_DIR="$_self_dir"
else
  INSTALL_DIR="/opt/gameserver"
fi
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
