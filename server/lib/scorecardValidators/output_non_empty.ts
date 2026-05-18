import type { Validator, ValidatorContext, ValidatorResult } from './types.js';

export const validator: Validator = {
  slug: 'output_non_empty',
  version: '1.0.0',
  kind: 'deterministic',
  parameterSchema: [],
  async evaluate(ctx: ValidatorContext): Promise<ValidatorResult> {
    const trimmed = ctx.runOutput.trim();
    const passed = trimmed.length > 0;
    if (passed) {
      return { passed: true, score: 1.0, reasoning: 'Output is non-empty.' };
    }
    return {
      passed: false,
      score: 0.0,
      reasoning: 'Output is empty or whitespace-only.',
      evidence: { actual: ctx.runOutput },
    };
  },
};
