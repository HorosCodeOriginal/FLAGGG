#!/bin/bash
# deploy_sweep.sh — kompletter gateway-deploy + fleet-sweep auf dem zielhost.
# Reihenfolge: install -> keycloak (idempotenz-check) -> systemd -> warten auf alle keys -> sweep.
set -uo pipefail

BASE=/opt/fr-gateway
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[1] install"
if [ ! -x "$BASE/bin/fr-manager" ]; then
    if [ -f "$DIR/install.sh" ]; then
        sudo "$DIR/install.sh"
    else
        echo "install.sh fehlt" >&2
        exit 1
    fi
else
    echo "bereits installiert"
fi

echo "[2] keycloak + idempotenz"
if [ ! -f "$BASE/.secret" ]; then
    "$BASE/bin/fr_keycloak" || { echo "keycloak-lauf 1 fehlgeschlagen" >&2; exit 1; }
fi
rm -rf /tmp/kc_snap && mkdir -p /tmp/kc_snap
cp "$BASE/keys_unique.txt" "$BASE/keys.map.json" /tmp/kc_snap/
out2=$("$BASE/bin/fr_keycloak" 2>&1)
echo "$out2"
if diff -q /tmp/kc_snap/keys_unique.txt "$BASE/keys_unique.txt" >/dev/null 2>&1; then
    echo "UNIQUE_IDEMPOTENT=ja"
else
    echo "UNIQUE_IDEMPOTENT=nein" >&2
    exit 1
fi
if diff -q /tmp/kc_snap/keys.map.json "$BASE/keys.map.json" >/dev/null 2>&1; then
    echo "MAP_IDEMPOTENT=ja"
else
    echo "MAP_IDEMPOTENT=nein" >&2
    exit 1
fi

echo "[3] systemd"
systemctl enable --now fr-manager.service
systemctl is-active fr-manager.service

echo "[4] warten auf alle container"
[ -f "$BASE/keys_raw.txt" ] || { echo "keys_raw.txt fehlt: $BASE/keys_raw.txt" >&2; exit 1; }
KEY_COUNT=$(wc -l < "$BASE/keys_raw.txt" | tr -d ' \t')
ASTRA_COUNT="${ASTRA_COUNT:-$((KEY_COUNT / 2))}"
echo "    keys=$KEY_COUNT  astra=1..$ASTRA_COUNT  opus=$((ASTRA_COUNT + 1))..$KEY_COUNT"
n=0
for i in $(seq 1 80); do
    n=$(docker ps --format '{{.Names}}' | grep -c '^fr-key-' || true)
    [ "${n:-0}" -eq "$KEY_COUNT" ] && break
    sleep 3
done
echo "CONTAINER_COUNT=${n:-0}"
docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' | grep '^fr-key-' | head -5

echo "[5] fleet-sweep"
python3 - <<'PY'
import hashlib, json
base="/opt/fr-gateway"
keys=[l.strip() for l in open(base+"/keys_raw.txt",encoding="utf-8") if l.strip() and not l.startswith("#")]
m=json.load(open(base+"/keys.map.json",encoding="utf-8"))
names=["fr-key-"+hashlib.sha256(k.encode()).hexdigest()[:12] for k in keys]
unis=[[u for u,r in m.items() if r==k][0] for k in keys]
json.dump({"names":names,"unis":unis}, open("/tmp/kc_sweep.json","w"))
PY

printf '%s\n' "nr|port|container|state|health|auth|auth-negativ|tokens|family|pong"
ok=0
pong_ok=0
bad=""
for nr in $(seq 1 "$KEY_COUNT"); do
    port=$((20128+nr))
    name=$(python3 -c "import json;print(json.load(open('/tmp/kc_sweep.json'))['names'][$nr-1])" 2>/dev/null)
    uniq=$(python3 -c "import json;print(json.load(open('/tmp/kc_sweep.json'))['unis'][$nr-1])" 2>/dev/null)
    fam=astra
    [ "$nr" -gt "$ASTRA_COUNT" ] && fam=opus

    state=fehlt
    if docker inspect -f '{{.State.Running}}' "$name" >/dev/null 2>&1; then
        st=$(docker inspect -f '{{.State.Running}}' "$name")
        if [ "$st" = "true" ]; then state=running; else state=stopped; fi
    fi

    health=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 -H "Authorization: Bearer $uniq" "http://localhost:$port/v1/models")
    auth=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -H "Authorization: Bearer $uniq" -H "Content-Type: application/json" -d '{"model":"probe"}' "http://localhost:$port/v1/chat/completions")
    neg=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -H "Authorization: Bearer vkd-wrong" -H "Content-Type: application/json" -d '{"model":"probe"}' "http://localhost:$port/v1/chat/completions")

    tokens=-
    if [ -f "/var/lib/fr-gateway/$name/counter.json" ]; then
        tokens=$(python3 -c "import json;print(json.load(open('/var/lib/fr-gateway/$name/counter.json'))['tokens'])" 2>/dev/null)
    fi

    # ---- pong: echtes chat-request gegen diesen port ----
    # modell = erstes modell aus GET /v1/models dieses ports
    model_id=$(curl -s --max-time 6 -H "Authorization: Bearer $uniq" "http://localhost:$port/v1/models" \
        | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    ids = [m.get("id") for m in d.get("data", []) if m.get("id")]
    print(ids[0] if ids else "")
except Exception:
    print("")' 2>/dev/null)

    pong="FAIL(no-model)"
    if [ -n "$model_id" ]; then
        rm -f /tmp/kc_pong.json
        pong_http=$(curl -s --max-time 30 -o /tmp/kc_pong.json -w '%{http_code}' \
            -H "Authorization: Bearer $uniq" -H "Content-Type: application/json" \
            -d "{\"model\":\"$model_id\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":8,\"stream\":false,\"temperature\":0}" \
            "http://localhost:$port/v1/chat/completions")
        pong_check=$(python3 -c 'import json
try:
    d = json.load(open("/tmp/kc_pong.json"))
except Exception:
    d = {}
tok = ((d.get("usage") or {}).get("completion_tokens") or 0)
try:
    c = d["choices"][0]["message"]["content"]
except Exception:
    c = ""
if not isinstance(c, str):
    c = ""
print(1 if (tok > 0 and c.strip()) else 0)
print(c[:10].replace("\n", " "))' 2>/dev/null)
        pong_ok_flag=$(printf '%s\n' "$pong_check" | sed -n '1p')
        pong_snip=$(printf '%s\n' "$pong_check" | sed -n '2p')
        if [ "$pong_http" = "200" ] && [ "$pong_ok_flag" = "1" ]; then
            pong=OK
        else
            pong="FAIL(${pong_http}+${pong_snip})"
        fi
    fi

    printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n' "$nr" "$port" "$name" "$state" "$health" "$auth" "$neg" "$tokens" "$fam" "pong=$pong"

    [ "$pong" = OK ] && pong_ok=$((pong_ok+1))

    # health: exakt 200 | auth: 200 oder 403 (403 = upstream lehnt probe-modell ab, erwartet)
    # auth-negativ: exakt 401 | state: running | pong: http 200 + completion_tokens>0 + inhalt nicht leer
    if [ "$state" = running ] && [ "$health" = 200 ] && { [ "$auth" = 200 ] || [ "$auth" = 403 ]; } && [ "$neg" = 401 ] && [ "$pong" = OK ]; then
        ok=$((ok+1))
    else
        bad="$bad $nr"
        printf 'FAIL nr=%s %s state=%s health=%s auth=%s neg=%s pong=%s\n' "$nr" "$name" "$state" "$health" "$auth" "$neg" "$pong" >&2
    fi
done

echo "SUMMARY: OK=$ok/$KEY_COUNT"
echo "PONG: $pong_ok/$KEY_COUNT"
if [ -n "$bad" ]; then
    echo "FAIL_PORTS:$bad"
    for nr in $bad; do
        name=$(python3 -c "import json;print(json.load(open('/tmp/kc_sweep.json'))['names'][$nr-1])" 2>/dev/null)
        echo "--- $name (nr $nr) ---"
        errlog=/var/log/fr-gateway/$name/error.log
        nginxlog=/var/log/fr-gateway/$name/nginx.log
        if [ -f "$errlog" ]; then
            echo "[error.log, letzte 20]"
            tail -n 20 "$errlog"
        else
            echo "[error.log fehlt: $errlog]"
        fi
        if [ -f "$nginxlog" ]; then
            echo "[nginx.log, letzte 10]"
            tail -n 10 "$nginxlog"
        else
            echo "[nginx.log fehlt: $nginxlog - stattdessen docker logs]"
            docker logs --tail 10 "$name" 2>&1 || true
        fi
    done
fi

rm -f /tmp/kc_pong.json
