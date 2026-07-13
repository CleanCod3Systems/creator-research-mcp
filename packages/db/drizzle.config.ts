import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env["DATABASE_PATH"] ?? "./data/creator-research.db" },
});
