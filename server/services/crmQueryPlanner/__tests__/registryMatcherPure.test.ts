/**
 * registryMatcherPure.test.ts — spec §8.4
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/registryMatcherPure.test.ts
 */
import { expect, test } from 'vitest';
import { normaliseIntent } from '../normaliseIntentPure.js';
import {
  matchRegistryEntry,
  buildAliasIndex,
  RegistryConflictError,
} from '../registryMatcherPure.js';
import type { CanonicalQueryRegistry } from '../../../../shared/types/crmQueryPlanner.js';

function assertEqual<T>(a: T, b: T, label = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// ── Minimal stub registry ─────────────────────────────────────────────────

const stubRegistry: CanonicalQueryRegistry = Object.freeze({
  'contacts.inactive_over_days': {
    key: 'contacts.inactive_over_days',
    primaryEntity: 'contacts',
    // Note: "inactive contacts" and "stale contacts" normalise to the same hash
    // (synonym: inactive→stale), so we only list the canonical form and distinct aliases.
    aliases: ['stale contacts', 'contacts no activity'],
    requiredCapabilities: ['canonical.contacts.read'],
    description: 'Contacts with no activity since N days ago',
    allowedFields: {
      lastActivityAt: { operators: ['lt', 'lte', 'gt', 'gte', 'between'], projectable: true, sortable: true },
      id:             { operators: ['eq', 'in'],                          projectable: true, sortable: false },
    },
    handler: async () => ({ rows: [], rowCount: 0, truncated: false, actualCostCents: 0, source: 'canonical' as const }),
  },
  'opportunities.stale_over_days': {
    key: 'opportunities.stale_over_days',
    primaryEntity: 'opportunities',
    aliases: ['stale deals', 'stuck deals'],
    requiredCapabilities: ['canonical.opportunities.read'],
    description: 'Stale opportunities',
    allowedFields: {
      updatedAt: { operators: ['lt', 'lte', 'gt', 'gte'], projectable: true, sortable: true },
    },
    handler: async () => ({ rows: [], rowCount: 0, truncated: false, actualCostCents: 0, source: 'canonical' as const }),
  },
});

const ctx = { callerCapabilities: new Set(['crm.query']) };

// ── Alias hit tests ───────────────────────────────────────────────────────

test('alias "stale contacts" → contacts.inactive_over_days', () => {
  const intent = normaliseIntent('stale contacts');
  const result = matchRegistryEntry(intent, stubRegistry, ctx);
  expect(result !== null, 'expected a match').toBeTruthy();
  expect(result!.registryKey).toBe('contacts.inactive_over_days');
});

// synonym: "inactive" → "stale", so both surface the same registry entry
test('synonym alias "inactive contacts" → contacts.inactive_over_days (via synonym)', () => {
  const intent = normaliseIntent('inactive contacts');
  const result = matchRegistryEntry(intent, stubRegistry, ctx);
  expect(result !== null, 'expected a match via synonym').toBeTruthy();
  expect(result!.registryKey).toBe('contacts.inactive_over_days');
});

test('alias "contacts no activity" → contacts.inactive_over_days', () => {
  const intent = normaliseIntent('contacts no activity');
  const result = matchRegistryEntry(intent, stubRegistry, ctx);
  expect(result !== null, 'expected a match').toBeTruthy();
  expect(result!.registryKey).toBe('contacts.inactive_over_days');
});

test('alias "stale deals" (synonym: deals→opportunities) → opportunities.stale_over_days', () => {
  const intent = normaliseIntent('stale deals');
  const result = matchRegistryEntry(intent, stubRegistry, ctx);
  expect(result !== null, 'expected a match').toBeTruthy();
  expect(result!.registryKey).toBe('opportunities.stale_over_days');
});

test('alias "stuck deals" → opportunities.stale_over_days', () => {
  const intent = normaliseIntent('stuck deals');
  const result = matchRegistryEntry(intent, stubRegistry, ctx);
  expect(result !== null, 'expected a match').toBeTruthy();
  expect(result!.registryKey).toBe('opportunities.stale_over_days');
});

// ── Plan shape on hit ──────────────────────────────────────────────────────

test('matched plan has validated:true and stageResolved:1', () => {
  const result = matchRegistryEntry(normaliseIntent('inactive contacts'), stubRegistry, ctx);
  expect(result !== null, 'expected a match').toBeTruthy();
  expect(result!.plan.validated).toBe(true);
  expect(result!.plan.stageResolved).toBe(1);
  expect(result!.plan.source).toBe('canonical');
  expect(result!.plan.confidence).toBe(1.0);
});

// ── Miss cases ────────────────────────────────────────────────────────────

test('unrecognised intent returns null', () => {
  const result = matchRegistryEntry(normaliseIntent('weather forecast tomorrow'), stubRegistry, ctx);
  expect(result).toBe(null);
});

test('empty intent returns null', () => {
  const result = matchRegistryEntry(normaliseIntent(''), stubRegistry, ctx);
  expect(result).toBe(null);
});

test('intent that is a stop-word-only string returns null', () => {
  const result = matchRegistryEntry(normaliseIntent('the a an'), stubRegistry, ctx);
  expect(result).toBe(null);
});

// ── Alias collision detection ──────────────────────────────────────────────

test('collision detected at index build time', () => {
  const conflicting: CanonicalQueryRegistry = Object.freeze({
    'entry.a': {
      key: 'entry.a',
      primaryEntity: 'contacts',
      // "inactive contacts" normalises identically to "stale contacts" via synonym
      aliases: ['inactive contacts'],
      requiredCapabilities: [],
      description: 'A',
      allowedFields: {},
      handler: async () => ({ rows: [], rowCount: 0, truncated: false, actualCostCents: 0, source: 'canonical' as const }),
    },
    'entry.b': {
      key: 'entry.b',
      primaryEntity: 'contacts',
      aliases: ['stale contacts'],
      requiredCapabilities: [],
      description: 'B',
      allowedFields: {},
      handler: async () => ({ rows: [], rowCount: 0, truncated: false, actualCostCents: 0, source: 'canonical' as const }),
    },
  });
  let threw = false;
  try { buildAliasIndex(conflicting); } catch (e) {
    threw = e instanceof RegistryConflictError;
  }
  expect(threw, 'RegistryConflictError expected on alias collision').toBeTruthy();
});

// ── All-alias coverage — §8.4 requirement ─────────────────────────────────
// Build a mock registry from REGISTRY_META (pure — no DB) and assert every
// registered alias produces a Stage 1 hit.  Synonyms that would collide
// (e.g. 'deal velocity' = 'pipeline velocity' via 'deal'→'opportunities')
// are intentionally absent from REGISTRY_META.aliases; they still match via
// synonym substitution at lookup time.

import { REGISTRY_META } from '../executors/canonicalQueryRegistryMeta.js';
import type { CanonicalQueryHandlerArgs, ExecutorResult } from '../../../../shared/types/crmQueryPlanner.js';

const STUB_HANDLER = async (_args: CanonicalQueryHandlerArgs): Promise<ExecutorResult> =>
  ({ rows: [], rowCount: 0, truncated: false, actualCostCents: 0, source: 'canonical' as const });

// Construct a full mock registry from REGISTRY_META without handlers importing drizzle-orm
const fullMockRegistry: CanonicalQueryRegistry = Object.freeze(
  Object.fromEntries(
    Object.entries(REGISTRY_META).map(([key, meta]) => [
      key,
      { ...meta, handler: STUB_HANDLER },
    ]),
  ) as CanonicalQueryRegistry,
);

const fullCtx = { callerCapabilities: new Set(['crm.query']) };

for (const [registryKey, entry] of Object.entries(REGISTRY_META)) {
  for (const alias of entry.aliases) {
    test(`alias "${alias}" → ${registryKey}`, () => {
      const intent = normaliseIntent(alias);
      const result = matchRegistryEntry(intent, fullMockRegistry, fullCtx);
      expect(result !== null, `expected a hit for alias "${alias}"`).toBeTruthy();
      expect(result!.registryKey, `registryKey for "${alias}"`).toEqual(registryKey);
    });
  }
}

// Synonym-path aliases that are NOT in the alias list (they'd collide as explicit
// entries but still match via synonym substitution at lookup time)
const synonymAliasChecks: Array<{ alias: string; expectedKey: string }> = [
  { alias: 'inactive contacts',     expectedKey: 'contacts.inactive_over_days' },   // inactive→stale
  { alias: 'deal velocity',         expectedKey: 'opportunities.pipeline_velocity' }, // deal→opportunities
  { alias: 'future appointments',   expectedKey: 'appointments.upcoming' },           // upcoming→future handled in registered alias; future stays future but matches via synonym at lookup
  { alias: 'deals stage',           expectedKey: 'opportunities.count_by_stage' },   // deal→opportunities
  { alias: 'pipeline by stage',     expectedKey: 'opportunities.count_by_stage' },   // pipeline→opportunities
];

for (const { alias, expectedKey } of synonymAliasChecks) {
  test(`synonym alias "${alias}" → ${expectedKey} (not in explicit alias list)`, () => {
    const intent = normaliseIntent(alias);
    const result = matchRegistryEntry(intent, fullMockRegistry, fullCtx);
    expect(result !== null, `expected a synonym-path hit for "${alias}"`).toBeTruthy();
    expect(result!.registryKey, `registryKey for "${alias}"`).toEqual(expectedKey);
  });
}

// ── Summary ───────────────────────────────────────────────────────────────
