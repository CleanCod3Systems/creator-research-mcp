import { describe, expect, it } from "vitest";
import { buildMetadataDetails, buildMetadataLimitations } from "./transcript.js";

describe("metadata details", () => {
  it("preserves available fields and uses null for absent optional metadata", () => {
    expect(
      buildMetadataDetails({
        authorHandle: "creator",
        thumbnailUrl: "https://example.com/thumb.jpg",
        isCarousel: true,
        itemCount: 3,
      }),
    ).toEqual({
      authorHandle: "creator",
      authorId: null,
      authorUrl: null,
      thumbnailUrl: "https://example.com/thumb.jpg",
      mediaType: null,
      availability: null,
      mediaItems: null,
      isCarousel: true,
      itemCount: 3,
      width: null,
      height: null,
      fps: null,
      resolution: null,
      fetchedAt: null,
    });
  });

  it("preserves video technical metadata when the provider has it", () => {
    expect(
      buildMetadataDetails({ width: 1920, height: 1080, fps: 30, resolution: "1920x1080" }),
    ).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 30,
      resolution: "1920x1080",
    });
  });
});

describe("metadata limitations", () => {
  it("reports missing metrics without inventing replacements", () => {
    expect(
      buildMetadataLimitations({
        viewCount: undefined,
        likeCount: 10,
        commentCount: undefined,
        limitations: ["The item is ephemeral"],
      }),
    ).toEqual([
      "The item is ephemeral",
      "The provider did not expose a view count",
      "The provider did not expose a comment count",
    ]);
  });

  it("deduplicates provider and generic limitations", () => {
    expect(
      buildMetadataLimitations({
        viewCount: undefined,
        limitations: ["The provider did not expose a view count"],
      }),
    ).toEqual([
      "The provider did not expose a view count",
      "The provider did not expose a like count",
      "The provider did not expose a comment count",
    ]);
  });
});
