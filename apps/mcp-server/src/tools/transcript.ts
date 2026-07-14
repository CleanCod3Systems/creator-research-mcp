import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { canonicalizeUrl, sourceHash, type SourceRef } from "@cleancod3/core";
import { z } from "zod";
import { getContext, getMetricsRepo } from "../context.js";

const MAX_CHARS_DEFAULT = 80_000;
const MAX_BATCH = 15;

/**
 * Client-reasoning mode: no AI engine of its own.
 * The server extracts transcript+metadata (yt-dlp) and the client LLM
 * (Claude/ChatGPT) does the analysis in the conversation.
 * Complement: save_analysis persists that analysis for future search/comparison.
 */
export function registerGetTranscriptTool(server: McpServer): void {
  server.registerTool(
    "get_transcript",
    {
      title: "Get transcript",
      description:
        "Extracts metadata, engagement (views/likes/comments), and text from a source (video with subtitles, " +
        "tweet, Instagram/LinkedIn post, web article, PDF, md/txt file) WITHOUT its own AI engine: you " +
        "(the client LLM) analyze the text in the conversation. " +
        `Pass 'urls' (up to ${String(MAX_BATCH)}) instead of 'url' to fetch several sources in a single ` +
        "call — useful for Instagram/Twitter, where there's no automatic profile listing and you have to paste " +
        "individual posts. After analyzing, save the result with save_analysis. Long transcripts: use offset. " +
        "If you draft a script from this transcript, ground the voice in real reference material instead of " +
        "generic AI style: pull a few more transcripts from the same creator (get_transcript on other videos, " +
        "or search_knowledge) to see how they actually phrase things, and use any memory you have of their " +
        "established voice from earlier in this conversation. Then vary sentence length, use active voice, " +
        "drop AI-cliché words (delve, tapestry, moreover, furthermore, in conclusion), and keep one concrete " +
        "example/anecdote rather than a list of abstractions.",
      inputSchema: {
        url: z.string().url().optional(),
        urls: z
          .array(z.string().url())
          .min(1)
          .max(MAX_BATCH)
          .optional()
          .describe("Several URLs in a single call"),
        filePath: z.string().optional().describe("File path on the server's disk"),
        offset: z.number().int().min(0).default(0),
        maxChars: z.number().int().min(1000).max(200_000).default(MAX_CHARS_DEFAULT),
      },
    },
    async ({ url, urls, filePath, offset, maxChars }) => {
      const provided = [url, urls, filePath].filter((v) => v !== undefined).length;
      if (provided !== 1) {
        return json({
          error: "bad_request",
          message: "Pass exactly one: url, urls, or filePath",
        });
      }
      if (urls) {
        const results = await Promise.all(urls.map((u) => fetchOne({ url: u }, offset, maxChars)));
        return json({ batch: true, count: results.length, results });
      }
      const single = await fetchOne({ url, filePath }, offset, maxChars);
      return json(single);
    },
  );
}

async function fetchOne(
  ref: { url?: string; filePath?: string },
  offset: number,
  maxChars: number,
): Promise<Record<string, unknown>> {
  const { content, providers } = getContext();
  const source: SourceRef = ref.url
    ? { type: "url", url: ref.url }
    : { type: "file", filePath: ref.filePath ?? "" };
  const target = ref.url ?? ref.filePath ?? "";
  const provider = providers.find((p) => p.matches(target));
  if (!provider) {
    return {
      url: ref.url,
      error: "unsupported_source",
      hint: "Check capabilities to see supported sources",
    };
  }
  let kind;
  try {
    kind = provider.classify(target);
  } catch (err) {
    return {
      url: ref.url,
      error: "unrecognized_url",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (kind === "channel" || kind === "playlist") {
    return {
      url: ref.url,
      error: "unsupported_kind",
      kind,
      hint: "For channels use list_videos; playlists aren't supported yet",
    };
  }

  const hash = sourceHash(source);

  // reuse: if we already extracted this transcript, don't call yt-dlp again
  const existingId = content.findIdByHash(hash);
  const cached = existingId !== null ? content.getTranscript(existingId) : null;
  if (cached) {
    return page(
      { url: ref.url, title: null, transcript: cached, cachedFromDb: true },
      offset,
      maxChars,
    );
  }

  // in batch, one URL that fails (e.g. Instagram with rate-limit) can't bring down the others
  let meta;
  let text;
  try {
    meta = await provider.fetchMetadata(target);
    text = await provider.fetchText(target);
  } catch (err) {
    return {
      url: ref.url,
      error: "fetch_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (!text) {
    return {
      url: ref.url,
      error: "no_text_available",
      message:
        "The source has no direct text (no subtitles, no extractable article). Try another video/URL.",
    };
  }
  const contentItemId = content.upsertContentItem({
    sourceType:
      kind === "short"
        ? "short"
        : kind === "article"
          ? "article"
          : kind === "pdf"
            ? "pdf"
            : kind === "file"
              ? "file"
              : "video",
    provider: provider.name,
    url: ref.url,
    filePath: ref.filePath,
    canonicalUrl: ref.url ? canonicalizeUrl(ref.url) : undefined,
    contentHash: hash,
    title: meta.title,
    description: meta.description,
    durationSec: meta.durationSec,
    publishedAt: meta.publishedAt,
    language: meta.language,
    rawMetadata: meta.raw,
  });
  content.insertTranscript({
    contentItemId,
    source: text.source,
    language: text.language,
    text: text.text,
    segments: text.segments,
  });
  if (
    meta.viewCount !== undefined ||
    meta.likeCount !== undefined ||
    meta.commentCount !== undefined
  ) {
    getMetricsRepo().recordSnapshot(
      contentItemId,
      {
        viewCount: meta.viewCount ?? null,
        likeCount: meta.likeCount ?? null,
        commentCount: meta.commentCount ?? null,
      },
      provider.name,
    );
  }

  return page(
    {
      url: ref.url,
      title: meta.title,
      channel: meta.channelName,
      durationSec: meta.durationSec,
      publishedAt: meta.publishedAt ?? null,
      views: meta.viewCount ?? null,
      likes: meta.likeCount ?? null,
      comments: meta.commentCount ?? null,
      transcript: { text: text.text, source: text.source, language: text.language },
      nextStep:
        "Analyze this transcript (summary, technologies, practices, syllabus...) and persist the result with save_analysis(url, facets).",
    },
    offset,
    maxChars,
  );
}

interface Pageable {
  transcript: { text: string; source: string; language: string | null | undefined };
  [k: string]: unknown;
}

function page(payload: Pageable, offset: number, maxChars: number): Record<string, unknown> {
  const full = payload.transcript.text;
  const slice = full.slice(offset, offset + maxChars);
  return {
    ...payload,
    transcript: { ...payload.transcript, text: slice },
    pagination: {
      offset,
      returnedChars: slice.length,
      totalChars: full.length,
      hasMore: offset + maxChars < full.length,
      nextOffset: offset + maxChars < full.length ? offset + maxChars : null,
    },
  };
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
