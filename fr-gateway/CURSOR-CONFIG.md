# API-Keys & Endpunkte (fr-gateway) — Cursor-Setup

Stand: 2026-10-26. Alles lokal, nichts davon committen.

## 1. Wo liegen die Keys?

| Datei | Inhalt | Wofür |
|---|---|---|
| `fr-gateway/secrets/registry.json` | **Master-Registry**, 46 Einträge | Quelle der Wahrheit: `nr`, `port`, `unique_key` (Client-Key), `raw_key` (Upstream-Key), `model_family`, `container`, `state` |
| `fr-gateway/secrets/keys_unique.txt` | 46 Client-Keys (`vkd-…`), einer pro Zeile | **Das ist der Key für Cursor / OpenAI-Clients** (Zeile = `nr`) |
| `fr-gateway/secrets/keys.map.json` | Map `unique_key → raw_key` | Nachschlagen, welcher Upstream-Key hinter einem Client-Key steckt |
| `fr-gateway/keys_raw.txt` | 46 Upstream-Keys (`sk-ae240627ae4c44d4-…`) | Nur Gateway/Manager → Upstream, **nicht** an Cursor geben |
| `fr-gateway/secrets/.secret` | binäres Master-Secret | Gateway-Interna, nicht teilen |
| `harness-pro/data/desk.json` | Rollen-Zuordnung: `boss_astra → key_astra_1` (nr 1, Port 20129), `sub_opus → key_opus_24` (nr 24, Port 20152); Keys dort nur maskiert | Harness-Orchestrator |
| `fr-gateway/registry.json` | leer (`[]`), Altlast | ignorieren |

Registry-Fakten: 46 Einträge, `state=running`, 23× `astra` + 23× `opus`, Ports **20129–20174**.
Familie ist nur Metadatum — jeder Container liefert alle Router-Modelle.

## 2. Endpunkte

| Zweck | URL | Auth |
|---|---|---|
| Gateway-Container (OpenAI-kompatibel) | `http://127.0.0.1:<PORT>/v1` mit `PORT = 20129 … 20174` | `Authorization: Bearer <unique_key>` |
| — Chat | `POST /v1/chat/completions` | dito |
| — Modelle | `GET /v1/models` | dito |
| Direkter Router (ohne Key, Host) | `http://127.0.0.1:20128/v1` | keine |
| Panel | `http://127.0.0.1:8090` | — |
| Upstream-Pool / Failover | `fr-gateway/upstreams.json` → primary `host.docker.internal:20128`, free-bridge `:20201`, local-light `:20200` | — |

Modell-IDs (alle Container + Router): `gpt-6-astra`, `claude-opus-5.5`, dazu `lgw/…`- und `oc/…`-Varianten (`lgw/mmf/mimo-auto`, `mmf/mimo-auto`, `oc/union-alpha`, …).
Key-Beispiele: nr 1 → Port 20129, Key = Zeile 1 aus `keys_unique.txt`; nr 2 → Port 20130; nr 24 → Port 20152.

## 3. Cursor konfigurieren

Cursor (Settings `Ctrl+Shift+J` → **Models**):

1. **OpenAI API Key**: `unique_key` (`vkd-…`) aus `secrets/keys_unique.txt` einsetzen — **nicht** `raw_key`.
   Empfehlung: einen eigenen Key für Cursor nehmen (z. B. nr 2 / Zeile 2), damit Harness-Rollen (nr 1, 24) frei bleiben.
2. **Override OpenAI Base URL**: `http://127.0.0.1:20130/v1` (Port = Key-nr: `PORT = 20128 + nr`).
3. **Use OpenAI API Key** aktivieren.
4. Modell manuell hinzufügen: `gpt-6-astra` (Tool-Calling, für Agent/Composer) oder `claude-opus-5.5`.
5. Test: im Cursor-Chat „ping“; parallel prüfen:
   `powershell -File fr-gateway\tools\cursor-config.ps1 -Nr 2 -Check`

Hinweis: Die Cursor-GUI speichert Base-URL/Key nicht in `%APPDATA%\Cursor\User\settings.json`, sondern im Cursor-Modell-Dialog (globalStorage `state.vscdb`). `~/.cursor/cli-config.json` ist nur die CLI-Agent-Config (Permissions/Layout) — dort steht kein API-Endpunkt.

**429-Situation:** Der echte Upstream hängt aktuell im Limit. Der Gateway failt dann auf free-bridge (`:20201`) bzw. local-light (`:20200`) — local-light liefert nur Prosa, also für Cursor/Agenten erst sinnvoll, wenn der echte Upstream wieder Kapazität hat. Direkter Router `:20128` ist erreichbar, liefert aber ebenfalls 429.

## 4. Helper

```powershell
# Werte anzeigen (BASE_URL, API_KEY, MODEL) für Key nr 2:
powershell -File fr-gateway\tools\cursor-config.ps1 -Nr 2

# Key direkt in die Zwischenablage + Endpoint-Check:
powershell -File fr-gateway\tools\cursor-config.ps1 -Nr 2 -CopyKey -Check

# Ersten freien astra- bzw. opus-Key nehmen:
powershell -File fr-gateway\tools\cursor-config.ps1 -Family astra
```

Sicherheit: `secrets/`, `keys_raw.txt`, `secrets/.secret` niemals in ein Repo/Log/Issue kopieren. Der Client-Key (`vkd-…`) darf lokal in Cursor stehen, der `raw_key` (`sk-…`) bleibt im Gateway.
