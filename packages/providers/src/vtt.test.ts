import { describe, expect, it } from "vitest";
import { parseVtt } from "./vtt.js";

const SAMPLE = `WEBVTT
Kind: captions

00:00:01.000 --> 00:00:03.500
hello <c>world</c>

00:00:03.500 --> 00:00:06.000
hello world

00:00:06.000 --> 00:00:09.000
this is a caption
test
`;

describe("parseVtt", () => {
  it("parses cues, strips tags, and deduplicates rolling captions", () => {
    const segs = parseVtt(SAMPLE);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ start: 1, end: 3.5, text: "hello world" });
    expect(segs[1]?.text).toBe("this is a caption test");
  });
});
