import type { AnalysisDocument, FacetItem, FacetKind } from "../domain/analysis.js";

const FACET_TITLES: Record<FacetKind, string> = {
  summary: "Summary",
  conclusions: "Conclusions",
  technologies: "Technologies",
  frameworks: "Frameworks",
  tools: "Tools",
  code: "Mentioned code",
  best_practices: "Best practices",
  bad_practices: "Bad practices",
  errors: "Detected errors",
  architecture: "Architecture",
  level: "Level",
  curriculum: "Curriculum",
  questions: "Important questions",
  concepts: "Concepts",
  keywords: "Keywords",
  glossary: "Glossary",
  examples: "Examples",
  steps: "Steps",
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
  const meta: string[] = [`Provider: ${doc.provider}`];
  if (doc.sourceUrl) meta.push(`Source: ${doc.sourceUrl}`);
  if (doc.durationSec) meta.push(`Duration: ${ts(doc.durationSec)}`);
  if (doc.ai) meta.push(`AI: ${doc.ai.engine}/${doc.ai.model}`);
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
