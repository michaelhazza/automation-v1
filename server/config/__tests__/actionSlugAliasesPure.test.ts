/**
 * actionSlugAliasesPure.test.ts
 *
 * Covers (spec §1.3):
 *   - (l) all inbound action-slug surfaces MUST normalise via
 *         `resolveActionSlug`; legacy slugs resolve to canonical slugs
 *         registered in ACTION_REGISTRY; unknown slugs pass through
 *         unchanged.
 *   - (o) alias entries preserve the canonical idempotency-key slug
 *         invariant — legacy → canonical resolution never mutates the
 *         key's structure; the resolved slug is the one registered in
 *         ACTION_REGISTRY, so downstream idempotency-key builders that
 *         stamp the canonical slug stay stable under legacy input.
 *
 * Runnable via:
 *   npx tsx server/config/__tests__/actionSlugAliasesPure.test.ts
 */

import {
  ACTION_REGISTRY,
  ACTION_SLUG_ALIASES,
  resolveActionSlug,
  __resetActionSlugAliasLogOnceForTests,
} from '../actionRegistry.js';

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

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

console.log('actionSlugAliasesPure');

// Case 1 — alias present resolves to canonical.
test('resolves clientpulse.operator_alert → notify_operator', () => {
  __resetActionSlugAliasLogOnceForTests();
  assert(resolveActionSlug('clientpulse.operator_alert') === 'notify_operator', 'operator_alert resolution');
});

// Case 2 — alias present resolves to canonical (second alias).
test('resolves config_update_hierarchy_template → config_update_organisation_config', () => {
  __resetActionSlugAliasLogOnceForTests();
  assert(
    resolveActionSlug('config_update_hierarchy_template') === 'config_update_organisation_config',
    'hierarchy_template resolution',
  );
});

// Case 3 — unknown slug passes through unchanged.
test('unknown slug passes through unchanged', () => {
  __resetActionSlugAliasLogOnceForTests();
  assert(resolveActionSlug('crm.fire_automation') === 'crm.fire_automation', 'known canonical untouched');
  assert(resolveActionSlug('some.unknown.slug') === 'some.unknown.slug', 'unknown untouched');
});

// Case 4 — every alias value points at a registered canonical slug
//           (prevents typos in the alias map itself).
test('every alias value points at a registered canonical slug', () => {
  for (const [legacy, canonical] of Object.entries(ACTION_SLUG_ALIASES)) {
    assert(
      ACTION_REGISTRY[canonical] !== undefined,
      `alias '${legacy}' → '${canonical}' but canonical is not in ACTION_REGISTRY`,
    );
  }
});

// Case 5 — no alias KEY is itself a registered canonical slug
//           (prevents a canonical slug from shadowing itself via the map).
test('no alias KEY shadows a registered canonical slug', () => {
  for (const legacy of Object.keys(ACTION_SLUG_ALIASES)) {
    assert(
      ACTION_REGISTRY[legacy] === undefined,
      `alias key '${legacy}' is also in ACTION_REGISTRY — one of them must be removed`,
    );
  }
});

// Case 6 — log-once warning fires exactly one time per alias per process.
test('log-once warning fires exactly once per alias per process', () => {
  __resetActionSlugAliasLogOnceForTests();
  const originalWarn = console.warn;
  const warnCalls: string[] = [];
  console.warn = (msg: unknown) => { warnCalls.push(String(msg)); };
  try {
    resolveActionSlug('clientpulse.operator_alert');
    resolveActionSlug('clientpulse.operator_alert');
    resolveActionSlug('clientpulse.operator_alert');
    resolveActionSlug('config_update_hierarchy_template');
    resolveActionSlug('config_update_hierarchy_template');
  } finally {
    console.warn = originalWarn;
  }
  const hitsForOperatorAlert = warnCalls.filter((m) => m.includes("'clientpulse.operator_alert'")).length;
  const hitsForHierarchyTpl = warnCalls.filter((m) => m.includes("'config_update_hierarchy_template'")).length;
  assert(hitsForOperatorAlert === 1, `expected 1 warn for operator_alert, got ${hitsForOperatorAlert}`);
  assert(hitsForHierarchyTpl === 1, `expected 1 warn for hierarchy_template, got ${hitsForHierarchyTpl}`);
  assert(warnCalls.length === 2, `expected 2 total warns, got ${warnCalls.length}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
