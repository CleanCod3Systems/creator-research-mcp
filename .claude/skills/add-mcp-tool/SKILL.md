---
name: add-mcp-tool
description: Use when adding a new MCP tool to creator-research-mcp, or reviewing whether an existing one follows this repo's conventions and the MCP spec.
---

See [`.agents/skills/add-mcp-tool/SKILL.md`](../../../.agents/skills/add-mcp-tool/SKILL.md) for
the full recipe.

This file exists only because Claude Code specifically looks for `.claude/skills/*/SKILL.md` —
the actual content lives under `.agents/skills/`, the tool-agnostic convention, so it's readable
by any agent, tool, or human, not just Claude Code.
