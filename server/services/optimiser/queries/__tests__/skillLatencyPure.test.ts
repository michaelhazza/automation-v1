/**
 * skillLatencyPure.test.ts — Pure unit tests (no DB connection).
 *
 * Covers:
 *  1. peerMediansViewIsPopulated returns false when mock tx returns { populated: false }
 *  2. peerMediansViewIsPopulated returns true when mock tx returns { populated: true }
 *  3. SQL template for runSkillLatencyQuery contains the 7-day window assertion
 *  4. SQL template for runSkillLatencyQuery contains the median_version JOIN invariant
 *  5. runSkillLatencyQuery returns [] when DB returns no rows (version mismatch scenario)
 *  6. Module structural contracts (category, readReplicaSafe, etc.)
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/rlsBoundaryGuard.js', () => ({
  withAdminConnectionGuarded: vi.fn(),
}));

import { withAdminConnectionGuarded } from '../../../../lib/rlsBoundaryGuard.js';
import {
  peerMediansViewIsPopulated,
  runSkillLatencyQuery,
  skillLatencyModule,
} from '../skillLatency.js';

// ---------------------------------------------------------------------------
// peerMediansViewIsPopulated
// ---------------------------------------------------------------------------

describe('peerMediansViewIsPopulated', () => {
  it('returns false when the admin tx returns { populated: false }', async () => {
    const fakeTx = {
      execute: vi.fn().mockResolvedValue([{ populated: false }]),
    };
    vi.mocked(withAdminConnectionGuarded).mockImplementation(async (_opts, cb) => cb(fakeTx as any));

    const result = await peerMediansViewIsPopulated();
    expect(result).toBe(false);
    expect(fakeTx.execute).toHaveBeenCalledTimes(1);
  });

  it('returns true when the admin tx returns { populated: true }', async () => {
    const fakeTx = {
      execute: vi.fn().mockResolvedValue([{ populated: true }]),
    };
    vi.mocked(withAdminConnectionGuarded).mockImplementation(async (_opts, cb) => cb(fakeTx as any));

    const result = await peerMediansViewIsPopulated();
    expect(result).toBe(true);
  });

  it('returns false when the view query returns an empty array', async () => {
    const fakeTx = {
      execute: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(withAdminConnectionGuarded).mockImplementation(async (_opts, cb) => cb(fakeTx as any));

    const result = await peerMediansViewIsPopulated();
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runSkillLatencyQuery — SQL structure assertions
// ---------------------------------------------------------------------------

describe('runSkillLatencyQuery — SQL structure', () => {
  it('contains the 7-day event_timestamp window assertion', async () => {
    const capturedSql: string[] = [];
    const fakeTx = {
      execute: vi.fn().mockImplementation((query: any) => {
        capturedSql.push(JSON.stringify(query));
        return Promise.resolve([]);
      }),
    };

    await runSkillLatencyQuery(fakeTx as any, 'sub-abc', 1);

    // Second call is the main query (first is SET LOCAL statement_timeout)
    const mainQueryStr = capturedSql[1] ?? capturedSql[0] ?? '';
    expect(mainQueryStr).toMatch(/7 days/i);
  });

  it('contains the median_version JOIN invariant (invariant 32)', async () => {
    const capturedSql: string[] = [];
    const fakeTx = {
      execute: vi.fn().mockImplementation((query: any) => {
        capturedSql.push(JSON.stringify(query));
        return Promise.resolve([]);
      }),
    };

    await runSkillLatencyQuery(fakeTx as any, 'sub-abc', 42);

    const mainQueryStr = capturedSql[1] ?? capturedSql[0] ?? '';
    expect(mainQueryStr).toMatch(/median_version/i);
  });

  it('sets statement_timeout before the main query', async () => {
    const capturedSql: string[] = [];
    const fakeTx = {
      execute: vi.fn().mockImplementation((query: any) => {
        capturedSql.push(JSON.stringify(query));
        return Promise.resolve([]);
      }),
    };

    await runSkillLatencyQuery(fakeTx as any, 'sub-abc', 1);

    expect(fakeTx.execute).toHaveBeenCalledTimes(2);
    expect(capturedSql[0]).toMatch(/statement_timeout/i);
  });

  it('filters by subaccount_id', async () => {
    const capturedSql: string[] = [];
    const fakeTx = {
      execute: vi.fn().mockImplementation((query: any) => {
        capturedSql.push(JSON.stringify(query));
        return Promise.resolve([]);
      }),
    };

    await runSkillLatencyQuery(fakeTx as any, 'sub-xyz', 1);

    const mainQueryStr = capturedSql[1] ?? '';
    expect(mainQueryStr).toMatch(/subaccount_id/i);
  });
});

// ---------------------------------------------------------------------------
// runSkillLatencyQuery — empty / version-mismatch scenarios
// ---------------------------------------------------------------------------

describe('runSkillLatencyQuery — empty result scenarios', () => {
  it('returns [] when the DB returns no rows (version mismatch)', async () => {
    const fakeTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(undefined) // SET LOCAL statement_timeout
        .mockResolvedValueOnce([]), // main query → no rows (version mismatch)
    };

    const result = await runSkillLatencyQuery(fakeTx as any, 'sub-abc', 999);
    expect(result).toEqual([]);
  });

  it('returns [] when the DB returns null/undefined (defensive)', async () => {
    const fakeTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(undefined) // SET LOCAL
        .mockResolvedValueOnce(null), // unexpected null response
    };

    const result = await runSkillLatencyQuery(fakeTx as any, 'sub-abc', 1);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runSkillLatencyQuery — row mapping
// ---------------------------------------------------------------------------

describe('runSkillLatencyQuery — row mapping', () => {
  it('maps DB rows to QueryRow<SkillSlowEvidence> with ratioVsPeerP95 computed', async () => {
    const mockRow = {
      subaccount_id: 'sub-abc',
      skill_slug: 'send-email',
      metric_value: '800',
      computed_at: '2025-01-01T00:00:00Z',
      this_p95_ms: '800',
      peer_p50_ms: '100',
      peer_p95_ms: '200',
      n_tenants: '50',
      median_version: 3,
    };

    const fakeTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([mockRow]),
    };

    const result = await runSkillLatencyQuery(fakeTx as any, 'sub-abc', 3);

    expect(result).toHaveLength(1);
    expect(result[0].metricKey).toBe('send-email');
    expect(result[0].subaccountId).toBe('sub-abc');
    expect(result[0].evidence.skillSlug).toBe('send-email');
    expect(result[0].evidence.thisP95Ms).toBe(800);
    expect(result[0].evidence.peerP95Ms).toBe(200);
    expect(result[0].evidence.peerP50Ms).toBe(100);
    expect(result[0].evidence.nTenants).toBe(50);
    expect(result[0].evidence.medianVersion).toBe(3);
    // ratio = 800 / 200 = 4.0
    expect(result[0].evidence.ratioVsPeerP95).toBe(4);
  });

  it('sets ratioVsPeerP95 to 0 when peerP95Ms is 0 (guard against division by zero)', async () => {
    const mockRow = {
      subaccount_id: 'sub-abc',
      skill_slug: 'lookup',
      metric_value: '500',
      computed_at: '2025-01-01T00:00:00Z',
      this_p95_ms: '500',
      peer_p50_ms: '0',
      peer_p95_ms: '0',
      n_tenants: '1',
      median_version: 1,
    };

    const fakeTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([mockRow]),
    };

    const result = await runSkillLatencyQuery(fakeTx as any, 'sub-abc', 1);

    expect(result[0].evidence.ratioVsPeerP95).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// skillLatencyModule — structural contracts
// ---------------------------------------------------------------------------

describe('skillLatencyModule — structural contracts', () => {
  it('has the correct category', () => {
    expect(skillLatencyModule.category).toBe('optimiser.skill.slow');
  });

  it('is readReplicaSafe', () => {
    expect(skillLatencyModule.readReplicaSafe).toBe(true);
  });

  it('has the correct authoritativeTimestampColumn', () => {
    expect(skillLatencyModule.authoritativeTimestampColumn).toBe(
      'agent_execution_events.event_timestamp',
    );
  });

  it('exposes peerMediansViewIsPopulated as a function', () => {
    expect(typeof skillLatencyModule.peerMediansViewIsPopulated).toBe('function');
  });

  it('exposes runSkillLatencyQuery as a function', () => {
    expect(typeof skillLatencyModule.runSkillLatencyQuery).toBe('function');
  });
});
