# Dreier-Team-Test — MiniVault (harness-pro · astra-harness · claude-harness)

**Datum:** 2026-10-29 · **Status:** ALLE TESTS GRÜN

## Konstellation

Drei separate Agent-Instanzen, je eine pro Harness, mit getrennten Schreibbereichen (`teamwork/`):

| Agent | Harness | Rolle | Scope |
|---|---|---|---|
| A | `harness-pro` | Backend/API (Node, Standardmodule) | `harness-pro/teamwork/` |
| B | `astra-harness` | Frontend (vanilla JS, kein Build) | `astra-harness/teamwork/` |
| C | `claude-harness` | Tests & Integration (`node:test`) | `claude-harness/teamwork/` |

Gemeinsames Ziel: **MiniVault** — einfache Passwort-Vault-Webanwendung, funktionierend über einen festen API-Vertrag.

## Vertrag (von Lead vorgegeben)

`POST /api/vaults {name}` → 201/400 · `GET /api/vaults` → 200 Liste · `GET /api/vaults/:id` → 200 Detail inkl. entries / 404 · `POST /api/vaults/:id/entries {title,username,secret}` → 201 / 404 / 400 · `GET /healthz` → 200. Port 9871, CORS-Origin `http://127.0.0.1:9872`.

## Verifikation (jeder Agent selbst)

- **A:** `node teamwork/smoke.mjs` → **6/6** (healthz, anlegen, Liste, Eintrag, 404, 400). Server danach gestoppt, Store geleert.
- **B:** `node teamwork/selfcheck.mjs` → **12/12** (Dateien, Funktionen, fetch/JSON, Basis-URL, kein localhost). `node --check app.js` ok.
- **C:** `node --test teamwork/integration.test.mjs` → **11/11** (8 API-Checks gegen echten Server + 3 statische Frontend-Checks; Server-Lifecycle sauber, kein Listener-Rest).

## Lead-Verifikation (unabhängig, Browser-E2E)

`node harness-pro/scripts/team-e2e.js` (Playwright, echtes Chromium):
- Vault anlegen → erscheint in der Liste ✓
- Vault öffnen → Detailansicht ✓
- Eintrag hinzufügen → sichtbar, **maskiert** (`••••••••`) im DOM ✓
- Toggle „zeigen/verbergen" → Secret erscheint/verschwindet ✓
- **0 Console-Fehler** über den gesamten Lauf ✓

## Befunde / Hinweise

1. **CORS ist hart auf `http://127.0.0.1:9872` gesetzt.** Das Frontend muss exakt von diesem Origin geladen werden (z.B. statischer Server auf 9872), sonst blockiert der Browser die API-Fetches.
2. Der frühere UI-Test-Fehlschlag in meinem E2E war **kein Produkt-Bug**, sondern verschmutzte Testdaten (Agent C hinterließ einen Vault mit Eintrag; mein erster Karten-Klick traf den alten Vault). Nach Store-Reset: grün.
3. Keine JS-Fehler, keine Crashes, kein Security-Leak (Secrets bleiben bis zum expliziten Toggle außerhalb des DOM).

## Dateien

- Backend: `harness-pro/teamwork/server.js` (Store: `data.json`)
- Frontend: `astra-harness/teamwork/index.html`, `app.css`, `app.js`
- Integration: `claude-harness/teamwork/integration.test.mjs`
- E2E (Lead): `harness-pro/scripts/team-e2e.js`

## Nachstellen

```
node harness-pro/teamwork/server.js          # Terminal 1 (PORT=9871)
node -e "… statischer Server auf 9872 …"    # Terminal 2 (oder team-e2e.js nutzt ihn automatisch)
node harness-pro/scripts/team-e2e.js         # voller Browserdurchlauf
node --test claude-harness/teamwork/integration.test.mjs
```
