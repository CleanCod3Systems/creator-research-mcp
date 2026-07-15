import { describe, expect, it } from "vitest";
import { pickFallbackAudioFormat, type YtDlpFormat } from "./ytdlp.js";

describe("pickFallbackAudioFormat", () => {
  it("returns null when there are no formats", () => {
    expect(pickFallbackAudioFormat(undefined)).toBeNull();
    expect(pickFallbackAudioFormat([])).toBeNull();
  });

  it("picks the highest-bitrate audio-only format when one exists", () => {
    const formats: YtDlpFormat[] = [
      { vcodec: "none", acodec: "opus", abr: 70, url: "https://example.com/low.opus" },
      { vcodec: "none", acodec: "opus", abr: 160, url: "https://example.com/high.opus" },
      { vcodec: "avc1", acodec: "aac", tbr: 500, url: "https://example.com/muxed.mp4" },
    ];
    expect(pickFallbackAudioFormat(formats)?.url).toBe("https://example.com/high.opus");
  });

  it("falls back to the lowest-bitrate muxed format when there's no audio-only stream", () => {
    const formats: YtDlpFormat[] = [
      { vcodec: "avc1", acodec: "aac", tbr: 1500, url: "https://example.com/hd.mp4" },
      { vcodec: "avc1", acodec: "aac", tbr: 300, url: "https://example.com/sd.mp4" },
    ];
    expect(pickFallbackAudioFormat(formats)?.url).toBe("https://example.com/sd.mp4");
  });

  it("excludes formats without a url and video-only (no audio) formats", () => {
    const formats: YtDlpFormat[] = [
      { vcodec: "none", acodec: "opus", abr: 999 }, // no url
      { vcodec: "avc1", acodec: "none", tbr: 100, url: "https://example.com/video-only.mp4" },
      { vcodec: "avc1", acodec: "aac", tbr: 400, url: "https://example.com/ok.mp4" },
    ];
    expect(pickFallbackAudioFormat(formats)?.url).toBe("https://example.com/ok.mp4");
  });
});
