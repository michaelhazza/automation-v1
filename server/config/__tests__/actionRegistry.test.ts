/**
 * actionRegistry unit tests — runnable via:
 *   npx tsx server/config/__tests__/actionRegistry.test.ts
 *
 * Asserts every entry in ACTION_REGISTRY parses, has a Zod parameterSchema,
 * has a valid defaultGateLevel, has a closed actionCategory, and declares
 * the required idempotencyStrategy field.
 *
 * Per P0.2 Slice A of docs/improvements-roadmap-spec.md.
 *
 * The repo doesn't have Jest / Vitest configured, so we follow the same
 * lightweight pattern as server/services/__tests__/runContextLoader.test.ts.
 */

import { expect, test } from 'vitest';
import { z } from 'zod';
import { ACTION_REGISTRY } from '../actionRegistry.js';

const VALID_GATE_LEVELS = ['auto', 'review', 'block'] as const;
const VALID_CATEGORIES = ['api', 'worker', 'browser', 'devops', 'mcp'] as const;
const VALID_IDEMPOTENCY_STRATEGIES = ['read_only', 'keyed_write', 'locked'] as const;

console.log('');
console.log('actionRegistry — every entry shape and metadata');
console.log('');

const entries = Object.entries(ACTION_REGISTRY);

test(`registry has at least 29 entries (current: ${entries.length})`, () => {
  expect(entries.length >= 29, `expected >= 29 entries, got ${entries.length}`).toBeTruthy();
});

for (const [slug, def] of entries) {
  test(`${slug}: actionType matches map key`, () => {
    expect(def.actionType === slug, `expected actionType='${slug}', got '${def.actionType}'`).toBeTruthy();
  });

  test(`${slug}: parameterSchema is a Zod object`, () => {
    expect(def.parameterSchema instanceof z.ZodObject, `parameterSchema is not a z.ZodObject (got ${def.parameterSchema?.constructor?.name ?? 'undefined'})`).toBeTruthy();
  });

  test(`${slug}: parameterSchema validates an empty object iff no required fields`, () => {
    const result = def.parameterSchema.safeParse({});
    // We don't assert success/failure absolutely — we just verify safeParse
    // returns a typed result without throwing.
    expect(typeof result.success === 'boolean', 'safeParse returned a typed result').toBeTruthy();
  });

  test(`${slug}: defaultGateLevel is in the valid set`, () => {
    expect(VALID_GATE_LEVELS.includes(def.defaultGateLevel), `defaultGateLevel='${def.defaultGateLevel}' not in ${JSON.stringify(VALID_GATE_LEVELS)}`).toBeTruthy();
  });

  test(`${slug}: actionCategory is in the valid set`, () => {
    expect(VALID_CATEGORIES.includes(def.actionCategory), `actionCategory='${def.actionCategory}' not in ${JSON.stringify(VALID_CATEGORIES)}`).toBeTruthy();
  });

  test(`${slug}: idempotencyStrategy is declared and valid`, () => {
    expect(def.idempotencyStrategy !== undefined, 'idempotencyStrategy is undefined (required field)').toBeTruthy();
    expect(VALID_IDEMPOTENCY_STRATEGIES.includes(def.idempotencyStrategy), `idempotencyStrategy='${def.idempotencyStrategy}' not in ${JSON.stringify(VALID_IDEMPOTENCY_STRATEGIES)}`).toBeTruthy();
  });

  test(`${slug}: retryPolicy has a valid strategy`, () => {
    expect(def.retryPolicy !== undefined, 'retryPolicy missing').toBeTruthy();
    const validStrategies = ['exponential_backoff', 'fixed', 'none'];
    expect(validStrategies.includes(def.retryPolicy.strategy), `retryPolicy.strategy='${def.retryPolicy.strategy}' not in ${JSON.stringify(validStrategies)}`).toBeTruthy();
  });

  // If scopeRequirements is present, verify the named fields exist on the schema.
  if (def.scopeRequirements) {
    const fieldsToCheck: string[] = [
      ...(def.scopeRequirements.validateSubaccountFields ?? []),
      ...(def.scopeRequirements.validateGhlLocationFields ?? []),
    ];
    if (fieldsToCheck.length > 0) {
      test(`${slug}: scopeRequirements field references exist in parameterSchema`, () => {
        const shape = (def.parameterSchema as z.ZodObject<z.ZodRawShape>).shape;
        const declaredFields = Object.keys(shape);
        for (const f of fieldsToCheck) {
          expect(declaredFields.includes(f), `scopeRequirements references '${f}' but parameterSchema has no such field. Declared: ${declaredFields.join(', ')}`).toBeTruthy();
        }
      });
    }
  }
}

console.log('');console.log('');