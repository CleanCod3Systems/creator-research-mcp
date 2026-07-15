import { afterEach, describe, expect, it, vi } from "vitest";
import { searchVideos } from "./youtube-api.js";

describe("searchVideos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("joins search.list ranking with videos.list stats, preserving search order", async () => {
    const urls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: URL) => {
        urls.push(url);
        if (url.pathname.endsWith("/search")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                items: [{ id: { videoId: "vid2" } }, { id: { videoId: "vid1" } }],
              }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                {
                  id: "vid1",
                  snippet: { title: "First", publishedAt: "2026-07-01T00:00:00Z", tags: [] },
                  statistics: { viewCount: "100" },
                  contentDetails: { duration: "PT1M" },
                },
                {
                  id: "vid2",
                  snippet: { title: "Second", publishedAt: "2026-07-02T00:00:00Z", tags: [] },
                  statistics: { viewCount: "200" },
                  contentDetails: { duration: "PT2M" },
                },
              ],
            }),
        } as Response);
      }),
    );

    const videos = await searchVideos(
      "test query",
      { order: "viewCount", videoDuration: "short", maxResults: 10 },
      "fake-key",
    );

    expect(videos.map((v) => v.id)).toEqual(["vid2", "vid1"]);
    const searchUrl = urls.find((u) => u.pathname.endsWith("/search"));
    expect(searchUrl?.searchParams.get("q")).toBe("test query");
    expect(searchUrl?.searchParams.get("order")).toBe("viewCount");
    expect(searchUrl?.searchParams.get("videoDuration")).toBe("short");
    expect(searchUrl?.searchParams.get("type")).toBe("video");
  });

  it("returns an empty list when the query has no results, without calling videos.list", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    const videos = await searchVideos("no matches", { maxResults: 10 }, "fake-key");

    expect(videos).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
