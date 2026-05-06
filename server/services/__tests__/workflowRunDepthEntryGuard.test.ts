/**
 * workflowRunDepthEntryGuard.test.ts — depth contract entry guards
 *
 * Tests MissingWorkflowDepthError and InvalidWorkflowDepthError guard paths.
 * DB dependencies are mocked so no live database is needed.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/workflowRunDepthEntryGuard.test.ts
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../workflowRunService.js', () => ({
  WorkflowRunService: { startRun: vi.fn() },
}));

vi.mock('../workflowTemplateService.js', () => ({
  WorkflowTemplateService: { getOrgTemplate: vi.fn() },
}));

vi.mock('../taskService.js', () => ({
  taskService: { createTask: vi.fn() },
}));

vi.mock('../../db/index.js', () => ({
  db: {},
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

// depth null/undefined → throws MissingWorkflowDepthError
describe('MissingWorkflowDepthError', () => {
  it('depth=undefined throws MissingWorkflowDepthError', async () => {
    const ctx = makeContext({ workflowRunDepth: undefined });
    await expect(
      handleWorkflowRunStartSkill({ workflow_template_id: 'x' }, ctx),
    ).rejects.toThrow(MissingWorkflowDepthError);
  });

  it('depth=null throws MissingWorkflowDepthError', async () => {
    const ctx = makeContext({ workflowRunDepth: null as unknown as undefined });
    await expect(
      handleWorkflowRunStartSkill({ workflow_template_id: 'x' }, ctx),
    ).rejects.toThrow(MissingWorkflowDepthError);
  });
});

// depth < 1 → throws InvalidWorkflowDepthError
describe('InvalidWorkflowDepthError', () => {
  it('depth=0 throws InvalidWorkflowDepthError', async () => {
    const ctx = makeContext({ workflowRunDepth: 0 });
    await expect(
      handleWorkflowRunStartSkill({ workflow_template_id: 'x' }, ctx),
    ).rejects.toThrow(InvalidWorkflowDepthError);
  });

  it('depth=-1 throws InvalidWorkflowDepthError', async () => {
    const ctx = makeContext({ workflowRunDepth: -1 });
    await expect(
      handleWorkflowRunStartSkill({ workflow_template_id: 'x' }, ctx),
    ).rejects.toThrow(InvalidWorkflowDepthError);
  });
});

// depth in [1, MAX_WORKFLOW_DEPTH-1] — guard passes (proceeds to input validation)
describe('valid depth passes entry guard', () => {
  it('depth=1 passes entry guard', async () => {
    const ctx = makeContext({ workflowRunDepth: 1 });
    const result = await handleWorkflowRunStartSkill({}, ctx);
    expect(result).toMatchObject({ ok: false, error: 'inputs_invalid' });
  });

  it(`depth=${MAX_WORKFLOW_DEPTH - 1} passes entry guard`, async () => {
    const ctx = makeContext({ workflowRunDepth: MAX_WORKFLOW_DEPTH - 1 });
    const result = await handleWorkflowRunStartSkill({}, ctx);
    expect(result).toMatchObject({ ok: false, error: 'inputs_invalid' });
  });
});

// depth = MAX_WORKFLOW_DEPTH → overflow
describe('depth overflow', () => {
  it(`depth=${MAX_WORKFLOW_DEPTH} returns max_workflow_depth_exceeded`, async () => {
    const ctx = makeContext({ workflowRunDepth: MAX_WORKFLOW_DEPTH });
    const result = await handleWorkflowRunStartSkill({ workflow_template_id: 'x' }, ctx);
    expect(result).toMatchObject({ ok: false, error: 'max_workflow_depth_exceeded' });
  });
});
