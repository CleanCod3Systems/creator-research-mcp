import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCapabilitiesTool } from "./tools/capabilities.js";
import { registerGetAnalysisTool } from "./tools/get-analysis.js";
import { registerGetTranscriptTool } from "./tools/transcript.js";
import { registerSaveAnalysisTool } from "./tools/save-analysis.js";
import { registerSearchTools } from "./tools/search.js";
import { registerCommentsTool } from "./tools/comments.js";
import { registerCompareTool } from "./tools/compare.js";
import { registerGenerateTools } from "./tools/generate.js";
import { registerListVideosTool } from "./tools/videos.js";
import { registerHeatmapTool } from "./tools/heatmap.js";
import { registerTrendingTool } from "./tools/trending.js";
import { registerMetricsHistoryTool } from "./tools/metrics.js";
import { registerImportProfileSnapshotTool } from "./tools/import-profile.js";
import { registerAnalyzeCreatorTool, registerCompareCreatorsTool } from "./tools/creator-analysis.js";

export const SERVER_NAME = "creator-research";
export const SERVER_VERSION = "0.5.0";

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
  registerCompareTool(server);
  registerGenerateTools(server);
  registerListVideosTool(server);
  registerHeatmapTool(server);
  registerTrendingTool(server);
  registerMetricsHistoryTool(server);
  registerImportProfileSnapshotTool(server);
  registerAnalyzeCreatorTool(server);
  registerCompareCreatorsTool(server);
  return server;
}
