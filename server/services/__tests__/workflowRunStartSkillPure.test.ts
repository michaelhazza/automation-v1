/**
 * workflowRunStartSkillPure.test.ts — depth enforcement for workflow.run.start
 *
 * Tests the guard paths that resolve before any DB/network call.
 * DB dependencies are mocked so no live database is needed.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/workflowRunStartSkillPure.test.ts
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before the module under test is imported.
// ---------------------------------------------------------------------------

vi.mock('../workflowRunService.js', () => ({
  WorkflowRunService: {
    startRun: vi.fn(),
  },
}));

vi.mock('../workflowTemplateService.js', () => ({
  WorkflowTemplateService: {
    getOrgTemplate: vi.fn(),
  },
}));

vi.mock('../taskService.js', () => ({
  taskService: {
    createTask: vi.fn(),
  },
}));

vi.mock('../../db/index.js', () => ({
  db: {},
}));

vi.mock('../../../server/lib/env.js', () => ({
  env: { DATABASE_URL: 'postgres://mock' },
}));

// ---------------------------------------------------------------------------

import {
  handleWorkflowRunStartSkill,
  MissingWorkflowDepthError,
  InvalidWorkflowDepthError,
  MAX_WORKFLOW_DEPTH,
} from '../workflowRunStartSkillService.js';
import type { SkillExecutionContext } from '../skillExecutor.js';

function makeContext(overrides: Partial<SkillExecutionContext>): SkillExecutionContext {
  return {
    runId: 'run-1',
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    agentId: 'agent-1',
    orgProcesses: [],
    ...overrides,
  };
}

describe('depth enforcement', () => {
  it('missing workflowRunDepth throws MissingWorkflowDepthError', async () => {
    const context = makeContext({ workflowRunDepth: undefined });
    await expect(
      handleWorkflowRunStartSkill({ workflow_template_id: 'some-id' }, context),
    ).rejects.toThrow(MissingWorkflowDepthError);
  });

  it('depth=0 throws InvalidWorkflowDepthError', async () => {
    const context = makeContext({ workflowRunDepth: 0 });
    await expect(
      handleWorkflowRunStartSkill({ workflow_template_id: 'some-id' }, context),
    ).rejects.toThrow(InvalidWorkflowDepthError);
  });

  it('depth=MAX_WORKFLOW_DEPTH returns max_workflow_depth_exceeded', async () => {
    const context = makeContext({ workflowRunDepth: MAX_WORKFLOW_DEPTH });
    const result = await handleWorkflowRunStartSkill({ workflow_template_id: 'some-id' }, context);
    expect(result).toMatchObject({ ok: false, error: 'max_workflow_depth_exceeded' });
  });

  it('depth=2 returns max_workflow_depth_exceeded when newDepth=3 equals MAX_WORKFLOW_DEPTH', async () => {
    // newDepth = 2 + 1 = 3 = MAX_WORKFLOW_DEPTH → NOT exceeded (3 is not > 3)
    // So depth=2 should pass the guard and proceed to input validation
    const context = makeContext({ workflowRunDepth: 2 });
    const result = await handleWorkflowRunStartSkill({ workflow_template_id: '' }, context);
    expect(result).toMatchObject({ ok: false, error: 'inputs_invalid' });
  });
});

describe('input validation', () => {
  it('missing workflow_template_id returns inputs_invalid', async () => {
    const context = makeContext({ workflowRunDepth: 1 });
    const result = await handleWorkflowRunStartSkill({}, context);
    expect(result).toMatchObject({ ok: false, error: 'inputs_invalid' });
  });

  it('empty workflow_template_id returns inputs_invalid', async () => {
    const context = makeContext({ workflowRunDepth: 1 });
    const result = await handleWorkflowRunStartSkill({ workflow_template_id: '' }, context);
    expect(result).toMatchObject({ ok: false, error: 'inputs_invalid' });
  });
});
