const STOPWORDS = new Set([
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "que",
  "y",
  "a",
  "en",
  "un",
  "una",
  "unos",
  "unas",
  "es",
  "por",
  "para",
  "mi",
  "tu",
  "su",
  "al",
  "lo",
  "se",
  "no",
  "si",
  "mas",
  "pero",
  "como",
  "esta",
  "este",
  "eso",
  "esa",
  "muy",
  "the",
  "an",
  "of",
  "to",
  "in",
  "and",
  "is",
  "how",
  "this",
  "that",
  "for",
  "on",
  "with",
  "you",
  "your",
  "it",
  "was",
  "are",
  "but",
  "have",
  "has",
]);

/** Strips accents, URLs, @mentions/#hashtags and stopwords — literal tokens, no semantic analysis. */
export function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#]\w+/g, " ");
  return normalized.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export interface TextCluster {
  memberIndices: number[];
}

/**
 * Groups texts by shared vocabulary using TF-IDF-weighted cosine similarity — a classic,
 * fully deterministic technique (no embeddings, no model, no network call). Good enough to
 * group "how do I do X in dark mode" with "any dark theme version?" when they share enough
 * distinctive terms; won't catch purely semantic paraphrases with zero word overlap.
 */
export function clusterBySharedTerms(texts: string[], minSimilarity = 0.2): TextCluster[] {
  const tokenized = texts.map(tokenize);
  const n = texts.length;

  const docFrequency = new Map<string, number>();
  for (const tokens of tokenized) {
    for (const term of new Set(tokens)) docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, df] of docFrequency) idf.set(term, Math.log((n + 1) / (df + 0.5)));

  const vectors = tokenized.map((tokens) => {
    const termFrequency = new Map<string, number>();
    for (const term of tokens) termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
    const vector = new Map<string, number>();
    for (const [term, count] of termFrequency) vector.set(term, count * (idf.get(term) ?? 0));
    return vector;
  });

  const assigned = new Array<boolean>(n).fill(false);
  const clusters: TextCluster[] = [];
  for (let i = 0; i < n; i++) {
    const vectorI = vectors[i];
    if (assigned[i] || !vectorI || vectorI.size === 0) {
      assigned[i] = true; // no meaningful tokens (emoji-only, too short) — excluded, not its own cluster
      continue;
    }
    const members = [i];
    assigned[i] = true;
    for (let j = i + 1; j < n; j++) {
      const vectorJ = vectors[j];
      if (assigned[j] || !vectorJ || vectorJ.size === 0) continue;
      if (cosineSimilarity(vectorI, vectorJ) >= minSimilarity) {
        members.push(j);
        assigned[j] = true;
      }
    }
    clusters.push({ memberIndices: members });
  }
  return clusters;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let normA = 0;
  for (const v of a.values()) normA += v * v;
  let normB = 0;
  for (const v of b.values()) normB += v * v;
  if (normA === 0 || normB === 0) return 0;
  const [smaller, bigger] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, v] of smaller) {
    const other = bigger.get(term);
    if (other !== undefined) dot += v * other;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
