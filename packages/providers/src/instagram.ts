import type {
  ContentKind,
  ContentMetadata,
  ContentProvider,
  ProviderCapabilities,
  RelatedMediaItem,
  TextPayload,
} from "@cleancod3/core";
import { textFromInfo } from "./subtitles.js";
import { dumpComments, dumpInfo, pickFallbackAudioFormat, type YtDlpInfo } from "./ytdlp.js";

const HOSTS = ["instagram.com", "www.instagram.com", "m.instagram.com"];

/** Public Instagram posts and reels via yt-dlp. Authentication is never requested or bypassed. */
export class InstagramProvider implements ContentProvider {
  readonly name = "instagram";
  private readonly infoCache = new Map<string, YtDlpInfo>();

  matches(url: string): boolean {
    try {
      return HOSTS.includes(new URL(url).hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  classify(url: string): ContentKind {
    return classifyInstagramPath(new URL(url).pathname);
  }

  capabilities(): ProviderCapabilities {
    return {
      reliability: "fragile",
      supports: {
        metadata: true,
        subtitles: false,
        comments: true,
        channelListing: false,
      },
      legalNotes:
        "Public content only; comments are best-effort and authentication is never requested or bypassed.",
    };
  }

  private async info(url: string): Promise<YtDlpInfo> {
    const cached = this.infoCache.get(url);
    if (cached) return cached;
    try {
      const info = await dumpInfo(url);
      this.infoCache.set(url, info);
      return info;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/login|cookies|rate.?limit|401|403|not available/i.test(msg)) {
        throw new Error(instagramAccessErrorMessage(msg));
      }
      throw err;
    }
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
      channelName: info.channel ?? info.uploader,
      language: info.language ?? undefined,
      viewCount: info.view_count ?? undefined,
      likeCount: info.like_count ?? undefined,
      commentCount: info.comment_count ?? undefined,
      authorHandle: info.channel,
      authorId: info.uploader_id,
      authorUrl: info.uploader_url ?? instagramProfileUrl(info.channel),
      thumbnailUrl: info.thumbnail,
      mediaType: info.media_type,
      availability: info.availability,
      width: info.width ?? undefined,
      height: info.height ?? undefined,
      fps: info.fps ?? undefined,
      resolution: info.resolution ?? undefined,
      audioUrl: pickFallbackAudioFormat(info.formats)?.url,
      mediaItems: relatedMediaItems(info.entries),
      isCarousel: info.entries ? info.entries.length > 1 : undefined,
      itemCount: info.entries?.length,
      limitations: instagramMetadataLimitations(url, info),
      raw: info as unknown as Record<string, unknown>,
    };
  }

  /**
   * Instagram almost never exposes subtitles. Instead of returning null (which used to silently
   * discard the post's actual caption), the caption is used as native text: on Instagram
   * the caption IS the copy/content — CTAs, context, what "sells" — not a marginal note.
   */
  async fetchText(url: string): Promise<TextPayload | null> {
    const info = await this.info(url);
    const subs = await textFromInfo(info);
    if (subs) return subs;
    return captionToText(info);
  }

  async fetchComments(url: string, limit: number) {
    const raw = await dumpComments(url, limit, "instagram");
    return raw
      .filter((c) => c.text)
      .slice(0, limit)
      .map((c) => ({
        author: c.author ?? "anonymous",
        text: c.text ?? "",
        likes: c.like_count ?? undefined,
        parentId: c.parent && c.parent !== "root" ? c.parent : undefined,
        postedAt: c.timestamp ? new Date(c.timestamp * 1000).toISOString() : undefined,
      }));
  }
}

function instagramProfileUrl(handle?: string): string | undefined {
  return handle ? `https://www.instagram.com/${handle}/` : undefined;
}

export function relatedMediaItems(entries?: YtDlpInfo["entries"]): RelatedMediaItem[] | undefined {
  if (!entries?.length) return undefined;
  return entries.map((entry) => ({
    externalId: entry.id,
    url: entry.webpage_url,
    title: entry.title,
    durationSec: entry.duration ?? undefined,
    thumbnailUrl: entry.thumbnail,
    mediaType: entry.media_type,
    viewCount: entry.view_count ?? undefined,
    likeCount: entry.like_count ?? undefined,
    commentCount: entry.comment_count ?? undefined,
  }));
}

function instagramMetadataLimitations(url: string, info: YtDlpInfo): string[] {
  const limitations: string[] = [];
  const pathname = new URL(url).pathname;
  if (pathname.startsWith("/stories/")) {
    limitations.push(
      "Instagram stories and highlights may expire or become inaccessible after extraction",
    );
  }
  if (info.view_count == null) limitations.push("The provider did not expose a view count");
  if (info.like_count == null) limitations.push("The provider did not expose a like count");
  if (info.comment_count == null) {
    limitations.push("The provider did not expose a comment count");
  }
  return limitations;
}

export function classifyInstagramPath(pathname: string): ContentKind {
  if (/^\/(reel|reels|stories)\//.test(pathname)) return "short";
  if (/^\/(p|tv)\//.test(pathname)) return "video";
  // /username/reel/... and /username/p/... are also valid Instagram URL shapes.
  if (/^\/[^/]+\/(reel|reels)\//.test(pathname)) return "short";
  if (/^\/[^/]+\/(p|tv)\//.test(pathname)) return "video";
  return "channel";
}

export function captionToText(
  info: Pick<YtDlpInfo, "description" | "language">,
): TextPayload | null {
  const caption = info.description?.trim();
  if (!caption) return null;
  return {
    text: caption,
    source: "native_text",
    language: info.language ?? undefined,
  };
}

export function instagramAccessErrorMessage(detail: string): string {
  return (
    "Instagram content is not publicly accessible or is currently rate-limited. " +
    "The server only supports public content and does not request credentials, export cookies, " +
    `or bypass login. Detail: ${detail.slice(0, 300)}`
  );
}
