import { z } from "zod";

export const FacetKind = z.enum([
  "summary",
  "conclusions",
  "technologies",
  "frameworks",
  "tools",
  "code",
  "best_practices",
  "bad_practices",
  "errors",
  "architecture",
  "level",
  "curriculum",
  "questions",
  "concepts",
  "keywords",
  "glossary",
  "examples",
  "steps",
]);
export type FacetKind = z.infer<typeof FacetKind>;

export const FacetItem = z.object({
  value: z.string(),
  detail: z.string().optional(),
  /** Referencia a la fuente: segundo del video o fragmento del texto. */
  evidence: z
    .object({ timestampSec: z.number().optional(), quoteRef: z.string().optional() })
    .optional(),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type FacetItem = z.infer<typeof FacetItem>;

/** Documento canónico versionado. JSON es la fuente de verdad; md/text son proyecciones. */
export const AnalysisDocument = z.object({
  schemaVersion: z.literal(1),
  contentHash: z.string(),
  title: z.string(),
  sourceUrl: z.string().optional(),
  provider: z.string(),
  language: z.string().optional(),
  durationSec: z.number().optional(),
  facets: z.record(FacetKind, z.array(FacetItem)).default({}),
  warnings: z.array(z.string()).default([]),
  ai: z.object({ engine: z.string(), model: z.string() }).optional(),
  createdAt: z.string().datetime(),
});
export type AnalysisDocument = z.infer<typeof AnalysisDocument>;
