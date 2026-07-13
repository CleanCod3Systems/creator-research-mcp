import { describe, expect, it } from "vitest";
import { canonicalizeUrl, contentHash } from "./content.js";

describe("canonicalizeUrl", () => {
  it("removes tracking parameters and hash", () => {
    expect(canonicalizeUrl("https://YouTube.com/watch?v=abc&utm_source=x&si=123#t=5")).toBe(
      "https://youtube.com/watch?v=abc",
    );
  });
});

describe("contentHash", () => {
  it("is stable for the same input and ignores tracking", () => {
    const a = contentHash(
      { type: "url", url: "https://youtu.be/x?si=1" },
      "standard",
      "1",
      "free-local",
    );
    const b = contentHash(
      { type: "url", url: "https://youtu.be/x" },
      "standard",
      "1",
      "free-local",
    );
    expect(a).toBe(b);
  });
  it("changes if depth or pipelineVersion changes", () => {
    const base = contentHash({ type: "url", url: "https://youtu.be/x" }, "standard", "1", "p");
    expect(contentHash({ type: "url", url: "https://youtu.be/x" }, "full", "1", "p")).not.toBe(
      base,
    );
    expect(contentHash({ type: "url", url: "https://youtu.be/x" }, "standard", "2", "p")).not.toBe(
      base,
    );
  });
});
