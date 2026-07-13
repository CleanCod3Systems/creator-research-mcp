import { describe, expect, it } from "vitest";
import { extractYoutubeVideoId, findHeatMarkers } from "./youtube-heatmap.js";

describe("extractYoutubeVideoId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=abc123", "abc123"],
    ["https://youtu.be/abc123", "abc123"],
    ["https://youtu.be/abc123?si=xyz", "abc123"],
    ["https://www.youtube.com/shorts/abc123", "abc123"],
    ["https://www.youtube.com/embed/abc123", "abc123"],
    ["https://www.youtube.com/live/abc123", "abc123"],
    ["https://www.youtube.com/@midudev", null], // channel, not a video
  ])("%s → %s", (url, expected) => {
    expect(extractYoutubeVideoId(url)).toBe(expected);
  });
});

describe("findHeatMarkers", () => {
  // real structure verified 2026-07 against YouTube HTML ("entity mutations" format)
  it("finds markersList MARKER_TYPE_HEATMAP no matter how deeply nested", () => {
    const fixture = {
      frameworkUpdates: {
        entityBatchUpdate: {
          mutations: [
            { type: "ENTITY_MUTATION_TYPE_DELETE" },
            {
              type: "ENTITY_MUTATION_TYPE_REPLACE",
              payload: {
                macroMarkersListEntity: {
                  externalVideoId: "abc123",
                  markersList: {
                    markerType: "MARKER_TYPE_HEATMAP",
                    markers: [
                      { startMillis: "0", durationMillis: "2140", intensityScoreNormalized: 0.2 },
                      {
                        startMillis: "2140",
                        durationMillis: "2140",
                        intensityScoreNormalized: 0.9,
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    };
    const result = findHeatMarkers(fixture);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      timeRangeStartMillis: 2140,
      markerDurationMillis: 2140,
      heatMarkerIntensityScoreNormalized: 0.9,
    });
  });

  it("ignores markersList of other markerTypes (e.g. chapters)", () => {
    const fixture = {
      markersList: { markerType: "MARKER_TYPE_CHAPTERS", markers: [{ startMillis: "0" }] },
    };
    expect(findHeatMarkers(fixture)).toEqual([]);
  });

  it("returns [] if there's no heatmap in the tree (video without enough data)", () => {
    expect(findHeatMarkers({ foo: { bar: [1, 2, { baz: "x" }] } })).toEqual([]);
  });
});
