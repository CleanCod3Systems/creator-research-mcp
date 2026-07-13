#!/usr/bin/env node
/**
 * Binario publicado en npm. Modos:
 *   creator-research-mcp            → stdio (Claude Desktop, Cursor, Claude Code)
 *   creator-research-mcp http       → Streamable HTTP :3333 (ChatGPT vía túnel)
 */
import { config as loadEnv } from "dotenv";

// silent: true porque en modo stdio no hay que escribir nada a stdout (rompe el protocolo MCP)
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
      console.error(`Modo desconocido: ${mode}. Usar: stdio | http`);
      process.exit(1);
  }
}

run().catch((err: unknown) => {
  console.error("[creator-research] error fatal:", err);
  process.exit(1);
});
