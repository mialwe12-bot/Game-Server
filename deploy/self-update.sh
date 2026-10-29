#!/usr/bin/env bash
# =====================================================================================================
# Game Server – Update einer bestehenden Docker-Installation.
#
#   sudo bash /opt/gameserver/deploy/self-update.sh
#
# Holt den neuesten Stand des eingestellten Branches, baut die Container neu und startet sie.
# Daten (.env, Spieldateien, Datenbank) bleiben erhalten; Datenbank-Migrationen laufen beim Serverstart automatisch.
#
# Dieses Skript ist auch der empfohlene Wert für UPDATE_COMMAND, damit der „Jetzt aktualisieren“-Knopf im
# Admin-Panel funktioniert – siehe unten „Ein-Klick-Update aus dem Panel“.
# =====================================================================================================
set -euo pipefail

INSTALL_DIR="${GS_INSTALL_DIR:-/opt/gameserver}"

if [[ -t 1 ]]; then B=$'\e[1m'; G=$'\e[32m'; R=$'\e[31m'; N=$'\e[0m'; else B='' G='' R='' N=''; fi
info() { echo "${B}==>${N} $*"; }
die() { echo "${R}✗ $*${N}" >&2; exit 1; }

[[ -d "$INSTALL_DIR/.git" ]] || die "Keine Installation in $INSTALL_DIR gefunden (GS_INSTALL_DIR setzen)."
command -v docker >/dev/null || die "Docker fehlt."
docker compose version >/dev/null 2>&1 || die "Docker Compose (Plugin) fehlt."

cd "$INSTALL_DIR"

# Nur ein Update gleichzeitig
exec 9>"$INSTALL_DIR/.update.lock"
flock -n 9 || die "Es läuft bereits ein Update."

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" != "HEAD" ]] || die "Repository ist im Detached-HEAD-Zustand – bitte einen Branch auschecken."

info "Hole neuesten Stand von origin/$BRANCH …"
git fetch --quiet origin "$BRANCH"
BEFORE="$(git rev-parse HEAD)"
git merge --ff-only "origin/$BRANCH" || die "Kein schneller Vorlauf möglich (lokale Änderungen?). Bitte manuell prüfen."
AFTER="$(git rev-parse HEAD)"

if [[ "$BEFORE" == "$AFTER" ]]; then
  info "Bereits aktuell ($(git log -1 --format='%h %s' | cut -c1-60)). Baue trotzdem neu, um sicherzugehen."
else
  info "Aktualisiert: $(git log --oneline "$BEFORE..$AFTER" | head -5 | sed 's/^/    /')"
fi

info "Baue und starte die Container neu …"
docker compose up -d --build

# Auf Gesundheit warten
info "Warte auf den Server …"
for _ in $(seq 1 90); do
  if docker compose exec -T server wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "${G}✓ Update abgeschlossen – Version $(docker compose exec -T server node -e 'console.log(require("./package.json").version)' 2>/dev/null || echo '?').${N}"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 2
done
die "Server antwortet nach dem Update nicht. Logs: cd $INSTALL_DIR && docker compose logs server"
