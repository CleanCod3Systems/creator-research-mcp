import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const YTDLP_BIN = process.env.YTDLP_PATH ?? "yt-dlp";
/** Extra args for special environments (corporate proxy, cookies): "--no-check-certificates" etc. */
const EXTRA_ARGS = (process.env.YTDLP_EXTRA_ARGS ?? "").split(" ").filter(Boolean);
const TIMEOUT_MS = 60_000;

export interface YtDlpFormat {
  format_id?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  resolution?: string;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  tbr?: number | null;
  abr?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  url?: string;
  protocol?: string;
  format_note?: string;
}

export interface YtDlpInfo {
  id: string;
  title: string;
  description?: string;
  duration?: number;
  upload_date?: string;
  channel?: string;
  channel_id?: string;
  uploader?: string;
  uploader_id?: string;
  uploader_url?: string;
  thumbnail?: string;
  media_type?: string;
  availability?: string;
  view_count?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
  language?: string | null;
  subtitles?: Record<string, { url: string; ext: string }[]>;
  automatic_captions?: Record<string, { url: string; ext: string }[]>;
  webpage_url?: string;
  entries?: YtDlpEntry[];
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  resolution?: string | null;
  formats?: YtDlpFormat[];
}

export interface YtDlpEntry {
  id: string;
  title?: string;
  duration?: number | null;
  thumbnail?: string;
  media_type?: string;
  view_count?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
  webpage_url?: string;
}

export async function dumpInfo(url: string): Promise<YtDlpInfo> {
  try {
    const { stdout } = await exec(
      YTDLP_BIN,
      [
        ...EXTRA_ARGS,
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--no-playlist",
        url,
      ],
      { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as YtDlpInfo;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      throw new Error("yt-dlp is not installed or not on PATH (or set YTDLP_PATH)");
    }
    throw new Error(`yt-dlp failed for ${url}: ${msg.slice(0, 500)}`);
  }
}

export interface FlatEntry {
  id: string;
  url?: string;
  title?: string;
  duration?: number | null;
  view_count?: number | null;
}

/** Lists videos from a channel/playlist WITHOUT downloading them (fast). */
export async function dumpFlatPlaylist(url: string, limit: number): Promise<FlatEntry[]> {
  const { stdout } = await exec(
    YTDLP_BIN,
    [
      ...EXTRA_ARGS,
      "--flat-playlist",
      "--dump-single-json",
      "--no-warnings",
      "--playlist-end",
      String(limit),
      url,
    ],
    { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
  );
  const data = JSON.parse(stdout) as { entries?: FlatEntry[] };
  return data.entries ?? [];
}

interface YtRawComment {
  id: string;
  text?: string;
  author?: string;
  like_count?: number | null;
  parent?: string;
  timestamp?: number | null;
}

/** Comments via yt-dlp (no API key). comment_sort=top prioritizes relevant ones. */
export async function dumpComments(
  url: string,
  max: number,
  extractor: "youtube" | "instagram" = "youtube",
): Promise<YtRawComment[]> {
  const extractorArgs =
    extractor === "youtube"
      ? ["--extractor-args", `youtube:comment_sort=top;max_comments=${String(max)}`]
      : [];
  const { stdout } = await exec(
    YTDLP_BIN,
    [
      ...EXTRA_ARGS,
      "--dump-single-json",
      "--skip-download",
      "--no-warnings",
      "--no-playlist",
      "--write-comments",
      ...extractorArgs,
      url,
    ],
    { timeout: 240_000, maxBuffer: 128 * 1024 * 1024 },
  );
  const data = JSON.parse(stdout) as { comments?: YtRawComment[] };
  return data.comments ?? [];
}

/**
 * Picks a fallback audio stream when there are no subtitles: audio-only formats first
 * (highest bitrate), otherwise the lowest-bitrate muxed format. Never downloads anything —
 * only returns the URL yt-dlp already resolved so the client can fetch/transcribe it itself.
 */
export function pickFallbackAudioFormat(formats?: YtDlpFormat[]): YtDlpFormat | null {
  if (!formats?.length) return null;
  const withUrl = formats.filter((f) => Boolean(f.url));
  const audioOnly = withUrl.filter((f) => f.vcodec === "none" && f.acodec && f.acodec !== "none");
  if (audioOnly.length) {
    return [...audioOnly].sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0))[0] ?? null;
  }
  const muxed = withUrl.filter((f) => f.vcodec !== "none" && f.acodec && f.acodec !== "none");
  if (!muxed.length) return null;
  return [...muxed].sort((a, b) => (a.tbr ?? Infinity) - (b.tbr ?? Infinity))[0] ?? null;
}

/** Detected yt-dlp binary version, or null if it's not installed/reachable. */
export async function getYtDlpVersion(): Promise<string | null> {
  try {
    const { stdout } = await exec(YTDLP_BIN, ["--version"], { timeout: 5_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
