/**
 * runOptimiserScanPure.test.ts — Pure unit test (no DB, no LLM).
 *
 * Covers:
 *   1. Candidates are pre-sorted by (severity desc, category asc, dedupeKey asc)
 *      before output.recommend calls.
 *   2. output.recommend calls are sequential (call order is asserted).
 *   3. Circuit breaker fires when > 50% of categories fail:
 *      - 5/8 = 62.5% → fires (no output.recommend calls)
 *      - 4/8 = 50.0% → does NOT fire (exactly at threshold, not strictly over)
 *   4. Partial mode: when peerMediansViewIsPopulated returns false,
 *      skillLatency category is skipped and optimiser.scan.partial is emitted.
 *
 * Path note: test file lives at server/services/optimiser/__tests__/
 *   '../..'      = server/services/
 *   '../../..'   = server/
 *   '../../../lib' = server/lib/
 *   '../../../db'  = server/db/
 *
 * Runnable via:
 *   npx vitest run server/services/optimiser/__tests__/runOptimiserScanPure.test.ts
 */

// Env stubs — set before any module that reads process.env at load time
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://placeholder/skip';
process.env.JWT_SECRET ??= 'skip-placeholder-jwt-at-least-32-chars-long';
process.env.EMAIL_FROM ??= 'skip@placeholder.example';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────
// Must be declared at the top level so Vitest can hoist them before imports.
// All paths are relative to THIS test file.

vi.mock('../../../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../lib/orgScopedDb.js', () => ({
  getOrgScopedDb: vi.fn(),
}));

vi.mock('../../../lib/rlsBoundaryGuard.js', () => ({
  withAdminConnectionGuarded: vi.fn(),
}));

// Block heavy transitive deps so env.ts never executes
vi.mock('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://placeholder/skip',
    JWT_SECRET: 'skip-placeholder-jwt-at-least-32-chars-long',
    EMAIL_FROM: 'skip@placeholder.example',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../../db/index.js', () => ({
  db: { select: vi.fn(), execute: vi.fn(), transaction: vi.fn() },
}));

vi.mock('../../../instrumentation.js', () => ({
  withOrgTx: vi.fn(),
  getOrgTxContext: vi.fn(),
}));

// Query modules
vi.mock('../queries/agentBudget.js', () => ({
  module: { category: 'optimiser.agent.over_budget', run: vi.fn() },
}));
vi.mock('../queries/escalationRate.js', () => ({
  module: { category: 'optimiser.playbook.escalation_rate', run: vi.fn() },
}));
vi.mock('../queries/inactiveWorkflows.js', () => ({
  module: { category: 'optimiser.inactive.workflow', run: vi.fn() },
}));
vi.mock('../queries/escalationPhrases.js', () => ({
  module: { category: 'optimiser.escalation.repeat_phrase', run: vi.fn() },
}));
vi.mock('../queries/memoryCitation.js', () => ({
  module: { category: 'optimiser.memory.low_citation_waste', run: vi.fn() },
}));
vi.mock('../queries/routingUncertainty.js', () => ({
  module: { category: 'optimiser.agent.routing_uncertainty', run: vi.fn() },
}));
vi.mock('../queries/cacheEfficiency.js', () => ({
  module: { category: 'optimiser.llm.cache_poor_reuse', run: vi.fn() },
}));
vi.mock('../queries/skillLatency.js', () => ({
  skillLatencyModule: { category: 'optimiser.skill.slow' },
  peerMediansViewIsPopulated: vi.fn(),
  runSkillLatencyQuery: vi.fn(),
}));

// Evaluators
vi.mock('../recommendations/agentBudget.js', () => ({ evaluate: vi.fn() }));
vi.mock('../recommendations/playbookEscalation.js', () => ({ evaluate: vi.fn() }));
vi.mock('../recommendations/inactiveWorkflow.js', () => ({ evaluate: vi.fn() }));
vi.mock('../recommendations/repeatPhrase.js', () => ({ evaluate: vi.fn() }));
vi.mock('../recommendations/memoryCitation.js', () => ({ evaluate: vi.fn() }));
vi.mock('../recommendations/routingUncertainty.js', () => ({ evaluate: vi.fn() }));
vi.mock('../recommendations/cacheEfficiency.js', () => ({ evaluate: vi.fn() }));
vi.mock('../recommendations/skillSlow.js', () => ({ evaluateSkillSlow: vi.fn() }));

// Render + skill executor
vi.mock('../renderRecommendation.js', () => ({
  renderRecommendation: vi.fn(),
}));
vi.mock('../../skillExecutor.js', () => ({
  skillExecutor: { execute: vi.fn() },
}));

// Shared evidence hash — deterministic stub for tests
vi.mock('../../../../shared/types/agentRecommendations.js', () => ({
  evidenceHash: vi.fn((ev: Record<string, unknown>) => `hash:${JSON.stringify(ev)}`),
  canonicaliseEvidence: vi.fn((ev: Record<string, unknown>) => JSON.stringify(ev)),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { logger } from '../../../lib/logger.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { withAdminConnectionGuarded } from '../../../lib/rlsBoundaryGuard.js';

import { module as agentBudgetMod } from '../queries/agentBudget.js';
import { module as escalationRateMod } from '../queries/escalationRate.js';
import { module as inactiveWorkflowsMod } from '../queries/inactiveWorkflows.js';
import { module as escalationPhrasesMod } from '../queries/escalationPhrases.js';
import { module as memoryCitationMod } from '../queries/memoryCitation.js';
import { module as routingUncertaintyMod } from '../queries/routingUncertainty.js';
import { module as cacheEfficiencyMod } from '../queries/cacheEfficiency.js';
import { peerMediansViewIsPopulated } from '../queries/skillLatency.js';

import { evaluate as evalAgentBudget } from '../recommendations/agentBudget.js';
import { evaluate as evalEscalationRate } from '../recommendations/playbookEscalation.js';
import { evaluate as evalInactiveWorkflow } from '../recommendations/inactiveWorkflow.js';
import { evaluate as evalEscalationPhrases } from '../recommendations/repeatPhrase.js';
import { evaluate as evalMemoryCitation } from '../recommendations/memoryCitation.js';
import { evaluate as evalRoutingUncertainty } from '../recommendations/routingUncertainty.js';
import { evaluate as evalCacheEfficiency } from '../recommendations/cacheEfficiency.js';
import { evaluateSkillSlow } from '../recommendations/skillSlow.js';

import { renderRecommendation } from '../renderRecommendation.js';
import { skillExecutor } from '../../skillExecutor.js';

import { runOptimiserScan } from '../runOptimiserScan.js';
import type { EvaluatorOutput } from '../recommendations/types.js';

// ── Test constants ────────────────────────────────────────────────────────────

const SUB_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const AGENT_ID = 'cccccccc-0000-0000-0000-000000000001';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCandidate(
  category: string,
  severity: 'critical' | 'warn' | 'info',
  dedupeKey: string,
): EvaluatorOutput {
  const sevRank = severity === 'critical' ? 3 : severity === 'warn' ? 2 : 1;
  return {
    category,
    severity,
    dedupeKey,
    evidence: { category, dedupeKey },
    priorityTuple: [sevRank, category, dedupeKey],
    actionHint: null,
  };
}

/**
 * Stub a fake tx. The default mockResolvedValue([]) covers both the prior-recs
 * query and any subsequent version query. Pass `overrides` to customise.
 */
function makeFakeTx(executeResponses: unknown[][] = []) {
  let callCount = 0;
  return {
    execute: vi.fn(async () => {
      const r = executeResponses[callCount++];
      return r ?? [];
    }),
  };
}

/** Wire all 8 query modules to return empty arrays (noop path). */
function setAllModulesNoop() {
  vi.mocked(agentBudgetMod.run).mockResolvedValue([]);
  vi.mocked(escalationRateMod.run).mockResolvedValue([]);
  vi.mocked(inactiveWorkflowsMod.run).mockResolvedValue([]);
  vi.mocked(escalationPhrasesMod.run).mockResolvedValue([]);
  vi.mocked(memoryCitationMod.run).mockResolvedValue([]);
  vi.mocked(routingUncertaintyMod.run).mockResolvedValue([]);
  vi.mocked(cacheEfficiencyMod.run).mockResolvedValue([]);
}

/** Wire all evaluators to return empty arrays. */
function setAllEvaluatorsNoop() {
  vi.mocked(evalAgentBudget).mockReturnValue([]);
  vi.mocked(evalEscalationRate).mockReturnValue([]);
  vi.mocked(evalInactiveWorkflow).mockReturnValue([]);
  vi.mocked(evalEscalationPhrases).mockReturnValue([]);
  vi.mocked(evalMemoryCitation).mockReturnValue([]);
  vi.mocked(evalRoutingUncertainty).mockReturnValue([]);
  vi.mocked(evalCacheEfficiency).mockReturnValue([]);
  vi.mocked(evaluateSkillSlow).mockReturnValue([]);
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe('runOptimiserScan — sorting invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrgScopedDb).mockReturnValue(makeFakeTx() as any);
    vi.mocked(peerMediansViewIsPopulated).mockResolvedValue(false);
    setAllModulesNoop();
    setAllEvaluatorsNoop();
    vi.mocked(renderRecommendation).mockResolvedValue({ title: 'T', body: 'B', cacheHit: false });
    vi.mocked(skillExecutor.execute).mockResolvedValue({
      success: true,
      was_new: true,
      recommendation_id: 'r1',
    });
  });

  it('calls output.recommend in severity-desc, category-asc, dedupeKey-asc order', async () => {
    // 4 candidates across 2 categories, mixed severity
    const c1 = makeCandidate('optimiser.agent.over_budget', 'critical', 'agent-b');
    const c2 = makeCandidate('optimiser.agent.over_budget', 'warn', 'agent-a');
    const c3 = makeCandidate('optimiser.agent.routing_uncertainty', 'warn', 'agent-a');
    const c4 = makeCandidate('optimiser.agent.routing_uncertainty', 'info', 'agent-z');

    vi.mocked(agentBudgetMod.run).mockResolvedValue([{} as any]);
    vi.mocked(evalAgentBudget).mockReturnValue([c1, c2]);

    vi.mocked(routingUncertaintyMod.run).mockResolvedValue([{} as any]);
    vi.mocked(evalRoutingUncertainty).mockReturnValue([c3, c4]);

    await runOptimiserScan(SUB_ID, ORG_ID, AGENT_ID);

    const calls = vi.mocked(skillExecutor.execute).mock.calls;
    expect(calls).toHaveLength(4);

    const order = calls.map((c) => {
      const inp = c[0].input as Record<string, unknown>;
      return `${inp.severity}|${inp.category}|${inp.dedupe_key}`;
    });

    // Expected: critical → warn/budget → warn/routing → info/routing
    expect(order[0]).toBe('critical|optimiser.agent.over_budget|agent-b');
    expect(order[1]).toBe('warn|optimiser.agent.over_budget|agent-a');
    expect(order[2]).toBe('warn|optimiser.agent.routing_uncertainty|agent-a');
    expect(order[3]).toBe('info|optimiser.agent.routing_uncertainty|agent-z');
  });
});

describe('runOptimiserScan — sequential output.recommend invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrgScopedDb).mockReturnValue(makeFakeTx() as any);
    vi.mocked(peerMediansViewIsPopulated).mockResolvedValue(false);
    setAllModulesNoop();
    setAllEvaluatorsNoop();
    vi.mocked(renderRecommendation).mockResolvedValue({ title: 'T', body: 'B', cacheHit: false });
  });

  it('awaits each output.recommend call before starting the next', async () => {
    const callOrder: number[] = [];
    let resolveFirst!: () => void;
    let firstStarted = false;

    vi.mocked(skillExecutor.execute)
      .mockImplementationOnce(async () => {
        firstStarted = true;
        await new Promise<void>((resolve) => { resolveFirst = resolve; });
        callOrder.push(1);
        return { success: true, was_new: true, recommendation_id: 'r1' };
      })
      .mockImplementationOnce(async () => {
        callOrder.push(2);
        return { success: true, was_new: true, recommendation_id: 'r2' };
      });

    const c1 = makeCandidate('optimiser.agent.over_budget', 'critical', 'agent-1');
    const c2 = makeCandidate('optimiser.agent.over_budget', 'warn', 'agent-2');
    vi.mocked(agentBudgetMod.run).mockResolvedValue([{} as any]);
    vi.mocked(evalAgentBudget).mockReturnValue([c1, c2]);

    const scanPromise = runOptimiserScan(SUB_ID, ORG_ID, AGENT_ID);

    // Wait until first call has started
    await new Promise<void>((resolve) => {
      const check = () => {
        if (firstStarted) { resolve(); } else { setTimeout(check, 2); }
      };
      check();
    });

    // First call is in-flight, second has NOT been called yet
    expect(callOrder).toEqual([]);
    expect(firstStarted).toBe(true);

    // Let first call resolve
    resolveFirst();
    await scanPromise;

    expect(callOrder).toEqual([1, 2]);
  });
});

describe('runOptimiserScan — circuit breaker invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrgScopedDb).mockReturnValue(makeFakeTx() as any);
    vi.mocked(peerMediansViewIsPopulated).mockResolvedValue(false);
    setAllModulesNoop();
    setAllEvaluatorsNoop();
    vi.mocked(renderRecommendation).mockResolvedValue({ title: 'T', body: 'B', cacheHit: false });
    vi.mocked(skillExecutor.execute).mockResolvedValue({
      success: true,
      was_new: true,
      recommendation_id: 'r1',
    });
  });

  it('fires when 5 of 8 categories fail (62.5% > 50%)', async () => {
    const err = new Error('db timeout');
    vi.mocked(agentBudgetMod.run).mockRejectedValue(err);
    vi.mocked(escalationRateMod.run).mockRejectedValue(err);
    vi.mocked(inactiveWorkflowsMod.run).mockRejectedValue(err);
    vi.mocked(escalationPhrasesMod.run).mockRejectedValue(err);
    vi.mocked(memoryCitationMod.run).mockRejectedValue(err);

    const summary = await runOptimiserScan(SUB_ID, ORG_ID, AGENT_ID);

    // Circuit breaker fired — no output.recommend calls
    expect(vi.mocked(skillExecutor.execute)).not.toHaveBeenCalled();
    expect(summary.failedCategories).toHaveLength(5);
    expect(summary.candidatesProduced).toBe(0);

    const errorEvents = vi.mocked(logger.error).mock.calls.map((c) => c[0]);
    expect(errorEvents).toContain('optimiser.scan.circuit_breaker');
  });

  it('does NOT fire when exactly 4 of 8 categories fail (50.0% is not strictly > 50%)', async () => {
    const err = new Error('db timeout');
    vi.mocked(agentBudgetMod.run).mockRejectedValue(err);
    vi.mocked(escalationRateMod.run).mockRejectedValue(err);
    vi.mocked(inactiveWorkflowsMod.run).mockRejectedValue(err);
    vi.mocked(escalationPhrasesMod.run).mockRejectedValue(err);
    // 4 fail, 4 succeed (including skillLatency which is skipped in partial mode)

    await runOptimiserScan(SUB_ID, ORG_ID, AGENT_ID);

    const errorEvents = vi.mocked(logger.error).mock.calls.map((c) => c[0]);
    expect(errorEvents).not.toContain('optimiser.scan.circuit_breaker');
  });
});

describe('runOptimiserScan — partial mode invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAllModulesNoop();
    setAllEvaluatorsNoop();
    vi.mocked(renderRecommendation).mockResolvedValue({ title: 'T', body: 'B', cacheHit: false });
    vi.mocked(skillExecutor.execute).mockResolvedValue({
      success: true,
      was_new: true,
      recommendation_id: 'r1',
    });
  });

  it('skips skillLatency (does not call withAdminConnectionGuarded) when view is empty', async () => {
    vi.mocked(getOrgScopedDb).mockReturnValue(makeFakeTx() as any);
    vi.mocked(peerMediansViewIsPopulated).mockResolvedValue(false);

    await runOptimiserScan(SUB_ID, ORG_ID, AGENT_ID);

    expect(vi.mocked(withAdminConnectionGuarded)).not.toHaveBeenCalled();
  });

  it('emits optimiser.scan.partial when view is not populated', async () => {
    vi.mocked(getOrgScopedDb).mockReturnValue(makeFakeTx() as any);
    vi.mocked(peerMediansViewIsPopulated).mockResolvedValue(false);

    await runOptimiserScan(SUB_ID, ORG_ID, AGENT_ID);

    const infoEvents = vi.mocked(logger.info).mock.calls.map((c) => c[0]);
    expect(infoEvents).toContain('optimiser.scan.partial');
  });

  it('returns partialMode: true in summary when view is not populated', async () => {
    vi.mocked(getOrgScopedDb).mockReturnValue(makeFakeTx() as any);
    vi.mocked(peerMediansViewIsPopulated).mockResolvedValue(false);

    const summary = await runOptimiserScan(SUB_ID, ORG_ID, AGENT_ID);

    expect(summary.partialMode).toBe(true);
  });

  it('calls withAdminConnectionGuarded when view IS populated', async () => {
    // Two execute() calls: (1) prior recs → [], (2) MAX(median_version) → [{ max_version: 1 }]
    vi.mocked(getOrgScopedDb).mockReturnValue(
      makeFakeTx([[], [{ max_version: 1 }]]) as any,
    );
    vi.mocked(peerMediansViewIsPopulated).mockResolvedValue(true);
    vi.mocked(withAdminConnectionGuarded).mockImplementation(async (_opts, fn: any) => {
      return fn({ execute: vi.fn().mockResolvedValue([]) } as any);
    });

    await runOptimiserScan(SUB_ID, ORG_ID, AGENT_ID);

    expect(vi.mocked(withAdminConnectionGuarded)).toHaveBeenCalled();
  });

  it('stamps partial_run: true on evidence when partial mode is active', async () => {
    vi.mocked(getOrgScopedDb).mockReturnValue(makeFakeTx() as any);
    vi.mocked(peerMediansViewIsPopulated).mockResolvedValue(false);

    // Produce one candidate
    const candidate = makeCandidate('optimiser.agent.over_budget', 'warn', 'agent-1');
    vi.mocked(agentBudgetMod.run).mockResolvedValue([{} as any]);
    vi.mocked(evalAgentBudget).mockReturnValue([candidate]);

    await runOptimiserScan(SUB_ID, ORG_ID, AGENT_ID);

    const calls = vi.mocked(skillExecutor.execute).mock.calls;
    expect(calls).toHaveLength(1);
    const ev = (calls[0]![0].input as Record<string, unknown>).evidence as Record<string, unknown>;
    expect(ev.partial_run).toBe(true);
  });
});
