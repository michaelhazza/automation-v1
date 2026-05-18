// Tests for the updated scorecardJudgeJob dispatcher integration.
// Verifies: dispatcher is called per check, evaluationMethod is set on the
// insert row, inconclusive threshold alert fires above the configured threshold,
// and safety_class_check_failed is emitted for safety-class failing checks.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../db/index.js', () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = { execute: vi.fn() };
      await fn(tx);
    }),
  },
}));

vi.mock('../../instrumentation.js', () => ({
  withOrgTx: vi.fn(async (_opts: unknown, fn: () => Promise<void>) => fn()),
}));

vi.mock('../../lib/orgScopedDb.js', () => ({
  getOrgScopedDb: vi.fn(() => mockScopedDb),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/pgBossTxSend.js', () => ({
  sendWithTx: vi.fn(),
}));

vi.mock('../../services/scorecardDispatcher.js', () => ({
  dispatchCheck: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Shared mock scoped DB (overridden per test)
// ---------------------------------------------------------------------------

const mockScopedDb = {
  select: vi.fn(),
};

import { scorecardJudgeJobHandler } from '../scorecardJudgeJob.js';
import { dispatchCheck } from '../../services/scorecardDispatcher.js';
import { logger } from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-00000000-0000-0000-0000-000000000001';
const RUN_ID = 'run-00000000-0000-0000-0000-000000000001';
const SC_ID = 'sc-00000000-0000-0000-0000-000000000001';
const CHECK_SLUG = 'output_non_empty';

const BASE_PAYLOAD = {
  runId: RUN_ID,
  scorecardId: SC_ID,
  qualityCheckSlug: CHECK_SLUG,
  triggerSource: 'sampled' as const,
  organisationId: ORG_ID,
};

function makeAgentRunRow() {
  return {
    run: {
      agentId: 'agent-1',
      subaccountId: 'sub-1',
      resolvedSkillSlugs: ['email', 'lookup'],
      summary: 'The agent responded to a billing inquiry.',
    },
    agentName: 'Test Agent',
  };
}

function makeScorecardRow(checks: Array<Record<string, unknown>> = [{ slug: CHECK_SLUG, name: 'Non empty', kind: 'deterministic', validatorSlug: 'output_non_empty' }]) {
  return {
    id: SC_ID,
    name: 'Test Scorecard',
    judgeModelId: null,
    inconclusiveAlertThreshold: '0.20',
    qualityChecks: checks,
    deletedAt: null,
  };
}

function setupSelectChain(rows: unknown[]) {
  const selectResult = {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
  return selectResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default dispatch outcome: deterministic pass
  vi.mocked(dispatchCheck).mockResolvedValue({
    evaluationMethod: 'deterministic',
    verdict: 'pass',
    validatorSlug: 'output_non_empty',
    validatorVersion: '1.0.0',
    score: 1.0,
    reasoning: 'non-empty',
    evidence: null,
    invocationsToWrite: [],
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scorecardJudgeJobHandler — dispatcher integration', () => {
  it('calls dispatchCheck with QualityCheck, RunMetadata, and organisationId', async () => {
    let selectCallCount = 0;
    mockScopedDb.select.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) return setupSelectChain([makeAgentRunRow()]);
      if (selectCallCount === 2) return setupSelectChain([makeScorecardRow()]);
      // verdict count query for threshold check
      if (selectCallCount === 3) {
        const result = {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([{ verdict: 'pass' }]),
        };
        return result;
      }
      return setupSelectChain([]);
    });

    // Mock insert
    (mockScopedDb as unknown as Record<string, unknown>).insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'judgement-1' }]),
    });

    await scorecardJudgeJobHandler({ data: BASE_PAYLOAD });

    expect(dispatchCheck).toHaveBeenCalledOnce();
    const callArg = vi.mocked(dispatchCheck).mock.calls[0]![0];
    expect(callArg.qc.slug).toBe(CHECK_SLUG);
    expect(callArg.organisationId).toBe(ORG_ID);
    expect(callArg.runMetadata.runId).toBe(RUN_ID);
    expect(callArg.runMetadata.invokedSkillSlugs).toEqual(['email', 'lookup']);
  });

  it('sets evaluationMethod on the inserted judgement row', async () => {
    let selectCallCount = 0;
    mockScopedDb.select.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) return setupSelectChain([makeAgentRunRow()]);
      if (selectCallCount === 2) return setupSelectChain([makeScorecardRow()]);
      const result = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ verdict: 'pass' }]),
      };
      return result;
    });

    let insertedRow: unknown;
    (mockScopedDb as unknown as Record<string, unknown>).insert = vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((row: unknown) => {
        insertedRow = row;
        return {
          onConflictDoNothing: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{ id: 'judgement-2' }]),
        };
      }),
    });

    await scorecardJudgeJobHandler({ data: BASE_PAYLOAD });

    expect((insertedRow as Record<string, unknown>).evaluationMethod).toBe('deterministic');
    expect((insertedRow as Record<string, unknown>).validatorSlug).toBe('output_non_empty');
    expect((insertedRow as Record<string, unknown>).validatorVersion).toBe('1.0.0');
  });

  it('emits inconclusive_threshold_exceeded when ratio exceeds threshold', async () => {
    // CHECK_SLUG must be one of the slugs so the job can find the quality check
    const checks = [
      { slug: CHECK_SLUG, name: 'Non Empty', kind: 'deterministic', validatorSlug: 'output_non_empty' },
      { slug: 'check_2', name: 'Check 2', kind: 'semantic' },
    ];

    let selectCallCount = 0;
    mockScopedDb.select.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) return setupSelectChain([makeAgentRunRow()]);
      if (selectCallCount === 2) return setupSelectChain([makeScorecardRow(checks)]);
      // Both checks now have verdicts; 1 is inconclusive → 0.5 > 0.20 threshold
      const result = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { verdict: 'inconclusive' },
          { verdict: 'pass' },
        ]),
      };
      return result;
    });

    (mockScopedDb as unknown as Record<string, unknown>).insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'judgement-3' }]),
    });

    await scorecardJudgeJobHandler({ data: BASE_PAYLOAD });

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'scorecard_judge.inconclusive_threshold_exceeded',
      expect.objectContaining({
        runId: RUN_ID,
        scorecardId: SC_ID,
        inconclusiveCount: 1,
        totalChecks: 2,
      }),
    );
  });

  it('does NOT emit threshold alert when inconclusive ratio is below threshold', async () => {
    let selectCallCount = 0;
    mockScopedDb.select.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) return setupSelectChain([makeAgentRunRow()]);
      if (selectCallCount === 2) return setupSelectChain([makeScorecardRow()]);
      // Only 1 check, 0 inconclusive → 0 / 1 = 0% < 20%
      const result = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ verdict: 'pass' }]),
      };
      return result;
    });

    (mockScopedDb as unknown as Record<string, unknown>).insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'judgement-4' }]),
    });

    await scorecardJudgeJobHandler({ data: BASE_PAYLOAD });

    const warnCalls = vi.mocked(logger.warn).mock.calls;
    const thresholdWarn = warnCalls.find(c => c[0] === 'scorecard_judge.inconclusive_threshold_exceeded');
    expect(thresholdWarn).toBeUndefined();
  });

  it('emits safety_class_check_failed when safetyClass check fails', async () => {
    const checks = [{ slug: CHECK_SLUG, name: 'PII Check', kind: 'deterministic', validatorSlug: 'pii_pattern_absent', safetyClass: true }];

    vi.mocked(dispatchCheck).mockResolvedValue({
      evaluationMethod: 'deterministic',
      verdict: 'fail',
      validatorSlug: 'pii_pattern_absent',
      validatorVersion: '1.0.0',
      score: 0.0,
      reasoning: 'PII detected',
      evidence: null,
      invocationsToWrite: [],
    });

    let selectCallCount = 0;
    mockScopedDb.select.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) return setupSelectChain([makeAgentRunRow()]);
      if (selectCallCount === 2) return setupSelectChain([makeScorecardRow(checks)]);
      const result = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ verdict: 'fail' }]),
      };
      return result;
    });

    (mockScopedDb as unknown as Record<string, unknown>).insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'judgement-5' }]),
    });

    await scorecardJudgeJobHandler({
      data: { ...BASE_PAYLOAD, qualityCheckSlug: CHECK_SLUG },
    });

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      'safety_class_check_failed',
      expect.objectContaining({
        scorecardId: SC_ID,
        runId: RUN_ID,
      }),
    );
  });

  it('does NOT emit safety_class_check_failed when safety check passes', async () => {
    const checks = [{ slug: CHECK_SLUG, name: 'PII Check', kind: 'deterministic', validatorSlug: 'pii_pattern_absent', safetyClass: true }];

    // verdict is 'pass' — no event
    vi.mocked(dispatchCheck).mockResolvedValue({
      evaluationMethod: 'deterministic',
      verdict: 'pass',
      validatorSlug: 'pii_pattern_absent',
      validatorVersion: '1.0.0',
      score: 1.0,
      reasoning: 'no PII',
      evidence: null,
      invocationsToWrite: [],
    });

    let selectCallCount = 0;
    mockScopedDb.select.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) return setupSelectChain([makeAgentRunRow()]);
      if (selectCallCount === 2) return setupSelectChain([makeScorecardRow(checks)]);
      const result = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ verdict: 'pass' }]),
      };
      return result;
    });

    (mockScopedDb as unknown as Record<string, unknown>).insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'judgement-6' }]),
    });

    await scorecardJudgeJobHandler({
      data: { ...BASE_PAYLOAD, qualityCheckSlug: CHECK_SLUG },
    });

    const infoCalls = vi.mocked(logger.info).mock.calls;
    const safetyEvent = infoCalls.find(c => c[0] === 'safety_class_check_failed');
    expect(safetyEvent).toBeUndefined();
  });
});
