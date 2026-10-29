# fr-gateway tools — Upstream-Stubs

Dieses Verzeichnis enthaelt die beiden lokalen Upstream-Dienste des
`fr-gateway` Upstream-Pools, die auf dem **Host** (nicht in Docker) laufen
und vom Gateway-Container ueber `host.docker.internal` erreicht werden.
Beide sind OpenAI-kompatibel (Chat-Completions-Stil) und benoetigen **keine
externen Pakete** (nur Node.js >= 18).

| Datei | Zweck | Default-Port |
| --- | --- | --- |
| `light-upstream.js` | Offline-Stub, letzte Failover-Stufe (`local-light`) | 20200 |
| `free-model-bridge.js` | Brueckenkopf zu einem entfernten Endpunkt (`free-bridge`) | 20201 |
| `test-stubs.js` | Integrationstest fuer beide (40 Checks) | — |

## Start

```bash
cd fr-gateway/tools

# light-upstream auf 20200
node light-upstream.js                # oder: PORT=20200 node light-upstream.js

# free-model-bridge auf 20201 (Fallback-Modus)
node free-model-bridge.js             # oder: PORT=20201 node free-model-bridge.js

# bridge im Proxy-Modus
UPSTREAM_URL=http://host.docker.internal:3456/v1 \
UPSTREAM_KEY=sk-xyz \
node free-model-bridge.js

# Tests (Exit 0 = alles gruen)
node test-stubs.js
```

## light-upstream.js

Einfacher Offline-Stub. Antwortet immer mit einer kleinen, hilfreichen
Modellnachricht (Modell `offline-stub`), zaehlt Requests (ueber `/healthz`
abrufbar) und loggt jede Anfrage auf stdout.

- `POST /v1/chat/completions` → `200`, `chat.completion` inkl. `usage`
  (`prompt_tokens`/`completion_tokens`/`total_tokens` — wichtig, weil der
  Gateway-Limiter `fr_limiter.lua` das Token-Kontingent aus der `usage`-Antwort
  zaehlt).
- `GET /v1/models` → `200`, OpenAI-Modell-Liste.
- `GET /healthz` → `200`, `{status, service, model, requests, started_at}`.
- Alles andere → `404` JSON.

Env: `PORT` (Default 20200), `MODEL_ID` (Default `offline-stub`).

## free-model-bridge.js

Mini-OpenAI-kompatibler Proxy. Zwei Modi:

1. **Fallback-Modus** (keine `UPSTREAM_URL`): verhaelt sich wie
   `light-upstream.js`, haengt aber `bridge`-Metadata an jede
   Chat-Completions-Antwort an:
   ```json
   { "bridge": { "mode": "local-fallback", "service": "free-model-bridge",
                 "upstream_url": null, "key_configured": false } }
   ```
2. **Proxy-Modus** (`UPSTREAM_URL` gesetzt): leitet
   `POST /v1/chat/completions` und `GET /v1/models` an den entfernten Endpunkt
   weiter. Statuscodes und Body werden **unveraendert** durchgereicht —
   inklusive `401/402/403/429/5xx`, damit der nginx-Failover des Gateways
   (Primary → Backup1 → Backup2) diese Codes wie gewohnt als Fehler wertet.
   Ist `UPSTREAM_KEY` gesetzt, wird `Authorization: Bearer <key>` an den
   Upstream gesendet.

### Konvention: 429 ohne Key

Wenn `UPSTREAM_URL` gesetzt ist, `UPSTREAM_KEY` aber **leer**, antwortet die
Bridge mit:

```json
{ "error": { "type": "bridge_no_key", "message": "UPSTREAM_KEY fehlt; ..." } }
```

(Status `429`). Begruendung: Ohne Token kann die Bridge nicht sicherstellen,
dass der entfernte Dienst den Request annimmt; der `429` schaltet den
fr-gateway-Failover sauber auf die naechste Stufe (`local-light`), statt dem
Client einen unauthentifizierten Proxyfehler zu zeigen. Fuer einen wirklich
keylosen Upstream `UPSTREAM_KEY` auf einen Dummy-Wert setzen (z.B. `"none"`)
— der Header wird dann gesendet, und falls der Endpunkt ihn ignoriert, kommt
der Request durch. Diese Konvention wird in `test-stubs.js` getestet.

Env: `PORT` (Default 20201), `UPSTREAM_URL`, `UPSTREAM_KEY`, `MODEL_ID`
(Default `free-model-bridge`, nur Fallback-Modus).

## Wie manager.py / das Gateway sie nutzt

- `fr-gateway/upstreams.json` definiert den Pool: `primary-router`
  (echter Router, extern) → `free-bridge` (`:20201`) → `local-light`
  (`:20200`).
- `manager.py` liest die Datei, gibt die Host-Ports als
  `UPSTREAM_*_HOSTPORT` (Primary/Backup1/Backup2) an die Gateway-Container
  weiter; der Container-Entrypoint ersetzt damit die nginx-`upstream`-Blöcke.
- `gateway/nginx.conf` routet selbst`POST /v1/chat/completions` und
  `GET /v1/models` durch die Kette; bei `401/402/403/429/500/502/503/504`
  wird auf den naechsten Upstream umgeschaltet (Failover). Die Stubs muessen
  daher genau diese Routen und Statuscodes sprechen — `light-upstream.js`
  antwortet nie mit einem Fehlerstatus (nur `200`/`404`), sodass `local-light`
  als letzte Stufe immer eine Antwort liefert.
- `gateway/lua/fr_limiter.lua` zaehlt das taegliche Token-Kontingent aus der
  `usage`-Antwort der Upstreams und antwortet selbst mit `429`, wenn das Limit
  erreicht ist — deshalb liefern beide Stubs echte `usage`-Zahlen.

## Test

`node test-stubs.js` startet beide Stubs auf zufaelligen Ports und prueft:

1. `light-upstream`: `/v1/models` (Schema), `chat/completions`
   (Schema + `usage`), `/healthz`-Zaehler.
2. `bridge` Fallback: `/v1/models`, `chat/completions` + `bridge`-Metadata.
3. `bridge` Proxy **ohne** Key: `429` + `error.type="bridge_no_key"`
   (Konvention, s.o.).
4. `bridge` Proxy **mit** Key: Antwort des Ziel-Upstreams kommt per
   Passthrough durch (`200`, Schema, kein `bridge`-Metadata).

Ergebnis: 40/40 Checks.
