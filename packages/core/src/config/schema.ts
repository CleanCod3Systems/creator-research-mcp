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
  storage: z.object({ databasePath: z.string() }),
});
export type AppConfig = z.infer<typeof AppConfig>;

export function loadYamlConfig<T>(path: string, schema: z.ZodType<T>): T {
  return schema.parse(parse(readFileSync(path, "utf8")));
}

/** Embedded defaults: let the server run without a config/ directory (npx install). */
export const DEFAULT_APP_CONFIG: AppConfig = {
  app: { name: "creator-research-mcp", pipelineVersion: "1" },
  storage: {
    databasePath: process.env.DATABASE_PATH ?? "~/.creator-research/creator-research.db",
  },
};

export const DEFAULT_PROVIDERS: ProvidersFile = {
  providers: {
    youtube: { enabled: true, reliability: "stable" },
    web: { enabled: true, reliability: "stable" },
    pdf: { enabled: true, reliability: "stable" },
    localfile: { enabled: true, reliability: "stable" },
    tiktok: {
      enabled: true,
      reliability: "fragile",
      notes: "yt-dlp best-effort; can break without notice",
    },
    instagram: {
      enabled: true,
      reliability: "fragile",
      notes: "Content behind login requires cookies (YTDLP_EXTRA_ARGS)",
    },
    twitter: {
      enabled: true,
      reliability: "fragile",
      notes: "Text via FxTwitter + video via yt-dlp; public tweets only",
    },
    linkedin: {
      enabled: true,
      reliability: "fragile",
      notes: "Public posts/articles only; use filePath for content behind the login wall",
    },
  },
};

/** Loads a yaml file if it exists; otherwise returns the embedded fallback. */
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
