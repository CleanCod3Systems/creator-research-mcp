import type {
  ContentKind,
  ContentMetadata,
  ContentProvider,
  ProviderCapabilities,
  TextPayload,
} from "@cleancod3/core";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";

const TEXT_EXT = new Set([".md", ".txt", ".markdown"]);
const MEDIA_EXT = new Set([".mp4", ".mp3", ".wav", ".m4a", ".webm", ".mkv", ".ogg"]);

/**
 * Universal fallback: files on the SERVER's disk.
 * Text (md/txt) → read directly. Media files match for metadata only (size, mtime) — there's
 * no transcription in this server, so fetchText returns null for them and the caller gets an
 * honest "no text available" instead of a fabricated transcript.
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
}
