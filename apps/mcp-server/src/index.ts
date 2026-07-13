#!/usr/bin/env node
/** stdio entrypoint: Claude Desktop, Claude Code, Cursor, any local client. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";

export async function startStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Never write to stdout here: stdout is the protocol channel. Logs → stderr.
  console.error("[creator-research] MCP server connected via stdio");
}

// direct executable (pnpm mcp:stdio)
if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  startStdio().catch((err: unknown) => {
    console.error("[creator-research] fatal error:", err);
    process.exit(1);
  });
}
