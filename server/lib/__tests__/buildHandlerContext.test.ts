import { describe, expect, test, vi } from 'vitest';

// Mock the three service imports so the test runs without a real DB.
// This is a structural test — it verifies the returned object has the
// expected method shape, not that those methods produce correct results.
vi.mock('../../../server/services/workflowEngineService.js', () => ({
  WorkflowEngineService: {
    enqueueTick: vi.fn(),
    tick: vi.fn(),
    dispatchStep: vi.fn(),
  },
}));

vi.mock('../../../server/services/skillExecutor.js', () => ({
  skillExecutor: {
    execute: vi.fn(),
  },
}));

vi.mock('../../../server/services/workflowRunStartSkillService.js', () => ({
  handleWorkflowRunStartSkill: vi.fn(),
}));

import { buildHandlerContext } from '../buildHandlerContext.js';

describe('buildHandlerContext', () => {
  test('returns an object with workflowEngine methods', () => {
    const ctx = buildHandlerContext();
    expect(typeof ctx.workflowEngine.enqueueTick).toBe('function');
    expect(typeof ctx.workflowEngine.tick).toBe('function');
    expect(typeof ctx.workflowEngine.dispatchStep).toBe('function');
    expect(typeof ctx.workflowEngine.startWorkflowRun).toBe('function');
  });

  test('returns an object with skillExecutor.execute', () => {
    const ctx = buildHandlerContext();
    expect(typeof ctx.skillExecutor.execute).toBe('function');
  });

  test('workflowEngine and skillExecutor keys are the only top-level keys', () => {
    const ctx = buildHandlerContext();
    expect(Object.keys(ctx).sort()).toEqual(['skillExecutor', 'workflowEngine']);
  });
});
