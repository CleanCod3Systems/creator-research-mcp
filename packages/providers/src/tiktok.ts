import type {
  ChannelItem,
  ContentKind,
  ContentMetadata,
  ContentProvider,
  ProviderCapabilities,
  TextPayload,
} from "@creator-research/core";
import { textFromInfo } from "./subtitles.js";
import { downloadAudio, dumpFlatPlaylist, dumpInfo, type YtDlpInfo } from "./ytdlp.js";

const HOSTS = ["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"];

/** Videos y perfiles de TikTok vía yt-dlp. Extractor no oficial: puede romperse sin aviso. */
export class TikTokProvider implements ContentProvider {
  readonly name = "tiktok";
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
    if (/^\/@[^/]+\/?$/.test(u.pathname)) return "channel";
    // /@user/video/123, /@user/photo/123 y links cortos vm/vt.tiktok.com
    return "short";
  }

  capabilities(): ProviderCapabilities {
    return {
      reliability: "fragile",
      supports: {
        metadata: true,
        subtitles: true,
        mediaDownload: true,
        comments: false,
        channelListing: true,
      },
      legalNotes: "Extractor no oficial (yt-dlp); solo contenido público",
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
      channelName: info.channel ?? info.uploader,
      language: info.language ?? undefined,
      viewCount: info.view_count ?? undefined,
      likeCount: info.like_count ?? undefined,
      commentCount: info.comment_count ?? undefined,
      raw: info as unknown as Record<string, unknown>,
    };
  }

  async fetchText(url: string): Promise<TextPayload | null> {
    return textFromInfo(await this.info(url));
  }

  async fetchMedia(url: string, destDir: string): Promise<string | null> {
    const info = await this.info(url);
    return downloadAudio(url, destDir, info.id);
  }

  /** Lista videos de un perfil @user. strategy top = por vistas; recent = orden del perfil. */
  async listItems(url: string, strategy: "top" | "recent", n: number): Promise<ChannelItem[]> {
    const fetchLimit = strategy === "top" ? Math.max(n * 5, 30) : n;
    const entries = await dumpFlatPlaylist(url, fetchLimit);
    const items: ChannelItem[] = entries
      .filter((e) => e.id)
      .map((e) => ({
        url: e.url ?? `${url.replace(/\/$/, "")}/video/${e.id}`,
        title: e.title ?? e.id,
        durationSec: e.duration ?? undefined,
        viewCount: e.view_count ?? undefined,
      }));
    if (strategy === "top") items.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
    return items.slice(0, n);
  }
}
