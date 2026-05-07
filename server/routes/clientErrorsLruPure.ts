/**
 * Pure LRU dedupe helper for the client-errors ingestion route.
 * No runtime dependencies — importable in tests without DB/env setup.
 */

export function decideDedupe({
  hash,
  lru,
  now,
  windowMs,
}: {
  hash: string;
  lru: Map<string, number>;
  now: number;
  windowMs: number;
}): 'duplicate' | 'fresh' {
  const lastSeen = lru.get(hash);
  if (lastSeen !== undefined && now - lastSeen <= windowMs) {
    return 'duplicate';
  }
  return 'fresh';
}
