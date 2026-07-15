import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { detectMonetization } from "@cleancod3/core";
import {
  getChannelAbout,
  getVideosStats,
  listUploadIds,
  resolveChannelRef,
  resolveUploadsPlaylistId,
} from "@cleancod3/providers";
import { z } from "zod";

const CHANNEL_REF_SCHEMA = z
  .string()
  .describe(
    "Channel URL (https://youtube.com/@handle or /channel/UC...), a bare @handle, or a raw " +
      "channel ID (UC...). Legacy vanity URLs (/c/name, /user/name) aren't supported — resolve " +
      "those to a handle or ID first.",
  );

function missingApiKey(toolName: string): { content: { type: "text"; text: string }[] } {
  return json({
    error: "missing_api_key",
    message: `${toolName} requires YOUTUBE_API_KEY configured on the server (free, YouTube Data API v3).`,
  });
}

export function registerChannelAboutTool(server: McpServer): void {
  server.registerTool(
    "get_channel_about",
    {
      title: "Channel About-page metadata",
      description:
        "Everything from a channel's About page in one call — name, description, subscriber/view/video " +
        "counts, country, join date, custom URL, and description keywords. Uses the official YouTube Data " +
        "API (free, requires YOUTUBE_API_KEY on the server), 1 quota unit per call. Use this before " +
        "get_channel_monetization or list_videos when you don't yet have a sense of who the channel is.",
      inputSchema: { channel: CHANNEL_REF_SCHEMA },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ channel }) => {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) return missingApiKey("get_channel_about");
      try {
        const ref = resolveChannelRef(channel);
        const about = await getChannelAbout(ref, apiKey);
        if (!about) {
          return json({ error: "not_found", message: `No channel found for "${channel}".` });
        }
        return json({
          channelId: about.channelId,
          title: about.title,
          description: about.description || null,
          url: `https://www.youtube.com/channel/${about.channelId}`,
          customUrl: about.customUrl,
          country: about.country,
          joinedAt: about.joinedAt,
          subscriberCount: about.subscriberCount,
          viewCount: about.viewCount,
          videoCount: about.videoCount,
          keywords: about.keywords.length ? about.keywords : null,
          thumbnailUrl: about.thumbnailUrl,
          bannerUrl: about.bannerUrl,
          limitations: about.subscriberCount === null ? ["Channel hides its subscriber count."] : [],
        });
      } catch (err) {
        return json({
          error: "fetch_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}

export function registerChannelMonetizationTool(server: McpServer): void {
  server.registerTool(
    "get_channel_monetization",
    {
      title: "Detect a channel's monetization methods",
      description:
        "Best-effort, deterministic detection of non-AdSense monetization (digital products, courses, " +
        "memberships, affiliate links, merch, newsletters, sponsorships, service/lead-gen) by pattern-matching " +
        "known platform domains and common phrasing in the channel's About description plus its most recent " +
        "video descriptions. This is text/URL matching, NOT an AI classifier — it only reports methods it found " +
        "literal evidence for (with the matching excerpt and source), and an empty result means no supported " +
        "signal was found in the sampled text, not that the channel earns nothing beyond AdSense. Requires " +
        "YOUTUBE_API_KEY on the server.",
      inputSchema: {
        channel: CHANNEL_REF_SCHEMA,
        videoSampleSize: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("How many of the channel's most recent video descriptions to scan"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ channel, videoSampleSize }) => {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) return missingApiKey("get_channel_monetization");
      try {
        const ref = resolveChannelRef(channel);
        const about = await getChannelAbout(ref, apiKey);
        if (!about) {
          return json({ error: "not_found", message: `No channel found for "${channel}".` });
        }
        const uploadsPlaylistId = await resolveUploadsPlaylistId(ref, apiKey);
        const ids = await listUploadIds(uploadsPlaylistId, videoSampleSize, apiKey);
        const videos = ids.length > 0 ? await getVideosStats(ids, apiKey) : [];
        const profile = detectMonetization([
          { source: "channel_about", text: about.description },
          ...videos.map((v) => ({ source: `video:${v.id}`, text: v.description })),
        ]);
        return json({
          channelId: about.channelId,
          title: about.title,
          sampledVideoCount: videos.length,
          ...profile,
        });
      } catch (err) {
        return json({
          error: "fetch_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}

function json(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
