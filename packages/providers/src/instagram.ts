import type {
  ContentKind,
  ContentMetadata,
  ContentProvider,
  ProviderCapabilities,
  SourceComment,
  TextPayload,
} from "@creator-research/core";
import { textFromInfo } from "./subtitles.js";
import { downloadAudio, dumpComments, dumpInfo, type YtDlpInfo } from "./ytdlp.js";

const HOSTS = ["instagram.com", "www.instagram.com", "m.instagram.com"];

/** Reels y posts de Instagram vía yt-dlp. Contenido con login requiere cookies del navegador. */
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
        mediaDownload: true,
        comments: true,
        channelListing: false,
      },
      legalNotes:
        'Contenido privado o con rate-limit requiere cookies: YTDLP_EXTRA_ARGS="--cookies-from-browser chrome"',
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
          "Instagram exige autenticación para este contenido. " +
            'Exportá cookies del navegador con YTDLP_EXTRA_ARGS="--cookies-from-browser chrome" ' +
            `(o firefox/safari) y reintentá. Detalle: ${msg.slice(0, 300)}`,
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
   * Instagram casi nunca expone subtítulos. En vez de devolver null (que antes descartaba
   * silenciosamente el caption real del post), se usa el caption como texto nativo: en Instagram
   * el caption ES el copy/contenido — CTAs, contexto, lo que "vende" — no una nota al margen.
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

  async fetchMedia(url: string, destDir: string): Promise<string | null> {
    const info = await this.info(url);
    return downloadAudio(url, destDir, info.id);
  }

  async fetchComments(url: string, limit: number): Promise<SourceComment[]> {
    const raw = await dumpComments(url, limit);
    return raw
      .filter((c) => c.text)
      .slice(0, limit)
      .map((c) => ({
        author: c.author ?? "anónimo",
        text: c.text ?? "",
        likes: c.like_count ?? undefined,
        parentId: c.parent && c.parent !== "root" ? c.parent : undefined,
        postedAt: c.timestamp ? new Date(c.timestamp * 1000).toISOString() : undefined,
      }));
  }
}
