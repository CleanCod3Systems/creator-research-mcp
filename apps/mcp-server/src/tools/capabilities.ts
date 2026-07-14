import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DEFAULT_PROVIDERS,
  ProvidersFile,
  loadYamlConfigOrDefault,
  resolveConfigPathOrNull,
} from "@cleancod3/core";

/**
 * Introspection tool: what this server can and can NOT do.
 * Exists so the client LLM never promises capabilities that don't exist.
 */
export function registerCapabilitiesTool(server: McpServer): void {
  server.registerTool(
    "capabilities",
    {
      title: "Server capabilities",
      description:
        "Lists the enabled content providers, their reliability (stable/fragile/manual_only), " +
        "and the known limitations. Check BEFORE promising analysis of a source.",
      inputSchema: {},
    },
    () => {
      const { providers } = loadYamlConfigOrDefault(
        resolveConfigPathOrNull("providers.yaml"),
        ProvidersFile,
        DEFAULT_PROVIDERS,
      );
      const payload = {
        server: "creator-research",
        mode: "client-reasoning: this server fetches data (transcript, comments, stats); the analysis is done by the client LLM",
        providers,
        youtubeApiKeyConfigured: Boolean(process.env.YOUTUBE_API_KEY),
        knownLimitations: [
          "TikTok/Instagram/Twitter: best-effort extraction via yt-dlp/FxTwitter; can fail if the platform changes",
          'Instagram with login/rate-limit: export cookies with YTDLP_EXTRA_ARGS="--cookies-from-browser chrome"',
          "LinkedIn: public posts/articles only; no extraction possible behind an authwall",
          "Twitter/X: individual public tweets only; profiles and replies are out of scope",
          "Content behind paywall/DRM: out of scope by design",
          "Videos without subtitles: no automatic transcription is available; try other content",
          "Without YOUTUBE_API_KEY: list_videos uses yt-dlp (views are fine, no exact likes, sometimes null)",
          "get_video_heatmap: best-effort, very new videos or ones with few views don't have enough data",
          "get_retention_moments: needs both heatmap data and subtitles/captions for the same video — " +
            "if either is missing, use get_video_heatmap or get_transcript alone instead",
          "Instagram has no automatic profile listing (yt-dlp: instagram:user is officially broken) — " +
            "use get_transcript with 'urls' (batch) or import_profile_snapshot for manual data",
          "get_metrics_history/velocityScore need at least 2 measurements over time on the same URL " +
            "(repeat list_videos/get_transcript); with a single measurement there's no time window, explained in 'limitations'",
          "analyze_creator/compare_creators are deterministic aggregation (medians, frequencies) — they do NOT detect " +
            "hooks/CTA/narrative on their own, that's done by the client LLM reading get_transcript of the outliers",
          "get_content_ideas needs at least 5 comments and ≥2 comments sharing enough vocabulary to form a " +
            "cluster — it's TF-IDF keyword matching, not semantic paraphrase detection, so very differently " +
            "worded repeats of the same request may not group together",
        ],
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
