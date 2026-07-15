import { afterEach, describe, expect, it, vi } from "vitest";
import { getTrendingVideos } from "./youtube-api.js";

describe("getTrendingVideos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parsea la respuesta de chart=mostPopular y arma la URL con los params correctos", async () => {
    let requestedUrl: URL | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: URL) => {
        requestedUrl = url;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                {
                  id: "abc123",
                  snippet: {
                    channelId: "UCchannel1",
                    title: "Video en tendencia",
                    description: "",
                    publishedAt: "2026-07-01T00:00:00Z",
                    tags: ["ia", "tech"],
                  },
                  statistics: { viewCount: "5000000", likeCount: "300000" },
                  contentDetails: { duration: "PT10M30S" },
                },
              ],
            }),
        } as Response);
      }),
    );

    const videos = await getTrendingVideos("US", "28", 10, "fake-key");

    expect(videos).toHaveLength(1);
    expect(videos[0]).toEqual({
      id: "abc123",
      channelId: "UCchannel1",
      title: "Video en tendencia",
      description: "",
      publishedAt: "2026-07-01T00:00:00Z",
      durationSec: 630,
      viewCount: 5_000_000,
      likeCount: 300_000,
      commentCount: null,
      tags: ["ia", "tech"],
    });
    expect(requestedUrl?.searchParams.get("chart")).toBe("mostPopular");
    expect(requestedUrl?.searchParams.get("regionCode")).toBe("US");
    expect(requestedUrl?.searchParams.get("videoCategoryId")).toBe("28");
  });

  it("propaga un error legible si la API responde con un status no-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          text: () => Promise.resolve("quota exceeded"),
        } as Response),
      ),
    );

    await expect(getTrendingVideos("US", undefined, 10, "fake-key")).rejects.toThrow(/403/);
  });
});
