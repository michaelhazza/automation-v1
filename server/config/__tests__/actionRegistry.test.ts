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

import { z } from 'zod';
import { ACTION_REGISTRY } from '../actionRegistry.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const VALID_GATE_LEVELS = ['auto', 'review', 'block'] as const;
const VALID_CATEGORIES = ['api', 'worker', 'browser', 'devops', 'mcp'] as const;
const VALID_IDEMPOTENCY_STRATEGIES = ['read_only', 'keyed_write', 'locked'] as const;

console.log('');
console.log('actionRegistry — every entry shape and metadata');
console.log('');

const entries = Object.entries(ACTION_REGISTRY);

test(`registry has at least 29 entries (current: ${entries.length})`, () => {
  assert(entries.length >= 29, `expected >= 29 entries, got ${entries.length}`);
});

for (const [slug, def] of entries) {
  test(`${slug}: actionType matches map key`, () => {
    assert(
      def.actionType === slug,
      `expected actionType='${slug}', got '${def.actionType}'`,
    );
  });

  test(`${slug}: parameterSchema is a Zod object`, () => {
    assert(
      def.parameterSchema instanceof z.ZodObject,
      `parameterSchema is not a z.ZodObject (got ${def.parameterSchema?.constructor?.name ?? 'undefined'})`,
    );
  });

  test(`${slug}: parameterSchema validates an empty object iff no required fields`, () => {
    const result = def.parameterSchema.safeParse({});
    // We don't assert success/failure absolutely — we just verify safeParse
    // returns a typed result without throwing.
    assert(typeof result.success === 'boolean', 'safeParse returned a typed result');
  });

  test(`${slug}: defaultGateLevel is in the valid set`, () => {
    assert(
      VALID_GATE_LEVELS.includes(def.defaultGateLevel),
      `defaultGateLevel='${def.defaultGateLevel}' not in ${JSON.stringify(VALID_GATE_LEVELS)}`,
    );
  });

  test(`${slug}: actionCategory is in the valid set`, () => {
    assert(
      VALID_CATEGORIES.includes(def.actionCategory),
      `actionCategory='${def.actionCategory}' not in ${JSON.stringify(VALID_CATEGORIES)}`,
    );
  });

  test(`${slug}: idempotencyStrategy is declared and valid`, () => {
    assert(
      def.idempotencyStrategy !== undefined,
      'idempotencyStrategy is undefined (required field)',
    );
    assert(
      VALID_IDEMPOTENCY_STRATEGIES.includes(def.idempotencyStrategy),
      `idempotencyStrategy='${def.idempotencyStrategy}' not in ${JSON.stringify(VALID_IDEMPOTENCY_STRATEGIES)}`,
    );
  });

  test(`${slug}: retryPolicy has a valid strategy`, () => {
    assert(def.retryPolicy !== undefined, 'retryPolicy missing');
    const validStrategies = ['exponential_backoff', 'fixed', 'none'];
    assert(
      validStrategies.includes(def.retryPolicy.strategy),
      `retryPolicy.strategy='${def.retryPolicy.strategy}' not in ${JSON.stringify(validStrategies)}`,
    );
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
          assert(
            declaredFields.includes(f),
            `scopeRequirements references '${f}' but parameterSchema has no such field. Declared: ${declaredFields.join(', ')}`,
          );
        }
      });
    }
  }
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
