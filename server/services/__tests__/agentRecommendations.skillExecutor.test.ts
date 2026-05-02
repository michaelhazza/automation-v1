/**
 * agentRecommendations.skillExecutor.test.ts
 *
 * Decision-flow integration tests for the output.recommend skill handler.
 * Tests the full §6.2 decision flow: advisory lock → cooldown → open-match →
 * cap → eviction → insert/update.
 *
 * DB is mocked at the module boundary; no real database required.
 * Mocks capture sequential execute() calls per scenario.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/agentRecommendations.skillExecutor.test.ts
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://placeholder/skip';
process.env.JWT_SECRET ??= 'skip-placeholder-jwt';
process.env.EMAIL_FROM ??= 'skip@placeholder.example';

import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { UpsertRecommendationContext } from '../agentRecommendationsService.js';
import type { OutputRecommendInput } from '../../../shared/types/agentRecommendations.js';

// ── Shared test UUIDs ─────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SCOPE_ID = '00000000-0000-0000-0000-000000000002';
const AGENT_ID = '00000000-0000-0000-0000-000000000003';
const REC_ID = '00000000-0000-0000-0000-000000000099';
const REC_ID_2 = '00000000-0000-0000-0000-000000000088';

const BASE_EVIDENCE = {
  agent_id: AGENT_ID,
  this_month: 5000,
  last_month: 4000,
  budget: 3000,
  top_cost_driver: 'llm-tokens',
};

const BASE_INPUT: OutputRecommendInput = {
  scope_type: 'org',
  scope_id: SCOPE_ID,
  category: 'optimiser.agent.over_budget',
  severity: 'warn',
  title: 'Agent over budget',
  body: 'This agent exceeded its monthly budget',
  evidence: BASE_EVIDENCE,
  action_hint: null,
  dedupe_key: `agent:${AGENT_ID}`,
};

const CTX: UpsertRecommendationContext = {
  organisationId: ORG_ID,
  agentId: AGENT_ID,
};

// ── DB mock infrastructure ─────────────────────────────────────────────────────
//
// The mock captures a queue of execute() return values that are consumed in order.
// Each scenario sets up the queue before calling upsertRecommendation.

let executeQueue: unknown[][] = [];
let insertedRows: Record<string, unknown>[] = [];

const mockExecute = vi.fn(async (query: unknown) => {
  const next = executeQueue.shift();
  if (next !== undefined) return next;
  // Advisory lock calls return empty
  return [];
});

const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
  const tx = { execute: mockExecute };
  return fn(tx);
});

vi.mock('../../db/index.js', () => ({
  db: {
    execute: mockExecute,
    transaction: mockTransaction,
  },
}));

vi.mock('../../websocket/emitters.js', () => ({
  emitOrgUpdate: vi.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function setExecuteQueue(...responses: unknown[][]) {
  executeQueue = responses.map((r) => r);
  insertedRows = [];
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('upsertRecommendation — cooldown branch', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    mockTransaction.mockClear();
  });

  test('active cooldown, same severity → returns reason: cooldown, no insert', async () => {
    // execute() call order inside transaction:
    // 1. pg_advisory_xact_lock → []
    // 2. cooldown check → [{ id, severity, dismissed_until }]
    setExecuteQueue(
      [], // advisory lock
      [{ id: REC_ID, severity: 'warn', dismissed_until: new Date(Date.now() + 3600_000).toISOString() }], // cooldown row
    );

    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    const result = await upsertRecommendation(CTX, BASE_INPUT);

    expect(result.was_new).toBe(false);
    expect(result.reason).toBe('cooldown');
    expect(result.recommendation_id).toBe(REC_ID);
  });

  test('active cooldown, severity escalates to critical → cooldown bypassed, falls through to open-match', async () => {
    // Existing dismissed row is 'warn'. Incoming is 'critical' — bypass.
    // After bypass, open-match finds nothing → cap check → count=0 → insert.
    setExecuteQueue(
      [], // advisory lock
      [{ id: REC_ID, severity: 'warn', dismissed_until: new Date(Date.now() + 3600_000).toISOString() }], // cooldown row (bypassed)
      [], // open-match: no open row
      [{ cnt: '0' }], // cap count = 0
      [{ id: REC_ID_2 }], // INSERT RETURNING id
    );

    const escalatedInput = { ...BASE_INPUT, severity: 'critical' as const };
    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    const result = await upsertRecommendation(CTX, escalatedInput);

    expect(result.was_new).toBe(true);
  });
});

describe('upsertRecommendation — open-match branch', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    mockTransaction.mockClear();
  });

  test('open match exists, hashes equal → no-op (hash_match)', async () => {
    // We need the same evidence hash. Use the real canonicalise function for this.
    const { evidenceHash } = await import('../../../shared/types/agentRecommendations.js');
    const hash = evidenceHash(BASE_EVIDENCE as Record<string, unknown>);

    setExecuteQueue(
      [], // advisory lock
      [], // cooldown: no active cooldown
      // open-match: existing row with same hash
      [{ id: REC_ID, evidence: BASE_EVIDENCE, evidence_hash: hash, acknowledged_at: null }],
    );

    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    const result = await upsertRecommendation(CTX, BASE_INPUT);

    expect(result.was_new).toBe(false);
    expect(result.recommendation_id).toBe(REC_ID);
    // reason is omitted on hash_match (no-op without reason key)
    expect(result.reason).toBeUndefined();
  });

  test('open match exists, hashes differ, materialDelta FALSE → sub_threshold', async () => {
    const { evidenceHash } = await import('../../../shared/types/agentRecommendations.js');
    const prevEvidence = { ...BASE_EVIDENCE };
    const prevHash = evidenceHash(prevEvidence as Record<string, unknown>);
    // Small change that doesn't cross materialDelta threshold for agent.over_budget:
    // < 10% relative change AND < $10 absolute
    const nextEvidence = { ...BASE_EVIDENCE, this_month: 5200 }; // only 4% change

    setExecuteQueue(
      [], // advisory lock
      [], // cooldown: no active cooldown
      // open-match: existing row with different hash
      [{ id: REC_ID, evidence: prevEvidence, evidence_hash: prevHash, acknowledged_at: null }],
    );

    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    const result = await upsertRecommendation(CTX, { ...BASE_INPUT, evidence: nextEvidence });

    expect(result.was_new).toBe(false);
    expect(result.reason).toBe('sub_threshold');
    expect(result.recommendation_id).toBe(REC_ID);
  });

  test('open match exists, hashes differ, materialDelta TRUE → updated_in_place', async () => {
    const { evidenceHash } = await import('../../../shared/types/agentRecommendations.js');
    const prevEvidence = { ...BASE_EVIDENCE };
    const prevHash = evidenceHash(prevEvidence as Record<string, unknown>);
    // Large change: 46% relative + >$10 absolute → materialDelta returns true
    const nextEvidence = { ...BASE_EVIDENCE, this_month: 7300 };

    setExecuteQueue(
      [], // advisory lock
      [], // cooldown: no active cooldown
      // open-match: existing row with different hash
      [{ id: REC_ID, evidence: prevEvidence, evidence_hash: prevHash, acknowledged_at: null }],
      [], // UPDATE RETURNING (no explicit return needed for test)
    );

    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    const result = await upsertRecommendation(CTX, { ...BASE_INPUT, evidence: nextEvidence });

    expect(result.was_new).toBe(false);
    expect(result.reason).toBe('updated_in_place');
    expect(result.recommendation_id).toBe(REC_ID);
  });
});

describe('upsertRecommendation — cap branch', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    mockTransaction.mockClear();
  });

  test('cap not reached (count < 10) → fresh insert, was_new=true', async () => {
    setExecuteQueue(
      [], // advisory lock
      [], // cooldown: none
      [], // open-match: no existing row
      [{ cnt: '5' }], // cap count = 5 (under 10)
      [{ id: REC_ID_2 }], // INSERT RETURNING id
    );

    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    const result = await upsertRecommendation(CTX, BASE_INPUT);

    expect(result.was_new).toBe(true);
    expect(result.recommendation_id).toBe(REC_ID_2);
  });

  test('cap reached, new candidate priority NOT higher → cap_reached', async () => {
    // Lowest existing row is 'critical'. New candidate is 'warn' → lower priority → drop.
    const now = new Date().toISOString();
    setExecuteQueue(
      [], // advisory lock
      [], // cooldown: none
      [], // open-match: no existing row
      [{ cnt: '10' }], // cap count = 10 (at cap)
      // lowest-priority row query:
      [{ id: REC_ID, severity: 'critical', category: 'optimiser.agent.over_budget', dedupe_key: 'k', updated_at: now }],
    );

    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    const result = await upsertRecommendation(CTX, BASE_INPUT); // BASE_INPUT is 'warn'

    expect(result.was_new).toBe(false);
    expect(result.reason).toBe('cap_reached');
    expect(result.recommendation_id).toBe('');
  });

  test('cap reached, new candidate priority HIGHER → eviction + insert', async () => {
    // Lowest existing row is 'info'. New candidate is 'warn' → higher priority → evict + insert.
    const staleTime = new Date(Date.now() - 86400_000).toISOString(); // 1 day old
    setExecuteQueue(
      [], // advisory lock
      [], // cooldown: none
      [], // open-match: no existing row
      [{ cnt: '10' }], // cap = 10
      // lowest-priority row is 'info' (lower than 'warn')
      [{ id: REC_ID, severity: 'info', category: 'optimiser.agent.over_budget', dedupe_key: 'k', updated_at: staleTime }],
      [], // UPDATE to evict
      [{ id: REC_ID_2 }], // INSERT RETURNING id
    );

    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    const result = await upsertRecommendation(CTX, BASE_INPUT); // BASE_INPUT is 'warn'

    expect(result.was_new).toBe(true);
    expect(result.recommendation_id).toBe(REC_ID_2);
    expect(result.reason).toBe('evicted_lower_priority');
  });
});

describe('upsertRecommendation — 23505 race condition', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    mockTransaction.mockClear();
  });

  test('23505 unique violation → catches, re-looks up open row, returns was_new=false', async () => {
    // First transaction attempt throws a unique constraint violation.
    // Then the outer catch issues a SELECT to find the existing row.
    mockTransaction.mockRejectedValueOnce({ code: '23505' });
    // The outer db.execute (for re-lookup after catch) returns the existing row.
    mockExecute.mockResolvedValueOnce([{ id: REC_ID }]);

    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    const result = await upsertRecommendation(CTX, BASE_INPUT);

    expect(result.was_new).toBe(false);
    expect(result.recommendation_id).toBe(REC_ID);
  });
});

describe('output.recommend skill handler — input validation', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    mockTransaction.mockClear();
  });

  test('missing agentId → returns success=false with descriptive error', async () => {
    const { SKILL_HANDLERS } = await import('../skillExecutor.js');
    const handler = SKILL_HANDLERS['output.recommend'];
    expect(handler).toBeDefined();

    // Context with no agentId
    const ctx = { organisationId: ORG_ID, agentId: '' } as unknown as Parameters<typeof handler>[1];
    const result = await handler(
      {
        scope_type: 'org',
        scope_id: SCOPE_ID,
        category: 'x.y.z',
        severity: 'info',
        title: 'T',
        body: 'B',
        evidence: {},
        dedupe_key: 'k',
      },
      ctx,
    );
    expect((result as { success: boolean }).success).toBe(false);
  });

  test('invalid scope_type → returns success=false', async () => {
    const { SKILL_HANDLERS } = await import('../skillExecutor.js');
    const handler = SKILL_HANDLERS['output.recommend'];

    const ctx = { organisationId: ORG_ID, agentId: AGENT_ID } as unknown as Parameters<typeof handler>[1];
    const result = await handler(
      {
        scope_type: 'invalid_scope',
        scope_id: SCOPE_ID,
        category: 'x.y.z',
        severity: 'info',
        title: 'T',
        body: 'B',
        evidence: {},
        dedupe_key: 'k',
      },
      ctx,
    );
    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { error: string }).error).toMatch(/scope_type/);
  });

  test('category with only two segments → returns success=false', async () => {
    const { SKILL_HANDLERS } = await import('../skillExecutor.js');
    const handler = SKILL_HANDLERS['output.recommend'];

    const ctx = { organisationId: ORG_ID, agentId: AGENT_ID } as unknown as Parameters<typeof handler>[1];
    const result = await handler(
      {
        scope_type: 'org',
        scope_id: SCOPE_ID,
        category: 'agent.over_budget', // only 2 segments
        severity: 'warn',
        title: 'T',
        body: 'B',
        evidence: {},
        dedupe_key: 'k',
      },
      ctx,
    );
    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { error: string }).error).toMatch(/three segments/);
  });

  test('invalid action_hint URI format → returns success=false', async () => {
    const { SKILL_HANDLERS } = await import('../skillExecutor.js');
    const handler = SKILL_HANDLERS['output.recommend'];

    const ctx = { organisationId: ORG_ID, agentId: AGENT_ID } as unknown as Parameters<typeof handler>[1];
    const result = await handler(
      {
        scope_type: 'org',
        scope_id: SCOPE_ID,
        category: 'optimiser.agent.budget',
        severity: 'info',
        title: 'T',
        body: 'B',
        evidence: {},
        action_hint: 'not-a-valid-uri', // no scheme://
        dedupe_key: 'k',
      },
      ctx,
    );
    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { error: string }).error).toMatch(/action_hint/);
  });

  test('category does not start with agent namespace → returns success=false with namespace error', async () => {
    const { SKILL_HANDLERS } = await import('../skillExecutor.js');
    const handler = SKILL_HANDLERS['output.recommend'];

    // Context carries agentNamespace 'optimiser'; category starts with 'portfolio' → mismatch
    const ctx = { organisationId: ORG_ID, agentId: AGENT_ID, agentNamespace: 'optimiser' } as unknown as Parameters<typeof handler>[1];
    const result = await handler(
      {
        scope_type: 'org',
        scope_id: SCOPE_ID,
        category: 'portfolio.agent.over_budget', // wrong namespace prefix
        severity: 'warn',
        title: 'T',
        body: 'B',
        evidence: {},
        dedupe_key: 'k',
      },
      ctx,
    );
    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { error: string }).error).toMatch(/namespace/);
  });

  test('category starts with agent namespace → passes namespace check', async () => {
    // When the category namespace matches, validation passes and the service is called.
    setExecuteQueue(
      [], // advisory lock
      [], // cooldown
      [], // open-match
      [{ cnt: '0' }], // cap
      [{ id: REC_ID_2 }], // INSERT
    );

    const { SKILL_HANDLERS } = await import('../skillExecutor.js');
    const handler = SKILL_HANDLERS['output.recommend'];

    const ctx = { organisationId: ORG_ID, agentId: AGENT_ID, agentNamespace: 'optimiser' } as unknown as Parameters<typeof handler>[1];
    const result = await handler(
      {
        scope_type: 'org',
        scope_id: SCOPE_ID,
        category: 'optimiser.agent.over_budget', // correct namespace prefix
        severity: 'warn',
        title: 'T',
        body: 'B',
        evidence: {},
        dedupe_key: 'k',
      },
      ctx,
    );
    expect((result as { success: boolean }).success).toBe(true);
  });

  test('no agent namespace declared → namespace check skipped, three-segment format accepted', async () => {
    // When context.agentNamespace is undefined, any valid three-segment category passes.
    setExecuteQueue(
      [], // advisory lock
      [], // cooldown
      [], // open-match
      [{ cnt: '0' }], // cap
      [{ id: REC_ID_2 }], // INSERT
    );

    const { SKILL_HANDLERS } = await import('../skillExecutor.js');
    const handler = SKILL_HANDLERS['output.recommend'];

    // No agentNamespace on context
    const ctx = { organisationId: ORG_ID, agentId: AGENT_ID } as unknown as Parameters<typeof handler>[1];
    const result = await handler(
      {
        scope_type: 'org',
        scope_id: SCOPE_ID,
        category: 'any_namespace.area.finding', // would fail if namespace check ran
        severity: 'info',
        title: 'T',
        body: 'B',
        evidence: {},
        dedupe_key: 'k',
      },
      ctx,
    );
    expect((result as { success: boolean }).success).toBe(true);
  });

  test('null action_hint is accepted', async () => {
    // When action_hint=null the validator should skip URI check.
    // The transaction will be called (DB mock returns fresh insert).
    setExecuteQueue(
      [], // advisory lock
      [], // cooldown
      [], // open-match
      [{ cnt: '0' }], // cap
      [{ id: REC_ID_2 }], // INSERT
    );

    const { SKILL_HANDLERS } = await import('../skillExecutor.js');
    const handler = SKILL_HANDLERS['output.recommend'];

    const ctx = { organisationId: ORG_ID, agentId: AGENT_ID } as unknown as Parameters<typeof handler>[1];
    const result = await handler(
      {
        scope_type: 'org',
        scope_id: SCOPE_ID,
        category: 'optimiser.agent.budget',
        severity: 'info',
        title: 'T',
        body: 'B',
        evidence: {},
        action_hint: null,
        dedupe_key: 'k',
      },
      ctx,
    );
    expect((result as { success: boolean }).success).toBe(true);
  });

  test('valid action_hint with scheme://path is accepted', async () => {
    setExecuteQueue(
      [], // advisory lock
      [], // cooldown
      [], // open-match
      [{ cnt: '0' }], // cap
      [{ id: REC_ID_2 }], // INSERT
    );

    const { SKILL_HANDLERS } = await import('../skillExecutor.js');
    const handler = SKILL_HANDLERS['output.recommend'];

    const ctx = { organisationId: ORG_ID, agentId: AGENT_ID } as unknown as Parameters<typeof handler>[1];
    const result = await handler(
      {
        scope_type: 'org',
        scope_id: SCOPE_ID,
        category: 'optimiser.agent.budget',
        severity: 'info',
        title: 'T',
        body: 'B',
        evidence: {},
        action_hint: 'configuration-assistant://agent/abc?focus=budget',
        dedupe_key: 'k',
      },
      ctx,
    );
    expect((result as { success: boolean }).success).toBe(true);
  });
});
