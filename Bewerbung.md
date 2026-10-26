# Initiativbewerbung – Softwareentwickler / Full-Stack / DevOps

## Anschreiben

Sehr geehrte Damen und Herren,

ich habe in den letzten Monaten eine verteilte AI-Infrastruktur gebaut: ein mehrinstanzfähiges API-Gateway unter Docker, ein Electron-Desktop-Cockpit zur Orchestrierung und eine SQLite-basierte Task-Queue für Multi-Agenten-Kommunikation. Kein Prototyp – ein System mit Failover-Ketten, Quota-Isolation und Token-Limits, das ich von der Architektur bis zur Security-Härtung durchgezogen habe.

Was mich dabei am meisten beschäftigt hat, ist nicht das Bauen, sondern das *Absichern*: Wie verhindere ich, dass ein einzelner 429-Fehler die ganze Flotte ausknockt? Wie mache ich aus einer ungeschützten API ein System, das man bedenkenlos deployen kann? Diese Fragen treiben mich an. Ich suche jetzt eine Position, in der genau diese Haltung gefragt ist: Systeme nicht nur zum Laufen bringen, sondern sie verstehen und ehrlich betreiben.

## Profil

- **Mehrinstanz-Architektur:** API-Gateway-Fleet unter Docker mit isolierten Tenants, zentraler Registry, Lua-Token-Limits und nginx-Failover-Kette (Primary → Backup → JSON-Fallback).
- **Desktop-Entwicklung:** Electron-App mit Monaco-Editor, xterm-Terminal, IPC-Architektur und 45 Kanälen für Team-Orchestrierung und Task-Distribution.
- **Multi-Agenten-Orchestrierung:** SQLite-Task-Queue mit FSM, idempotenten Claims, Quota-Backoff, Tool-Sandboxing und einem Synthesizer, der die Ergebnisse von Sub-Agenten zu einem Report verdichtet.
- **Sicherheitsbewusstsein:** Secrets-Rotation, Path-Traversal-Prävention, Auth-Pflicht vor Produktivbetrieb – auch wenn das bedeutet, eigene Schwachstellen im Audit offenzulegen und zu beheben.
- **Verifizierte Patches:** Code-Änderungen als Unified Diffs, Tests gegen `node:test`, Analyse über einen eigenen Audit-State mit 17 Findings.

## Technologien

**Sprachen:** JavaScript/Node.js, Python, PowerShell, Lua  
**Laufzeiten:** Electron 33, Docker, OpenResty/Nginx  
**Werkzeuge:** SQLite, Git, REST/JSON, JSON-RPC  
**Betriebssysteme:** Windows 11, Linux (Container)

## Arbeitsweise

Konfiguration hat eine einzige Quelle der Wahrheit. Secrets liegen nicht im Repo. Fehler werden sichtbar gemacht, nicht versteckt. Ein Patch ist erst fertig, wenn `git apply --check` und die Tests grün sind.

## Verfügbarkeit

Ab sofort, remote oder vor Ort. Codebeispiele und Architektur-Dokumentation stelle ich auf Anfrage bereit.

Mit freundlichen Grüßen
[Name]
