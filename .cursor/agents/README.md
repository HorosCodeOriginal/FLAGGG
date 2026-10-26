# Cursor Agents — FLAGGG (Port von HorosAgent)

Custom Agents unter `.cursor/agents/` (YAML-Frontmatter + Markdown).  
Quelle: `C:\HorosAgent\.cursor\agents` · Workspace: FLAGGG (`Downloads\FLAGGG`).

Rollen/Protokolle: `Protocols/Team-Horos.md`, `Protocols/Team-Wpfui.md`.  
Fähigkeiten: `.cursor/rules/Capabilities-Catalog.mdc`.

## a11y-Paarung (fest)

| Agent | Rolle |
|-------|--------|
| **access** | readonly Freigabe-Gate für Werkzeug-UI (ein Surface, vor „fertig“) |
| **aegis** | breiter WCAG-Audit; Fixes nur auf Wunsch |

`aegis` ersetzt `access` nicht. Screenshot-Chrome → **lens**.

## Status

| Status | Bedeutung |
|--------|-----------|
| `pending` | Noch nicht übernommen / unklar |
| `adapted` | Im Master vorhanden und an HorosAgent angepasst |
| `skip` | Bewusst nicht übernommen |

Kein Agent-Inhalt ohne Freigabe im Chat (ein Agent nach dem anderen), außer Wartung bestehender Dateien.

## Roster (Stand Master)

### Koordinatoren

| Agent | Datei | Status |
|-------|-------|--------|
| meridian | Meridian.md | adapted |
| forge | Forge.md | adapted |
| rail | Rail.md | adapted |
| phoenix | Phoenix.md | adapted |
| blueprint | Blueprint.md | adapted |
| scalpel | Scalpel.md | adapted |

### Blätter / Spezialisten (Auswahl)

| Agent | Datei | Status |
|-------|-------|--------|
| sonar | Sonar.md | adapted |
| spark | Spark.md | adapted |
| quill | Quill.md | adapted |
| dynamo | Dynamo.md | adapted |
| kiln | Kiln.md | adapted |
| bastion | Bastion.md | adapted |
| loupe | Loupe.md | adapted |
| sentinel | Sentinel.md | adapted |
| assay | Assay.md | adapted |
| anvil | Anvil.md | adapted |
| canvas | Canvas.md | adapted |
| pane | Pane.md | adapted |
| region | Region.md | adapted |
| lens | Lens.md | adapted |
| keystone | Keystone.md | adapted |
| access | Access.md | adapted |
| aegis | Aegis.md | adapted |
| lumen | Lumen.md | adapted |
| prism | Prism.md | adapted |
| nexus | Nexus.md | adapted |
| pulse | Pulse.md | adapted |
| sextant | Sextant.md | adapted |
| loom | Loom.md | adapted |
| circuit | Circuit.md | adapted |
| temper | Temper.md | adapted |
| augur | Augur.md | adapted |
| vault | Vault.md | adapted |
| atelier | Atelier.md | adapted |
| ember | Ember.md | adapted |
| oracle | Oracle.md | adapted |
| oxalpha | OxAlpha.md | adapted |
| seekai | SeekAi.md | adapted |
| pocket | Pocket.md | adapted |
| crest | Crest.md | adapted |
| android-plan | Android-Plan.md | adapted |
| android-build | Android-Build.md | adapted |

Vollständige Liste = Dateien in diesem Ordner. Bei Neuaufnahme Zeile hier + `docs/CHANGELOG.md` ergänzen.

## Adaptions-Checkliste (jeder Agent)

1. Kontext: HorosAgent Master (`C:\HorosAgent`), Multi-PC wo relevant
2. Keine Single-Host-/Laufwerks-Hardcodes; Secrets nur Platzhalter
3. Handoffs auf vorhandene Team-Agents
4. PNG neben `.md` mitkopieren (falls vorhanden)
5. Status → `adapted` + Changelog
