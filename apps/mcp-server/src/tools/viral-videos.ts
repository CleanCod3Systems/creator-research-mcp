import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getChannelsStats, searchVideos } from "@cleancod3/providers";
import { z } from "zod";

export function registerViralVideosTool(server: McpServer): void {
  server.registerTool(
    "search_viral_videos",
    {
      title: "Find videos over-performing their own channel",
      description:
        "Searches YouTube for a topic, then for each result computes outlierScore = the video's view " +
        "count ÷ its own channel's lifetime average views per video (e.g. 3.2 means the video got 3.2x " +
        "that channel's typical performance) — sorted highest first. Unlike list_videos' outlier score " +
        "(which compares videos within ONE channel's own listing), this compares each video across " +
        "DIFFERENT channels found by the search. The baseline is the channel's all-time average, not a " +
        "recent-only median, so a channel that changed format/niche partway through its history can show " +
        "a skewed score. Uses the official YouTube Data API (free, requires YOUTUBE_API_KEY); search.list " +
        "costs 100 quota units per call — the free 10,000/day quota allows roughly 100 searches.",
      inputSchema: {
        query: z.string().min(1).describe("Topic to search for, e.g. 'roblox challenge shorts'"),
        publishedWithinDays: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Only consider videos published within the last N days"),
        minOutlierScore: z
          .number()
          .optional()
          .describe("Drop results below this outlierScore, e.g. 2 for at least 2x the channel's average"),
        limit: z.number().int().min(1).max(50).default(15),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ query, publishedWithinDays, minOutlierScore, limit }) => {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        return json({
          error: "missing_api_key",
          message: "search_viral_videos requires YOUTUBE_API_KEY configured on the server (free, YouTube Data API v3).",
        });
      }
      const publishedAfter = publishedWithinDays
        ? new Date(Date.now() - publishedWithinDays * 86_400_000).toISOString()
        : undefined;
      try {
        const videos = await searchVideos(
          query,
          { order: "viewCount", publishedAfter, maxResults: limit },
          apiKey,
        );
        if (videos.length === 0) {
          return json({ query, count: 0, videos: [], hint: "No results for this query/window." });
        }
        const channelIds = [...new Set(videos.map((v) => v.channelId))];
        const channelStats = await getChannelsStats(channelIds, apiKey);
        const statsByChannel = new Map(channelStats.map((c) => [c.channelId, c]));

        const scored = videos.map((v) => {
          const channel = statsByChannel.get(v.channelId);
          const avgViewsPerVideo = channel?.avgViewsPerVideo ?? null;
          const outlierScore =
            avgViewsPerVideo && avgViewsPerVideo > 0
              ? Math.round((v.viewCount / avgViewsPerVideo) * 100) / 100
              : null;
          return {
            title: v.title,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            channelId: v.channelId,
            views: v.viewCount,
            durationSec: v.durationSec,
            publishedAt: v.publishedAt,
            channelAvgViewsPerVideo: avgViewsPerVideo !== null ? Math.round(avgViewsPerVideo) : null,
            outlierScore,
            limitations: outlierScore === null ? ["Channel has no uploaded videos to compute a baseline from."] : [],
          };
        });

        const filtered =
          minOutlierScore !== undefined
            ? scored.filter((v) => v.outlierScore !== null && v.outlierScore >= minOutlierScore)
            : scored;
        filtered.sort((a, b) => (b.outlierScore ?? -Infinity) - (a.outlierScore ?? -Infinity));

        return json({
          query,
          count: filtered.length,
          videos: filtered,
          hint:
            "Sorted by outlierScore (highest over-performance first). Cross-reference the top hits with " +
            "list_videos on their channel to see if this was a one-off or part of a pattern.",
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
