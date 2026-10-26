# ERKENNTNISSE — Gesamtrepo-Analyse (read-only) & Patch

Analysezeitpunkt: 2026-10-25. Es wurde kein Bestands-Code verändert; alle Fixes liegen
als Unified-Diff in `ERKENNTNISSE.patch` (16 Dateien, EOL-pro-Datei angepasst,
`git apply --check` verifiziert).

## Repo-Anatomie

| Pfad | Rolle |
|---|---|
| `fr-gateway/` | Docker-Fleet: Manager (`manager.py`, v2 `bin/fr-manager`), OpenResty-Gateway je Key (`gateway/`), Panel (`panel/`), `upstreams.json`, `deploy_sweep.sh`, `install.sh`, `fr-manager.service`, `secrets/` (Registry, `.secret`, abgeleitete keys) |
| `fr-harness/` | **Master** der Modular-Ebene (`main/{main,chat,registry,files,term}.js`, `renderer/`, `preload/`, `astra.json` Familie) |
| `astra-harness/`, `claude-harness/`, `harness-pro/` | Klone: `package.json`-Boot = Legacy-`main.js`; `_new_layer/` ist Staging (byte-identisch über Klone, nicht verdrahtet); `harness-pro` hat zusätzlich Team/Tasks/Upstreams-IPC (45 Kanäle) |
| `panel-desktop/` | Elektron-Hülle des Panels |
| `testrun/`, `_bak2/` | Keycloak-Testarrefakte (44 Keys) bzw. Backup-Diffs (`.orig`) |
| `generated-images/`, `screenshots/`, `mockups der anwendung/`, `ai-harness-mockup.html` | Assets/Mockups |
| Skripte: `start-*.bat`, `autostart.bat`, `check-parity.ps1`, `check-app-health.ps1`, `pong-test.js` | Start/Health/Paritätsprüfung |
| `failover.diff`, `failover-hotfix.diff` | Im Baum vorhandene, **teilangewandte** Failover-Patches (nginx-Pool + JSON-Fallback + Upstream-Umbenennung bereits im Arbeitsbaum; Backup-Upstream weiterhin leer) |

## Hauptbefunde

1. **Token-Cap:** Anzeige hartkodiert `1.900.000` (16 Dateien über alle Klone), echter erzwungener Limit = `2.000.000`/Container/Tag (Lua `fr_limiter.lua`). → Patch: Konstante auf `2000000`.
2. **Astra/Opus-Split inkonsistent:** `manager.py` 23/23 vs. deployte Fleet 22/24. → Patch: `ASTRA_COUNT`-Env-Override; `deploy_sweep.sh` nutzt dasselbe Env.
3. **Failover (Infra):** `nginx.conf` + `fr_upstreams.lua` enthalten Pool/Circuit-Breaker/JSON-Fallback bereits (Hotfix teilangewandt); `upstreams.json`-Backup ist aber weiterhin leer/deaktiviert → **nächster Schritt:** zweiten aktiven Upstream eintragen (Hinweis-Feld im Patch ergänzt).
4. **Failover (Harness):** Rotation ist quota-basiert (15 %-Schwellwert), **kein 429-Retry**; alle 46 Ports teilen denselben Upstream `:20128` → Single-Point bleibt. Empfehlung: 429-Retry mit Instanz-Rotation in `chat.js`/`main.js`.
5. **Modell-Zuordnung:** `gpt-6-astra` und `claude-opus-5.5` → beide `oc/big-pickle` (OpenCode Free) via Rename in FlagshipRouter (`brand.json`), `hideTarget: true`.
6. **Router-Source:** `FlagshipRouter` = Open-Source-Fork (Origin `github.com/theRizwan/FlagshipRouter`, MIT, Basis decolua), läuft als Node auf `:20128`.
7. **UI-Mock:** Orchestrierung/Timeline/Plugin-Marktplatz = statische `data.js`-Demo, In-Memory-Mutationen; kein Plugin-Backend.
8. **Parität:** `check-parity.ps1` meldet falsch-negativ: Klone halten den neuen Code unter `_new_layer/`, der Master unter der Wurzel → 13 „fehlende“ Dateien pro Klon. → Patch: Pfad-Normalisierung `_new_layer/` → Wurzel.
9. **Sicherheit:** Raw-Keys (`sk-…`) und `.secret` liegen im Repo; `vkd-`-Keys = HMAC-SHA256-Ableitung. Key-Rotation + Restriktion empfohlen.

## Patch-Inhalt (ERKENNTNISSE.patch) — 16 Dateien

| Datei | Änderung |
|---|---|
| `fr-gateway/manager/manager.py` | `astra_count_for` ehrt `ASTRA_COUNT` (Env), Default weiterhin `len//2` |
| `fr-gateway/deploy_sweep.sh` | `ASTRA_COUNT="${ASTRA_COUNT:-…}"` |
| `fr-gateway/upstreams.json` | Hinweis-Feld am Backup-Eintrag (URL + `enabled: true` zum Aktivieren) |
| `check-parity.ps1` | normalisiert `_new_layer/`-Pfade der Klone |
| `astra-harness/{main.js, js/app.js, legacy/main.js, legacy/js/app.js, _new_layer/main/main.js}` | `TOKEN_LIMIT = 2000000` |
| `fr-harness/main/main.js` | dito |
| `claude-harness/{main.js, js/app.js, _new_layer/main/main.js}` | dito |
| `harness-pro/{main.js, js/app.js, _new_layer/main/main.js}` | dito |

Anwendung (Pfade relativ zu diesem Repo-Ordner):
```
git apply --check ERKENNTNISSE.patch
git apply ERKENNTNISSE.patch
```
Verifiziert: `git apply --check` und `git apply` laufen in einem Spiegelbaum der Zieldateien fehlerfrei durch (Exit 0).
