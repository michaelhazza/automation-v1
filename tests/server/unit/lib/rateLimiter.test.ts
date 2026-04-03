import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../../../../server/lib/rateLimiter.js';

describe('RateLimiter', () => {
  it('allows acquisition when bucket has tokens', async () => {
    const limiter = new RateLimiter({ maxTokens: 5, refillRate: 5, refillIntervalMs: 1000 });
    await limiter.acquire('key-1');
    expect(limiter.remaining('key-1')).toBe(4);
  });

  it('creates separate buckets per key', async () => {
    const limiter = new RateLimiter({ maxTokens: 2, refillRate: 2, refillIntervalMs: 1000 });
    await limiter.acquire('a');
    expect(limiter.remaining('a')).toBe(1);
    expect(limiter.remaining('b')).toBe(2);
  });

  it('decrements tokens on each acquire', async () => {
    const limiter = new RateLimiter({ maxTokens: 3, refillRate: 3, refillIntervalMs: 10000 });
    await limiter.acquire('k');
    await limiter.acquire('k');
    expect(limiter.remaining('k')).toBe(1);
  });

  it('canAcquire returns false when bucket is empty', async () => {
    const limiter = new RateLimiter({ maxTokens: 1, refillRate: 1, refillIntervalMs: 10000 });
    await limiter.acquire('k');
    expect(limiter.canAcquire('k')).toBe(false);
  });

  it('canAcquire returns true when tokens available', () => {
    const limiter = new RateLimiter({ maxTokens: 5, refillRate: 5, refillIntervalMs: 1000 });
    expect(limiter.canAcquire('fresh-key')).toBe(true);
  });

  it('refills tokens after interval', async () => {
    const limiter = new RateLimiter({ maxTokens: 1, refillRate: 1, refillIntervalMs: 50 });
    await limiter.acquire('k');
    expect(limiter.canAcquire('k')).toBe(false);
    await new Promise(r => setTimeout(r, 60));
    expect(limiter.canAcquire('k')).toBe(true);
  });

  it('does not exceed maxTokens on refill', async () => {
    const limiter = new RateLimiter({ maxTokens: 3, refillRate: 10, refillIntervalMs: 50 });
    await new Promise(r => setTimeout(r, 120));
    expect(limiter.remaining('k')).toBe(3);
  });

  it('fires threshold callback when tokens drop below 20%', async () => {
    const onThreshold = vi.fn();
    const limiter = new RateLimiter({ maxTokens: 5, refillRate: 5, refillIntervalMs: 10000, onThreshold });
    // Drain to below 20% (= 1 token)
    for (let i = 0; i < 5; i++) await limiter.acquire('k');
    expect(onThreshold).toHaveBeenCalled();
    expect(onThreshold).toHaveBeenCalledWith('k', expect.any(Number));
  });

  it('does not fire threshold when above 20%', async () => {
    const onThreshold = vi.fn();
    const limiter = new RateLimiter({ maxTokens: 10, refillRate: 10, refillIntervalMs: 10000, onThreshold });
    await limiter.acquire('k'); // 9 remaining = 90%
    expect(onThreshold).not.toHaveBeenCalled();
  });

  it('remaining returns correct count for new key', () => {
    const limiter = new RateLimiter({ maxTokens: 7, refillRate: 7, refillIntervalMs: 1000 });
    expect(limiter.remaining('new-key')).toBe(7);
  });
});
