# STELLUNGNAHME — Gesamteindruck & Vorschläge

Analyse-Stand: 2026-10-25. Alle Code-Fixes liegen als anwendbarer Diff in
`STELLUNGNAHME.diff`; diese Datei enthält die narrative Bewertung dazu.

## 0. Verständnis (ehrlich beantwortet)

Ja — ich verstehe die Struktur des Repos weitgehend:

* `fr-gateway` = ein „Token-Vervielfacher“: EIN Upstream (FlagshipRouter auf
  `:20128`, dahinter OpenCode Free) wird über 46 OpenResty-Container je Key auf
  46 Ports (20129–20174) ausgefaechert. Jeder Container hat ein eigenes
  Tageslimit (2.000.000 Tokens, UTC-Reset) und einen `vkd-`-Client-Key,
  abgeleitet per HMAC-SHA256 aus einem `.secret` (die Datei heißt nur „keycloak“).
* `astra-harness` / `claude-harness` / `harness-pro` / `fr-harness` = Electron-
  Cockpits für Multi-Agenten-Arbeit; sie lesen die Fleet-Registry und routen auf
  einen Port; Failover/Anzeige sind teils Mock, teils echt.
* Den *Produktzweck* kann ich aus dem Code allein nicht sicher ableiten: Die 46
  Ports + Budget-Tricks vermitteln den Eindruck von 46 unabhängigen Modellen.
  Für wen und wozu das genau da ist, beantworten erst die 20 Fragen
  (FRAGEN-20.md).

## 1. Was mir auffällt (nach Schwere)

1. **Sicherheit (kritisch):** Panel bindet `0.0.0.0:8090` ohne Auth, CORS `*`
   und exponiert rohe Upstream-Keys (`/api/fleet` liefert `raw_key`).
2. **Single-Point bleibt real:** Alle 46 Container zeigen auf denselben Router;
   ein Provider-429 (belegt als `FreeUsageLimitError` in `data/desk.json`)
   trifft die gesamte Fleet. Failover-Maschinerie existiert, aber der
   `backup`-Upstream ist leer/deaktiviert.
3. **Token-Anzeige-Lüge:** `TOKEN_LIMIT=1900000` (hartkodiert in 16 Dateien)
   widerspricht dem echten 2,0M-Limit — UI zeigt falsche Prozent/Reserven.
4. **Inkonsistenz Astra/Opus:** `manager.py` rechnet 23/23, deployte Fleet und
   Panel sind 22/24 — Sweep/Beschriftung können falsch liegen.
5. **Doppelte Wahrheiten im Code:** Legacy vs. `_new_layer` (Defaults 0.4 vs.
   0.7), Klone byte-identisch, `check-parity.ps1` kennt die
   `_new_layer/`-Layoutverschiebung nicht.
6. **Mock vs. echt:** Orchestrierungs-Canvas, Timeline und Plugin-Marktplatz sind
   statische Demo-Daten; nur Chat/Failover/Rollen/Spaces haben echte Logik.
7. **Kein Git im Root, keine `.gitignore`:** Raw-Keys und Secrets liegen im
   Klartext im Workspace (Rotation derzeit nur manuell).
8. **Neue Drafts (seit letzter Analyse):** `taskqueue.diff`, `realtime.diff`,
   `hardening.diff` (Chat-Retry mit Kandidaten), `_fake_auth.js` + `_auth.log`
   (Test mit `key-primary`/`key-backup` auf 20996/20999). Das zeigt: die
   Failover-Idee wird bereits weitergebaut — die Drafts sind aber noch nicht in
   den Arbeitsbaum gemergt und nicht verifiziert.

## 2. Was ich noch auscoden würde (Reihenfolge)

1. **(P0) Panel-Härtung:** Loopback-Bind, Shared-Secret/Token-Auth, CORS auf
   localhost, Log-Redaktion (keine `raw_key` im Fleet-API).
2. **(P0) Token-Anzeige konsistent:** `TOKEN_LIMIT` aus Registry
   (`limit_override`/`DEFAULT_LIMIT`) ableiten statt hartkodiert.
3. **(P0) Split-Regel vereinheitlichen:** `ASTRA_COUNT` als zentrale Env
   (Manager, Panel, Sweep).
4. **(P1) Echter Failover:** zweiten Upstream (anderer Provider/Account) in
   `upstreams.json` aktivieren; Harness-429-Retry (Draft `hardening.diff`) in
   `fr-harness` und `astra-harness` spiegeln; Circuit-Breaker-Status in UI.
5. **(P1) Langfristig sauber:** `_new_layer` verdrahten, Legacy einfrieren,
   eine gemeinsame Konfig-Source statt drei (localStorage/desk.json/envs).
6. **(P2) Betrieb:** Git-Init + `.gitignore` + Secrets-Umzug (Schlüssel
   außerhalb Repo, Rotation), Metriken (Tokens/Port/Upstream) und Alerting,
   Release-Taggung der Docker-Images (statt `:latest`).
7. **(P2) Qualität:** `pong-test.js` als Pipeline-Test automatisieren; ein
   echter Integrationstest mit `_fake_auth.js` gegen 2–3 Upstreams.

## 3. Projektvorschläge

* **Absicht klären** bevor weiter gebaut wird: Ist die 46er-Fassade ein
  Produktmerkmal (Kunden sehen „46 Modelle“) oder interner Skalierungs-Trick?
  Jede Architektur-Entscheidung hängt daran.
* **Fakten schaffen:** eindeutige Registry als Single Source of Truth
  (Port, Familie, Limit, Zustand, Upstream-Pool, letzte Änderung) — Panel,
  Manager, Sweep, Harness lesen NUR daraus.
* **Failover ehrlich machen:** Off-Circuit-Test mit `_fake_auth.js` ist gut;
  danach echter zweiter Upstream + dokumentierte Überlast-Szenarien.
* **Sicherheit vor Funktionalität:** Panel-Auth und Key-Rotation sind
  Vorbedingung für jeden produktiven Einsatz.
* **Doku parallel:** `docs/` mit Architektur, Betrieb, Secrets-Modell,
  Modell-Wahrheit (`gpt-6-astra` == `claude-opus-5.5` == `oc/big-pickle`).

## 4. Verifikation dieses Diffs

`STELLUNGNAHME.diff` enthält ausschließlich verifizierte Hunks
(`git apply --check` → Exit 0). Neue, *nicht* verifizierte Ideen stehen nur als
Text in Sektion 2/3 — nicht als Hunks — damit der Patch anwendbar bleibt.
