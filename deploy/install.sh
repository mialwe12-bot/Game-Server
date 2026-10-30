#!/usr/bin/env bash
# =====================================================================================================
# Game Server – Installations- und Update-Skript (Linux, Docker)
#
#   curl -fsSL https://raw.githubusercontent.com/mialwe12-bot/Game-Server/<branch>/deploy/install.sh -o install.sh
#   sudo bash install.sh
#
# Was das Skript macht:
#   1. prüft Docker + Compose (bietet die Installation über get.docker.com an)
#   2. aktualisiert eine vorhandene Installation am Ort (Skript liegt darin) oder klont nach /opt/gameserver
#   3. erzeugt .env mit zufälligen Passwörtern und deinen Angaben (Domain, Speicherort, E-Mail)
#   4. richtet den Webzugang ein:
#        a) eigener Caddy-Container mit automatischem HTTPS (Let's Encrypt) – Ports 80/443
#        b) vorhandener Caddy im Docker-Netz "reverse-proxy" – Skript gibt den Caddyfile-Eintrag aus
#        c) nur zum Testen im LAN: HTTP auf Port 8080, ohne Domain
#   5. baut und startet die Container und legt das erste Admin-Konto an
#
# Erneut ausführen = Update (Code holen, neu bauen, neu starten; .env und Daten bleiben erhalten).
#
# Unbeaufsichtigt (alle Fragen per Umgebungsvariable beantworten):
#   GS_MODE=own GS_DOMAIN=games.example.com GS_ACME_EMAIL=ich@example.com GS_DATA_PATH=/srv/games \
#   GS_ADMIN_USER=admin GS_ADMIN_EMAIL=ich@example.com GS_ADMIN_PASSWORD='...' sudo -E bash install.sh --yes
# =====================================================================================================
set -euo pipefail

REPO_URL="${GS_REPO_URL:-https://github.com/mialwe12-bot/Game-Server.git}"
BRANCH="${GS_BRANCH:-claude/magical-archimedes-jb34jz}"
# Installationsverzeichnis:
#  1. GS_INSTALL_DIR, falls gesetzt
#  2. der Ordner, in dem dieses Skript liegt (deploy/..), wenn das bereits eine Installation ist (hat docker-compose.yml)
#     -> Update am Ort, egal wohin geklont wurde
#  3. sonst /opt/gameserver (standalone-Download -> frische Installation dorthin klonen)
_self="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
if ! _self_dir="$(cd "$(dirname "$_self")/.." 2>/dev/null && pwd)"; then _self_dir=""; fi
if [[ -n "${GS_INSTALL_DIR:-}" ]]; then
  INSTALL_DIR="$GS_INSTALL_DIR"
elif [[ -n "$_self_dir" && -f "$_self_dir/docker-compose.yml" ]]; then
  INSTALL_DIR="$_self_dir"
else
  INSTALL_DIR="/opt/gameserver"
fi
ASSUME_YES=false
[[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]] && ASSUME_YES=true

# ---------- Ausgabe ----------
if [[ -t 1 ]]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B='' G='' Y='' R='' N=''; fi
info() { echo "${B}==>${N} $*"; }
ok() { echo "${G}✓${N} $*"; }
warn() { echo "${Y}!${N} $*"; }
die() { echo "${R}✗ $*${N}" >&2; exit 1; }

# Frage mit Vorgabe; Umgebungsvariable hat Vorrang
ask() { # ask VAR "Frage" "Vorgabe"
  local var="$1" prompt="$2" def="${3:-}" val="${!1:-}"
  if [[ -z "$val" ]]; then
    if $ASSUME_YES || [[ ! -t 0 ]]; then val="$def"; else
      read -r -p "$prompt${def:+ [$def]}: " val
      val="${val:-$def}"
    fi
  fi
  printf -v "$var" '%s' "$val"
}
ask_secret() { # ask_secret VAR "Frage"
  local var="$1" prompt="$2" val="${!1:-}" again
  while [[ -z "$val" ]]; do
    $ASSUME_YES && die "$var fehlt (unbeaufsichtigter Modus)"
    read -r -s -p "$prompt: " val; echo
    read -r -s -p "Wiederholen: " again; echo
    [[ "$val" == "$again" ]] || { warn "Eingaben stimmen nicht überein."; val=""; continue; }
    [[ ${#val} -ge 10 ]] || { warn "Mindestens 10 Zeichen."; val=""; }
  done
  printf -v "$var" '%s' "$val"
}
confirm() { # confirm "Frage" → 0 = ja
  $ASSUME_YES && return 0
  local a; read -r -p "$1 [J/n]: " a
  [[ -z "$a" || "$a" =~ ^[JjYy] ]]
}
rand_hex() { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
# Wert in .env setzen (ersetzt vorhandene Zeile oder hängt an)
set_env() {
  local key="$1" val="$2" file="$INSTALL_DIR/.env"
  if grep -qE "^#?\s*${key}=" "$file"; then
    local esc; esc=$(printf '%s' "$val" | sed -e 's/[\/&|]/\\&/g')
    sed -i -E "s|^#?\s*${key}=.*|${key}=${esc}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

# ---------- Voraussetzungen ----------
[[ "$(uname -s)" == "Linux" ]] || die "Dieses Skript ist für Linux-Server gedacht."
[[ $EUID -eq 0 ]] || die "Bitte mit sudo bzw. als root ausführen: sudo bash $0"

echo
echo "${B}🎮 Game Server – Installation${N}"
echo

for cmd in git curl; do
  if ! command -v "$cmd" >/dev/null; then
    info "Installiere $cmd …"
    if command -v apt-get >/dev/null; then apt-get update -qq && apt-get install -y -qq "$cmd"
    elif command -v dnf >/dev/null; then dnf install -y -q "$cmd"
    else die "$cmd fehlt – bitte installieren."; fi
  fi
done

if ! command -v docker >/dev/null; then
  warn "Docker ist nicht installiert."
  confirm "Docker jetzt über das offizielle Skript (get.docker.com) installieren?" || die "Docker wird benötigt."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker 2>/dev/null || true
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose (Plugin) fehlt. Installieren: https://docs.docker.com/compose/install/"
docker info >/dev/null 2>&1 || die "Docker läuft nicht (systemctl start docker)."
ok "Docker $(docker version --format '{{.Server.Version}}') mit Compose $(docker compose version --short)"

# ---------- Quellcode ----------
UPDATE=false
if [[ -d "$INSTALL_DIR/.git" ]]; then
  UPDATE=true
  info "Vorhandene Installation in $INSTALL_DIR gefunden – aktualisiere …"
  git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"
  git -C "$INSTALL_DIR" merge --ff-only --quiet "origin/$BRANCH" || die "Lokale Änderungen in $INSTALL_DIR verhindern das Update."
else
  [[ -e "$INSTALL_DIR" && -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]] && die "$INSTALL_DIR existiert und ist nicht leer."
  info "Lade Quellcode nach $INSTALL_DIR …"
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
ok "Quellcode: $(git -C "$INSTALL_DIR" log -1 --format='%h %s' | cut -c1-70)"
cd "$INSTALL_DIR"

docker network inspect reverse-proxy >/dev/null 2>&1 || docker network create reverse-proxy >/dev/null
MODE_FILE="$INSTALL_DIR/.install-mode"

# ---------- Konfiguration (nur bei Erstinstallation) ----------
if ! $UPDATE || [[ ! -f .env ]]; then
  echo
  echo "${B}Wie soll die Plattform erreichbar sein?${N}"
  echo "  1) Eigene Domain mit automatischem HTTPS – das Skript startet Caddy (Ports 80/443 müssen frei sein)"
  echo "  2) Ich habe bereits Caddy im Docker-Netz \"reverse-proxy\" – nur Eintrag anzeigen"
  echo "  3) Nur zum Testen im Heimnetz: http://<Server-IP>:8080 (ohne Domain, ohne HTTPS)"
  case "${GS_MODE:-}" in own) choice=1 ;; existing) choice=2 ;; local) choice=3 ;; *) ask choice "Auswahl" "1" ;; esac
  case "$choice" in 1) MODE=own ;; 2) MODE=existing ;; 3) MODE=local ;; *) die "Ungültige Auswahl." ;; esac

  if [[ "$MODE" == local ]]; then
    IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    ask PUBLIC_URL "Adresse, unter der Nutzer den Server erreichen" "http://${IP:-localhost}:8080"
    DOMAIN=""
  else
    ask DOMAIN "Domain (DNS-Eintrag muss auf diesen Server zeigen), z. B. games.example.com" "${GS_DOMAIN:-}"
    [[ -n "$DOMAIN" ]] || die "Eine Domain wird benötigt."
    DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%%/*}"
    PUBLIC_URL="https://$DOMAIN"
  fi
  [[ "$MODE" == own ]] && ask ACME_EMAIL "E-Mail für Let's Encrypt (Hinweise zu Zertifikaten)" "${GS_ACME_EMAIL:-}"
  ask DATA_PATH "Speicherort für Spieldateien (große Platte!)" "${GS_DATA_PATH:-$INSTALL_DIR/data}"

  cp .env.example .env
  chmod 600 .env
  set_env PUBLIC_URL "$PUBLIC_URL"
  set_env POSTGRES_PASSWORD "$(rand_hex 24)"
  set_env APP_SECRET "$(rand_hex 32)"
  set_env DATA_PATH "$DATA_PATH"
  set_env COOKIE_SECURE "$([[ "$MODE" == local ]] && echo false || echo true)"
  echo "$MODE" > "$MODE_FILE"
  [[ -n "$DOMAIN" ]] && echo "$DOMAIN" > "$INSTALL_DIR/.install-domain"
  [[ -n "${ACME_EMAIL:-}" ]] && echo "$ACME_EMAIL" > "$INSTALL_DIR/.install-acme"
  ok ".env angelegt (Datenbank-Passwort und App-Geheimnis zufällig erzeugt)"
else
  MODE=$(cat "$MODE_FILE" 2>/dev/null || echo existing)
  DOMAIN=$(cat "$INSTALL_DIR/.install-domain" 2>/dev/null || true)
  ACME_EMAIL=$(cat "$INSTALL_DIR/.install-acme" 2>/dev/null || true)
  DATA_PATH=$(grep -E '^DATA_PATH=' .env | cut -d= -f2-)
  ok "Bestehende .env wird beibehalten"
fi

# Rechte setzt der Server-Container beim Start selbst (Benutzer "node")
mkdir -p "$DATA_PATH"

# ---------- Webzugang (Caddy) ----------
CADDY_DIR="$INSTALL_DIR/caddy"
write_caddy() {
  mkdir -p "$CADDY_DIR"
  local site="$1" globals="$2"
  cat > "$CADDY_DIR/Caddyfile" <<EOF
# Automatisch erzeugt von deploy/install.sh
{
$globals
}

$site {
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
	header -Server
}
EOF
  cat > "$CADDY_DIR/docker-compose.yml" <<EOF
# Automatisch erzeugt von deploy/install.sh – Caddy als Reverse Proxy für den Game Server
name: gameserver-caddy
services:
  caddy:
    image: caddy:2-alpine
    container_name: gameserver-caddy
    restart: unless-stopped
    ports:
$3
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    networks: [reverse-proxy]
networks:
  reverse-proxy:
    external: true
volumes:
  caddy-data: {}
  caddy-config: {}
EOF
}
case "$MODE" in
  own)
    write_caddy "$DOMAIN" "${ACME_EMAIL:+	email $ACME_EMAIL}" '      - "80:80"
      - "443:443"
      - "443:443/udp"'
    ;;
  local)
    write_caddy ":8080" "	auto_https off" '      - "8080:8080"'
    ;;
esac

# ---------- Bauen und starten ----------
echo
info "Baue und starte die Container (beim ersten Mal dauert das einige Minuten) …"
docker compose up -d --build
if [[ "$MODE" != existing ]]; then
  docker compose -f "$CADDY_DIR/docker-compose.yml" up -d
fi

info "Warte auf den Server …"
for i in $(seq 1 90); do
  if docker compose exec -T server wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then break; fi
  sleep 2
  [[ $i -eq 90 ]] && die "Server antwortet nicht. Logs ansehen: cd $INSTALL_DIR && docker compose logs server"
done
ok "Server läuft (Datenbank-Migrationen angewendet)"

# ---------- Erster Admin ----------
if ! $UPDATE; then
  echo
  echo "${B}Erstes Admin-Konto${N}"
  ask ADMIN_USER "Benutzername" "${GS_ADMIN_USER:-admin}"
  ask ADMIN_MAIL "E-Mail" "${GS_ADMIN_EMAIL:-${ACME_EMAIL:-}}"
  ADMIN_PW="${GS_ADMIN_PASSWORD:-}"
  ask_secret ADMIN_PW "Passwort (mind. 10 Zeichen)"
  docker compose exec -T -e ADMIN_USERNAME="$ADMIN_USER" -e ADMIN_EMAIL="$ADMIN_MAIL" -e ADMIN_PASSWORD="$ADMIN_PW" \
    server node dist/seed.js </dev/null
  unset ADMIN_PW
  ok "Admin-Konto '$ADMIN_USER' angelegt"
fi

# ---------- Ein-Klick-Update aus dem Panel (optional, nur Erstinstallation) ----------
# Richtet einen Host-Dienst ein, der „Jetzt aktualisieren“ im Admin-Panel ausführt. Ohne diesen Schritt
# zeigt das Panel nur den manuellen Befehl – updaten geht dann per `sudo bash $INSTALL_DIR/deploy/self-update.sh`.
if ! $UPDATE; then
  setup_oneclick=false
  case "${GS_ONECLICK_UPDATE:-}" in
    yes|true|1) setup_oneclick=true ;;
    no|false|0) setup_oneclick=false ;;
    *) confirm "Ein-Klick-Update im Admin-Panel aktivieren? (richtet einen Host-Dienst ein)" && setup_oneclick=true ;;
  esac
  if $setup_oneclick; then
    FLAG="$DATA_PATH/.update-requested"
    set_env UPDATE_COMMAND "touch /data/.update-requested"
    docker compose up -d >/dev/null   # .env neu laden
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
      ok "Ein-Klick-Update aktiviert (systemd-Dienst gameserver-update.service)"
    else
      warn "Kein systemd gefunden – Watcher wird nur bis zum Neustart ausgeführt."
      GS_INSTALL_DIR="$INSTALL_DIR" nohup bash "$INSTALL_DIR/deploy/update-watcher.sh" "$FLAG" >"$INSTALL_DIR/.update.log" 2>&1 &
      ok "Ein-Klick-Update aktiviert (Hintergrundprozess; nach Neustart erneut ausführen)"
    fi
  fi
fi

# ---------- Zusammenfassung ----------
URL=$(grep -E '^PUBLIC_URL=' .env | cut -d= -f2-)
echo
echo "${G}${B}Fertig!${N}"
echo
case "$MODE" in
  own)
    echo "  Aufrufen:  ${B}$URL${N}"
    echo "  Das HTTPS-Zertifikat holt Caddy automatisch beim ersten Aufruf (DNS muss auf diesen Server zeigen,"
    echo "  Ports 80 und 443 müssen aus dem Internet erreichbar sein)."
    ;;
  local)
    echo "  Aufrufen:  ${B}$URL${N}   (nur fürs Heimnetz – ohne HTTPS nicht ins Internet stellen)"
    ;;
  existing)
    echo "  Diesen Eintrag in deine Caddyfile übernehmen und Caddy neu laden:"
    echo
    sed "s/games.example.com/${DOMAIN:-games.example.com}/" deploy/Caddyfile | sed 's/^/    /'
    echo
    echo "  Danach aufrufen: ${B}$URL${N}"
    ;;
esac
echo
echo "  Desktop-Client: Installer unter Verwaltung → Desktop-Client hochladen, dann für alle unter $URL/client"
echo "  Spieldateien:   $DATA_PATH"
echo "  Konfiguration:  $INSTALL_DIR/.env   (danach: cd $INSTALL_DIR && docker compose up -d)"
echo "  Update:         sudo bash $INSTALL_DIR/deploy/install.sh"
echo "  Logs:           cd $INSTALL_DIR && docker compose logs -f server"
echo "  Backups:        im Admin-Panel unter Verwaltung → Backups"
echo
