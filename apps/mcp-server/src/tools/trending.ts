import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTrendingVideos } from "@creator-research/providers";
import { z } from "zod";

/**
 * Categorías más usadas para research de contenido (id de YouTube videoCategories).
 * No es la lista completa — cubre lo típico; para otras, el LLM puede omitir categoryId.
 */
const CATEGORY_HINTS: Record<string, string> = {
  gaming: "20",
  music: "10",
  education: "27",
  tech: "28",
  entertainment: "24",
  howto: "26",
};

export function registerTrendingTool(server: McpServer): void {
  server.registerTool(
    "get_trending_videos",
    {
      title: "Trending oficial de YouTube",
      description:
        "Qué está funcionando AHORA en YouTube, más allá de un canal puntual — útil para ideas de contenido " +
        "fuera de tu propio historial. Usa el chart oficial 'mostPopular' de la YouTube Data API (gratis, requiere " +
        "YOUTUBE_API_KEY en el servidor). category acepta un id de YouTube o uno de estos alias: " +
        `${Object.keys(CATEGORY_HINTS).join(", ")}.`,
      inputSchema: {
        regionCode: z
          .string()
          .length(2)
          .default("US")
          .describe("Código de país ISO 3166-1, ej. US, ES, AR"),
        category: z
          .string()
          .optional()
          .describe("Alias (gaming, music, education...) o id numérico de YouTube"),
        limit: z.number().int().min(1).max(50).default(15),
      },
    },
    async ({ regionCode, category, limit }) => {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        return json({
          error: "missing_api_key",
          message:
            "get_trending_videos requiere YOUTUBE_API_KEY configurada en el servidor (gratis, YouTube Data API v3).",
        });
      }
      const categoryId = category
        ? (CATEGORY_HINTS[category.toLowerCase()] ?? category)
        : undefined;
      try {
        const videos = await getTrendingVideos(regionCode.toUpperCase(), categoryId, limit, apiKey);
        return json({
          regionCode: regionCode.toUpperCase(),
          category: category ?? null,
          count: videos.length,
          videos: videos.map((v) => ({
            title: v.title,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            views: v.viewCount,
            likes: v.likeCount,
            durationSec: v.durationSec,
            publishedAt: v.publishedAt,
            tags: v.tags.length ? v.tags : null,
          })),
          hint: "Esto es lo que está funcionando en la plataforma en general, no en un canal específico — úsalo para detectar formatos/temas de moda antes de planear contenido nuevo",
        });
      } catch (err) {
        return json({
          error: "fetch_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
