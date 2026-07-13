import { describe, expect, it } from "vitest";
import { YouTubeProvider } from "./youtube.js";

describe("YouTubeProvider.classify", () => {
  const p = new YouTubeProvider();

  it.each([
    ["https://www.youtube.com/@midudev", "channel"],
    ["https://www.youtube.com/@midudev/videos", "channel"],
    ["https://www.youtube.com/@midudev/streams", "channel"],
    ["https://www.youtube.com/channel/UC8LeXCWOalN8SxlrPcG-PaQ", "channel"],
    ["https://www.youtube.com/c/midudev", "channel"],
    ["https://www.youtube.com/user/midudev", "channel"],
    ["https://www.youtube.com/midudev", "channel"], // legacy vanity without prefix (the reported bug)
    ["https://www.youtube.com/midudev/videos", "channel"], // legacy vanity + tab
    ["https://www.youtube.com/playlist?list=abc", "playlist"],
    ["https://www.youtube.com/watch?v=abc123", "video"],
    ["https://www.youtube.com/embed/abc123", "video"],
    ["https://www.youtube.com/v/abc123", "video"],
    ["https://www.youtube.com/live/abc123", "video"],
    ["https://youtu.be/abc123", "video"], // must not be confused with a single-segment vanity
    ["https://www.youtube.com/shorts/abc123", "short"],
  ])("%s → %s", (url, expected) => {
    expect(p.classify(url)).toBe(expected);
  });

  it.each([
    "https://www.youtube.com/results?search_query=astro", // search results page, not content
    "https://www.youtube.com/feed/trending",
    "https://www.youtube.com/",
  ])("%s → explicit error, NEVER assumes 'video' by default", (url) => {
    expect(() => p.classify(url)).toThrow(/Unrecognized YouTube URL format/);
  });
});
