import { describe, expect, it } from "vitest";
import { isoDurationToSeconds } from "./youtube-api.js";

describe("isoDurationToSeconds", () => {
  it.each([
    ["PT1H2M10S", 3730],
    ["PT12M34S", 754],
    ["PT45S", 45],
    ["PT2H", 7200],
    ["PT0S", 0],
  ])("%s → %i", (iso, expected) => {
    expect(isoDurationToSeconds(iso)).toBe(expected);
  });
});
