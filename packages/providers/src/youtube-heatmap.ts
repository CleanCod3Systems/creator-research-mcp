// Real browser UA: without this YouTube sometimes returns a simplified page without ytInitialData
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export interface HeatmapPoint {
  startSec: number;
  durationSec: number;
  /** 0-1, how much more the audience rewinds/replays that segment relative to the rest of the video. */
  intensity: number;
}

/** video.watch?v=xxx, youtu.be/xxx, /shorts/xxx, /embed/xxx, /live/xxx, /v/xxx. null if not a video. */
export function extractYoutubeVideoId(url: string): string | null {
  const u = new URL(url);
  if (u.hostname.toLowerCase() === "youtu.be") return u.pathname.slice(1).split("/")[0] ?? null;
  if (u.pathname === "/watch") return u.searchParams.get("v");
  const m = /^\/(?:shorts|embed|v|live)\/([^/]+)/.exec(u.pathname);
  return m?.[1] ?? null;
}

/**
 * "Most replayed": the heatmap YouTube shows over the progress bar, with the segments
 * the audience rewinds/replays the most. Not an official API: it comes embedded in the initial
 * JSON of the video page. The exact JSON path changes over time, so instead of
 * hardcoding it, the `heatMarkers` array is searched for recursively wherever it is.
 */
export async function fetchMostReplayedHeatmap(videoId: string): Promise<HeatmapPoint[] | null> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`YouTube HTTP ${String(res.status)} requesting the video page`);
  const html = await res.text();
  const match = /var ytInitialData\s*=\s*(\{.+?\});<\/script>/s.exec(html);
  const jsonText = match?.[1];
  if (!jsonText) return null;
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return null;
  }
  const markers = findHeatMarkers(data);
  if (markers.length === 0) return null;
  return markers.map((m) => ({
    startSec: m.timeRangeStartMillis / 1000,
    durationSec: m.markerDurationMillis / 1000,
    intensity: m.heatMarkerIntensityScoreNormalized,
  }));
}

interface RawHeatMarker {
  timeRangeStartMillis: number;
  markerDurationMillis: number;
  heatMarkerIntensityScoreNormalized: number;
}

/**
 * Recursive, defensive search for a `markersList` with markerType MARKER_TYPE_HEATMAP inside the
 * page JSON ("entity mutations" format used by YouTube, verified 2026-07 against real
 * HTML). The full path (frameworkUpdates.entityBatchUpdate.mutations[].payload
 * .macroMarkersListEntity...) is not hardcoded because YouTube reorders those wrappers over time;
 * the markerType+markers combination is searched for wherever it is nested.
 */
export function findHeatMarkers(node: unknown, depth = 0): RawHeatMarker[] {
  if (depth > 20 || node === null || typeof node !== "object") return [];
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findHeatMarkers(item, depth + 1);
      if (found.length > 0) return found;
    }
    return [];
  }
  const obj = node as Record<string, unknown>;
  const markersList = obj.markersList as Record<string, unknown> | undefined;
  if (markersList?.markerType === "MARKER_TYPE_HEATMAP" && Array.isArray(markersList.markers)) {
    return (markersList.markers as Record<string, unknown>[]).map((m) => ({
      timeRangeStartMillis: Number(m.startMillis ?? 0),
      markerDurationMillis: Number(m.durationMillis ?? 0),
      heatMarkerIntensityScoreNormalized: Number(m.intensityScoreNormalized ?? 0),
    }));
  }
  for (const value of Object.values(obj)) {
    const found = findHeatMarkers(value, depth + 1);
    if (found.length > 0) return found;
  }
  return [];
}
