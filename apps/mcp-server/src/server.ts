import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCapabilitiesTool } from "./tools/capabilities.js";
import { registerGetAnalysisTool } from "./tools/get-analysis.js";
import { registerGetTranscriptTool } from "./tools/transcript.js";
import { registerSaveAnalysisTool } from "./tools/save-analysis.js";
import { registerSearchTools } from "./tools/search.js";
import { registerCommentsTool } from "./tools/comments.js";
import { registerContentIdeasTool } from "./tools/content-ideas.js";
import { registerCompareTool } from "./tools/compare.js";
import { registerGenerateTools } from "./tools/generate.js";
import { registerListVideosTool } from "./tools/videos.js";
import { registerHeatmapTool } from "./tools/heatmap.js";
import { registerRetentionMomentsTool } from "./tools/retention.js";
import { registerTrendingTool } from "./tools/trending.js";
import { registerYoutubeSearchTool } from "./tools/youtube-search.js";
import { registerChannelAboutTool, registerChannelMonetizationTool } from "./tools/channel-info.js";
import { registerViralVideosTool } from "./tools/viral-videos.js";
import { registerMetricsHistoryTool } from "./tools/metrics.js";
import { registerImportProfileSnapshotTool } from "./tools/import-profile.js";
import { registerAnalyzeCreatorTool, registerCompareCreatorsTool } from "./tools/creator-analysis.js";

export const SERVER_NAME = "creator-research";
export const SERVER_VERSION = "0.8.0";

/**
 * Client-reasoning-only mode: the server fetches data (transcript, comments, stats),
 * the client LLM (ChatGPT/Claude) does the analysis. There is no AI engine of its own in this
 * repo — you never spend local compute/RAM analyzing, only fetching data.
 */
export function buildServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerCapabilitiesTool(server);
  registerGetAnalysisTool(server);
  registerGetTranscriptTool(server);
  registerSaveAnalysisTool(server);
  registerSearchTools(server);
  registerCommentsTool(server);
  registerContentIdeasTool(server);
  registerCompareTool(server);
  registerGenerateTools(server);
  registerListVideosTool(server);
  registerHeatmapTool(server);
  registerRetentionMomentsTool(server);
  registerTrendingTool(server);
  registerYoutubeSearchTool(server);
  registerChannelAboutTool(server);
  registerChannelMonetizationTool(server);
  registerViralVideosTool(server);
  registerMetricsHistoryTool(server);
  registerImportProfileSnapshotTool(server);
  registerAnalyzeCreatorTool(server);
  registerCompareCreatorsTool(server);
  return server;
}
