import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnalysisDocument, FacetKind } from "@creator-research/core";
import { z } from "zod";
import { getContext, getGenRepo } from "../context.js";

const COMPARABLE: FacetKind[] = [
  "technologies",
  "frameworks",
  "tools",
  "concepts",
  "best_practices",
  "keywords",
  "curriculum",
];

/**
 * Comparación determinista (intersección/diferencia de facetas, puro SQL/JS —
 * sin alucinaciones). La síntesis y el veredicto los hace el LLM cliente
 * sobre esta matriz de evidencia.
 */
export function registerCompareTool(server: McpServer): void {
  server.registerTool(
    "compare",
    {
      title: "Comparar análisis",
      description:
        "Compara 2-10 análisis existentes: qué tecnologías/conceptos/temario comparten y qué es único de cada uno " +
        "(cálculo determinista sobre las facetas guardadas). Ideal para: comparar creadores, detectar solapamiento " +
        "y encontrar huecos de contenido. Sintetizá vos el veredicto sobre la matriz devuelta.",
      inputSchema: {
        analysisIds: z.array(z.number().int().positive()).min(2).max(10),
      },
    },
    ({ analysisIds }) => {
      const { analysisRepo } = getContext();
      const docs = new Map<number, AnalysisDocument>();
      const missing: number[] = [];
      for (const id of analysisIds) {
        const a = analysisRepo.getById(id);
        if (a?.document && a.status === "done") docs.set(id, a.document);
        else missing.push(id);
      }
      if (missing.length > 0) {
        return json({
          error: "missing_analyses",
          missing,
          hint: "Esos IDs no existen o no están en estado done (ver history)",
        });
      }

      const subjects = [...docs.entries()].map(([id, d]) => ({
        analysisId: id,
        title: d.title,
        url: d.sourceUrl ?? null,
        level: d.facets.level?.[0]?.value ?? null,
        summary: d.facets.summary?.[0]?.value ?? null,
      }));

      const byKind: Record<
        string,
        {
          sharedByAll: string[];
          partial: { value: string; presentIn: number[] }[];
          uniquePer: Record<string, string[]>;
        }
      > = {};
      for (const kind of COMPARABLE) {
        const presence = new Map<string, { display: string; ids: Set<number> }>();
        for (const [id, d] of docs) {
          for (const item of d.facets[kind] ?? []) {
            const key = item.value.trim().toLowerCase();
            const entry = presence.get(key) ?? { display: item.value, ids: new Set<number>() };
            entry.ids.add(id);
            presence.set(key, entry);
          }
        }
        if (presence.size === 0) continue;
        const sharedByAll: string[] = [];
        const partial: { value: string; presentIn: number[] }[] = [];
        const uniquePer: Record<string, string[]> = {};
        for (const { display, ids } of presence.values()) {
          if (ids.size === docs.size) sharedByAll.push(display);
          else if (ids.size > 1) partial.push({ value: display, presentIn: [...ids] });
          else {
            const only = String([...ids][0]);
            (uniquePer[only] ??= []).push(display);
          }
        }
        byKind[kind] = { sharedByAll, partial, uniquePer };
      }

      const comparisonId = getGenRepo().insertComparison("videos", analysisIds, {
        subjects,
        byKind,
      });
      return json({
        comparisonId,
        subjects,
        byKind,
        synthesisGuide:
          "Con esta matriz: 1) solapamiento (sharedByAll), 2) fortalezas únicas (uniquePer), " +
          "3) huecos = temas que NINGUNO cubre y la audiencia esperaría del dominio.",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
