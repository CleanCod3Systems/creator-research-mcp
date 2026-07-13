import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resolves a config file by searching CONFIG_DIR, cwd/config and ../../config
 * (allows running from the monorepo root or from apps/*).
 */
export function resolveConfigPath(fileName: string): string {
  const bases = [
    process.env.CONFIG_DIR,
    resolve(process.cwd(), "config"),
    resolve(process.cwd(), "../../config"),
  ].filter((b): b is string => Boolean(b));
  for (const base of bases) {
    const candidate = resolve(base, fileName);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not find ${fileName} (searched in: ${bases.join(", ")})`);
}

/** Variant that returns null instead of throwing (for use with embedded defaults). */
export function resolveConfigPathOrNull(fileName: string): string | null {
  try {
    return resolveConfigPath(fileName);
  } catch {
    return null;
  }
}

/** Expands ~ to the user's home directory. */
export function expandHome(p: string): string {
  return p.startsWith("~/") || p === "~"
    ? p.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? ".")
    : p;
}
