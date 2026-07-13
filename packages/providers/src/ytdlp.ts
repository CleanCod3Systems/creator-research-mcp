import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const YTDLP_BIN = process.env.YTDLP_PATH ?? "yt-dlp";
/** Args extra p/ entornos especiales (proxy corporativo, cookies): "--no-check-certificates" etc. */
const EXTRA_ARGS = (process.env.YTDLP_EXTRA_ARGS ?? "").split(" ").filter(Boolean);
const TIMEOUT_MS = 60_000;

export interface YtDlpInfo {
  id: string;
  title: string;
  description?: string;
  duration?: number;
  upload_date?: string;
  channel?: string;
  channel_id?: string;
  uploader?: string;
  view_count?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
  language?: string | null;
  subtitles?: Record<string, { url: string; ext: string }[]>;
  automatic_captions?: Record<string, { url: string; ext: string }[]>;
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
      throw new Error("yt-dlp no está instalado o no está en PATH (o definí YTDLP_PATH)");
    }
    throw new Error(`yt-dlp falló para ${url}: ${msg.slice(0, 500)}`);
  }
}

/** Descarga solo el audio como wav 16 kHz mono (formato que espera Whisper). Requiere ffmpeg. */
export async function downloadAudio(url: string, destDir: string, id: string): Promise<string> {
  const outPath = `${destDir}/${id}.wav`;
  try {
    await exec(
      YTDLP_BIN,
      [
        ...EXTRA_ARGS,
        "-f",
        "bestaudio/best",
        "-x",
        "--audio-format",
        "wav",
        "--postprocessor-args",
        "ffmpeg:-ar 16000 -ac 1",
        "--no-warnings",
        "--no-playlist",
        "-o",
        `${destDir}/${id}.%(ext)s`,
        url,
      ],
      { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
    );
    return outPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Descarga de audio falló (¿ffmpeg instalado?): ${msg.slice(0, 400)}`);
  }
}

export interface FlatEntry {
  id: string;
  url?: string;
  title?: string;
  duration?: number | null;
  view_count?: number | null;
}

/** Lista los videos de un canal/playlist SIN descargarlos (rápido). */
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

/** Comentarios vía yt-dlp (sin API key). comment_sort=top prioriza los relevantes. */
export async function dumpComments(url: string, max: number): Promise<YtRawComment[]> {
  const { stdout } = await exec(
    YTDLP_BIN,
    [
      ...EXTRA_ARGS,
      "--dump-single-json",
      "--skip-download",
      "--no-warnings",
      "--no-playlist",
      "--write-comments",
      "--extractor-args",
      `youtube:comment_sort=top;max_comments=${String(max)}`,
      url,
    ],
    { timeout: 240_000, maxBuffer: 128 * 1024 * 1024 },
  );
  const data = JSON.parse(stdout) as { comments?: YtRawComment[] };
  return data.comments ?? [];
}
