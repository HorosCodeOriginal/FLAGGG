#!/bin/sh
# healthcheck: nginx antwortet lokal. upstream-tot -> 502/504, log + unhealthy,
# aber container bleibt up (--restart unless-stopped restartet nicht bei unhealthy).
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 -H "Authorization: Bearer ${CLIENT_API_KEY:-}" http://127.0.0.1:80/v1/models || true)
FAMILY="${MODEL_FAMILY:-?}"
if [ "$code" = "200" ]; then
    exit 0
fi
echo "healthcheck[$FAMILY]: gateway http=$code $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /var/log/nginx/error.log
exit 1
