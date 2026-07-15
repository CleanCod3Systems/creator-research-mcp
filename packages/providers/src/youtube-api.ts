import { isTransientHttpError, withRetry } from "./retry.js";

const API_BASE = "https://www.googleapis.com/youtube/v3";

export interface YoutubeApiVideo {
  id: string;
  channelId: string;
  title: string;
  description: string;
  publishedAt: string;
  durationSec: number;
  viewCount: number;
  likeCount: number | null;
  commentCount: number | null;
  tags: string[];
}

export interface YoutubeChannelAbout {
  channelId: string;
  title: string;
  description: string;
  customUrl: string | null;
  country: string | null;
  joinedAt: string;
  subscriberCount: number | null;
  viewCount: number;
  videoCount: number;
  keywords: string[];
  thumbnailUrl: string | null;
  bannerUrl: string | null;
}

export interface YoutubeChannelStats {
  channelId: string;
  subscriberCount: number | null;
  viewCount: number;
  videoCount: number;
  avgViewsPerVideo: number | null;
}

/**
 * Parses a channel reference from the three unambiguous forms this repo accepts: a full channel
 * URL (/channel/UC... or /@handle), a bare UC... id, or a bare @handle. Anything else (legacy
 * vanity names like /c/name or /user/name) is rejected rather than guessed at, since the Data API
 * can't resolve those to a channelId directly.
 */
export function resolveChannelRef(input: string): { channelId: string } | { handle: string } {
  const trimmed = input.trim();
  try {
    const u = new URL(trimmed);
    const channelId = /^\/channel\/([^/]+)/.exec(u.pathname)?.[1];
    if (channelId) return { channelId };
    const handle = /^\/(@[^/]+)/.exec(u.pathname)?.[1];
    if (handle) return { handle };
  } catch {
    // not a URL, fall through to the bare-string forms below
  }
  if (/^UC[\w-]{22}$/.test(trimmed)) return { channelId: trimmed };
  if (trimmed.startsWith("@")) return { handle: trimmed };
  throw new Error(
    `Unrecognized channel reference "${input}". Use a full URL (https://youtube.com/@handle or ` +
      "/channel/UC...), a bare @handle, or a raw channel ID (UC...).",
  );
}

/** "PT1H2M10S" → seconds. ISO 8601 duration format used by contentDetails.duration. */
export function isoDurationToSeconds(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  const [, h, min, s] = m;
  return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

async function apiGet(
  path: string,
  params: Record<string, string>,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey);
  return withRetry(
    async () => {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `YouTube Data API (${path}) responded ${String(res.status)}: ${body.slice(0, 300)}`,
        );
      }
      return res.json() as Promise<Record<string, unknown>>;
    },
    { isRetryable: isTransientHttpError },
  );
}

/** Resolves a channel (by @handle or channelId) to its "uploads" playlist in a SINGLE quota unit. */
export async function resolveUploadsPlaylistId(
  ref: { handle: string } | { channelId: string },
  apiKey: string,
): Promise<string> {
  const params: Record<string, string> =
    "channelId" in ref
      ? { part: "contentDetails", id: ref.channelId }
      : { part: "contentDetails", forHandle: ref.handle };
  const data = await apiGet("channels", params, apiKey);
  const items = data.items as Record<string, unknown>[] | undefined;
  const uploads = (items?.[0]?.contentDetails as Record<string, unknown> | undefined)
    ?.relatedPlaylists as Record<string, unknown> | undefined;
  const playlistId = uploads?.uploads;
  if (typeof playlistId !== "string")
    throw new Error("Could not resolve the channel via YouTube Data API");
  return playlistId;
}

/** Video IDs in upload order (most recent first), paginating 50 at a time. */
export async function listUploadIds(
  playlistId: string,
  limit: number,
  apiKey: string,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < limit) {
    const params: Record<string, string> = {
      part: "contentDetails",
      playlistId,
      maxResults: String(Math.min(50, limit - ids.length)),
    };
    if (pageToken) params.pageToken = pageToken;
    const data = await apiGet("playlistItems", params, apiKey);
    const items = (data.items as Record<string, unknown>[] | undefined) ?? [];
    for (const item of items) {
      const videoId = (item.contentDetails as Record<string, unknown> | undefined)?.videoId;
      if (typeof videoId === "string") ids.push(videoId);
    }
    pageToken = typeof data.nextPageToken === "string" ? data.nextPageToken : undefined;
    if (!pageToken || items.length === 0) break;
  }
  return ids.slice(0, limit);
}

/** Exact stats in batches of 50 IDs (1 quota unit per batch, regardless of how many videos). */
export async function getVideosStats(ids: string[], apiKey: string): Promise<YoutubeApiVideo[]> {
  const out: YoutubeApiVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await apiGet(
      "videos",
      { part: "snippet,statistics,contentDetails", id: batch.join(",") },
      apiKey,
    );
    const items = (data.items as Record<string, unknown>[] | undefined) ?? [];
    for (const v of items) {
      const snippet = v.snippet as Record<string, unknown>;
      const stats = v.statistics as Record<string, unknown>;
      const details = v.contentDetails as Record<string, unknown>;
      out.push({
        id: v.id as string,
        channelId: snippet.channelId as string,
        title: snippet.title as string,
        description: (snippet.description as string | undefined) ?? "",
        publishedAt: snippet.publishedAt as string,
        durationSec: isoDurationToSeconds(details.duration as string),
        viewCount: Number(stats.viewCount ?? 0),
        likeCount: stats.likeCount !== undefined ? Number(stats.likeCount) : null,
        commentCount: stats.commentCount !== undefined ? Number(stats.commentCount) : null,
        tags: Array.isArray(snippet.tags) ? (snippet.tags as string[]) : [],
      });
    }
  }
  return out;
}

/** Full About-page metadata for one channel. 1 quota unit regardless of how many parts requested. */
export async function getChannelAbout(
  ref: { handle: string } | { channelId: string },
  apiKey: string,
): Promise<YoutubeChannelAbout | null> {
  const params: Record<string, string> =
    "channelId" in ref
      ? { part: "snippet,statistics,brandingSettings", id: ref.channelId }
      : { part: "snippet,statistics,brandingSettings", forHandle: ref.handle };
  const data = await apiGet("channels", params, apiKey);
  const item = (data.items as Record<string, unknown>[] | undefined)?.[0];
  if (!item) return null;
  const snippet = item.snippet as Record<string, unknown>;
  const stats = item.statistics as Record<string, unknown>;
  const branding = item.brandingSettings as Record<string, unknown> | undefined;
  const brandingChannel = branding?.channel as Record<string, unknown> | undefined;
  const brandingImage = branding?.image as Record<string, unknown> | undefined;
  const thumbnails = snippet.thumbnails as Record<string, Record<string, unknown>> | undefined;
  return {
    channelId: item.id as string,
    title: snippet.title as string,
    description: (snippet.description as string | undefined) ?? "",
    customUrl: (snippet.customUrl as string | undefined) ?? null,
    country: (snippet.country as string | undefined) ?? null,
    joinedAt: snippet.publishedAt as string,
    subscriberCount: stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount ?? 0),
    viewCount: Number(stats.viewCount ?? 0),
    videoCount: Number(stats.videoCount ?? 0),
    keywords:
      typeof brandingChannel?.keywords === "string"
        ? brandingChannel.keywords.split(/\s+/).filter(Boolean)
        : [],
    thumbnailUrl: (thumbnails?.high?.url as string | undefined) ?? null,
    bannerUrl: (brandingImage?.bannerExternalUrl as string | undefined) ?? null,
  };
}

/**
 * Lifetime view/video totals for many channels in one call (batches of 50, 1 quota unit each) —
 * used to approximate "this channel's typical video" as a baseline for outlier detection.
 * avgViewsPerVideo is null when videoCount is 0 (nothing to divide by).
 */
export async function getChannelsStats(
  channelIds: string[],
  apiKey: string,
): Promise<YoutubeChannelStats[]> {
  const out: YoutubeChannelStats[] = [];
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    const data = await apiGet("channels", { part: "statistics", id: batch.join(",") }, apiKey);
    const items = (data.items as Record<string, unknown>[] | undefined) ?? [];
    for (const c of items) {
      const stats = c.statistics as Record<string, unknown>;
      const videoCount = Number(stats.videoCount ?? 0);
      const viewCount = Number(stats.viewCount ?? 0);
      out.push({
        channelId: c.id as string,
        subscriberCount: stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount ?? 0),
        viewCount,
        videoCount,
        avgViewsPerVideo: videoCount > 0 ? viewCount / videoCount : null,
      });
    }
  }
  return out;
}

/**
 * Keyword search across all of YouTube (search.list), enriched with exact stats/duration via
 * videos.list. Unlike getTrendingVideos (fixed 'mostPopular' chart) this takes an arbitrary
 * query. search.list costs 100 quota units per call (vs 1 for playlist/video lookups) — a
 * fresh 10,000/day quota allows ~100 searches, so callers should keep maxResults reasonable.
 */
export async function searchVideos(
  query: string,
  opts: {
    order?: "relevance" | "date" | "rating" | "viewCount";
    videoDuration?: "any" | "short" | "medium" | "long";
    publishedAfter?: string;
    regionCode?: string;
    maxResults: number;
  },
  apiKey: string,
): Promise<YoutubeApiVideo[]> {
  const params: Record<string, string> = {
    part: "snippet",
    q: query,
    type: "video",
    order: opts.order ?? "relevance",
    videoDuration: opts.videoDuration ?? "any",
    maxResults: String(Math.min(50, opts.maxResults)),
  };
  if (opts.publishedAfter) params.publishedAfter = opts.publishedAfter;
  if (opts.regionCode) params.regionCode = opts.regionCode;
  const data = await apiGet("search", params, apiKey);
  const items = (data.items as Record<string, unknown>[] | undefined) ?? [];
  const ids = items
    .map((i) => (i.id as Record<string, unknown> | undefined)?.videoId)
    .filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return [];
  const stats = await getVideosStats(ids, apiKey);
  const byId = new Map(stats.map((v) => [v.id, v]));
  // preserve search's relevance/order ranking; skip any video videos.list didn't return (rare, e.g. deleted mid-request)
  return ids.map((id) => byId.get(id)).filter((v): v is YoutubeApiVideo => v !== undefined);
}

/**
 * Official YouTube trending (chart=mostPopular): what's working RIGHT NOW in a region/
 * category, beyond a single channel. 1 quota unit per batch of 50.
 */
export async function getTrendingVideos(
  regionCode: string,
  categoryId: string | undefined,
  maxResults: number,
  apiKey: string,
): Promise<YoutubeApiVideo[]> {
  const params: Record<string, string> = {
    part: "snippet,statistics,contentDetails",
    chart: "mostPopular",
    regionCode,
    maxResults: String(Math.min(50, maxResults)),
  };
  if (categoryId) params.videoCategoryId = categoryId;
  const data = await apiGet("videos", params, apiKey);
  const items = (data.items as Record<string, unknown>[] | undefined) ?? [];
  return items.map((v) => {
    const snippet = v.snippet as Record<string, unknown>;
    const stats = v.statistics as Record<string, unknown>;
    const details = v.contentDetails as Record<string, unknown>;
    return {
      id: v.id as string,
      channelId: snippet.channelId as string,
      title: snippet.title as string,
      description: (snippet.description as string | undefined) ?? "",
      publishedAt: snippet.publishedAt as string,
      durationSec: isoDurationToSeconds(details.duration as string),
      viewCount: Number(stats.viewCount ?? 0),
      likeCount: stats.likeCount !== undefined ? Number(stats.likeCount) : null,
      commentCount: stats.commentCount !== undefined ? Number(stats.commentCount) : null,
      tags: Array.isArray(snippet.tags) ? (snippet.tags as string[]) : [],
    };
  });
}
