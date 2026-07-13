import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnalysisDocument, FacetItem } from "@creator-research/core";
import { z } from "zod";
import { getContext, getGenRepo, getSearchRepo } from "../context.js";

interface SourceRefLite {
  analysisId: number;
  title: string;
  url: string | null;
}

interface Topic {
  topic: string;
  detail?: string;
  level: string;
  sources: SourceRefLite[];
}

const LEVEL_ORDER = ["beginner", "intermediate", "advanced"] as const;

function collectDocs(analysisIds: number[] | undefined): {
  docs: Map<number, AnalysisDocument>;
  missing: number[];
} {
  const { analysisRepo } = getContext();
  const ids =
    analysisIds ??
    getSearchRepo()
      .listAnalyses(100)
      .filter((a) => a.status === "done")
      .map((a) => a.id);
  const docs = new Map<number, AnalysisDocument>();
  const missing: number[] = [];
  for (const id of ids) {
    const a = analysisRepo.getById(id);
    if (a?.document && a.status === "done") docs.set(id, a.document);
    else missing.push(id);
  }
  return { docs, missing };
}

/** Deduplicates items by normalized value, merging sources. */
function dedupeTopics(
  docs: Map<number, AnalysisDocument>,
  kinds: ("curriculum" | "concepts" | "technologies")[],
): Topic[] {
  const seen = new Map<string, Topic>();
  for (const [id, d] of docs) {
    const src: SourceRefLite = { analysisId: id, title: d.title, url: d.sourceUrl ?? null };
    const level = d.facets.level?.[0]?.value ?? "intermediate";
    for (const kind of kinds) {
      for (const item of (d.facets[kind] ?? []) as FacetItem[]) {
        const key = item.value.trim().toLowerCase();
        const existing = seen.get(key);
        if (existing) {
          if (!existing.sources.some((s) => s.analysisId === id)) existing.sources.push(src);
        } else {
          seen.set(key, { topic: item.value, detail: item.detail, level, sources: [src] });
        }
      }
    }
  }
  return [...seen.values()];
}

export function registerGenerateTools(server: McpServer): void {
  server.registerTool(
    "generate_course",
    {
      title: "Generate course skeleton",
      description:
        "Assembles a course from N analyses: deduplicates topics repeated across videos, preserves teaching " +
        "order, and groups them into modules, with a reference to the source of each lesson. Returns a curated " +
        "SKELETON with references (not copied content): refine module names and write exercises and the " +
        "final project yourself. Without analysisIds it uses all done analyses.",
      inputSchema: {
        title: z.string().default("Curso generado"),
        analysisIds: z.array(z.number().int().positive()).min(1).max(20).optional(),
        lessonsPerModule: z.number().int().min(2).max(10).default(5),
      },
    },
    ({ title, analysisIds, lessonsPerModule }) => {
      const { docs, missing } = collectDocs(analysisIds);
      if (docs.size === 0)
        return json({
          error: "no_analyses",
          missing,
          hint: "Analyze content first: get_transcript + save_analysis",
        });

      // syllabus in order of appearance, deduplicated across sources
      const lessons = dedupeTopics(docs, ["curriculum"]);
      if (lessons.length === 0) {
        return json({
          error: "no_curriculum",
          hint: "The analyses don't have a curriculum facet (use depth standard or full when analyzing)",
        });
      }
      // order: beginner → intermediate → advanced, stable within each level
      lessons.sort(
        (a, b) =>
          LEVEL_ORDER.indexOf(a.level as (typeof LEVEL_ORDER)[number]) -
          LEVEL_ORDER.indexOf(b.level as (typeof LEVEL_ORDER)[number]),
      );

      const modules = [];
      for (let i = 0; i < lessons.length; i += lessonsPerModule) {
        const chunk = lessons.slice(i, i + lessonsPerModule);
        modules.push({
          title: `Module ${String(modules.length + 1)} (rename based on content)`,
          lessons: chunk.map((l) => ({
            topic: l.topic,
            detail: l.detail,
            sources: l.sources.map(
              (s) => `#${String(s.analysisId)} ${s.title}${s.url ? ` <${s.url}>` : ""}`,
            ),
          })),
        });
      }
      const deduped =
        [...docs.values()].reduce((acc, d) => acc + (d.facets.curriculum?.length ?? 0), 0) -
        lessons.length;
      const structure = {
        modules,
        stats: { sources: docs.size, lessons: lessons.length, duplicatesRemoved: deduped },
      };
      const courseId = getGenRepo().insertCourse(title, [...docs.keys()], null, structure);
      return json({
        courseId,
        ...structure,
        nextSteps: [
          "Rename the modules based on their actual content",
          "Write 2-3 exercises per module and a final project covering ≥70% of the topics",
          "The sources tell you which video covers each lesson (to cite or go deeper)",
        ],
      });
    },
  );

  server.registerTool(
    "generate_roadmap",
    {
      title: "Generate learning roadmap",
      description:
        "Builds a roadmap from accumulated knowledge: technologies and concepts from the corpus ordered " +
        "by level (beginner → advanced), with the sources covering each topic and a Mermaid diagram. " +
        "Each node comes from the analyzed corpus (traceable) — add any missing domain topics yourself, " +
        "marking them as your own suggestion. Without analysisIds it uses everything analyzed.",
      inputSchema: {
        domain: z.enum(["frontend", "backend", "ai", "devops", "custom"]).default("custom"),
        goal: z
          .string()
          .optional()
          .describe("Goal if domain=custom, e.g. 'master React with AI'"),
        analysisIds: z.array(z.number().int().positive()).min(1).max(50).optional(),
      },
    },
    ({ domain, goal, analysisIds }) => {
      const { docs } = collectDocs(analysisIds);
      if (docs.size === 0) return json({ error: "no_analyses", hint: "Analyze content first" });

      const topics = dedupeTopics(docs, ["concepts", "technologies"]);
      if (topics.length === 0)
        return json({
          error: "no_topics",
          hint: "The analyses don't have concepts/technologies extracted",
        });

      const levels: Record<string, { topic: string; detail?: string; coveredBy: string[] }[]> = {
        beginner: [],
        intermediate: [],
        advanced: [],
      };
      for (const t of topics) {
        const bucket = LEVEL_ORDER.includes(t.level as (typeof LEVEL_ORDER)[number])
          ? t.level
          : "intermediate";
        levels[bucket]?.push({
          topic: t.topic,
          detail: t.detail,
          coveredBy: t.sources.map((s) => `#${String(s.analysisId)} ${s.title}`),
        });
      }

      const mermaidNode = (s: string): string => s.replace(/["[\]{}()]/g, "").slice(0, 40);
      const mermaid = [
        "graph TD",
        ...LEVEL_ORDER.flatMap((lvl, i) => {
          const nodes = levels[lvl] ?? [];
          const lines = nodes.map(
            (n, j) => `  ${lvl[0] ?? "x"}${String(j)}["${mermaidNode(n.topic)}"]`,
          );
          if (i > 0 && nodes.length > 0) {
            const prev = LEVEL_ORDER[i - 1];
            const prevNodes = levels[prev ?? "beginner"] ?? [];
            if (prevNodes.length > 0)
              lines.push(`  ${(prev ?? "b")[0] ?? "b"}0 --> ${lvl[0] ?? "x"}0`);
          }
          return lines;
        }),
      ].join("\n");

      const graph = { domain, goal: goal ?? null, levels, nodeSource: "corpus" };
      const roadmapId = getGenRepo().insertRoadmap(domain, [...docs.keys()], graph, { mermaid });
      return json({
        roadmapId,
        domain,
        goal: goal ?? null,
        levels,
        mermaid,
        honestNote:
          "All nodes come from the analyzed corpus. If the domain has obvious uncovered areas, add them marked as your own suggestion (not from the corpus).",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
