import type {
  ContentKind,
  ContentMetadata,
  ContentProvider,
  ProviderCapabilities,
  SourceComment,
  TextPayload,
} from "@creator-research/core";
import { textFromInfo } from "./subtitles.js";
import { dumpComments, dumpInfo, type YtDlpInfo } from "./ytdlp.js";

const HOSTS = ["instagram.com", "www.instagram.com", "m.instagram.com"];

/** Instagram reels and posts via yt-dlp. Content requiring login needs browser cookies. */
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
    const u = new URL(url);
    if (/^\/(reel|reels|stories)\//.test(u.pathname)) return "short";
    if (/^\/(p|tv)\//.test(u.pathname)) return "video";
    // /username/reel/... etc.
    if (/^\/[^/]+\/(reel|reels)\//.test(u.pathname)) return "short";
    if (/^\/[^/]+\/(p|tv)\//.test(u.pathname)) return "video";
    return "channel";
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
        'Private or rate-limited content requires cookies: YTDLP_EXTRA_ARGS="--cookies-from-browser chrome"',
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
        throw new Error(
          "Instagram requires authentication for this content. " +
            'Export browser cookies with YTDLP_EXTRA_ARGS="--cookies-from-browser chrome" ' +
            `(or firefox/safari) and retry. Detail: ${msg.slice(0, 300)}`,
        );
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
      raw: info as unknown as Record<string, unknown>,
    };
  }

  /**
   * Instagram almost never exposes subtitles. Instead of returning null (which used to silently
   * discard the post's actual caption), the caption is used as native text: on Instagram
   * the caption IS the copy/content — CTAs, context, what "sells" — not a marginal note.
   */
  async fetchText(url: string): Promise<TextPayload | null> {
    const subs = await textFromInfo(await this.info(url));
    if (subs) return subs;
    const info = await this.info(url);
    if (!info.description?.trim()) return null;
    return {
      text: info.description.trim(),
      source: "native_text",
      language: info.language ?? undefined,
    };
  }

  async fetchComments(url: string, limit: number): Promise<SourceComment[]> {
    const raw = await dumpComments(url, limit);
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
