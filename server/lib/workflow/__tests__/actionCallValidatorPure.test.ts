/**
 * action_call validator pure unit tests — runnable via:
 *   npx tsx server/lib/workflow/__tests__/actionCallValidatorPure.test.ts
 *
 * Verifies the validator rules introduced for Phase A of
 * docs/onboarding-workflows-spec.md:
 *   - action_slug_not_allowed
 *   - entity_idempotency_required
 *   - action_side_effect_mismatch
 *   - missing_field (entityKey when scope is 'entity')
 *
 * Happy-path cases confirm that well-formed action_call steps pass.
 */

import { expect, test } from 'vitest';
import { z } from 'zod';
import { defineWorkflow } from '../defineWorkflow.js';
import { validateDefinition } from '../validator.js';
import type { ValidationResult, ValidationRule } from '../types.js';

function assertHasRule(
  result: ValidationResult,
  rule: ValidationRule,
  label: string,
) {
  if (result.ok) {
    throw new Error(`${label}: expected validation to fail, but it passed`);
  }
  if (!result.errors.some((e) => e.rule === rule)) {
    throw new Error(
      `${label}: expected error rule '${rule}', got: ${result.errors.map((e) => e.rule).join(', ')}`,
    );
  }
}

function assertNoRule(
  result: ValidationResult,
  rule: ValidationRule,
  label: string,
) {
  if (!result.ok && result.errors.some((e) => e.rule === rule)) {
    throw new Error(
      `${label}: expected no error with rule '${rule}', got: ${result.errors.filter((e) => e.rule === rule).map((e) => e.message).join('; ')}`,
    );
  }
}

function makeBaseDefinition(
  steps: Record<string, unknown>[],
): Parameters<typeof validateDefinition>[0] {
  return defineWorkflow({
    slug: 'test-playbook',
    name: 'Test Workflow',
    description: 'unit test fixture',
    version: 1,
    initialInputSchema: z.object({}),
    steps: steps as never,
  });
}

// ── action_slug_not_allowed ────────────────────────────────────────────────

test('rejects action_call with slug outside allowlist', () => {
  const def = makeBaseDefinition([
    {
      id: 'rogue',
      name: 'Rogue',
      type: 'action_call',
      dependsOn: [],
      sideEffectType: 'reversible',
      actionSlug: 'send_email',
      actionInputs: {},
      outputSchema: z.any(),
    },
  ]);
  const result = validateDefinition(def);
  assertHasRule(result, 'action_slug_not_allowed', 'send_email should be rejected');
});

test('accepts action_call with an allowlisted slug', () => {
  const def = makeBaseDefinition([
    {
      id: 'list_agents',
      name: 'List agents',
      type: 'action_call',
      dependsOn: [],
      sideEffectType: 'none',
      actionSlug: 'config_list_agents',
      actionInputs: {},
      outputSchema: z.any(),
    },
  ]);
  const result = validateDefinition(def);
  assertNoRule(result, 'action_slug_not_allowed', 'allowlisted read slug should pass');
});

// ── entity_idempotency_required ───────────────────────────────────────────

test('rejects singleton action without idempotencyScope: entity', () => {
  const def = makeBaseDefinition([
    {
      id: 'create_task',
      name: 'Create scheduled task',
      type: 'action_call',
      dependsOn: [],
      sideEffectType: 'reversible',
      actionSlug: 'config_create_scheduled_task',
      actionInputs: { name: 'daily-brief' },
      outputSchema: z.any(),
    },
  ]);
  const result = validateDefinition(def);
  assertHasRule(
    result,
    'entity_idempotency_required',
    'singleton creation requires entity-scoped idempotency',
  );
});

test('accepts singleton action with entity scope + entityKey', () => {
  const def = makeBaseDefinition([
    {
      id: 'create_task',
      name: 'Create scheduled task',
      type: 'action_call',
      dependsOn: [],
      sideEffectType: 'reversible',
      actionSlug: 'config_create_scheduled_task',
      actionInputs: { name: 'daily-brief' },
      idempotencyScope: 'entity',
      entityKey: 'scheduled-task:daily-brief',
      outputSchema: z.any(),
    },
  ]);
  const result = validateDefinition(def);
  assertNoRule(
    result,
    'entity_idempotency_required',
    'entity scope satisfies the invariant',
  );
  assertNoRule(
    result,
    'missing_field',
    'entityKey is present so no missing_field',
  );
});

test('rejects entity scope without entityKey', () => {
  const def = makeBaseDefinition([
    {
      id: 'create_task',
      name: 'Create scheduled task',
      type: 'action_call',
      dependsOn: [],
      sideEffectType: 'reversible',
      actionSlug: 'config_create_scheduled_task',
      actionInputs: { name: 'daily-brief' },
      idempotencyScope: 'entity',
      outputSchema: z.any(),
    },
  ]);
  const result = validateDefinition(def);
  assertHasRule(
    result,
    'missing_field',
    'entity scope requires entityKey',
  );
});

// ── action_side_effect_mismatch ───────────────────────────────────────────

test('rejects read-only action declared as reversible', () => {
  const def = makeBaseDefinition([
    {
      id: 'list',
      name: 'List agents',
      type: 'action_call',
      dependsOn: [],
      sideEffectType: 'reversible',
      actionSlug: 'config_list_agents',
      actionInputs: {},
      outputSchema: z.any(),
    },
  ]);
  const result = validateDefinition(def);
  assertHasRule(
    result,
    'action_side_effect_mismatch',
    'read-only cannot be reversible',
  );
});

test('rejects read-only action declared as irreversible', () => {
  const def = makeBaseDefinition([
    {
      id: 'list',
      name: 'List agents',
      type: 'action_call',
      dependsOn: [],
      sideEffectType: 'irreversible',
      actionSlug: 'config_list_agents',
      actionInputs: {},
      outputSchema: z.any(),
    },
  ]);
  const result = validateDefinition(def);
  assertHasRule(
    result,
    'action_side_effect_mismatch',
    'read-only cannot be irreversible',
  );
});

test('accepts read-only action declared as none', () => {
  const def = makeBaseDefinition([
    {
      id: 'list',
      name: 'List agents',
      type: 'action_call',
      dependsOn: [],
      sideEffectType: 'none',
      actionSlug: 'config_list_agents',
      actionInputs: {},
      outputSchema: z.any(),
    },
  ]);
  const result = validateDefinition(def);
  assertNoRule(
    result,
    'action_side_effect_mismatch',
    'read-only with none is allowed',
  );
});

test('accepts read-only action declared as idempotent', () => {
  const def = makeBaseDefinition([
    {
      id: 'list',
      name: 'List agents',
      type: 'action_call',
      dependsOn: [],
      sideEffectType: 'idempotent',
      actionSlug: 'config_list_agents',
      actionInputs: {},
      outputSchema: z.any(),
    },
  ]);
  const result = validateDefinition(def);
  assertNoRule(
    result,
    'action_side_effect_mismatch',
    'read-only with idempotent is allowed',
  );
});

test('rejects mutating action declared as none', () => {
  const def = makeBaseDefinition([
    {
      id: 'create',
      name: 'Create agent',
      type: 'action_call',
      dependsOn: [],
      sideEffectType: 'none',
      actionSlug: 'config_create_agent',
      actionInputs: { name: 'X', masterPrompt: 'Y' },
      outputSchema: z.any(),
    },
  ]);
  const result = validateDefinition(def);
  assertHasRule(
    result,
    'action_side_effect_mismatch',
    "mutating action cannot be 'none'",
  );
});

test('accepts mutating action declared as reversible', () => {
  const def = makeBaseDefinition([
    {
      id: 'create',
      name: 'Create agent',
      type: 'action_call',
      dependsOn: [],
      sideEffectType: 'reversible',
      actionSlug: 'config_create_agent',
      actionInputs: { name: 'X', masterPrompt: 'Y' },
      outputSchema: z.any(),
    },
  ]);
  const result = validateDefinition(def);
  assertNoRule(
    result,
    'action_side_effect_mismatch',
    'mutating with reversible is allowed',
  );
});

// ── missing_field on actionSlug ────────────────────────────────────────────

test('rejects action_call without actionSlug', () => {
  const def = makeBaseDefinition([
    {
      id: 'orphan',
      name: 'Orphan',
      type: 'action_call',
      dependsOn: [],
      sideEffectType: 'none',
      actionInputs: {},
      outputSchema: z.any(),
    },
  ]);
  const result = validateDefinition(def);
  assertHasRule(
    result,
    'missing_field',
    'action_call must declare actionSlug',
  );
});

// ── Summary ────────────────────────────────────────────────────────────────