import { Router, type Response } from "express";
import { getContext, getIntelligenceRepo, getMetricsRepo, getProfileRepo } from "./context.js";
import type { ContentIdeaInput } from "@cleancod3/db";

const jsonError = (res: Response, status: number, message: string) =>
  res.status(status).json({ error: message });

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function buildDashboardRouter(): Router {
  const router = Router();

  router.post("/creators", (req, res) => {
    const { platform, profileUrl, handle, name } = req.body ?? {};
    if (typeof platform !== "string" || typeof profileUrl !== "string" || typeof handle !== "string") {
      return jsonError(res, 400, "platform, profileUrl y handle son obligatorios");
    }
    const creatorId = getProfileRepo().upsertCreator({ platform, url: profileUrl, handle, name: typeof name === "string" ? name : handle });
    res.status(201).json({ ok: true, creatorId });
  });

  router.get("/creators", (req, res) => {
    const includeArchived = req.query.includeArchived === "true";
    const rows = getProfileRepo().listCreators(includeArchived) as Array<Record<string, unknown>>;
    const counts = getProfileRepo().listContent().reduce<Record<string, number>>((result, row) => {
      if (row.creatorId !== null) result[String(row.creatorId)] = (result[String(row.creatorId)] ?? 0) + 1;
      return result;
    }, {});
    res.json({ creators: rows.map((row) => ({ ...row, contentCount: counts[String(row.id)] ?? 0 })) });
  });

  router.get("/content", (req, res) => {
    const creatorId = req.query.creatorId ? parseId(String(req.query.creatorId)) : null;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const platform = typeof req.query.platform === "string" ? req.query.platform : undefined;
    const sourceType = typeof req.query.sourceType === "string" ? req.query.sourceType : undefined;
    res.json({ content: getProfileRepo().listContent(creatorId, { search, platform, sourceType }) });
  });

  router.post("/content/layers", (req, res) => {
    const { url, layers } = req.body ?? {};
    if (typeof url !== "string" || !layers || typeof layers !== "object") return jsonError(res, 400, "url y layers son obligatorios");
    const normalize = (value: string) => value.trim().replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
    const match = getProfileRepo().listContent().find((row) => typeof row.url === "string" && normalize(row.url) === normalize(url));
    if (!match) return jsonError(res, 404, "No existe contenido para esta URL");
    getContext().content.saveContentLayers(Number(match.id), layers as Record<string, unknown>);
    res.json({ ok: true, contentId: match.id });
  });

  router.get("/ideas", (req, res) => {
    const platform = typeof req.query.platform === "string" ? req.query.platform : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ ideas: getIntelligenceRepo().listIdeas({ platform, status }) });
  });

  router.get("/feedback", (_req, res) => {
    const ideas = getIntelligenceRepo().listIdeas();
    const contentLibrary = getProfileRepo().listContent().slice(0, 100).map((item) => ({
      id: item.id,
      creator: item.creatorName,
      platform: item.profilePlatform ?? item.provider,
      format: item.sourceType,
      title: item.title,
      description: item.description,
      url: item.canonicalUrl ?? item.url,
      contentLayers: item.contentLayers && typeof item.contentLayers === "object" ? {
        description: { text: typeof (item.contentLayers as { description?: { text?: unknown } }).description?.text === "string" ? (item.contentLayers as { description: { text: string } }).description.text.slice(0, 1200) : null },
        spoken: { status: (item.contentLayers as { spoken?: { status?: unknown } }).spoken?.status ?? null, text: typeof (item.contentLayers as { spoken?: { text?: unknown } }).spoken?.text === "string" ? (item.contentLayers as { spoken: { text: string } }).spoken.text.slice(0, 2400) : null },
      } : null,
    }));
    res.json({
      selected: ideas.filter((idea) => idea.status === "selected" || idea.status === "produced" || idea.status === "published" || idea.status === "validated"),
      discarded: ideas.filter((idea) => idea.status === "discarded"),
      contentLibrary,
    });
  });

  router.get("/learnings", (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ learnings: getIntelligenceRepo().listLearnings(status) });
  });

  router.get("/experiments", (_req, res) => {
    res.json({ experiments: getIntelligenceRepo().listExperiments() });
  });

  router.get("/research/runs", (_req, res) => {
    res.json({ runs: getIntelligenceRepo().listRuns() });
  });

  router.post("/research/ideas", (req, res) => {
    const body = req.body ?? {};
    const ideas = Array.isArray(body.ideas) ? body.ideas : [];
    const inputUrls = Array.isArray(body.inputUrls) ? body.inputUrls.map(String) : [];
    if (!ideas.length && body.status !== "partial") return jsonError(res, 400, "ideas es obligatorio o el estado debe ser partial");
    const batchKey = typeof body.batchKey === "string" && body.batchKey.trim() ? body.batchKey.trim() : `batch-${Date.now()}`;
    const repo = getIntelligenceRepo();
    const runId = repo.createRun({ batchKey, inputUrls, market: typeof body.market === "string" ? body.market : "Paraguay", language: typeof body.language === "string" ? body.language : "es", referenceScope: typeof body.referenceScope === "string" ? body.referenceScope : "global" });
    const normalized: ContentIdeaInput[] = ideas.filter((idea: unknown): idea is Record<string, unknown> => Boolean(idea && typeof idea === "object")).map((idea: Record<string, unknown>) => ({
      ...idea,
      platform: String(idea.platform ?? idea.red_social ?? "Instagram"),
      format: String(idea.format ?? idea.formato ?? "Reel"),
      titleOptions: Array.isArray(idea.titleOptions ?? idea.titulos) ? (idea.titleOptions ?? idea.titulos) : [String(idea.title ?? idea.titulo ?? "")].filter(Boolean),
      problem: String(idea.problem ?? idea.problema_audiencia ?? ""),
      whyNow: String(idea.whyNow ?? idea.por_que_ahora ?? ""),
      evidenceSummary: String(idea.evidenceSummary ?? idea.evidencia ?? ""),
      paraguayanAngle: String(idea.paraguayanAngle ?? idea.adaptacion_paraguay ?? ""),
      promise: String(idea.promise ?? idea.promesa ?? ""),
      spokenHook: String(idea.spokenHook ?? idea.gancho_hablado ?? idea.gancho ?? ""),
      visualHook: String(idea.visualHook ?? idea.gancho_visual ?? ""),
      scriptBeats: idea.scriptBeats ?? idea.guion_por_segundos ?? [],
      visualPlan: idea.visualPlan ?? idea.plan_visual ?? [],
      onScreenText: idea.onScreenText ?? idea.texto_en_pantalla ?? [],
      caption: String(idea.caption ?? idea.caption_instagram ?? ""),
      cta: String(idea.cta ?? idea.llamada_a_la_accion ?? ""),
      hashtags: idea.hashtags ?? [],
      durationSec: typeof idea.durationSec === "number" ? idea.durationSec : null,
      effort: idea.effort ?? idea.esfuerzo ?? null,
      confidence: typeof idea.confidence === "number" ? idea.confidence : 0,
      scores: idea.scores ?? idea.puntuaciones ?? {},
      validationMetric: String(idea.validationMetric ?? idea.metrica_a_validar ?? "Retención y comentarios útiles"),
      sourceCreatorNames: idea.sourceCreatorNames ?? idea.creadores_fuente ?? [],
      sourceUrls: idea.sourceUrls ?? idea.urls_fuente ?? [],
      sourceContentIds: Array.isArray(idea.sourceContentIds) ? idea.sourceContentIds.map(Number).filter(Number.isInteger) : [],
      evidence: Array.isArray(idea.evidence) ? idea.evidence : [],
    }));
    try {
      const ideaIds = repo.saveIdeas(runId, normalized);
      const learningItems = Array.isArray(body.learnings) ? body.learnings.filter((item: unknown): item is { title: string; statement: string } => Boolean(item && typeof item === "object" && typeof (item as { title?: unknown }).title === "string" && typeof (item as { statement?: unknown }).statement === "string")) : [];
      const learningIds = repo.saveLearnings(learningItems.map((item: { title: string; statement: string }) => ({ ...item, evidence: (item as unknown as Record<string, unknown>).evidence ?? [], sourceIdeaIds: (item as unknown as Record<string, unknown>).sourceIdeaIds ?? ideaIds })));
      repo.saveRunResult(runId, {
        summary: typeof body.summary === "string" ? body.summary : "",
        facts: Array.isArray(body.facts) ? body.facts : [],
        audienceSignals: Array.isArray(body.signals) ? body.signals : [],
        opportunities: Array.isArray(body.opportunities) ? body.opportunities : [],
        capturedAt: new Date().toISOString(),
      });
      repo.finishRun(runId, body.status === "partial" ? "partial" : "done");
      res.status(201).json({ ok: true, runId, ideaIds, learningIds, saved: ideaIds.length });
    } catch (error) {
      repo.finishRun(runId, "failed", error instanceof Error ? error.message : String(error));
      jsonError(res, 500, "No se pudo persistir la inteligencia generada");
    }
  });

  router.get("/memory/pack", (_req, res) => {
    res.json({ ok: true, market: "Paraguay", documents: getIntelligenceRepo().memoryPack() });
  });

  router.post("/ideas/:id/status", (req, res) => {
    const id = parseId(req.params.id);
    const status = req.body?.status;
    if (!id || !["idea", "selected", "produced", "published", "validated", "discarded"].includes(status)) return jsonError(res, 400, "Estado de idea inválido");
    getIntelligenceRepo().updateIdeaStatus(id, status);
    res.json({ ok: true, id, status });
  });

  router.post("/learnings/:id/status", (req, res) => {
    const id = parseId(req.params.id);
    const status = req.body?.status;
    if (!id || !["proposed", "validated", "rejected"].includes(status)) return jsonError(res, 400, "Estado de aprendizaje inválido");
    getIntelligenceRepo().updateLearningStatus(id, status);
    res.json({ ok: true, id, status });
  });

  router.post("/experiments", (req, res) => {
    const { ideaId, platform, format, targetMetric, publishedAt, notes } = req.body ?? {};
    if (!Number.isInteger(ideaId) || typeof platform !== "string" || typeof format !== "string" || typeof targetMetric !== "string") return jsonError(res, 400, "ideaId, platform, format y targetMetric son obligatorios");
    const id = getIntelligenceRepo().createExperiment({ ideaId, platform, format, targetMetric, publishedAt, notes });
    res.status(201).json({ ok: true, id });
  });

  router.post("/repair-content", async (_req, res) => {
    const { content, providers } = getContext();
    const orphans = getProfileRepo().listContent().filter((row) => row.creatorId === null && row.url);
    const repaired: Array<{ id: number; creatorId: number; url: string }> = [];
    const errors: Array<{ id: number; url: string; message: string }> = [];

    for (const orphan of orphans) {
      const url = orphan.url as string;
      const provider = providers.find((candidate) => candidate.matches(url));
      if (!provider) {
        errors.push({ id: orphan.id, url, message: "No hay proveedor para esta URL" });
        continue;
      }
      try {
        const meta = await provider.fetchMetadata(url);
        const creatorId = getProfileRepo().ensureCreatorFromMetadata(provider.name, meta);
        if (!creatorId) {
          errors.push({ id: orphan.id, url, message: "El proveedor no devolvió autor público" });
          continue;
        }
        content.updateContentItem(orphan.id, {
          creatorId,
          title: meta.title,
          description: meta.description,
          durationSec: meta.durationSec,
          publishedAt: meta.publishedAt,
          language: meta.language,
          rawMetadata: meta.raw,
        });
        repaired.push({ id: orphan.id, creatorId, url });
      } catch (error) {
        errors.push({ id: orphan.id, url, message: error instanceof Error ? error.message : String(error) });
      }
    }

    res.json({ ok: true, scanned: orphans.length, repaired, errors });
  });

  router.post("/maintenance", (_req, res) => {
    const profileRepo = getProfileRepo();
    profileRepo.consolidateCreators();
    profileRepo.backfillContentCreators();
    const creators = profileRepo.listCreators(false);
    const content = profileRepo.listContent();
    res.json({ ok: true, creators: creators.length, content: content.length, orphans: content.filter((item) => item.creatorId === null).length });
  });

  router.get("/metrics/:contentId", (req, res) => {
    const contentId = parseId(req.params.contentId);
    if (!contentId) return jsonError(res, 400, "contentId inválido");
    res.json({ snapshots: getMetricsRepo().getSnapshots(contentId) });
  });

  router.post("/creators/:id/archive", (req, res) => {
    const creatorId = parseId(req.params.id);
    if (!creatorId) return jsonError(res, 400, "creatorId inválido");
    getProfileRepo().archiveCreator(creatorId);
    res.json({ ok: true, status: "archived", creatorId });
  });

  router.delete("/creators/:id", (req, res) => {
    const creatorId = parseId(req.params.id);
    if (!creatorId) return jsonError(res, 400, "creatorId inválido");
    getProfileRepo().purgeCreator(creatorId);
    res.json({ ok: true, status: "purged", creatorId });
  });

  return router;
}
