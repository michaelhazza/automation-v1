import type { SkillHandler } from '../context.js';

export const methodologyHandlers: Record<string, SkillHandler> = {
  generic_methodology: async (input) => {
    const skillName = typeof input.skillName === 'string' ? input.skillName : 'unknown';
    return {
      success: true,
      skillName,
      guidance: 'Follow the methodology instructions in your skill context to complete this task.',
    };
  },
};
