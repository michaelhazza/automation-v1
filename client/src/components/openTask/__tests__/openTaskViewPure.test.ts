import { describe, expect, it } from 'vitest';
import { classifyTask, shouldAutoScroll } from '../openTaskViewPure.js';
import { INITIAL_TASK_PROJECTION } from '../../../../../shared/types/taskProjection.js';
import type { StepProjection } from '../../../../../shared/types/taskProjection.js';

function makeStep(stepId: string): StepProjection {
  return { stepId, stepType: 'action', status: 'completed' };
}

describe('openTaskViewPure', () => {
  it('classifyTask returns trivial for empty projection', () => {
    expect(classifyTask({ ...INITIAL_TASK_PROJECTION })).toBe('trivial');
  });

  it('classifyTask returns workflow_fired for projection with more than 3 steps', () => {
    const projection = {
      ...INITIAL_TASK_PROJECTION,
      steps: [makeStep('s1'), makeStep('s2'), makeStep('s3'), makeStep('s4')],
    };
    expect(classifyTask(projection)).toBe('workflow_fired');
  });

  it('shouldAutoScroll returns false when user is scrolled up', () => {
    expect(shouldAutoScroll(5, 6, true)).toBe(false);
  });
});
