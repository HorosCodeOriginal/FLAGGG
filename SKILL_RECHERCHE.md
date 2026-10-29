# SKILL-Recherche — globaler Bootstrap-Skill

**Stand:** 2026-10-29 · **Auftrag:** recherchiere Skills, die einem Agenten in einem neuen Chat helfen → 10 Einträge → bestes mergen → globaler Skill → fortlaufend dokumentieren.

---

## 1. Methode

- Websuche-Tool ausgefallen (HTTP 402, kein Guthaben auf DeepSeek-Such-Endpoint).
- Ausweich: direkte Quellen-Fetches (Primärquellen), ergänzt um gezieltes Lesen der gespeicherten Doku-Vollversion.
- Workspace-Analyse: `C:\Users\Administrator\Downloads\FLAGGG` (51.270+ Dateien) enthält `./cursor/agents/` — HorosCodes eigenes Agent-System (YAML-Frontmatter, Protokoll-Ordner, Hierarchie). Der globale Skill muss in dieses Ökosystem passen.

## 2. Quellen (verifiziert)

| Quelle | URL | Status |
|---|---|---|
| Claude Code Docs — Skills | https://code.claude.com/docs/en/skills | HTTP 200, voll geladen (989 Zeilen) |
| GitHub anthropics/skills | https://github.com/anthropics/skills | HTTP 200 |
| anthropics/skills README (raw) | https://raw.githubusercontent.com/anthropics/skills/main/README.md | HTTP 200 |
| Agent Skills Standard (Overview) | https://agentskills.io | HTTP 200 |
| Agent Skills Standard (Spec) | https://agentskills.io/specification | via Nav verifiziert, nicht einzeln geladen |
| anthropic.com News (Skills) | https://claude.com/news/skills | HTTP 404 — Eintrag verworfen |

---

## 3. Die 10 Einträge

### 3.1 Offener „Agent Skills“-Standard (agentskills.io)
Leichtgewichtiges, offenes Format für Agent-Fähigkeiten: Ordner mit `SKILL.md`. Aufbauschema: Ordner + `scripts/` (Code), `references/` (Doku), `assets/` (Templates). Von Anthropic entwickelt, von vielen Agent-Produkten übernommen. **Kernmechanik: Progressive Disclosure** — beim Start lädt der Agent nur Name + Beschreibung (Discovery), bei Task-Treffer die vollen Anweisungen (Activation), dann Ausführung (Execution). → Geringer Kontext-Fußabdruck bei beliebig vielen Skills.

### 3.2 SKILL.md-Format: Frontmatter + Markdown
Zwei Teile: YAML-Frontmatter zwischen `---` (Pflichtzeile 1!) + Markdown-Anweisungen. Pflicht/Tutorial: `name` (lowercase, Kebab-case) und `description`. In Claude Code: `description` (empfohlen), alle weiteren Felder optional. Bei fehlendem `name` wird der Ordnername zum Befehlsnamen.

### 3.3 Beschreibungs-Optimierung (Triggern)
`description`: Kern-Use-Case zuerst — sie bestimmt, ob der Agent den Skill automatisch lädt. `when_to_use` ergänzt Trigger-Phrasen/Beispielanfragen. Combined-Limit 1.536 Zeichen in der Skillliste (Kontext-Schutz). Winkelklammern erscheinen als `&lt;`/`&gt;`.

### 3.4 Skill-Orte (global vs. Projekt)
Enterprise → `.claude/skills/` im Managed-Settings-Verzeichnis · Personal → `~/.claude/skills/` (alle Projekte, dieser Rechner) · Project → `.claude/skills/` (Repo, commitbar) · Nested → `<subdir>/.claude/skills/` (Monorepo) · Additional Dir → via `--add-dir` · Plugin → `<plugin>/skills/` · claude.ai-Konto (synchronisiert). **Persönliche Skills = global über alle Projekte.**

### 3.5 Gebündelte Skills (Claude Code)
/verify, /simplify (laufen automatisch vor Commits bei Anwesenheit), /code-review, /run, /debug, /loop, /doctor (Setup-Checkup), /skill-doctor (Nutzungs-Report, Kontext-Kosten). Muster: Skills ersetzen Built-ins mit gleichem Namen.

### 3.6 Dynamische Kontext-Injektion
Syntax `` !`bash` `` (inline) oder ` ```! ` (multiline) im Skill-Body: Shell-Kommando läuft VOR dem Senden, Ausgabe ersetzt den Platzhalter → Skill kommt mit Live-Daten (z. B. `git diff HEAD`). Fehlgeschlagenes Kommando bricht die Skill-Invokation ab. `shell:`-Frontmatter wählt bash/powershell.

### 3.7 Subagent-Ausführung (`context: fork`)
Skill läuft isoliert in einem frischen Subagent (Typ via `agent:`-Feld, z. B. Explore). Kein Verlauf → Skill-Instruktionen müssen selbsttragend sein. Default Hintergrund, `background: false` = warten. Input: für Recherche-/Audit-Skills, die den Chatverlauf nicht brauchen.

### 3.8 Zugriffs- und Sichtbarkeits-Kontrolle
`disable-model-invocation: true` = nur manuell über /name · `user-invocable: false` = nur der Agent · `allowed-tools` = Tool-Freigaben ohne Rückfrage während des Skill-Zugs (Grant erlischt nach Nachricht) · `disallowed-tools` = gezielte Sperren (z. B. AskUserQuestion). Pattern: Xe durch `skillOverrides` (settings.json): on/name-only/user-invocable-only/off.

### 3.9 skill-creator-Plugin (Evals)
Offizielles Plugin aus claude-plugins-official: automatisiert Vergleich von mit/ohne Skill über Testfälle (`evals/evals.json`), isolierte Subagent-Runs pro Fall, Grading (`grading.json`), Benchmark mit Pass-Rate vs. Token-Kosten (`benchmark.json`). Referenz-Workflow für Qualitätssicherung von Skills.

### 3.10 Template + Produktionsbeispiele (anthropics/skills)
Repo enthält `template/` (Startpunkt mit name/description), `spec/` (Standard), `skills/` mit Beispieldisziplinen — inkl. der Produktions-Skills für WORD/PDF/PPT/XLSX (docx/pdf/pptx/xlsx, source-available). Beweis: dokumentenverarbeitende Skills laufen in Produktion, Komplexität ist beherrschbar.

---

## 4. Merge-Analyse — wovon der globale Skill profitiert

| Erkenntnis | Übernahme in globalen Skill |
|---|---|
| Progressive Disclosure (3.1) | Skill nur bei Relevanz laden → Beschreibung + Trigger präzise setzen |
| Frontmatter + Struktur (3.2) | `name`, `description`, `when_to_use` korrekt setzen; SKILL.md sauber |
| Use-case-first-Beschreibung (3.3) | Kein generisches „hilft beim Arbeiten“, sondern konkreter Start-Auftrag |
| Globaler Ort (3.4) | Installation unter `~/.claude/skills/` → in JEDEM neuen Chat verfügbar |
| Dynamische Injektion (3.6) | Workspace-Scan direkt in den Skill ziehen → der Blick ist aktuell |
| Kaum Kontext + sofort arbeitsfähig (3.5/3.10) | Kompakte Abschnitte, verweis auf references/ für Tiefe |

**Nicht übernommen:** Subagent-Fork (3.7) — Bootstrap soll im Hauptchat wirken, nicht isoliert. Evals (3.9) — für Produktions-Skills, Bootstrap ist meta. Tool-Sperren (3.8) — zu restriktiv für einen Start-Skill.

## 5. Der globale Skill — Begründung

- **Name:** `horos-bootstrap` — passt zu HorosCodes Namensraum.
- **Ziel:** Bei jedem neuen Chat verfügbar; der Agent orientiert sich sofort: Workspace-Struktur, Protokolle, Konventionen, offene Punkte — statt im Leeren zu starten.
- **Standard:** Agent Skills (portabel: Claude Code, Cursor, kompatible Clients). Frontmatter nur Spez-Felder → fehlerfrei auch außerhalb Claude Codes ladbar.
- **Originalität:** bindet HorosCodes vorhandene `.cursor/agents/`-Struktur ein (Protokoll-Team-Horos.md, Manifest-Konventionen) und injiziert dynamisch den aktuellen Workspace-Zustand.

**Ablage:**
- `C:\Users\Administrator\Downloads\FLAGGG\.skills\horos-bootstrap\SKILL.md` — versioniert im Workspace (Primärquelle).
- `C:\Users\Administrator\.claude\skillsills\horos-bootstrap\SKILL.md` — globale Kopie, wirkt in allen neuen Claude-Code-Chats.

---

## 6. Changelog

| Datum | Ereignis |
|---|---|
| 2026-10-29 | Recherche (10 Einträge), Merge-Analyse, globaler Skill `horos-bootstrap` erstellt |
| 2026-10-29 | (noch offen) Test im neuen Chat, Feedback-Schleife, Anpassung |
