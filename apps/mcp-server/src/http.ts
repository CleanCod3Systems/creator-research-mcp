/**
 * Streamable HTTP entrypoint: ChatGPT (developer mode) and remote clients.
 * Expose with: `cloudflared tunnel --url http://localhost:3333`
 *
 * Optional auth: if MCP_AUTH_TOKEN is set, it requires
 * `Authorization: Bearer <token>` or `?key=<token>` in the URL
 * (ChatGPT allows pasting the full URL with query string).
 */
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { buildServer } from "./server.js";
import { buildDashboardRouter } from "./dashboard-api.js";

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use((_, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  next();
});
app.options("*", (_, res) => res.sendStatus(204));
app.use("/api", buildDashboardRouter());

const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

/** Constant-time comparison: `===` leaks via timing how much of the token matched. */
export function safeEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorized(req: express.Request): boolean {
  if (!AUTH_TOKEN) return true;
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const key = typeof req.query.key === "string" ? req.query.key : undefined;
  return (
    (bearer !== undefined && safeEqual(bearer, AUTH_TOKEN)) ||
    (key !== undefined && safeEqual(key, AUTH_TOKEN))
  );
}

app.post("/mcp", (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  void (async () => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  })().catch((err: unknown) => {
    console.error("[creator-research] error in /mcp:", err);
    if (!res.headersSent) res.status(500).json({ error: "internal_error" });
  });
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, server: "creator-research" });
});

export function startHttp(): void {
  const port = Number(process.env.MCP_HTTP_PORT ?? 3333);
  app.listen(port, () => {
    console.error(`[creator-research] MCP Streamable HTTP at http://localhost:${String(port)}/mcp`);
    if (!AUTH_TOKEN)
      console.error(
        "[creator-research] ⚠ no MCP_AUTH_TOKEN: anyone with the URL can use the server",
      );
  });
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  startHttp();
}
