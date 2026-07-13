import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { computeGrowthMetrics, sourceHash } from "@creator-research/core";
import { z } from "zod";
import { getContext, getMetricsRepo } from "../context.js";

/**
 * Lee el historial de snapshots que fueron acumulando list_videos/get_transcript sobre esta
 * URL. Sin al menos 2 mediciones en momentos distintos no hay velocidad que calcular — y eso
 * se explica, nunca se inventa un número.
 */
export function registerMetricsHistoryTool(server: McpServer): void {
  server.registerTool(
    "get_metrics_history",
    {
      title: "Historial de métricas y velocidad de crecimiento",
      description:
        "Devuelve los snapshots de vistas/likes/comments guardados para esta URL (por list_videos o " +
        "get_transcript) y calcula viewsPerHour/viewsPerDay/engagementPerView/commentsPerLike reales entre " +
        "el primer y el último snapshot. Necesita al menos 2 mediciones en momentos distintos — si solo hay " +
        "una, lo dice explícitamente en vez de inventar una velocidad. Volvé a llamar list_videos/get_transcript " +
        "sobre la misma URL en otro momento para acumular más historial.",
      inputSchema: {
        url: z.string().url(),
      },
    },
    ({ url }) => {
      const { content } = getContext();
      const hash = sourceHash({ type: "url", url });
      const contentItemId = content.findIdByHash(hash);
      if (contentItemId === null) {
        return json({
          error: "no_history",
          message:
            "Nunca se pidió esta URL con list_videos o get_transcript — no hay ningún snapshot todavía.",
        });
      }
      const item = content.getItem(contentItemId);
      const snapshots = getMetricsRepo().getSnapshots(contentItemId);
      const growth = computeGrowthMetrics(snapshots, item?.publishedAt ?? null, new Date());
      return json({
        url,
        snapshotCount: snapshots.length,
        snapshots: snapshots.map((s) => ({
          observedAt: s.observedAt,
          views: s.viewCount,
          likes: s.likeCount,
          comments: s.commentCount,
          source: s.source,
        })),
        growth,
        hint:
          growth.sampleSize < 2
            ? "Con un solo snapshot no hay ventana de tiempo para medir velocidad. Volvé a pedir list_videos/get_transcript de esta URL más adelante."
            : "growth.limitations explica cualquier campo en null (nunca se calcula una tasa sin denominador real).",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
