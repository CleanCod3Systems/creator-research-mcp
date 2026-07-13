import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => integer("id").primaryKey({ autoIncrement: true });
const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

export const creators = sqliteTable(
  "creators",
  {
    id: id(),
    name: text("name").notNull(),
    handle: text("handle").notNull(),
    platform: text("platform").notNull(),
    url: text("url"),
    bio: text("bio"),
    metrics: text("metrics", { mode: "json" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("creators_platform_handle").on(t.platform, t.handle)],
);

export const channels = sqliteTable(
  "channels",
  {
    id: id(),
    creatorId: integer("creator_id").references(() => creators.id),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    stats: text("stats", { mode: "json" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("channels_platform_external").on(t.platform, t.externalId)],
);

export const contentItems = sqliteTable(
  "content_items",
  {
    id: id(),
    channelId: integer("channel_id").references(() => channels.id),
    creatorId: integer("creator_id").references(() => creators.id),
    sourceType: text("source_type", {
      enum: ["video", "short", "article", "pdf", "file", "tweet"],
    }).notNull(),
    provider: text("provider").notNull(),
    url: text("url"),
    filePath: text("file_path"),
    canonicalUrl: text("canonical_url"),
    contentHash: text("content_hash").notNull(),
    title: text("title"),
    description: text("description"),
    durationSec: real("duration_sec"),
    publishedAt: text("published_at"),
    language: text("language"),
    rawMetadata: text("raw_metadata", { mode: "json" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("content_items_hash").on(t.contentHash)],
);

export const transcripts = sqliteTable("transcripts", {
  id: id(),
  contentItemId: integer("content_item_id")
    .notNull()
    .references(() => contentItems.id),
  source: text("source", {
    enum: ["subtitles_manual", "subtitles_auto", "whisper", "native_text"],
  }).notNull(),
  language: text("language"),
  text: text("text").notNull(),
  segments: text("segments", { mode: "json" }),
  whisperModel: text("whisper_model"),
  createdAt: createdAt(),
});

/** Medición puntual de vistas/likes/comments con timestamp — permite calcular deltas/velocidad. */
export const metricSnapshots = sqliteTable(
  "metric_snapshots",
  {
    id: id(),
    contentItemId: integer("content_item_id")
      .notNull()
      .references(() => contentItems.id),
    observedAt: text("observed_at").notNull(),
    viewCount: integer("view_count"),
    likeCount: integer("like_count"),
    commentCount: integer("comment_count"),
    source: text("source").notNull(),
  },
  (t) => [index("metric_snapshots_content_item").on(t.contentItemId, t.observedAt)],
);

export const comments = sqliteTable("comments", {
  id: id(),
  contentItemId: integer("content_item_id")
    .notNull()
    .references(() => contentItems.id),
  author: text("author").notNull(),
  text: text("text").notNull(),
  likes: integer("likes"),
  repliedTo: text("replied_to"),
  postedAt: text("posted_at"),
  createdAt: createdAt(),
});

export const analyses = sqliteTable(
  "analyses",
  {
    id: id(),
    contentItemId: integer("content_item_id")
      .notNull()
      .references(() => contentItems.id),
    schemaVersion: integer("schema_version").notNull(),
    pipelineVersion: text("pipeline_version").notNull(),
    depth: text("depth", { enum: ["quick", "standard", "full"] }).notNull(),
    aiEngine: text("ai_engine"),
    aiModel: text("ai_model"),
    document: text("document", { mode: "json" }),
    status: text("status", {
      enum: ["queued", "running", "done", "failed", "failed_with_guidance"],
    }).notNull(),
    error: text("error"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("analyses_content_pipeline").on(t.contentItemId, t.pipelineVersion)],
);

export const facets = sqliteTable(
  "facets",
  {
    id: id(),
    analysisId: integer("analysis_id")
      .notNull()
      .references(() => analyses.id),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    detail: text("detail", { mode: "json" }),
    confidence: real("confidence"),
  },
  (t) => [index("facets_kind_value").on(t.kind, t.value)],
);

export const comparisons = sqliteTable("comparisons", {
  id: id(),
  kind: text("kind", {
    enum: ["creators", "videos", "channels", "technologies", "courses"],
  }).notNull(),
  subjectIds: text("subject_ids", { mode: "json" }).notNull(),
  dimensions: text("dimensions", { mode: "json" }),
  result: text("result", { mode: "json" }),
  aiEngine: text("ai_engine"),
  createdAt: createdAt(),
});

export const courses = sqliteTable("courses", {
  id: id(),
  title: text("title").notNull(),
  sourceAnalysisIds: text("source_analysis_ids", { mode: "json" }).notNull(),
  level: text("level"),
  structure: text("structure", { mode: "json" }).notNull(),
  createdAt: createdAt(),
});

export const roadmaps = sqliteTable("roadmaps", {
  id: id(),
  domain: text("domain").notNull(),
  sourceAnalysisIds: text("source_analysis_ids", { mode: "json" }),
  graph: text("graph", { mode: "json" }).notNull(),
  rendered: text("rendered", { mode: "json" }),
  createdAt: createdAt(),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
  status: text("status", {
    enum: ["queued", "running", "done", "failed", "failed_with_guidance"],
  }).notNull(),
  progress: text("progress", { mode: "json" }),
  checkpoints: text("checkpoints", { mode: "json" }),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  resultId: text("result_id"),
  createdAt: createdAt(),
  updatedAt: text("updated_at"),
});

/** Fila única (id=1): heartbeat del worker para healthcheck desde el servidor MCP. */
export const workerHeartbeats = sqliteTable("worker_heartbeats", {
  id: integer("id").primaryKey(),
  pid: integer("pid").notNull(),
  currentJobId: text("current_job_id"),
  updatedAt: text("updated_at").notNull(),
});

export const cacheEntries = sqliteTable("cache_entries", {
  key: text("key").primaryKey(),
  analysisId: integer("analysis_id")
    .notNull()
    .references(() => analyses.id),
  pipelineVersion: text("pipeline_version").notNull(),
  expiresAt: text("expires_at").notNull(),
});
