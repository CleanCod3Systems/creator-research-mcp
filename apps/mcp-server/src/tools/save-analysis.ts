import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AnalysisDocument,
  FacetItem,
  FacetKind,
  sourceHash,
  type SourceRef,
} from "@creator-research/core";
import { z } from "zod";
import { getContext } from "../context.js";

/**
 * Closes the loop of client-reasoning mode: the client LLM analyzed the
 * transcript in the conversation and here persists the structured facets,
 * making them available for get_analysis, comparisons, and future courses.
 */
export function registerSaveAnalysisTool(server: McpServer): void {
  server.registerTool(
    "save_analysis",
    {
      title: "Save analysis",
      description:
        "Persists an analysis you (the client LLM) made of a transcript obtained via get_transcript. " +
        "facets: object {facetKind: [{value, detail?, confidence?}]}. Valid kinds: summary, conclusions, " +
        "technologies, frameworks, tools, code, best_practices, bad_practices, errors, architecture, level, " +
        "curriculum, questions, concepts, keywords, glossary, examples, steps. " +
        "Becomes queryable via get_analysis and feeds comparisons/courses.",
      inputSchema: {
        url: z.string().url().optional().describe("The same URL used in get_transcript"),
        filePath: z.string().optional(),
        facets: z.record(FacetKind, z.array(FacetItem)),
        analyzedBy: z
          .string()
          .default("client-llm")
          .describe("Identifier of the model that did the analysis"),
      },
    },
    ({ url, filePath, facets, analyzedBy }) => {
      const { config, content, analysisRepo } = getContext();
      if ((url ? 1 : 0) + (filePath ? 1 : 0) !== 1) {
        return json({ error: "bad_request", message: "Pass exactly one: url or filePath" });
      }
      const source: SourceRef = url
        ? { type: "url", url }
        : { type: "file", filePath: filePath ?? "" };
      const hash = sourceHash(source);
      const contentItemId = content.findIdByHash(hash);
      if (contentItemId === null) {
        return json({
          error: "content_not_found",
          message:
            "First get the transcript with get_transcript(url) — that registers the content.",
        });
      }
      const item = content.getItem(contentItemId);
      const analysisId = analysisRepo.create(contentItemId, config.app.pipelineVersion, "standard");
      const doc = AnalysisDocument.parse({
        schemaVersion: 1,
        contentHash: hash,
        title: item?.title ?? url ?? filePath ?? "untitled",
        sourceUrl: url ?? undefined,
        provider: item?.provider ?? "unknown",
        language: item?.language ?? undefined,
        durationSec: item?.durationSec ?? undefined,
        facets,
        warnings: [],
        ai: { engine: "client", model: analyzedBy },
        createdAt: new Date().toISOString(),
      });
      analysisRepo.complete(analysisId, doc);
      return json({
        status: "saved",
        analysisId,
        facetsStored: Object.entries(facets).map(([k, v]) => `${k}(${String(v.length)})`),
        hint: "Retrievable via get_analysis(analysisId) or get_analysis(url)",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
