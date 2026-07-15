import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchVideos } from "@cleancod3/providers";
import { z } from "zod";

export function registerYoutubeSearchTool(server: McpServer): void {
  server.registerTool(
    "search_youtube_videos",
    {
      title: "Search YouTube by keyword",
      description:
        "Keyword search across all of YouTube (not limited to one channel) — use this to find " +
        "videos/topics/formats you don't already have a channel URL for. Uses the official YouTube " +
        "Data API's search.list (free, requires YOUTUBE_API_KEY on the server), enriched with exact " +
        "view/like/comment counts and duration. search.list costs 100 quota units per call versus 1 " +
        "for most other calls in this server — a default 10,000/day quota allows roughly 100 " +
        "searches, so avoid calling this repeatedly for the same query. Complements " +
        "get_trending_videos (fixed 'what's popular right now' chart, no query) and list_videos " +
        "(one specific channel).",
      inputSchema: {
        query: z.string().min(1).describe("Search terms, e.g. 'roblox challenge shorts'"),
        order: z
          .enum(["relevance", "date", "rating", "viewCount"])
          .default("relevance")
          .describe("relevance (default), date (newest first), rating, or viewCount (most viewed first)"),
        duration: z
          .enum(["any", "short", "medium", "long"])
          .default("any")
          .describe("short <4min, medium 4-20min, long >20min"),
        publishedWithinDays: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Only videos published within the last N days, e.g. 3 for 'this week'"),
        regionCode: z
          .string()
          .length(2)
          .optional()
          .describe("ISO 3166-1 country code to bias results, e.g. US, ES, AR"),
        limit: z.number().int().min(1).max(50).default(15),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ query, order, duration, publishedWithinDays, regionCode, limit }) => {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        return json({
          error: "missing_api_key",
          message:
            "search_youtube_videos requires YOUTUBE_API_KEY configured on the server (free, YouTube Data API v3).",
        });
      }
      const publishedAfter = publishedWithinDays
        ? new Date(Date.now() - publishedWithinDays * 86_400_000).toISOString()
        : undefined;
      try {
        const videos = await searchVideos(
          query,
          { order, videoDuration: duration, publishedAfter, regionCode, maxResults: limit },
          apiKey,
        );
        return json({
          query,
          order,
          count: videos.length,
          videos: videos.map((v) => ({
            title: v.title,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            views: v.viewCount,
            likes: v.likeCount,
            comments: v.commentCount,
            durationSec: v.durationSec,
            publishedAt: v.publishedAt,
            tags: v.tags.length ? v.tags : null,
          })),
          hint:
            "Results reflect YouTube's own relevance/ranking for this query — cross-reference with " +
            "list_videos on the channels that show up repeatedly to see their full upload history.",
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
