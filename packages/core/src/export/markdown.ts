import type { AnalysisDocument, FacetItem, FacetKind } from "../domain/analysis.js";

const FACET_TITLES: Record<FacetKind, string> = {
  summary: "Resumen",
  conclusions: "Conclusiones",
  technologies: "Tecnologías",
  frameworks: "Frameworks",
  tools: "Herramientas",
  code: "Código mencionado",
  best_practices: "Buenas prácticas",
  bad_practices: "Malas prácticas",
  errors: "Errores detectados",
  architecture: "Arquitectura",
  level: "Nivel",
  curriculum: "Temario",
  questions: "Preguntas importantes",
  concepts: "Conceptos",
  keywords: "Palabras clave",
  glossary: "Glosario",
  examples: "Ejemplos",
  steps: "Pasos",
};

function ts(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

function renderItem(item: FacetItem): string {
  let line = `- **${item.value}**`;
  if (item.detail) line += ` — ${item.detail}`;
  if (item.evidence?.timestampSec !== undefined) line += ` _(⏱ ${ts(item.evidence.timestampSec)})_`;
  return line;
}

export function analysisToMarkdown(doc: AnalysisDocument, sections?: FacetKind[]): string {
  const out: string[] = [`# ${doc.title}`, ""];
  const meta: string[] = [`Proveedor: ${doc.provider}`];
  if (doc.sourceUrl) meta.push(`Fuente: ${doc.sourceUrl}`);
  if (doc.durationSec) meta.push(`Duración: ${ts(doc.durationSec)}`);
  if (doc.ai) meta.push(`IA: ${doc.ai.engine}/${doc.ai.model}`);
  out.push(`> ${meta.join(" · ")}`, "");
  if (doc.warnings.length > 0) {
    out.push("> ⚠️ " + doc.warnings.join(" · "), "");
  }
  for (const [kind, title] of Object.entries(FACET_TITLES) as [FacetKind, string][]) {
    if (sections && !sections.includes(kind)) continue;
    const items = doc.facets[kind];
    if (!items || items.length === 0) continue;
    out.push(`## ${title}`, "");
    if (kind === "summary") {
      out.push(...items.map((i) => i.value), "");
    } else {
      out.push(...items.map(renderItem), "");
    }
  }
  return out.join("\n");
}

export function analysisToText(doc: AnalysisDocument, sections?: FacetKind[]): string {
  return analysisToMarkdown(doc, sections)
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^> /gm, "")
    .replace(/^- /gm, "• ");
}
