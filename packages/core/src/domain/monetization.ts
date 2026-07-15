export interface MonetizationTextSource {
  /** e.g. "channel_about" or "video:dQw4w9WgXcQ" */
  source: string;
  text: string;
}

export interface MonetizationEvidence {
  source: string;
  /** Short window of text around the match, so a human can judge it without re-fetching the source. */
  excerpt: string;
}

export interface MonetizationMethodResult {
  method: string;
  evidence: MonetizationEvidence[];
}

export interface MonetizationProfile {
  sells: boolean;
  methods: MonetizationMethodResult[];
  limitations: string[];
}

/**
 * Deterministic, text-only signals for common non-AdSense monetization methods: a known
 * platform domain, or a common fixed phrase creators use when promoting that method. Not
 * exhaustive by design (see MonetizationProfile.limitations) — this is a v1 list of the
 * clearest, least-ambiguous signals; extend it if a well-known platform is missing.
 */
const MONETIZATION_PATTERNS: Record<string, RegExp[]> = {
  digital_product: [/\b(gumroad\.com|payhip\.com|sellfy\.com|lemonsqueezy\.com)\b/i],
  course: [/\b(teachable\.com|thinkific\.com|kajabi\.com|podia\.com|skool\.com|udemy\.com\/course)\b/i],
  membership: [/\b(patreon\.com|memberful\.com|whop\.com)\b/i, /youtube\.com\/[^\s]+\/join\b/i],
  affiliate: [/\b(amzn\.to|geni\.us)\b/i, /\baffiliate link\b/i],
  merch: [/\b(creator-spring\.com|teespring\.com|represent\.com)\b/i, /\bmerch store\b/i],
  newsletter: [/\b(substack\.com|beehiiv\.com)\b/i],
  sponsorship: [/\bsponsored by\b/i, /\bthis video is sponsored\b/i],
  service_leadgen: [/\b(calendly\.com)\b/i, /\bbook a call\b/i],
};

const EXCERPT_RADIUS = 60;

function extractExcerpt(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - EXCERPT_RADIUS);
  const end = Math.min(text.length, matchIndex + matchLength + EXCERPT_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/**
 * Scans a channel's About description + a sample of video descriptions for known
 * monetization-platform links and common promotional phrasing. Never infers a method it can't
 * point to literal text for — an empty methods array (sells: false) means no supported signal
 * was found in the sampled text, not that the channel doesn't monetize at all (see limitations).
 */
export function detectMonetization(texts: MonetizationTextSource[]): MonetizationProfile {
  const methods = new Map<string, MonetizationEvidence[]>();
  for (const { source, text } of texts) {
    if (!text) continue;
    for (const [method, patterns] of Object.entries(MONETIZATION_PATTERNS)) {
      for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (!match) continue;
        const evidence = methods.get(method) ?? [];
        // one piece of evidence per source per method is enough to prove the method is used
        if (!evidence.some((e) => e.source === source)) {
          evidence.push({ source, excerpt: extractExcerpt(text, match.index, match[0].length) });
          methods.set(method, evidence);
        }
      }
    }
  }
  const methodResults = [...methods.entries()].map(([method, evidence]) => ({ method, evidence }));
  return {
    sells: methodResults.length > 0,
    methods: methodResults,
    limitations: [
      "Based only on visible text in the sampled sources (channel About + a limited number of recent video " +
        "descriptions) — monetization not mentioned in text (verbal-only sponsor reads, on-screen-only merch " +
        "mentions, pinned comments, community posts) is invisible to this detector.",
      "Matches a fixed v1 list of well-known platforms/domains and common phrasing — a niche or white-labeled " +
        "storefront not on that list won't be detected even if it's the channel's main monetization method.",
    ],
  };
}
