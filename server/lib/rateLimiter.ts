/**
 * Token-bucket rate limiter for external API calls.
 * In-memory for MVP (not shared across server instances).
 *
 * Usage:
 *   const limiter = new RateLimiter({ maxTokens: 100, refillRate: 10, refillIntervalMs: 1000 });
 *   await limiter.acquire('account-123'); // waits if bucket is empty
 */

interface BucketState {
  tokens: number;
  lastRefill: number;
}

interface RateLimiterConfig {
  /** Maximum tokens in the bucket */
  maxTokens: number;
  /** Tokens added per refill interval */
  refillRate: number;
  /** Milliseconds between refills */
  refillIntervalMs: number;
  /** Optional callback when approaching limit (< 20% tokens remaining) */
  onThreshold?: (key: string, remaining: number) => void;
}

export class RateLimiter {
  private buckets = new Map<string, BucketState>();
  private config: RateLimiterConfig;

  constructor(config: RateLimiterConfig) {
    this.config = config;
  }

  /**
   * Acquire a token from the bucket for the given key.
   * Waits if no tokens are available. Returns when token is consumed.
   */
  async acquire(key: string): Promise<void> {
    const bucket = this.getOrCreateBucket(key);
    this.refill(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;

      // Threshold warning
      if (this.config.onThreshold && bucket.tokens < this.config.maxTokens * 0.2) {
        this.config.onThreshold(key, bucket.tokens);
      }
      return;
    }

    // Wait for next refill
    const waitMs = this.config.refillIntervalMs - (Date.now() - bucket.lastRefill);
    await new Promise(resolve => setTimeout(resolve, Math.max(waitMs, 100)));
    return this.acquire(key); // Retry after wait
  }

  /**
   * Check if a token is available without consuming it.
   */
  canAcquire(key: string): boolean {
    const bucket = this.getOrCreateBucket(key);
    this.refill(bucket);
    return bucket.tokens >= 1;
  }

  /**
   * Get remaining tokens for a key.
   */
  remaining(key: string): number {
    const bucket = this.getOrCreateBucket(key);
    this.refill(bucket);
    return Math.floor(bucket.tokens);
  }

  private getOrCreateBucket(key: string): BucketState {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.config.maxTokens, lastRefill: Date.now() };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private refill(bucket: BucketState): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const intervals = Math.floor(elapsed / this.config.refillIntervalMs);
    if (intervals > 0) {
      bucket.tokens = Math.min(this.config.maxTokens, bucket.tokens + intervals * this.config.refillRate);
      bucket.lastRefill = now;
    }
  }
}

// ---------------------------------------------------------------------------
// Provider rate limit configs — add new providers here
// ---------------------------------------------------------------------------

const PROVIDER_RATE_LIMITS: Record<string, RateLimiterConfig> = {
  ghl: {
    maxTokens: 100,
    refillRate: 100,
    refillIntervalMs: 10_000, // 100 requests per 10 seconds per location
    onThreshold: (key, remaining) => {
      console.warn(`[GHL RateLimiter] Approaching rate limit for ${key}: ${remaining} tokens remaining`);
    },
  },
  teamwork: {
    maxTokens: 150,
    refillRate: 150,
    refillIntervalMs: 60_000, // Teamwork Desk: 150 requests per minute
    onThreshold: (key, remaining) => {
      console.warn(`[Teamwork RateLimiter] Approaching rate limit for ${key}: ${remaining} tokens remaining`);
    },
  },
  slack: {
    maxTokens: 50,
    refillRate: 50,
    refillIntervalMs: 60_000, // Slack Web API: ~50 requests per minute (tier 2)
    onThreshold: (key, remaining) => {
      console.warn(`[Slack RateLimiter] Approaching rate limit for ${key}: ${remaining} tokens remaining`);
    },
  },
};

// Cache of instantiated limiters per provider
const providerLimiters = new Map<string, RateLimiter>();

/**
 * Get or create a rate limiter for the given provider.
 * Falls back to a conservative default for unknown providers.
 */
export function getProviderRateLimiter(provider: string): RateLimiter {
  let limiter = providerLimiters.get(provider);
  if (limiter) return limiter;

  const config = PROVIDER_RATE_LIMITS[provider] ?? {
    maxTokens: 60,
    refillRate: 60,
    refillIntervalMs: 60_000,
    onThreshold: (key: string, remaining: number) => {
      console.warn(`[${provider} RateLimiter] Approaching rate limit for ${key}: ${remaining} tokens remaining`);
    },
  };

  limiter = new RateLimiter(config);
  providerLimiters.set(provider, limiter);
  return limiter;
}

/** @deprecated Use getProviderRateLimiter('ghl') instead */
export const ghlRateLimiter = getProviderRateLimiter('ghl');
