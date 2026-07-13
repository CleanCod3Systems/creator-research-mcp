import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { detectOutlier, median } from "@creator-research/core";
import { z } from "zod";
import { getContext } from "../context.js";

const STOPWORDS = new Set([
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "que",
  "y",
  "a",
  "en",
  "un",
  "una",
  "unos",
  "unas",
  "es",
  "por",
  "con",
  "para",
  "mi",
  "tu",
  "su",
  "al",
  "lo",
  "se",
  "no",
  "si",
  "más",
  "pero",
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "and",
  "is",
  "how",
  "this",
  "that",
  "for",
  "on",
  "with",
]);

/** Frecuencia de palabras en títulos/captions — conteo literal, NO interpretación semántica. */
export function wordFrequency(texts: string[], topN = 15): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const normalized = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (const word of normalized.split(/[^a-z0-9]+/)) {
      if (word.length < 3 || STOPWORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

/** Mediana de días entre publicaciones consecutivas. null si no hay al menos 2 fechas reales. */
export function publishFrequencyDays(publishedAtValues: (string | undefined)[]): {
  medianDaysBetweenPosts: number | null;
  sampleSize: number;
} {
  const dates = publishedAtValues.filter((d): d is string => Boolean(d)).sort();
  if (dates.length < 2) return { medianDaysBetweenPosts: null, sampleSize: dates.length };
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const curr = dates[i];
    if (!prev || !curr) continue;
    gaps.push(Math.abs(new Date(curr).getTime() - new Date(prev).getTime()) / 86_400_000);
  }
  return { medianDaysBetweenPosts: Math.round(median(gaps) * 10) / 10, sampleSize: dates.length };
}

type DurationBucket = "short(<60s)" | "mid(60-180s)" | "long(>180s)" | "unknown";

function bucketOf(durationSec: number | undefined): DurationBucket {
  if (durationSec === undefined) return "unknown";
  if (durationSec < 60) return "short(<60s)";
  if (durationSec <= 180) return "mid(60-180s)";
  return "long(>180s)";
}

interface FormatPerformance {
  bucket: DurationBucket;
  count: number;
  medianViews: number;
}

/** Performance por duración: puro agrupado + mediana, sin ningún juicio de calidad. */
export function performanceByFormat(
  items: { durationSec?: number; viewCount?: number }[],
): FormatPerformance[] {
  const groups = new Map<DurationBucket, number[]>();
  for (const item of items) {
    const bucket = bucketOf(item.durationSec);
    const arr = groups.get(bucket) ?? [];
    arr.push(item.viewCount ?? 0);
    groups.set(bucket, arr);
  }
  return [...groups.entries()]
    .map(([bucket, views]) => ({ bucket, count: views.length, medianViews: median(views) }))
    .sort((a, b) => b.medianViews - a.medianViews);
}

interface CreatorProfile {
  channel: string;
  sampleSize: number;
  medianViews: number;
  medianDurationSec: number;
  publishFrequency: { medianDaysBetweenPosts: number | null; sampleSize: number };
  topTags: { word: string; count: number }[];
  titleKeywords: { word: string; count: number }[];
  performanceByFormat: FormatPerformance[];
  topOutliers: { title: string; url: string; views: number | null; outlierScore: number | null }[];
  bottomPerformers: { title: string; url: string; views: number | null }[];
}

async function buildCreatorProfile(
  url: string,
  sampleSize: number,
): Promise<CreatorProfile | { error: string; message: string }> {
  const { providers } = getContext();
  const provider = providers.find((p) => p.matches(url));
  if (!provider?.listItems) {
    return { error: "unsupported_source", message: "Este provider no soporta listado de canales." };
  }
  const items = await provider.listItems(url, "recent", sampleSize);
  if (items.length === 0) return { error: "empty_channel", message: "No se encontraron videos." };

  const views = items.map((i) => i.viewCount ?? 0);
  const durations = items.map((i) => i.durationSec ?? 0);
  const allTags = items.flatMap((i) => i.tags ?? []);
  const sorted = [...items].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
  const top = sorted.slice(0, 5);
  const bottom = sorted.slice(-3).reverse();

  return {
    channel: url,
    sampleSize: items.length,
    medianViews: median(views),
    medianDurationSec: median(durations),
    publishFrequency: publishFrequencyDays(items.map((i) => i.publishedAt)),
    topTags: wordFrequency(allTags, 15),
    titleKeywords: wordFrequency(
      items.map((i) => i.title),
      15,
    ),
    performanceByFormat: performanceByFormat(items),
    topOutliers: top.map((i) => ({
      title: i.title,
      url: i.url,
      views: i.viewCount ?? null,
      outlierScore:
        i.viewCount !== undefined ? (detectOutlier(i.viewCount, views).score ?? null) : null,
    })),
    bottomPerformers: bottom.map((i) => ({
      title: i.title,
      url: i.url,
      views: i.viewCount ?? null,
    })),
  };
}

/**
 * Agregador de datos determinista — CERO IA server-side. Trae una muestra del canal y calcula
 * estadísticas (mediana de vistas/duración, frecuencia de publicación, frecuencia de palabras
 * en títulos/tags, performance por formato). La interpretación real (hooks, CTAs, huecos de
 * contenido) le corresponde al LLM cliente sobre estos datos + los transcripts de los outliers.
 */
export function registerAnalyzeCreatorTool(server: McpServer): void {
  server.registerTool(
    "analyze_creator",
    {
      title: "Perfil estadístico de un creador",
      description:
        "Trae una muestra del canal/perfil y calcula estadísticas deterministas: mediana de vistas/duración, " +
        "frecuencia de publicación, palabras más repetidas en títulos/tags, performance por formato de " +
        "duración, y los outliers (mejores/peores). CERO IA propia: es agregación de datos, no interpretación. " +
        "Para hooks/CTA/narrativa reales, usá get_transcript sobre los topOutliers devueltos y analizalos vos.",
      inputSchema: {
        url: z.string().url().describe("URL del canal/perfil"),
        sampleSize: z.number().int().min(5).max(50).default(20),
      },
    },
    async ({ url, sampleSize }) => {
      const profile = await buildCreatorProfile(url, sampleSize);
      if ("error" in profile) return json(profile);
      return json({
        ...profile,
        synthesisGuide:
          "Con estos datos: 1) temas probables = titleKeywords, 2) formato que mejor funciona = " +
          "performanceByFormat[0], 3) cadencia = publishFrequency. Para hooks/CTA/estructura narrativa " +
          "reales, traé el transcript de topOutliers con get_transcript y analizalos en la conversación " +
          "— este tool NO los infiere, solo señala qué videos vale la pena leer.",
      });
    },
  );
}

/**
 * Compara 2-10 perfiles con las mismas estadísticas de analyze_creator, lado a lado.
 * Igual que analyze_creator: agregación determinista, la síntesis la hace el LLM cliente.
 */
export function registerCompareCreatorsTool(server: McpServer): void {
  server.registerTool(
    "compare_creators",
    {
      title: "Comparar creadores",
      description:
        "Compara 2-10 canales/perfiles lado a lado: vistas medianas, duración típica, cadencia de " +
        "publicación, tags/keywords compartidos vs únicos, y qué formato de duración funciona mejor en cada " +
        "uno. CERO IA propia — agregación determinista para que vos saques las conclusiones.",
      inputSchema: {
        urls: z.array(z.string().url()).min(2).max(10),
        sampleSize: z.number().int().min(5).max(50).default(15),
      },
    },
    async ({ urls, sampleSize }) => {
      const profiles = await Promise.all(urls.map((url) => buildCreatorProfile(url, sampleSize)));
      const valid = profiles.filter((p): p is CreatorProfile => !("error" in p));
      const failed = urls.filter((_, i) => {
        const p = profiles[i];
        return p !== undefined && "error" in p;
      });
      if (valid.length < 2) {
        return json({
          error: "insufficient_data",
          message: "Se necesitan al menos 2 perfiles con datos válidos para comparar.",
          failed,
        });
      }

      const tagSets = valid.map((p) => new Set(p.topTags.map((t) => t.word)));
      const sharedTags = [...(tagSets[0] ?? [])].filter((tag) => tagSets.every((s) => s.has(tag)));

      return json({
        profiles: valid.map((p) => ({
          channel: p.channel,
          sampleSize: p.sampleSize,
          medianViews: p.medianViews,
          medianDurationSec: p.medianDurationSec,
          publishFrequency: p.publishFrequency,
          bestFormat: p.performanceByFormat[0] ?? null,
          topKeywords: p.titleKeywords.slice(0, 5),
        })),
        sharedTags,
        skipped: failed.length > 0 ? failed : undefined,
        synthesisGuide:
          "Compará medianViews (quién rompe más) y publishFrequency (quién publica más seguido) primero. " +
          "sharedTags = terreno en común; lo que NO comparten = diferenciación real de cada uno. " +
          "Fortalezas/riesgos y nivel técnico los evaluás vos leyendo transcripts puntuales con get_transcript.",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
