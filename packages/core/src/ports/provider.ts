import type { ContentKind } from "../domain/content.js";

export type Reliability = "stable" | "fragile" | "manual_only";

export interface ProviderCapabilities {
  reliability: Reliability;
  supports: {
    metadata: boolean;
    subtitles: boolean;
    comments: boolean;
    channelListing: boolean;
  };
  legalNotes?: string;
}

export interface ContentMetadata {
  externalId: string;
  title: string;
  description?: string;
  durationSec?: number;
  publishedAt?: string;
  channelName?: string;
  language?: string;
  /** Engagement metrics, when the provider has them at hand (no extra call needed). */
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  authorHandle?: string;
  authorId?: string;
  authorUrl?: string;
  thumbnailUrl?: string;
  mediaType?: string;
  availability?: string;
  mediaItems?: RelatedMediaItem[];
  isCarousel?: boolean;
  itemCount?: number;
  /** Video technical metadata, when the provider has it at hand (yt-dlp-backed providers). */
  width?: number;
  height?: number;
  fps?: number;
  resolution?: string;
  /**
   * Best-effort audio-only stream URL, provided when there's no transcript available so the
   * client can fetch/transcribe it itself. Best-effort only: yt-dlp-signed URLs typically expire
   * within hours and may require the original request headers/IP to be fetchable.
   */
  audioUrl?: string;
  limitations?: string[];
  raw: Record<string, unknown>;
}

export interface RelatedMediaItem {
  externalId: string;
  url?: string;
  title?: string;
  durationSec?: number;
  thumbnailUrl?: string;
  mediaType?: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TextPayload {
  text: string;
  segments?: TranscriptSegment[];
  source: "subtitles_manual" | "subtitles_auto" | "native_text";
  language?: string;
}

export interface ContentProvider {
  readonly name: string;
  matches(url: string): boolean;
  classify(url: string): ContentKind;
  capabilities(): ProviderCapabilities;
  fetchMetadata(url: string): Promise<ContentMetadata>;
  /** Native subtitles/text. null = not available. */
  fetchText(url: string): Promise<TextPayload | null>;
  /** Lists items of a channel/playlist (if the provider supports it). */
  listItems?(url: string, strategy: "top" | "recent", n: number): Promise<ChannelItem[]>;
  /** Public comments (if the provider supports it). */
  fetchComments?(url: string, limit: number): Promise<SourceComment[]>;
}

export interface SourceComment {
  author: string;
  text: string;
  likes?: number;
  parentId?: string;
  postedAt?: string;
}

export interface ChannelItem {
  url: string;
  title: string;
  durationSec?: number;
  viewCount?: number;
  /** Only available via the YouTube Data API (YOUTUBE_API_KEY); yt-dlp doesn't expose it reliably. */
  likeCount?: number;
  commentCount?: number;
  publishedAt?: string;
  /** Tags the creator put on the video (SEO). Only via the YouTube Data API. */
  tags?: string[];
}
