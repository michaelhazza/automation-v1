/**
 * agentRecommendations.skipReasonCoverage.test.ts
 *
 * Meta-test that exercises every skip / no-op branch in upsertRecommendation
 * and asserts each emits exactly one structured log line with the expected
 * event key. Spies on the logger module so no DB is required.
 *
 * Covered log events (all branches per spec §6.2 decision flow):
 *   - recommendations.skipped.cooldown          (cooldown active, no severity escalation)
 *   - recommendations.skipped.cooldown_bypassed (cooldown active, severity escalates)
 *   - recommendations.no_change.hash_match      (open-match exists, hashes equal)
 *   - recommendations.skipped.sub_threshold     (open-match exists, hashes differ, materialDelta FALSE)
 *   - recommendations.evicted_lower_priority    (cap reached, new candidate evicts lowest)
 *   - recommendations.dropped_due_to_cap        (cap reached, new candidate is not higher priority)
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/agentRecommendations.skipReasonCoverage.test.ts
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://placeholder/skip';
process.env.JWT_SECRET ??= 'skip-placeholder-jwt';
process.env.EMAIL_FROM ??= 'skip@placeholder.example';

import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { UpsertRecommendationContext } from '../agentRecommendationsService.js';
import type { OutputRecommendInput } from '../../../shared/types/agentRecommendations.js';

// ── Shared test UUIDs ─────────────────────────────────────────────────────────

const ORG_ID = '10000000-0000-0000-0000-000000000001';
const SCOPE_ID = '10000000-0000-0000-0000-000000000002';
const AGENT_ID = '10000000-0000-0000-0000-000000000003';
const REC_ID = '10000000-0000-0000-0000-000000000099';
const REC_ID_2 = '10000000-0000-0000-0000-000000000088';

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

let executeQueue: unknown[][] = [];

const mockExecute = vi.fn(async (_query: unknown) => {
  const next = executeQueue.shift();
  if (next !== undefined) return next;
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

// ── Logger spy ────────────────────────────────────────────────────────────────

const loggerInfoSpy = vi.fn();
const loggerWarnSpy = vi.fn();

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: (...args: unknown[]) => loggerInfoSpy(...args),
    warn: (...args: unknown[]) => loggerWarnSpy(...args),
    error: vi.fn(),
  },
}));

function setExecuteQueue(...responses: unknown[][]) {
  executeQueue = responses.map((r) => r);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('structured log coverage — every skip/no-op branch emits exactly one log event', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    mockTransaction.mockClear();
    loggerInfoSpy.mockClear();
    loggerWarnSpy.mockClear();
  });

  test('cooldown active, same severity → emits recommendations.skipped.cooldown', async () => {
    setExecuteQueue(
      [], // advisory lock
      [{ id: REC_ID, severity: 'warn', dismissed_until: new Date(Date.now() + 3600_000).toISOString() }], // cooldown row
    );

    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    await upsertRecommendation(CTX, BASE_INPUT);

    const calls = loggerInfoSpy.mock.calls;
    const matching = calls.filter((args) => args[0] === 'recommendations.skipped.cooldown');
    expect(matching).toHaveLength(1);
  });

  test('cooldown active, severity escalates → emits recommendations.skipped.cooldown_bypassed', async () => {
    // Existing dismissed 'warn', incoming 'critical' → bypass logged, then fresh insert
    setExecuteQueue(
      [], // advisory lock
      [{ id: REC_ID, severity: 'warn', dismissed_until: new Date(Date.now() + 3600_000).toISOString() }], // cooldown (bypassed)
      [], // open-match: none
      [{ cnt: '0' }], // cap: under
      [{ id: REC_ID_2 }], // INSERT
    );

    const escalated = { ...BASE_INPUT, severity: 'critical' as const };
    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    await upsertRecommendation(CTX, escalated);

    const calls = loggerInfoSpy.mock.calls;
    const matching = calls.filter((args) => args[0] === 'recommendations.skipped.cooldown_bypassed');
    expect(matching).toHaveLength(1);
  });

  test('open match with equal hash → emits recommendations.no_change.hash_match', async () => {
    const { evidenceHash } = await import('../../../shared/types/agentRecommendations.js');
    const hash = evidenceHash(BASE_EVIDENCE as Record<string, unknown>);

    setExecuteQueue(
      [], // advisory lock
      [], // cooldown: none
      [{ id: REC_ID, evidence: BASE_EVIDENCE, evidence_hash: hash, acknowledged_at: null }], // open-match
    );

    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    await upsertRecommendation(CTX, BASE_INPUT);

    const calls = loggerInfoSpy.mock.calls;
    const matching = calls.filter((args) => args[0] === 'recommendations.no_change.hash_match');
    expect(matching).toHaveLength(1);
  });

  test('open match with sub-threshold delta → emits recommendations.skipped.sub_threshold', async () => {
    const { evidenceHash } = await import('../../../shared/types/agentRecommendations.js');
    const prevEvidence = { ...BASE_EVIDENCE };
    const prevHash = evidenceHash(prevEvidence as Record<string, unknown>);
    // Tiny change: 4% relative, under $10 absolute — sub-threshold for agent.over_budget
    const nextEvidence = { ...BASE_EVIDENCE, this_month: 5200 };

    setExecuteQueue(
      [], // advisory lock
      [], // cooldown: none
      [{ id: REC_ID, evidence: prevEvidence, evidence_hash: prevHash, acknowledged_at: null }], // open-match
    );

    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    await upsertRecommendation(CTX, { ...BASE_INPUT, evidence: nextEvidence });

    const calls = loggerInfoSpy.mock.calls;
    const matching = calls.filter((args) => args[0] === 'recommendations.skipped.sub_threshold');
    expect(matching).toHaveLength(1);
  });

  test('cap reached, new candidate higher priority → emits recommendations.evicted_lower_priority', async () => {
    const staleTime = new Date(Date.now() - 86400_000).toISOString();
    setExecuteQueue(
      [], // advisory lock
      [], // cooldown: none
      [], // open-match: none
      [{ cnt: '10' }], // cap: at limit
      // Lowest existing is 'info' — incoming 'warn' beats it
      [{ id: REC_ID, severity: 'info', category: 'optimiser.agent.over_budget', dedupe_key: 'k', updated_at: staleTime }],
      [], // UPDATE to evict
      [{ id: REC_ID_2 }], // INSERT
    );

    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    await upsertRecommendation(CTX, BASE_INPUT); // BASE_INPUT is 'warn'

    const calls = loggerInfoSpy.mock.calls;
    const matching = calls.filter((args) => args[0] === 'recommendations.evicted_lower_priority');
    expect(matching).toHaveLength(1);
  });

  test('cap reached, new candidate lower priority → emits recommendations.dropped_due_to_cap', async () => {
    const now = new Date().toISOString();
    setExecuteQueue(
      [], // advisory lock
      [], // cooldown: none
      [], // open-match: none
      [{ cnt: '10' }], // cap: at limit
      // Lowest existing is 'critical' — incoming 'warn' is lower priority
      [{ id: REC_ID, severity: 'critical', category: 'optimiser.agent.over_budget', dedupe_key: 'k', updated_at: now }],
    );

    const { upsertRecommendation } = await import('../agentRecommendationsService.js');
    await upsertRecommendation(CTX, BASE_INPUT); // BASE_INPUT is 'warn'

    const allInfoCalls = loggerInfoSpy.mock.calls;
    const allWarnCalls = loggerWarnSpy.mock.calls;
    const allCalls = [...allInfoCalls, ...allWarnCalls];

    const matching = allCalls.filter((args) => args[0] === 'recommendations.dropped_due_to_cap');
    expect(matching).toHaveLength(1);
  });
});
