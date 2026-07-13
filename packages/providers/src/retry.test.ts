import { describe, expect, it, vi } from "vitest";
import { isTransientHttpError, withRetry } from "./retry.js";

describe("withRetry", () => {
  it("returns the result if the first call succeeds (no retries)", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, { baseDelayMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to the limit and then rethrows the error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("HTTP 503"));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow("HTTP 503");
    expect(fn).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
  });

  it("recovers if it fails once and the second call succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 429"))
      .mockResolvedValueOnce("recovered");
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry if isRetryable says no (e.g. an auth error)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("401 unauthorized"));
    await expect(
      withRetry(fn, { retries: 3, baseDelayMs: 1, isRetryable: isTransientHttpError }),
    ).rejects.toThrow("401");
    expect(fn).toHaveBeenCalledTimes(1); // no retries, fails fast
  });
});

describe("isTransientHttpError", () => {
  it.each([
    ["yt-dlp http://x responded 429: too many requests", true],
    ["YouTube HTTP 500 while requesting the page", true],
    ["fetch failed", true],
    ["Instagram requires authentication for this content", false],
    ["HTTP 404 while fetching https://x", false],
    ["Not a tweet URL", false],
  ])("%s → %s", (msg, expected) => {
    expect(isTransientHttpError(new Error(msg))).toBe(expected);
  });
});
