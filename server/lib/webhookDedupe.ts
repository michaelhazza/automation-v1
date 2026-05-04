/**
 * In-memory webhook event deduplication store.
 *
 * Prevents duplicate processing when providers retry webhook delivery.
 * Uses a TTL-based Map to auto-expire old entries.
 *
 * For production at scale, replace with Redis SET + TTL or a DB table.
 * This in-memory implementation works for single-instance deployments.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // Cleanup every 60 seconds
const MAX_ENTRIES = 10_000; // Cap to prevent unbounded memory growth

interface DedupeEntry {
  expiresAt: number;
}

export class WebhookDedupeStore {
  private entries = new Map<string, DedupeEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private ttlMs: number = DEFAULT_TTL_MS) {
    // Periodic cleanup of expired entries
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Allow the process to exit without waiting for cleanup
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /**
   * Check if an event has already been processed and mark it as processed.
   * Returns true if this is a duplicate (already seen), false if new.
   */
  isDuplicate(eventId: string): boolean {
    const now = Date.now();
    const existing = this.entries.get(eventId);

    if (existing && existing.expiresAt > now) {
      return true; // Already processed and not expired
    }

    // Mark as processed
    this.entries.set(eventId, { expiresAt: now + this.ttlMs });

    // Evict oldest entries if over capacity
    if (this.entries.size > MAX_ENTRIES) {
      const iterator = this.entries.keys();
      const oldest = iterator.next().value;
      if (oldest) this.entries.delete(oldest);
    }

    return false;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}

/** Singleton dedupe store for all webhook routes */
export const webhookDedupeStore = new WebhookDedupeStore();
