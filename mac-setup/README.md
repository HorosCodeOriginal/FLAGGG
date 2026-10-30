# macOS: Zwei separate Harness-Instanzen (Astra + Opus)

Dieses Paket bringt auf einem Mac exakt das Setup, das unter Windows als
„DeepSeek Harness - ASTRA 1“ und „DeepSeek Harness - OPUS 1“ läuft:

| Instanz | Profil | Gateway-Port | Modell | Key |
|---|---|---|---|---|
| Astra | `~/.dsh/profiles/astra` | `127.0.0.1:20129` | `gpt-6-astra` | `ASTRA_API_KEY` |
| Opus | `~/.dsh/profiles/opus` | `127.0.0.1:20152` | `claude-opus-5.5` | `OPUS_API_KEY` |

Beide Instanzen laufen **parallel** — jede mit eigenem Profil und eigenem
`--user-data-dir` (so kollidieren weder die Chromium-Caches noch der
Single-Instance-Lock).

---

## Schritt 1 — Voraussetzungen

- Node 20+ und Docker Desktop (siehe `MAC_SETUP_ANLEITUNG.md`, Schritt 0)
- Die **DeepSeek-Harness-Desktop-App** (gleiche App wie unter Windows, nur als
  `DeepSeek Harness.app`, z.B. in `/Applications`). Falls noch nicht installiert:
  einmal installieren. Alternative: App aus `harness-pro` bauen (`npm install`,
  `npm run start`), der Pfad ist dann per `DSH_APP_PATH` konfigurierbar.

## Schritt 2 — Repo klonen + Gateway hochfahren

```bash
git clone https://github.com/<DEIN_USERNAME>/FLAGGG.git
cd FLAGGG
git remote add upstream https://github.com/HorosCodeOriginal/FLAGGG.git

cd fr-gateway
cp keys_raw.txt.example secrets/keys_raw.txt
cp registry.example.json secrets/registry.json
docker compose up -d --build
# Panel: http://127.0.0.1:8090
```

## Schritt 3 — Dienste (Upstreams) starten

Die Gateways brauchen die Host-Upstreams (Router + Pool + Stubs). In **vier
Terminals**:

```bash
# Terminal 1: Inception-Pool (Port 20199)
node mac-setup/services/inception-pool.js

# Terminal 2: primary-router (Port 20128, mappt Modell-IDs auf mercury-3)
node mac-setup/services/primary-router.js

# Terminal 3: free-model-bridge (Port 20201)
node fr-gateway/tools/free-model-bridge.js

# Terminal 4: light-upstream (Port 20200)
node fr-gateway/tools/light-upstream.js
```

> Vor dem ersten Start: `npm install` in `fr-gateway/tools` ist nicht nötig
> (keine externen Pakete), aber Directory muss existieren.

Prüfen, ob alles „healthy“ ist:

```bash
docker ps --filter "name=fr-key" --format "{{.Names}} | {{.Status}}"
```

## Schritt 4 — Profile installieren

```bash
mkdir -p ~/.dsh/profiles
cp -R mac-setup/profiles/astra ~/.dsh/profiles/astra
cp -R mac-setup/profiles/opus  ~/.dsh/profiles/opus
```

## Schritt 5 — Keys eintragen

Die Client-Keys stehen nach dem Gateway-Start in
`fr-gateway/secrets/keys_unique.txt` (eine Zeile pro Key, Zeile = nr):

- **Zeile 1** → `ASTRA_API_KEY` (Port 20129)
- **Zeile 24** → `OPUS_API_KEY` (Port 20152)

In `~/.dsh/.credentials.yaml` (Datei ggf. neu anlegen):

```yaml
version: 1
refs:
  ASTRA_API_KEY: vkd-<dein-key-zeile-1>
  OPUS_API_KEY: vkd-<dein-key-zeile-24>
```

## Schritt 6 — Starten

```bash
# Doppelklick im Finder oder:
bash mac-setup/start-astra.command
bash mac-setup/start-opus.command
```

Jede Instanz öffnet ihr eigenes Fenster mit eigenem Modell:
- Astra → `gpt-6-astra` (Gateways-Provider `astra`)
- Opus → `claude-opus-5.5` (Provider `opus`)

Falls die App woanders liegt:

```bash
DSH_APP_PATH="/Pfad/zur/DeepSeek Harness.app" bash mac-setup/start-astra.command
```

---

## Stolpersteine

| Problem | Lösung |
|---|---|
| App startet nicht, kein Fenster | `ELECTRON_RUN_AS_NODE` ist nicht gesetzt? (auf macOS untypisch). Prüfen: `echo $ELECTRON_RUN_AS_NODE` — falls `1`, mit `unset ELECTRON_RUN_AS_NODE` starten. |
| „unhealthy“ fr-key-Container | Dienste aus Schritt 3 laufen nicht → alle vier starten, danach `docker restart` der fr-key-Container. |
| 401 vom Gateway | Falscher/alter Key in `.credentials.yaml` → Key aus `keys_unique.txt` prüfen (Zeile 1 bzw. 24). |
| Zweite Instanz öffnet kein Fenster | userData-Kollision → Skripte nutzen bereits getrennte `--user-data-dir`. Falls manuell gestartet: `--user-data-dir="$HOME/Library/Application Support/Dsh-astra"` setzen. |

---

## Autostart (optional)

Zwei LaunchAgents: `~/Library/LaunchAgents/dev.fr.astra.plist` und
`dev.fr.opus.plist` mit `ProgramArguments` = `bash <repo>/mac-setup/start-astra.command`
bzw. `start-opus.command`.
