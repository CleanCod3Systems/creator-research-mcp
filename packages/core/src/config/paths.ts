import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resuelve un archivo de config buscando en CONFIG_DIR, cwd/config y ../../config
 * (permite correr desde la raíz del monorepo o desde apps/*).
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
  throw new Error(`No se encontró ${fileName} (buscado en: ${bases.join(", ")})`);
}

/** Variante que devuelve null en vez de tirar (para usar defaults embebidos). */
export function resolveConfigPathOrNull(fileName: string): string | null {
  try {
    return resolveConfigPath(fileName);
  } catch {
    return null;
  }
}

/** Expande ~ al home del usuario. */
export function expandHome(p: string): string {
  return p.startsWith("~/") || p === "~"
    ? p.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? ".")
    : p;
}
