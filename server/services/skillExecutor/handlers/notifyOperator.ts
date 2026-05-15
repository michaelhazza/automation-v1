import type { SkillHandler } from '../context.js';
import { proposeReviewGatedAction } from '../gating.js';

export const notifyOperatorHandlers: Record<string, SkillHandler> = {
  notify_operator: async (input, context) => {
    return proposeReviewGatedAction('notify_operator', input, context);
  },
};
