import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import type { DbClient } from "./client.js";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export function runMigrations(db: DbClient): void {
  migrate(db, { migrationsFolder });
}
