import type {
  AnalysisDocument,
  JobProgress,
  JobQueue,
  JobRecord,
  JobStatus,
} from "@creator-research/core";
import { and, desc, eq, gt, like, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DbClient } from "./client.js";
import {
  analyses,
  cacheEntries,
  comments,
  comparisons,
  contentItems,
  courses,
  creators,
  facets,
  jobs,
  metricSnapshots,
  roadmaps,
  transcripts,
  workerHeartbeats,
} from "./schema.js";

export class ContentRepository {
  constructor(private readonly db: DbClient) {}

  /** Idempotente por contentHash: devuelve el existente o crea. */
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
   * Un snapshot por llamado, salvo que ya haya uno prácticamente idéntico en los últimos 5
   * minutos (evita ruido si el LLM cliente pide lo mismo dos veces seguidas por error).
   */
  recordSnapshot(
    contentItemId: number,
    metrics: { viewCount?: number | null; likeCount?: number | null; commentCount?: number | null },
    source: string,
    observedAt = new Date().toISOString(),
  ): void {
    // el dedup de "casi idéntico en los últimos 5 min" solo aplica a mediciones en vivo (ahora);
    // un import manual con fecha propia siempre se guarda, es una medición de un momento distinto
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

  fail(analysisId: number, status: "failed" | "failed_with_guidance", error: string): void {
    this.db
      .update(analyses)
      .set({ status, error, finishedAt: new Date().toISOString() })
      .where(eq(analyses.id, analysisId))
      .run();
  }

  /** Análisis "running" huérfanos: el worker murió/reinició antes de terminarlos. */
  listStaleRunning(staleMs: number): { id: number; startedAt: string | null }[] {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    return this.db
      .select({ id: analyses.id, startedAt: analyses.startedAt })
      .from(analyses)
      .where(and(eq(analyses.status, "running"), lte(analyses.createdAt, cutoff)))
      .all();
  }

  /** Los marca failed con un motivo claro en vez de dejarlos running para siempre. */
  failStaleRunning(staleMs: number, message: string): number {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    const rows = this.db
      .update(analyses)
      .set({ status: "failed", error: message, finishedAt: new Date().toISOString() })
      .where(and(eq(analyses.status, "running"), lte(analyses.createdAt, cutoff)))
      .returning({ id: analyses.id })
      .all();
    return rows.length;
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

  /** Busca en las facetas desnormalizadas: "¿quién enseña Astro?" en una query. */
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

export class CacheRepository {
  constructor(private readonly db: DbClient) {}

  getValid(key: string): number | null {
    const row = this.db
      .select({ analysisId: cacheEntries.analysisId })
      .from(cacheEntries)
      .where(and(eq(cacheEntries.key, key), gt(cacheEntries.expiresAt, new Date().toISOString())))
      .get();
    return row?.analysisId ?? null;
  }

  set(key: string, analysisId: number, pipelineVersion: string, ttlDays: number): void {
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
    this.db
      .insert(cacheEntries)
      .values({ key, analysisId, pipelineVersion, expiresAt })
      .onConflictDoUpdate({
        target: cacheEntries.key,
        set: { analysisId, pipelineVersion, expiresAt },
      })
      .run();
  }
}

export class SqliteJobQueue implements JobQueue {
  constructor(private readonly db: DbClient) {}

  /**
   * Jobs "running" cuya última actualización es más vieja que staleMs → re-encolados.
   * staleMs=0 (default, uso al boot del worker): recupera TODOS los running, porque si el
   * proceso está arrancando, cualquier "running" es de un worker anterior que ya no existe.
   * Con staleMs>0 (uso periódico dentro del loop, worker vivo): solo recupera los realmente
   * colgados (p.ej. un fetch sin timeout), sin tocar el job que se está procesando ahora mismo.
   */
  recoverStale(staleMs = 0): number {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    const rows = this.db
      .update(jobs)
      .set({ status: "queued", updatedAt: new Date().toISOString() })
      .where(and(eq(jobs.status, "running"), lte(jobs.updatedAt, cutoff)))
      .returning({ id: jobs.id })
      .all();
    return rows.length;
  }

  /** Conteo por estado, para healthcheck. */
  counts(): Record<JobStatus, number> {
    const rows = this.db
      .select({ status: jobs.status, n: sql<number>`count(*)` })
      .from(jobs)
      .groupBy(jobs.status)
      .all();
    const base: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      done: 0,
      failed: 0,
      failed_with_guidance: 0,
    };
    for (const r of rows) base[r.status] = r.n;
    return base;
  }

  enqueue(type: string, payload: unknown): Promise<string> {
    const id = randomUUID();
    this.db
      .insert(jobs)
      .values({
        id,
        type,
        payload,
        status: "queued",
        progress: { percent: 0 },
        updatedAt: new Date().toISOString(),
      })
      .run();
    return Promise.resolve(id);
  }

  get(jobId: string): Promise<JobRecord | null> {
    const row = this.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!row) return Promise.resolve(null);
    return Promise.resolve({
      id: row.id,
      type: row.type,
      payload: row.payload,
      status: row.status,
      progress: (row.progress ?? { percent: 0 }) as JobProgress,
      attempts: row.attempts,
      lastError: row.lastError ?? undefined,
      resultId: row.resultId ?? undefined,
      createdAt: row.createdAt,
    });
  }

  claimNext(types: string[]): Promise<JobRecord | null> {
    // better-sqlite3 es síncrono: la transacción garantiza que un solo worker reclama el job
    const claimed = this.db.transaction((tx) => {
      const row = tx
        .select()
        .from(jobs)
        .where(eq(jobs.status, "queued"))
        .orderBy(jobs.createdAt)
        .get();
      if (!row || !types.includes(row.type)) return null;
      tx.update(jobs)
        .set({ status: "running", attempts: row.attempts + 1, updatedAt: new Date().toISOString() })
        .where(eq(jobs.id, row.id))
        .run();
      return { ...row, status: "running" as const, attempts: row.attempts + 1 };
    });
    if (!claimed) return Promise.resolve(null);
    return Promise.resolve({
      id: claimed.id,
      type: claimed.type,
      payload: claimed.payload,
      status: claimed.status,
      progress: (claimed.progress ?? { percent: 0 }) as JobProgress,
      attempts: claimed.attempts,
      lastError: claimed.lastError ?? undefined,
      resultId: claimed.resultId ?? undefined,
      createdAt: claimed.createdAt,
    });
  }

  update(
    jobId: string,
    patch: Partial<Pick<JobRecord, "status" | "progress" | "lastError" | "resultId">>,
  ): Promise<void> {
    this.db
      .update(jobs)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(jobs.id, jobId))
      .run();
    return Promise.resolve();
  }
}

/** Heartbeat de fila única: le permite al servidor MCP saber si el worker está vivo. */
export class HeartbeatRepository {
  constructor(private readonly db: DbClient) {}

  touch(pid: number, currentJobId: string | null): void {
    this.db
      .insert(workerHeartbeats)
      .values({ id: 1, pid, currentJobId, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: workerHeartbeats.id,
        set: { pid, currentJobId, updatedAt: new Date().toISOString() },
      })
      .run();
  }

  get(): { pid: number; currentJobId: string | null; updatedAt: string } | null {
    return this.db.select().from(workerHeartbeats).where(eq(workerHeartbeats.id, 1)).get() ?? null;
  }
}

/** Perfiles/creadores importados manualmente (ej. snapshot de Instagram sin API automática). */
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
