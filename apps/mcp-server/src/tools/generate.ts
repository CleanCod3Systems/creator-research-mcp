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

/** Deduplica items por value normalizado, fusionando fuentes. */
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
      title: "Generar esqueleto de curso",
      description:
        "Ensambla un curso desde N análisis: deduplica temas repetidos entre videos, preserva el orden de " +
        "enseñanza y agrupa en módulos, con referencia a la fuente de cada lección. Devuelve un ESQUELETO " +
        "curado con referencias (no contenido copiado): refiná nombres de módulos, redactá ejercicios y " +
        "proyecto final vos. Sin analysisIds usa todos los análisis done.",
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
          hint: "Analizá contenido primero: get_transcript + save_analysis",
        });

      // temario en orden de aparición, deduplicado entre fuentes
      const lessons = dedupeTopics(docs, ["curriculum"]);
      if (lessons.length === 0) {
        return json({
          error: "no_curriculum",
          hint: "Los análisis no tienen faceta curriculum (usá depth standard o full al analizar)",
        });
      }
      // orden: beginner → intermediate → advanced, estable dentro de cada nivel
      lessons.sort(
        (a, b) =>
          LEVEL_ORDER.indexOf(a.level as (typeof LEVEL_ORDER)[number]) -
          LEVEL_ORDER.indexOf(b.level as (typeof LEVEL_ORDER)[number]),
      );

      const modules = [];
      for (let i = 0; i < lessons.length; i += lessonsPerModule) {
        const chunk = lessons.slice(i, i + lessonsPerModule);
        modules.push({
          title: `Módulo ${String(modules.length + 1)} (renombrar según contenido)`,
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
          "Renombrá los módulos según su contenido real",
          "Redactá 2-3 ejercicios por módulo y un proyecto final que cubra ≥70% de los temas",
          "Los sources te dicen qué video cubre cada lección (para citar o profundizar)",
        ],
      });
    },
  );

  server.registerTool(
    "generate_roadmap",
    {
      title: "Generar roadmap de aprendizaje",
      description:
        "Construye un roadmap desde el conocimiento acumulado: tecnologías y conceptos del corpus ordenados " +
        "por nivel (beginner → advanced), con las fuentes que cubren cada tema y un diagrama Mermaid. " +
        "Cada nodo viene del corpus analizado (trazable) — completá vos los temas del dominio que falten, " +
        "marcándolos como sugerencia propia. Sin analysisIds usa todo lo analizado.",
      inputSchema: {
        domain: z.enum(["frontend", "backend", "ai", "devops", "custom"]).default("custom"),
        goal: z
          .string()
          .optional()
          .describe("Objetivo si domain=custom, p.ej. 'dominar React con IA'"),
        analysisIds: z.array(z.number().int().positive()).min(1).max(50).optional(),
      },
    },
    ({ domain, goal, analysisIds }) => {
      const { docs } = collectDocs(analysisIds);
      if (docs.size === 0) return json({ error: "no_analyses", hint: "Analizá contenido primero" });

      const topics = dedupeTopics(docs, ["concepts", "technologies"]);
      if (topics.length === 0)
        return json({
          error: "no_topics",
          hint: "Los análisis no tienen conceptos/tecnologías extraídos",
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
          "Todos los nodos salen del corpus analizado. Si el dominio tiene áreas obvias sin cubrir, agregalas marcadas como sugerencia tuya (no del corpus).",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
