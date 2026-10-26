#!/bin/sh
# ersetzt die Platzhalter in nginx.conf (upstream-pool + keys), wartet kurz auf
# host.docker.internal (hosts oder DNS), dann nginx starten.
set -e

sed -i \
    -e "s/__UPSTREAM_API_KEY__/${UPSTREAM_API_KEY:-}/g" \
    -e "s/__CLIENT_API_KEY__/${CLIENT_API_KEY:-}/g" \
    -e "s/__DAILY_TOKEN_LIMIT__/${DAILY_TOKEN_LIMIT:-2000000}/g" \
    /usr/local/openresty/nginx/conf/nginx.conf \
    /usr/local/openresty/nginx/lua/fr_limiter.lua

# Failover-Kette: primary -> backup1 -> backup2 (Host:Port, ohne schema)
PRIMARY="${UPSTREAM_PRIMARY_HOSTPORT:-host.docker.internal:20128}"
BACKUP1="${UPSTREAM_BACKUP1_HOSTPORT:-$PRIMARY}"
BACKUP2="${UPSTREAM_BACKUP2_HOSTPORT:-$BACKUP1}"
sed -i \
    -e "s/__UPSTREAM_PRIMARY__/$PRIMARY/g" \
    -e "s/__UPSTREAM_BACKUP1__/$BACKUP1/g" \
    -e "s/__UPSTREAM_BACKUP2__/$BACKUP2/g" \
    /usr/local/openresty/nginx/conf/nginx.conf

# Upstream-spezifische Keys (map-Direktive). Fallback ist der Key des Containers.
PRIMARY_KEY="${UPSTREAM_KEY_PRIMARY:-${UPSTREAM_API_KEY:-}}"
BACKUP1_KEY="${UPSTREAM_KEY_BACKUP1:-$PRIMARY_KEY}"
BACKUP2_KEY="${UPSTREAM_KEY_BACKUP2:-$BACKUP1_KEY}"
sed -i \
    -e "s/__UPSTREAM_KEY_PRIMARY__/$PRIMARY_KEY/g" \
    -e "s/__UPSTREAM_KEY_BACKUP1__/$BACKUP1_KEY/g" \
    -e "s/__UPSTREAM_KEY_BACKUP2__/$BACKUP2_KEY/g" \
    /usr/local/openresty/nginx/conf/nginx.conf

# nginx-worker (nobody) braucht Schreibrechte auf counter- und log-volumes
chown -R nobody:nogroup /var/lib/fr-gateway-counter 2>/dev/null || true
chown -R nobody:nogroup /var/log/nginx 2>/dev/null || true

i=0
while [ "$i" -lt 10 ]; do
    if grep -q 'host\.docker\.internal' /etc/hosts || getent hosts host.docker.internal >/dev/null 2>&1; then
        break
    fi
    i=$((i + 1))
    sleep 1
done

exec "$@"
