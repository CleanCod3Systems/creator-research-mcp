import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { extractYoutubeVideoId, fetchMostReplayedHeatmap } from "@creator-research/providers";
import { z } from "zod";

export function formatTimestamp(sec: number): string {
  // rounding the TOTAL before splitting into min/sec avoids the "10:60" carry instead of "11:00"
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

export function registerHeatmapTool(server: McpServer): void {
  server.registerTool(
    "get_video_heatmap",
    {
      title: "Most replayed moments of a YouTube video",
      description:
        "Returns the segments of the video the audience rewinds/replays the most (the 'most replayed' that YouTube " +
        "shows over the progress bar). It's the most direct signal for deciding what to cut as a short/reel: " +
        "the segment with the highest intensity is the moment that hooks the most. best-effort: YouTube only, and some videos " +
        "(very new or with few views) don't have enough data to generate the heatmap.",
      inputSchema: {
        url: z.string().url().describe("URL of an individual YouTube video (not a channel)"),
      },
    },
    async ({ url }) => {
      const videoId = extractYoutubeVideoId(url);
      if (!videoId) {
        return json({
          error: "not_a_video",
          message:
            "Not an individual YouTube video URL (watch/youtu.be/shorts/embed/live)",
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
            "This video doesn't have enough heatmap data yet (too new or too few views)",
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
        hint: "The first moment (highest intensity) is the segment the audience rewinds the most — a good candidate for cutting as a short/reel",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
