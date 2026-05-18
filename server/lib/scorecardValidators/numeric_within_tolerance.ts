import type { Validator, ValidatorContext, ValidatorResult } from './types.js';

export const validator: Validator = {
  slug: 'numeric_within_tolerance',
  version: '1.0.0',
  kind: 'deterministic',
  parameterSchema: [
    {
      name: 'fieldName',
      type: 'string',
      required: true,
      description: 'Top-level field name to extract from JSON-parsed run output.',
    },
    {
      name: 'min',
      type: 'number',
      required: true,
      description: 'Minimum acceptable value (inclusive).',
      uiHint: 'number-range',
    },
    {
      name: 'max',
      type: 'number',
      required: true,
      description: 'Maximum acceptable value (inclusive).',
      uiHint: 'number-range',
    },
  ],
  async evaluate(ctx: ValidatorContext): Promise<ValidatorResult> {
    const fieldName = ctx.parameters['fieldName'] as string | undefined;
    const min = Number(ctx.parameters['min']);
    const max = Number(ctx.parameters['max']);

    if (!fieldName) {
      return {
        passed: false,
        score: 0.0,
        reasoning: 'Validator parameter "fieldName" is required.',
        evidence: { expected: 'non-empty fieldName string' },
      };
    }
    if (isNaN(min) || isNaN(max)) {
      return {
        passed: false,
        score: 0.0,
        reasoning: 'Validator parameters "min" and "max" must be numbers.',
        evidence: { expected: 'numeric min and max' },
      };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(ctx.runOutput) as Record<string, unknown>;
    } catch {
      return {
        passed: false,
        score: 0.0,
        reasoning: 'Run output is not valid JSON.',
        evidence: { field: fieldName, expected: 'valid JSON object' },
      };
    }

    if (!(fieldName in parsed)) {
      return {
        passed: false,
        score: 0.0,
        reasoning: `Field "${fieldName}" not found in run output.`,
        evidence: { field: fieldName, expected: 'field present in JSON output' },
      };
    }

    const value = Number(parsed[fieldName]);
    if (isNaN(value)) {
      return {
        passed: false,
        score: 0.0,
        reasoning: `Field "${fieldName}" value is not numeric.`,
        // Redaction policy §6.6: do not store raw field content — could carry sensitive data.
        evidence: { field: fieldName, expected: 'numeric value' },
      };
    }

    const passed = value >= min && value <= max;
    if (passed) {
      return {
        passed: true,
        score: 1.0,
        reasoning: `Field "${fieldName}" value ${value} is within [${min}, ${max}].`,
      };
    }

    return {
      passed: false,
      score: 0.0,
      reasoning: `Field "${fieldName}" value ${value} is outside [${min}, ${max}].`,
      evidence: { field: fieldName, expected: [min, max], actual: value },
    };
  },
};
