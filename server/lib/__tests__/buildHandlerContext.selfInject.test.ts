import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/workflowEngineService.js', () => ({
  WorkflowEngineService: { enqueueTick: vi.fn(), tick: vi.fn(), dispatchStep: vi.fn() },
}));

vi.mock('../../services/workflowRunStartSkillService.js', () => ({
  handleWorkflowRunStartSkill: vi.fn(),
}));

vi.mock('../../services/skillExecutor.js', () => ({
  skillExecutor: {
    execute: vi.fn().mockResolvedValue({ success: true }),
  },
}));

import { buildHandlerContext } from '../buildHandlerContext.js';
import { skillExecutor } from '../../services/skillExecutor.js';

const mockExecute = skillExecutor.execute as ReturnType<typeof vi.fn>;

describe('buildHandlerContext — skillExecutor self-injection', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('auto-injects handlerContext into execute calls so callers never need to forward it', async () => {
    const ctx = buildHandlerContext();
    const params = {
      skillName: 'workflow.run.start',
      input: { workflowId: 'w1' },
      context: {} as never,
    };

    await ctx.skillExecutor.execute(params);

    expect(mockExecute).toHaveBeenCalledOnce();
    const forwarded = mockExecute.mock.calls[0][0];
    expect(forwarded.handlerContext).toBe(ctx);
    expect(forwarded.skillName).toBe('workflow.run.start');
  });

  it('overwrites any explicit handlerContext the caller passes', async () => {
    const ctx = buildHandlerContext();
    const otherCtx = {} as never;
    const params = {
      skillName: 'some.skill',
      input: {},
      context: {} as never,
      handlerContext: otherCtx,
    };

    await ctx.skillExecutor.execute(params);

    const forwarded = mockExecute.mock.calls[0][0];
    expect(forwarded.handlerContext).toBe(ctx);
  });
});
