# Agent Skills Install (FLAGGG)

Kuratiert — kein Bulk von ECC/AAS.

## Kern (empfohlen)

```powershell
cd C:\Users\Administrator\Downloads\FLAGGG
pwsh -NoProfile -File .\scripts\Install-AgentSkillsCore.ps1          # DryRun
pwsh -NoProfile -File .\scripts\Install-AgentSkillsCore.ps1 -Proceed
```

Ziel: `.cursor/skills/` (Projekt) oder `-Global` → `%USERPROFILE%\.cursor\skills\`

## Optional

```powershell
pwsh -NoProfile -File .\scripts\Install-AgentSkillsOptional.ps1 -Pack all-safe
pwsh -NoProfile -File .\scripts\Install-AgentSkillsOptional.ps1 -Pack gui -Proceed
```

| Pack | Inhalt |
|------|--------|
| `gui` | dembrandt-skills |
| `rules` | ciembor → `docs/agent-rules-books/` |
| `catalog` | VoltAgent Index im Cache |
| `ecc-sandbox` | nur mit `-SandboxDir` außerhalb FLAGGG |
| `aas` | kein Auto-Install |
| `all-safe` | gui + rules + catalog |

## Reihenfolge

1. Core DryRun → Proceed  
2. Optional `gui` wenn Mockups/UI  
3. Mapping-Doku unter `docs/agent-skills-curated.md` optional  
4. ECC/AAS nur in Sandbox
