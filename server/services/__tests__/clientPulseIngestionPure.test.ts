/**
 * clientPulseIngestionPure.test.ts — Pure tests for the observation-shaping
 * helpers in clientPulseIngestionService.ts. DB writes are not exercised here;
 * those are covered by the integration test.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/clientPulseIngestionPure.test.ts
 */

import {
  observationFromFunnels,
  observationFromCalendars,
  observationFromSubscription,
  CLIENT_PULSE_SIGNAL_SLUGS,
} from '../clientPulseIngestionServicePure.js';
import { assertCanonicalUniqueness, CANONICAL_UNIQUENESS_MODE } from '../../db/schema/clientPulseCanonicalTables.js';

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

const base = {
  organisationId: 'org-1',
  subaccountId: 'sub-1',
  connectorConfigId: 'cfg-1',
  observedAt: new Date('2026-04-19T00:00:00Z'),
  sourceRunId: undefined,
};

// ── Ship-gate sanity: all 8 signal slugs are declared ─────────────────────

test('CLIENT_PULSE_SIGNAL_SLUGS includes all 8 signals from §2', () => {
  assert(CLIENT_PULSE_SIGNAL_SLUGS.length === 8, `expected 8 signals, got ${CLIENT_PULSE_SIGNAL_SLUGS.length}`);
  const expected = [
    'staff_activity_pulse',
    'funnel_count',
    'calendar_quality',
    'contact_activity',
    'integration_fingerprint',
    'subscription_tier',
    'ai_feature_usage',
    'opportunity_pipeline',
  ];
  for (const slug of expected) {
    assert(CLIENT_PULSE_SIGNAL_SLUGS.includes(slug as never), `missing signal: ${slug}`);
  }
});

// ── funnel_count observation shaping ──────────────────────────────────────

test('observationFromFunnels — available result writes count + funnelIds', () => {
  const r = observationFromFunnels(base, {
    availability: 'available',
    data: [
      { id: 'f1', name: 'Lead Magnet' },
      { id: 'f2', name: 'Webinar' },
    ],
  });
  assert(r.signalSlug === 'funnel_count', 'wrong slug');
  assert(r.numericValue === 2, `expected 2, got ${r.numericValue}`);
  assert(r.availability === 'available', 'wrong availability');
  assert(Array.isArray((r.jsonPayload as { funnelIds: unknown[] }).funnelIds), 'funnelIds missing');
});

test('observationFromFunnels — missing-scope result writes availability flag', () => {
  const r = observationFromFunnels(base, {
    availability: 'unavailable_missing_scope',
    data: null,
    errorCode: 'http_403',
  });
  assert(r.signalSlug === 'funnel_count', 'wrong slug');
  assert(r.numericValue === null, 'numericValue should be null');
  assert(r.availability === 'unavailable_missing_scope', 'availability should be missing_scope');
});

// ── calendar_quality observation shaping ──────────────────────────────────

test('observationFromCalendars — computes configured ratio as percentage', () => {
  const r = observationFromCalendars(
    base,
    {
      availability: 'available',
      data: [
        { id: 'c1', name: 'Sales', teamMembers: [{ userId: 'u1' }] },
        { id: 'c2', name: 'Support', teamMembers: [] },
        { id: 'c3', name: 'Demo', teamMembers: [{ userId: 'u2' }, { userId: 'u3' }] },
        { id: 'c4', name: 'Empty' }, // teamMembers absent
      ],
    },
    { availability: 'available', data: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3', deleted: true }] },
  );
  assert(r.signalSlug === 'calendar_quality', 'wrong slug');
  // 2 of 4 calendars have teamMembers → 50
  assert(r.numericValue === 50, `expected 50, got ${r.numericValue}`);
  const payload = r.jsonPayload as { totalCalendars: number; configuredCalendars: number; teamMemberCount: number };
  assert(payload.totalCalendars === 4, 'totalCalendars wrong');
  assert(payload.configuredCalendars === 2, 'configuredCalendars wrong');
  // 2 of 3 users undeleted
  assert(payload.teamMemberCount === 2, `teamMemberCount should be 2, got ${payload.teamMemberCount}`);
});

test('observationFromCalendars — zero calendars returns 0 ratio, not NaN', () => {
  const r = observationFromCalendars(
    base,
    { availability: 'available', data: [] },
    { availability: 'available', data: [] },
  );
  assert(r.numericValue === 0, `expected 0, got ${r.numericValue}`);
});

test('observationFromCalendars — missing calendar scope returns unavailable', () => {
  const r = observationFromCalendars(
    base,
    { availability: 'unavailable_missing_scope', data: null, errorCode: 'http_403' },
    { availability: 'available', data: [] },
  );
  assert(r.availability === 'unavailable_missing_scope', 'availability should be missing_scope');
  assert(r.numericValue === null, 'numericValue should be null');
});

// ── subscription_tier observation shaping ─────────────────────────────────

test('observationFromSubscription — active plan writes numericValue=1', () => {
  const r = observationFromSubscription(base, {
    availability: 'available',
    data: {
      planId: 'plan_abc',
      tier: 'premium',
      active: true,
      nextBillingDate: '2026-05-01T00:00:00Z',
      raw: {},
    },
  });
  assert(r.signalSlug === 'subscription_tier', 'wrong slug');
  assert(r.numericValue === 1, 'numericValue should be 1 for active');
  const payload = r.jsonPayload as { tier: string; active: boolean };
  assert(payload.tier === 'premium', 'tier payload missing');
  assert(payload.active === true, 'active payload wrong');
});

test('observationFromSubscription — tier-gated (non-SaaS agency) returns unavailable_tier_gated', () => {
  const r = observationFromSubscription(base, {
    availability: 'unavailable_tier_gated',
    data: null,
    errorCode: 'http_404',
  });
  assert(r.availability === 'unavailable_tier_gated', 'availability wrong');
  assert(r.numericValue === null, 'numericValue should be null');
});

test('observationFromSubscription — inactive plan still writes numericValue=0', () => {
  const r = observationFromSubscription(base, {
    availability: 'available',
    data: { tier: 'basic', active: false, raw: {} },
  });
  assert(r.numericValue === 0, 'numericValue should be 0 for inactive');
});

// ── assertCanonicalUniqueness — enforce scoped-mode requires subaccountId ──

test('assertCanonicalUniqueness allows scoped table with subaccountId', () => {
  assertCanonicalUniqueness('canonical_subaccount_mutations', { subaccountId: 'sub-1' });
  // If no throw, pass
});

test('assertCanonicalUniqueness throws on scoped table without subaccountId', () => {
  let threw = false;
  try {
    assertCanonicalUniqueness('canonical_subaccount_mutations', { subaccountId: null });
  } catch {
    threw = true;
  }
  assert(threw, 'should throw when scoped table has null subaccountId');
});

test('assertCanonicalUniqueness throws on scoped table with undefined subaccountId', () => {
  let threw = false;
  try {
    assertCanonicalUniqueness('canonical_subaccount_mutations', {});
  } catch {
    threw = true;
  }
  assert(threw, 'should throw when scoped table has no subaccountId key');
});

test('assertCanonicalUniqueness allows global table with or without subaccountId', () => {
  assertCanonicalUniqueness('canonical_conversation_providers', { subaccountId: 'sub-1' });
  assertCanonicalUniqueness('canonical_conversation_providers', { subaccountId: null });
  // Global tables tolerate either — uniqueness index does not key on subaccountId
});

test('assertCanonicalUniqueness throws on unregistered table', () => {
  let threw = false;
  try {
    assertCanonicalUniqueness('bogus_not_a_real_table', { subaccountId: 'sub-1' });
  } catch {
    threw = true;
  }
  assert(threw, 'should throw on unknown table');
});

test('CANONICAL_UNIQUENESS_MODE covers all 6 canonical tables from migration 0172', () => {
  const expected = [
    'canonical_subaccount_mutations',
    'canonical_conversation_providers',
    'canonical_workflow_definitions',
    'canonical_tag_definitions',
    'canonical_custom_field_definitions',
    'canonical_contact_sources',
  ];
  for (const t of expected) {
    assert(CANONICAL_UNIQUENESS_MODE[t] !== undefined, `missing mode for ${t}`);
  }
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log('');
console.log(`clientPulseIngestionPure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
