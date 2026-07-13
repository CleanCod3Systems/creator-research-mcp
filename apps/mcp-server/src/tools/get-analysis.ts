import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FacetKind, analysisToMarkdown, analysisToText, sourceHash } from "@cleancod3/core";
import { z } from "zod";
import { getContext } from "../context.js";

export function registerGetAnalysisTool(server: McpServer): void {
  server.registerTool(
    "get_analysis",
    {
      title: "Get an analysis",
      description:
        "Returns an existing analysis by analysisId or by url (finds the latest done analysis for that URL). " +
        "sections filters facets; format: markdown (default) | json | text.",
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
        return text(JSON.stringify({ error: "bad_request", message: "Pass analysisId or url" }));
      }

      if (!doc) {
        return text(
          JSON.stringify({
            error: "not_found",
            message: "No done analysis for that reference. Did you run analyze first?",
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
