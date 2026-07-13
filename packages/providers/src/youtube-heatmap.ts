// UA de navegador real: sin esto YouTube a veces devuelve una página simplificada sin ytInitialData
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export interface HeatmapPoint {
  startSec: number;
  durationSec: number;
  /** 0-1, cuánto más rebobina/repite la audiencia ese tramo respecto al resto del video. */
  intensity: number;
}

/** video.watch?v=xxx, youtu.be/xxx, /shorts/xxx, /embed/xxx, /live/xxx, /v/xxx. null si no es video. */
export function extractYoutubeVideoId(url: string): string | null {
  const u = new URL(url);
  if (u.hostname.toLowerCase() === "youtu.be") return u.pathname.slice(1).split("/")[0] ?? null;
  if (u.pathname === "/watch") return u.searchParams.get("v");
  const m = /^\/(?:shorts|embed|v|live)\/([^/]+)/.exec(u.pathname);
  return m?.[1] ?? null;
}

/**
 * "Most replayed": el heatmap que YouTube muestra sobre la barra de progreso, con los tramos
 * que la audiencia más rebobina/repite. No es una API oficial: viene embebido en el JSON inicial
 * de la página del video. La ruta exacta del JSON cambia con el tiempo, así que en vez de
 * hardcodearla se busca recursivamente el array `heatMarkers` donde sea que esté.
 */
export async function fetchMostReplayedHeatmap(videoId: string): Promise<HeatmapPoint[] | null> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`YouTube HTTP ${String(res.status)} al pedir la página del video`);
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
 * Búsqueda recursiva y defensiva de `markersList` con markerType MARKER_TYPE_HEATMAP dentro del
 * JSON de la página (formato "entity mutations" que usa YouTube, verificado 2026-07 contra HTML
 * real). No se hardcodea la ruta completa (frameworkUpdates.entityBatchUpdate.mutations[].payload
 * .macroMarkersListEntity...) porque YouTube reordena esos wrappers con el tiempo; se busca la
 * combinación markerType+markers donde sea que esté anidada.
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
