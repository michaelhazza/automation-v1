import type { Validator, ValidatorContext, ValidatorResult } from './types.js';

// Token approximation: ~4 chars per token (GPT-3.5/4 heuristic).
// Version pinned: approximation-v1 (see output_length_within_bounds.md).
const CHARS_PER_TOKEN = 4;

export const validator: Validator = {
  slug: 'output_length_within_bounds',
  version: '1.0.0',
  kind: 'deterministic',
  parameterSchema: [
    {
      name: 'min',
      type: 'number',
      required: true,
      default: 0,
      description: 'Minimum length (inclusive). Defaults to 0.',
      uiHint: 'number-range',
      validation: { min: 0 },
    },
    {
      name: 'max',
      type: 'number',
      required: true,
      description: 'Maximum length (inclusive).',
      uiHint: 'number-range',
      validation: { min: 0 },
    },
    {
      name: 'unit',
      type: 'string',
      required: false,
      default: 'chars',
      description: 'Measurement unit: "chars" (default) or "tokens" (approximate, ~4 chars/token).',
      validation: { enum: ['chars', 'tokens'] },
    },
  ],
  async evaluate(ctx: ValidatorContext): Promise<ValidatorResult> {
    const min = Number(ctx.parameters['min'] ?? 0);
    const max = Number(ctx.parameters['max']);
    const unit = (ctx.parameters['unit'] as string | undefined) ?? 'chars';

    if (isNaN(max)) {
      return {
        passed: false,
        score: 0.0,
        reasoning: 'Validator parameter "max" is required and must be a number.',
        evidence: { expected: 'numeric max parameter' },
      };
    }

    const charCount = ctx.runOutput.length;
    const measured = unit === 'tokens' ? Math.ceil(charCount / CHARS_PER_TOKEN) : charCount;
    const passed = measured >= min && measured <= max;

    if (passed) {
      return {
        passed: true,
        score: 1.0,
        reasoning: `Output ${unit} count (${measured}) is within bounds [${min}, ${max}].`,
      };
    }

    return {
      passed: false,
      score: 0.0,
      reasoning: `Output ${unit} count (${measured}) is outside bounds [${min}, ${max}].`,
      evidence: { field: unit === 'tokens' ? 'tokenCount' : 'charCount', expected: [min, max], actual: measured },
    };
  },
};
