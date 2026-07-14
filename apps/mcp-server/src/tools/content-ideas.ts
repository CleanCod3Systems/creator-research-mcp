import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { canonicalizeUrl, clusterBySharedTerms, sourceHash, tokenize } from "@cleancod3/core";
import { z } from "zod";
import { getCommentsRepo, getContext } from "../context.js";

interface CommentLike {
  author: string;
  text: string;
  likes: number | null;
}

export interface ContentIdea {
  mentions: number;
  totalLikes: number;
  topTerms: string[];
  examples: string[];
}

/**
 * Groups repeated audience requests/questions into ranked content ideas — deterministic TF-IDF
 * clustering (packages/core/domain/clustering.ts), no embeddings, no AI. A cluster with only one
 * member isn't a "repeated" request, so singletons are dropped rather than reported as ideas.
 */
export function buildContentIdeas(comments: CommentLike[], maxIdeas: number): ContentIdea[] {
  const texts = comments.map((c) => c.text);
  const clusters = clusterBySharedTerms(texts);
  const ideas = clusters
    .filter((c) => c.memberIndices.length >= 2)
    .map((cluster) => {
      const members = cluster.memberIndices.map((i) => comments[i]).filter((c) => c !== undefined);
      const termCounts = new Map<string, number>();
      for (const member of members) {
        for (const term of new Set(tokenize(member.text))) {
          termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
        }
      }
      const topTerms = [...termCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([term]) => term);
      const examples = [...members]
        .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
        .slice(0, 3)
        .map((m) => m.text);
      const totalLikes = members.reduce((sum, m) => sum + (m.likes ?? 0), 0);
      return { mentions: members.length, totalLikes, topTerms, examples };
    })
    .sort((a, b) => b.mentions + b.totalLikes - (a.mentions + a.totalLikes))
    .slice(0, maxIdeas);
  return ideas;
}

export function registerContentIdeasTool(server: McpServer): void {
  server.registerTool(
    "get_content_ideas",
    {
      title: "Cluster repeated audience requests into content ideas",
      description:
        "Fetches public comments (YouTube/Instagram, same source as get_comments) and groups the ones asking " +
        "for/about the same thing using deterministic TF-IDF clustering — no embeddings, no AI. Only requests " +
        "repeated by ≥2 different comments count as an idea (a single comment isn't a pattern). Ranked by how " +
        "many people asked plus total likes, so the top result is the strongest signal for what to make next.",
      inputSchema: {
        url: z.string().url(),
        limit: z.number().int().min(10).max(300).default(150),
        maxIdeas: z.number().int().min(1).max(30).default(10),
      },
    },
    async ({ url, limit, maxIdeas }) => {
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

      let comments: CommentLike[] = [];
      if (contentItemId !== null) {
        comments = repo.getForItem(contentItemId);
      }
      if (comments.length === 0) {
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
        comments = fetched.map((c) => ({ author: c.author, text: c.text, likes: c.likes ?? null }));
      }

      if (comments.length < 5) {
        return json({
          url,
          totalComments: comments.length,
          ideas: [],
          limitations: [
            "Too few comments to find a repeated pattern (need at least 5). Try get_comments to read them individually.",
          ],
        });
      }

      const ideas = buildContentIdeas(comments, maxIdeas);
      return json({
        url,
        totalComments: comments.length,
        ideas,
        limitations:
          ideas.length === 0
            ? ["No comments shared enough vocabulary to form a repeated-request cluster."]
            : [],
        hint: "topTerms are literal shared words, not a summary — read examples to judge what's actually being asked.",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
