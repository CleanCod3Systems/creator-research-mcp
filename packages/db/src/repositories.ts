import type { AnalysisDocument } from "@cleancod3/core";
import { and, desc, eq, gt, inArray, like, sql } from "drizzle-orm";
import type { DbClient } from "./client.js";
import {
  analyses,
  comments,
  comparisons,
  contentItems,
  courses,
  creators,
  creatorProfiles,
  contentIdeas,
  facets,
  experiments,
  ideaEvidence,
  learnings,
  metricSnapshots,
  researchRuns,
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
    if (existing) {
      const updates = Object.fromEntries(
        Object.entries(data).filter(([key, value]) => key !== "id" && value !== undefined),
      ) as Partial<typeof contentItems.$inferInsert>;
      if (Object.keys(updates).length > 0) {
        this.db.update(contentItems).set(updates).where(eq(contentItems.id, existing.id)).run();
      }
      return existing.id;
    }
    const inserted = this.db
      .insert(contentItems)
      .values(data)
      .returning({ id: contentItems.id })
      .get();
    return inserted.id;
  }

  updateContentItem(contentItemId: number, data: Partial<typeof contentItems.$inferInsert>): void {
    this.db.update(contentItems).set(data).where(eq(contentItems.id, contentItemId)).run();
  }

  saveContentLayers(contentItemId: number, layers: Record<string, unknown>): void {
    const item = this.getItem(contentItemId);
    const raw = item?.rawMetadata && typeof item.rawMetadata === "object" ? item.rawMetadata as Record<string, unknown> : {};
    this.updateContentItem(contentItemId, { rawMetadata: { ...raw, _contentLayers: layers } });
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

  getLastFetchedAt(contentItemId: number): string | null {
    const row = this.db
      .select({ createdAt: comments.createdAt })
      .from(comments)
      .where(eq(comments.contentItemId, contentItemId))
      .orderBy(desc(comments.createdAt))
      .get();
    return row?.createdAt ?? null;
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

export interface ContentIdeaInput {
  fingerprint?: string;
  platform: string;
  format: string;
  titleOptions?: string[];
  problem: string;
  whyNow: string;
  evidenceSummary: string;
  paraguayanAngle: string;
  promise: string;
  spokenHook: string;
  visualHook: string;
  scriptBeats?: unknown[];
  visualPlan?: unknown[];
  onScreenText?: string[];
  caption: string;
  cta: string;
  hashtags?: string[];
  durationSec?: number | null;
  effort?: string | null;
  confidence?: number;
  scores?: Record<string, number>;
  validationMetric: string;
  sourceCreatorNames?: string[];
  sourceUrls?: string[];
  sourceContentIds?: number[];
  evidence?: Array<{ contentItemId?: number | null; analysisId?: number | null; evidenceType?: string; detail?: unknown; quote?: string | null; confidence?: number }>;
}

export class IntelligenceRepository {
  constructor(private readonly db: DbClient) {}

  createRun(data: { batchKey: string; market?: string; language?: string; referenceScope?: string; inputUrls: string[] }): number {
    const existing = this.db.select({ id: researchRuns.id }).from(researchRuns).where(eq(researchRuns.batchKey, data.batchKey)).get();
    if (existing) return existing.id;
    return this.db.insert(researchRuns).values({
      batchKey: data.batchKey,
      market: data.market ?? "Paraguay",
      language: data.language ?? "es",
      referenceScope: data.referenceScope ?? "global",
      inputUrls: data.inputUrls,
      startedAt: new Date().toISOString(),
    }).returning({ id: researchRuns.id }).get().id;
  }

  finishRun(runId: number, status: "done" | "partial" | "failed", error?: string): void {
    this.db.update(researchRuns).set({ status, error: error ?? null, finishedAt: new Date().toISOString() }).where(eq(researchRuns.id, runId)).run();
  }

  saveRunResult(runId: number, result: Record<string, unknown>): void {
    this.db.update(researchRuns).set({ result }).where(eq(researchRuns.id, runId)).run();
  }

  listRuns() {
    return this.db.select().from(researchRuns).orderBy(desc(researchRuns.createdAt)).limit(50).all();
  }

  saveIdeas(runId: number, ideas: ContentIdeaInput[]): number[] {
    const ids: number[] = [];
    for (const input of ideas) {
      const fingerprint = input.fingerprint ?? IntelligenceRepository.fingerprint(input);
      const existing = this.db.select({ id: contentIdeas.id }).from(contentIdeas).where(eq(contentIdeas.fingerprint, fingerprint)).get();
      const values = {
        runId,
        fingerprint,
        platform: input.platform,
        format: input.format,
        titleOptions: input.titleOptions ?? [],
        problem: input.problem,
        whyNow: input.whyNow,
        evidenceSummary: input.evidenceSummary,
        paraguayanAngle: input.paraguayanAngle,
        promise: input.promise,
        spokenHook: input.spokenHook,
        visualHook: input.visualHook,
        scriptBeats: input.scriptBeats ?? [],
        visualPlan: input.visualPlan ?? [],
        onScreenText: input.onScreenText ?? [],
        caption: input.caption,
        cta: input.cta,
        hashtags: input.hashtags ?? [],
        durationSec: input.durationSec ?? null,
        effort: input.effort ?? null,
        confidence: Math.max(0, Math.min(1, input.confidence ?? 0)),
        scores: input.scores ?? {},
        validationMetric: input.validationMetric,
        sourceCreatorNames: input.sourceCreatorNames ?? [],
        sourceUrls: input.sourceUrls ?? [],
        sourceContentIds: input.sourceContentIds ?? [],
        updatedAt: new Date().toISOString(),
      };
      const id = existing
        ? (this.db.update(contentIdeas).set(values).where(eq(contentIdeas.id, existing.id)).returning({ id: contentIdeas.id }).get()?.id ?? existing.id)
        : this.db.insert(contentIdeas).values(values).returning({ id: contentIdeas.id }).get().id;
      ids.push(id);
      this.db.delete(ideaEvidence).where(eq(ideaEvidence.ideaId, id)).run();
      if (input.evidence?.length) this.db.insert(ideaEvidence).values(input.evidence.map((e) => ({
        ideaId: id,
        contentItemId: e.contentItemId ?? null,
        analysisId: e.analysisId ?? null,
        evidenceType: e.evidenceType ?? "observed_content",
        detail: e.detail ?? {},
        quote: e.quote ?? null,
        confidence: Math.max(0, Math.min(1, e.confidence ?? 0)),
      }))).run();
    }
    return ids;
  }

  listIdeas(filters: { platform?: string; status?: string } = {}) {
    const rows = this.db.select().from(contentIdeas).orderBy(desc(contentIdeas.updatedAt)).limit(100).all();
    return rows.filter((row) => (!filters.platform || row.platform.toLowerCase() === filters.platform.toLowerCase()) && (!filters.status || row.status === filters.status));
  }

  getIdea(id: number) {
    const idea = this.db.select().from(contentIdeas).where(eq(contentIdeas.id, id)).get();
    if (!idea) return null;
    return { ...idea, evidence: this.db.select().from(ideaEvidence).where(eq(ideaEvidence.ideaId, id)).all() };
  }

  updateIdeaStatus(id: number, status: "idea" | "selected" | "produced" | "published" | "validated" | "discarded"): void {
    this.db.update(contentIdeas).set({ status, updatedAt: new Date().toISOString() }).where(eq(contentIdeas.id, id)).run();
  }

  saveLearnings(items: Array<{ fingerprint?: string; title: string; statement: string; evidence?: unknown; sourceIdeaIds?: number[] }>): number[] {
    const ids: number[] = [];
    for (const item of items) {
      const fingerprint = item.fingerprint ?? IntelligenceRepository.compact(`${item.title}:${item.statement}`);
      const existing = this.db.select({ id: learnings.id }).from(learnings).where(eq(learnings.fingerprint, fingerprint)).get();
      const values = { fingerprint, title: item.title, statement: item.statement, evidence: item.evidence ?? [], sourceIdeaIds: item.sourceIdeaIds ?? [], updatedAt: new Date().toISOString() };
      const id = existing ? (this.db.update(learnings).set(values).where(eq(learnings.id, existing.id)).returning({ id: learnings.id }).get()?.id ?? existing.id) : this.db.insert(learnings).values(values).returning({ id: learnings.id }).get().id;
      ids.push(id);
    }
    return ids;
  }

  listLearnings(status?: string) {
    return this.db.select().from(learnings).where(status ? eq(learnings.status, status as "proposed" | "validated" | "rejected") : undefined).orderBy(desc(learnings.updatedAt)).limit(100).all();
  }

  updateLearningStatus(id: number, status: "proposed" | "validated" | "rejected"): void {
    this.db.update(learnings).set({ status, validatedAt: status === "validated" ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }).where(eq(learnings.id, id)).run();
  }

  createExperiment(data: { ideaId: number; platform: string; format: string; targetMetric: string; publishedAt?: string; notes?: string }): number {
    return this.db.insert(experiments).values(data).returning({ id: experiments.id }).get().id;
  }

  listExperiments() {
    return this.db.select().from(experiments).orderBy(desc(experiments.createdAt)).limit(100).all();
  }

  memoryPack(): { evidence: string; learnings: string; experiments: string } {
    const ideas = this.listIdeas();
    const learningRows = this.listLearnings();
    const experimentRows = this.listExperiments();
    const runs = this.db.select().from(researchRuns).orderBy(desc(researchRuns.createdAt)).limit(50).all();
    const runEvidence = runs.map((run) => {
      const result = (run.result ?? {}) as Record<string, unknown>;
      const list = (value: unknown) => Array.isArray(value) ? value : [];
      return [`## Investigación ${run.id} · ${run.finishedAt ?? run.startedAt}`, `- Estado: ${run.status}`, `- Fuentes: ${(Array.isArray(run.inputUrls) ? run.inputUrls : []).join(", ")}`, `- Resumen: ${String(result.summary ?? "Sin resumen verificable")}`, `- Hechos: ${JSON.stringify(list(result.facts))}`, `- Señales de audiencia: ${JSON.stringify(list(result.audienceSignals))}`, `- Oportunidades: ${JSON.stringify(list(result.opportunities))}`].join("\n");
    });
    const evidence = ["# CleanCod3 · Evidencia y patrones", "", "Mercado: Paraguay. Referencias: globales y multilingües.", "", ...runEvidence, ...ideas.map((idea) => `## Brief · ${String((Array.isArray(idea.titleOptions) ? idea.titleOptions[0] : undefined) ?? idea.promise)}\n- Estado: ${idea.status}\n- Red: ${idea.platform}\n- Formato: ${idea.format}\n- Problema: ${idea.problem}\n- Evidencia: ${idea.evidenceSummary}\n- Ángulo Paraguay: ${idea.paraguayanAngle}\n- Confianza: ${Math.round(Number(idea.confidence) * 100)}%\n- Fuentes: ${(Array.isArray(idea.sourceUrls) ? idea.sourceUrls : []).join(", ")}`)].join("\n");
    const learnings = ["# CleanCod3 · Aprendizajes validados", "", ...learningRows.map((item) => `## ${item.title}\n- Estado: ${item.status}\n- Aprendizaje: ${item.statement}\n- Evidencia: ${JSON.stringify(item.evidence)}`)].join("\n");
    const experiments = ["# CleanCod3 · Experimentos y resultados", "", ...experimentRows.map((item) => `## Experimento ${item.id}\n- Idea: ${item.ideaId}\n- Red: ${item.platform}\n- Formato: ${item.format}\n- Estado: ${item.status}\n- Métrica objetivo: ${item.targetMetric}\n- Resultado: ${JSON.stringify(item.actualMetrics ?? {})}`)].join("\n");
    return { evidence, learnings, experiments };
  }

  private static compact(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  private static fingerprint(input: ContentIdeaInput): string { return IntelligenceRepository.compact(`${input.platform}|${input.format}|${input.problem}|${input.promise}`); }
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

  private static compact(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  private static decode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  /**
   * Resolves the author exposed by a provider to a known creator profile. If the
   * profile is new, create it so individual URL research never becomes orphaned.
   */
  ensureCreatorFromMetadata(
    platform: string,
    metadata: { authorHandle?: string; channelName?: string; authorUrl?: string },
  ): number | null {
    const handle = metadata.authorHandle?.trim().replace(/^@/, "");
    if (!handle) return null;
    const normalizedPlatform = platform.trim().toLowerCase();
    const compactHandle = ProfileRepository.compact(handle);
    const known = this.db
      .select({
        creatorId: creatorProfiles.creatorId,
        handle: creatorProfiles.handle,
        platform: creatorProfiles.platform,
      })
      .from(creatorProfiles)
      .all()
      .find(
        (profile) =>
          profile.creatorId > 0 &&
          ProfileRepository.compact(ProfileRepository.decode(profile.handle)) === compactHandle &&
          profile.platform.trim().toLowerCase() === normalizedPlatform,
      );
    if (known) return known.creatorId;
    return this.upsertCreator({
      platform: normalizedPlatform,
      handle,
      name: metadata.channelName?.trim() || handle,
      url: metadata.authorUrl,
    });
  }

  upsertCreator(data: {
    platform: string;
    handle: string;
    name: string;
    url?: string;
    metrics?: unknown;
  }): number {
    const handle = ProfileRepository.decode(data.handle.trim().replace(/^@/, ""));
    const name = ProfileRepository.decode(data.name.trim());
    const identityKey = ProfileRepository.compact(name);
    const now = new Date().toISOString();
    const existing = this.db.select({ id: creators.id }).from(creators).where(eq(creators.identityKey, identityKey)).get();
    const inserted = existing
      ? (this.db.update(creators).set({ name, handle, url: data.url, metrics: data.metrics, updatedAt: now }).where(eq(creators.id, existing.id)).returning({ id: creators.id }).get())
      : this.db.insert(creators).values({ platform: data.platform, handle, name, identityKey, url: data.url, metrics: data.metrics }).onConflictDoUpdate({ target: [creators.platform, creators.handle], set: { name, identityKey, url: data.url, metrics: data.metrics, updatedAt: now } }).returning({ id: creators.id }).get();
    this.db
      .insert(creatorProfiles)
      .values({
        creatorId: inserted.id,
        platform: data.platform,
        handle,
        url: data.url ?? `https://${data.platform}.com/${handle}`,
        metadata: data.metrics,
        lastSyncedAt: now,
      })
      .onConflictDoUpdate({
        target: [creatorProfiles.platform, creatorProfiles.handle],
        set: { creatorId: inserted.id, handle, url: data.url ?? `https://${data.platform}.com/${handle}`, metadata: data.metrics, lastSyncedAt: now, updatedAt: now },
      })
      .run();
    return inserted.id;
  }

  consolidateCreators(): void {
    const all = this.db.select({ id: creators.id, name: creators.name }).from(creators).all();
    const primaryByIdentity = new Map<string, number>();
    const canonicalUrl = (value: string) => value.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
    const mergeInto = (primary: number, duplicate: number) => {
      this.db.update(contentItems).set({ creatorId: primary }).where(eq(contentItems.creatorId, duplicate)).run();
      const primaryProfiles = this.db.select({ id: creatorProfiles.id, platform: creatorProfiles.platform, handle: creatorProfiles.handle }).from(creatorProfiles).where(eq(creatorProfiles.creatorId, primary)).all();
      const duplicateProfiles = this.db.select({ id: creatorProfiles.id, platform: creatorProfiles.platform, handle: creatorProfiles.handle }).from(creatorProfiles).where(eq(creatorProfiles.creatorId, duplicate)).all();
      for (const profile of duplicateProfiles) {
        const duplicateProfile = primaryProfiles.some((known) => known.platform === profile.platform && ProfileRepository.compact(ProfileRepository.decode(known.handle)) === ProfileRepository.compact(ProfileRepository.decode(profile.handle)));
        if (duplicateProfile) this.db.delete(creatorProfiles).where(eq(creatorProfiles.id, profile.id)).run();
        else this.db.update(creatorProfiles).set({ creatorId: primary, handle: ProfileRepository.decode(profile.handle) }).where(eq(creatorProfiles.id, profile.id)).run();
      }
      this.db.delete(creators).where(eq(creators.id, duplicate)).run();
    };
    for (const creator of all) {
      const name = ProfileRepository.decode(creator.name);
      const profiles = this.db.select({ url: creatorProfiles.url }).from(creatorProfiles).where(eq(creatorProfiles.creatorId, creator.id)).all();
      const keys = [ProfileRepository.compact(name), ...profiles.map((profile) => `url:${canonicalUrl(profile.url)}`)];
      const primary = keys.map((key) => primaryByIdentity.get(key)).find((id): id is number => id !== undefined);
      if (primary === undefined) {
        keys.forEach((key) => primaryByIdentity.set(key, creator.id));
        this.db.update(creators).set({ name, identityKey: ProfileRepository.compact(name) }).where(eq(creators.id, creator.id)).run();
        continue;
      }
      if (primary !== creator.id) mergeInto(primary, creator.id);
    }
  }

  backfillContentCreators(): void {
    const profiles = this.db
      .select({
        creatorId: creatorProfiles.creatorId,
        handle: creatorProfiles.handle,
        platform: creatorProfiles.platform,
        creatorName: creators.name,
      })
      .from(creatorProfiles)
      .innerJoin(creators, eq(creators.id, creatorProfiles.creatorId))
      .all();
    const content = this.db
      .select({
        id: contentItems.id,
        title: contentItems.title,
        description: contentItems.description,
        url: contentItems.url,
        provider: contentItems.provider,
        rawMetadata: contentItems.rawMetadata,
        creatorId: contentItems.creatorId,
      })
      .from(contentItems)
      .all();
    for (const item of content) {
      if (item.creatorId !== null) continue;
      const raw = item.rawMetadata && typeof item.rawMetadata === "object"
        ? (item.rawMetadata as Record<string, unknown>)
        : {};
      const normalized = raw._creatorResearchMetadata && typeof raw._creatorResearchMetadata === "object"
        ? (raw._creatorResearchMetadata as Record<string, unknown>)
        : raw;
      const authorHandle = typeof normalized.authorHandle === "string" ? normalized.authorHandle.replace(/^@/, "") : "";
      const authorName = [normalized.channel, normalized.uploader, normalized.channelName]
        .find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? "";
      const haystack = `${item.url ?? ""} ${item.title ?? ""} ${item.description ?? ""}`.toLowerCase();
      const match = profiles.find(
        (profile) =>
          profile.platform.toLowerCase() === item.provider.toLowerCase() &&
          ((authorHandle && ProfileRepository.compact(profile.handle) === ProfileRepository.compact(authorHandle)) ||
            (authorName && ProfileRepository.compact(profile.creatorName) === ProfileRepository.compact(authorName)) ||
            haystack.includes(profile.handle.toLowerCase())),
      );
      if (match) this.db.update(contentItems).set({ creatorId: match.creatorId }).where(eq(contentItems.id, item.id)).run();
    }
  }

  listCreators(includeArchived = false) {
    const rows = this.db
      .select({
        id: creators.id,
        name: creators.name,
        status: creators.status,
        createdAt: creators.createdAt,
        updatedAt: creators.updatedAt,
        profileId: creatorProfiles.id,
        platform: creatorProfiles.platform,
        handle: creatorProfiles.handle,
        url: creatorProfiles.url,
        profileStatus: creatorProfiles.status,
        followers: creatorProfiles.followers,
        lastSyncedAt: creatorProfiles.lastSyncedAt,
      })
      .from(creators)
      .leftJoin(creatorProfiles, eq(creatorProfiles.creatorId, creators.id))
      .orderBy(creators.name, creatorProfiles.platform)
      .all();
    const grouped = new Map<number, { id: number; name: string; status: string; createdAt: string; updatedAt: string; profiles: unknown[] }>();
    for (const row of rows) {
      if (!includeArchived && row.status === "archived") continue;
      const creator = grouped.get(row.id) ?? { id: row.id, name: row.name, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, profiles: [] };
      if (row.profileId) creator.profiles.push({ id: row.profileId, platform: row.platform, handle: row.handle, url: row.url, status: row.profileStatus, followers: row.followers, lastSyncedAt: row.lastSyncedAt });
      grouped.set(row.id, creator);
    }
    return [...grouped.values()];
  }

  archiveCreator(creatorId: number): void {
    const now = new Date().toISOString();
    this.db.update(creators).set({ status: "archived", archivedAt: now, updatedAt: now }).where(eq(creators.id, creatorId)).run();
    this.db.update(creatorProfiles).set({ status: "archived", updatedAt: now }).where(eq(creatorProfiles.creatorId, creatorId)).run();
  }

  purgeCreator(creatorId: number): void {
    const contentIds = this.db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.creatorId, creatorId)).all().map((row) => row.id);
    const ideaRows = this.db.select({ id: contentIdeas.id, sourceContentIds: contentIdeas.sourceContentIds }).from(contentIdeas).all();
    for (const idea of ideaRows) {
      const sourceIds = Array.isArray(idea.sourceContentIds) ? idea.sourceContentIds.map(Number) : [];
      if (sourceIds.some((id) => contentIds.includes(id))) this.db.delete(contentIdeas).where(eq(contentIdeas.id, idea.id)).run();
    }
    for (const contentId of contentIds) {
      const analysisIds = this.db.select({ id: analyses.id }).from(analyses).where(eq(analyses.contentItemId, contentId)).all().map((row) => row.id);
      if (analysisIds.length) this.db.delete(facets).where(inArray(facets.analysisId, analysisIds)).run();
      this.db.delete(analyses).where(eq(analyses.contentItemId, contentId)).run();
      this.db.delete(metricSnapshots).where(eq(metricSnapshots.contentItemId, contentId)).run();
      this.db.delete(comments).where(eq(comments.contentItemId, contentId)).run();
      this.db.delete(transcripts).where(eq(transcripts.contentItemId, contentId)).run();
      this.db.delete(contentItems).where(eq(contentItems.id, contentId)).run();
    }
    this.db.delete(creatorProfiles).where(eq(creatorProfiles.creatorId, creatorId)).run();
    this.db.delete(creators).where(eq(creators.id, creatorId)).run();
  }

  listContent(creatorId: number | null = null, filters: { search?: string; platform?: string; sourceType?: string } = {}) {
    const rows = this.db
      .select({
        id: contentItems.id,
        creatorId: contentItems.creatorId,
        url: contentItems.url,
        canonicalUrl: contentItems.canonicalUrl,
        sourceType: contentItems.sourceType,
        provider: contentItems.provider,
        title: contentItems.title,
        description: contentItems.description,
        publishedAt: contentItems.publishedAt,
        createdAt: contentItems.createdAt,
        creatorName: creators.name,
        creatorStatus: creators.status,
        rawMetadata: contentItems.rawMetadata,
      })
      .from(contentItems)
      .leftJoin(creators, eq(creators.id, contentItems.creatorId))
      .orderBy(desc(contentItems.createdAt))
      .limit(500)
      .all();
    const profiles = this.db
      .select({ creatorId: creatorProfiles.creatorId, platform: creatorProfiles.platform, handle: creatorProfiles.handle, status: creatorProfiles.status })
      .from(creatorProfiles)
      .where(eq(creatorProfiles.status, "active"))
      .all();
    const mapped = rows.map((row) => {
      const raw = row.rawMetadata && typeof row.rawMetadata === "object" ? (row.rawMetadata as Record<string, unknown>) : {};
      const normalized = raw._creatorResearchMetadata && typeof raw._creatorResearchMetadata === "object" ? (raw._creatorResearchMetadata as Record<string, unknown>) : raw;
      const authorHandle = typeof normalized.authorHandle === "string" ? normalized.authorHandle.replace(/^@/, "") : "";
      const candidates = profiles.filter((profile) => profile.creatorId === row.creatorId && profile.platform.toLowerCase() === row.provider.toLowerCase());
      const profile = candidates.find((candidate) => ProfileRepository.compact(ProfileRepository.decode(candidate.handle)) === ProfileRepository.compact(authorHandle)) ?? candidates[0];
      const { rawMetadata: _rawMetadata, ...publicRow } = row;
      return { ...publicRow, contentLayers: raw._contentLayers ?? null, profileHandle: profile?.handle ?? null, profilePlatform: profile?.platform ?? null };
    });
    return mapped.filter((row) => {
      if (creatorId !== null && row.creatorId !== creatorId) return false;
      if (row.creatorStatus === "archived") return false;
      if (filters.platform && (row.profilePlatform ?? row.provider).toLowerCase() !== filters.platform.toLowerCase()) return false;
      if (filters.sourceType && row.sourceType.toLowerCase() !== filters.sourceType.toLowerCase()) return false;
      if (filters.search) {
        const haystack = [row.creatorName, row.profileHandle, row.title, row.description, row.url, row.provider, row.sourceType]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(filters.search.toLowerCase())) return false;
      }
      return true;
    });
  }
}
