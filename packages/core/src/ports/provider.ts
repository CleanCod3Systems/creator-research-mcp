import type { ContentKind } from "../domain/content.js";

export type Reliability = "stable" | "fragile" | "manual_only";

export interface ProviderCapabilities {
  reliability: Reliability;
  supports: {
    metadata: boolean;
    subtitles: boolean;
    mediaDownload: boolean;
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
  /** Métricas de engagement, cuando el provider las tiene a mano (no requiere llamado extra). */
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  raw: Record<string, unknown>;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TextPayload {
  text: string;
  segments?: TranscriptSegment[];
  source: "subtitles_manual" | "subtitles_auto" | "whisper" | "native_text";
  language?: string;
}

export interface ContentProvider {
  readonly name: string;
  matches(url: string): boolean;
  classify(url: string): ContentKind;
  capabilities(): ProviderCapabilities;
  fetchMetadata(url: string): Promise<ContentMetadata>;
  /** Subtítulos/texto nativo. null = no disponible → el pipeline decide transcribir. */
  fetchText(url: string): Promise<TextPayload | null>;
  /** Descarga audio/video a un path local. null = no soportado. */
  fetchMedia(url: string, destDir: string): Promise<string | null>;
  /** Lista items de un canal/playlist (si el provider lo soporta). */
  listItems?(url: string, strategy: "top" | "recent", n: number): Promise<ChannelItem[]>;
  /** Comentarios públicos (si el provider lo soporta). */
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
  /** Solo disponible vía YouTube Data API (YOUTUBE_API_KEY); yt-dlp no lo expone de forma confiable. */
  likeCount?: number;
  commentCount?: number;
  publishedAt?: string;
  /** Tags que el creador le puso al video (SEO). Solo vía YouTube Data API. */
  tags?: string[];
}
