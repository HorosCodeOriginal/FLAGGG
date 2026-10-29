# MAC-SETUP — ANLEITUNG FÜR DEN AGENT

Du bist der Agent auf einem macOS-Rechner. Dein Auftrag: das Repo `FLAGGG` von GitHub forken, lokal klonen und die Entwicklungsumgebung aufsetzen. Folge den Schritten exakt. Keine Schritte überspringen.

---

## 0. Voraussetzungen prüfen

Öffne ein Terminal und prüfe:

```bash
node --version   # Node 20 LTS oder neuer erforderlich
npm --version    # sollte zu node passen
git --version    # git muss installiert sein
docker --version # für fr-gateway erforderlich (Docker Desktop)
```

Fehlt Node: installiere Node 20+ (z.B. via `brew install node@20` oder nvm). Fehlt Docker: installiere Docker Desktop für macOS und starte es.

Native Module (better-sqlite3, node-pty) brauchen Build-Tools:

```bash
xcode-select --install
# danach: Xcode Command Line Tools sind installiert
```

---

## 1. Fork erstellen

1. Öffne im Browser: https://github.com/HorosCodeOriginal/FLAGGG
2. Klicke oben rechts auf **Fork** → **Create fork**.
3. Merke dir deinen Fork-URL: `https://github.com/<DEIN_USERNAME>/FLAGGG.git`

---

## 2. Klonen

```bash
git clone https://github.com/<DEIN_USERNAME>/FLAGGG.git
cd FLAGGG
```

Füge das Original als Upstream hinzu (damit du Updates ziehen kannst):

```bash
git remote add upstream https://github.com/HorosCodeOriginal/FLAGGG.git
git fetch upstream
```

---

## 3. Repo-Struktur

```
FLAGGG/
├── fr-gateway/        # Gateway: Docker Compose, OpenResty-Container, Manager, Panel
├── harness-pro/        # Haupt-Harness: Electron-App, SQLite-Task-Queue (Astra-Token)
├── fr-harness/         # Electron-Workspace-Harness (eine isolierte Umgebung pro API-Key)
├── claude-harness/     # Variante für Claude
├── astra-harness/      # Variante für Astra
├── tools/              # Offensive-Tools-Sammlung (C/C++)
├── scripts/            # Skripte
├── testrun/            # Testläufe (lokal, nicht im Repo)
└── README.md           # Architektur + Setup
```

---

## 4. Harness-Pro einrichten (Haupt-App)

```bash
cd harness-pro
npm install
```

`postinstall` baut `better-sqlite3` für deine Electron-Version neu (`electron-rebuild`). Das braucht die Xcode-Tools aus Schritt 0. Schlägt das fehl, prüfe:

```bash
npm install --build-from-source
```

Tests laufen lassen:

```bash
npm test
```

App starten (Electron-Desktop):

```bash
npm run start
```

---

## 5. fr-harness einrichten

```bash
cd ../fr-harness
npm install
npm run start
```

`node-pty` wird nativ gebaut — gleiche Xcode-Anforderung.

---

## 6. Gateway (fr-gateway) starten

```bash
cd ../fr-gateway
cp keys_raw.txt.example secrets/keys_raw.txt
cp registry.example.json secrets/registry.json
docker compose up -d --build
```

Panel: http://127.0.0.1:8090

Wichtig: **Secrets niemals committen.** `secrets/` steht in `.gitignore`. Deine lokalen Keys bleiben lokal.

---

## 7. Windows-spezifische Dateien (ignorieren)

Folgende Dateien sind Windows-only und auf macOS nicht lauffähig — nicht versuchen, sie auszuführen, einfach liegen lassen:

- `*.ps1` (PowerShell-Skripte)
- `autostart.bat`
- `app-builder-bin/win/**` (nur innerhalb node_modules)
- `*.exe` (werden ohnehin nicht versioniert)

---

## 8. Änderungen einbringen

```bash
git checkout -b feature/dein-bereich
# ... Arbeit ...
git add -A
git commit -m "Beschreibung deiner Änderung"
git push origin feature/dein-bereich
```

Danach im GitHub-Web-UI: Pull Request gegen `HorosCodeOriginal/FLAGGG` erstellen.

Updates vom Original ziehen:

```bash
git checkout main
git fetch upstream
git merge upstream/main
```

---

## 9. Bekannte Stolpersteine

| Problem | Lösung |
|---|---|
| `npm install` bricht bei better-sqlite3 | `xcode-select --install` ausgeführt? Dann `npm rebuild better-sqlite3` |
| Electron startet nicht (Gatekeeper) | `npm run start` aus Terminal, nicht per Doppelklick |
| Docker-Befehle fehlen | Docker Desktop starten; `docker info` prüfen |
| `docker compose` nicht gefunden | Docker Desktop neu starten oder CLI-Pfad prüfen |
| node-pty-Buildfehler | Xcode-Tools vorhanden? `npm rebuild node-pty` |
