#!/usr/bin/env node
/** Entrada stdio: Claude Desktop, Claude Code, Cursor, cualquier cliente local. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";

export async function startStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Nunca escribir a stdout acá: stdout es el canal del protocolo. Logs → stderr.
  console.error("[creator-research] MCP server conectado por stdio");
}

// ejecutable directo (pnpm mcp:stdio)
if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  startStdio().catch((err: unknown) => {
    console.error("[creator-research] error fatal:", err);
    process.exit(1);
  });
}
