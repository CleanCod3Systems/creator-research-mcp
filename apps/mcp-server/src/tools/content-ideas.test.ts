import { describe, expect, it } from "vitest";
import { buildContentIdeas } from "./content-ideas.js";

describe("buildContentIdeas", () => {
  const comments = [
    { author: "a", text: "how do I enable dark mode in this app", likes: 10 },
    { author: "b", text: "any dark mode version available for this app", likes: 3 },
    { author: "c", text: "please add a dark mode toggle to the app", likes: 1 },
    { author: "d", text: "what laptop do you use for coding videos", likes: 2 },
    { author: "e", text: "loved the ending of this episode, great work", likes: 5 },
  ];

  it("groups repeated requests into a ranked idea, ordered by mentions + likes", () => {
    const ideas = buildContentIdeas(comments, 10);
    expect(ideas.length).toBeGreaterThan(0);
    expect(ideas[0]?.mentions).toBeGreaterThanOrEqual(2);
    expect(ideas[0]?.examples.length).toBeGreaterThan(0);
    expect(ideas[0]?.topTerms).toContain("dark");
  });

  it("drops singleton comments — a single comment isn't a repeated request", () => {
    const singletons = [
      { author: "a", text: "what laptop do you use for coding videos", likes: 2 },
      { author: "b", text: "loved the ending of this episode, great work", likes: 5 },
    ];
    expect(buildContentIdeas(singletons, 10)).toEqual([]);
  });

  it("respects maxIdeas", () => {
    const many = Array.from({ length: 10 }, (_, i) => [
      { author: `a${String(i)}`, text: "dark mode feature request please", likes: 1 },
      { author: `b${String(i)}`, text: "dark mode feature request thanks", likes: 1 },
    ]).flat();
    expect(buildContentIdeas(many, 1)).toHaveLength(1);
  });
});
