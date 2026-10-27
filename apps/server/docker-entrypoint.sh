#!/bin/sh
set -e

# Datenverzeichnis vorbereiten und Rechte an den unprivilegierten Nutzer "node" abgeben.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown node:node "$DATA_DIR"
  for d in builds media avatars uploads backups tmp; do
    mkdir -p "$DATA_DIR/$d"
    chown node:node "$DATA_DIR/$d"
  done
  exec su-exec node "$0" "$@"
fi

# Datenbankmigrationen anwenden
./node_modules/.bin/prisma migrate deploy

# Seed-Shortcut: docker compose run --rm server seed --username admin --email ...
if [ "$1" = "seed" ]; then
  shift
  exec node dist/seed.js "$@"
fi

exec "$@"
