#!/usr/bin/env node
/**
 * Binary published on npm. Modes:
 *   creator-research-mcp            → stdio (Claude Desktop, Cursor, Claude Code)
 *   creator-research-mcp http       → Streamable HTTP :3333 (ChatGPT via tunnel)
 */
import { config as loadEnv } from "dotenv";

// quiet: true because in stdio mode nothing must be written to stdout (breaks the MCP protocol)
loadEnv({ quiet: true });

const mode = process.argv[2] ?? "stdio";

async function run(): Promise<void> {
  switch (mode) {
    case "stdio": {
      const { startStdio } = await import("./index.js");
      await startStdio();
      break;
    }
    case "http": {
      const { startHttp } = await import("./http.js");
      startHttp();
      break;
    }
    default:
      console.error(`Unknown mode: ${mode}. Use: stdio | http`);
      process.exit(1);
  }
}

run().catch((err: unknown) => {
  console.error("[creator-research] fatal error:", err);
  process.exit(1);
});
