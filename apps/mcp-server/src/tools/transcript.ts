import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { canonicalizeUrl, sourceHash, type SourceRef } from "@creator-research/core";
import { z } from "zod";
import { getContext, getMetricsRepo } from "../context.js";

const MAX_CHARS_DEFAULT = 80_000;
const MAX_BATCH = 15;

/**
 * Modo client-reasoning: no requiere Ollama ni worker.
 * El servidor extrae transcript+metadatos (yt-dlp) y el LLM del cliente
 * (Claude/ChatGPT) hace el análisis en la conversación.
 * Complemento: save_analysis persiste ese análisis para búsqueda/comparación futura.
 */
export function registerGetTranscriptTool(server: McpServer): void {
  server.registerTool(
    "get_transcript",
    {
      title: "Obtener transcript",
      description:
        "Extrae metadatos, engagement (views/likes/comments) y texto de una fuente (video con subtítulos, " +
        "tweet, post de Instagram/LinkedIn, artículo web, PDF, archivo md/txt) SIN motor de IA propio: vos " +
        "(el LLM cliente) analizás el texto en la conversación. No requiere worker ni Ollama. " +
        `Pasá 'urls' (hasta ${String(MAX_BATCH)}) en vez de 'url' para traer varias fuentes en un solo ` +
        "llamado — útil para Instagram/Twitter, donde no hay listado automático de perfil y hay que pegar " +
        "posts puntuales. Tras analizar, guardá el resultado con save_analysis. Transcripts largos: usá offset.",
      inputSchema: {
        url: z.string().url().optional(),
        urls: z
          .array(z.string().url())
          .min(1)
          .max(MAX_BATCH)
          .optional()
          .describe("Varias URLs en un solo llamado"),
        filePath: z.string().optional().describe("Path de archivo en el disco del servidor"),
        offset: z.number().int().min(0).default(0),
        maxChars: z.number().int().min(1000).max(200_000).default(MAX_CHARS_DEFAULT),
      },
    },
    async ({ url, urls, filePath, offset, maxChars }) => {
      const provided = [url, urls, filePath].filter((v) => v !== undefined).length;
      if (provided !== 1) {
        return json({
          error: "bad_request",
          message: "Pasá exactamente uno: url, urls o filePath",
        });
      }
      if (urls) {
        const results = await Promise.all(urls.map((u) => fetchOne({ url: u }, offset, maxChars)));
        return json({ batch: true, count: results.length, results });
      }
      const single = await fetchOne({ url, filePath }, offset, maxChars);
      return json(single);
    },
  );
}

async function fetchOne(
  ref: { url?: string; filePath?: string },
  offset: number,
  maxChars: number,
): Promise<Record<string, unknown>> {
  const { content, providers } = getContext();
  const source: SourceRef = ref.url
    ? { type: "url", url: ref.url }
    : { type: "file", filePath: ref.filePath ?? "" };
  const target = ref.url ?? ref.filePath ?? "";
  const provider = providers.find((p) => p.matches(target));
  if (!provider) {
    return {
      url: ref.url,
      error: "unsupported_source",
      hint: "Consultá capabilities para ver fuentes soportadas",
    };
  }
  let kind;
  try {
    kind = provider.classify(target);
  } catch (err) {
    return {
      url: ref.url,
      error: "unrecognized_url",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (kind === "channel" || kind === "playlist") {
    return {
      url: ref.url,
      error: "unsupported_kind",
      kind,
      hint: "Para canales usá list_videos; playlists no están soportadas todavía",
    };
  }

  const hash = sourceHash(source);

  // reuso: si ya extrajimos este transcript, no volver a llamar a yt-dlp
  const existingId = content.findIdByHash(hash);
  const cached = existingId !== null ? content.getTranscript(existingId) : null;
  if (cached) {
    return page(
      { url: ref.url, title: null, transcript: cached, cachedFromDb: true },
      offset,
      maxChars,
    );
  }

  // en batch, una URL que falla (ej. Instagram con rate-limit) no puede tumbar las demás
  let meta;
  let text;
  try {
    meta = await provider.fetchMetadata(target);
    text = await provider.fetchText(target);
  } catch (err) {
    return {
      url: ref.url,
      error: "fetch_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (!text) {
    return {
      url: ref.url,
      error: "no_text_available",
      message:
        "La fuente no tiene texto directo (sin subtítulos ni artículo extraíble). Probá otro video/URL.",
    };
  }
  const contentItemId = content.upsertContentItem({
    sourceType:
      kind === "short"
        ? "short"
        : kind === "article"
          ? "article"
          : kind === "pdf"
            ? "pdf"
            : kind === "file"
              ? "file"
              : "video",
    provider: provider.name,
    url: ref.url,
    filePath: ref.filePath,
    canonicalUrl: ref.url ? canonicalizeUrl(ref.url) : undefined,
    contentHash: hash,
    title: meta.title,
    description: meta.description,
    durationSec: meta.durationSec,
    publishedAt: meta.publishedAt,
    language: meta.language,
    rawMetadata: meta.raw,
  });
  content.insertTranscript({
    contentItemId,
    source: text.source,
    language: text.language,
    text: text.text,
    segments: text.segments,
  });
  if (
    meta.viewCount !== undefined ||
    meta.likeCount !== undefined ||
    meta.commentCount !== undefined
  ) {
    getMetricsRepo().recordSnapshot(
      contentItemId,
      {
        viewCount: meta.viewCount ?? null,
        likeCount: meta.likeCount ?? null,
        commentCount: meta.commentCount ?? null,
      },
      provider.name,
    );
  }

  return page(
    {
      url: ref.url,
      title: meta.title,
      channel: meta.channelName,
      durationSec: meta.durationSec,
      publishedAt: meta.publishedAt ?? null,
      views: meta.viewCount ?? null,
      likes: meta.likeCount ?? null,
      comments: meta.commentCount ?? null,
      transcript: { text: text.text, source: text.source, language: text.language },
      nextStep:
        "Analizá este transcript (resumen, tecnologías, prácticas, temario...) y persistí el resultado con save_analysis(url, facets).",
    },
    offset,
    maxChars,
  );
}

interface Pageable {
  transcript: { text: string; source: string; language: string | null | undefined };
  [k: string]: unknown;
}

function page(payload: Pageable, offset: number, maxChars: number): Record<string, unknown> {
  const full = payload.transcript.text;
  const slice = full.slice(offset, offset + maxChars);
  return {
    ...payload,
    transcript: { ...payload.transcript, text: slice },
    pagination: {
      offset,
      returnedChars: slice.length,
      totalChars: full.length,
      hasMore: offset + maxChars < full.length,
      nextOffset: offset + maxChars < full.length ? offset + maxChars : null,
    },
  };
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
