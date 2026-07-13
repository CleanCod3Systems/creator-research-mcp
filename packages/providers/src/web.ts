import { Readability } from "@mozilla/readability";
import type {
  ContentKind,
  ContentMetadata,
  ContentProvider,
  ProviderCapabilities,
  TextPayload,
} from "@creator-research/core";
import { JSDOM, VirtualConsole } from "jsdom";
import { isTransientHttpError, withRetry } from "./retry.js";

const UA = "Mozilla/5.0 (compatible; CreatorResearchMCP/0.4; +https://github.com)";

/** Static articles, blogs, and documentation. JS-rendered pages are out of scope. */
export class WebProvider implements ContentProvider {
  readonly name = "web";
  private readonly cache = new Map<string, { title: string; text: string; byline?: string }>();

  matches(url: string): boolean {
    try {
      const u = new URL(url);
      return (
        (u.protocol === "http:" || u.protocol === "https:") &&
        !u.pathname.toLowerCase().endsWith(".pdf")
      );
    } catch {
      return false;
    }
  }

  classify(): ContentKind {
    return "article";
  }

  capabilities(): ProviderCapabilities {
    return {
      reliability: "stable",
      supports: {
        metadata: true,
        subtitles: false,
        comments: false,
        channelListing: false,
      },
      legalNotes: "Public content only; respects served HTML (no paywall bypass)",
    };
  }

  private async extract(url: string): Promise<{ title: string; text: string; byline?: string }> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    const html = await withRetry(
      async () => {
        const res = await fetch(url, {
          headers: { "user-agent": UA, accept: "text/html" },
          redirect: "follow",
        });
        if (!res.ok) throw new Error(`HTTP ${String(res.status)} fetching ${url}`);
        return res.text();
      },
      { isRetryable: isTransientHttpError },
    );
    const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
    const article = new Readability(dom.window.document).parse();
    const result = {
      title: (article?.title ?? dom.window.document.title) || url,
      text: (article?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim(),
      byline: article?.byline ?? undefined,
    };
    if (!result.text)
      throw new Error("Could not extract readable content (JS-rendered page not supported)");
    this.cache.set(url, result);
    return result;
  }

  async fetchMetadata(url: string): Promise<ContentMetadata> {
    const a = await this.extract(url);
    return { externalId: url, title: a.title, description: a.byline, raw: { byline: a.byline } };
  }

  async fetchText(url: string): Promise<TextPayload | null> {
    const a = await this.extract(url);
    return { text: a.text, source: "native_text" };
  }
}
