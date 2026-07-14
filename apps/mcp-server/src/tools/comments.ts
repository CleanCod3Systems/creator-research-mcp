import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { canonicalizeUrl, sourceHash } from "@cleancod3/core";
import { z } from "zod";
import { cacheAgeSeconds } from "../cache.js";
import { getCommentsRepo, getContext } from "../context.js";

/**
 * Client-reasoning mode for comments: the server fetches them where a provider explicitly supports
 * them (currently public YouTube and Instagram), and the client LLM detects FAQs, common mistakes,
 * criticism, and missing content.
 */
export function registerCommentsTool(server: McpServer): void {
  server.registerTool(
    "get_comments",
    {
      title: "Get comments",
      description:
        "Fetches the most relevant public comments on a video/post via yt-dlp (YouTube or Instagram; no API key) " +
        "and persists them. Set refresh=true to fetch a fresh sample. Analyze them yourself (the client LLM) to detect: frequently " +
        "asked questions, common mistakes, criticism, and content the audience is requesting — a direct " +
        "signal of what sells best or what market gap exists for new content.",
      inputSchema: {
        url: z.string().url(),
        limit: z.number().int().min(10).max(300).default(80),
        refresh: z
          .boolean()
          .default(false)
          .describe("Refetch comments instead of reusing the cached result"),
      },
    },
    async ({ url, limit, refresh }) => {
      const { content, providers } = getContext();
      const provider = providers.find((p) => p.matches(url));
      if (!provider?.fetchComments || !provider.capabilities().supports.comments) {
        return json({
          error: "unsupported",
          message: "Comments are currently supported for public YouTube and Instagram content",
        });
      }
      const hash = sourceHash({ type: "url", url });
      let contentItemId = content.findIdByHash(hash);
      const repo = getCommentsRepo();

      // reuse if we already fetched them
      if (contentItemId !== null && !refresh) {
        const cached = repo.getForItem(contentItemId);
        if (cached.length > 0) {
          const fetchedAt = repo.getLastFetchedAt(contentItemId);
          return json({
            cachedFromDb: true,
            requested: limit,
            total: cached.length,
            fetchedAt,
            ageSeconds: cacheAgeSeconds(fetchedAt),
            limitations:
              cached.length < limit
                ? ["The cached result contains fewer comments than requested"]
                : [],
            comments: cached.slice(0, limit),
          });
        }
      }

      let meta;
      let fetched;
      try {
        meta = await provider.fetchMetadata(url);
        contentItemId ??= content.upsertContentItem({
          sourceType: "video",
          provider: provider.name,
          url,
          canonicalUrl: canonicalizeUrl(url),
          contentHash: hash,
          title: meta.title,
          durationSec: meta.durationSec,
          rawMetadata: meta.raw,
        });
        fetched = await provider.fetchComments(url, limit);
      } catch (err) {
        return json({
          url,
          error: "fetch_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      repo.replaceForItem(contentItemId, fetched);
      const topLevel = fetched.filter((c) => !c.parentId).length;
      const fetchedAt = new Date().toISOString();
      return json({
        video: meta.title,
        cachedFromDb: false,
        refreshed: refresh,
        requested: limit,
        total: fetched.length,
        fetchedAt,
        ageSeconds: 0,
        topLevel,
        replies: fetched.length - topLevel,
        limitations:
          fetched.length < limit ? ["The provider returned fewer comments than requested"] : [],
        comments: fetched,
        nextStep:
          "Classify: frequently asked questions / common mistakes / criticism / requested content that's missing.",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
