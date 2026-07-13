import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FacetKind, analysisToMarkdown, analysisToText, sourceHash } from "@creator-research/core";
import { z } from "zod";
import { getContext } from "../context.js";

export function registerGetAnalysisTool(server: McpServer): void {
  server.registerTool(
    "get_analysis",
    {
      title: "Obtener un análisis",
      description:
        "Devuelve un análisis existente por analysisId o por url (busca el último análisis done de esa URL). " +
        "sections filtra facetas; format: markdown (default) | json | text.",
      inputSchema: {
        analysisId: z.number().int().positive().optional(),
        url: z.string().url().optional(),
        sections: z.array(FacetKind).optional(),
        format: z.enum(["markdown", "json", "text"]).default("markdown"),
      },
    },
    ({ analysisId, url, sections, format }) => {
      const { analysisRepo } = getContext();

      let doc = null;
      if (analysisId !== undefined) {
        doc = analysisRepo.getById(analysisId)?.document ?? null;
      } else if (url) {
        doc = analysisRepo.getLatestDoneByHash(sourceHash({ type: "url", url }))?.document ?? null;
      } else {
        return text(JSON.stringify({ error: "bad_request", message: "Pasá analysisId o url" }));
      }

      if (!doc) {
        return text(
          JSON.stringify({
            error: "not_found",
            message: "No hay análisis done para esa referencia. ¿Corriste analyze primero?",
          }),
        );
      }
      if (format === "json") {
        const filtered = sections
          ? {
              ...doc,
              facets: Object.fromEntries(
                Object.entries(doc.facets).filter(([k]) => (sections as string[]).includes(k)),
              ),
            }
          : doc;
        return text(JSON.stringify(filtered, null, 2));
      }
      return text(
        format === "markdown" ? analysisToMarkdown(doc, sections) : analysisToText(doc, sections),
      );
    },
  );
}

function text(value: string): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: value }] };
}
