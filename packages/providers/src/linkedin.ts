import type {
  ContentKind,
  ContentMetadata,
  ContentProvider,
  ProviderCapabilities,
  TextPayload,
} from "@creator-research/core";
import { JSDOM, VirtualConsole } from "jsdom";
import { isTransientHttpError, withRetry } from "./retry.js";

// UA de navegador real: LinkedIn devuelve authwall a UAs de bots para posts públicos
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface Extracted {
  title: string;
  text: string;
  author?: string;
  publishedAt?: string;
}

/** Posts y artículos públicos de LinkedIn, best-effort: JSON-LD > DOM del post > og:description. */
export class LinkedInProvider implements ContentProvider {
  readonly name = "linkedin";
  private readonly cache = new Map<string, Extracted>();

  matches(url: string): boolean {
    try {
      const h = new URL(url).hostname.toLowerCase();
      return h === "linkedin.com" || h.endsWith(".linkedin.com");
    } catch {
      return false;
    }
  }

  classify(): ContentKind {
    return "article";
  }

  capabilities(): ProviderCapabilities {
    return {
      reliability: "fragile",
      supports: {
        metadata: true,
        subtitles: false,
        mediaDownload: false,
        comments: false,
        channelListing: false,
      },
      legalNotes: "Solo posts/artículos públicos; con authwall el fallback es analyze con filePath",
    };
  }

  private async extract(url: string): Promise<Extracted> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    const html = await withRetry(
      async () => {
        const res = await fetch(url, {
          headers: { "user-agent": UA, accept: "text/html", "accept-language": "es,en;q=0.8" },
          redirect: "follow",
        });
        if (!res.ok) throw new Error(`HTTP ${String(res.status)} al obtener ${url}`);
        if (res.url.includes("authwall") || res.url.includes("/login")) {
          throw new Error(
            "LinkedIn devolvió el authwall (contenido no público desde este servidor). " +
              "Fallback: guardá el post como PDF/HTML y usá analyze con filePath.",
          );
        }
        return res.text();
      },
      { isRetryable: isTransientHttpError },
    );
    const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
    const doc = dom.window.document;

    const result = this.fromJsonLd(doc) ?? this.fromPostDom(doc) ?? this.fromOgTags(doc);
    if (!result?.text) {
      throw new Error(
        "No se pudo extraer texto del post de LinkedIn (¿requiere login?). " +
          "Fallback: guardá el post como PDF/HTML y usá analyze con filePath.",
      );
    }
    this.cache.set(url, result);
    return result;
  }

  /** Artículos /pulse/ publican Article con articleBody en JSON-LD. */
  private fromJsonLd(doc: Document): Extracted | null {
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent) as Record<string, unknown>;
        const nodes = Array.isArray(data["@graph"])
          ? (data["@graph"] as Record<string, unknown>[])
          : [data];
        for (const node of nodes) {
          const body = node.articleBody;
          if (typeof body === "string" && body.trim()) {
            const author = node.author as Record<string, unknown> | undefined;
            return {
              title:
                typeof node.headline === "string" ? node.headline : doc.title || "Post de LinkedIn",
              text: body.trim(),
              author: typeof author?.name === "string" ? author.name : undefined,
              publishedAt:
                typeof node.datePublished === "string"
                  ? node.datePublished.slice(0, 10)
                  : undefined,
            };
          }
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  /** Posts públicos renderizan el texto en segmentos attributed-text. */
  private fromPostDom(doc: Document): Extracted | null {
    const segments = doc.querySelectorAll(
      ".attributed-text-segment-list__content, [data-test-id='main-feed-activity-card__commentary']",
    );
    const text = Array.from(segments)
      .map((el) => el.textContent.trim())
      .filter(Boolean)
      .join("\n\n");
    if (!text) return null;
    const author = doc
      .querySelector(
        "[data-test-id='main-feed-activity-card__entity-lockup'] a, .base-main-card__title",
      )
      ?.textContent.trim();
    return { title: doc.title || "Post de LinkedIn", text, author };
  }

  /** Último recurso: og:description trae el texto del post (a veces truncado). */
  private fromOgTags(doc: Document): Extracted | null {
    const og = (prop: string): string | undefined =>
      doc.querySelector(`meta[property="og:${prop}"]`)?.getAttribute("content") ?? undefined;
    const text = og("description");
    if (!text) return null;
    return { title: (og("title") ?? doc.title) || "Post de LinkedIn", text };
  }

  async fetchMetadata(url: string): Promise<ContentMetadata> {
    const a = await this.extract(url);
    return {
      externalId: url,
      title: a.title,
      description: a.text.slice(0, 200),
      publishedAt: a.publishedAt,
      channelName: a.author,
      raw: { author: a.author },
    };
  }

  async fetchText(url: string): Promise<TextPayload | null> {
    const a = await this.extract(url);
    return { text: a.text, source: "native_text" };
  }

  fetchMedia(): Promise<string | null> {
    return Promise.resolve(null);
  }
}
