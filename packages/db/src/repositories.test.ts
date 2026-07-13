import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import {
  AnalysisRepository,
  HeartbeatRepository,
  MetricsRepository,
  ProfileRepository,
  SqliteJobQueue,
} from "./repositories.js";
import { analyses, contentItems, jobs } from "./schema.js";

function makeDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  return db;
}

describe("SqliteJobQueue.recoverStale", () => {
  it("staleMs=0 (boot): recupera TODOS los running, sin importar qué tan reciente es", async () => {
    const db = makeDb();
    const queue = new SqliteJobQueue(db);
    const id = await queue.enqueue("analyze", { x: 1 });
    await queue.claimNext(["analyze"]); // pasa a running

    const recovered = queue.recoverStale();
    expect(recovered).toBe(1);
    expect((await queue.get(id))?.status).toBe("queued");
  });

  it("staleMs>0 (loop, worker vivo): NO toca un job que se actualizó hace instantes", async () => {
    const db = makeDb();
    const queue = new SqliteJobQueue(db);
    await queue.enqueue("analyze", { x: 1 });
    await queue.claimNext(["analyze"]);

    const recovered = queue.recoverStale(15 * 60_000); // 15 min: el job tiene segundos de antigüedad
    expect(recovered).toBe(0);
  });

  it("staleMs>0: SÍ recupera un job running cuyo updatedAt quedó viejo (colgado)", async () => {
    const db = makeDb();
    const queue = new SqliteJobQueue(db);
    const id = await queue.enqueue("analyze", { x: 1 });
    await queue.claimNext(["analyze"]);
    const oldTs = new Date(Date.now() - 30 * 60_000).toISOString();
    db.update(jobs).set({ updatedAt: oldTs }).where(eq(jobs.id, id)).run();

    const recovered = queue.recoverStale(15 * 60_000);
    expect(recovered).toBe(1);
    expect((await queue.get(id))?.status).toBe("queued");
  });
});

describe("AnalysisRepository.failStaleRunning", () => {
  it("marca failed un análisis 'running' huérfano en vez de dejarlo colgado para siempre", () => {
    const db = makeDb();
    const repo = new AnalysisRepository(db);
    const contentItemId = db
      .insert(contentItems)
      .values({ sourceType: "video", provider: "fake", contentHash: "h1", title: "t" })
      .returning({ id: contentItems.id })
      .get().id;
    const analysisId = repo.create(contentItemId, "1", "quick");
    db.update(analyses)
      .set({ createdAt: new Date(Date.now() - 30 * 60_000).toISOString() })
      .where(eq(analyses.id, analysisId))
      .run();

    const failed = repo.failStaleRunning(15 * 60_000, "huérfano");
    expect(failed).toBe(1);
    expect(repo.getById(analysisId)?.status).toBe("failed");
  });
});

describe("HeartbeatRepository", () => {
  it("touch + get reflejan el último worker vivo", () => {
    const db = makeDb();
    const hb = new HeartbeatRepository(db);
    expect(hb.get()).toBeNull();
    hb.touch(1234, "job-abc");
    const row = hb.get();
    expect(row?.pid).toBe(1234);
    expect(row?.currentJobId).toBe("job-abc");
    hb.touch(1234, null);
    expect(hb.get()?.currentJobId).toBeNull();
  });
});

describe("MetricsRepository", () => {
  function makeContentItem(db: ReturnType<typeof makeDb>) {
    return db
      .insert(contentItems)
      .values({ sourceType: "video", provider: "youtube", contentHash: "h1", title: "t" })
      .returning({ id: contentItems.id })
      .get().id;
  }

  it("recordSnapshot + getSnapshots: guarda y devuelve en orden cronológico", () => {
    const db = makeDb();
    const repo = new MetricsRepository(db);
    const contentItemId = makeContentItem(db);
    repo.recordSnapshot(
      contentItemId,
      { viewCount: 100, likeCount: 10, commentCount: 1 },
      "yt-dlp",
    );
    const snapshots = repo.getSnapshots(contentItemId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      viewCount: 100,
      likeCount: 10,
      commentCount: 1,
      source: "yt-dlp",
    });
  });

  it("no duplica un snapshot idéntico dentro de los 5 minutos", () => {
    const db = makeDb();
    const repo = new MetricsRepository(db);
    const contentItemId = makeContentItem(db);
    repo.recordSnapshot(
      contentItemId,
      { viewCount: 100, likeCount: 10, commentCount: 1 },
      "yt-dlp",
    );
    repo.recordSnapshot(
      contentItemId,
      { viewCount: 100, likeCount: 10, commentCount: 1 },
      "yt-dlp",
    );
    expect(repo.getSnapshots(contentItemId)).toHaveLength(1);
  });

  it("SÍ guarda un nuevo snapshot si los valores cambiaron, aunque sea al instante", () => {
    const db = makeDb();
    const repo = new MetricsRepository(db);
    const contentItemId = makeContentItem(db);
    repo.recordSnapshot(
      contentItemId,
      { viewCount: 100, likeCount: 10, commentCount: 1 },
      "yt-dlp",
    );
    repo.recordSnapshot(
      contentItemId,
      { viewCount: 150, likeCount: 12, commentCount: 2 },
      "yt-dlp",
    );
    expect(repo.getSnapshots(contentItemId)).toHaveLength(2);
  });

  it("import manual con fecha propia (observedAt): NUNCA se pisa por el dedup de 'ahora'", () => {
    const db = makeDb();
    const repo = new MetricsRepository(db);
    const contentItemId = makeContentItem(db);
    // dos snapshots manuales idénticos en valores pero de fechas históricas distintas: ambos se guardan
    repo.recordSnapshot(
      contentItemId,
      { viewCount: 100, likeCount: 10, commentCount: 1 },
      "manual",
      "2026-01-01T00:00:00Z",
    );
    repo.recordSnapshot(
      contentItemId,
      { viewCount: 100, likeCount: 10, commentCount: 1 },
      "manual",
      "2026-02-01T00:00:00Z",
    );
    const snapshots = repo.getSnapshots(contentItemId);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.observedAt).toBe("2026-01-01T00:00:00Z");
    expect(snapshots[1]?.observedAt).toBe("2026-02-01T00:00:00Z");
  });
});

describe("ProfileRepository", () => {
  it("upsertCreator: mismo platform+handle → actualiza en vez de duplicar", () => {
    const db = makeDb();
    const repo = new ProfileRepository(db);
    const id1 = repo.upsertCreator({
      platform: "instagram",
      handle: "juliacardoso.dev",
      name: "Julia",
    });
    const id2 = repo.upsertCreator({
      platform: "instagram",
      handle: "juliacardoso.dev",
      name: "Julia Cardoso",
      metrics: { followers: 50000 },
    });
    expect(id1).toBe(id2);
  });
});
