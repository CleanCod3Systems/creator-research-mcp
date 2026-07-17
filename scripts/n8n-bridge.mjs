import http from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const MCP_URL = process.env.CREATOR_RESEARCH_MCP_URL ?? "http://localhost:3333/mcp";
const DASHBOARD_API_URL = process.env.DASHBOARD_API_URL ?? "http://localhost:3333/api";
const TOKEN = process.env.MCP_AUTH_TOKEN ?? "";
const PORT = Number(process.env.N8N_BRIDGE_PORT ?? 3334);
const execFileAsync = promisify(execFile);
const WHISPER_PYTHON = process.env.WHISPER_PYTHON ?? path.join(process.cwd(), ".venv-whisper", "bin", "python");
const WHISPER_SCRIPT = process.env.WHISPER_SCRIPT ?? path.join(process.cwd(), "scripts", "transcribe-audio.py");

async function mcpCall(id, method, params) {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${body}`);
  const match = body.match(/data: (.+)/s);
  const parsed = JSON.parse(match ? match[1] : body);
  if (parsed.error) throw new Error(parsed.error.message ?? "MCP error");
  return parsed.result;
}

function readToolJson(result) {
  const text = result?.content?.find((item) => item.type === "text")?.text ?? result;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function localSpeechToText(sourceUrl, audioUrl, language) {
  const unavailable = (reason) => ({ status: "unavailable", text: null, reason });
  if (process.env.ENABLE_LOCAL_TRANSCRIPTION === "false") return unavailable("transcripción local desactivada");
  try {
    await execFileAsync(WHISPER_PYTHON, [WHISPER_SCRIPT, "--check"], { timeout: 15_000 });
  } catch {
    return unavailable("faster-whisper no está instalado localmente");
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cleancod3-audio-"));
  try {
    await execFileAsync("yt-dlp", [
      "--no-playlist", "--quiet", "--no-warnings", "--format", "bestaudio/best",
      "--output", path.join(tempDir, "audio.%(ext)s"), audioUrl ?? sourceUrl,
    ], { timeout: 180_000 });
    const files = (await readdir(tempDir)).filter((file) => !file.endsWith(".part"));
    const audioFile = files[0] ? path.join(tempDir, files[0]) : null;
    if (!audioFile) return unavailable("no se pudo descargar el audio público");
    const { stdout } = await execFileAsync(WHISPER_PYTHON, [WHISPER_SCRIPT, audioFile, "--language", language ?? "auto"], { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
    const parsed = JSON.parse(stdout.trim());
    return parsed.status === "available" ? parsed : unavailable(parsed.reason ?? "transcripción sin resultado");
  } catch (error) {
    return unavailable(`falló la transcripción local: ${String(error.message ?? error).slice(0, 240)}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function summarizeComments(commentsData) {
  if (!commentsData || commentsData.error) {
    return {
      status: "unavailable",
      reason: commentsData?.message ?? "no se pudieron obtener comentarios",
      total: 0,
      items: [],
    };
  }
  const items = Array.isArray(commentsData.comments) ? commentsData.comments : [];
  if (items.length === 0) {
    return { status: "unavailable", reason: "sin comentarios públicos disponibles", total: 0, items: [] };
  }
  return {
    status: "available",
    total: commentsData.total ?? items.length,
    items: items.slice(0, 30).map((c) => ({ author: c.author ?? "anonymous", text: c.text ?? "", likes: c.likes ?? null })),
  };
}

async function addContentLayers(data, sourceUrl, input, commentsData) {
  const transcript = data?.transcript;
  const metadata = data?.metadata ?? {};
  const isNativeDescription = transcript?.source === "native_text";
  const description = metadata.description ?? (isNativeDescription ? transcript?.text ?? null : null);
  const needsAudio = /instagram\.com\/reel\//i.test(sourceUrl) && (isNativeDescription || data?.error === "no_text_available");
  const spoken = needsAudio
    ? await localSpeechToText(sourceUrl, metadata.audioUrl ?? data?.audioUrl ?? null, input.language ?? "auto")
    : { status: "not_requested", text: null, reason: "ya existe texto nativo/subtítulos; no se descargó audio" };
  const result = {
    ...data,
    contentLayers: {
      description: { text: description, source: description ? "caption" : "unavailable" },
      spoken: { ...spoken, source: spoken.status === "available" ? "faster-whisper" : null },
      comments: summarizeComments(commentsData),
    },
  };
  try {
    await fetch(`${DASHBOARD_API_URL}/content/layers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: sourceUrl, layers: result.contentLayers }),
    });
  } catch {
    // La respuesta sigue siendo útil; la persistencia se reintentará en la siguiente sincronización.
  }
  return result;
}

async function analyze(input) {
  const url = input.profile_url ?? input.url;
  if (!url) throw new Error("profile_url es obligatorio");

  await mcpCall(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "n8n-bridge", version: "1.0.0" },
  });

  // Register every profile URL before fetching. This gives the dashboard a durable creator registry
  // even when the provider cannot list the platform automatically (Instagram/TikTok snapshots).
  if (/\/(@|channel\/|user\/)|instagram\.com\/[A-Za-z0-9_.]+\/?$/i.test(url)) {
    const platform = /instagram\.com/i.test(url) ? "instagram" : /youtube\.com/i.test(url) ? "youtube" : "web";
    const handle = url.match(/youtube\.com\/@([^/?]+)/i)?.[1] ?? url.match(/instagram\.com\/([^/?]+)/i)?.[1] ?? url.split("/").filter(Boolean).pop();
    if (handle) {
      await mcpCall(5, "tools/call", { name: "import_profile_snapshot", arguments: { platform, profileUrl: url, handle, name: input.creator_name ?? handle, posts: [] } });
    }
  }

  const isYouTube = /youtube\.com|youtu\.be/i.test(url);
  const mode = input.mode ?? "summary";
  if (mode === "deep" && isYouTube) {
    const listed = await mcpCall(20, "tools/call", { name: "list_videos", arguments: { url, strategy: input.strategy ?? "top", limit: input.limit ?? 10 } });
    const listedText = listed?.content?.find((item) => item.type === "text")?.text ?? "{}";
    const base = JSON.parse(listedText);
    const videos = Array.isArray(base.videos) ? base.videos.slice(0, 3) : [];
    const deepInsights = [];
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const [transcript, comments] = await Promise.all([
        mcpCall(30 + i * 2, "tools/call", { name: "get_transcript", arguments: { url: video.url } }),
        mcpCall(31 + i * 2, "tools/call", { name: "get_comments", arguments: { url: video.url, limit: 30 } }),
      ]);
      const commentsJson = readToolJson(comments);
      const transcriptData = await addContentLayers(readToolJson(transcript), video.url, input, commentsJson);
      deepInsights.push({ video, transcript: transcriptData, comments: commentsJson });
    }
    return { ok: true, source: url, target_market: input.target_market ?? "Paraguay", language: input.language ?? "es", tool: "deep_research", data: { ...base, deepInsights } };
  }
  const tool = mode === "transcript" ? "get_transcript" : mode === "comments" ? "get_comments" : isYouTube ? "list_videos" : "get_transcript";
  const args = tool === "list_videos"
    ? { url, strategy: input.strategy ?? "top", limit: input.limit ?? 15 }
    : tool === "get_comments"
      ? { url, limit: input.limit ?? 80 }
      : { url };
  const [result, commentsResult] = await Promise.all([
    mcpCall(2, "tools/call", { name: tool, arguments: { ...args, ...(tool === "get_transcript" && input.refresh !== false ? { refresh: true } : {}) } }),
    tool === "get_transcript"
      ? mcpCall(3, "tools/call", { name: "get_comments", arguments: { url, limit: input.commentLimit ?? 30 } })
      : Promise.resolve(null),
  ]);
  let data = readToolJson(result);
  if (tool === "get_transcript") data = await addContentLayers(data, url, input, commentsResult ? readToolJson(commentsResult) : null);
  return { ok: true, source: url, target_market: input.target_market ?? "Paraguay", language: input.language ?? "es", tool, data };
}

const BATCH_CONCURRENCY = Number(process.env.ANALYZE_BATCH_CONCURRENCY ?? 3);

// Bounded-concurrency map: runs `fn` over `items` with at most `limit` in flight,
// while preserving output order (results[i] corresponds to items[i]).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function runMaintenance() {
  try {
    await fetch(`${DASHBOARD_API_URL}/maintenance`, { method: "POST" });
  } catch {
    // El análisis no debe perderse si la limpieza de índices queda pendiente.
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200); res.end(JSON.stringify({ ok: true, service: "n8n-bridge" })); return;
  }
  if (req.method !== "POST" || !["/analyze", "/analyze-batch"].includes(req.url)) {
    res.writeHead(404); res.end(JSON.stringify({ error: "Use POST /analyze or /analyze-batch" })); return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    const input = JSON.parse(raw || "{}");
    const urls = [...new Set((input.profile_urls ?? []).map(String).map((url) => url.trim()).filter(Boolean))];
    const result = req.url === "/analyze-batch" || urls.length > 0
      ? { ok: true, target_market: input.target_market ?? "Paraguay", language: input.language ?? "es", results: await mapWithConcurrency(urls, BATCH_CONCURRENCY, (url) => analyze({ ...input, profile_url: url })) }
      : await analyze(input);
    if (req.url === "/analyze-batch" || urls.length > 0) await runMaintenance();
    res.writeHead(200); res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(400); res.end(JSON.stringify({ ok: false, error: String(error.message ?? error) }));
  }
});

server.listen(PORT, process.env.N8N_BRIDGE_HOST ?? "0.0.0.0", () => {
  console.error(`[n8n-bridge] POST http://localhost:${PORT}/analyze`);
});
