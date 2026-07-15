import type {
  ChannelItem,
  SourceComment,
  ContentKind,
  ContentMetadata,
  ContentProvider,
  ProviderCapabilities,
  TextPayload,
} from "@cleancod3/core";
import {
  dumpComments,
  dumpFlatPlaylist,
  dumpInfo,
  pickFallbackAudioFormat,
  type YtDlpInfo,
} from "./ytdlp.js";
import { textFromInfo } from "./subtitles.js";
import { getVideosStats, listUploadIds, resolveUploadsPlaylistId } from "./youtube-api.js";

const HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"];

// single-segment paths that are NOT a vanity channel (/watch, /results, etc)
const RESERVED_PATH_SEGMENTS = new Set([
  "watch",
  "shorts",
  "playlist",
  "results",
  "feed",
  "embed",
  "v",
  "live",
  "clip",
  "hashtag",
  "gaming",
  "premium",
  "upload",
  "account",
  "logout",
  "post",
]);

// valid channel tabs: /@handle/videos, /c/name/streams, etc
const CHANNEL_TABS = new Set([
  "videos",
  "shorts",
  "streams",
  "playlists",
  "community",
  "about",
  "featured",
  "live",
]);

const CHANNEL_PREFIX_RE = /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/i;

/**
 * YouTube has 4 prefixed channel URL formats (/@handle, /channel/UCxxx, /c/Name,
 * /user/Name) PLUS the legacy unprefixed one (/Name, e.g. youtube.com/midudev), any of
 * them with or without a trailing tab (/videos, /streams, /about...). The legacy format is
 * ambiguous with any 1-2 segment path, so youtu.be is excluded (there /xxx is ALWAYS a video)
 * along with YouTube's reserved paths (/watch, /results, /embed, etc).
 */
function isChannelPath(hostname: string, pathname: string): boolean {
  if (hostname === "youtu.be") return false;
  if (CHANNEL_PREFIX_RE.test(pathname)) return true;
  const [first, second, ...rest] = pathname.split("/").filter(Boolean);
  if (!first || RESERVED_PATH_SEGMENTS.has(first.toLowerCase())) return false;
  if (!second) return true; // /name
  return rest.length === 0 && CHANNEL_TABS.has(second.toLowerCase()); // /name/videos
}

export class YouTubeProvider implements ContentProvider {
  readonly name = "youtube";
  private readonly infoCache = new Map<string, YtDlpInfo>();

  matches(url: string): boolean {
    try {
      return HOSTS.includes(new URL(url).hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  /**
   * Never falls back to a silent default: if no known format matches, it throws an
   * explicit error instead of assuming "video" (this is how the /midudev bug was caught).
   */
  classify(url: string): ContentKind {
    const u = new URL(url);
    const hostname = u.hostname.toLowerCase();
    const pathname = u.pathname;

    if (hostname === "youtu.be") return "video"; // youtu.be/<id> is always a video
    if (pathname.startsWith("/shorts/")) return "short";
    if (pathname === "/watch" || pathname.startsWith("/embed/") || pathname.startsWith("/v/"))
      return "video";
    if (/^\/live\/[^/]+$/.test(pathname)) return "video"; // waiting room for a specific livestream
    if (pathname === "/playlist") return "playlist";
    if (isChannelPath(hostname, pathname)) return "channel";

    throw new Error(
      `Unrecognized YouTube URL format (${pathname}). Supported formats: ` +
        "video (/watch, youtu.be/ID, /embed/ID, /live/ID), short (/shorts/ID), " +
        "channel (/@handle, /channel/ID, /c/name, /user/name, or legacy vanity /name), and playlist (/playlist).",
    );
  }

  capabilities(): ProviderCapabilities {
    return {
      reliability: "stable",
      supports: {
        metadata: true,
        subtitles: true,
        comments: true,
        channelListing: true,
      },
    };
  }

  private async info(url: string): Promise<YtDlpInfo> {
    const cached = this.infoCache.get(url);
    if (cached) return cached;
    const info = await dumpInfo(url);
    this.infoCache.set(url, info);
    return info;
  }

  async fetchMetadata(url: string): Promise<ContentMetadata> {
    const info = await this.info(url);
    return {
      externalId: info.id,
      title: info.title,
      description: info.description,
      durationSec: info.duration,
      publishedAt: info.upload_date
        ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`
        : undefined,
      channelName: info.channel,
      language: info.language ?? undefined,
      viewCount: info.view_count ?? undefined,
      likeCount: info.like_count ?? undefined,
      commentCount: info.comment_count ?? undefined,
      authorHandle: info.channel,
      authorId: info.channel_id,
      authorUrl: info.uploader_url,
      thumbnailUrl: info.thumbnail,
      mediaType: info.media_type,
      availability: info.availability,
      width: info.width ?? undefined,
      height: info.height ?? undefined,
      fps: info.fps ?? undefined,
      resolution: info.resolution ?? undefined,
      audioUrl: pickFallbackAudioFormat(info.formats)?.url,
      raw: info as unknown as Record<string, unknown>,
    };
  }

  /** Priority: manual subs > auto-captions. Language: video's own > es > en > first available. */
  async fetchText(url: string): Promise<TextPayload | null> {
    return textFromInfo(await this.info(url));
  }

  async fetchComments(url: string, limit: number): Promise<SourceComment[]> {
    const raw = await dumpComments(url, limit);
    return raw
      .filter((c) => c.text)
      .map((c) => ({
        author: c.author ?? "anonymous",
        text: c.text ?? "",
        likes: c.like_count ?? undefined,
        parentId: c.parent && c.parent !== "root" ? c.parent : undefined,
        postedAt: c.timestamp ? new Date(c.timestamp * 1000).toISOString() : undefined,
      }));
  }

  /** Lists channel videos: strategy recent = upload order; top = by views. */
  /** Lists channel videos: strategy recent = upload order; top = by views. */
  async listItems(url: string, strategy: "top" | "recent", n: number): Promise<ChannelItem[]> {
    const u = new URL(url);
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (apiKey) {
      const ref = this.apiChannelRef(u);
      if (ref) {
        try {
          return await this.listItemsViaApi(ref, strategy, n, apiKey);
        } catch {
          // invalid key, quota exhausted, channel not resolvable by this method: silent fallback to yt-dlp
        }
      }
    }
    // channel without a tab → /videos tab (uploads); playlists stay as-is
    const isChannel = isChannelPath(u.hostname.toLowerCase(), u.pathname);
    const hasTab = /\/(videos|shorts|streams)$/.test(u.pathname);
    const target = isChannel && !hasTab ? `${url.replace(/\/$/, "")}/videos` : url;
    // for "top" we request more entries and sort by views
    const fetchLimit = strategy === "top" ? Math.max(n * 5, 30) : n;
    const entries = await dumpFlatPlaylist(target, fetchLimit);
    const items: ChannelItem[] = entries
      .filter((e) => e.id)
      .map((e) => ({
        url: e.url ?? `https://www.youtube.com/watch?v=${e.id}`,
        title: e.title ?? e.id,
        durationSec: e.duration ?? undefined,
        viewCount: e.view_count ?? undefined,
      }));
    if (strategy === "top") items.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
    return items.slice(0, n);
  }

  /** Only /@handle and /channel/ID: the two formats the API resolves directly, unambiguously. */
  private apiChannelRef(u: URL): { handle: string } | { channelId: string } | null {
    const channelId = /^\/channel\/([^/]+)/.exec(u.pathname)?.[1];
    if (channelId) return { channelId };
    const handle = /^\/(@[^/]+)/.exec(u.pathname)?.[1];
    if (handle) return { handle };
    return null;
  }

  private async listItemsViaApi(
    ref: { handle: string } | { channelId: string },
    strategy: "top" | "recent",
    n: number,
    apiKey: string,
  ): Promise<ChannelItem[]> {
    const uploadsPlaylistId = await resolveUploadsPlaylistId(ref, apiKey);
    const fetchLimit = strategy === "top" ? Math.max(n * 5, 30) : n;
    const ids = await listUploadIds(uploadsPlaylistId, fetchLimit, apiKey);
    const videos = await getVideosStats(ids, apiKey);
    const items: ChannelItem[] = videos.map((v) => ({
      url: `https://www.youtube.com/watch?v=${v.id}`,
      title: v.title,
      durationSec: v.durationSec,
      viewCount: v.viewCount,
      likeCount: v.likeCount ?? undefined,
      commentCount: v.commentCount ?? undefined,
      publishedAt: v.publishedAt,
      tags: v.tags,
    }));
    if (strategy === "top") items.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
    return items.slice(0, n);
  }
}
