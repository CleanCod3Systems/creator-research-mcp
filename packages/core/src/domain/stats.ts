/** Median: unlike the mean, it isn't dragged by a single viral value. */
export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const midValue = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return midValue;
  return ((sorted[mid - 1] ?? 0) + midValue) / 2;
}

/** Median Absolute Deviation: dispersion robust to outliers (unlike standard deviation). */
export function medianAbsoluteDeviation(nums: number[], center = median(nums)): number {
  if (nums.length === 0) return 0;
  return median(nums.map((n) => Math.abs(n - center)));
}

export interface OutlierResult {
  /** how many times above/below the cohort's median (1 = equal to the median) */
  ratio: number | null;
  /** modified z-score (0.6745·(x-median)/MAD): the robust way to measure how atypical a value is */
  score: number | null;
  /** size of the comparison group: few samples → low confidence even if the score is high */
  sampleSize: number;
  confidence: "low" | "medium" | "high";
}

/**
 * Outlier detection robust to viral values: uses median+MAD, not mean+standard deviation.
 * With MAD=0 (all values equal or nearly so) the z-score isn't reliable → falls back to null with low confidence.
 */
export function detectOutlier(value: number, cohort: number[]): OutlierResult {
  const sampleSize = cohort.length;
  if (sampleSize === 0) {
    return { ratio: null, score: null, sampleSize, confidence: "low" };
  }
  const med = median(cohort);
  const mad = medianAbsoluteDeviation(cohort, med);
  const ratio = med > 0 ? Math.round((value / med) * 100) / 100 : null;
  // 0.6745 normalizes the MAD so it's comparable to a standard z-score under a normal distribution
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
  /** Text explanation of why some field ended up null — a denominator is never invented. */
  limitations: string[];
}

/**
 * Deltas and velocity from timestamped snapshots. Never divides by an absent or zero
 * denominator: any metric that can't be calculated with certainty stays `null`, with the
 * reason explained in `limitations` (never guessed).
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
    limitations.push("No snapshots yet: needs at least one historical measurement");
    return empty;
  }

  const elapsedHours =
    (new Date(last.observedAt).getTime() - new Date(first.observedAt).getTime()) / 3_600_000;
  const viewsDelta =
    first.viewCount !== null && last.viewCount !== null ? last.viewCount - first.viewCount : null;
  if (viewsDelta === null) limitations.push("Missing viewCount in the first or last snapshot");
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
      "The available snapshots are from the same moment: missing a time window to measure velocity",
    );
  }
  const viewsPerDay = viewsPerHour !== null ? Math.round(viewsPerHour * 24 * 100) / 100 : null;

  const engagementPerView =
    last.viewCount && last.viewCount > 0 && last.likeCount !== null && last.commentCount !== null
      ? Math.round(((last.likeCount + last.commentCount) / last.viewCount) * 10_000) / 10_000
      : null;
  if (engagementPerView === null)
    limitations.push("Missing views, likes, or comments from the most recent snapshot");

  const commentsPerLike =
    last.likeCount && last.likeCount > 0 && last.commentCount !== null
      ? Math.round((last.commentCount / last.likeCount) * 10_000) / 10_000
      : null;

  const contentAgeHours = publishedAt
    ? Math.round(((now.getTime() - new Date(publishedAt).getTime()) / 3_600_000) * 10) / 10
    : null;
  if (contentAgeHours === null) limitations.push("Publication date unknown");

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
