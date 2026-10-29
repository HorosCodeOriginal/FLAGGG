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

## Community-Subagents (Internet)

```powershell
# Cache (einmal): git clone --depth 1 https://github.com/ampedweb/awesome-subagents.git .cursor/agents-cache/ampedweb-awesome-subagents
pwsh -NoProfile -File .\scripts\Install-AgentCommunity.ps1 -Proceed
```

Ziel: `.cursor/agents/comm-*.md` (134 Stück, `model: inherit`, `readonly` wo Quelle nur Read-Tools hat). Horos-Roster (`Meridian.md` usw.) bleibt unangetastet.

Index-Katalog: `.cursor/skills-cache/catalog-awesome-agent-skills` (VoltAgent, nur README).

## REA (Reverse Engineer Anything)

```powershell
# Referenz-Clone (optional, groß):
git clone --depth 1 https://github.com/morluto/rea.git .cursor/agents-cache/morluto-rea
```

- Projekt-MCP: `.cursor/mcp.json` → `rea` via `npx rea-agents@6.5.0 mcp` (Node 24.22+ für neuestes Paket; 6.5.0 passt zu 24.20).
- Skill: `.cursor/skills/reverse-engineer-anything/` (aus morluto/rea).
- Nach Änderung: **Cursor neu laden** (MCP-Toolliste).
- Native Engines optional: Ghidra (`GHIDRA_INSTALL_DIR`), Hopper, IDA — siehe [rea.run](https://rea.run/docs/).

Voll-Setup (schreibt global): `npx rea-agents@6.5.0 setup --client cursor -y`

## Composer-Rules Pack (madebyaris)

```powershell
git clone --depth 1 https://github.com/madebyaris/cursor-composer-rules.git .cursor/agents-cache/madebyaris-cursor-composer-rules
# Merge (Agents/Rules/Skills, kein Überschreiben bestehender Dateien) — manuell wie zuletzt im Chat, oder Copy aus Cache\.cursor\
```

Liefert `verifier` / `debugger`, 11 Rules unter `.cursor/rules/`, Skills `senior-practices` + `deep-research`.

## Reihenfolge

1. Core DryRun → Proceed  
2. Optional `gui` wenn Mockups/UI  
3. `Install-AgentCommunity.ps1` wenn mehr Subagents gewünscht  
4. Composer-Pack (madebyaris) mergen  
5. REA MCP + Skill (oben)  
6. Mapping-Doku unter `docs/agent-skills-curated.md` optional  
7. ECC/AAS nur in Sandbox
