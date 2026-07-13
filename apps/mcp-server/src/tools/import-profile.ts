import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { canonicalizeUrl, sourceHash } from "@creator-research/core";
import { z } from "zod";
import { getContext, getMetricsRepo, getProfileRepo } from "../context.js";

/**
 * Sin scraping agresivo de perfiles (Instagram no lo permite de forma confiable, ver
 * capabilities): el usuario pega a mano lo que ya ve en su navegador — followers, posts,
 * likes/comments de cada reel — y esto lo persiste con fecha real para poder medir
 * crecimiento en el tiempo con get_metrics_history, igual que si viniera de una API.
 */
export function registerImportProfileSnapshotTool(server: McpServer): void {
  server.registerTool(
    "import_profile_snapshot",
    {
      title: "Importar snapshot manual de un perfil",
      description:
        "Registra una medición manual de un perfil (Instagram, TikTok, o cualquier plataforma sin listado " +
        "automático): followers, cantidad de posts, y por cada post su url/likes/comments/views. Usalo " +
        "cuando list_videos no soporte el perfil (ej. Instagram) — pegá lo que ves en el navegador. Con " +
        "capturas repetidas en el tiempo, get_metrics_history calcula crecimiento real, igual que con datos " +
        "de una API. NUNCA se extraen cookies ni se saltea login: esto es 100% aporte manual del usuario.",
      inputSchema: {
        platform: z.string().describe("ej. instagram, tiktok"),
        profileUrl: z.string().url(),
        handle: z.string().describe("ej. juliacardoso.dev"),
        name: z.string().optional(),
        capturedAt: z.string().datetime().optional().describe("ISO 8601; default ahora"),
        followers: z.number().int().nonnegative().optional(),
        postsCount: z.number().int().nonnegative().optional(),
        posts: z
          .array(
            z.object({
              url: z.string().url(),
              likes: z.number().int().nonnegative().optional(),
              comments: z.number().int().nonnegative().optional(),
              views: z.number().int().nonnegative().optional(),
              publishedAt: z.string().optional(),
              caption: z.string().optional(),
            }),
          )
          .default([]),
      },
    },
    ({ platform, profileUrl, handle, name, capturedAt, followers, postsCount, posts }) => {
      const capturedAtIso = capturedAt ?? new Date().toISOString();
      const { content } = getContext();
      const metricsRepo = getMetricsRepo();
      const profileRepo = getProfileRepo();

      const creatorId = profileRepo.upsertCreator({
        platform,
        handle,
        name: name ?? handle,
        url: profileUrl,
        metrics: {
          followers: followers ?? null,
          postsCount: postsCount ?? null,
          capturedAt: capturedAtIso,
        },
      });

      const importedPosts = posts.map((post) => {
        const hash = sourceHash({ type: "url", url: post.url });
        const contentItemId = content.upsertContentItem({
          sourceType: "short",
          provider: platform,
          url: post.url,
          canonicalUrl: canonicalizeUrl(post.url),
          contentHash: hash,
          title: post.caption?.slice(0, 200) ?? post.url,
          description: post.caption,
          publishedAt: post.publishedAt,
          rawMetadata: { importedManually: true },
        });
        metricsRepo.recordSnapshot(
          contentItemId,
          {
            viewCount: post.views ?? null,
            likeCount: post.likes ?? null,
            commentCount: post.comments ?? null,
          },
          "manual",
          capturedAtIso,
        );
        return { url: post.url, contentItemId };
      });

      return json({
        status: "imported",
        creatorId,
        platform,
        handle,
        capturedAt: capturedAtIso,
        postsImported: importedPosts.length,
        posts: importedPosts,
        hint:
          "Repetí este import más adelante con datos frescos de los mismos posts para poder calcular " +
          "crecimiento real con get_metrics_history(url). Nota: las métricas de perfiles ajenos en " +
          "Instagram/TikTok pueden estar incompletas porque no hay API que las traiga automáticamente.",
      });
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
