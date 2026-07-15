import { afterEach, describe, expect, it, vi } from "vitest";
import { getChannelAbout, getChannelsStats, resolveChannelRef } from "./youtube-api.js";

describe("resolveChannelRef", () => {
  it("parses a /channel/UC... URL", () => {
    expect(resolveChannelRef("https://www.youtube.com/channel/UCabc123")).toEqual({
      channelId: "UCabc123",
    });
  });

  it("parses a /@handle URL, tab suffix and all", () => {
    expect(resolveChannelRef("https://www.youtube.com/@someuser/videos")).toEqual({
      handle: "@someuser",
    });
  });

  it("parses a bare UC... id", () => {
    expect(resolveChannelRef("UC" + "x".repeat(22))).toEqual({ channelId: "UC" + "x".repeat(22) });
  });

  it("parses a bare @handle", () => {
    expect(resolveChannelRef("@someuser")).toEqual({ handle: "@someuser" });
  });

  it("rejects a legacy vanity name it can't resolve unambiguously", () => {
    expect(() => resolveChannelRef("someuser")).toThrow(/Unrecognized channel reference/);
  });
});

describe("getChannelAbout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps snippet/statistics/brandingSettings into a flat shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                {
                  id: "UCabc123",
                  snippet: {
                    title: "Some Channel",
                    description: "We make videos",
                    customUrl: "@someuser",
                    country: "US",
                    publishedAt: "2015-01-01T00:00:00Z",
                    thumbnails: { high: { url: "https://example.com/thumb.jpg" } },
                  },
                  statistics: {
                    subscriberCount: "12345",
                    viewCount: "999999",
                    videoCount: "42",
                    hiddenSubscriberCount: false,
                  },
                  brandingSettings: {
                    channel: { keywords: "tech gadgets reviews" },
                    image: { bannerExternalUrl: "https://example.com/banner.jpg" },
                  },
                },
              ],
            }),
        } as Response),
      ),
    );

    const about = await getChannelAbout({ channelId: "UCabc123" }, "fake-key");

    expect(about).toEqual({
      channelId: "UCabc123",
      title: "Some Channel",
      description: "We make videos",
      customUrl: "@someuser",
      country: "US",
      joinedAt: "2015-01-01T00:00:00Z",
      subscriberCount: 12345,
      viewCount: 999999,
      videoCount: 42,
      keywords: ["tech", "gadgets", "reviews"],
      thumbnailUrl: "https://example.com/thumb.jpg",
      bannerUrl: "https://example.com/banner.jpg",
    });
  });

  it("returns null subscriberCount when the channel hides it, and null when the channel doesn't exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) }) as Promise<Response>),
    );
    expect(await getChannelAbout({ channelId: "UCnope" }, "fake-key")).toBeNull();
  });
});

describe("getChannelsStats", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("computes avgViewsPerVideo per channel, batching by 50 ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                {
                  id: "UCa",
                  statistics: { subscriberCount: "1000", viewCount: "10000", videoCount: "100" },
                },
                {
                  id: "UCb",
                  statistics: { viewCount: "500", videoCount: "0", hiddenSubscriberCount: true },
                },
              ],
            }),
        } as Response),
      ),
    );

    const stats = await getChannelsStats(["UCa", "UCb"], "fake-key");

    expect(stats).toEqual([
      { channelId: "UCa", subscriberCount: 1000, viewCount: 10000, videoCount: 100, avgViewsPerVideo: 100 },
      { channelId: "UCb", subscriberCount: null, viewCount: 500, videoCount: 0, avgViewsPerVideo: null },
    ]);
  });
});
