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
      fetchedAt: null,
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
