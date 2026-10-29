#!/usr/bin/env bash
# =====================================================================================================
# Aktiviert das Ein-Klick-Update im Admin-Panel nachträglich – ohne Neuinstallation.
#
#   sudo bash /opt/gameserver/deploy/enable-oneclick-update.sh
#
# Setzt UPDATE_COMMAND in der .env (schreibt beim Klick eine Markierungsdatei), richtet einen Host-Dienst ein,
# der self-update.sh ausführt, sobald die Markierung erscheint, und lädt die Server-Konfiguration neu.
# Rückgängig: deaktivieren mit `--disable`.
# =====================================================================================================
set -euo pipefail

INSTALL_DIR="${GS_INSTALL_DIR:-/opt/gameserver}"
DISABLE=false
[[ "${1:-}" == "--disable" ]] && DISABLE=true

if [[ -t 1 ]]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B='' G='' Y='' R='' N=''; fi
ok() { echo "${G}✓${N} $*"; }
warn() { echo "${Y}!${N} $*"; }
die() { echo "${R}✗ $*${N}" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Bitte mit sudo ausführen."
[[ -f "$INSTALL_DIR/.env" ]] || die "Keine .env in $INSTALL_DIR gefunden (GS_INSTALL_DIR setzen)."
[[ -f "$INSTALL_DIR/deploy/self-update.sh" ]] || die "deploy/self-update.sh fehlt – bitte zuerst aktualisieren (git pull)."
cd "$INSTALL_DIR"

set_env() { # key value
  local key="$1" val="$2" file="$INSTALL_DIR/.env" esc
  esc=$(printf '%s' "$val" | sed -e 's/[\/&|]/\\&/g')
  if grep -qE "^#?\s*${key}=" "$file"; then
    sed -i -E "s|^#?\s*${key}=.*|${key}=${esc}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

if $DISABLE; then
  set_env UPDATE_COMMAND ""
  systemctl disable --now gameserver-update.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/gameserver-update.service
  systemctl daemon-reload 2>/dev/null || true
  pkill -f "update-watcher.sh" 2>/dev/null || true
  docker compose up -d >/dev/null
  ok "Ein-Klick-Update deaktiviert (Panel zeigt künftig nur den manuellen Befehl)."
  exit 0
fi

DATA_PATH=$(grep -E '^DATA_PATH=' .env | cut -d= -f2-); DATA_PATH=${DATA_PATH:-./data}
FLAG="$(realpath -m "$DATA_PATH")/.update-requested"
mkdir -p "$(dirname "$FLAG")"

set_env UPDATE_COMMAND "touch /data/.update-requested"
docker compose up -d >/dev/null   # .env neu einlesen
ok "UPDATE_COMMAND gesetzt und Server neu geladen."

if command -v systemctl >/dev/null && [[ -d /run/systemd/system ]]; then
  cat > /etc/systemd/system/gameserver-update.service <<UNIT
[Unit]
Description=Game Server Update-Watcher
After=docker.service
[Service]
Environment=GS_INSTALL_DIR=$INSTALL_DIR
ExecStart=/usr/bin/env bash $INSTALL_DIR/deploy/update-watcher.sh $FLAG
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now gameserver-update.service >/dev/null 2>&1
  ok "Host-Dienst gameserver-update.service läuft."
else
  warn "Kein systemd gefunden – Watcher wird nur bis zum nächsten Neustart ausgeführt."
  GS_INSTALL_DIR="$INSTALL_DIR" nohup bash "$INSTALL_DIR/deploy/update-watcher.sh" "$FLAG" >"$INSTALL_DIR/.update.log" 2>&1 &
  ok "Watcher als Hintergrundprozess gestartet (nach Neustart erneut ausführen)."
fi

echo
echo "${B}Fertig.${N} Im Admin-Panel unter Verwaltung → Einstellungen → Updates fuehrt \"Jetzt aktualisieren\" das Update jetzt aus."
echo "Beobachtet wird: $FLAG"
