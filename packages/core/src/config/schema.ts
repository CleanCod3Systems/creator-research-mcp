import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

export const ProviderConfig = z.object({
  enabled: z.boolean(),
  reliability: z.enum(["stable", "fragile", "manual_only"]),
  notes: z.string().optional(),
});

export const ProvidersFile = z.object({ providers: z.record(z.string(), ProviderConfig) });
export type ProvidersFile = z.infer<typeof ProvidersFile>;

export const AppConfig = z.object({
  app: z.object({ name: z.string(), pipelineVersion: z.string() }),
  storage: z.object({ databasePath: z.string(), mediaDir: z.string(), keepAudio: z.boolean() }),
  cache: z.object({ analysisTtlDays: z.number().int().positive() }),
  jobs: z.object({
    maxConcurrent: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
  }),
  limits: z.object({ maxVideoDurationMinutes: z.number().int().positive() }),
});
export type AppConfig = z.infer<typeof AppConfig>;

export function loadYamlConfig<T>(path: string, schema: z.ZodType<T>): T {
  return schema.parse(parse(readFileSync(path, "utf8")));
}

/** Defaults embebidos: permiten correr sin directorio config/ (instalación vía npx). */
export const DEFAULT_APP_CONFIG: AppConfig = {
  app: { name: "creator-research-mcp", pipelineVersion: "1" },
  storage: {
    databasePath: process.env.DATABASE_PATH ?? "~/.creator-research/creator-research.db",
    mediaDir: process.env.MEDIA_DIR ?? "~/.creator-research/media",
    keepAudio: false,
  },
  cache: { analysisTtlDays: 7 },
  jobs: { maxConcurrent: 2, maxAttempts: 3 },
  limits: { maxVideoDurationMinutes: 120 },
};

export const DEFAULT_PROVIDERS: ProvidersFile = {
  providers: {
    youtube: { enabled: true, reliability: "stable" },
    vimeo: { enabled: true, reliability: "stable" },
    web: { enabled: true, reliability: "stable" },
    pdf: { enabled: true, reliability: "stable" },
    localfile: { enabled: true, reliability: "stable" },
    tiktok: {
      enabled: true,
      reliability: "fragile",
      notes: "yt-dlp best-effort; puede romperse sin aviso",
    },
    instagram: {
      enabled: true,
      reliability: "fragile",
      notes: "Contenido con login requiere cookies (YTDLP_EXTRA_ARGS)",
    },
    twitter: {
      enabled: true,
      reliability: "fragile",
      notes: "Texto vía FxTwitter + video vía yt-dlp; solo tweets públicos",
    },
    linkedin: {
      enabled: true,
      reliability: "fragile",
      notes: "Solo posts/artículos públicos; con authwall usar filePath",
    },
  },
};

/** Carga un yaml si existe; si no, devuelve el fallback embebido. */
export function loadYamlConfigOrDefault<T>(
  pathOrNull: string | null,
  schema: z.ZodType<T>,
  fallback: T,
): T {
  if (!pathOrNull) return fallback;
  try {
    return schema.parse(parse(readFileSync(pathOrNull, "utf8")));
  } catch {
    return fallback;
  }
}
