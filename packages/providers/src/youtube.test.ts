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
    ["https://www.youtube.com/midudev", "channel"], // legacy vanity sin prefijo (el bug reportado)
    ["https://www.youtube.com/midudev/videos", "channel"], // legacy vanity + pestaña
    ["https://www.youtube.com/playlist?list=abc", "playlist"],
    ["https://www.youtube.com/watch?v=abc123", "video"],
    ["https://www.youtube.com/embed/abc123", "video"],
    ["https://www.youtube.com/v/abc123", "video"],
    ["https://www.youtube.com/live/abc123", "video"],
    ["https://youtu.be/abc123", "video"], // no debe confundirse con vanity de un segmento
    ["https://www.youtube.com/shorts/abc123", "short"],
  ])("%s → %s", (url, expected) => {
    expect(p.classify(url)).toBe(expected);
  });

  it.each([
    "https://www.youtube.com/results?search_query=astro", // página de búsqueda, no es contenido
    "https://www.youtube.com/feed/trending",
    "https://www.youtube.com/",
  ])("%s → error explícito, NUNCA asume 'video' por default", (url) => {
    expect(() => p.classify(url)).toThrow(/No reconozco el formato/);
  });
});
