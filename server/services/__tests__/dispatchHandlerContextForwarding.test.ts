/**
 * Verifies that dispatchStep forwards its handlerContext argument into
 * executeActionCall. This is the load-bearing assertion for the CD1 cycle-break:
 * executeActionCall must receive handlerContext, not a direct skillExecutor import.
 *
 * All DB and network calls are stubbed at the module boundary.
 *
 * Path notes: this file is at server/services/__tests__/. All vi.mock paths
 * are resolved relative to THIS file (not relative to the module under test).
 *   '../X.js'         → server/services/X.js
 *   '../../X.js'      → server/X.js
 *   '../workflowEngine/X.js' → server/services/workflowEngine/X.js
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://placeholder/skip';
process.env.JWT_SECRET ??= 'skip-placeholder-jwt';
process.env.EMAIL_FROM ??= 'skip@placeholder.example';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HandlerContext } from '../handlerContextTypes.js';

// ── Hoist spy so it is available in the vi.mock factory (which is statically hoisted) ──
const executeActionCallSpy = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    status: 'approved_and_executed',
    actionId: 'act-1',
    output: {},
  }),
);

// ── Module mocks ──────────────────────────────────────────────────────────────
// Each path resolves relative to this test file (server/services/__tests__/).

vi.mock('../../db/index.js', () => ({  // → server/db/index.js
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../../lib/logger.js', () => ({  // → server/lib/logger.js
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../taskEventService.js', () => ({  // → server/services/taskEventService.js
  appendAndEmitTaskEvent: vi.fn(),
}));

vi.mock('../../lib/pgBossInstance.js', () => ({  // → server/lib/pgBossInstance.js
  getPgBoss: vi.fn().mockResolvedValue({
    send: vi.fn().mockResolvedValue('job-id'),
  }),
}));

vi.mock('../../config/jobConfig.js', () => ({  // → server/config/jobConfig.js
  getJobConfig: vi.fn().mockReturnValue({}),
}));

vi.mock('../workflowStepReviewService.js', () => ({  // → server/services/workflowStepReviewService.js
  WorkflowStepReviewService: { requireApproval: vi.fn() },
}));

vi.mock('../workflowStepGateService.js', () => ({  // → server/services/workflowStepGateService.js
  WorkflowStepGateService: { getOpenGate: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../invokeAutomationStepService.js', () => ({  // → server/services/invokeAutomationStepService.js
  invokeAutomationStep: vi.fn(),
}));

vi.mock('../workflowEngineServicePure.js', () => ({  // → server/services/workflowEngineServicePure.js
  shouldDiscardWriteForInvalidation: vi.fn().mockReturnValue(false),
}));

vi.mock('../workflowEngine/constants.js', () => ({  // → server/services/workflowEngine/constants.js
  AGENT_STEP_QUEUE: 'workflow-agent-step',
  enqueueTick: vi.fn().mockResolvedValue(undefined),
  MAX_PARALLEL_STEPS_DEFAULT: 4,
}));

vi.mock('../workflowEngine/stepLifecycle.js', () => ({  // → server/services/workflowEngine/stepLifecycle.js
  computeDownstreamSet: vi.fn().mockReturnValue([]),
  computeCriticalPath: vi.fn().mockReturnValue(0),
  estimateCascadeCostCents: vi.fn().mockReturnValue(0),
  failStepRunInternal: vi.fn().mockResolvedValue(undefined),
  replayDispatch: vi.fn().mockResolvedValue(undefined),
  completeStepRunInternal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../workflowEngine/definitionHelpers.js', () => ({  // → server/services/workflowEngine/definitionHelpers.js
  loadDefinitionForRun: vi.fn(),
  findStepInDefinition: vi.fn(),
}));

vi.mock('../workflowEngine/contextHelpers.js', () => ({  // → server/services/workflowEngine/contextHelpers.js
  withInvalidationGuard: vi.fn().mockImplementation(
    async (_id: string, fn: () => Promise<unknown>) => fn(),
  ),
  shouldSuppressWebSocket: vi.fn().mockReturnValue(false),
}));

vi.mock('../workflowEngine/readySet.js', () => ({  // → server/services/workflowEngine/readySet.js
  emitWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/workflow/hash.js', () => ({  // → server/lib/workflow/hash.js
  hashValue: vi.fn().mockReturnValue('hash-abc'),
}));

vi.mock('../../lib/workflow/templating.js', () => ({  // → server/lib/workflow/templating.js
  renderString: vi.fn().mockImplementation((s: string) => s),
  resolveInputs: vi.fn().mockImplementation((inputs: unknown) => inputs),
  TemplatingError: class TemplatingError extends Error {
    reason = 'test';
    expression = 'test';
  },
}));

vi.mock('../../lib/workflow/agentDecisionEnvelope.js', () => ({  // → server/lib/workflow/agentDecisionEnvelope.js
  renderAgentDecisionEnvelope: vi.fn().mockReturnValue('envelope'),
}));

vi.mock('../../config/limits.js', () => ({  // → server/config/limits.js
  DEFAULT_DECISION_STEP_TIMEOUT_SECONDS: 60,
}));

vi.mock('../../config/actionRegistry.js', () => ({  // → server/config/actionRegistry.js
  SPEND_ACTION_ALLOWED_SLUGS: [],
}));

// The spy is hoisted above; safe to reference in the factory.
vi.mock('../workflowActionCallExecutor.js', () => ({  // → server/services/workflowActionCallExecutor.js
  executeActionCall: executeActionCallSpy,
  resolveConfigurationAssistantAgentId: vi.fn().mockResolvedValue('agent-config-1'),
  ActionTimeoutError: class ActionTimeoutError extends Error {},
}));

// ── Module under test — imported after all vi.mock calls ─────────────────────
const { dispatchStep } = await import('../workflowEngine/queueLifecycle/dispatch.js');

// ── DB stub helpers ───────────────────────────────────────────────────────────

const { db } = await import('../../db/index.js');

/** Creates a thenable drizzle-like query chain that resolves to `rows`. */
function makeSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.innerJoin = () => chain;
  chain.limit = () => Promise.resolve(rows);
  chain.then = (
    resolve: (v: unknown) => void,
    reject?: (e: unknown) => void,
  ) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {};
  chain.set = () => chain;
  chain.where = () => Promise.resolve(undefined);
  return chain;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const STEP_RUN_ID = 'sr-0001';
const RUN_ID = 'run-0001';
const ORG_ID = 'org-0001';
const SUB_ID = 'sub-0001';

function makeRun() {
  return {
    id: RUN_ID,
    organisationId: ORG_ID,
    subaccountId: SUB_ID,
    status: 'running',
    replayMode: false,
    runMode: 'normal',
    contextJson: { input: {}, steps: {}, _meta: {} },
    taskId: null,
    effectiveCostCeilingCents: null,
    effectiveWallClockCapSeconds: null,
  };
}

function makeStep() {
  return {
    id: 'step-1',
    type: 'action_call' as const,
    name: 'Test action',
    dependsOn: [],
    sideEffectType: 'idempotent' as const,
    actionSlug: 'config_create_agent',
    actionInputs: { foo: 'bar' },
    params: {},
  };
}

function makeDef() {
  return {
    steps: [makeStep()],
    maxParallelSteps: 4,
  };
}

function makeStepRun() {
  return {
    id: STEP_RUN_ID,
    stepId: 'step-1',
    runId: RUN_ID,
    status: 'pending' as const,
    attempt: 1,
    version: 0,
    stepType: 'action_call' as const,
    sideEffectType: 'idempotent' as const,
  };
}

function makeHandlerContext(): HandlerContext {
  return {
    workflowEngine: {
      enqueueTick: vi.fn().mockResolvedValue(undefined),
      tick: vi.fn().mockResolvedValue(undefined),
      dispatchStep: vi.fn().mockResolvedValue(undefined),
      startWorkflowRun: vi.fn().mockResolvedValue({}),
    },
    skillExecutor: {
      execute: vi.fn().mockResolvedValue({ success: true }),
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('dispatchStep handlerContext forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeActionCallSpy.mockResolvedValue({
      status: 'approved_and_executed',
      actionId: 'act-1',
      output: {},
    });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(makeUpdateChain());
  });

  it('forwards handlerContext to executeActionCall for action_call steps', async () => {
    const run = makeRun();
    const step = makeStep();
    const def = makeDef();
    const sr = makeStepRun();
    const hc = makeHandlerContext();

    // DB select call sequence in dispatchStep's action_call branch:
    //   1. findReusableOutputForStep — empty rows (no reuse)
    //   2. Pre-call invalidation guard — status 'running' (not discarded)
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([{ status: 'running' }]));

    await dispatchStep(run as never, def as never, step as never, [sr as never], hc);

    // Load-bearing assertion: executeActionCall received hc as its second argument.
    expect(executeActionCallSpy).toHaveBeenCalledOnce();
    const [, receivedHandlerContext] = executeActionCallSpy.mock.calls[0];
    expect(receivedHandlerContext).toBe(hc);
  });
});
