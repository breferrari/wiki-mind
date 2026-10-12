# Claude Code

Only Claude Code reads this file. The vault's manual for every agent is `AGENTS.md`.

## Search

The QMD MCP tools are registered for Claude Code through `.mcp.json`: `mcp__qmd__query`, `mcp__qmd__get`, `mcp__qmd__multi_get` and `mcp__qmd__status`. Use them first, as `AGENTS.md` "Search" says.

## The wiki-mind mod

On Claude Code 2.1.287 and later, the `wiki-mind` mod (`.claude/skills/wiki-mind/`) delivers the session context as an instruction file, so it survives compaction whole and reaches subagents. It shows the Stop report as one line under your answer, and hands you the full report with the user's next message. The settings hooks stand down for each event the mod handles, and run as before on older Claude Code.
