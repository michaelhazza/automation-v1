const TTL_MS = (Number(process.env.SYSTEM_INCIDENT_IDEMPOTENCY_TTL_SECONDS) || 60) * 1000;
const MAX_ENTRIES = 10_000;

interface LRUEntry { addedAt: number; }
const lru = new Map<string, LRUEntry>();

let idempotentHitCount = 0;
let idempotentEvictionCount = 0;

/** Key format: `${fingerprint}:${idempotencyKey}`. Returns true if hit (caller skips DB write). */
export function checkAndRecord(key: string): boolean {
  const now = Date.now();
  const existing = lru.get(key);
  if (existing) {
    if (now - existing.addedAt < TTL_MS) {
      idempotentHitCount++;
      return true;
    }
    lru.delete(key);
  }
  if (lru.size >= MAX_ENTRIES) {
    const oldest = lru.keys().next().value;
    if (oldest !== undefined) {
      lru.delete(oldest);
      idempotentEvictionCount++;
    }
  }
  lru.set(key, { addedAt: now });
  return false;
}

export function getIdempotentHitCount(): number { return idempotentHitCount; }
export function getIdempotentEvictionCount(): number { return idempotentEvictionCount; }

export function __resetForTest(): void {
  if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'integration') return;
  lru.clear();
  idempotentHitCount = 0;
  idempotentEvictionCount = 0;
}
