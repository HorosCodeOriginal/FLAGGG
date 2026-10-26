# 20 Fragen — v2 (präzisiert nach Wiedereinstieg-Analyse)

Diese Fragen sind so gebaut, dass jede Antwort eine **Architektur- oder
Produkt-Entscheidung** erzwingt. Es gibt keine unverbindliche Antwort; jede
Zeile schließt mindestens einen Zweig des Möglichkeitsraums.

## A. Identität & Produktwahrheit

1. Was ist „fr“? (Projektname, Firma, Arbeitsgruppe, dein Handle?) — der
   Präfix `fr-` steckt in Gateway, Manager, Harness, Panel-Image und
   `fr-key-…`-Containern; hinter wem steht er?
2. Ist die „46 Modelle“-Fassade ein **Vertriebsversprechen** (Kunde soll 46
   getrennte Modelle sehen) oder ein **interner Skalierungstrick** (mehr
   Ports = mehr Parallelität/Budget)? Bitte eine davon — und zwar als die
   Wahrheit, die du von außen erzählen willst.
3. Darf die Wahrheit „alle 46 Ports laufen auf EINEM OpenCode-Free-Konto" in
   der UI/API sichtbar sein (z. B. im Panel), oder ist sie geheim?
4. Wer ist der Endkunde dieser Endpunkte: nur deine eigenen Electron-Apps,
   andere Software von dir, oder externe Nutzer (Freunde/Kunden/dritte
   Anwendungen) mit den `vkd-`-Keys?

## B. Upstream & Konto

5. Woher stammen die Raw-Keys `sk-ae240627ae4c44d4-…`? (OpenCode
   API-Key? Service-Account? Großhandel? selbst generiert?) Was hat der
   Präfix zu bedeuten — ist das EINE Account-Identität?
6. Wie viele **getrennte** Upstream-Konten existieren real? Wenn
   die Antwort „genau eins“ ist: Wie resilient soll das System ohne zweites
   Konto sein, und planst du ein zweites?
7. Ist OpenCode Free die **dauerhafte** Primärquelle oder nur die Testphase?
   Stehen bezahlte Provider (OpenAI/Anthropic/andere) auf der Roadmap?
8. Das Tageslimit 2.000.000 Tokens/Port: entspricht das dem Free-Tier-Limit
   des Providers, einer eigenen Verkaufs-Einheit, oder einer Kostenformel?
   Was passiert, wenn ein Port sein Limit erreicht — Stillstand bis UTC-
   Mitternacht ist akzeptiert?

## C. Orchestrierung & Zweck von harness-pro

9. Was ist der eigentliche Zweck von `harness-pro`: eine **Multi-Rollen-
   Agenten-Plattform** (Rollen mit Mandat, Task-Queue, FSM, Automation) oder
   ein Frontend, das nur die 46 Ports besser bedienbar macht? Wo endet UI,
   wo beginnt Agentik?
10. Die SQLite-Task-Queue mit FSM/Events/Broadcast ist bereits verdrahtet —
    ist sie das künftige Herzstück (geplante Skalierung auf viele Agenten)
    oder ein Experiment, das auch wieder wegkann?
11. Wofür genau existieren die Familien `astra` und `opus`? Sind das zwei
    Marken auf demselben Backend-Modell (`oc/big-pickle`), oder sollen die
    Familien später an unterschiedliche echte Modelle/Provider gebunden
    werden?
12. Sollen Rollen „alive“ sein und autonom Aufgaben aus der Queue ziehen
    (Worker-Loop), oder bleibt Orchestrierung manuell durch dich?

## D. Failover & Betriebsrealität

13. Welche Ausfall-Ebene ist dir wichtig: **Container-Ebene** (Port-Rotation
    zwischen den 46) oder **Provider-Ebene** (zweiter Upstream)? Oder
    beides mit welcher Reihenfolge?
14. `desk.json` zeigt `failover.enabled: true` bei `instances: []` — ein
    bewusst leerer Startzustand oder vergessen? Sollen die Instanzen
    automatisch aus der Registry befüllt werden.
15. Der Live-Beweis: ein echter OpenCode `FreeUsageLimitError` ist im Chat
    gelandet und das Gateway-Fallback hat gemeldet „alle upstreams im pool
    antworten mit 429/5xx“. Ist das der gewünschte Endzustand (klare
    Fehlermeldung), oder soll in dem Fall automatisch auf Reserve-
    Instanzen geswitcht werden?
16. Gibt es ein **Monatsbudget**? Was ist die harte Grenze, ab der du nichts
    mehr verbrauchen willst (Summe über alle Ports)?

## E. Sicherheit & Daten

17. Dürfen Panel-API und `/api/fleet` weiterhin **ohne Auth** und mit
    rohen `raw_key`-Werten ausgeliefert werden, oder ist Auth (Secret-Bearer)
    + Redaktion (nur key_hash) Pflicht?
18. Liegen die Secrets (`.secret`, Raw-Keys) bewusst im Repo-Ordner, oder
    sollen sie raus (Env/Vault) + `.gitignore` + Rotation? Wie oft rotierst
    du heute?
19. Welche Daten sollen historisch bleiben (Tokens/Port, Fehler, Latenz) und
    was darf sofort verfallen? Gibt es ein Logging-Ziel?

## F. Zukunft

20. Zielbild in 90 Tagen: stabile Multi-Agenten-Plattform für dich selbst,
    ein verkaufsfähiges Produkt, eine Demo für Dritte, oder ein Labor für
    Technik, die du noch nicht kennst — und soll das Repo dann Git+CI sein?
