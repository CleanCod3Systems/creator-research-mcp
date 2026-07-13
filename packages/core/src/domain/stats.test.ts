import { describe, expect, it } from "vitest";
import { computeGrowthMetrics, detectOutlier, median, medianAbsoluteDeviation } from "./stats.js";

describe("median", () => {
  it.each([
    [[], 0],
    [[5], 5],
    [[1, 3], 2],
    [[10, 1, 100], 10],
    [[1, 2, 3, 4], 2.5],
  ])("median(%j) → %s", (nums, expected) => {
    expect(median(nums)).toBe(expected);
  });
});

describe("medianAbsoluteDeviation", () => {
  it("measures dispersion robust to an extreme outlier", () => {
    // without the outlier: [1,2,3,4,5] med=3, deviations [2,1,0,1,2] → mad=1
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 5])).toBe(1);
    // with a brutal outlier, the median barely moves, unlike the standard deviation
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 1000])).toBe(1);
  });
});

describe("detectOutlier", () => {
  it("empty cohort → everything null, confidence low", () => {
    expect(detectOutlier(100, [])).toEqual({
      ratio: null,
      score: null,
      sampleSize: 0,
      confidence: "low",
    });
  });

  it("typical value (near the median) → ratio ~1, score ~0", () => {
    const cohort = [100, 110, 90, 105, 95, 100, 108, 98, 102, 97];
    const result = detectOutlier(100, cohort);
    expect(result.ratio).toBeCloseTo(1, 1);
    expect(result.score).not.toBeNull();
    expect(Math.abs(result.score ?? 99)).toBeLessThan(1);
    expect(result.confidence).toBe("high"); // 10 samples
  });

  it("clearly atypical (viral) value → high ratio and score", () => {
    const cohort = [100, 110, 90, 105, 95, 100, 108, 98, 102, 97];
    const result = detectOutlier(5000, cohort);
    expect(result.ratio).toBeGreaterThan(40);
    expect(result.score).toBeGreaterThan(10);
  });

  it("small sample (<4) → confidence low even if the score is high", () => {
    const result = detectOutlier(1000, [100, 110, 90]);
    expect(result.confidence).toBe("low");
  });

  it("MAD=0 (all values equal) → score null, no number is invented", () => {
    const result = detectOutlier(50, [100, 100, 100, 100]);
    expect(result.score).toBeNull();
    expect(result.ratio).toBe(0.5); // the ratio can be calculated without MAD
  });
});

describe("computeGrowthMetrics", () => {
  const now = new Date("2026-07-14T12:00:00Z");

  it("no snapshots → everything null, with the limitation explained", () => {
    const result = computeGrowthMetrics([], null, now);
    expect(result.viewsDelta).toBeNull();
    expect(result.limitations).toContain(
      "No snapshots yet: needs at least one historical measurement",
    );
  });

  it("a single snapshot → no time window, viewsPerHour null explained", () => {
    const snap = {
      observedAt: "2026-07-14T10:00:00Z",
      viewCount: 100,
      likeCount: 10,
      commentCount: 2,
    };
    const result = computeGrowthMetrics([snap], "2026-07-13T10:00:00Z", now);
    expect(result.viewsDelta).toBe(0); // first and last are the same snapshot
    expect(result.viewsPerHour).toBeNull();
    expect(result.limitations.some((l) => l.includes("same moment"))).toBe(true);
  });

  it("two snapshots with a real delta → correctly computes velocity and engagement", () => {
    const snapshots = [
      { observedAt: "2026-07-13T10:00:00Z", viewCount: 1000, likeCount: 100, commentCount: 10 },
      { observedAt: "2026-07-14T10:00:00Z", viewCount: 1240, likeCount: 150, commentCount: 20 },
    ];
    const result = computeGrowthMetrics(snapshots, "2026-07-10T00:00:00Z", now);
    expect(result.viewsDelta).toBe(240);
    expect(result.likesDelta).toBe(50);
    expect(result.commentsDelta).toBe(10);
    expect(result.viewsPerHour).toBe(10); // 240 views / 24 hours
    expect(result.viewsPerDay).toBe(240);
    expect(result.engagementPerView).toBeCloseTo((150 + 20) / 1240, 4);
    expect(result.commentsPerLike).toBeCloseTo(20 / 150, 4);
    expect(result.contentAgeHours).toBeCloseTo(108, 0); // from 07/10 00:00 to 07/14 12:00 = 4.5 days
    expect(result.limitations).toEqual([]);
  });

  it("never divides by an absent denominator: no likes → commentsPerLike null", () => {
    const snapshots = [
      { observedAt: "2026-07-13T10:00:00Z", viewCount: 1000, likeCount: null, commentCount: 10 },
      { observedAt: "2026-07-14T10:00:00Z", viewCount: 1240, likeCount: null, commentCount: 20 },
    ];
    const result = computeGrowthMetrics(snapshots, null, now);
    expect(result.commentsPerLike).toBeNull();
    expect(result.engagementPerView).toBeNull();
    expect(result.likesDelta).toBeNull();
  });
});
