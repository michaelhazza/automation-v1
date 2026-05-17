/**
 * registry.handlerContextForwarding.test.ts
 *
 * Asserts that skillExecutor.execute forwards handlerContext to handlers and
 * that the 'workflow.run.start' handler routes through
 * handlerContext.workflowEngine.startWorkflowRun (no dynamic import).
 *
 * Runnable via:
 *   npx vitest run server/services/skillExecutor/__tests__/registry.handlerContextForwarding.test.ts
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks — must be hoisted before imports of the module under test.
// ---------------------------------------------------------------------------

vi.mock('../handlers/web.js', () => ({
  executeWebSearch: vi.fn(),
  executeFetchUrl: vi.fn(),
  executeScrapeUrl: vi.fn(),
  executeScrapeStructured: vi.fn(),
  executeMonitorWebpage: vi.fn(),
  executeCaptureScreenshot: vi.fn(),
  executeRunPlaywrightTest: vi.fn(),
  executeAnalyzeEndpoint: vi.fn(),
}));

vi.mock('../handlers/workspace.js', () => ({
  executeReadWorkspace: vi.fn(),
  executeWriteWorkspace: vi.fn(),
}));

vi.mock('../handlers/tasks.js', () => ({
  executeCreateTask: vi.fn(),
  executeTriageIntake: vi.fn(),
  executeMoveTask: vi.fn(),
  executeAddDeliverable: vi.fn(),
  executeUpdateTask: vi.fn(),
  executeReassignTask: vi.fn(),
  executeReadInbox: vi.fn(),
  executeReportBug: vi.fn(),
}));

vi.mock('../handlers/handoff.js', () => ({
  executeSpawnSubAgents: vi.fn(),
  executeTriggerProcess: vi.fn(),
}));

vi.mock('../handlers/devContext.js', () => ({
  executeReadCodebase: vi.fn(),
  executeSearchCodebase: vi.fn(),
  executeRunTests: vi.fn(),
  proposeDevopsAction: vi.fn(),
  executeAnalyzeEndpoint: vi.fn(),
}));

vi.mock('../handlers/workflowStudio.js', () => ({
  executeWorkflowReadExisting: vi.fn(),
  executeWorkflowValidate: vi.fn(),
  executeWorkflowSimulate: vi.fn(),
  executeWorkflowEstimateCost: vi.fn(),
  executeWorkflowProposeSave: vi.fn(),
  executeImportN8nWorkflow: vi.fn(),
}));

vi.mock('../handlers/skillStudio.js', () => ({ skillStudioHandlers: {} }));
vi.mock('../handlers/methodologyStubs.js', () => ({ methodologyStubHandlers: {} }));
vi.mock('../handlers/autoGatedStubs.js', () => ({ autoGatedStubHandlers: {} }));
vi.mock('../handlers/reviewGatedProposers.js', () => ({ reviewGatedProposerHandlers: {} }));
vi.mock('../handlers/thinDispatchers.js', () => ({ thinDispatcherHandlers: {} }));
vi.mock('../handlers/systemMonitorShells.js', () => ({ systemMonitorShellHandlers: {} }));
vi.mock('../handlers/optimiserShells.js', () => ({ optimiserShellHandlers: {} }));
vi.mock('../handlers/spendShells.js', () => ({ spendShellHandlers: {} }));
vi.mock('../handlers/configShells.js', () => ({ configShellHandlers: {} }));
vi.mock('../handlers/memory.js', () => ({ memoryHandlers: {} }));
vi.mock('../handlers/support.js', () => ({ supportHandlers: {} }));
vi.mock('../handlers/calendar.js', () => ({ calendarHandlers: {} }));
vi.mock('../handlers/slack.js', () => ({ slackHandlers: {} }));
vi.mock('../handlers/meta.js', () => ({ metaHandlers: {} }));
vi.mock('../handlers/capabilityDiscovery.js', () => ({ capabilityDiscoveryHandlers: {} }));
vi.mock('../handlers/crm.js', () => ({ crmHandlers: {} }));
vi.mock('../handlers/orgInsights.js', () => ({ orgInsightHandlers: {} }));
vi.mock('../handlers/output.js', () => ({ outputHandlers: {} }));
vi.mock('../handlers/threadContext.js', () => ({ threadContextHandlers: {} }));
vi.mock('../handlers/notifyOperator.js', () => ({ notifyOperatorHandlers: {} }));
vi.mock('../handlers/mediaTranscription.js', () => ({ mediaTranscriptionHandlers: {} }));
vi.mock('../handlers/digest.js', () => ({ digestHandlers: {} }));
vi.mock('../handlers/memoryBlock.js', () => ({ memoryBlockHandlers: {} }));
vi.mock('../handlers/financialReporting.js', () => ({ financialReportingHandlers: {} }));
vi.mock('../gating.js', () => ({
  executeWithActionAudit: vi.fn(),
  proposeReviewGatedAction: vi.fn(),
}));
vi.mock('../../agentExecutionEventEmitter.js', () => ({
  tryEmitAgentEvent: vi.fn(),
  emitAgentEvent: vi.fn(),
}));

// ---------------------------------------------------------------------------

import { skillExecutor } from '../registry.js';
import type { SkillExecutionContext } from '../context.js';
import type { HandlerContext } from '../../handlerContextTypes.js';

function makeContext(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    runId: 'run-1',
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    agentId: 'agent-1',
    orgProcesses: [],
    ...overrides,
  };
}

function makeHandlerContext(): HandlerContext & { startWorkflowRunMock: ReturnType<typeof vi.fn> } {
  const startWorkflowRunMock = vi.fn().mockResolvedValue({ ok: true });
  return {
    workflowEngine: {
      enqueueTick: vi.fn(),
      tick: vi.fn(),
      dispatchStep: vi.fn(),
      startWorkflowRun: startWorkflowRunMock,
    },
    skillExecutor: {
      execute: vi.fn(),
    },
    startWorkflowRunMock,
  };
}

describe('skillExecutor.execute — handlerContext forwarding', () => {
  it('routes workflow.run.start through handlerContext.workflowEngine.startWorkflowRun', async () => {
    const input = { workflow_template_id: 'tmpl-abc' };
    const context = makeContext({ workflowRunDepth: 1 });
    const hctx = makeHandlerContext();

    await skillExecutor.execute({
      skillName: 'workflow.run.start',
      input,
      context,
      handlerContext: hctx,
    });

    expect(hctx.startWorkflowRunMock).toHaveBeenCalledOnce();
    expect(hctx.startWorkflowRunMock).toHaveBeenCalledWith(input, context);
  });

  it('returns error for unknown skill without calling handlerContext', async () => {
    const hctx = makeHandlerContext();
    const context = makeContext();

    const result = await skillExecutor.execute({
      skillName: 'unknown.skill.xyz',
      input: {},
      context,
      handlerContext: hctx,
    });

    expect(result).toMatchObject({ success: false, error: 'Unknown skill: unknown.skill.xyz' });
    expect(hctx.startWorkflowRunMock).not.toHaveBeenCalled();
  });
});
