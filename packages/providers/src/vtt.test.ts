import { describe, expect, it } from "vitest";
import { parseVtt } from "./vtt.js";

const SAMPLE = `WEBVTT
Kind: captions

00:00:01.000 --> 00:00:03.500
hola <c>mundo</c>

00:00:03.500 --> 00:00:06.000
hola mundo

00:00:06.000 --> 00:00:09.000
esto es una prueba
de subtítulos
`;

describe("parseVtt", () => {
  it("parsea cues, limpia tags y deduplica rolling captions", () => {
    const segs = parseVtt(SAMPLE);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ start: 1, end: 3.5, text: "hola mundo" });
    expect(segs[1]?.text).toBe("esto es una prueba de subtítulos");
  });
});
