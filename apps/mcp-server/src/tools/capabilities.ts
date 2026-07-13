import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DEFAULT_PROVIDERS,
  ProvidersFile,
  loadYamlConfigOrDefault,
  resolveConfigPathOrNull,
} from "@creator-research/core";

/**
 * Tool de introspección: qué puede y qué NO puede hacer este servidor.
 * Existe para que el LLM cliente nunca prometa capacidades inexistentes.
 */
export function registerCapabilitiesTool(server: McpServer): void {
  server.registerTool(
    "capabilities",
    {
      title: "Capacidades del servidor",
      description:
        "Lista los providers de contenido habilitados, su confiabilidad (stable/fragile/manual_only) " +
        "y las limitaciones conocidas. Consultar ANTES de prometer análisis de una fuente.",
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
        mode: "client-reasoning: este servidor trae datos (transcript, comments, stats); el análisis lo hace el LLM cliente",
        providers,
        youtubeApiKeyConfigured: Boolean(process.env.YOUTUBE_API_KEY),
        knownLimitations: [
          "TikTok/Instagram/Twitter: extracción best-effort vía yt-dlp/FxTwitter; puede fallar si la plataforma cambia",
          'Instagram con login/rate-limit: exportar cookies con YTDLP_EXTRA_ARGS="--cookies-from-browser chrome"',
          "LinkedIn: solo posts/artículos públicos; con authwall no hay extracción posible",
          "Twitter/X: solo tweets públicos individuales; perfiles y replies fuera de alcance",
          "Contenido tras paywall/DRM: fuera de alcance por diseño",
          "Videos sin subtítulos: no hay transcripción automática (sin worker/Whisper); usá otro contenido",
          "Sin YOUTUBE_API_KEY: list_videos usa yt-dlp (vistas ok, sin likes exactos, a veces con null)",
          "get_video_heatmap: best-effort, videos muy nuevos o con pocas vistas no tienen data suficiente",
          "Instagram no tiene listado automático de perfil (yt-dlp: instagram:user está roto oficialmente) — " +
            "usá get_transcript con 'urls' (batch) o import_profile_snapshot para datos manuales",
          "get_metrics_history/velocityScore requieren al menos 2 mediciones en el tiempo sobre la misma URL " +
            "(repetí list_videos/get_transcript); con una sola medición no hay ventana de tiempo, se explica en 'limitations'",
          "analyze_creator/compare_creators son agregación determinista (medianas, frecuencias) — NO detectan " +
            "hooks/CTA/narrativa por sí mismos, eso lo hace el LLM cliente leyendo get_transcript de los outliers",
        ],
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
