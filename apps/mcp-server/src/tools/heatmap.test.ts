import { describe, expect, it } from "vitest";
import { formatTimestamp } from "./heatmap.js";

describe("formatTimestamp", () => {
  it.each([
    [0, "0:00"],
    [65, "1:05"],
    [713, "11:53"],
    [659.6, "11:00"], // redondeo del total, no del resto: evita el carry "10:60"
    [3599.9, "60:00"],
  ])("%s seg → %s", (sec, expected) => {
    expect(formatTimestamp(sec)).toBe(expected);
  });
});
