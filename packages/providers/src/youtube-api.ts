import { isTransientHttpError, withRetry } from "./retry.js";

const API_BASE = "https://www.googleapis.com/youtube/v3";

export interface YoutubeApiVideo {
  id: string;
  title: string;
  publishedAt: string;
  durationSec: number;
  viewCount: number;
  likeCount: number | null;
  commentCount: number | null;
  tags: string[];
}

/** "PT1H2M10S" → segundos. Formato ISO 8601 de duración que usa contentDetails.duration. */
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
          `YouTube Data API (${path}) respondió ${String(res.status)}: ${body.slice(0, 300)}`,
        );
      }
      return res.json() as Promise<Record<string, unknown>>;
    },
    { isRetryable: isTransientHttpError },
  );
}

/** Resuelve un canal (por @handle o channelId) a su playlist de "subidos" en UNA sola unidad de cuota. */
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
    throw new Error("No se pudo resolver el canal vía YouTube Data API");
  return playlistId;
}

/** IDs de video en orden de subida (más reciente primero), paginando de a 50. */
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

/** Estadísticas exactas en lotes de 50 IDs (1 unidad de cuota por lote, sin importar cuántos videos). */
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
        title: snippet.title as string,
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

/**
 * Trending oficial de YouTube (chart=mostPopular): qué está funcionando AHORA en una región/
 * categoría, más allá de un canal puntual. 1 unidad de cuota por lote de 50.
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
      title: snippet.title as string,
      publishedAt: snippet.publishedAt as string,
      durationSec: isoDurationToSeconds(details.duration as string),
      viewCount: Number(stats.viewCount ?? 0),
      likeCount: stats.likeCount !== undefined ? Number(stats.likeCount) : null,
      commentCount: stats.commentCount !== undefined ? Number(stats.commentCount) : null,
      tags: Array.isArray(snippet.tags) ? (snippet.tags as string[]) : [],
    };
  });
}
