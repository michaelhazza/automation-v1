/**
 * escalationPhrasesPure.test.ts — Pure unit test (no DB).
 */

import { describe, it, expect, vi } from 'vitest';
import { module, tokenise } from '../escalationPhrases.js';

// ── Tokeniser unit tests ──────────────────────────────────────────────────────

describe('tokenise()', () => {
  it('lowercases input', () => {
    expect(tokenise('HELLO WORLD')).toEqual(['hello', 'world']);
  });

  it('strips punctuation', () => {
    expect(tokenise('hello, world!')).toEqual(['hello', 'world']);
  });

  it('strips -ing suffix', () => {
    expect(tokenise('running')).toEqual(['runn']);
  });

  it('strips -ed suffix', () => {
    expect(tokenise('asked')).toEqual(['ask']);
  });

  it('strips -s suffix', () => {
    expect(tokenise('agents')).toEqual(['agent']);
  });

  it('applies suffix stripping in order (ing before ed before s)', () => {
    // "walked" → strip -ed → "walk"
    expect(tokenise('walked')).toEqual(['walk']);
    // "running" → strip -ing → "runn"
    expect(tokenise('running')).toEqual(['runn']);
  });

  it('filters out single-character tokens', () => {
    const result = tokenise('a b c hello');
    expect(result).not.toContain('a');
    expect(result).not.toContain('b');
    expect(result).not.toContain('c');
    expect(result).toContain('hello');
  });

  it('handles empty string', () => {
    expect(tokenise('')).toEqual([]);
  });
});

// ── Query module structural contracts ─────────────────────────────────────────

describe('escalationPhrases query module — structural contracts', () => {
  it('has the correct category', () => {
    expect(module.category).toBe('optimiser.escalation.repeat_phrase');
  });

  it('is readReplicaSafe', () => {
    expect(module.readReplicaSafe).toBe(true);
  });

  it('has the correct authoritativeTimestampColumn', () => {
    expect(module.authoritativeTimestampColumn).toBe('review_items.created_at');
  });
});

describe('escalationPhrases query module — run() with mocked tx', () => {
  it('sets statement_timeout before the main query', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    expect(fakeTx.execute).toHaveBeenCalledTimes(2);
    const firstCall = JSON.stringify(fakeTx.execute.mock.calls[0][0]);
    expect(firstCall).toMatch(/statement_timeout/i);
    expect(firstCall).toMatch(/10000/);
  });

  it('filters by subaccount_id', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/subaccount_id/i);
  });

  it('includes LIMIT 1000 on the raw row pull', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/LIMIT 1000/i);
  });

  it('filters by 7-day window on review_items.created_at', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/created_at/i);
    expect(mainQuery).toMatch(/7 days/i);
  });

  it('aggregates phrases in memory and filters out count < 2', async () => {
    const mockRows = [
      { id: 'ri-1', review_payload_json: 'billing issue occurred', created_at: '2025-01-01T00:00:00Z' },
      { id: 'ri-2', review_payload_json: 'billing issue again', created_at: '2025-01-01T00:00:00Z' },
      { id: 'ri-3', review_payload_json: 'unique problem only once', created_at: '2025-01-01T00:00:00Z' },
    ];

    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(mockRows),
    };

    const result = await module.run(fakeTx as any, 'sub-1');

    // "billing" appears twice (after tokenisation), so it should appear
    const billingEntry = result.find((r) => r.metricKey === 'bill');
    expect(billingEntry).toBeDefined();
    expect(billingEntry?.evidence.count).toBeGreaterThanOrEqual(2);

    // Phrases with count < 2 should not appear (unique = 1)
    const uniqueEntry = result.find((r) => r.metricKey === 'uniqu');
    expect(uniqueEntry).toBeUndefined();
  });

  it('emits evidence with sampleEscalationIds and median_version: 0', async () => {
    const mockRows = [
      { id: 'ri-1', review_payload_json: 'payment failed error', created_at: '2025-01-01T00:00:00Z' },
      { id: 'ri-2', review_payload_json: 'payment failed again', created_at: '2025-01-01T00:00:00Z' },
      { id: 'ri-3', review_payload_json: 'payment failed third time', created_at: '2025-01-01T00:00:00Z' },
    ];

    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(mockRows),
    };

    const result = await module.run(fakeTx as any, 'sub-1');

    const paymentEntry = result.find((r) => r.metricKey === 'payment');
    expect(paymentEntry).toBeDefined();
    expect(Array.isArray(paymentEntry?.evidence.sampleEscalationIds)).toBe(true);
    expect(paymentEntry?.evidence.median_version).toBe(0);
  });
});
