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
// unpdf no publica tipos resolubles para getDocumentProxy (queda como tipo "error" para TS);
// se aísla el cast acá, en un solo lugar, en vez de dejar `any` filtrarse a cada uso más abajo.
const getPdfProxy = getDocumentProxy as unknown as (data: Uint8Array) => Promise<PdfDocumentProxy>;

/** PDFs por URL o path local. OCR de escaneados: fase 2. */
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
        mediaDownload: false,
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
      // "" cuenta como sin título tanto como null/undefined: por eso `||`, no `??`, a propósito
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      title: rawTitle || basename(ref),
      text: text.trim(),
      pages: totalPages,
    };
    if (!result.text) throw new Error("PDF sin texto extraíble (¿escaneado? OCR llega en fase 2)");
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

  fetchMedia(): Promise<string | null> {
    return Promise.resolve(null);
  }
}
