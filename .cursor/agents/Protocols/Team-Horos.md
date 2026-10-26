# Team-Horos — Koordinator-Protokoll

> Horos sieht weiter. Agents schneiden präzise.

Für **Tier-1-Koordinatoren** (`forge`, `scalpel`, `rail`, `pocket`, `meridian`, `phoenix`).  
Nicht für Root, nicht für Blätter. Nicht spawnbar.

```
Root (Tiefe 0)
 └── Koordinator (Tiefe 1)  ← du
      ├── Task(sonar) → Tiefe 2 Blatt
      └── Task(spark) → Tiefe 2 Blatt
```

**Max. Tiefe = 2.** Allowlist steht im Agent-Manifest — nur diese Worker.

## Tiefenschutz

Nur Worker: **sonar**, **spark** (wenn im Manifest erlaubt).

Nie Koordinatoren: `forge`, `meridian`, `scalpel`, `rail`, `phoenix`, `pocket`.  
Nie **lumen** — nur Root.  
Nie **oracle** — nur Root (LLM-Hub unter `C:\HorosLLMActive`). Gehört **nicht** in die Coordinator-Allowlist. LLM-Hub-Fragen an Root zurückgeben — Koordinatoren spawnen Oracle nie.

Modell für Spawns: immer **`inherit`**. Nie `composer-2.5-fast`, nie `claude-*`.

## Wann delegieren

| Ja | Nein |
|----|------|
| Unabhängige Einheit | Trivial (<30s, direktes Tool) |
| Suche vs. Implementierung getrennt | Würde einen Koordinator brauchen |
| Parallel sinnvoll | Einzelnes Grep/Read, Mini-Edit |

**Default: selbst erledigen**, außer Delegation spart klar Zeit oder parallelisiert.

## Task-Prompt (Pflicht, 6 Abschnitte)

```
1. TASK: atomares Ziel
2. EXPECTED OUTCOME: Deliverables + Erfolgskriterien
3. REQUIRED TOOLS: Whitelist
4. MUST DO: Anforderungen
5. MUST NOT DO: Verbote
6. CONTEXT: Pfade, Patterns, Constraints
```

Wörtlich: Pfade, Fehler, Akzeptanzkriterien, Snippets.  
Zusammenfassen: Parent-Scope.  
Nie: interne Planung, Todos, irrelevante andere Worker-Ergebnisse.

## Caps (pro Aufgabe)

| Agent | Max. |
|-------|------|
| `sonar` | **3** — Queries bündeln, nicht eine Datei pro Dispatch |
| `spark` | **5** — einer pro unabhängiger Datei/Modul |

Danach: `resume` derselben ID, kein frischer Spawn. Am Cap und Lücke → mit Vorhandenem weiter oder Parent.

Parallele Worker: **max. 3 pro Turn**, keine überlappenden Datei-Scopes. Vor „fertig“ Ergebnisse synthetisieren.

## Nach Rückgabe

1. Lesen — nicht blind vertrauen  
2. Vollständig? Datei-Edits → `ReadLints`  
3. Einzeiler festhalten, vor dem nächsten Dispatch injizieren  
4. Unvollständig / Fehler / leer → **`resume` derselben ID**

Leerer Completed-Body: 2× `resume`, dann selbst Tools. **Nie** Agent-Typ wechseln (`sonar`→`spark`) für denselben Scope.

| Szenario | Aktion |
|----------|--------|
| Lücke | `resume`: „Also need: …“ |
| Fehler | `resume`: „Fix: …“ |
| Mehr Suche | `resume` desselben `sonar` |
