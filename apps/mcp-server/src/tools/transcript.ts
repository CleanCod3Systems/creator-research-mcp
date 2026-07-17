import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  canonicalizeUrl,
  sourceHash,
  type ContentMetadata,
  type RelatedMediaItem,
  type SourceRef,
} from "@cleancod3/core";
import { z } from "zod";
import { cacheAgeSeconds } from "../cache.js";
import { getContext, getMetricsRepo, getProfileRepo } from "../context.js";

const MAX_CHARS_DEFAULT = 80_000;
const MAX_BATCH = 15;
const NORMALIZED_METADATA_KEY = "_creatorResearchMetadata";

export interface MetadataDetails {
  authorHandle: string | null;
  authorId: string | null;
  authorUrl: string | null;
  thumbnailUrl: string | null;
  mediaType: string | null;
  availability: string | null;
  mediaItems: RelatedMediaItem[] | null;
  isCarousel: boolean | null;
  itemCount: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  resolution: string | null;
  audioUrl: string | null;
  fetchedAt: string | null;
}

export function buildMetadataDetails(
  meta: Partial<ContentMetadata>,
  fetchedAt: string | null = null,
): MetadataDetails {
  return {
    authorHandle: meta.authorHandle ?? null,
    authorId: meta.authorId ?? null,
    authorUrl: meta.authorUrl ?? null,
    thumbnailUrl: meta.thumbnailUrl ?? null,
    mediaType: meta.mediaType ?? null,
    availability: meta.availability ?? null,
    mediaItems: meta.mediaItems ?? null,
    isCarousel: meta.isCarousel ?? null,
    itemCount: meta.itemCount ?? null,
    width: meta.width ?? null,
    height: meta.height ?? null,
    fps: meta.fps ?? null,
    resolution: meta.resolution ?? null,
    audioUrl: meta.audioUrl ?? null,
    fetchedAt,
  };
}

export function buildMetadataLimitations(meta: Partial<ContentMetadata>): string[] {
  const limitations = [...(meta.limitations ?? [])];
  if (meta.viewCount === undefined) limitations.push("The provider did not expose a view count");
  if (meta.likeCount === undefined) limitations.push("The provider did not expose a like count");
  if (meta.commentCount === undefined) {
    limitations.push("The provider did not expose a comment count");
  }
  return [...new Set(limitations)];
}

function cachedMetadataDetails(rawMetadata: unknown): MetadataDetails | null {
  if (!rawMetadata || typeof rawMetadata !== "object") return null;
  const raw = rawMetadata as Record<string, unknown>;
  const normalized = raw[NORMALIZED_METADATA_KEY];
  if (!normalized || typeof normalized !== "object") return null;
  return normalized as MetadataDetails;
}

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
        "Extracts metadata, engagement (views/likes/comments), author details, thumbnails, carousel items, and text from a source (video with subtitles, " +
        "tweet, Instagram/LinkedIn post, web article, PDF, md/txt file) WITHOUT its own AI engine: you " +
        "(the client LLM) analyze the text in the conversation. " +
        `Pass 'urls' (up to ${String(MAX_BATCH)}) instead of 'url' to fetch several sources in a single ` +
        "call — useful for Instagram/Twitter, where there's no automatic profile listing and you have to paste " +
        "individual posts. Set refresh=true when the cached result is stale. After analyzing, save the result with save_analysis. Long transcripts: use offset. " +
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
        refresh: z
          .boolean()
          .default(false)
          .describe("Refetch the source instead of reusing the cached result"),
      },
    },
    async ({ url, urls, filePath, offset, maxChars, refresh }) => {
      const provided = [url, urls, filePath].filter((v) => v !== undefined).length;
      if (provided !== 1) {
        return json({
          error: "bad_request",
          message: "Pass exactly one: url, urls, or filePath",
        });
      }
      if (urls) {
        const results = await Promise.all(
          urls.map((u) => fetchOne({ url: u }, offset, maxChars, refresh)),
        );
        return json({ batch: true, count: results.length, results });
      }
      const single = await fetchOne({ url, filePath }, offset, maxChars, refresh);
      return json(single);
    },
  );
}

async function fetchOne(
  ref: { url?: string; filePath?: string },
  offset: number,
  maxChars: number,
  refresh: boolean,
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
  if (cached && !refresh) {
    const cachedItem = existingId === null ? null : content.getItem(existingId);
    const cachedMetadata = cachedMetadataDetails(cachedItem?.rawMetadata);
    return page(
      {
        url: ref.url,
        title: cachedItem?.title ?? null,
        transcript: cached,
        cachedFromDb: true,
        metadata: cachedMetadata,
        cache: {
          hit: true,
          fetchedAt: cachedMetadata?.fetchedAt ?? null,
          ageSeconds: cacheAgeSeconds(cachedMetadata?.fetchedAt),
        },
        limitations: cachedMetadata
          ? []
          : ["This cached transcript predates normalized metadata; refetch to refresh its details"],
      },
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
  const creatorId = getProfileRepo().ensureCreatorFromMetadata(provider.name, meta);
  if (!text) {
    if (!meta.audioUrl) {
      return {
        url: ref.url,
        error: "no_text_available",
        message:
          "The source has no direct text (no subtitles, no extractable article). Try another video/URL.",
      };
    }
    const cacheFetchedAt = new Date().toISOString();
    const contentItemId = content.upsertContentItem({
      sourceType: kind === "short" ? "short" : "video",
      provider: provider.name,
      url: ref.url,
      filePath: ref.filePath,
      canonicalUrl: ref.url ? canonicalizeUrl(ref.url) : undefined,
      contentHash: hash,
      creatorId: creatorId ?? undefined,
      title: meta.title,
      description: meta.description,
      durationSec: meta.durationSec,
      publishedAt: meta.publishedAt,
      language: meta.language,
      rawMetadata: {
        ...meta.raw,
        [NORMALIZED_METADATA_KEY]: buildMetadataDetails(meta, cacheFetchedAt),
      },
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
    return {
      url: ref.url,
      error: "no_text_available",
      message:
        "No captions/subtitles were found, but an audio_url is provided so you (the client) can " +
        "transcribe it yourself if you want a transcript.",
      audioUrl: meta.audioUrl,
      title: meta.title,
      metadata: buildMetadataDetails(meta, cacheFetchedAt),
      limitations: [
        ...buildMetadataLimitations(meta),
        "audio_url is best-effort: it's a signed URL from the source platform that typically expires " +
          "within hours, and may require the original request's headers/IP to be fetchable from a " +
          "different network. This server never transcribes it itself.",
      ],
    };
  }
  const cacheFetchedAt = new Date().toISOString();
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
    creatorId: creatorId ?? undefined,
    title: meta.title,
    description: meta.description,
    durationSec: meta.durationSec,
    publishedAt: meta.publishedAt,
    language: meta.language,
    rawMetadata: {
      ...meta.raw,
      [NORMALIZED_METADATA_KEY]: buildMetadataDetails(meta, cacheFetchedAt),
    },
  });
  content.updateContentItem(contentItemId, {
    title: meta.title,
    description: meta.description,
    durationSec: meta.durationSec,
    publishedAt: meta.publishedAt,
    language: meta.language,
    rawMetadata: {
      ...meta.raw,
      [NORMALIZED_METADATA_KEY]: buildMetadataDetails(meta, cacheFetchedAt),
    },
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
      metadata: buildMetadataDetails(meta, cacheFetchedAt),
      cache: { hit: false, refreshed: refresh, fetchedAt: cacheFetchedAt, ageSeconds: 0 },
      limitations: buildMetadataLimitations(meta),
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
