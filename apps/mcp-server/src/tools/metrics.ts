import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { computeGrowthMetrics, sourceHash } from "@creator-research/core";
import { z } from "zod";
import { getContext, getMetricsRepo } from "../context.js";

/**
 * Reads the history of snapshots that list_videos/get_transcript have been accumulating on
 * this URL. Without at least 2 measurements at different times there's no velocity to compute — and that
 * is explained, a number is never invented.
 */
export function registerMetricsHistoryTool(server: McpServer): void {
  server.registerTool(
    "get_metrics_history",
    {
      title: "Metrics history and growth velocity",
      description:
        "Returns the views/likes/comments snapshots saved for this URL (via list_videos or " +
        "get_transcript) and computes real viewsPerHour/viewsPerDay/engagementPerView/commentsPerLike between " +
        "the first and the last snapshot. Needs at least 2 measurements at different times — if there's only " +
        "one, it says so explicitly instead of inventing a velocity. Call list_videos/get_transcript again " +
        "on the same URL at another time to accumulate more history.",
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
            "This URL was never requested with list_videos or get_transcript — there's no snapshot yet.",
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
            ? "With a single snapshot there's no time window to measure velocity. Request list_videos/get_transcript for this URL again later."
            : "growth.limitations explains any field set to null (a rate is never computed without a real denominator).",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
