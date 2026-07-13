import { describe, expect, it } from "vitest";
import { performanceByFormat, publishFrequencyDays, wordFrequency } from "./creator-analysis.js";

describe("wordFrequency", () => {
  it("counts repeated words, ignores stopwords and short words", () => {
    const titles = [
      "Astro y Tailwind en 10 minutos",
      "Astro para principiantes",
      "Curso de Astro completo",
    ];
    const result = wordFrequency(titles, 5);
    expect(result[0]).toEqual({ word: "astro", count: 3 });
    expect(result.some((r) => r.word === "de")).toBe(false); // stopword
    expect(result.some((r) => r.word === "y")).toBe(false); // too short
  });

  it("normalizes accents to group variants together", () => {
    const result = wordFrequency(["programación en 2026", "aprendé programacion hoy"], 5);
    // "programación" and "programacion" (without accent) must be counted together after normalizing
    const prog = result.find((r) => r.word.startsWith("programaci"));
    expect(prog?.count).toBe(2);
  });
});

describe("publishFrequencyDays", () => {
  it("without at least 2 dates → explicit null, doesn't invent a cadence", () => {
    expect(publishFrequencyDays([])).toEqual({ medianDaysBetweenPosts: null, sampleSize: 0 });
    expect(publishFrequencyDays(["2026-01-01"])).toEqual({
      medianDaysBetweenPosts: null,
      sampleSize: 1,
    });
  });

  it("computes the median days between posts", () => {
    const dates = ["2026-01-01T00:00:00Z", "2026-01-03T00:00:00Z", "2026-01-05T00:00:00Z"];
    expect(publishFrequencyDays(dates)).toEqual({ medianDaysBetweenPosts: 2, sampleSize: 3 });
  });

  it("ignores entries without a date", () => {
    const dates = [undefined, "2026-01-01T00:00:00Z", undefined, "2026-01-08T00:00:00Z"];
    expect(publishFrequencyDays(dates)).toEqual({ medianDaysBetweenPosts: 7, sampleSize: 2 });
  });
});

describe("performanceByFormat", () => {
  it("groups by duration and computes the median views of each bucket", () => {
    const items = [
      { durationSec: 30, viewCount: 1000 }, // short
      { durationSec: 45, viewCount: 3000 }, // short
      { durationSec: 120, viewCount: 500 }, // mid
      { durationSec: 600, viewCount: 100 }, // long
    ];
    const result = performanceByFormat(items);
    const short = result.find((r) => r.bucket === "short(<60s)");
    expect(short).toEqual({ bucket: "short(<60s)", count: 2, medianViews: 2000 });
    // sorted by medianViews descending: the best-performing format goes first
    expect(result[0]?.bucket).toBe("short(<60s)");
  });

  it("videos without duration go to 'unknown', they're not discarded or don't break the calculation", () => {
    const items = [{ viewCount: 500 }, { durationSec: 30, viewCount: 1000 }];
    const result = performanceByFormat(items);
    expect(result.some((r) => r.bucket === "unknown")).toBe(true);
  });
});
