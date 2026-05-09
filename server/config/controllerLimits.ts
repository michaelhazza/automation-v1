import type { ControllerStyle, ControllerLimits } from '../../shared/types/controllerStyle.js';

export const CONTROLLER_LIMITS: Record<ControllerStyle, ControllerLimits> = {
  native: {
    maxLoopIterations: 25,
    defaultTokenBudgetMultiplier: 1.0,
    maxToolCallsPerRun: 20,
    approvalDefault: 'auto',
  },
  operator: {
    maxLoopIterations: 100,
    defaultTokenBudgetMultiplier: 2.0,
    maxToolCallsPerRun: 80,
    approvalDefault: 'review',
  },
};
