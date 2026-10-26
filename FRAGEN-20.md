# 20 Fragen — zur Absicherung des Repo-Verständnisses

Diese Fragen sind so formuliert, dass ihre Antworten die offenen Punkte der
Analyse (STELLUNGNAHME.md + ERKENNTNISSE.md) in Produkt- und
Architektur-Entscheidungen auflösen.

## Zweck & Zielsetzung
1. Was ist das Endziel dieses Systems? (Produktionsprodukt / interne
   Entwicklungsumgebung / Demo & Forschung / Lernprojekt)
2. Wer sind die Nutzer (Du selbst, ein Team, zahlende Kunden) — und welche Rolle
   spielt die 46er-Fassade jeweils?
3. Warum genau 46 Endpunkte? Gibt es eine strategische Obergrenze, eine
   Kostenformel oder war es einfach „so viele Keys, wie ich generieren konnte“?
4. Sollen die 46 Endpunkte nach außen als **getrennte Modelle** wirken (Vertrieb
   mit 46 Produkten) oder ist das nur eine interne Skalierungstechnik?
5. Ist das Tageslimit (2,0 Mio. Tokens) pro Key/Port ein verkauftes
   Produktmerkmal oder ein technischer Schutz (z. B. gegen Free-Tier-Missbrauch)?

## Upstream & Modell
6. Woher stammen die Raw-Keys `sk-ae240627ae4c44d4-…`? (Welcher Anbieter,
   welche Kontostruktur, gibt es mehrere Accounts?)
7. Ist OpenCode Free als einzige Quelle langfristig beabsichtigt, oder sollen
   weitere Provider/Modelle (auch bezahlt) dazu kommen?
8. Warum wurden `gpt-6-astra` und `claude-opus-5.5` auf **dasselbe**
   Upstream-Modell (`oc/big-pickle`) gelegt — ist das gewollt (Branding) und
   darf es öffentlich sichtbar sein?
9. Ist die HMAC-Key-Ableitung („keycloak“) eine bewusste Design-Entscheidung?
   Warum kein echter Keycloak?

## Verhalten & Ausfall
10. Was soll konkret passieren, wenn der Upstream-Router (`:20128`) ausfällt?
    (Warten / Fehler anzeigen / auf zweiten Upstream wechseln / alles offline)
11. Ist der im Code vorhandene Quart-basierte Failover (15 %-Schwellwert)
    gewünscht, oder soll Failover ausschließlich auf HTTP 429/5xx reagieren?
12. Sollen bei 429 automatisch weitere Versuche unternommen werden (Anzahl,
    Wartezeit, Backoff), oder soll der Fehler sofort dem Nutzer gezeigt werden?
13. Sollen die Zustände ALIVE/RATE_LIM/SERVER/EMPTY/NO_AUTH aus dem Briefing
    wirklich als eigenes Diagnose-Modell eingeführt werden (im Code existieren
    sie nicht)?

## Daten, Sicherheit & Panel
14. Welche Zugriffsschutz-Anforderung gilt für das Panel (nur localhost, LAN mit
    Passwort, SSO)? Darf es weiterhin rohe Keys (`raw_key`) ausliefern?
15. Sollen Secrets (`.secret`, Keys) zukünftig außerhalb des Repos liegen
    (Env, Vault, verschlüsselte Datei) und wie oft dürfen Keys rotiert werden?
16. Welche Daten sind als historisch/analytisch relevant (Tokens je Port/Modell,
    Fehler, Latenz)? Was soll geloggt und was gelöscht werden?

## UI & Architektur
17. Sollen Orchestrierungs-Canvas, Missions-Timeline und Plugin-Marktplatz
    echte Funktionen werden (d. h. real mit den Agenten gekoppelt), oder sind
    sie bewusst als Mockup/Storyboard gedacht?
18. Welche Ebene ist die „echte“ App: das Legacy-`main.js` (gestartet) oder
    `_new_layer` (Staging)? Was passiert mit den bisherigen Klonen?
19. Soll die Konfiguration künftig eine einzige Quelle haben (Registry + eine
    Datei je App) statt localStorage/desk.json/envs nebeneinander?
20. Wie sieht der gewünschte Betrieb aus (Windows-Host + Docker Desktop +
    systemd-Skripte) und soll das Repo künftig ein Git-Repo mit CI werden?
