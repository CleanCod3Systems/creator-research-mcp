/** Mediana: no se deja arrastrar por un solo valor viral, a diferencia del promedio. */
export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const midValue = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return midValue;
  return ((sorted[mid - 1] ?? 0) + midValue) / 2;
}

/** Median Absolute Deviation: dispersión robusta a outliers (a diferencia del desvío estándar). */
export function medianAbsoluteDeviation(nums: number[], center = median(nums)): number {
  if (nums.length === 0) return 0;
  return median(nums.map((n) => Math.abs(n - center)));
}

export interface OutlierResult {
  /** cuántas veces por encima/debajo de la mediana del grupo (1 = igual a la mediana) */
  ratio: number | null;
  /** z-score modificado (0.6745·(x-mediana)/MAD): la forma robusta de medir qué tan atípico es un valor */
  score: number | null;
  /** tamaño del grupo de comparación: pocas muestras → baja confianza aunque el score sea alto */
  sampleSize: number;
  confidence: "low" | "medium" | "high";
}

/**
 * Detección de outliers robusta a valores virales: usa mediana+MAD, no promedio+desvío estándar.
 * Con MAD=0 (todos los valores iguales o casi) el z-score no es fiable → cae a null con confidence baja.
 */
export function detectOutlier(value: number, cohort: number[]): OutlierResult {
  const sampleSize = cohort.length;
  if (sampleSize === 0) {
    return { ratio: null, score: null, sampleSize, confidence: "low" };
  }
  const med = median(cohort);
  const mad = medianAbsoluteDeviation(cohort, med);
  const ratio = med > 0 ? Math.round((value / med) * 100) / 100 : null;
  // 0.6745 normaliza el MAD para que sea comparable a un z-score estándar bajo distribución normal
  const score = mad > 0 ? Math.round(((0.6745 * (value - med)) / mad) * 100) / 100 : null;
  const confidence: OutlierResult["confidence"] =
    sampleSize >= 10 ? "high" : sampleSize >= 4 ? "medium" : "low";
  return { ratio, score, sampleSize, confidence };
}

export interface MetricSnapshotLike {
  observedAt: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

export interface GrowthMetrics {
  viewsDelta: number | null;
  likesDelta: number | null;
  commentsDelta: number | null;
  viewsPerHour: number | null;
  viewsPerDay: number | null;
  engagementPerView: number | null;
  commentsPerLike: number | null;
  contentAgeHours: number | null;
  sampleSize: number;
  /** Explica en texto por qué algún campo quedó null — nunca se inventa un denominador. */
  limitations: string[];
}

/**
 * Deltas y velocidad a partir de snapshots con timestamp. Nunca divide por un denominador
 * ausente o cero: cualquier métrica que no se pueda calcular con certeza queda `null`, con la
 * razón explicada en `limitations` (nunca se adivina).
 */
export function computeGrowthMetrics(
  snapshots: MetricSnapshotLike[],
  publishedAt: string | null,
  now: Date,
): GrowthMetrics {
  const limitations: string[] = [];
  const sorted = [...snapshots].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const empty: GrowthMetrics = {
    viewsDelta: null,
    likesDelta: null,
    commentsDelta: null,
    viewsPerHour: null,
    viewsPerDay: null,
    engagementPerView: null,
    commentsPerLike: null,
    contentAgeHours: null,
    sampleSize: sorted.length,
    limitations,
  };
  if (!first || !last) {
    limitations.push("Sin snapshots todavía: necesita al menos una medición histórica");
    return empty;
  }

  const elapsedHours =
    (new Date(last.observedAt).getTime() - new Date(first.observedAt).getTime()) / 3_600_000;
  const viewsDelta =
    first.viewCount !== null && last.viewCount !== null ? last.viewCount - first.viewCount : null;
  if (viewsDelta === null) limitations.push("Falta viewCount en el primer o el último snapshot");
  const likesDelta =
    first.likeCount !== null && last.likeCount !== null ? last.likeCount - first.likeCount : null;
  const commentsDelta =
    first.commentCount !== null && last.commentCount !== null
      ? last.commentCount - first.commentCount
      : null;

  let viewsPerHour: number | null = null;
  if (viewsDelta !== null && elapsedHours > 0) {
    viewsPerHour = Math.round((viewsDelta / elapsedHours) * 100) / 100;
  } else if (elapsedHours <= 0) {
    limitations.push(
      "Los snapshots disponibles son del mismo momento: falta ventana de tiempo para medir velocidad",
    );
  }
  const viewsPerDay = viewsPerHour !== null ? Math.round(viewsPerHour * 24 * 100) / 100 : null;

  const engagementPerView =
    last.viewCount && last.viewCount > 0 && last.likeCount !== null && last.commentCount !== null
      ? Math.round(((last.likeCount + last.commentCount) / last.viewCount) * 10_000) / 10_000
      : null;
  if (engagementPerView === null)
    limitations.push("Falta views, likes o comments del snapshot más reciente");

  const commentsPerLike =
    last.likeCount && last.likeCount > 0 && last.commentCount !== null
      ? Math.round((last.commentCount / last.likeCount) * 10_000) / 10_000
      : null;

  const contentAgeHours = publishedAt
    ? Math.round(((now.getTime() - new Date(publishedAt).getTime()) / 3_600_000) * 10) / 10
    : null;
  if (contentAgeHours === null) limitations.push("Fecha de publicación desconocida");

  return {
    viewsDelta,
    likesDelta,
    commentsDelta,
    viewsPerHour,
    viewsPerDay,
    engagementPerView,
    commentsPerLike,
    contentAgeHours,
    sampleSize: sorted.length,
    limitations,
  };
}
