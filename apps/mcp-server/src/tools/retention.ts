import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TranscriptSegment } from "@cleancod3/core";
import {
  extractYoutubeVideoId,
  fetchMostReplayedHeatmap,
  YouTubeProvider,
  type HeatmapPoint,
} from "@cleancod3/providers";
import { z } from "zod";
import { formatTimestamp } from "./heatmap.js";

const provider = new YouTubeProvider();

/**
 * Joins the "most replayed" heatmap (packages/providers/youtube-heatmap.ts) with the transcript
 * by timestamp overlap. Deterministic: no embeddings, no AI — just matching two things this
 * server already fetches separately (get_video_heatmap, get_transcript) so the client LLM
 * doesn't have to eyeball-correlate "audience rewound at 0:47" with "what was said at 0:47".
 */
export function registerRetentionMomentsTool(server: McpServer): void {
  server.registerTool(
    "get_retention_moments",
    {
      title: "What was said at the moments people rewatched most/least",
      description:
        "Joins a YouTube video's replay heatmap (get_video_heatmap) with its transcript (get_transcript) by " +
        "timestamp, so each hotspot/coldspot comes with the actual words said at that moment — no manual " +
        "cross-referencing needed. mostReplayed = segments rewound the most (hooks/highlights, good short/reel " +
        "candidates); leastReplayed = segments rewound the least relative to the rest of THIS video (not " +
        "necessarily bad content — could just be a slower section). This is replay/rewatch intensity, not " +
        "viewer drop-off/retention data (YouTube doesn't expose that publicly). best-effort: YouTube only, " +
        "requires both heatmap data and subtitles/captions to exist for the video.",
      inputSchema: {
        url: z.string().url().describe("URL of an individual YouTube video (not a channel)"),
      },
    },
    async ({ url }) => {
      const videoId = extractYoutubeVideoId(url);
      if (!videoId) {
        return json({
          error: "not_a_video",
          message: "Not an individual YouTube video URL (watch/youtu.be/shorts/embed/live)",
        });
      }

      let points: HeatmapPoint[] | null;
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
          message: "This video doesn't have enough heatmap data yet (too new or too few views)",
        });
      }

      let text;
      try {
        text = await provider.fetchText(url);
      } catch (err) {
        return json({
          error: "fetch_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      if (!text?.segments || text.segments.length === 0) {
        return json({
          error: "no_transcript",
          message:
            "This video has no subtitles/captions available, so replay moments can't be matched to what was said. Try get_video_heatmap alone instead.",
        });
      }
      const segments = text.segments;

      const sorted = [...points].sort((a, b) => b.intensity - a.intensity);
      const mostReplayed = sorted.slice(0, 6).map((p) => withTranscript(p, segments));
      const leastReplayed = sorted
        .slice(-4)
        .reverse()
        .map((p) => withTranscript(p, segments));

      return json({
        url,
        mostReplayed,
        leastReplayed,
        hint:
          "mostReplayed segments are strong candidates for a short/reel — that's the exact moment that hooked " +
          "the audience enough to rewatch it. Compare wording/pacing against leastReplayed to spot what makes " +
          "the difference.",
      });
    },
  );
}

export function withTranscript(point: HeatmapPoint, segments: TranscriptSegment[]) {
  const endSec = point.startSec + point.durationSec;
  const saidAtThisMoment =
    segments
      .filter((s) => s.start < endSec && s.end > point.startSec)
      .map((s) => s.text)
      .join(" ")
      .trim() || null;
  return {
    timestamp: formatTimestamp(point.startSec),
    startSec: Math.round(point.startSec),
    durationSec: Math.round(point.durationSec),
    intensity: Math.round(point.intensity * 100) / 100,
    saidAtThisMoment,
  };
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
