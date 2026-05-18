import Ajv2020 from 'ajv/dist/2020.js';
import type { Validator, ValidatorContext, ValidatorResult } from './types.js';

const ajv = new Ajv2020({ allErrors: true });

export const validator: Validator = {
  slug: 'output_schema_valid',
  version: '1.0.0',
  kind: 'deterministic',
  parameterSchema: [
    {
      name: 'schema',
      type: 'object',
      required: true,
      description: 'JSON Schema 2020-12 document the output must validate against.',
      uiHint: 'json-schema',
    },
  ],
  async evaluate(ctx: ValidatorContext): Promise<ValidatorResult> {
    const schema = ctx.parameters['schema'];
    if (schema === null || schema === undefined || typeof schema !== 'object') {
      return {
        passed: false,
        score: 0.0,
        reasoning: 'Validator parameter "schema" is missing or not an object.',
        evidence: { expected: 'a JSON Schema object', actual: schema },
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(ctx.runOutput);
    } catch (e) {
      return {
        passed: false,
        score: 0.0,
        reasoning: 'Run output is not valid JSON.',
        evidence: { schemaErrors: [{ message: String(e) }] },
      };
    }

    let validateFn: ReturnType<typeof ajv.compile>;
    try {
      validateFn = ajv.compile(schema as object);
    } catch (e) {
      return {
        passed: false,
        score: 0.0,
        reasoning: `Schema compilation failed: ${String(e)}`,
        evidence: { schemaErrors: [{ message: String(e) }] },
      };
    }

    const valid = validateFn(parsed);
    if (valid) {
      return { passed: true, score: 1.0, reasoning: 'Output validates against the provided JSON Schema.' };
    }

    const errors = validateFn.errors ?? [];
    // Keep evidence under 4 KB: cap at 20 errors.
    const capped = errors.slice(0, 20);
    const truncated = errors.length > 20;
    const schemaErrors = capped.map((e) => ({
      instancePath: e.instancePath,
      keyword: e.keyword,
      message: e.message ?? 'unknown',
    }));

    const evidence: ValidatorContext['parameters'] = { schemaErrors, errorCount: errors.length };
    if (truncated) {
      evidence['_truncated'] = true;
    }

    return {
      passed: false,
      score: 0.0,
      reasoning: `Output failed JSON Schema validation with ${errors.length} error(s).`,
      evidence: evidence as ValidatorResult['evidence'],
    };
  },
};
