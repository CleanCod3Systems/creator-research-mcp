import type { TranscriptSegment } from "@cleancod3/core";

const CUE_RE = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;

function toSec(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

/**
 * WebVTT parser focused on YouTube subtitles.
 * Auto-captions repeat lines in "rolling" mode: consecutive duplicates are removed.
 */
export function parseVtt(vtt: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const lines = vtt.split(/\r?\n/);
  let i = 0;
  let lastText = "";
  while (i < lines.length) {
    const match = CUE_RE.exec(lines[i] ?? "");
    if (!match) {
      i++;
      continue;
    }
    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match;
    const start = toSec(h1 ?? "0", m1 ?? "0", s1 ?? "0", ms1 ?? "0");
    const end = toSec(h2 ?? "0", m2 ?? "0", s2 ?? "0", ms2 ?? "0");
    i++;
    const textLines: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() !== "") {
      const clean = (lines[i] ?? "").replace(/<[^>]+>/g, "").trim();
      if (clean && clean !== lastText && !textLines.includes(clean)) textLines.push(clean);
      i++;
    }
    const text = textLines.join(" ").trim();
    if (text && text !== lastText) {
      segments.push({ start, end, text });
      lastText = text;
    }
  }
  return segments;
}

export function segmentsToText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join(" ");
}
