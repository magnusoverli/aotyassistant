#!/bin/sh
set -eu
# Only the application's explicitly configured data directory is prepared.
mkdir -p "$DATA_DIR"
chown node:node "$DATA_DIR"
chmod 700 "$DATA_DIR"
if [ "${HA_ADDON:-0}" = "1" ] && [ -f /data/options.json ]; then
  chown node:node /data/options.json
  chmod 600 /data/options.json
fi
if [ "${HA_ADDON:-0}" = "1" ]; then
  mkdir -p /run/aoty
  chown node:node /run/aoty
  chmod 700 /run/aoty
fi
# The web server never runs as root.
exec su-exec node node dist/server/index.js
