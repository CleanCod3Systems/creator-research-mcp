import type { TextPayload } from "@cleancod3/core";
import { parseVtt, segmentsToText } from "./vtt.js";
import type { YtDlpInfo } from "./ytdlp.js";

/** Prioridad: subs manuales > auto-captions. Idioma: el del contenido > es > en > primero. */
export async function textFromInfo(info: YtDlpInfo): Promise<TextPayload | null> {
  for (const [tracks, source] of [
    [info.subtitles, "subtitles_manual"],
    [info.automatic_captions, "subtitles_auto"],
  ] as const) {
    if (!tracks) continue;
    const lang = pickLanguage(Object.keys(tracks), info.language ?? undefined);
    if (!lang) continue;
    const vttTrack = tracks[lang]?.find((t) => t.ext === "vtt") ?? tracks[lang]?.[0];
    if (!vttTrack) continue;
    const res = await fetch(vttTrack.url);
    if (!res.ok) continue;
    const segments = parseVtt(await res.text());
    if (segments.length === 0) continue;
    return { text: segmentsToText(segments), segments, source, language: lang };
  }
  return null;
}

function pickLanguage(available: string[], preferred?: string): string | undefined {
  const clean = available.filter((l) => !l.startsWith("live_chat"));
  for (const want of [preferred, "es", "en"].filter(Boolean) as string[]) {
    const hit = clean.find((l) => l === want || l.startsWith(`${want}-`));
    if (hit) return hit;
  }
  return clean[0];
}
