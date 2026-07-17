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
    identityKey: text("identity_key").notNull().default(sql`''`),
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    archivedAt: text("archived_at"),
    url: text("url"),
    bio: text("bio"),
    metrics: text("metrics", { mode: "json" }),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [
    uniqueIndex("creators_platform_handle").on(t.platform, t.handle),
    uniqueIndex("creators_identity_key").on(t.identityKey),
  ],
);

export const creatorProfiles = sqliteTable(
  "creator_profiles",
  {
    id: id(),
    creatorId: integer("creator_id").notNull().references(() => creators.id),
    platform: text("platform").notNull(),
    handle: text("handle").notNull(),
    url: text("url").notNull(),
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    followers: integer("followers"),
    lastSyncedAt: text("last_synced_at"),
    metadata: text("metadata", { mode: "json" }),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("creator_profiles_platform_handle").on(t.platform, t.handle)],
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
    enum: ["subtitles_manual", "subtitles_auto", "native_text"],
  }).notNull(),
  language: text("language"),
  text: text("text").notNull(),
  segments: text("segments", { mode: "json" }),
  createdAt: createdAt(),
});

/** Point-in-time views/likes/comments measurement with a timestamp — enables delta/velocity calculations. */
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

export const researchRuns = sqliteTable(
  "research_runs",
  {
    id: id(),
    batchKey: text("batch_key").notNull(),
    market: text("market").notNull().default("Paraguay"),
    language: text("language").notNull().default("es"),
    referenceScope: text("reference_scope").notNull().default("global"),
    inputUrls: text("input_urls", { mode: "json" }).notNull(),
    result: text("result", { mode: "json" }).notNull().default(sql`'{}'`),
    status: text("status", { enum: ["running", "done", "partial", "failed"] }).notNull().default("running"),
    error: text("error"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("research_runs_batch_key").on(t.batchKey)],
);

export const contentIdeas = sqliteTable(
  "content_ideas",
  {
    id: id(),
    runId: integer("run_id").references(() => researchRuns.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    platform: text("platform").notNull(),
    format: text("format").notNull(),
    status: text("status", { enum: ["idea", "selected", "produced", "published", "validated", "discarded"] }).notNull().default("idea"),
    titleOptions: text("title_options", { mode: "json" }).notNull(),
    problem: text("problem").notNull(),
    whyNow: text("why_now").notNull(),
    evidenceSummary: text("evidence_summary").notNull(),
    paraguayanAngle: text("paraguayan_angle").notNull(),
    promise: text("promise").notNull(),
    spokenHook: text("spoken_hook").notNull(),
    visualHook: text("visual_hook").notNull(),
    scriptBeats: text("script_beats", { mode: "json" }).notNull(),
    visualPlan: text("visual_plan", { mode: "json" }).notNull(),
    onScreenText: text("on_screen_text", { mode: "json" }).notNull(),
    caption: text("caption").notNull(),
    cta: text("cta").notNull(),
    hashtags: text("hashtags", { mode: "json" }).notNull(),
    durationSec: integer("duration_sec"),
    effort: text("effort"),
    confidence: real("confidence").notNull().default(0),
    scores: text("scores", { mode: "json" }).notNull(),
    validationMetric: text("validation_metric").notNull(),
    sourceCreatorNames: text("source_creator_names", { mode: "json" }).notNull(),
    sourceUrls: text("source_urls", { mode: "json" }).notNull(),
    sourceContentIds: text("source_content_ids", { mode: "json" }).notNull(),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("content_ideas_fingerprint").on(t.fingerprint), index("content_ideas_platform_status").on(t.platform, t.status)],
);

export const ideaEvidence = sqliteTable(
  "idea_evidence",
  {
    id: id(),
    ideaId: integer("idea_id").notNull().references(() => contentIdeas.id, { onDelete: "cascade" }),
    contentItemId: integer("content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
    analysisId: integer("analysis_id").references(() => analyses.id, { onDelete: "set null" }),
    evidenceType: text("evidence_type").notNull(),
    detail: text("detail", { mode: "json" }).notNull(),
    quote: text("quote"),
    confidence: real("confidence").notNull().default(0),
  },
  (t) => [index("idea_evidence_idea").on(t.ideaId)],
);

export const learnings = sqliteTable(
  "learnings",
  {
    id: id(),
    fingerprint: text("fingerprint").notNull(),
    title: text("title").notNull(),
    statement: text("statement").notNull(),
    evidence: text("evidence", { mode: "json" }).notNull(),
    status: text("status", { enum: ["proposed", "validated", "rejected"] }).notNull().default("proposed"),
    sourceIdeaIds: text("source_idea_ids", { mode: "json" }).notNull(),
    validatedAt: text("validated_at"),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("learnings_fingerprint").on(t.fingerprint)],
);

export const experiments = sqliteTable(
  "experiments",
  {
    id: id(),
    ideaId: integer("idea_id").notNull().references(() => contentIdeas.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    format: text("format").notNull(),
    status: text("status", { enum: ["planned", "published", "measured", "cancelled"] }).notNull().default("planned"),
    publishedAt: text("published_at"),
    targetMetric: text("target_metric").notNull(),
    actualMetrics: text("actual_metrics", { mode: "json" }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [index("experiments_idea_status").on(t.ideaId, t.status)],
);
