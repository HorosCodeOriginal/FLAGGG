#!/bin/bash
# install.sh — legt fr-gateway nach /opt/fr-gateway und aktiviert systemd-unit
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${DEST:-/opt/fr-gateway}"

if [ "$(id -u)" -ne 0 ]; then
    echo "root benoetigt" >&2
    exit 1
fi

command -v docker >/dev/null 2>&1 || { echo "docker fehlt" >&2; exit 1; }

mkdir -p "$DEST/bin" "$DEST/gateway/lua" /var/log/fr-gateway /var/lib/fr-gateway

install -m 0755 "$SRC/bin/fr-manager" "$DEST/bin/fr-manager"
install -m 0755 "$SRC/bin/fr_keycloak" "$DEST/bin/fr_keycloak"
install -m 0644 "$SRC/fr-manager.service" /etc/systemd/system/fr-manager.service
install -m 0644 "$SRC/gateway/Dockerfile" "$DEST/gateway/Dockerfile"
install -m 0644 "$SRC/gateway/nginx.conf" "$DEST/gateway/nginx.conf"
install -m 0644 "$SRC/gateway/lua/fr_limiter.lua" "$DEST/gateway/lua/fr_limiter.lua"
install -m 0755 "$SRC/gateway/entrypoint.sh" "$DEST/gateway/entrypoint.sh"
install -m 0755 "$SRC/gateway/healthcheck.sh" "$DEST/gateway/healthcheck.sh"

if [ ! -f "$DEST/keys_raw.txt" ]; then
    install -m 0600 "$SRC/keys_raw.txt" "$DEST/keys_raw.txt"
fi

if [ ! -f "$DEST/registry.json" ]; then
    install -m 0644 "$SRC/registry.json" "$DEST/registry.json"
fi

chown -R root:root "$DEST"

systemctl daemon-reload
systemctl enable fr-manager.service

echo "fertig. start: systemctl start fr-manager"
