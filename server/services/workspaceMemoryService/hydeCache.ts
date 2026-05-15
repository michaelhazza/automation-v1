// ---------------------------------------------------------------------------
// HyDE cache — per-instance LRU with TTL (Phase B4)
// ---------------------------------------------------------------------------
const HYDE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const HYDE_CACHE_MAX_SIZE = 200;
const hydeCache = new Map<string, { value: string; expiresAt: number }>();

export function hydeCacheGet(key: string): string | undefined {
  const entry = hydeCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { hydeCache.delete(key); return undefined; }
  // LRU: move to end by re-inserting (Map preserves insertion order)
  hydeCache.delete(key);
  hydeCache.set(key, entry);
  return entry.value;
}

export function hydeCacheSet(key: string, value: string): void {
  if (hydeCache.size >= HYDE_CACHE_MAX_SIZE) {
    const firstKey = hydeCache.keys().next().value;
    if (firstKey) hydeCache.delete(firstKey);
  }
  hydeCache.set(key, { value, expiresAt: Date.now() + HYDE_CACHE_TTL_MS });
}
