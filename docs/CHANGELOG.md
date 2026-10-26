# CHANGELOG (FLAGGG)

## 2026-10-26 — Cursor Agents + Skills Bootstrap

- `.cursor/agents/` aus HorosAgent portiert (Roster + Protocols; ~43 Agent-Dateien).
- Skills-Kern via `scripts/Install-AgentSkillsCore.ps1 -Proceed` (u. a. tdd, code-review, frontend-design, design-dna).
- Optional-Pack `all-safe` via `Install-AgentSkillsOptional.ps1` (dembrandt GUI-Skills, `docs/agent-rules-books/`, VoltAgent-Catalog im Cache).
- `.cursor/mcp.json` leer stub (`mcpServers: {}`) — bewusst **kein** Bulk-MCP (Cursor-Slot-Limit, Tokens, Secrets).
- Session-Gates: `cheap` / `ox` / `seekai` = `off` unter `.cursor/session/`.
