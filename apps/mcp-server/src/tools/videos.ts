import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { canonicalizeUrl, detectOutlier, sourceHash } from "@cleancod3/core";
import { z } from "zod";
import { getContext, getMetricsRepo, getProfileRepo } from "../context.js";

/**
 * Client-reasoning mode: deterministic channel statistics, no AI of its own.
 * Returns the videos with views/duration so the client LLM decides
 * which ones are worth analyzing with get_transcript. Each call records a historical
 * snapshot per video (see get_metrics_history) to measure growth over time.
 */
export function registerListVideosTool(server: McpServer): void {
  server.registerTool(
    "list_videos",
    {
      title: "List a channel's videos with statistics",
      description:
        "Lists the videos of a channel/profile (YouTube, TikTok) with views, duration, and outlier " +
        "(median+MAD of the listing, not just average — a score > 3 is a strong signal of what to replicate), " +
        "with no AI analysis involved. strategy=top sorts by views; recent by date. With YOUTUBE_API_KEY " +
        "configured, it also fetches exact likes/comments and tags (SEO). Each call saves a historical " +
        "snapshot per video — repeat this call over time and use get_metrics_history to see " +
        "growth. Recommended flow: list_videos → pick the outliers/top → get_transcript for each one.",
      inputSchema: {
        url: z
          .string()
          .url()
          .describe("Channel/profile URL, e.g. https://www.youtube.com/@user"),
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
          hint: "This provider doesn't support channel listing. Check capabilities.",
        });
      }
      const items = await provider.listItems(url, strategy, limit);
      const platform = provider.name.toLowerCase();
      const handle = url.match(/youtube\.com\/@([^/?]+)/i)?.[1] ?? url.match(/youtube\.com\/channel\/([^/?]+)/i)?.[1];
      const creatorId = handle ? getProfileRepo().upsertCreator({ platform, handle, name: handle, url }) : null;
      const totalViews = items.reduce((s, i) => s + (i.viewCount ?? 0), 0);
      const viewCounts = items.map((i) => i.viewCount ?? 0);
      const metricsRepo = getMetricsRepo();

      const videos = items.map((i) => {
        const outlier = i.viewCount !== undefined ? detectOutlier(i.viewCount, viewCounts) : null;
        recordSnapshotSafe(content, metricsRepo, provider.name, i, creatorId);
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
          "outlierRatio/outlierScore are calculated ONLY over this listing (the N videos requested), not over " +
          "the channel's entire history — for a more representative baseline, request strategy=recent first " +
          "with a high limit. outlierScore uses median+MAD (robust to a single viral hit, unlike the " +
          "average); if sampleSize is small, outlierConfidence is low even if the score is high. " +
          "Analyze the patterns (titles/topics/tags/duration vs views) and use get_transcript on the ones that " +
          "stand out. This call saved a metrics snapshot per video: repeat it over time and use " +
          "get_metrics_history(url) to see real viewsPerDay/engagementPerView, not estimated.",
      });
    },
  );
}

/**
 * list_videos fetches lightweight stats (without full metadata); still worth recording the
 * snapshot to measure growth — if it fails (provider doesn't recognize the URL, etc.) it
 * doesn't bring down the whole listing, only that metric is left without history.
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
  creatorId: number | null,
): void {
  try {
    const hash = sourceHash({ type: "url", url: item.url });
    const contentItemId = content.upsertContentItem({
      sourceType: "video",
      provider: providerName,
      url: item.url,
      canonicalUrl: canonicalizeUrl(item.url),
      contentHash: hash,
      creatorId: creatorId ?? undefined,
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
    // best-effort: the listing itself doesn't depend on the snapshot being saved
  }
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
