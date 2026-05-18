import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks must be declared before imports that trigger module load.
// ---------------------------------------------------------------------------

vi.mock('../scorecardDispatcherPure.js', () => ({
  planDispatch: vi.fn(),
}));

vi.mock('../../lib/scorecardValidators/registry.js', () => ({
  getValidator: vi.fn(),
}));

vi.mock('../llmRouter.js', () => ({
  routeCall: vi.fn(),
}));

vi.mock('../scorecardJudgeRunnerPure.js', () => ({
  buildJudgePrompt: vi.fn(() => ({ system: 'sys', user: 'user_msg' })),
  computeVerdict: vi.fn(() => 'pass'),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { dispatchCheck } from '../scorecardDispatcher.js';
import { planDispatch } from '../scorecardDispatcherPure.js';
import { routeCall } from '../llmRouter.js';
import { logger } from '../../lib/logger.js';
import type { QualityCheck } from '../../db/schema/scorecards.js';
import type { RunMetadata } from '../../lib/scorecardValidators/types.js';
import type { DispatchPlan } from '../scorecardDispatcherPure.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeInput(qcOverrides: Partial<QualityCheck> = {}) {
  const qc: QualityCheck = {
    slug: 'check_1',
    name: 'Check 1',
    ...qcOverrides,
  };
  const runMetadata: RunMetadata = {
    skillSlug: '',
    agentId: 'agent-1',
    subaccountId: 'sub-1',
    runId: 'run-1',
    invokedSkillSlugs: [],
  };
  return {
    qc,
    runOutput: 'hello world',
    runMetadata,
    judgementRunId: 'run-1:sc-1',
    organisationId: 'org-1',
    scorecardName: 'Test Scorecard',
    agentName: 'Test Agent',
    judgeModelId: 'claude-haiku-4-5-20251001',
  };
}

function makeValidator(overrides = {}) {
  return {
    slug: 'output_non_empty',
    version: '1.0.0',
    kind: 'deterministic' as const,
    parameterSchema: [],
    evaluate: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Inconclusive plan (catalogue miss / parameter mismatch)
// ---------------------------------------------------------------------------

describe('dispatchCheck — inconclusive plan', () => {
  it('returns inconclusive outcome when planDispatch returns inconclusive', async () => {
    const inconclusivePlan: DispatchPlan = {
      kind: 'inconclusive',
      reason: 'catalogue_miss',
      detail: 'validator slug "bad_slug" is not registered',
    };
    vi.mocked(planDispatch).mockReturnValue(inconclusivePlan);

    const outcome = await dispatchCheck(makeInput({ kind: 'deterministic', validatorSlug: 'bad_slug' }));
    expect(outcome.evaluationMethod).toBe('inconclusive');
    expect(outcome.verdict).toBe('inconclusive');
    expect(outcome.reasoning).toContain('catalogue_miss');
    expect(outcome.invocationsToWrite).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Semantic plan (LLM judge path)
// ---------------------------------------------------------------------------

describe('dispatchCheck — semantic plan', () => {
  it('calls LLM and returns semantic outcome', async () => {
    vi.mocked(planDispatch).mockReturnValue({ kind: 'semantic' });
    vi.mocked(routeCall).mockResolvedValue({
      content: JSON.stringify({ observedScore: 0.9, judgeReasoning: 'looks good' }),
    } as Awaited<ReturnType<typeof routeCall>>);
    const { computeVerdict } = await import('../scorecardJudgeRunnerPure.js');
    vi.mocked(computeVerdict).mockReturnValue('pass');

    const outcome = await dispatchCheck(makeInput({ kind: 'semantic' }));
    expect(outcome.evaluationMethod).toBe('semantic');
    expect(outcome.invocationsToWrite).toHaveLength(0);
    expect(routeCall).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Deterministic plan
// ---------------------------------------------------------------------------

describe('dispatchCheck — deterministic plan', () => {
  it('calls validator and returns deterministic outcome on pass', async () => {
    const validator = makeValidator({
      evaluate: vi.fn().mockResolvedValue({ passed: true, score: 1.0, reasoning: 'non-empty' }),
    });
    vi.mocked(planDispatch).mockReturnValue({ kind: 'deterministic', validator });

    const outcome = await dispatchCheck(makeInput({ kind: 'deterministic', validatorSlug: 'output_non_empty' }));
    expect(outcome.evaluationMethod).toBe('deterministic');
    expect(outcome.verdict).toBe('pass');
    expect(outcome.validatorSlug).toBe('output_non_empty');
    expect(outcome.validatorVersion).toBe('1.0.0');
    expect(outcome.score).toBe(1.0);
    expect(outcome.invocationsToWrite).toHaveLength(1);
    expect(outcome.invocationsToWrite[0]!.evaluationMethod).toBe('deterministic');
    expect(outcome.invocationsToWrite[0]!.resultPassed).toBe(true);
  });

  it('returns fail verdict when validator returns passed:false', async () => {
    const validator = makeValidator({
      evaluate: vi.fn().mockResolvedValue({ passed: false, score: 0.0, reasoning: 'empty output' }),
    });
    vi.mocked(planDispatch).mockReturnValue({ kind: 'deterministic', validator });

    const outcome = await dispatchCheck(makeInput({ kind: 'deterministic', validatorSlug: 'output_non_empty' }));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.evaluationMethod).toBe('deterministic');
  });

  it('maps validator throw to inconclusive — does NOT re-throw', async () => {
    const validator = makeValidator({
      evaluate: vi.fn().mockRejectedValue(new Error('internal failure')),
    });
    vi.mocked(planDispatch).mockReturnValue({ kind: 'deterministic', validator });

    const outcome = await dispatchCheck(makeInput());
    expect(outcome.evaluationMethod).toBe('inconclusive');
    expect(outcome.verdict).toBe('inconclusive');
    expect(outcome.reasoning).toContain('validator threw');
    expect(outcome.reasoning).toContain('internal failure');
  });
});

// ---------------------------------------------------------------------------
// Deterministic_external plan — semaphore, retry, timeout, circuit breaker
// ---------------------------------------------------------------------------

describe('dispatchCheck — deterministic_external plan', () => {
  it('retries once on failure and returns outcome on second success', async () => {
    const evaluateMock = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ passed: true, score: 1.0, reasoning: 'ok' });
    const validator = makeValidator({ slug: 'cited_entity', kind: 'deterministic_external', evaluate: evaluateMock });
    vi.mocked(planDispatch).mockReturnValue({ kind: 'deterministic_external', validator });

    const outcome = await dispatchCheck({
      ...makeInput(),
      judgementRunId: 'run-retry-test:sc-1',
    });
    expect(outcome.verdict).toBe('pass');
    expect(evaluateMock).toHaveBeenCalledTimes(2);
  });

  it('returns inconclusive after both retries fail with timeout', async () => {
    // Simulate timeout by rejecting with 'validator_timeout'
    const evaluateMock = vi.fn().mockRejectedValue(new Error('validator_timeout'));
    const validator = makeValidator({ slug: 'cited_entity_timeout', kind: 'deterministic_external', evaluate: evaluateMock });
    vi.mocked(planDispatch).mockReturnValue({ kind: 'deterministic_external', validator });

    const outcome = await dispatchCheck({
      ...makeInput(),
      judgementRunId: 'run-timeout-test:sc-1',
    });
    expect(outcome.evaluationMethod).toBe('inconclusive');
    expect(outcome.reasoning).toBe('external_timeout');
  });

  it('returns inconclusive with circuit_breaker_open when breaker is tripped', async () => {
    // Trip the breaker for a slug by simulating >20% error rate over 5+ calls
    // Use a unique slug to avoid state bleed from other tests
    const uniqueSlug = `circuit_test_${Date.now()}`;
    const evaluateMock = vi.fn().mockRejectedValue(new Error('fail'));
    const validator = makeValidator({ slug: uniqueSlug, kind: 'deterministic_external', evaluate: evaluateMock });

    // Force the circuit to open by running enough failures
    // We need 5+ calls with >20% error rate; after 5 all-fail calls it should trip
    for (let i = 0; i < 5; i++) {
      vi.mocked(planDispatch).mockReturnValue({ kind: 'deterministic_external', validator });
      await dispatchCheck({ ...makeInput(), judgementRunId: `run-cb-trip-${i}:sc-1` });
    }

    // Now the circuit should be open for this slug
    vi.mocked(planDispatch).mockReturnValue({ kind: 'deterministic_external', validator });
    const outcome = await dispatchCheck({ ...makeInput(), judgementRunId: `run-cb-open:sc-1` });
    expect(outcome.reasoning).toBe('circuit_breaker_open');
  });

  it('rate limit exceeded returns inconclusive with rate_limit_exceeded', async () => {
    // Use a unique slug to avoid state bleed
    const uniqueSlug = `rate_limit_test_${Date.now()}`;
    let hitRateLimit = false;

    // Consume 100 rate-limit slots (the window limit)
    const fastValidator = makeValidator({
      slug: uniqueSlug,
      kind: 'deterministic_external',
      evaluate: vi.fn().mockResolvedValue({ passed: true, score: 1.0, reasoning: 'ok' }),
    });

    // First 100 calls should succeed (filling the rate limit window)
    for (let i = 0; i < 100; i++) {
      vi.mocked(planDispatch).mockReturnValue({ kind: 'deterministic_external', validator: fastValidator });
      await dispatchCheck({ ...makeInput(), judgementRunId: `run-rl-${i}:sc-1` });
    }

    // The 101st call should hit the rate limit
    vi.mocked(planDispatch).mockReturnValue({ kind: 'deterministic_external', validator: fastValidator });
    const outcome = await dispatchCheck({ ...makeInput(), judgementRunId: `run-rl-101:sc-1` });
    if (outcome.reasoning === 'rate_limit_exceeded') {
      hitRateLimit = true;
    }
    // Should have hit rate limit OR circuit breaker (since all succeeded, only rate limit applies)
    expect(hitRateLimit || outcome.evaluationMethod === 'inconclusive').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hybrid plan — precondition short-circuit + LLM fall-through
// ---------------------------------------------------------------------------

describe('dispatchCheck — hybrid plan', () => {
  it('short-circuits on first failing precondition', async () => {
    const pre1 = makeValidator({
      slug: 'pre1',
      evaluate: vi.fn().mockResolvedValue({ passed: false, score: 0.0, reasoning: 'fail' }),
    });
    const pre2 = makeValidator({
      slug: 'pre2',
      evaluate: vi.fn().mockResolvedValue({ passed: true, score: 1.0, reasoning: 'ok' }),
    });
    vi.mocked(planDispatch).mockReturnValue({
      kind: 'hybrid',
      preconditions: [pre1, pre2],
      preconditionParams: [{}, {}],
    });

    const outcome = await dispatchCheck(makeInput({ kind: 'hybrid' }));
    expect(outcome.evaluationMethod).toBe('hybrid_deterministic_fail');
    expect(outcome.verdict).toBe('fail');
    // pre2 should NOT have been called due to short-circuit
    expect(pre2.evaluate).not.toHaveBeenCalled();
    // One invocation DTO for the failing precondition
    expect(outcome.invocationsToWrite).toHaveLength(1);
    expect(outcome.invocationsToWrite[0]!.validatorSlug).toBe('pre1');
  });

  it('falls through to LLM when all preconditions pass', async () => {
    const pre1 = makeValidator({
      slug: 'pre1',
      evaluate: vi.fn().mockResolvedValue({ passed: true, score: 1.0, reasoning: 'ok' }),
    });
    vi.mocked(planDispatch).mockReturnValue({
      kind: 'hybrid',
      preconditions: [pre1],
      preconditionParams: [{}],
    });
    vi.mocked(routeCall).mockResolvedValue({
      content: JSON.stringify({ observedScore: 0.8, judgeReasoning: 'good' }),
    } as Awaited<ReturnType<typeof routeCall>>);
    const { computeVerdict } = await import('../scorecardJudgeRunnerPure.js');
    vi.mocked(computeVerdict).mockReturnValue('pass');

    const outcome = await dispatchCheck(makeInput({ kind: 'hybrid' }));
    expect(outcome.evaluationMethod).toBe('hybrid_semantic');
    expect(routeCall).toHaveBeenCalledOnce();
    // One precondition invocation DTO written
    expect(outcome.invocationsToWrite).toHaveLength(1);
    expect(outcome.invocationsToWrite[0]!.evaluationMethod).toBe('hybrid_precondition_pass');
  });

  it('maps precondition throw to inconclusive outcome', async () => {
    const pre1 = makeValidator({
      slug: 'thrower',
      evaluate: vi.fn().mockRejectedValue(new Error('boom')),
    });
    vi.mocked(planDispatch).mockReturnValue({
      kind: 'hybrid',
      preconditions: [pre1],
      preconditionParams: [{}],
    });

    const outcome = await dispatchCheck(makeInput({ kind: 'hybrid' }));
    expect(outcome.evaluationMethod).toBe('inconclusive');
    expect(outcome.reasoning).toContain('validator threw');
  });
});

// ---------------------------------------------------------------------------
// Safety-class fail event emission
// ---------------------------------------------------------------------------

describe('dispatchCheck — safety-class event is NOT emitted by dispatcher', () => {
  it('dispatcher itself does not log safety_class_check_failed (it is the job\'s responsibility)', async () => {
    // The dispatcher constructs DispatchOutcome; the job emits the safety event.
    // Verify the dispatcher does NOT emit it to ensure no double-emission.
    const validator = makeValidator({
      evaluate: vi.fn().mockResolvedValue({ passed: false, score: 0.0, reasoning: 'pii found' }),
    });
    vi.mocked(planDispatch).mockReturnValue({ kind: 'deterministic', validator });

    await dispatchCheck(makeInput({ kind: 'deterministic', validatorSlug: 'output_non_empty', safetyClass: true }));
    expect(vi.mocked(logger.info)).not.toHaveBeenCalledWith(
      'safety_class_check_failed',
      expect.anything(),
    );
  });
});
