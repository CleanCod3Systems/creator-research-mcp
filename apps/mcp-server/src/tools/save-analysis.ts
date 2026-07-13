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
 * Cierra el loop del modo client-reasoning: el LLM del cliente analizó el
 * transcript en la conversación y acá persiste las facetas estructuradas,
 * dejándolas disponibles para get_analysis, comparaciones y cursos futuros.
 */
export function registerSaveAnalysisTool(server: McpServer): void {
  server.registerTool(
    "save_analysis",
    {
      title: "Guardar análisis",
      description:
        "Persiste un análisis hecho por vos (el LLM cliente) sobre un transcript obtenido con get_transcript. " +
        "facets: objeto {facetKind: [{value, detail?, confidence?}]}. Kinds válidos: summary, conclusions, " +
        "technologies, frameworks, tools, code, best_practices, bad_practices, errors, architecture, level, " +
        "curriculum, questions, concepts, keywords, glossary, examples, steps. " +
        "Queda consultable con get_analysis y alimenta comparaciones/cursos.",
      inputSchema: {
        url: z.string().url().optional().describe("La misma URL usada en get_transcript"),
        filePath: z.string().optional(),
        facets: z.record(FacetKind, z.array(FacetItem)),
        analyzedBy: z
          .string()
          .default("client-llm")
          .describe("Identificación del modelo que analizó"),
      },
    },
    ({ url, filePath, facets, analyzedBy }) => {
      const { config, content, analysisRepo } = getContext();
      if ((url ? 1 : 0) + (filePath ? 1 : 0) !== 1) {
        return json({ error: "bad_request", message: "Pasá exactamente uno: url o filePath" });
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
            "Primero obtené el transcript con get_transcript(url) — eso registra el contenido.",
        });
      }
      const item = content.getItem(contentItemId);
      const analysisId = analysisRepo.create(contentItemId, config.app.pipelineVersion, "standard");
      const doc = AnalysisDocument.parse({
        schemaVersion: 1,
        contentHash: hash,
        title: item?.title ?? url ?? filePath ?? "sin título",
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
        hint: "Recuperable con get_analysis(analysisId) o get_analysis(url)",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
