import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { extractYoutubeVideoId, fetchMostReplayedHeatmap } from "@creator-research/providers";
import { z } from "zod";

export function formatTimestamp(sec: number): string {
  // redondear el TOTAL antes de partir en min/seg evita el carry "10:60" en vez de "11:00"
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

export function registerHeatmapTool(server: McpServer): void {
  server.registerTool(
    "get_video_heatmap",
    {
      title: "Momentos más repetidos de un video de YouTube",
      description:
        "Devuelve los tramos del video que la audiencia más rebobina/repite (el 'most replayed' que YouTube " +
        "muestra sobre la barra de progreso). Es la señal más directa para decidir qué cortar como short/reel: " +
        "el tramo de mayor intensity es el momento que más engancha. best-effort: solo YouTube, y algunos videos " +
        "(muy nuevos o con pocas vistas) no tienen suficiente data para generar el heatmap.",
      inputSchema: {
        url: z.string().url().describe("URL de un video individual de YouTube (no un canal)"),
      },
    },
    async ({ url }) => {
      const videoId = extractYoutubeVideoId(url);
      if (!videoId) {
        return json({
          error: "not_a_video",
          message:
            "No es una URL de video individual de YouTube (watch/youtu.be/shorts/embed/live)",
        });
      }
      let points;
      try {
        points = await fetchMostReplayedHeatmap(videoId);
      } catch (err) {
        return json({
          error: "fetch_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      if (!points || points.length === 0) {
        return json({
          error: "no_heatmap",
          message:
            "Este video no tiene suficiente data de heatmap todavía (muy nuevo o pocas vistas)",
        });
      }
      const topMoments = [...points]
        .sort((a, b) => b.intensity - a.intensity)
        .slice(0, 5)
        .map((p) => ({
          timestamp: formatTimestamp(p.startSec),
          startSec: Math.round(p.startSec),
          durationSec: Math.round(p.durationSec),
          intensity: Math.round(p.intensity * 100) / 100,
        }));
      return json({
        url,
        totalSegments: points.length,
        topMoments,
        hint: "El primer moment (mayor intensity) es el tramo que más rebobina la audiencia — buen candidato para cortar como short/reel",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
