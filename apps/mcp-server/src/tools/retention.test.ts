import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "@cleancod3/core";
import type { HeatmapPoint } from "@cleancod3/providers";
import { withTranscript } from "./retention.js";

describe("withTranscript", () => {
  const segments: TranscriptSegment[] = [
    { start: 0, end: 5, text: "intro" },
    { start: 5, end: 10, text: "the actual hook" },
    { start: 10, end: 15, text: "more context" },
  ];

  it("joins every transcript segment overlapping the heatmap window", () => {
    const point: HeatmapPoint = { startSec: 4, durationSec: 3, intensity: 0.9 };
    expect(withTranscript(point, segments).saidAtThisMoment).toBe("intro the actual hook");
  });

  it("returns null when no transcript segment overlaps the window", () => {
    const point: HeatmapPoint = { startSec: 100, durationSec: 5, intensity: 0.9 };
    expect(withTranscript(point, segments).saidAtThisMoment).toBeNull();
  });

  it("matches a window fully inside a single segment", () => {
    const point: HeatmapPoint = { startSec: 6, durationSec: 1, intensity: 0.9 };
    expect(withTranscript(point, segments).saidAtThisMoment).toBe("the actual hook");
  });

  it("rounds startSec/durationSec/intensity for display", () => {
    const point: HeatmapPoint = { startSec: 4.6, durationSec: 2.4, intensity: 0.9231 };
    const result = withTranscript(point, segments);
    expect(result.startSec).toBe(5);
    expect(result.durationSec).toBe(2);
    expect(result.intensity).toBe(0.92);
  });
});
