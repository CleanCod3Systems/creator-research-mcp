import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { canonicalizeUrl, detectOutlier, sourceHash } from "@creator-research/core";
import { z } from "zod";
import { getContext, getMetricsRepo } from "../context.js";

/**
 * Modo client-reasoning: estadísticas de canal SIN worker ni IA propia.
 * Devuelve los videos con vistas/duración para que el LLM cliente decida
 * cuáles vale la pena analizar con get_transcript. Cada llamado registra un snapshot
 * histórico por video (ver get_metrics_history) para poder medir crecimiento en el tiempo.
 */
export function registerListVideosTool(server: McpServer): void {
  server.registerTool(
    "list_videos",
    {
      title: "Listar videos de un canal con estadísticas",
      description:
        "Lista los videos de un canal/perfil (YouTube, TikTok) con vistas, duración y outlier " +
        "(mediana+MAD del listado, no solo promedio — un score > 3 es señal fuerte de qué replicar), SIN " +
        "análisis de IA ni worker. strategy=top ordena por vistas; recent por fecha. Con YOUTUBE_API_KEY " +
        "configurada, además trae likes/comments exactos y tags (SEO). Cada llamado guarda un snapshot " +
        "histórico por video — repetí este llamado en el tiempo y usá get_metrics_history para ver " +
        "crecimiento. Flujo recomendado: list_videos → elegir los outliers/top → get_transcript de cada uno.",
      inputSchema: {
        url: z
          .string()
          .url()
          .describe("URL del canal/perfil, ej. https://www.youtube.com/@usuario"),
        strategy: z.enum(["top", "recent"]).default("top"),
        limit: z.number().int().min(1).max(50).default(15),
      },
    },
    async ({ url, strategy, limit }) => {
      const { providers, content } = getContext();
      const provider = providers.find((p) => p.matches(url));
      if (!provider?.listItems) {
        return json({
          error: "unsupported_source",
          hint: "Este provider no soporta listado de canales. Consultá capabilities.",
        });
      }
      const items = await provider.listItems(url, strategy, limit);
      const totalViews = items.reduce((s, i) => s + (i.viewCount ?? 0), 0);
      const viewCounts = items.map((i) => i.viewCount ?? 0);
      const metricsRepo = getMetricsRepo();

      const videos = items.map((i) => {
        const outlier = i.viewCount !== undefined ? detectOutlier(i.viewCount, viewCounts) : null;
        recordSnapshotSafe(content, metricsRepo, provider.name, i);
        return {
          title: i.title,
          url: i.url,
          views: i.viewCount ?? null,
          durationSec: i.durationSec ?? null,
          likes: i.likeCount ?? null,
          comments: i.commentCount ?? null,
          publishedAt: i.publishedAt ?? null,
          tags: i.tags?.length ? i.tags : null,
          outlierRatio: outlier?.ratio ?? null,
          outlierScore: outlier?.score ?? null,
          outlierConfidence: outlier?.confidence ?? null,
        };
      });

      return json({
        channel: url,
        provider: provider.name,
        strategy,
        count: items.length,
        avgViews: items.length > 0 ? Math.round(totalViews / items.length) : 0,
        sampleSize: items.length,
        videos,
        hint:
          "outlierRatio/outlierScore se calculan SOLO sobre este listado (los N videos pedidos), no sobre " +
          "todo el historial del canal — para una baseline más representativa, pedí antes strategy=recent " +
          "con un limit alto. outlierScore usa mediana+MAD (robusto a un solo viral, a diferencia del " +
          "promedio); si sampleSize es chico, outlierConfidence baja aunque el score sea alto. " +
          "Analizá los patrones (títulos/temas/tags/duración vs vistas) y usá get_transcript en los que " +
          "destaquen. Este llamado guardó un snapshot de métricas por video: repetilo en el tiempo y usá " +
          "get_metrics_history(url) para ver viewsPerDay/engagementPerView reales, no estimados.",
      });
    },
  );
}

/**
 * list_videos trae stats livianas (sin metadata completa); igual conviene registrar el
 * snapshot para poder medir crecimiento — si falla (provider no reconoce la URL, etc.) no
 * tira abajo el listado completo, solo esa métrica queda sin historial.
 */
function recordSnapshotSafe(
  content: ReturnType<typeof getContext>["content"],
  metricsRepo: ReturnType<typeof getMetricsRepo>,
  providerName: string,
  item: {
    url: string;
    title: string;
    durationSec?: number;
    viewCount?: number;
    likeCount?: number;
    commentCount?: number;
    publishedAt?: string;
  },
): void {
  try {
    const hash = sourceHash({ type: "url", url: item.url });
    const contentItemId = content.upsertContentItem({
      sourceType: "video",
      provider: providerName,
      url: item.url,
      canonicalUrl: canonicalizeUrl(item.url),
      contentHash: hash,
      title: item.title,
      durationSec: item.durationSec,
      publishedAt: item.publishedAt,
      rawMetadata: {},
    });
    metricsRepo.recordSnapshot(
      contentItemId,
      {
        viewCount: item.viewCount ?? null,
        likeCount: item.likeCount ?? null,
        commentCount: item.commentCount ?? null,
      },
      providerName,
    );
  } catch {
    // best-effort: el listado en sí no depende de que el snapshot se guarde
  }
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
