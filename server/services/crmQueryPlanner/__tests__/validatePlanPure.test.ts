/**
 * validatePlanPure.test.ts — spec §11.5
 * At least 20 test cases covering all 10 rules.
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/validatePlanPure.test.ts
 */
import { expect, test } from 'vitest';
import { validatePlanPure, ValidationError } from '../validatePlanPure.js';
import type { SchemaContext, ValidatorOptions } from '../validatePlanPure.js';
import type { DraftQueryPlan, CanonicalQueryRegistry } from '../../../../shared/types/crmQueryPlanner.js';

function assertThrows(fn: () => unknown, label: string): void {
  let thrown = false;
  try { fn(); } catch { thrown = true; }
  if (!thrown) throw new Error(`${label} — expected throw, but did not throw`);
}

function assertEqual<T>(a: T, b: T, label = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// ── Stub registry ─────────────────────────────────────────────────────────────

const stubRegistry: CanonicalQueryRegistry = Object.freeze({
  'contacts.inactive_over_days': {
    key: 'contacts.inactive_over_days',
    primaryEntity: 'contacts',
    aliases: ['stale contacts'],
    requiredCapabilities: ['canonical.contacts.read'],
    description: 'Contacts with no activity since N days ago',
    allowedFields: {
      updatedAt: { operators: ['lt', 'lte', 'gt', 'gte', 'between'], projectable: true, sortable: true },
      id:        { operators: ['eq', 'in'],                          projectable: true, sortable: false },
      tags:      { operators: ['in', 'contains'],                    projectable: true, sortable: false },
      score:     { operators: ['gt', 'gte'],                         projectable: false, sortable: true },
    },
    handler: async () => ({ rows: [], rowCount: 0, truncated: false, actualCostCents: 0, source: 'canonical' as const }),
  },
  'opportunities.stale_over_days': {
    key: 'opportunities.stale_over_days',
    primaryEntity: 'opportunities',
    aliases: ['stuck deals'],
    requiredCapabilities: ['canonical.opportunities.read'],
    description: 'Stale opportunities',
    allowedFields: {
      updatedAt: { operators: ['lt', 'lte', 'gt', 'gte'], projectable: true, sortable: true },
      stage:     { operators: ['eq', 'in'],               projectable: true, sortable: false },
    },
    handler: async () => ({ rows: [], rowCount: 0, truncated: false, actualCostCents: 0, source: 'canonical' as const }),
  },
});

const stubSchema: SchemaContext = {
  entities: {
    contacts: {
      fields: {
        updatedAt: { type: 'date', numeric: false },
        id:        { type: 'string', numeric: false },
        tags:      { type: 'array', numeric: false },
        score:     { type: 'number', numeric: true },
      },
    },
    opportunities: {
      fields: {
        updatedAt: { type: 'date', numeric: false },
        stage:     { type: 'string', numeric: false },
        value:     { type: 'number', numeric: true },
      },
    },
  },
};

function makeDraft(overrides: Partial<DraftQueryPlan> = {}): DraftQueryPlan {
  return {
    source: 'canonical',
    intentClass: 'list_entities',
    primaryEntity: 'contacts',
    filters: [],
    limit: 100,
    canonicalCandidateKey: 'contacts.inactive_over_days',
    confidence: 1.0,
    ...overrides,
  };
}

function stage1Opts(overrides: Partial<ValidatorOptions> = {}): ValidatorOptions {
  return {
    mode: 'stage1',
    stageResolved: 1,
    costPreview: { predictedCostCents: 0, confidence: 'high', basedOn: 'static_heuristic' },
    entry: stubRegistry['contacts.inactive_over_days']!,
    registry: stubRegistry,
    callerCapabilities: new Set(['crm.query']),
    ...overrides,
  };
}

function fullOpts(overrides: Partial<ValidatorOptions> = {}): ValidatorOptions {
  return {
    mode: 'full',
    stageResolved: 3,
    costPreview: { predictedCostCents: 5, confidence: 'medium', basedOn: 'planner_estimate' },
    schemaContext: stubSchema,
    registry: stubRegistry,
    callerCapabilities: new Set(['crm.query']),
    ...overrides,
  };
}

// ── Stage1_mode tests ─────────────────────────────────────────────────────────

test('stage1_mode: valid draft passes and returns QueryPlan with validated:true', () => {
  const plan = validatePlanPure(makeDraft(), stage1Opts());
  expect(plan.validated, 'validated').toBe(true);
  expect(plan.stageResolved, 'stageResolved').toBe(1);
});

// Rule 2 — field existence (stage1_mode)
test('stage1_mode Rule 2: valid filter field passes', () => {
  const draft = makeDraft({ filters: [{ field: 'updatedAt', operator: 'lt', value: 30, humanLabel: 'lt 30' }] });
  const plan = validatePlanPure(draft, stage1Opts());
  expect(plan.validated, 'validated').toBeTruthy();
});

test('stage1_mode Rule 2: invalid filter field throws field_existence', () => {
  const draft = makeDraft({ filters: [{ field: 'nonexistent', operator: 'eq', value: 'x', humanLabel: 'x' }] });
  assertThrows(() => validatePlanPure(draft, stage1Opts()), 'field_existence');
});

test('stage1_mode Rule 2: invalid projection field throws field_existence', () => {
  const draft = makeDraft({ projection: ['nonexistent'] });
  assertThrows(() => validatePlanPure(draft, stage1Opts()), 'field_existence');
});

// Rule 3 — operator sanity (stage1_mode)
test('stage1_mode Rule 3: valid operator for field passes', () => {
  const draft = makeDraft({ filters: [{ field: 'updatedAt', operator: 'lt', value: 30, humanLabel: 'lt 30' }] });
  const plan = validatePlanPure(draft, stage1Opts());
  expect(plan.validated, 'validated').toBeTruthy();
});

test('stage1_mode Rule 3: invalid operator for field throws operator_sanity', () => {
  const draft = makeDraft({ filters: [{ field: 'updatedAt', operator: 'contains', value: 'x', humanLabel: 'x' }] });
  assertThrows(() => validatePlanPure(draft, stage1Opts()), 'operator_sanity');
});

test('stage1_mode Rule 3: eq not allowed on updatedAt throws operator_sanity', () => {
  const draft = makeDraft({ filters: [{ field: 'tags', operator: 'gt', value: 'x', humanLabel: 'x' }] });
  assertThrows(() => validatePlanPure(draft, stage1Opts()), 'operator_sanity');
});

// Rule 9 — projection overlap (stage1_mode)
test('stage1_mode Rule 9: projectable field passes', () => {
  const draft = makeDraft({ projection: ['updatedAt'] });
  const plan = validatePlanPure(draft, stage1Opts());
  expect(plan.validated, 'validated').toBeTruthy();
});

test('stage1_mode Rule 9: non-projectable field throws projection_overlap', () => {
  const draft = makeDraft({ projection: ['score'] }); // score is not projectable
  assertThrows(() => validatePlanPure(draft, stage1Opts()), 'projection_overlap');
});

test('stage1_mode Rule 9: unknown projection field throws field_existence', () => {
  const draft = makeDraft({ projection: ['unknown_field'] });
  assertThrows(() => validatePlanPure(draft, stage1Opts()), 'field_existence');
});

// ── Full mode tests ───────────────────────────────────────────────────────────

test('full mode: valid draft passes with validated:true and stageResolved:3', () => {
  const plan = validatePlanPure(makeDraft(), fullOpts());
  expect(plan.validated, 'validated').toBe(true);
  expect(plan.stageResolved, 'stageResolved').toBe(3);
});

// Rule 1 — entity existence
test('full mode Rule 1: valid entity passes', () => {
  const plan = validatePlanPure(makeDraft({ primaryEntity: 'opportunities' }), fullOpts());
  expect(plan.validated, 'validated').toBeTruthy();
});

test('full mode Rule 1: invalid entity throws entity_existence', () => {
  const draft = makeDraft({ primaryEntity: 'bogus_entity' as any });
  assertThrows(() => validatePlanPure(draft, fullOpts()), 'entity_existence');
});

// Rule 4 — date-range sanity
test('full mode Rule 4: from < to passes', () => {
  const draft = makeDraft({ dateContext: { kind: 'absolute', from: '2024-01-01', to: '2024-01-31' } });
  const plan = validatePlanPure(draft, fullOpts());
  expect(plan.validated, 'validated').toBeTruthy();
});

test('full mode Rule 4: from >= to throws date_range_sanity', () => {
  const draft = makeDraft({ dateContext: { kind: 'absolute', from: '2024-02-01', to: '2024-01-01' } });
  assertThrows(() => validatePlanPure(draft, fullOpts()), 'date_range_sanity');
});

// Rule 7 — hybrid pattern check
test('full mode Rule 7: hybrid without canonicalCandidateKey throws hybrid_pattern_check', () => {
  const draft = makeDraft({ source: 'hybrid', canonicalCandidateKey: null });
  assertThrows(() => validatePlanPure(draft, fullOpts()), 'hybrid_pattern_check');
});

test('full mode Rule 7: hybrid with valid canonicalCandidateKey passes', () => {
  const draft = makeDraft({ source: 'hybrid', canonicalCandidateKey: 'contacts.inactive_over_days' });
  const plan = validatePlanPure(draft, fullOpts());
  expect(plan.validated, 'validated').toBeTruthy();
});

test('full mode Rule 7: hybrid with unknown key throws hybrid_pattern_check', () => {
  const draft = makeDraft({ source: 'hybrid', canonicalCandidateKey: 'unknown.key' });
  assertThrows(() => validatePlanPure(draft, fullOpts()), 'hybrid_pattern_check');
});

// Rule 8 — canonical-precedence tie-breaker (three cases)
test('full mode Rule 8 case (a): live plan with no live-only filters promotes to canonical', () => {
  const draft = makeDraft({ source: 'live', canonicalCandidateKey: 'contacts.inactive_over_days' });
  const plan = validatePlanPure(draft, fullOpts());
  expect(plan.source, 'source promoted to canonical').toBe('canonical');
  expect(plan.validated, 'validated').toBeTruthy();
});

test('full mode Rule 8 case (b): live plan with exactly one live-only filter promotes to hybrid', () => {
  const draft = makeDraft({
    source: 'live',
    canonicalCandidateKey: 'contacts.inactive_over_days',
    filters: [{ field: 'city', operator: 'eq', value: 'Austin', humanLabel: 'City is Austin' }],
  });
  // schemaContext: null — skip field-existence so the precedence rule is the only gate under test
  const plan = validatePlanPure(draft, fullOpts({ schemaContext: null }));
  expect(plan.source, 'source promoted to hybrid').toBe('hybrid');
  expect(plan.hybridPattern, 'hybrid pattern pinned').toBe('canonical_base_with_live_filter');
  expect(plan.validated, 'validated').toBeTruthy();
});

test('full mode Rule 8 case (c): live plan with multiple live-only filters stays live', () => {
  const draft = makeDraft({
    source: 'live',
    canonicalCandidateKey: 'contacts.inactive_over_days',
    filters: [
      { field: 'city', operator: 'eq', value: 'Austin', humanLabel: 'City is Austin' },
      { field: 'country', operator: 'eq', value: 'US', humanLabel: 'Country is US' },
    ],
  });
  const plan = validatePlanPure(draft, fullOpts({ schemaContext: null }));
  expect(plan.source, 'source stays live when hybrid shape does not match').toBe('live');
});

test('full mode Rule 8: live plan without canonicalCandidateKey stays live', () => {
  const draft = makeDraft({ source: 'live', canonicalCandidateKey: null });
  const plan = validatePlanPure(draft, fullOpts());
  expect(plan.source, 'source stays live when no candidate key').toBe('live');
});

test('full mode Rule 8: non-canonical-resolvable filter blocks promotion to canonical — stays live', () => {
  // Zero live-only filters, but one non-live-only filter that is NOT in the
  // registry entry's allowedFields. Case (a) would promote to canonical and
  // the canonical executor would throw FieldOutOfScopeError → 500. Stay live.
  const draft = makeDraft({
    source: 'live',
    canonicalCandidateKey: 'contacts.inactive_over_days',
    filters: [{ field: 'bogus_field', operator: 'eq', value: 'x', humanLabel: 'bogus' }],
  });
  const plan = validatePlanPure(draft, fullOpts({ schemaContext: null }));
  expect(plan.source, 'source stays live — base not canonical-resolvable').toBe('live');
});

test('full mode Rule 8: non-canonical-resolvable base + one live-only filter blocks promotion to hybrid — stays live', () => {
  // Exactly one live-only filter would normally promote to hybrid, but an
  // extra non-live-only filter not in allowedFields would escape the hybrid
  // executor's canonical base as FieldOutOfScopeError. Stay live.
  const draft = makeDraft({
    source: 'live',
    canonicalCandidateKey: 'contacts.inactive_over_days',
    filters: [
      { field: 'city', operator: 'eq', value: 'Austin', humanLabel: 'City is Austin' },
      { field: 'bogus_field', operator: 'eq', value: 'x', humanLabel: 'bogus' },
    ],
  });
  const plan = validatePlanPure(draft, fullOpts({ schemaContext: null }));
  expect(plan.source, 'source stays live — hybrid base not canonical-resolvable').toBe('live');
});

test('full mode Rule 8: non-canonical projection field blocks promotion — stays live', () => {
  // Projection references a field not in allowedFields; canonicalExecutor
  // would throw FieldOutOfScopeError on projection. Stay live.
  const draft = makeDraft({
    source: 'live',
    canonicalCandidateKey: 'contacts.inactive_over_days',
    projection: ['bogus_projection_field'],
  });
  const plan = validatePlanPure(draft, fullOpts({ schemaContext: null }));
  expect(plan.source, 'source stays live — projection not canonical-resolvable').toBe('live');
});

test('full mode Rule 8: non-canonical sort field blocks promotion — stays live', () => {
  // Sort references a field not in allowedFields; canonicalExecutor would
  // throw FieldOutOfScopeError on sort. Stay live.
  const draft = makeDraft({
    source: 'live',
    canonicalCandidateKey: 'contacts.inactive_over_days',
    sort: [{ field: 'bogus_sort_field', direction: 'asc' }],
  });
  const plan = validatePlanPure(draft, fullOpts({ schemaContext: null }));
  expect(plan.source, 'source stays live — sort not canonical-resolvable').toBe('live');
});

test('full mode Rule 8: non-canonical aggregation field blocks promotion — stays live', () => {
  // Aggregation field not in allowedFields; canonicalExecutor would throw
  // FieldOutOfScopeError on aggregation.field. Stay live.
  const draft = makeDraft({
    source: 'live',
    canonicalCandidateKey: 'contacts.inactive_over_days',
    aggregation: { type: 'sum', field: 'bogus_agg_field' },
  });
  const plan = validatePlanPure(draft, fullOpts({ schemaContext: null }));
  expect(plan.source, 'source stays live — aggregation field not canonical-resolvable').toBe('live');
});

test('full mode Rule 8: non-canonical aggregation groupBy blocks promotion — stays live', () => {
  const draft = makeDraft({
    source: 'live',
    canonicalCandidateKey: 'contacts.inactive_over_days',
    aggregation: { type: 'group_by', groupBy: ['bogus_groupby_field'] },
  });
  const plan = validatePlanPure(draft, fullOpts({ schemaContext: null }));
  expect(plan.source, 'source stays live — groupBy not canonical-resolvable').toBe('live');
});

// Rule 10 — capability check
test('full mode Rule 10: known required capability caller lacks throws capability_check', () => {
  // Give canonical candidate a KNOWN (non-forward-looking) cap the caller lacks
  const registry: CanonicalQueryRegistry = {
    ...stubRegistry,
    'contacts.inactive_over_days': {
      ...stubRegistry['contacts.inactive_over_days']!,
      requiredCapabilities: ['crm.admin'], // known, not forward-looking
    },
  };
  const draft = makeDraft({ source: 'canonical', canonicalCandidateKey: 'contacts.inactive_over_days' });
  assertThrows(
    () => validatePlanPure(draft, fullOpts({ registry, callerCapabilities: new Set(['crm.query']) })),
    'capability_check',
  );
});

test('full mode Rule 10: forward-looking canonical.* capability is skipped', () => {
  const draft = makeDraft({ source: 'canonical', canonicalCandidateKey: 'contacts.inactive_over_days' });
  // canonical.contacts.read is forward-looking — should not fail even without it
  const plan = validatePlanPure(draft, fullOpts({ callerCapabilities: new Set() }));
  expect(plan.validated, 'forward-looking cap skipped').toBeTruthy();
});

// ── Summary ───────────────────────────────────────────────────────────────────
