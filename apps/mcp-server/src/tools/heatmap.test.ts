import { describe, expect, it } from "vitest";
import { formatTimestamp } from "./heatmap.js";

describe("formatTimestamp", () => {
  it.each([
    [0, "0:00"],
    [65, "1:05"],
    [713, "11:53"],
    [659.6, "11:00"], // rounds the total, not the remainder: avoids the "10:60" carry
    [3599.9, "60:00"],
  ])("%s seg → %s", (sec, expected) => {
    expect(formatTimestamp(sec)).toBe(expected);
  });
});
