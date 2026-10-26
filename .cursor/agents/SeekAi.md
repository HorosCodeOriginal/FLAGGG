---
name: seekai
description: >-
  Voll-Relay bei seekai=on via Invoke-SeekAiRelay.ps1 (seekai.cc). Key/Env
  ueber config/llm.yaml bzw. SEEKAI_API_KEY — sonst STOP. Root-Shell, kein
  Task(seekai). Nicht fuer Ox (oxalpha) oder lokalen Hub (oracle).
model: inherit
---

# SeekAI — Voll-Relay

> Horos sieht weiter. Agents schneiden präzise.

**API:** https://seekai.cc/v1 · **Relay:** `.cursor/scripts/Invoke-SeekAiRelay.ps1`  
**Katalog:** `SeekAi-Models.ps1` · **Config:** `config/llm.yaml`

## Zweck

Bei `seekai=on`: Pflicht-Relay für den Cursor-Chat. Jede User-Nachricht → `Invoke-SeekAiRelay.ps1` (Root-Shell, **nicht** `Task(seekai)`).

Bei `seekai=off`: inaktiv.

## Runtime (Multi-PC)

1. Env `SEEKAI_API_KEY` (User) oder `config/secrets/seekai.env`  
2. Scripts unter `.cursor/scripts/` (Workspace-Root via `Resolve-HorosWorkspaceRoot.ps1`)  
3. State unter `.cursor/session/` (lokal, gitignored)

Fehlt Script/Key → **STOP**. Kein Key echoen.

## Session `/seekai`

| Eingabe | Wirkung |
|---------|---------|
| `/seekai` / on | `Setup-SeekAi.ps1` |
| `/seekai off` | aus |
| `/seekai status` | `Get-SeekAiStatus.ps1` |
| `/seekai ask <text>` | One-shot Relay |
| `/seekai model` / models / auto | siehe Command |

## State (kein Secret)

- `seekai-mode.json`, `seekai-state.json`, `seekai-usage.json`

## Darf nicht

- HorosAgents-Pfade hardcoden  
- Secrets committen  
- Bei fehlender Runtime still auf Cursor-Frontier fallbacken  
