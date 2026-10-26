# ERKENNTNISSE 2 — Weiterführende Befunde (read-only)

Ergänzung zur ersten Analyse (2026-10-25). Kein Bestands-Code verändert;
anwendbare Fixes liegen in `ERKENNTNISSE2.patch` (2 Dateien, `git apply --check` OK).

## Neue Befunde

### S1 — Kritisch: Panel-API ohne Authentifizierung, auf allen Interfaces gebunden
- `panel/Dockerfile:11`: `uvicorn … --host 0.0.0.0 --port 8090`; `docker-compose.yml:42` publiziert `8090:8090` → Panel ist im LAN erreichbar.
- `panel/app.py:38-44`: CORS `allow_origins=["*"]`. **Keine Auth** an allen API-Endpunkten:
  `/api/fleet`, `/api/stats`, `/api/keys/add`, `/api/keys/revoke`, `/api/limit/set`,
  `/api/limit/reset`, `/api/upstreams`, `/api/gateway/models`, `/api/gateway/chat`,
  `/logs/{container}`, `/ws`.
- `panel/app.py:272-284` (`aggregate_fleet`): liefert **`name` = roher Upstream-Key (`raw_key`)** und `unique_key` für jeden Eintrag → vollständiger Key-Export über ungeschützten Endpunkt.
- `/api/gateway/chat` (Zeilen 495-537): unauthentifizierter Chat-Proxy über beliebige Fleet-Ports.
- Empfehlung: Loopback-Bind (Patch), Auth (Token/secret) vor Freigabe, CORS einschränken.

### S2 — Kritisch: Live-Nachweis eines Provider-429 (OpenCode Free-Limit)
- `harness-pro/data/desk.json` enthält eine gespeicherte Antwort:
  `[429]: FreeUsageLimitError … "Free usage limit reached. Free models work in OpenCode … subscribe to OpenCode Go"`.
- Das heißt: der 429 kann **direkt vom Provider (OpenCode)** kommen — nicht nur vom lokalen Limiter. In dem Fall reicht die Gateway-Rotation zu einem zweiten lokalen Port nicht; es braucht einen **echten zweiten Upstream** (anderer Provider/Account) im `upstreams.json`-Pool.

### S3 — Hoch: Familien-Pinning deterministisch, aber klonabhängig
- `fr-harness/astra.json`: `family:astra`, `key_hash` = Key-Nr. 1.
- `claude-harness/_new_layer/astra.json` und `harness-pro/_new_layer/astra.json`: `family:opus`, `key_hash` = Key-Nr. 23.
- Die Familie eines Klons ist damit fest verdrahtet (DNA), nicht konfigurierbar zur Laufzeit; ein 23er-Switch (opu→astra) erfordert Datei-Edit + Neustart.

### S4 — Mittel: Konfig-Drift Temperature/Defaults zwischen Legacy und `_new_layer`
- Legacy-Prefs (`astra-harness/js/app.js:13`): `temperature 0.4, topP 1.00, maxTokens 1200`.
- `_new_layer` (`main/main.js:578`): Defaults `temperature 0.7, top_p 1, max_tokens 1024`.
- Zwei parallele Konfig-Systeme (localStorage vs. `desk.json` vs. `envs/<nr>/config.json`).

### S5 — Mittel: `check-parity.ps1` unter Windows PowerShell 5.1 fehleranfällig
- Reproduziert: `powershell -File check-parity.ps1` bricht bei Zeile 118 ab (`im` nicht erkannt). Ursache: UTF-8 ohne BOM wird von PS 5.1 als ANSI gelesen; mit `pwsh` (7) läuft es.
- Fix: Datei mit BOM speichern oder ASCII-Hinweise verwenden.

### S6 — Niedrig/Mittel: Hygiene & Inventar
- **Kein `.gitignore`** im gesamten Workspace; Raw-Keys (`sk-ae240627ae4c44d4-…`) liegen nur in `secrets/registry.json`, `secrets/keys.map.json`, `testrun/*/keys.map.json` und `check-app-health.ps1` (Kontamination begrenzt, aber bei Git-Init vollständig erfasst).
- Alle 46 Raw-Keys teilen denselben Präfix `sk-ae240627ae4c44d4-` → gleiche Upstream-Identität; bei Provider-Drosselung des Kontos ist die komplette Fleet betroffen (verstärkt Single-Point).
- Assets: `generated-images` 2, `screenshots` 1, `mockups der anwendung` 13 Dateien (reine Bilder).
- `panel/static/index.html:7-8`: lädt Google-Fonts von extern (offline-Drift).

### S7 — Niedrig: Panel-Robustheit
- `/api/upstreams` (Zeile 455): `reg[0]["unique_key"]` wirft `IndexError` bei leerer Registry → 500.
- `/api/limit/set` stoppt/entfernt Container sofort; Wiederanlage erst durch Manager-Watch (Intervall 30 s) → kurze Ausfallzeit je Port.

## Patch-Inhalt (ERKENNTNISSE2.patch)

| Datei | Änderung |
|---|---|
| `fr-gateway/panel/Dockerfile` | Bind `0.0.0.0` → `127.0.0.1` (Panel nur lokal; LAN-Zugriff explizit + Auth) |
| `fr-gateway/panel/app.py` | `ASTRA_COUNT` aus Env (`"22"` Default) — deckt sich mit Manager-Override |

Anwendung:
```
git apply --check ERKENNTNISSE2.patch
git apply ERKENNTNISSE2.patch
```
Hinweis: Nach Dockerfile-Änderung Panel-Image neu bauen (`docker compose up -d --build panel`).
