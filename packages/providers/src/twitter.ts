import type {
  ContentKind,
  ContentMetadata,
  ContentProvider,
  ProviderCapabilities,
  TextPayload,
} from "@creator-research/core";
import { isTransientHttpError, withRetry } from "./retry.js";

const HOSTS = [
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "x.com",
  "www.x.com",
  "mobile.x.com",
];
const STATUS_RE = /\/[A-Za-z0-9_]+\/status(?:es)?\/(\d+)/;
const UA = "Mozilla/5.0 (compatible; CreatorResearchMCP/0.5; +https://github.com)";

interface FxTweet {
  id?: string;
  text?: string;
  lang?: string | null;
  created_timestamp?: number;
  author?: { name?: string; screen_name?: string };
  media?: { videos?: unknown[] };
  likes?: number;
  replies?: number;
  views?: number | null;
}

/** Public tweets: text via FxTwitter (public mirror, no paid API) + yt-dlp for video. */
export class TwitterProvider implements ContentProvider {
  readonly name = "twitter";
  private readonly cache = new Map<string, FxTweet>();

  matches(url: string): boolean {
    try {
      return HOSTS.includes(new URL(url).hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  classify(url: string): ContentKind {
    return STATUS_RE.test(new URL(url).pathname) ? "tweet" : "channel";
  }

  capabilities(): ProviderCapabilities {
    return {
      reliability: "fragile",
      supports: {
        metadata: true,
        subtitles: false,
        comments: false,
        channelListing: false,
      },
      legalNotes:
        "Public tweets only; text via FxTwitter, video via yt-dlp; replies out of scope",
    };
  }

  private statusId(url: string): string {
    const m = STATUS_RE.exec(new URL(url).pathname);
    if (!m?.[1]) {
      throw new Error(
        `Not a tweet URL: ${url}. X/Twitter profiles cannot be analyzed.`,
      );
    }
    return m[1];
  }

  private async tweet(url: string): Promise<FxTweet> {
    const id = this.statusId(url);
    const cached = this.cache.get(id);
    if (cached) return cached;
    const data = await withRetry(
      async () => {
        const res = await fetch(`https://api.fxtwitter.com/status/${id}`, {
          headers: { "user-agent": UA },
        });
        if (!res.ok) {
          throw new Error(
            `FxTwitter HTTP ${String(res.status)} for tweet ${id} (private or deleted?)`,
          );
        }
        return (await res.json()) as { code?: number; tweet?: FxTweet };
      },
      { isRetryable: isTransientHttpError },
    );
    if (!data.tweet) {
      throw new Error(`FxTwitter did not return tweet ${id} (code ${String(data.code ?? 0)})`);
    }
    this.cache.set(id, data.tweet);
    return data.tweet;
  }

  async fetchMetadata(url: string): Promise<ContentMetadata> {
    const t = await this.tweet(url);
    const handle = t.author?.screen_name ?? "unknown";
    return {
      externalId: t.id ?? this.statusId(url),
      title: `@${handle}: ${(t.text ?? "").slice(0, 80)}`,
      description: t.text,
      publishedAt: t.created_timestamp
        ? new Date(t.created_timestamp * 1000).toISOString().slice(0, 10)
        : undefined,
      channelName: t.author?.name,
      language: t.lang ?? undefined,
      viewCount: t.views ?? undefined,
      likeCount: t.likes,
      commentCount: t.replies,
      raw: t as unknown as Record<string, unknown>,
    };
  }

  /** Tweet with video → null (no transcription support); the tweet's text stays in metadata. */
  async fetchText(url: string): Promise<TextPayload | null> {
    const t = await this.tweet(url);
    if (t.media?.videos?.length) return null;
    if (!t.text) return null;
    return { text: t.text, source: "native_text", language: t.lang ?? undefined };
  }

}
