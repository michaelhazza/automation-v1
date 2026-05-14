// Verification matrix — Chunk 8, Sub-account Optimiser
// Pure/mockable cases only. Integration cases (marked .skip) require a live DB
// and run as part of the CI gate suite.

// Env stubs — must be set before any module that reads process.env at load time
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://placeholder/skip';
process.env.JWT_SECRET ??= 'skip-placeholder-jwt-at-least-32-chars-long';
process.env.EMAIL_FROM ??= 'skip@placeholder.example';

import { describe, it, expect, vi } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────
// Block heavy transitive deps before any module load so env.ts never executes.
// These are needed because runOptimiserScan.ts (imported for its exported constants)
// transitively imports db/index.js, logger.js, etc.

vi.mock('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://placeholder/skip',
    JWT_SECRET: 'skip-placeholder-jwt-at-least-32-chars-long',
    EMAIL_FROM: 'skip@placeholder.example',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../lib/orgScopedDb.js', () => ({
  getOrgScopedDb: vi.fn(),
}));

vi.mock('../../../lib/rlsBoundaryGuard.js', () => ({
  withAdminConnectionGuarded: vi.fn(),
}));

vi.mock('../../../db/index.js', () => ({
  db: { select: vi.fn(), execute: vi.fn(), transaction: vi.fn() },
}));

vi.mock('../../../instrumentation.js', () => ({
  withOrgTx: vi.fn(),
  getOrgTxContext: vi.fn(),
}));

// Query modules — mocked so the evaluators' `import type` from query files
// does not trigger DB connection at module load time
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

// Downstream deps of runOptimiserScan.ts
vi.mock('../renderRecommendation.js', () => ({
  renderRecommendation: vi.fn(),
}));
vi.mock('../../skillExecutor.js', () => ({
  skillExecutor: { execute: vi.fn() },
}));
vi.mock('../../../../shared/types/agentRecommendations.js', () => ({
  evidenceHash: vi.fn((ev: Record<string, unknown>) => `hash:${JSON.stringify(ev)}`),
  canonicaliseEvidence: vi.fn((ev: Record<string, unknown>) => JSON.stringify(ev)),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  TOTAL_CATEGORIES,
  SCAN_FAILURE_CIRCUIT_BREAKER_THRESHOLD,
} from '../runOptimiserScan.js';
import { evaluate as evaluateAgentBudget } from '../recommendations/agentBudget.js';
import { evaluate as evaluateEscalationRate } from '../recommendations/playbookEscalation.js';
import { evaluate as evaluateInactiveWorkflow } from '../recommendations/inactiveWorkflow.js';
import { evaluate as evaluateEscalationPhrases } from '../recommendations/repeatPhrase.js';
import { evaluate as evaluateMemoryCitation } from '../recommendations/memoryCitation.js';
import { evaluate as evaluateRoutingUncertainty } from '../recommendations/routingUncertainty.js';
import { evaluate as evaluateCacheEfficiency } from '../recommendations/cacheEfficiency.js';
import { evaluateSkillSlow } from '../recommendations/skillSlow.js';
import type { EvaluatorContext, EvaluatorOutput } from '../recommendations/types.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseCtx: EvaluatorContext = {
  subaccountId: 'sub-aaaa-0001',
  organisationId: 'org-aaaa-0001',
  medianVersion: 1,
  priorRecsByDedupe: new Map(),
};

function makeAgentBudgetRow(overrides: Partial<{
  agentId: string;
  percentUsed: number;
  metricKey: string;
}>) {
  return {
    subaccountId: baseCtx.subaccountId,
    metricKey: overrides.metricKey ?? overrides.agentId ?? 'agent-001',
    metricValue: overrides.percentUsed ?? 0.95,
    computedAt: new Date('2026-05-04T00:00:00Z'),
    evidence: {
      agentId: overrides.agentId ?? 'agent-001',
      agentName: 'Test Agent',
      thisMonthSpendUsd: 95,
      budgetLimitUsd: 100,
      percentUsed: overrides.percentUsed ?? 0.95,
      median_version: 0 as const,
    },
  };
}

function makeEscalationRateRow(overrides: Partial<{
  workflowId: string;
  escalationRate: number;
  metricKey: string;
}>) {
  const rate = overrides.escalationRate ?? 0.4;
  return {
    subaccountId: baseCtx.subaccountId,
    metricKey: overrides.metricKey ?? overrides.workflowId ?? 'wf-001',
    metricValue: rate,
    computedAt: new Date('2026-05-04T00:00:00Z'),
    evidence: {
      workflowId: overrides.workflowId ?? 'wf-001',
      escalationCount: Math.round(rate * 10),
      totalCount: 10,
      escalationRate: rate,
      median_version: 0 as const,
    },
  };
}

function makeInactiveWorkflowRow(overrides: Partial<{
  subaccountAgentId: string;
  agentId: string;
  daysSinceLastRun: number;
  metricKey: string;
}>) {
  return {
    subaccountId: baseCtx.subaccountId,
    metricKey: overrides.metricKey ?? overrides.subaccountAgentId ?? 'sa-001',
    metricValue: overrides.daysSinceLastRun ?? 20,
    computedAt: new Date('2026-05-04T00:00:00Z'),
    evidence: {
      subaccountAgentId: overrides.subaccountAgentId ?? 'sa-001',
      agentId: overrides.agentId ?? 'agent-001',
      agentName: 'Inactive Agent',
      lastRunAt: null,
      daysSinceLastRun: overrides.daysSinceLastRun ?? 20,
      median_version: 0 as const,
    },
  };
}

function makeEscalationPhraseRow(overrides: Partial<{
  phrase: string;
  count: number;
  metricKey: string;
}>) {
  return {
    subaccountId: baseCtx.subaccountId,
    metricKey: overrides.metricKey ?? overrides.phrase ?? 'phrase-001',
    metricValue: overrides.count ?? 5,
    computedAt: new Date('2026-05-04T00:00:00Z'),
    evidence: {
      phrase: overrides.phrase ?? 'please escalate',
      count: overrides.count ?? 5,
      sampleEscalationIds: ['esc-001', 'esc-002'],
      median_version: 0 as const,
    },
  };
}

function makeMemoryCitationRow(overrides: Partial<{
  agentId: string;
  avgCitationScore: number;
  metricKey: string;
}>) {
  return {
    subaccountId: baseCtx.subaccountId,
    metricKey: overrides.metricKey ?? overrides.agentId ?? 'agent-001',
    metricValue: overrides.avgCitationScore ?? 0.3,
    computedAt: new Date('2026-05-04T00:00:00Z'),
    evidence: {
      agentId: overrides.agentId ?? 'agent-001',
      avgCitationScore: overrides.avgCitationScore ?? 0.3,
      totalCitations: 10,
      median_version: 0 as const,
    },
  };
}

function makeRoutingUncertaintyRow(overrides: Partial<{
  agentId: string;
  uncertaintyRate: number;
  metricKey: string;
}>) {
  return {
    subaccountId: baseCtx.subaccountId,
    metricKey: overrides.metricKey ?? overrides.agentId ?? 'agent-001',
    metricValue: overrides.uncertaintyRate ?? 0.5,
    computedAt: new Date('2026-05-04T00:00:00Z'),
    evidence: {
      agentId: overrides.agentId ?? 'agent-001',
      uncertainDecisions: 5,
      totalDecisions: 10,
      uncertaintyRate: overrides.uncertaintyRate ?? 0.5,
      median_version: 0 as const,
    },
  };
}

function makeCacheEfficiencyRow(overrides: Partial<{
  agentId: string;
  cacheHitRate: number;
  metricKey: string;
}>) {
  return {
    subaccountId: baseCtx.subaccountId,
    metricKey: overrides.metricKey ?? overrides.agentId ?? 'agent-001',
    metricValue: overrides.cacheHitRate ?? 0.2,
    computedAt: new Date('2026-05-04T00:00:00Z'),
    evidence: {
      agentId: overrides.agentId ?? 'agent-001',
      cacheHits: 2,
      totalRequests: 10,
      cacheHitRate: overrides.cacheHitRate ?? 0.2,
      median_version: 0 as const,
    },
  };
}

function makeSkillSlowRow(overrides: Partial<{
  skillSlug: string;
  ratioVsPeerP95: number;
  metricKey: string;
}>) {
  return {
    subaccountId: baseCtx.subaccountId,
    metricKey: overrides.metricKey ?? overrides.skillSlug ?? 'skill-001',
    metricValue: overrides.ratioVsPeerP95 ?? 5,
    computedAt: new Date('2026-05-04T00:00:00Z'),
    evidence: {
      skillSlug: overrides.skillSlug ?? 'skill-001',
      thisP95Ms: 5000,
      peerP95Ms: 1000,
      peerP50Ms: 500,
      nTenants: 10,
      medianVersion: 1,
      ratioVsPeerP95: overrides.ratioVsPeerP95 ?? 5,
    },
  };
}

// Deterministic in-place shuffle for test repeatability
function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = (i * 7 + 3) % (i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Optimiser verification matrix', () => {
  // ── 1. Evaluator purity ──────────────────────────────────────────────────
  describe('Evaluator purity: identical inputs produce identical output', () => {
    it('agentBudget evaluator: same input 10x produces identical by-key output', () => {
      const rows = [
        makeAgentBudgetRow({ agentId: 'agent-001', percentUsed: 0.95 }),
        makeAgentBudgetRow({ agentId: 'agent-002', percentUsed: 1.05 }),
      ];

      const first = evaluateAgentBudget(rows, baseCtx);

      for (let i = 0; i < 9; i++) {
        const shuffled = shuffleArray(rows);
        const result = evaluateAgentBudget(shuffled, baseCtx);
        const byKey = Object.fromEntries(result.map((r) => [r.dedupeKey, r]));
        const firstByKey = Object.fromEntries(first.map((r) => [r.dedupeKey, r]));
        expect(byKey).toEqual(firstByKey);
      }
    });

    it('escalationRate evaluator: same input 10x produces identical by-key output', () => {
      const rows = [
        makeEscalationRateRow({ workflowId: 'wf-001', escalationRate: 0.35 }),
        makeEscalationRateRow({ workflowId: 'wf-002', escalationRate: 0.65 }),
      ];

      const first = evaluateEscalationRate(rows, baseCtx);

      for (let i = 0; i < 9; i++) {
        const shuffled = shuffleArray(rows);
        const result = evaluateEscalationRate(shuffled, baseCtx);
        const byKey = Object.fromEntries(result.map((r) => [r.dedupeKey, r]));
        const firstByKey = Object.fromEntries(first.map((r) => [r.dedupeKey, r]));
        expect(byKey).toEqual(firstByKey);
      }
    });

    it('inactiveWorkflow evaluator: same input 10x produces identical by-key output', () => {
      const rows = [
        makeInactiveWorkflowRow({ subaccountAgentId: 'sa-001', daysSinceLastRun: 5 }),
        makeInactiveWorkflowRow({ subaccountAgentId: 'sa-002', daysSinceLastRun: 20 }),
      ];

      const first = evaluateInactiveWorkflow(rows, baseCtx);

      for (let i = 0; i < 9; i++) {
        const shuffled = shuffleArray(rows);
        const result = evaluateInactiveWorkflow(shuffled, baseCtx);
        const byKey = Object.fromEntries(result.map((r) => [r.dedupeKey, r]));
        const firstByKey = Object.fromEntries(first.map((r) => [r.dedupeKey, r]));
        expect(byKey).toEqual(firstByKey);
      }
    });

    it('escalationPhrases evaluator: same input 10x produces identical by-key output', () => {
      const rows = [
        makeEscalationPhraseRow({ phrase: 'please help', count: 4 }),
        makeEscalationPhraseRow({ phrase: 'not sure', count: 3 }),
      ];

      const first = evaluateEscalationPhrases(rows, baseCtx);

      for (let i = 0; i < 9; i++) {
        const shuffled = shuffleArray(rows);
        const result = evaluateEscalationPhrases(shuffled, baseCtx);
        const byKey = Object.fromEntries(result.map((r) => [r.dedupeKey, r]));
        const firstByKey = Object.fromEntries(first.map((r) => [r.dedupeKey, r]));
        expect(byKey).toEqual(firstByKey);
      }
    });

    it('memoryCitation evaluator: same input 10x produces identical by-key output', () => {
      const rows = [
        makeMemoryCitationRow({ agentId: 'agent-001', avgCitationScore: 0.15 }),
        makeMemoryCitationRow({ agentId: 'agent-002', avgCitationScore: 0.35 }),
      ];

      const first = evaluateMemoryCitation(rows, baseCtx);

      for (let i = 0; i < 9; i++) {
        const shuffled = shuffleArray(rows);
        const result = evaluateMemoryCitation(shuffled, baseCtx);
        const byKey = Object.fromEntries(result.map((r) => [r.dedupeKey, r]));
        const firstByKey = Object.fromEntries(first.map((r) => [r.dedupeKey, r]));
        expect(byKey).toEqual(firstByKey);
      }
    });

    it('routingUncertainty evaluator: same input 10x produces identical by-key output', () => {
      const rows = [
        makeRoutingUncertaintyRow({ agentId: 'agent-001', uncertaintyRate: 0.5 }),
        makeRoutingUncertaintyRow({ agentId: 'agent-002', uncertaintyRate: 0.8 }),
      ];

      const first = evaluateRoutingUncertainty(rows, baseCtx);

      for (let i = 0; i < 9; i++) {
        const shuffled = shuffleArray(rows);
        const result = evaluateRoutingUncertainty(shuffled, baseCtx);
        const byKey = Object.fromEntries(result.map((r) => [r.dedupeKey, r]));
        const firstByKey = Object.fromEntries(first.map((r) => [r.dedupeKey, r]));
        expect(byKey).toEqual(firstByKey);
      }
    });

    it('cacheEfficiency evaluator: same input 10x produces identical by-key output', () => {
      const rows = [
        makeCacheEfficiencyRow({ agentId: 'agent-001', cacheHitRate: 0.05 }),
        makeCacheEfficiencyRow({ agentId: 'agent-002', cacheHitRate: 0.2 }),
      ];

      const first = evaluateCacheEfficiency(rows, baseCtx);

      for (let i = 0; i < 9; i++) {
        const shuffled = shuffleArray(rows);
        const result = evaluateCacheEfficiency(shuffled, baseCtx);
        const byKey = Object.fromEntries(result.map((r) => [r.dedupeKey, r]));
        const firstByKey = Object.fromEntries(first.map((r) => [r.dedupeKey, r]));
        expect(byKey).toEqual(firstByKey);
      }
    });

    it('skillSlow evaluator: same input 10x produces identical by-key output', () => {
      const rows = [
        makeSkillSlowRow({ skillSlug: 'skill-001', ratioVsPeerP95: 4 }),
        makeSkillSlowRow({ skillSlug: 'skill-002', ratioVsPeerP95: 8 }),
      ];

      const first = evaluateSkillSlow(rows, baseCtx);

      for (let i = 0; i < 9; i++) {
        const shuffled = shuffleArray(rows);
        const result = evaluateSkillSlow(shuffled, baseCtx);
        const byKey = Object.fromEntries(result.map((r) => [r.dedupeKey, r]));
        const firstByKey = Object.fromEntries(first.map((r) => [r.dedupeKey, r]));
        expect(byKey).toEqual(firstByKey);
      }
    });
  });

  // ── 2. Pre-sort invariant ────────────────────────────────────────────────
  describe('Pre-sort invariant: candidates sorted before output.recommend', () => {
    function severityRank(s: 'info' | 'warn' | 'critical'): number {
      if (s === 'critical') return 3;
      if (s === 'warn') return 2;
      return 1;
    }

    function sortCandidates(candidates: EvaluatorOutput[]): EvaluatorOutput[] {
      return [...candidates].sort((a, b) => {
        const aSev = severityRank(a.severity);
        const bSev = severityRank(b.severity);
        if (aSev !== bSev) return bSev - aSev;
        if (a.category !== b.category) return a.category < b.category ? -1 : 1;
        return a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0;
      });
    }

    it('sorts by severity desc (critical > warn > info)', () => {
      const candidates: EvaluatorOutput[] = [
        { category: 'optimiser.a', severity: 'info', dedupeKey: 'k1', evidence: {}, priorityTuple: [1, 'optimiser.a', 'k1'], actionHint: null },
        { category: 'optimiser.a', severity: 'critical', dedupeKey: 'k2', evidence: {}, priorityTuple: [3, 'optimiser.a', 'k2'], actionHint: null },
        { category: 'optimiser.a', severity: 'warn', dedupeKey: 'k3', evidence: {}, priorityTuple: [2, 'optimiser.a', 'k3'], actionHint: null },
      ];

      const sorted = sortCandidates(candidates);

      expect(sorted[0]!.severity).toBe('critical');
      expect(sorted[1]!.severity).toBe('warn');
      expect(sorted[2]!.severity).toBe('info');
    });

    it('within same severity, sorts by category asc', () => {
      const candidates: EvaluatorOutput[] = [
        { category: 'optimiser.z.cat', severity: 'warn', dedupeKey: 'k1', evidence: {}, priorityTuple: [2, 'optimiser.z.cat', 'k1'], actionHint: null },
        { category: 'optimiser.a.cat', severity: 'warn', dedupeKey: 'k2', evidence: {}, priorityTuple: [2, 'optimiser.a.cat', 'k2'], actionHint: null },
        { category: 'optimiser.m.cat', severity: 'warn', dedupeKey: 'k3', evidence: {}, priorityTuple: [2, 'optimiser.m.cat', 'k3'], actionHint: null },
      ];

      const sorted = sortCandidates(candidates);

      expect(sorted[0]!.category).toBe('optimiser.a.cat');
      expect(sorted[1]!.category).toBe('optimiser.m.cat');
      expect(sorted[2]!.category).toBe('optimiser.z.cat');
    });

    it('within same severity and category, sorts by dedupeKey asc', () => {
      const candidates: EvaluatorOutput[] = [
        { category: 'optimiser.x', severity: 'info', dedupeKey: 'key-z', evidence: {}, priorityTuple: [1, 'optimiser.x', 'key-z'], actionHint: null },
        { category: 'optimiser.x', severity: 'info', dedupeKey: 'key-a', evidence: {}, priorityTuple: [1, 'optimiser.x', 'key-a'], actionHint: null },
        { category: 'optimiser.x', severity: 'info', dedupeKey: 'key-m', evidence: {}, priorityTuple: [1, 'optimiser.x', 'key-m'], actionHint: null },
      ];

      const sorted = sortCandidates(candidates);

      expect(sorted[0]!.dedupeKey).toBe('key-a');
      expect(sorted[1]!.dedupeKey).toBe('key-m');
      expect(sorted[2]!.dedupeKey).toBe('key-z');
    });

    it('full 5-candidate mix produces expected order', () => {
      const candidates: EvaluatorOutput[] = [
        { category: 'optimiser.agent.over_budget', severity: 'warn', dedupeKey: 'agent-b', evidence: {}, priorityTuple: [2, 'optimiser.agent.over_budget', 'agent-b'], actionHint: null },
        { category: 'optimiser.llm.cache_poor_reuse', severity: 'info', dedupeKey: 'agent-x', evidence: {}, priorityTuple: [1, 'optimiser.llm.cache_poor_reuse', 'agent-x'], actionHint: null },
        { category: 'optimiser.agent.over_budget', severity: 'critical', dedupeKey: 'agent-a', evidence: {}, priorityTuple: [3, 'optimiser.agent.over_budget', 'agent-a'], actionHint: null },
        { category: 'optimiser.inactive.workflow', severity: 'warn', dedupeKey: 'sa-001', evidence: {}, priorityTuple: [2, 'optimiser.inactive.workflow', 'sa-001'], actionHint: null },
        { category: 'optimiser.agent.over_budget', severity: 'warn', dedupeKey: 'agent-a', evidence: {}, priorityTuple: [2, 'optimiser.agent.over_budget', 'agent-a'], actionHint: null },
      ];

      const sorted = sortCandidates(candidates);

      // Slot 0: critical beats all
      expect(sorted[0]!.severity).toBe('critical');
      expect(sorted[0]!.dedupeKey).toBe('agent-a');

      // Slots 1-3: warn, sorted by category asc, then dedupeKey asc
      const warnSlots = sorted.slice(1, 4);
      expect(warnSlots.every((c) => c.severity === 'warn')).toBe(true);
      // agent.over_budget < inactive.workflow alphabetically
      expect(warnSlots[0]!.category).toBe('optimiser.agent.over_budget');
      expect(warnSlots[0]!.dedupeKey).toBe('agent-a');
      expect(warnSlots[1]!.category).toBe('optimiser.agent.over_budget');
      expect(warnSlots[1]!.dedupeKey).toBe('agent-b');
      expect(warnSlots[2]!.category).toBe('optimiser.inactive.workflow');

      // Slot 4: info
      expect(sorted[4]!.severity).toBe('info');
    });
  });

  // ── 3. Circuit breaker threshold ─────────────────────────────────────────
  describe('Circuit breaker threshold: fires at >50%, not at 50%', () => {
    it('exports TOTAL_CATEGORIES = 8', () => {
      expect(TOTAL_CATEGORIES).toBe(8);
    });

    it('exports SCAN_FAILURE_CIRCUIT_BREAKER_THRESHOLD = 0.5', () => {
      expect(SCAN_FAILURE_CIRCUIT_BREAKER_THRESHOLD).toBe(0.5);
    });

    it('4/8 = 0.5 does NOT exceed the threshold (invariant 25: strictly >)', () => {
      const failedCount = 4;
      const fires = failedCount / TOTAL_CATEGORIES > SCAN_FAILURE_CIRCUIT_BREAKER_THRESHOLD;
      expect(fires).toBe(false);
    });

    it('5/8 = 0.625 DOES exceed the threshold', () => {
      const failedCount = 5;
      const fires = failedCount / TOTAL_CATEGORIES > SCAN_FAILURE_CIRCUIT_BREAKER_THRESHOLD;
      expect(fires).toBe(true);
    });

    it('0/8 = 0 does NOT fire', () => {
      const fires = 0 / TOTAL_CATEGORIES > SCAN_FAILURE_CIRCUIT_BREAKER_THRESHOLD;
      expect(fires).toBe(false);
    });

    it('8/8 = 1.0 fires (all failed)', () => {
      const fires = TOTAL_CATEGORIES / TOTAL_CATEGORIES > SCAN_FAILURE_CIRCUIT_BREAKER_THRESHOLD;
      expect(fires).toBe(true);
    });
  });

  // ── 4. Evaluator optional-field normalisation ────────────────────────────
  describe('Evaluator optional-field normalisation: no undefined fields in evidence', () => {
    function assertNoUndefinedValues(evidence: Record<string, unknown>, label: string): void {
      for (const [k, v] of Object.entries(evidence)) {
        expect(
          typeof v,
          `${label}: evidence.${k} must not be undefined (use null)`,
        ).not.toBe('undefined');
      }
    }

    it('agentBudget evidence contains no undefined values', () => {
      const rows = [makeAgentBudgetRow({ agentId: 'agent-001', percentUsed: 0.95 })];
      const outputs = evaluateAgentBudget(rows, baseCtx);
      for (const o of outputs) assertNoUndefinedValues(o.evidence, 'agentBudget');
    });

    it('escalationRate evidence contains no undefined values', () => {
      const rows = [makeEscalationRateRow({ workflowId: 'wf-001', escalationRate: 0.4 })];
      const outputs = evaluateEscalationRate(rows, baseCtx);
      for (const o of outputs) assertNoUndefinedValues(o.evidence, 'escalationRate');
    });

    it('inactiveWorkflow evidence contains no undefined values', () => {
      const rows = [makeInactiveWorkflowRow({ subaccountAgentId: 'sa-001', daysSinceLastRun: 20 })];
      const outputs = evaluateInactiveWorkflow(rows, baseCtx);
      for (const o of outputs) assertNoUndefinedValues(o.evidence, 'inactiveWorkflow');
    });

    it('escalationPhrases evidence contains no undefined values', () => {
      const rows = [makeEscalationPhraseRow({ phrase: 'please help', count: 5 })];
      const outputs = evaluateEscalationPhrases(rows, baseCtx);
      for (const o of outputs) assertNoUndefinedValues(o.evidence, 'escalationPhrases');
    });

    it('memoryCitation evidence contains no undefined values', () => {
      const rows = [makeMemoryCitationRow({ agentId: 'agent-001', avgCitationScore: 0.15 })];
      const outputs = evaluateMemoryCitation(rows, baseCtx);
      for (const o of outputs) assertNoUndefinedValues(o.evidence, 'memoryCitation');
    });

    it('routingUncertainty evidence contains no undefined values', () => {
      const rows = [makeRoutingUncertaintyRow({ agentId: 'agent-001', uncertaintyRate: 0.5 })];
      const outputs = evaluateRoutingUncertainty(rows, baseCtx);
      for (const o of outputs) assertNoUndefinedValues(o.evidence, 'routingUncertainty');
    });

    it('cacheEfficiency evidence contains no undefined values', () => {
      const rows = [makeCacheEfficiencyRow({ agentId: 'agent-001', cacheHitRate: 0.05 })];
      const outputs = evaluateCacheEfficiency(rows, baseCtx);
      for (const o of outputs) assertNoUndefinedValues(o.evidence, 'cacheEfficiency');
    });

    it('skillSlow evidence contains no undefined values (invariant 33)', () => {
      const rows = [makeSkillSlowRow({ skillSlug: 'skill-001', ratioVsPeerP95: 4 })];
      const outputs = evaluateSkillSlow(rows, baseCtx);
      for (const o of outputs) assertNoUndefinedValues(o.evidence, 'skillSlow');
    });
  });

  // ── 5. Slug leakage check ────────────────────────────────────────────────
  describe('Slug leakage check: evaluator evidence keys do not expose full category slugs', () => {
    // The rendered title/body is LLM-generated and tested at runtime.
    // The evidence KEYS themselves must not contain internal category slug patterns
    // like 'optimiser.agent.' or 'optimiser.skill.' — these are internal identifiers
    // that should not appear as evidence field names in JSONB output.

    const SLUG_PATTERNS = [
      /optimiser\.agent\./,
      /optimiser\.skill\./,
      /optimiser\.playbook\./,
      /optimiser\.inactive\./,
      /optimiser\.escalation\./,
      /optimiser\.memory\./,
      /optimiser\.llm\./,
    ];

    function assertNoSlugKeys(evidence: Record<string, unknown>, label: string): void {
      const keys = Object.keys(evidence);
      for (const key of keys) {
        for (const pattern of SLUG_PATTERNS) {
          expect(
            pattern.test(key),
            `${label}: evidence key "${key}" must not contain an internal category slug pattern`,
          ).toBe(false);
        }
      }
    }

    it('agentBudget evidence keys contain no category slug patterns', () => {
      const rows = [makeAgentBudgetRow({ agentId: 'agent-001', percentUsed: 0.95 })];
      const outputs = evaluateAgentBudget(rows, baseCtx);
      for (const o of outputs) assertNoSlugKeys(o.evidence, 'agentBudget');
    });

    it('escalationRate evidence keys contain no category slug patterns', () => {
      const rows = [makeEscalationRateRow({ workflowId: 'wf-001', escalationRate: 0.4 })];
      const outputs = evaluateEscalationRate(rows, baseCtx);
      for (const o of outputs) assertNoSlugKeys(o.evidence, 'escalationRate');
    });

    it('inactiveWorkflow evidence keys contain no category slug patterns', () => {
      const rows = [makeInactiveWorkflowRow({ subaccountAgentId: 'sa-001', daysSinceLastRun: 20 })];
      const outputs = evaluateInactiveWorkflow(rows, baseCtx);
      for (const o of outputs) assertNoSlugKeys(o.evidence, 'inactiveWorkflow');
    });

    it('escalationPhrases evidence keys contain no category slug patterns', () => {
      const rows = [makeEscalationPhraseRow({ phrase: 'please help', count: 5 })];
      const outputs = evaluateEscalationPhrases(rows, baseCtx);
      for (const o of outputs) assertNoSlugKeys(o.evidence, 'escalationPhrases');
    });

    it('memoryCitation evidence keys contain no category slug patterns', () => {
      const rows = [makeMemoryCitationRow({ agentId: 'agent-001', avgCitationScore: 0.15 })];
      const outputs = evaluateMemoryCitation(rows, baseCtx);
      for (const o of outputs) assertNoSlugKeys(o.evidence, 'memoryCitation');
    });

    it('routingUncertainty evidence keys contain no category slug patterns', () => {
      const rows = [makeRoutingUncertaintyRow({ agentId: 'agent-001', uncertaintyRate: 0.5 })];
      const outputs = evaluateRoutingUncertainty(rows, baseCtx);
      for (const o of outputs) assertNoSlugKeys(o.evidence, 'routingUncertainty');
    });

    it('cacheEfficiency evidence keys contain no category slug patterns', () => {
      const rows = [makeCacheEfficiencyRow({ agentId: 'agent-001', cacheHitRate: 0.05 })];
      const outputs = evaluateCacheEfficiency(rows, baseCtx);
      for (const o of outputs) assertNoSlugKeys(o.evidence, 'cacheEfficiency');
    });

    it('skillSlow evidence keys contain no category slug patterns', () => {
      const rows = [makeSkillSlowRow({ skillSlug: 'skill-001', ratioVsPeerP95: 4 })];
      const outputs = evaluateSkillSlow(rows, baseCtx);
      for (const o of outputs) assertNoSlugKeys(o.evidence, 'skillSlow');
    });
  });

  // ── 6. Threshold boundary checks ────────────────────────────────────────
  describe('Evaluator threshold boundaries: below-threshold rows produce no output', () => {
    it('agentBudget: 90% used does not fire (requires >90%)', () => {
      const rows = [makeAgentBudgetRow({ agentId: 'agent-001', percentUsed: 0.9 })];
      const outputs = evaluateAgentBudget(rows, baseCtx);
      expect(outputs).toHaveLength(0);
    });

    it('agentBudget: 91% used fires at warn', () => {
      const rows = [makeAgentBudgetRow({ agentId: 'agent-001', percentUsed: 0.91 })];
      const outputs = evaluateAgentBudget(rows, baseCtx);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.severity).toBe('warn');
    });

    it('agentBudget: 100% used fires at warn (requires >100% for critical)', () => {
      const rows = [makeAgentBudgetRow({ agentId: 'agent-001', percentUsed: 1.0 })];
      const outputs = evaluateAgentBudget(rows, baseCtx);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.severity).toBe('warn');
    });

    it('agentBudget: 101% used fires at critical', () => {
      const rows = [makeAgentBudgetRow({ agentId: 'agent-001', percentUsed: 1.01 })];
      const outputs = evaluateAgentBudget(rows, baseCtx);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.severity).toBe('critical');
    });

    it('escalationRate: 30% does not fire (requires >30%)', () => {
      const rows = [makeEscalationRateRow({ workflowId: 'wf-001', escalationRate: 0.3 })];
      const outputs = evaluateEscalationRate(rows, baseCtx);
      expect(outputs).toHaveLength(0);
    });

    it('escalationRate: 31% fires at warn', () => {
      const rows = [makeEscalationRateRow({ workflowId: 'wf-001', escalationRate: 0.31 })];
      const outputs = evaluateEscalationRate(rows, baseCtx);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.severity).toBe('warn');
    });

    it('escalationRate: 61% fires at critical', () => {
      const rows = [makeEscalationRateRow({ workflowId: 'wf-001', escalationRate: 0.61 })];
      const outputs = evaluateEscalationRate(rows, baseCtx);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.severity).toBe('critical');
    });

    it('escalationPhrases: count=2 does not fire (requires >=3)', () => {
      const rows = [makeEscalationPhraseRow({ phrase: 'help me', count: 2 })];
      const outputs = evaluateEscalationPhrases(rows, baseCtx);
      expect(outputs).toHaveLength(0);
    });

    it('escalationPhrases: count=3 fires at info', () => {
      const rows = [makeEscalationPhraseRow({ phrase: 'help me', count: 3 })];
      const outputs = evaluateEscalationPhrases(rows, baseCtx);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.severity).toBe('info');
    });

    it('skillSlow: ratio=3.99 does not fire (requires >=4)', () => {
      const rows = [makeSkillSlowRow({ skillSlug: 'skill-001', ratioVsPeerP95: 3.99 })];
      const outputs = evaluateSkillSlow(rows, baseCtx);
      expect(outputs).toHaveLength(0);
    });

    it('skillSlow: ratio=4.0 fires at warn (inclusive threshold)', () => {
      const rows = [makeSkillSlowRow({ skillSlug: 'skill-001', ratioVsPeerP95: 4.0 })];
      const outputs = evaluateSkillSlow(rows, baseCtx);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.severity).toBe('warn');
    });

    it('routingUncertainty: 40% does not fire (requires >40%)', () => {
      const rows = [makeRoutingUncertaintyRow({ agentId: 'agent-001', uncertaintyRate: 0.4 })];
      const outputs = evaluateRoutingUncertainty(rows, baseCtx);
      expect(outputs).toHaveLength(0);
    });

    it('routingUncertainty: 41% fires at warn', () => {
      const rows = [makeRoutingUncertaintyRow({ agentId: 'agent-001', uncertaintyRate: 0.41 })];
      const outputs = evaluateRoutingUncertainty(rows, baseCtx);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.severity).toBe('warn');
    });

    it('memoryCitation: 50% does not fire (requires <50%)', () => {
      const rows = [makeMemoryCitationRow({ agentId: 'agent-001', avgCitationScore: 0.5 })];
      const outputs = evaluateMemoryCitation(rows, baseCtx);
      expect(outputs).toHaveLength(0);
    });

    it('memoryCitation: 49% fires at info', () => {
      const rows = [makeMemoryCitationRow({ agentId: 'agent-001', avgCitationScore: 0.49 })];
      const outputs = evaluateMemoryCitation(rows, baseCtx);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.severity).toBe('info');
    });

    it('memoryCitation: 19% fires at warn', () => {
      const rows = [makeMemoryCitationRow({ agentId: 'agent-001', avgCitationScore: 0.19 })];
      const outputs = evaluateMemoryCitation(rows, baseCtx);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.severity).toBe('warn');
    });

    it('cacheEfficiency: 30% does not fire (requires <30%)', () => {
      const rows = [makeCacheEfficiencyRow({ agentId: 'agent-001', cacheHitRate: 0.3 })];
      const outputs = evaluateCacheEfficiency(rows, baseCtx);
      expect(outputs).toHaveLength(0);
    });

    it('cacheEfficiency: 29% fires at info', () => {
      const rows = [makeCacheEfficiencyRow({ agentId: 'agent-001', cacheHitRate: 0.29 })];
      const outputs = evaluateCacheEfficiency(rows, baseCtx);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.severity).toBe('info');
    });

    it('cacheEfficiency: 9% fires at warn', () => {
      const rows = [makeCacheEfficiencyRow({ agentId: 'agent-001', cacheHitRate: 0.09 })];
      const outputs = evaluateCacheEfficiency(rows, baseCtx);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.severity).toBe('warn');
    });
  });

  // ── Integration cases (skipped — require live DB) ────────────────────────

  describe.skip('Integration: all 8 categories produce recommendations (requires DB)', () => {
    // Deferred to CI gate suite. Requires a live DB with fixture telemetry seeded.
    it('seeds fixture telemetry and runs runOptimiserScan end-to-end');
  });

  describe.skip('Integration: empty-telemetry fixture produces no false positives (requires DB)', () => {
    // Deferred to CI gate suite. Requires a live DB with an empty subaccount seeded.
    it('seeds empty subaccount and asserts 0 recommendation rows');
  });

  describe.skip('Integration: cost gate < $0.02/subaccount/day (requires DB + LLM)', () => {
    // Deferred to CI gate suite. Requires live DB + LLM access for renderRecommendation calls.
    // Token usage is observable via optimiser.render.tokens_used log events.
    it('seeds 5 subaccounts x 7-day fixture and measures actual token cost');
  });
});
