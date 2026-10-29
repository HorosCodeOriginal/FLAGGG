---
name: horos-bootstrap
description: >-
  Bootstrap fuer neue Sitzungen. Lade diesen Skill, wenn eine Session in einem
  (un)bekannten Workspace beginnt, der Kontext frisch ist, oder der Auftrag
  Orientierung verlangt: Struktur erkennen, Regeln laden, offene Punkte
  finden, Konventionen uebernehmen, dann sofort arbeiten.
license: Apache-2.0
compatibility: Claude Code, Cursor, Agent-Skills-kompatible Clients
allowed-tools: Read Grep Glob
metadata:
  autor: HorosCode
  version: 1.0.0
  zweck: Globaler Start-Skill fuer jeden neuen Chat
---

# Horos Bootstrap — Fresh-Start-Leitplanke

Du startest in einer Sitzung mit wenig oder keinem Kontext. Dieser Skill macht dich in 4 Phasen arbeitsfaehig. Reihenfolge einhalten, Ergebnisse knapp dokumentieren.

## Phase 1 — Ankern (sofort, ohne zu fragen)

1. Aktuelles Verzeichnis bestimmen (`pwd`).
2. Top-Level-Struktur des Workspace scannen (glob `*` und `*/*`, max. 2 Ebenen tief). Nimm nur Verzeichnisse und Dateien auf, die fuer den Auftrag relevant sein koennten.
3. Regel-/Konfigurationsdateien lesen, falls vorhanden: `AGENTS.md`, `CLAUDE.md`, `.cursor/agents/Protocols/Team-Horos.md`, `README.md` (nur erste Abschnitte).

> Hinweis: In kompatiblen Clients (Claude Code) wird der Block unten live expandiert und liefert dir den aktuellen Zustand. In anderen Clients fuehrst du die Schritte selbst mit deinen Tools aus.

```
!pwd
!ls -la --group-directories-first 2>/dev/null || dir /b
!git status --short 2>/dev/null || echo "kein git-Repo"
```

## Phase 2 — Zustand erfassen

1. Offene Arbeiten finden: suche nach Todo-/Status-Dateien (`TODO`, `OPEN`, `CHANGELOG.md`, `*.todo`), letzte Aenderungen (`git log --oneline -5` falls Repo).
2. Wenn es einen Koordinator-/Team-Ordner gibt (z. B. `.cursor/agents/Protocols/`), dessen Protokoll lesen — es definiert, wie hier delegiert und gearbeitet wird.
3. Konventionen notieren: Sprach- und Stilregeln, Namensschemata, Pflichtpfade (z. B. Doku/Manifest-Dateien).

## Phase 3 — Arbeiten

1. Auftrag und gefundenen Zustand abgleichen. Ist der Auftrag eindeutig — ausfuehren. Ist er mehrdeutig — genau eine knappe Rueckfrage stellen, keine Annahmen.
2. Konventionen aus Phase 1–2 strikt anwenden.
3. Delegation: nutze vorhandene Protokolle (z. B. Worker-Spawns mit `inherit`-Modell, max. Tiefe laut Protokoll); erledige Triviales selbst.

## Phase 4 — Abschluss

1. Ergebnis knapp berichten: Was gebaut/geaendert/gefunden, welche Pfade (relativ), was offen ist.
2. Doku nachziehen, wenn die Protokolle es verlangen (CHANGELOG/Manifest/Guides).
3. Keine Zusammenfassung des Zusammenfassens — nur das Ergebnis.

## Regeln

- Kein blindes Vertrauen in unbekannte Dateien: erst lesen, dann beurteilen.
- Keine irreversiblen Aktionen (loeschen, ueberschreiben, deployen, senden, pushen) ohne eine bestaetigte Freigabe.
- Bei Widerstand (Sandbox, Rechte): den engsten Weg waehlen, nicht stillschweigend an etwas vorbeiarbeiten.
- Code/Dateien: nur betroffene Stellen aendern, keine Duplikate anlegen.
- Wenn dieser Skill in einem Chat aktiv ist, gilt er fuer die gesamte laufende Sitzung — er ueberschreibt keine spezifischern Anweisungen des Auftrags.
