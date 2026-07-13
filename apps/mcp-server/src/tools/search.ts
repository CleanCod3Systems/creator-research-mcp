import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FacetKind } from "@creator-research/core";
import { z } from "zod";
import { getSearchRepo } from "../context.js";

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    "search_knowledge",
    {
      title: "Search accumulated knowledge",
      description:
        "Searches ALL facets of ALL saved analyses. Answers questions like " +
        "'which videos teach Astro?', 'what best practices do I have logged about testing?'. " +
        "kind filters by facet type (technologies, best_practices, concepts...).",
      inputSchema: {
        query: z.string().min(2),
        kind: FacetKind.optional(),
        limit: z.number().int().min(1).max(100).default(30),
      },
    },
    ({ query, kind, limit }) => {
      const rows = getSearchRepo().searchFacets(query, kind, limit);
      const grouped = new Map<
        number,
        { title: string | null; url: string | null; matches: { kind: string; value: string }[] }
      >();
      for (const r of rows) {
        const g = grouped.get(r.analysisId) ?? { title: r.title, url: r.url, matches: [] };
        g.matches.push({ kind: r.kind, value: r.value });
        grouped.set(r.analysisId, g);
      }
      return json({
        query,
        totalMatches: rows.length,
        sources: [...grouped.entries()].map(([analysisId, g]) => ({ analysisId, ...g })),
        hint:
          rows.length === 0
            ? "No results. Have you analyzed content on that topic? (get_transcript + save_analysis)"
            : "get_analysis(analysisId) for details",
      });
    },
  );

  server.registerTool(
    "history",
    {
      title: "Analysis history",
      description: "Lists recent analyses (title, source, status, AI engine used).",
      inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
    },
    ({ limit }) => json({ analyses: getSearchRepo().listAnalyses(limit) }),
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
