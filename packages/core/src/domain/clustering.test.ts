import { describe, expect, it } from "vitest";
import { clusterBySharedTerms, tokenize } from "./clustering.js";

describe("tokenize", () => {
  it("strips accents so 'más'/'mas' and 'cómo'/'como' match", () => {
    expect(tokenize("¿Cómo instalo esto?")).toEqual(tokenize("Como instalo esto"));
  });

  it("removes URLs, mentions, hashtags, and stopwords", () => {
    expect(tokenize("check https://x.com/foo @someone #cool the a of")).toEqual(["check"]);
  });

  it("drops tokens shorter than 3 chars", () => {
    expect(tokenize("hi ok a b great video")).toEqual(["great", "video"]);
  });
});

describe("clusterBySharedTerms", () => {
  it("groups texts that share distinctive vocabulary into the same cluster", () => {
    const texts = [
      "how do I enable dark mode in this app",
      "any dark mode version available for this app",
      "completely unrelated comment about something else entirely",
    ];
    const clusters = clusterBySharedTerms(texts);
    const darkModeCluster = clusters.find((c) => c.memberIndices.includes(0));
    expect(darkModeCluster?.memberIndices).toEqual(expect.arrayContaining([0, 1]));
    expect(darkModeCluster?.memberIndices).not.toContain(2);
  });

  it("excludes emoji-only / too-short comments instead of giving them their own cluster", () => {
    const texts = ["🔥🔥🔥", "ok", "a genuinely long and specific comment about something particular"];
    const clusters = clusterBySharedTerms(texts);
    const allMembers = clusters.flatMap((c) => c.memberIndices);
    expect(allMembers).toEqual([2]);
  });

  it("does not merge unrelated comments into one cluster", () => {
    const texts = [
      "please make a tutorial about async generators",
      "what laptop do you use for coding",
      "loved the ending of this episode",
    ];
    const clusters = clusterBySharedTerms(texts, 0.3);
    expect(clusters.filter((c) => c.memberIndices.length > 1)).toHaveLength(0);
  });
});
