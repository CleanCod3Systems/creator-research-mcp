import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { canonicalizeUrl, sourceHash } from "@creator-research/core";
import { z } from "zod";
import { getCommentsRepo, getContext } from "../context.js";

/**
 * Client-reasoning mode for comments: the server fetches them (yt-dlp, no API key),
 * the client LLM detects FAQs, common mistakes, criticism, and missing content.
 */
export function registerCommentsTool(server: McpServer): void {
  server.registerTool(
    "get_comments",
    {
      title: "Get comments",
      description:
        "Fetches the most relevant public comments on a video/post (YouTube, Instagram) via yt-dlp " +
        "(no API key) and persists them. Analyze them yourself (the client LLM) to detect: frequently " +
        "asked questions, common mistakes, criticism, and content the audience is requesting — a direct " +
        "signal of what sells best or what market gap exists for new content.",
      inputSchema: {
        url: z.string().url(),
        limit: z.number().int().min(10).max(300).default(80),
      },
    },
    async ({ url, limit }) => {
      const { content, providers } = getContext();
      const provider = providers.find((p) => p.matches(url));
      if (!provider?.fetchComments || !provider.capabilities().supports.comments) {
        return json({
          error: "unsupported",
          message: "Comments: YouTube/Instagram only for now",
        });
      }
      const hash = sourceHash({ type: "url", url });
      let contentItemId = content.findIdByHash(hash);
      const repo = getCommentsRepo();

      // reuse if we already fetched them
      if (contentItemId !== null) {
        const cached = repo.getForItem(contentItemId);
        if (cached.length > 0) {
          return json({
            cachedFromDb: true,
            total: cached.length,
            comments: cached.slice(0, limit),
          });
        }
      }

      const meta = await provider.fetchMetadata(url);
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
      const fetched = await provider.fetchComments(url, limit);
      repo.replaceForItem(contentItemId, fetched);
      const topLevel = fetched.filter((c) => !c.parentId).length;
      return json({
        video: meta.title,
        total: fetched.length,
        topLevel,
        replies: fetched.length - topLevel,
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
