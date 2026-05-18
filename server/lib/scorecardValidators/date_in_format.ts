import type { Validator, ValidatorContext, ValidatorResult } from './types.js';

// ISO 8601 / RFC 3339 pattern: YYYY-MM-DDTHH:MM:SS[.sss]Z or ±HH:MM offset.
// Also accepts date-only YYYY-MM-DD as a valid ISO 8601 subset.
const ISO8601_RE =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/;

export const validator: Validator = {
  slug: 'date_in_format',
  version: '1.0.0',
  kind: 'deterministic',
  parameterSchema: [
    {
      name: 'fieldName',
      type: 'string',
      required: true,
      description: 'Top-level field name to extract from JSON-parsed run output.',
    },
  ],
  async evaluate(ctx: ValidatorContext): Promise<ValidatorResult> {
    const fieldName = ctx.parameters['fieldName'] as string | undefined;
    if (!fieldName) {
      return {
        passed: false,
        score: 0.0,
        reasoning: 'Validator parameter "fieldName" is required.',
        evidence: { expected: 'non-empty fieldName string' },
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

    const value = String(parsed[fieldName]);
    if (ISO8601_RE.test(value)) {
      return {
        passed: true,
        score: 1.0,
        reasoning: `Field "${fieldName}" value "${value}" is a valid ISO 8601 date.`,
      };
    }

    return {
      passed: false,
      score: 0.0,
      reasoning: `Field "${fieldName}" value does not match ISO 8601 format.`,
      // Redaction policy §6.6: do not store raw field value — could carry PII (DOB, etc.).
      evidence: { field: fieldName, expected: 'ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)' },
    };
  },
};
