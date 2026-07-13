import type {
  ChannelItem,
  SourceComment,
  ContentKind,
  ContentMetadata,
  ContentProvider,
  ProviderCapabilities,
  TextPayload,
} from "@creator-research/core";
import {
  downloadAudio,
  dumpComments,
  dumpFlatPlaylist,
  dumpInfo,
  type YtDlpInfo,
} from "./ytdlp.js";
import { textFromInfo } from "./subtitles.js";
import { getVideosStats, listUploadIds, resolveUploadsPlaylistId } from "./youtube-api.js";

const HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"];

// paths de un solo segmento que NO son un canal vanity (/watch, /results, etc)
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

// pestañas válidas de un canal: /@handle/videos, /c/nombre/streams, etc
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
 * YouTube tiene 4 formatos de URL de canal con prefijo (/@handle, /channel/UCxxx, /c/Nombre,
 * /user/Nombre) MÁS el legacy sin prefijo (/Nombre, ej. youtube.com/midudev), cualquiera de
 * ellos con o sin una pestaña al final (/videos, /streams, /about...). El legacy es ambiguo con
 * cualquier path de 1-2 segmentos, así que se excluyen youtu.be (ahí /xxx SIEMPRE es video) y
 * los paths reservados de YouTube (/watch, /results, /embed, etc).
 */
function isChannelPath(hostname: string, pathname: string): boolean {
  if (hostname === "youtu.be") return false;
  if (CHANNEL_PREFIX_RE.test(pathname)) return true;
  const [first, second, ...rest] = pathname.split("/").filter(Boolean);
  if (!first || RESERVED_PATH_SEGMENTS.has(first.toLowerCase())) return false;
  if (!second) return true; // /nombre
  return rest.length === 0 && CHANNEL_TABS.has(second.toLowerCase()); // /nombre/videos
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
   * Nunca cae en un default silencioso: si ningún formato conocido matchea, tira error
   * explícito en vez de asumir "video" (así se detectó en su momento el bug de /midudev).
   */
  classify(url: string): ContentKind {
    const u = new URL(url);
    const hostname = u.hostname.toLowerCase();
    const pathname = u.pathname;

    if (hostname === "youtu.be") return "video"; // youtu.be/<id> es siempre un video
    if (pathname.startsWith("/shorts/")) return "short";
    if (pathname === "/watch" || pathname.startsWith("/embed/") || pathname.startsWith("/v/"))
      return "video";
    if (/^\/live\/[^/]+$/.test(pathname)) return "video"; // waiting-room de un directo puntual
    if (pathname === "/playlist") return "playlist";
    if (isChannelPath(hostname, pathname)) return "channel";

    throw new Error(
      `No reconozco el formato de esta URL de YouTube (${pathname}). Formatos soportados: ` +
        "video (/watch, youtu.be/ID, /embed/ID, /live/ID), short (/shorts/ID), " +
        "canal (/@handle, /channel/ID, /c/nombre, /user/nombre, o vanity legacy /nombre) y playlist (/playlist).",
    );
  }

  capabilities(): ProviderCapabilities {
    return {
      reliability: "stable",
      supports: {
        metadata: true,
        subtitles: true,
        mediaDownload: true,
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
      raw: info as unknown as Record<string, unknown>,
    };
  }

  /** Prioridad: subs manuales > auto-captions. Idioma: el del video > es > en > primero. */
  async fetchText(url: string): Promise<TextPayload | null> {
    return textFromInfo(await this.info(url));
  }

  async fetchMedia(url: string, destDir: string): Promise<string | null> {
    const info = await this.info(url);
    return downloadAudio(url, destDir, info.id);
  }

  async fetchComments(url: string, limit: number): Promise<SourceComment[]> {
    const raw = await dumpComments(url, limit);
    return raw
      .filter((c) => c.text)
      .map((c) => ({
        author: c.author ?? "anónimo",
        text: c.text ?? "",
        likes: c.like_count ?? undefined,
        parentId: c.parent && c.parent !== "root" ? c.parent : undefined,
        postedAt: c.timestamp ? new Date(c.timestamp * 1000).toISOString() : undefined,
      }));
  }

  /** Lista videos del canal: strategy recent = orden de subida; top = por vistas. */
  async listItems(url: string, strategy: "top" | "recent", n: number): Promise<ChannelItem[]> {
    const u = new URL(url);
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (apiKey) {
      const ref = this.apiChannelRef(u);
      if (ref) {
        try {
          return await this.listItemsViaApi(ref, strategy, n, apiKey);
        } catch {
          // key inválida, cuota agotada, canal no resoluble por este método: fallback silencioso a yt-dlp
        }
      }
    }
    // canal sin tab → tab /videos (uploads); playlists quedan como están
    const isChannel = isChannelPath(u.hostname.toLowerCase(), u.pathname);
    const hasTab = /\/(videos|shorts|streams)$/.test(u.pathname);
    const target = isChannel && !hasTab ? `${url.replace(/\/$/, "")}/videos` : url;
    // para "top" pedimos más entradas y ordenamos por vistas
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

  /** Solo /@handle y /channel/ID: los dos formatos que la API resuelve directo, sin ambigüedad. */
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
