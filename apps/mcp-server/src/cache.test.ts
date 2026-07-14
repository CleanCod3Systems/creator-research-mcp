import { describe, expect, it } from "vitest";
import { cacheAgeSeconds } from "./cache.js";

describe("cacheAgeSeconds", () => {
  it("returns the elapsed age in seconds", () => {
    expect(
      cacheAgeSeconds("2026-01-01T00:00:00.000Z", Date.parse("2026-01-01T00:01:05.999Z")),
    ).toBe(65);
  });

  it("does not report negative age for a future timestamp", () => {
    expect(
      cacheAgeSeconds("2026-01-01T00:02:00.000Z", Date.parse("2026-01-01T00:01:00.000Z")),
    ).toBe(0);
  });

  it("returns null for missing or invalid timestamps", () => {
    expect(cacheAgeSeconds(null)).toBeNull();
    expect(cacheAgeSeconds("not-a-date")).toBeNull();
  });
});
