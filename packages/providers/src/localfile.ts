import type {
  ContentKind,
  ContentMetadata,
  ContentProvider,
  ProviderCapabilities,
  TextPayload,
} from "@creator-research/core";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";

const TEXT_EXT = new Set([".md", ".txt", ".markdown"]);
const MEDIA_EXT = new Set([".mp4", ".mp3", ".wav", ".m4a", ".webm", ".mkv", ".ogg"]);

/**
 * Fallback universal: archivos del disco del SERVIDOR.
 * Texto (md/txt) → directo. Audio/video → Whisper.
 * Es la salida para LinkedIn, Instagram bloqueado, cursos propios, etc.
 */
export class LocalFileProvider implements ContentProvider {
  readonly name = "localfile";

  matches(ref: string): boolean {
    if (ref.startsWith("http://") || ref.startsWith("https://")) return false;
    const ext = extname(ref).toLowerCase();
    return (TEXT_EXT.has(ext) || MEDIA_EXT.has(ext)) && existsSync(ref);
  }

  classify(ref: string): ContentKind {
    return TEXT_EXT.has(extname(ref).toLowerCase()) ? "article" : "file";
  }

  capabilities(): ProviderCapabilities {
    return {
      reliability: "stable",
      supports: {
        metadata: true,
        subtitles: false,
        mediaDownload: true,
        comments: false,
        channelListing: false,
      },
      legalNotes: "Los paths refieren al disco donde corre el servidor MCP",
    };
  }

  fetchMetadata(ref: string): Promise<ContentMetadata> {
    const stat = statSync(ref);
    return Promise.resolve({
      externalId: ref,
      title: basename(ref),
      raw: { sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() },
    });
  }

  fetchText(ref: string): Promise<TextPayload | null> {
    if (!TEXT_EXT.has(extname(ref).toLowerCase())) return Promise.resolve(null);
    return Promise.resolve({ text: readFileSync(ref, "utf8"), source: "native_text" });
  }

  /** Para media local no hay nada que descargar: el archivo YA es el media. */
  fetchMedia(ref: string): Promise<string | null> {
    return Promise.resolve(MEDIA_EXT.has(extname(ref).toLowerCase()) ? ref : null);
  }
}
