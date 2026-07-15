import { describe, expect, it } from "vitest";
import { detectMonetization } from "./monetization.js";

describe("detectMonetization", () => {
  it("detects multiple methods across sources with an excerpt per piece of evidence", () => {
    const profile = detectMonetization([
      { source: "channel_about", text: "Get my templates at https://gumroad.com/l/mytemplates" },
      { source: "video:abc123", text: "This video is sponsored by Acme. Use code SAVE10." },
    ]);

    expect(profile.sells).toBe(true);
    const methods = profile.methods.map((m) => m.method).sort();
    expect(methods).toEqual(["digital_product", "sponsorship"]);
    const digitalProduct = profile.methods.find((m) => m.method === "digital_product");
    expect(digitalProduct?.evidence).toHaveLength(1);
    expect(digitalProduct?.evidence[0]?.source).toBe("channel_about");
    expect(digitalProduct?.evidence[0]?.excerpt).toContain("gumroad.com");
  });

  it("never fabricates a method: no matching text means sells: false and an empty methods array", () => {
    const profile = detectMonetization([
      { source: "channel_about", text: "Just a guy making videos about hiking." },
      { source: "video:xyz", text: "" },
    ]);

    expect(profile.sells).toBe(false);
    expect(profile.methods).toEqual([]);
    expect(profile.limitations.length).toBeGreaterThan(0);
  });

  it("records at most one evidence entry per source per method, even with repeated mentions", () => {
    const profile = detectMonetization([
      {
        source: "channel_about",
        text: "Join my Patreon at patreon.com/me. Also check patreon.com/me/posts for updates.",
      },
    ]);

    const membership = profile.methods.find((m) => m.method === "membership");
    expect(membership?.evidence).toHaveLength(1);
  });
});
