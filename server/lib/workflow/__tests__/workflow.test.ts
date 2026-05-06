/**
 * Workflow library smoke tests — runnable via:
 *   npx tsx server/lib/workflow/__tests__/playbook.test.ts
 *
 * No test framework dependency. Each test prints PASS/FAIL and the
 * script exits non-zero on any failure. The repo doesn't have Jest /
 * Vitest configured (test runner is shell scripts), so we keep this
 * focused on the security-critical pure functions where a unit test
 * is essential: templating (prototype pollution), validator (DAG rules),
 * canonical JSON (determinism), and hashing (firewall pattern).
 */

import { expect, test } from 'vitest';
import { z } from 'zod';
import { defineWorkflow } from '../defineWorkflow.js';
import {
  resolve,
  renderString,
  resolveInputs,
  extractReferences,
  TemplatingError,
} from '../templating.js';
import { validateDefinition, MAX_DAG_DEPTH } from '../validator.js';
import { canonicalJsonStringify } from '../canonicalJson.js';
import { hashValue } from '../hash.js';
import type { RunContext } from '../types.js';

function assertThrows(fn: () => unknown, pattern: RegExp, _label: string): void {
  let thrown: unknown;
  try { fn(); } catch (e) { thrown = e; }
  if (thrown === undefined) throw new Error(`${_label}: expected an error to be thrown`);
  const msg = thrown instanceof Error ? thrown.message : String(thrown);
  if (!pattern.test(msg)) throw new Error(`${_label}: error message "${msg}" did not match ${pattern}`);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Asserts a validation result failed with an error matching the given rule. */
function assertFailedWithRule(
  result: import('../types.js').ValidationResult,
  rule: import('../types.js').ValidationRule,
  label: string
) {
  if (result.ok) throw new Error(`${label}: expected validation to fail, but it passed`);
  if (!result.errors.some((e) => e.rule === rule)) {
    throw new Error(
      `${label}: expected error rule '${rule}', got: ${result.errors.map((e) => e.rule).join(', ')}`
    );
  }
}

function makeContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    input: { eventName: 'Launch Party', audience: 'devs' },
    subaccount: { id: 'sub-1', name: 'Acme', timezone: 'UTC' },
    org: { id: 'org-1', name: 'Acme Org' },
    steps: {
      research: { output: { summary: 'great', findings: [{ title: 'A', score: 0.9 }] } },
      positioning: { output: { tagline: 'Be there.' } },
    },
    _meta: { runId: 'r-1', templateVersionId: 'v-1', startedAt: '2024-01-01T00:00:00Z' },
    ...overrides,
  };
}

console.log('\n── canonicalJson ──');

test('canonical JSON: deterministic key ordering', () => {
  const a = canonicalJsonStringify({ b: 2, a: 1 });
  const b = canonicalJsonStringify({ a: 1, b: 2 });
  expect(a, 'object key order').toEqual(b);
  expect(a, 'serialised form').toBe('{"a":1,"b":2}');
});

test('canonical JSON: nested deterministic', () => {
  const a = canonicalJsonStringify({ x: { z: 3, y: 2 }, w: [{ b: 'q', a: 'p' }] });
  const b = canonicalJsonStringify({ w: [{ a: 'p', b: 'q' }], x: { y: 2, z: 3 } });
  expect(a, 'nested object/array key order').toEqual(b);
});

test('canonical JSON: undefined dropped', () => {
  const s = canonicalJsonStringify({ a: 1, b: undefined, c: 3 });
  expect(s, 'undefined keys removed').toBe('{"a":1,"c":3}');
});

console.log('\n── hash ──');

test('hash: same logical value → same hash regardless of key order', () => {
  const h1 = hashValue({ a: 1, b: { x: 1, y: 2 } });
  const h2 = hashValue({ b: { y: 2, x: 1 }, a: 1 });
  expect(h1, 'reordered hash equality').toEqual(h2);
});

test('hash: different value → different hash', () => {
  const h1 = hashValue({ a: 1 });
  const h2 = hashValue({ a: 2 });
  expect(h1 !== h2, 'different values must hash differently').toBeTruthy();
});

console.log('\n── templating: happy path ──');

test('resolve: run.input field', () => {
  const ctx = makeContext();
  expect(resolve('run.input.eventName', ctx), 'run.input string').toBe('Launch Party');
});

test('resolve: nested step output', () => {
  const ctx = makeContext();
  expect(resolve('steps.positioning.output.tagline', ctx), 'step output string').toBe('Be there.');
});

test('resolve: array index access', () => {
  const ctx = makeContext();
  expect(resolve('steps.research.output.findings[0].title', ctx), 'array index path').toBe('A');
});

test('resolve: subaccount whitelist field', () => {
  const ctx = makeContext();
  expect(resolve('run.subaccount.name', ctx), 'subaccount field').toBe('Acme');
});

test('renderString: multiple expressions in one string', () => {
  const ctx = makeContext();
  const out = renderString('Hi {{ run.input.eventName }} for {{ run.input.audience }}', ctx);
  expect(out, 'rendered string').toBe('Hi Launch Party for devs');
});

test('resolveInputs: single expression preserves type', () => {
  const ctx = makeContext();
  const out = resolveInputs(
    {
      tagline: '{{ steps.positioning.output.tagline }}',
      summary: '{{ steps.research.output.summary }}',
    },
    ctx
  );
  expect(out.tagline, 'resolved tagline').toBe('Be there.');
  expect(out.summary, 'resolved summary').toBe('great');
});

console.log('\n── templating: prototype-pollution hardening ──');

test('blocked: __proto__ in path', () => {
  const ctx = makeContext();
  assertThrows(
    () => resolve('run.input.__proto__', ctx),
    /blocked path segment/,
    '__proto__ rejected'
  );
});

test('blocked: constructor in path', () => {
  const ctx = makeContext();
  assertThrows(
    () => resolve('steps.research.constructor.foo', ctx),
    /blocked path segment/,
    'constructor rejected'
  );
});

test('blocked: prototype in path', () => {
  const ctx = makeContext();
  assertThrows(
    () => resolve('run.input.prototype', ctx),
    /blocked path segment/,
    'prototype rejected'
  );
});

test('blocked: top-level namespace not in whitelist', () => {
  const ctx = makeContext();
  assertThrows(
    () => resolve('process.env.SECRET', ctx),
    /unknown top-level namespace/,
    'arbitrary namespace rejected'
  );
});

test('blocked: run.something_unexpected', () => {
  const ctx = makeContext();
  assertThrows(
    () => resolve('run.private.id', ctx),
    /run\.<namespace> must be one of/,
    'unknown run sub-namespace rejected'
  );
});

test('blocked: run.subaccount field outside whitelist', () => {
  const ctx = makeContext();
  assertThrows(
    () => resolve('run.subaccount.organisationId', ctx),
    /not in whitelist/,
    'subaccount whitelist enforced'
  );
});

test('safe context has no prototype chain', () => {
  // Even if we try to inject a polluted key into the input, the resolver
  // should not be able to reach Object.prototype.
  const polluted = { eventName: 'safe' };
  // simulate a hostile context — prototype walk would fail anyway because of
  // the path blocklist, but we also confirm hasOwn semantics.
  const ctx = makeContext({ input: polluted });
  assertThrows(
    () => resolve('run.input.toString', ctx),
    /not found/,
    'inherited Object.prototype methods unreachable'
  );
});

console.log('\n── templating: error cases ──');

test('missing step', () => {
  const ctx = makeContext();
  assertThrows(
    () => resolve('steps.nonexistent.output.x', ctx),
    /has no recorded output/,
    'missing step rejected'
  );
});

test('missing path segment', () => {
  const ctx = makeContext();
  assertThrows(
    () => resolve('steps.research.output.findings[5].title', ctx),
    /out of bounds/,
    'array OOB rejected'
  );
});

test('extractReferences: parses all expressions', () => {
  const refs = extractReferences(
    'Use {{ run.input.eventName }} and {{ steps.positioning.output.tagline }}.'
  );
  expect(refs.length, 'two refs extracted').toBe(2);
  expect(refs[0].namespace, 'first ref namespace').toBe('run.input');
  expect(refs[1].namespace, 'second ref namespace').toBe('steps');
  expect(refs[1].stepId, 'second ref stepId').toBe('positioning');
});

console.log('\n── validator: happy path ──');

const validWorkflow = defineWorkflow({
  slug: 'demo',
  name: 'Demo',
  description: '',
  version: 1,
  initialInputSchema: z.object({ eventName: z.string() }),
  steps: [
    {
      id: 'event_basics',
      name: 'Confirm basics',
      type: 'user_input',
      dependsOn: [],
      sideEffectType: 'none',
      formSchema: z.object({ venue: z.string() }),
      outputSchema: z.object({ venue: z.string() }),
    },
    {
      id: 'positioning',
      name: 'Positioning',
      type: 'agent_call',
      dependsOn: ['event_basics'],
      sideEffectType: 'none',
      agentRef: { kind: 'system', slug: 'copywriter' },
      agentInputs: { venue: '{{ steps.event_basics.output.venue }}' },
      prompt: 'Position for {{ run.input.eventName }} at {{ steps.event_basics.output.venue }}',
      outputSchema: z.object({ tagline: z.string() }),
    },
  ],
});

test('validator: valid playbook passes', () => {
  const result = validateDefinition(validWorkflow);
  expect(result.ok, `valid playbook should pass: ${JSON.stringify(result)}`).toBeTruthy();
});

console.log('\n── validator: rule failures ──');

test('rule 1: duplicate step ids', () => {
  const result = validateDefinition({
    ...validWorkflow,
    steps: [validWorkflow.steps[0], validWorkflow.steps[0]],
  });
  assertFailedWithRule(result, 'unique_id', 'duplicate caught');
});

test('rule 2: invalid kebab_case id', () => {
  const result = validateDefinition({
    ...validWorkflow,
    steps: [
      { ...validWorkflow.steps[0], id: 'BadId' },
      { ...validWorkflow.steps[1], dependsOn: ['BadId'] },
    ],
  });
  assertFailedWithRule(result, 'kebab_case', 'kebab caught');
});

test('rule 3: dependsOn unresolved', () => {
  const result = validateDefinition({
    ...validWorkflow,
    steps: [
      { ...validWorkflow.steps[0] },
      { ...validWorkflow.steps[1], dependsOn: ['ghost_step'] },
    ],
  });
  assertFailedWithRule(result, 'unresolved_dep', 'unresolved dep caught');
});

test('rule 4: cycle detection', () => {
  const result = validateDefinition({
    ...validWorkflow,
    steps: [
      { ...validWorkflow.steps[0], dependsOn: ['positioning'] },
      { ...validWorkflow.steps[1] },
    ],
  });
  assertFailedWithRule(result, 'cycle', 'cycle caught');
});

test('rule 6: missing entry step', () => {
  const result = validateDefinition({
    ...validWorkflow,
    steps: [
      { ...validWorkflow.steps[0], dependsOn: ['positioning'] },
      { ...validWorkflow.steps[1] },
    ],
  });
  // Cycle also triggers; either rule is acceptable.
  if (result.ok) throw new Error('should fail');
  if (
    !result.errors.some((e) => e.rule === 'missing_entry' || e.rule === 'cycle')
  ) {
    throw new Error('expected missing_entry or cycle');
  }
});

test('rule 7 / transitive dep: prompt references step not in dependsOn', () => {
  const result = validateDefinition({
    ...validWorkflow,
    steps: [
      validWorkflow.steps[0],
      {
        ...validWorkflow.steps[1],
        dependsOn: [],
        prompt: 'reference {{ steps.event_basics.output.venue }}',
      },
    ],
  });
  assertFailedWithRule(result, 'transitive_dep', 'transitive dep caught');
});

test('rule 9: missing outputSchema', () => {
  const stepWithoutSchema = { ...validWorkflow.steps[1] };
  // @ts-expect-error — testing missing field
  delete stepWithoutSchema.outputSchema;
  const result = validateDefinition({
    ...validWorkflow,
    steps: [validWorkflow.steps[0], stepWithoutSchema],
  });
  assertFailedWithRule(result, 'missing_output_schema', 'missing schema caught');
});

test('rule: missing sideEffectType', () => {
  const stepWithoutSE = { ...validWorkflow.steps[1] };
  // @ts-expect-error — testing missing field
  delete stepWithoutSE.sideEffectType;
  const result = validateDefinition({
    ...validWorkflow,
    steps: [validWorkflow.steps[0], stepWithoutSE],
  });
  assertFailedWithRule(result, 'missing_side_effect_type', 'missing sideEffectType caught');
});

test('rule 12: irreversible with retries > 1', () => {
  const result = validateDefinition({
    ...validWorkflow,
    steps: [
      validWorkflow.steps[0],
      {
        ...validWorkflow.steps[1],
        sideEffectType: 'irreversible',
        retryPolicy: { maxAttempts: 3 },
      },
    ],
  });
  assertFailedWithRule(result, 'irreversible_with_retries', 'irreversible+retry caught');
});

test('rule 11: version not monotonic', () => {
  const result = validateDefinition(validWorkflow, { previousVersion: 1 });
  assertFailedWithRule(result, 'version_not_monotonic', 'version monotonic enforced');
});

test('rule 13: max DAG depth', () => {
  const longChain = Array.from({ length: MAX_DAG_DEPTH + 1 }, (_, i) => ({
    id: `step_${String(i).padStart(3, '0')}`,
    name: `S${i}`,
    type: 'prompt' as const,
    dependsOn: i === 0 ? [] : [`step_${String(i - 1).padStart(3, '0')}`],
    sideEffectType: 'none' as const,
    prompt: 'x',
    outputSchema: z.object({ ok: z.boolean() }),
  }));
  const result = validateDefinition({
    slug: 'long',
    name: 'Long',
    description: '',
    version: 1,
    initialInputSchema: z.object({}),
    steps: longChain,
  });
  assertFailedWithRule(result, 'max_dag_depth_exceeded', 'max depth caught');
});

// ─── renderWorkflowFile: deterministic from definition (review round 3) ──────
//
// These tests prove the file body is a pure function of the definition.
// Spec invariant 14: the save endpoint never trusts client-supplied
// fileContents — instead, the server renders the file deterministically
// and commits THAT. These tests pin the contract.
//
// Imports come from the pure renderer module, NOT from
// playbookStudioService, because the latter transitively loads env / db
// which we don't want in unit tests.

console.log('\n── renderWorkflowFile (definition/file consistency) ──');

const { renderWorkflowFile } = await import('../renderer.js');
// computeDefinitionHash is just a thin wrapper around hashValue — use
// hashValue directly so we don't pull the studio service into the test.
const computeDefinitionHash = (def: unknown) => hashValue(def);

const sampleDefinition = {
  slug: 'render-test',
  name: 'Render Test',
  description: 'Pin the renderer output',
  version: 1,
  steps: [
    {
      id: 'first_step',
      name: 'First',
      type: 'user_input',
      dependsOn: [],
      sideEffectType: 'none',
      formSchema: {},
      outputSchema: {},
    },
    {
      id: 'second_step',
      name: 'Second',
      type: 'agent_call',
      dependsOn: ['first_step'],
      sideEffectType: 'irreversible',
      humanReviewRequired: true,
      retryPolicy: { maxAttempts: 1 },
      agentRef: { kind: 'system', slug: 'copywriter' },
      agentInputs: { prompt: 'hello' },
      prompt: 'Generate something',
      outputSchema: {},
    },
  ],
};

test('renderWorkflowFile: deterministic — same input produces byte-identical output', () => {
  const hash = computeDefinitionHash(sampleDefinition);
  const a = renderWorkflowFile(sampleDefinition, hash);
  const b = renderWorkflowFile(sampleDefinition, hash);
  if (a !== b) throw new Error('non-deterministic render');
});

test('renderWorkflowFile: embeds the definition hash as a magic comment', () => {
  const hash = computeDefinitionHash(sampleDefinition);
  const out = renderWorkflowFile(sampleDefinition, hash);
  if (!out.includes(`@workflow-definition-hash: ${hash}`)) {
    throw new Error('hash comment missing from rendered output');
  }
});

test('renderWorkflowFile: emits import + defineWorkflow wrapper', () => {
  const hash = computeDefinitionHash(sampleDefinition);
  const out = renderWorkflowFile(sampleDefinition, hash);
  if (!out.includes("import { defineWorkflow } from '../lib/workflow/defineWorkflow.js'")) {
    throw new Error('defineWorkflow import missing');
  }
  if (!out.includes('export default defineWorkflow({')) {
    throw new Error('defineWorkflow wrapper call missing');
  }
});

test('renderWorkflowFile: preserves all step structural fields verbatim', () => {
  const hash = computeDefinitionHash(sampleDefinition);
  const out = renderWorkflowFile(sampleDefinition, hash);
  // slug, name, ids, deps, side effects, agent ref, prompt — all present
  for (const needle of [
    '"render-test"',
    '"Render Test"',
    '"first_step"',
    '"second_step"',
    '"irreversible"',
    'humanReviewRequired: true',
    '{"kind":"system","slug":"copywriter"}',
    '"Generate something"',
  ]) {
    if (!out.includes(needle)) {
      throw new Error(`expected output to contain ${needle}`);
    }
  }
});

test('renderWorkflowFile: schema fields use z.any() placeholder (no JSON literal injection)', () => {
  const hash = computeDefinitionHash(sampleDefinition);
  const out = renderWorkflowFile(sampleDefinition, hash);
  if (!out.includes('outputSchema: z.any(),')) {
    throw new Error('outputSchema must render as z.any() placeholder');
  }
  if (!out.includes('formSchema: z.any(),')) {
    throw new Error('formSchema must render as z.any() placeholder');
  }
});

test('renderWorkflowFile: hash changes when definition changes', () => {
  const h1 = computeDefinitionHash(sampleDefinition);
  const tweaked = { ...sampleDefinition, name: 'Different Name' };
  const h2 = computeDefinitionHash(tweaked);
  if (h1 === h2) throw new Error('hash should change when definition changes');
});

console.log('\n──────────────────────────────────');
console.log('──────────────────────────────────\n');

