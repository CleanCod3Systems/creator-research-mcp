import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { canonicalizeUrl, sourceHash } from "@creator-research/core";
import { z } from "zod";
import { getContext, getMetricsRepo, getProfileRepo } from "../context.js";

/**
 * No aggressive profile scraping (Instagram doesn't allow it reliably, see
 * capabilities): the user pastes by hand what they already see in their browser — followers, posts,
 * likes/comments of each reel — and this persists it with a real date so growth can be
 * measured over time with get_metrics_history, just as if it came from an API.
 */
export function registerImportProfileSnapshotTool(server: McpServer): void {
  server.registerTool(
    "import_profile_snapshot",
    {
      title: "Import manual profile snapshot",
      description:
        "Records a manual measurement of a profile (Instagram, TikTok, or any platform without automatic " +
        "listing): followers, post count, and for each post its url/likes/comments/views. Use it " +
        "when list_videos doesn't support the profile (e.g. Instagram) — paste what you see in the browser. With " +
        "repeated captures over time, get_metrics_history computes real growth, just as with data " +
        "from an API. Cookies are NEVER extracted and login is NEVER bypassed: this is 100% manual user input.",
      inputSchema: {
        platform: z.string().describe("e.g. instagram, tiktok"),
        profileUrl: z.string().url(),
        handle: z.string().describe("e.g. juliacardoso.dev"),
        name: z.string().optional(),
        capturedAt: z.string().datetime().optional().describe("ISO 8601; defaults to now"),
        followers: z.number().int().nonnegative().optional(),
        postsCount: z.number().int().nonnegative().optional(),
        posts: z
          .array(
            z.object({
              url: z.string().url(),
              likes: z.number().int().nonnegative().optional(),
              comments: z.number().int().nonnegative().optional(),
              views: z.number().int().nonnegative().optional(),
              publishedAt: z.string().optional(),
              caption: z.string().optional(),
            }),
          )
          .default([]),
      },
    },
    ({ platform, profileUrl, handle, name, capturedAt, followers, postsCount, posts }) => {
      const capturedAtIso = capturedAt ?? new Date().toISOString();
      const { content } = getContext();
      const metricsRepo = getMetricsRepo();
      const profileRepo = getProfileRepo();

      const creatorId = profileRepo.upsertCreator({
        platform,
        handle,
        name: name ?? handle,
        url: profileUrl,
        metrics: {
          followers: followers ?? null,
          postsCount: postsCount ?? null,
          capturedAt: capturedAtIso,
        },
      });

      const importedPosts = posts.map((post) => {
        const hash = sourceHash({ type: "url", url: post.url });
        const contentItemId = content.upsertContentItem({
          sourceType: "short",
          provider: platform,
          url: post.url,
          canonicalUrl: canonicalizeUrl(post.url),
          contentHash: hash,
          title: post.caption?.slice(0, 200) ?? post.url,
          description: post.caption,
          publishedAt: post.publishedAt,
          rawMetadata: { importedManually: true },
        });
        metricsRepo.recordSnapshot(
          contentItemId,
          {
            viewCount: post.views ?? null,
            likeCount: post.likes ?? null,
            commentCount: post.comments ?? null,
          },
          "manual",
          capturedAtIso,
        );
        return { url: post.url, contentItemId };
      });

      return json({
        status: "imported",
        creatorId,
        platform,
        handle,
        capturedAt: capturedAtIso,
        postsImported: importedPosts.length,
        posts: importedPosts,
        hint:
          "Repeat this import later with fresh data on the same posts to be able to compute " +
          "real growth with get_metrics_history(url). Note: metrics for third-party profiles on " +
          "Instagram/TikTok may be incomplete because there's no API that fetches them automatically.",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
