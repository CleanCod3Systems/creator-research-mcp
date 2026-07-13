import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { canonicalizeUrl, sourceHash } from "@creator-research/core";
import { z } from "zod";
import { getCommentsRepo, getContext } from "../context.js";

/**
 * Modo client-reasoning para comentarios: el server los trae (yt-dlp, sin API key),
 * el LLM cliente detecta FAQs, errores comunes, críticas y contenido faltante.
 */
export function registerCommentsTool(server: McpServer): void {
  server.registerTool(
    "get_comments",
    {
      title: "Obtener comentarios",
      description:
        "Trae los comentarios públicos más relevantes de un video/post (YouTube, Instagram) vía yt-dlp " +
        "(sin API key) y los persiste. Analizalos vos (el LLM cliente) para detectar: preguntas " +
        "frecuentes, errores comunes, críticas y contenido que la audiencia pide — señal directa de qué " +
        "vende más o qué hueco de mercado hay para nuevo contenido.",
      inputSchema: {
        url: z.string().url(),
        limit: z.number().int().min(10).max(300).default(80),
      },
    },
    async ({ url, limit }) => {
      const { content, providers } = getContext();
      const provider = providers.find((p) => p.matches(url));
      if (!provider?.fetchComments || !provider.capabilities().supports.comments) {
        return json({
          error: "unsupported",
          message: "Comentarios: solo YouTube/Instagram por ahora",
        });
      }
      const hash = sourceHash({ type: "url", url });
      let contentItemId = content.findIdByHash(hash);
      const repo = getCommentsRepo();

      // reuso si ya los trajimos
      if (contentItemId !== null) {
        const cached = repo.getForItem(contentItemId);
        if (cached.length > 0) {
          return json({
            cachedFromDb: true,
            total: cached.length,
            comments: cached.slice(0, limit),
          });
        }
      }

      const meta = await provider.fetchMetadata(url);
      contentItemId ??= content.upsertContentItem({
        sourceType: "video",
        provider: provider.name,
        url,
        canonicalUrl: canonicalizeUrl(url),
        contentHash: hash,
        title: meta.title,
        durationSec: meta.durationSec,
        rawMetadata: meta.raw,
      });
      const fetched = await provider.fetchComments(url, limit);
      repo.replaceForItem(contentItemId, fetched);
      const topLevel = fetched.filter((c) => !c.parentId).length;
      return json({
        video: meta.title,
        total: fetched.length,
        topLevel,
        replies: fetched.length - topLevel,
        comments: fetched,
        nextStep:
          "Clasificá: preguntas frecuentes / errores comunes / críticas / contenido pedido que falta.",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
