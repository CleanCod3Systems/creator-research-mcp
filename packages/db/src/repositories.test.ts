import { describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { MetricsRepository, ProfileRepository } from "./repositories.js";
import { contentItems } from "./schema.js";

function makeDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  return db;
}

describe("MetricsRepository", () => {
  function makeContentItem(db: ReturnType<typeof makeDb>) {
    return db
      .insert(contentItems)
      .values({ sourceType: "video", provider: "youtube", contentHash: "h1", title: "t" })
      .returning({ id: contentItems.id })
      .get().id;
  }

  it("recordSnapshot + getSnapshots: stores and returns them in chronological order", () => {
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

  it("does not duplicate an identical snapshot within 5 minutes", () => {
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

  it("DOES save a new snapshot if the values changed, even instantly", () => {
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

  it("a manual import with its own date (observedAt) is NEVER overwritten by the 'now' dedup", () => {
    const db = makeDb();
    const repo = new MetricsRepository(db);
    const contentItemId = makeContentItem(db);
    // two manual snapshots with identical values but different historical dates: both are saved
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
  it("upsertCreator: same platform+handle updates instead of duplicating", () => {
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
