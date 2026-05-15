import type { CacheEntry } from './types.js';

// ---------------------------------------------------------------------------
// In-memory caches
// ---------------------------------------------------------------------------

// Expiring hot cache — populated on fetch, expired per cacheMinutes
export const dataSourceCache = new Map<string, CacheEntry>();

// Last-good-content fallback — never expires, overwritten only on successful fetch
// Served silently when a live fetch fails so end users are unaffected
export const lastGoodContentCache = new Map<string, string>();

export function getCachedContent(sourceId: string): string | null {
  const entry = dataSourceCache.get(sourceId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    dataSourceCache.delete(sourceId);
    return null;
  }
  return entry.content;
}

export function setCachedContent(sourceId: string, content: string, cacheMinutes: number): void {
  dataSourceCache.set(sourceId, {
    content,
    fetchedAt: Date.now(),
    expiresAt: Date.now() + cacheMinutes * 60 * 1000,
  });
}
