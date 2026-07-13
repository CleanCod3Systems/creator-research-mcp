import type { AnalysisDocument } from "@creator-research/core";
import { and, desc, eq, gt, like, sql } from "drizzle-orm";
import type { DbClient } from "./client.js";
import {
  analyses,
  comments,
  comparisons,
  contentItems,
  courses,
  creators,
  facets,
  metricSnapshots,
  roadmaps,
  transcripts,
} from "./schema.js";

export class ContentRepository {
  constructor(private readonly db: DbClient) {}

  /** Idempotent by contentHash: returns the existing row or creates one. */
  upsertContentItem(data: typeof contentItems.$inferInsert): number {
    const existing = this.db
      .select({ id: contentItems.id })
      .from(contentItems)
      .where(eq(contentItems.contentHash, data.contentHash))
      .get();
    if (existing) return existing.id;
    const inserted = this.db
      .insert(contentItems)
      .values(data)
      .returning({ id: contentItems.id })
      .get();
    return inserted.id;
  }

  insertTranscript(data: typeof transcripts.$inferInsert): void {
    this.db.insert(transcripts).values(data).run();
  }

  findIdByHash(hash: string): number | null {
    const row = this.db
      .select({ id: contentItems.id })
      .from(contentItems)
      .where(eq(contentItems.contentHash, hash))
      .get();
    return row?.id ?? null;
  }

  getItem(contentItemId: number): typeof contentItems.$inferSelect | null {
    return (
      this.db.select().from(contentItems).where(eq(contentItems.id, contentItemId)).get() ?? null
    );
  }

  getTranscript(
    contentItemId: number,
  ): { text: string; source: string; language: string | null } | null {
    const row = this.db
      .select({
        text: transcripts.text,
        source: transcripts.source,
        language: transcripts.language,
      })
      .from(transcripts)
      .where(eq(transcripts.contentItemId, contentItemId))
      .orderBy(desc(transcripts.id))
      .get();
    return row ?? null;
  }
}

export interface MetricSnapshotRow {
  observedAt: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  source: string;
}

export class MetricsRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * One snapshot per call, unless one that's practically identical already exists in the last
   * 5 minutes (avoids noise if the client LLM asks for the same thing twice in a row by mistake).
   */
  recordSnapshot(
    contentItemId: number,
    metrics: { viewCount?: number | null; likeCount?: number | null; commentCount?: number | null },
    source: string,
    observedAt = new Date().toISOString(),
  ): void {
    // the "practically identical in the last 5 min" dedup only applies to live (now) measurements;
    // a manual import with its own date is always saved, it's a measurement from a different moment
    const isLiveNow = Math.abs(Date.now() - new Date(observedAt).getTime()) < 60_000;
    if (isLiveNow) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      const recent = this.db
        .select({
          viewCount: metricSnapshots.viewCount,
          likeCount: metricSnapshots.likeCount,
          commentCount: metricSnapshots.commentCount,
        })
        .from(metricSnapshots)
        .where(
          and(
            eq(metricSnapshots.contentItemId, contentItemId),
            gt(metricSnapshots.observedAt, fiveMinAgo),
          ),
        )
        .orderBy(desc(metricSnapshots.id))
        .get();
      const viewCount = metrics.viewCount ?? null;
      const likeCount = metrics.likeCount ?? null;
      const commentCount = metrics.commentCount ?? null;
      if (
        recent?.viewCount === viewCount &&
        recent.likeCount === likeCount &&
        recent.commentCount === commentCount
      ) {
        return;
      }
    }
    this.db
      .insert(metricSnapshots)
      .values({
        contentItemId,
        observedAt,
        viewCount: metrics.viewCount ?? null,
        likeCount: metrics.likeCount ?? null,
        commentCount: metrics.commentCount ?? null,
        source,
      })
      .run();
  }

  getSnapshots(contentItemId: number): MetricSnapshotRow[] {
    return this.db
      .select({
        observedAt: metricSnapshots.observedAt,
        viewCount: metricSnapshots.viewCount,
        likeCount: metricSnapshots.likeCount,
        commentCount: metricSnapshots.commentCount,
        source: metricSnapshots.source,
      })
      .from(metricSnapshots)
      .where(eq(metricSnapshots.contentItemId, contentItemId))
      .orderBy(metricSnapshots.observedAt)
      .all();
  }
}

export class AnalysisRepository {
  constructor(private readonly db: DbClient) {}

  create(
    contentItemId: number,
    pipelineVersion: string,
    depth: "quick" | "standard" | "full",
  ): number {
    return this.db
      .insert(analyses)
      .values({
        contentItemId,
        schemaVersion: 1,
        pipelineVersion,
        depth,
        status: "running",
        startedAt: new Date().toISOString(),
      })
      .returning({ id: analyses.id })
      .get().id;
  }

  complete(analysisId: number, doc: AnalysisDocument): void {
    this.db
      .update(analyses)
      .set({
        document: doc,
        status: "done",
        aiEngine: doc.ai?.engine,
        aiModel: doc.ai?.model,
        finishedAt: new Date().toISOString(),
      })
      .where(eq(analyses.id, analysisId))
      .run();
    const entries = Object.entries(doc.facets) as [
      string,
      AnalysisDocument["facets"][keyof AnalysisDocument["facets"]],
    ][];
    const rows = entries.flatMap(([kind, items]) =>
      (items ?? []).map((item) => ({
        analysisId,
        kind,
        value: item.value,
        detail: { detail: item.detail, evidence: item.evidence },
        confidence: item.confidence,
      })),
    );
    if (rows.length > 0) this.db.insert(facets).values(rows).run();
  }

  getById(analysisId: number): {
    id: number;
    status: string;
    document: AnalysisDocument | null;
    error: string | null;
  } | null {
    const row = this.db.select().from(analyses).where(eq(analyses.id, analysisId)).get();
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      document: row.document as AnalysisDocument | null,
      error: row.error,
    };
  }

  getLatestDoneByHash(contentHash: string): { id: number; document: AnalysisDocument } | null {
    const row = this.db
      .select({ id: analyses.id, document: analyses.document })
      .from(analyses)
      .innerJoin(contentItems, eq(analyses.contentItemId, contentItems.id))
      .where(and(eq(contentItems.contentHash, contentHash), eq(analyses.status, "done")))
      .orderBy(desc(analyses.id))
      .get();
    return row?.document ? { id: row.id, document: row.document as AnalysisDocument } : null;
  }
}

export class CommentsRepository {
  constructor(private readonly db: DbClient) {}

  replaceForItem(
    contentItemId: number,
    rows: { author: string; text: string; likes?: number; parentId?: string; postedAt?: string }[],
  ): void {
    this.db.delete(comments).where(eq(comments.contentItemId, contentItemId)).run();
    if (rows.length === 0) return;
    this.db
      .insert(comments)
      .values(
        rows.map((c) => ({
          contentItemId,
          author: c.author,
          text: c.text,
          likes: c.likes,
          repliedTo: c.parentId,
          postedAt: c.postedAt,
        })),
      )
      .run();
  }

  getForItem(
    contentItemId: number,
  ): { author: string; text: string; likes: number | null; repliedTo: string | null }[] {
    return this.db
      .select({
        author: comments.author,
        text: comments.text,
        likes: comments.likes,
        repliedTo: comments.repliedTo,
      })
      .from(comments)
      .where(eq(comments.contentItemId, contentItemId))
      .orderBy(desc(comments.likes))
      .all();
  }
}

export class GenerationRepository {
  constructor(private readonly db: DbClient) {}

  insertComparison(kind: string, subjectIds: number[], result: unknown): number {
    return this.db
      .insert(comparisons)
      .values({ kind: kind as "videos", subjectIds, result })
      .returning({ id: comparisons.id })
      .get().id;
  }

  insertCourse(
    title: string,
    sourceAnalysisIds: number[],
    level: string | null,
    structure: unknown,
  ): number {
    return this.db
      .insert(courses)
      .values({ title, sourceAnalysisIds, level, structure })
      .returning({ id: courses.id })
      .get().id;
  }

  insertRoadmap(
    domain: string,
    sourceAnalysisIds: number[],
    graph: unknown,
    rendered: unknown,
  ): number {
    return this.db
      .insert(roadmaps)
      .values({ domain, sourceAnalysisIds, graph, rendered })
      .returning({ id: roadmaps.id })
      .get().id;
  }
}

export interface FacetSearchRow {
  analysisId: number;
  kind: string;
  value: string;
  confidence: number | null;
  title: string | null;
  url: string | null;
  provider: string;
}

export class SearchRepository {
  constructor(private readonly db: DbClient) {}

  /** Searches the denormalized facets: "who teaches Astro?" in a single query. */
  searchFacets(query: string, kind?: string, limit = 30): FacetSearchRow[] {
    const conditions = [
      like(sql`lower(${facets.value})`, `%${query.toLowerCase()}%`),
      eq(analyses.status, "done"),
    ];
    if (kind) conditions.push(eq(facets.kind, kind));
    return this.db
      .select({
        analysisId: facets.analysisId,
        kind: facets.kind,
        value: facets.value,
        confidence: facets.confidence,
        title: contentItems.title,
        url: contentItems.url,
        provider: contentItems.provider,
      })
      .from(facets)
      .innerJoin(analyses, eq(facets.analysisId, analyses.id))
      .innerJoin(contentItems, eq(analyses.contentItemId, contentItems.id))
      .where(and(...conditions))
      .limit(limit)
      .all();
  }

  listAnalyses(limit = 20): {
    id: number;
    title: string | null;
    url: string | null;
    provider: string;
    status: string;
    depth: string;
    aiEngine: string | null;
    createdAt: string;
  }[] {
    return this.db
      .select({
        id: analyses.id,
        title: contentItems.title,
        url: contentItems.url,
        provider: contentItems.provider,
        status: analyses.status,
        depth: analyses.depth,
        aiEngine: analyses.aiEngine,
        createdAt: analyses.createdAt,
      })
      .from(analyses)
      .innerJoin(contentItems, eq(analyses.contentItemId, contentItems.id))
      .orderBy(desc(analyses.id))
      .limit(limit)
      .all();
  }
}

/** Manually imported profiles/creators (e.g. an Instagram snapshot with no automated API). */
export class ProfileRepository {
  constructor(private readonly db: DbClient) {}

  upsertCreator(data: {
    platform: string;
    handle: string;
    name: string;
    url?: string;
    metrics?: unknown;
  }): number {
    const inserted = this.db
      .insert(creators)
      .values({
        platform: data.platform,
        handle: data.handle,
        name: data.name,
        url: data.url,
        metrics: data.metrics,
      })
      .onConflictDoUpdate({
        target: [creators.platform, creators.handle],
        set: { name: data.name, url: data.url, metrics: data.metrics },
      })
      .returning({ id: creators.id })
      .get();
    return inserted.id;
  }
}
