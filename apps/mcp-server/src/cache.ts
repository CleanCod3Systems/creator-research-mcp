/** Returns the age of a cached value in whole seconds, or null for an invalid timestamp. */
export function cacheAgeSeconds(
  fetchedAt: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!fetchedAt) return null;
  const timestamp = Date.parse(fetchedAt);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.floor((now - timestamp) / 1000));
}
