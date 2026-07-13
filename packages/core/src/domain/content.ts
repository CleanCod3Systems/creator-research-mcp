import { createHash } from "node:crypto";
import { z } from "zod";

export const ContentKind = z.enum([
  "video",
  "short",
  "channel",
  "playlist",
  "article",
  "pdf",
  "file",
  "tweet",
]);
export type ContentKind = z.infer<typeof ContentKind>;

export const SourceRef = z.union([
  z.object({ type: z.literal("url"), url: z.string().url() }),
  z.object({ type: z.literal("file"), filePath: z.string().min(1) }),
]);
export type SourceRef = z.infer<typeof SourceRef>;

export const AnalysisDepth = z.enum(["quick", "standard", "full"]);
export type AnalysisDepth = z.infer<typeof AnalysisDepth>;

/** Strips tracking parameters and normalizes — idempotency key. */
export function canonicalizeUrl(raw: string): string {
  const url = new URL(raw);
  const tracking = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "si",
    "feature",
    "fbclid",
  ];
  for (const p of tracking) url.searchParams.delete(p);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

/** sha256(source + depth + pipelineVersion + aiProfile) — cache key. */
export function contentHash(
  source: SourceRef,
  depth: AnalysisDepth,
  pipelineVersion: string,
  aiProfile: string,
): string {
  const id = source.type === "url" ? canonicalizeUrl(source.url) : `file:${source.filePath}`;
  return createHash("sha256")
    .update([id, depth, pipelineVersion, aiProfile].join("\u0000"))
    .digest("hex");
}

/**
 * Identity of the CONTENT (independent of depth/AI profile).
 * contentHash identifies a specific ANALYSIS; sourceHash identifies the source.
 */
export function sourceHash(source: SourceRef): string {
  const id = source.type === "url" ? canonicalizeUrl(source.url) : `file:${source.filePath}`;
  return createHash("sha256").update(id).digest("hex");
}
