import type {
  ContentKind,
  ContentMetadata,
  ContentProvider,
  ProviderCapabilities,
  TextPayload,
} from "@creator-research/core";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";

interface PdfDocumentProxy {
  getMetadata(): Promise<{ info?: { Title?: string } }>;
}
// unpdf doesn't ship resolvable types for getDocumentProxy (it's typed as "error" for TS);
// the cast is isolated here, in a single place, instead of letting `any` leak into every use below.
const getPdfProxy = getDocumentProxy as unknown as (data: Uint8Array) => Promise<PdfDocumentProxy>;

/** PDFs by URL or local path. Scanned (image-only) PDFs with no embedded text are out of scope. */
export class PdfProvider implements ContentProvider {
  readonly name = "pdf";
  private readonly cache = new Map<string, { title: string; text: string; pages: number }>();

  matches(ref: string): boolean {
    if (ref.toLowerCase().endsWith(".pdf")) {
      if (ref.startsWith("http://") || ref.startsWith("https://")) return true;
      return existsSync(ref);
    }
    return false;
  }

  classify(): ContentKind {
    return "pdf";
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
    };
  }

  private async extract(ref: string): Promise<{ title: string; text: string; pages: number }> {
    const cached = this.cache.get(ref);
    if (cached) return cached;
    const data = ref.startsWith("http")
      ? new Uint8Array(await (await fetch(ref)).arrayBuffer())
      : new Uint8Array(readFileSync(ref));
    const pdf = await getPdfProxy(data);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const meta = (await pdf.getMetadata().catch(() => null))?.info;
    const rawTitle = meta?.Title?.trim();
    const result = {
      // "" counts as no title just like null/undefined: hence `||`, not `??`, on purpose
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      title: rawTitle || basename(ref),
      text: text.trim(),
      pages: totalPages,
    };
    if (!result.text) throw new Error("PDF has no extractable text (scanned PDFs are not supported)");
    this.cache.set(ref, result);
    return result;
  }

  async fetchMetadata(ref: string): Promise<ContentMetadata> {
    const p = await this.extract(ref);
    return { externalId: ref, title: p.title, raw: { pages: p.pages } };
  }

  async fetchText(ref: string): Promise<TextPayload | null> {
    const p = await this.extract(ref);
    return { text: p.text, source: "native_text" };
  }
}
