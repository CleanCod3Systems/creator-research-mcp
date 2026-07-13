import { describe, expect, it } from "vitest";
import { safeEqual } from "./http.js";

describe("safeEqual", () => {
  it("true when identical", () => {
    expect(safeEqual("mismo-token-123", "mismo-token-123")).toBe(true);
  });

  it("false when they differ, even by a single character", () => {
    expect(safeEqual("mismo-token-123", "mismo-token-124")).toBe(false);
  });

  it("false when lengths differ (without throwing)", () => {
    expect(safeEqual("corto", "un-token-mucho-mas-largo")).toBe(false);
  });

  it("false with an empty string against a real token", () => {
    expect(safeEqual("", "token-real")).toBe(false);
  });
});
