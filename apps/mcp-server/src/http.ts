/**
 * Entrada Streamable HTTP: ChatGPT (developer mode) y clientes remotos.
 * Exponer con: `cloudflared tunnel --url http://localhost:3333`
 *
 * Auth opcional: si MCP_AUTH_TOKEN está definido, se exige
 * `Authorization: Bearer <token>` o `?key=<token>` en la URL
 * (ChatGPT permite pegar la URL completa con query string).
 */
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { buildServer } from "./server.js";

const app = express();
app.use(express.json({ limit: "4mb" }));

const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

/** Comparación en tiempo constante: `===` filtra por timing cuánto del token coincidió. */
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
    console.error("[creator-research] error en /mcp:", err);
    if (!res.headersSent) res.status(500).json({ error: "internal_error" });
  });
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, server: "creator-research" });
});

export function startHttp(): void {
  const port = Number(process.env.MCP_HTTP_PORT ?? 3333);
  app.listen(port, () => {
    console.error(`[creator-research] MCP Streamable HTTP en http://localhost:${String(port)}/mcp`);
    if (!AUTH_TOKEN)
      console.error(
        "[creator-research] ⚠ sin MCP_AUTH_TOKEN: cualquiera con la URL puede usar el servidor",
      );
  });
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  startHttp();
}
