# FLAGGG MAS — Audit (2026-10-26)

Kurzreport: Findings aus dem Handoff-Audit, Fixes und bewusst Zurückgestelltes.

## Behoben (dieser Durchgang)

| Severity | Thema | Fix |
|----------|--------|-----|
| HIGH | `updateState` ohne CAS | `WHERE id=? AND state=?`, Fehler bei `changes≠1` |
| HIGH | Child fertig vor `waiting_on_child` | `delegateTask`: zuerst `waiting_on_child`, dann `enqueue`, dann `checkChildrenStatus` |
| HIGH | Parallele Synthese / Doppel-Reports | `markSynthesized` CAS + Claim-vor-Enqueue; Worker serialisiert `synthesize` |
| HIGH | Symlink-Escape in ToolRunner | `_resolveInside` mit `realpath` |
| HIGH | SSRF web_fetch/download/install | Private/link-local/localhost blocken; Redirects manuell + erneut prüfen |
| MED | `teams`-Map Leak | `finally { teams.delete }` |
| MED | Quit ohne Abort | `before-quit` abortet `streams` + `teams` |

Zusätzlich: GitHub-Readiness (`.gitignore`, README, CI), Plugin-Sandbox (`install_skill` / VM).

## Zurückgestellt (bewusst)

| Severity | Thema | Warum |
|----------|--------|--------|
| CRITICAL (Produkt) | Uneingeschränktes `execute_shell` | Self-Heal braucht `pip`/`npm`; Risiko im README dokumentiert. Follow-up: engeres Allowlisting oder Job-Object-Sandbox. |
| MED | Quota-Backoff Multi-Conn Edge | CAS ergänzt; Concurrent-429-Tests optional. |
| MED | Watchdog vs. complete Multi-Conn | CAS mindert; dedizierter Race-Test optional. |
| LOW | Orphan-State `claimed` | Watchdog sweep nur `running`/`waiting_on_child`. Follow-up: claimed-TTL. |
| MED | stderr → Boss-Prompt Injection | Truncation existiert teilweise; härtere Delimiter/Sanitizer Follow-up. |
| INFO | UI-Plugin-Marketplace | Bleibt Mock; echte Registry nur über ToolRunner-Skills. |

## Verifikation

```bash
cd harness-pro && npm test
```

Neue Tests: `test/race-cas.test.js`, `test/skill-sandbox.test.js`, `test/install-skill.test.js`.
