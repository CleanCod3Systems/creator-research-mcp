import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTrendingVideos } from "@cleancod3/providers";
import { z } from "zod";

/**
 * Most-used categories for content research (YouTube videoCategories id).
 * Not the full list — covers the typical ones; for others, the LLM can omit categoryId.
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
      title: "Official YouTube trending",
      description:
        "What's working RIGHT NOW on YouTube, beyond a specific channel — useful for content ideas " +
        "outside your own history. Uses YouTube Data API's official 'mostPopular' chart (free, requires " +
        "YOUTUBE_API_KEY on the server). category accepts a YouTube id or one of these aliases: " +
        `${Object.keys(CATEGORY_HINTS).join(", ")}.`,
      inputSchema: {
        regionCode: z
          .string()
          .length(2)
          .default("US")
          .describe("ISO 3166-1 country code, e.g. US, ES, AR"),
        category: z
          .string()
          .optional()
          .describe("Alias (gaming, music, education...) or numeric YouTube id"),
        limit: z.number().int().min(1).max(50).default(15),
      },
    },
    async ({ regionCode, category, limit }) => {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        return json({
          error: "missing_api_key",
          message:
            "get_trending_videos requires YOUTUBE_API_KEY configured on the server (free, YouTube Data API v3).",
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
          hint: "This is what's working on the platform in general, not on a specific channel — use it to spot trending formats/topics before planning new content",
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
