import { describe, expect, it } from "vitest";
import {
  captionToText,
  classifyInstagramPath,
  InstagramProvider,
  instagramAccessErrorMessage,
  relatedMediaItems,
} from "./instagram.js";

describe("InstagramProvider", () => {
  const provider = new InstagramProvider();

  it("matches public Instagram host variants only", () => {
    expect(provider.matches("https://instagram.com/p/ABC123/")).toBe(true);
    expect(provider.matches("https://www.instagram.com/reel/ABC123/")).toBe(true);
    expect(provider.matches("https://m.instagram.com/tv/ABC123/")).toBe(true);
    expect(provider.matches("https://example.com/p/ABC123/")).toBe(false);
  });

  it("classifies individual content and profiles without guessing", () => {
    expect(classifyInstagramPath("/p/ABC123/")).toBe("video");
    expect(classifyInstagramPath("/reel/ABC123/")).toBe("short");
    expect(classifyInstagramPath("/creator/reel/ABC123/")).toBe("short");
    expect(classifyInstagramPath("/creator/")).toBe("channel");
  });

  it("returns the caption as native text when no subtitles exist", () => {
    expect(captionToText({ description: "  A useful caption  ", language: "es" })).toEqual({
      text: "A useful caption",
      source: "native_text",
      language: "es",
    });
  });

  it("returns null when the caption is absent", () => {
    expect(captionToText({ description: "   ", language: null })).toBeNull();
    expect(captionToText({ language: undefined })).toBeNull();
  });

  it("maps carousel entries without inventing missing URLs", () => {
    expect(
      relatedMediaItems([
        {
          id: "media-1",
          title: "First item",
          webpage_url: "https://www.instagram.com/p/media-1/",
          view_count: null,
        },
        { id: "media-2", title: "Second item" },
      ]),
    ).toEqual([
      {
        externalId: "media-1",
        url: "https://www.instagram.com/p/media-1/",
        title: "First item",
        durationSec: undefined,
        thumbnailUrl: undefined,
        mediaType: undefined,
        viewCount: undefined,
        likeCount: undefined,
        commentCount: undefined,
      },
      {
        externalId: "media-2",
        url: undefined,
        title: "Second item",
        durationSec: undefined,
        thumbnailUrl: undefined,
        mediaType: undefined,
        viewCount: undefined,
        likeCount: undefined,
        commentCount: undefined,
      },
    ]);
  });

  it("advertises public comments as best-effort", () => {
    expect(provider.capabilities().supports.comments).toBe(true);
    expect(provider.capabilities().legalNotes).toContain("best-effort");
  });

  it("does not suggest credentials or cookies for restricted content", () => {
    const message = instagramAccessErrorMessage("HTTP 403");
    expect(message).toContain("public content");
    expect(message).toContain("does not request credentials");
    expect(message).not.toContain("YTDLP_EXTRA_ARGS");
    expect(message).not.toContain("cookies-from-browser");
  });
});
