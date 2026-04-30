/**
 * clientPulseIngestionPure.test.ts — Pure tests for the observation-shaping
 * helpers in clientPulseIngestionService.ts. DB writes are not exercised here;
 * those are covered by the integration test.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/clientPulseIngestionPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  observationFromFunnels,
  observationFromCalendars,
  observationFromSubscription,
  CLIENT_PULSE_SIGNAL_SLUGS,
} from '../clientPulseIngestionServicePure.js';
import { assertCanonicalUniqueness, CANONICAL_UNIQUENESS_MODE } from '../../db/schema/clientPulseCanonicalTables.js';

const base = {
  organisationId: 'org-1',
  subaccountId: 'sub-1',
  connectorConfigId: 'cfg-1',
  observedAt: new Date('2026-04-19T00:00:00Z'),
  sourceRunId: undefined,
};

// ── Ship-gate sanity: all 8 signal slugs are declared ─────────────────────

test('CLIENT_PULSE_SIGNAL_SLUGS includes all 8 signals from §2', () => {
  expect(CLIENT_PULSE_SIGNAL_SLUGS.length === 8, `expected 8 signals, got ${CLIENT_PULSE_SIGNAL_SLUGS.length}`).toBeTruthy();
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
    expect(CLIENT_PULSE_SIGNAL_SLUGS.includes(slug as never), `missing signal: ${slug}`).toBeTruthy();
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
  expect(r.signalSlug === 'funnel_count', 'wrong slug').toBeTruthy();
  expect(r.numericValue === 2, `expected 2, got ${r.numericValue}`).toBeTruthy();
  expect(r.availability === 'available', 'wrong availability').toBeTruthy();
  expect(Array.isArray((r.jsonPayload as { funnelIds: unknown[] }).funnelIds), 'funnelIds missing').toBeTruthy();
});

test('observationFromFunnels — missing-scope result writes availability flag', () => {
  const r = observationFromFunnels(base, {
    availability: 'unavailable_missing_scope',
    data: null,
    errorCode: 'http_403',
  });
  expect(r.signalSlug === 'funnel_count', 'wrong slug').toBeTruthy();
  expect(r.numericValue === null, 'numericValue should be null').toBeTruthy();
  expect(r.availability === 'unavailable_missing_scope', 'availability should be missing_scope').toBeTruthy();
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
  expect(r.signalSlug === 'calendar_quality', 'wrong slug').toBeTruthy();
  // 2 of 4 calendars have teamMembers → 50
  expect(r.numericValue === 50, `expected 50, got ${r.numericValue}`).toBeTruthy();
  const payload = r.jsonPayload as { totalCalendars: number; configuredCalendars: number; teamMemberCount: number };
  expect(payload.totalCalendars === 4, 'totalCalendars wrong').toBeTruthy();
  expect(payload.configuredCalendars === 2, 'configuredCalendars wrong').toBeTruthy();
  // 2 of 3 users undeleted
  expect(payload.teamMemberCount === 2, `teamMemberCount should be 2, got ${payload.teamMemberCount}`).toBeTruthy();
});

test('observationFromCalendars — zero calendars returns 0 ratio, not NaN', () => {
  const r = observationFromCalendars(
    base,
    { availability: 'available', data: [] },
    { availability: 'available', data: [] },
  );
  expect(r.numericValue === 0, `expected 0, got ${r.numericValue}`).toBeTruthy();
});

test('observationFromCalendars — missing calendar scope returns unavailable', () => {
  const r = observationFromCalendars(
    base,
    { availability: 'unavailable_missing_scope', data: null, errorCode: 'http_403' },
    { availability: 'available', data: [] },
  );
  expect(r.availability === 'unavailable_missing_scope', 'availability should be missing_scope').toBeTruthy();
  expect(r.numericValue === null, 'numericValue should be null').toBeTruthy();
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
  expect(r.signalSlug === 'subscription_tier', 'wrong slug').toBeTruthy();
  expect(r.numericValue === 1, 'numericValue should be 1 for active').toBeTruthy();
  const payload = r.jsonPayload as { tier: string; active: boolean };
  expect(payload.tier === 'premium', 'tier payload missing').toBeTruthy();
  expect(payload.active === true, 'active payload wrong').toBeTruthy();
});

test('observationFromSubscription — tier-gated (non-SaaS agency) returns unavailable_tier_gated', () => {
  const r = observationFromSubscription(base, {
    availability: 'unavailable_tier_gated',
    data: null,
    errorCode: 'http_404',
  });
  expect(r.availability === 'unavailable_tier_gated', 'availability wrong').toBeTruthy();
  expect(r.numericValue === null, 'numericValue should be null').toBeTruthy();
});

test('observationFromSubscription — inactive plan still writes numericValue=0', () => {
  const r = observationFromSubscription(base, {
    availability: 'available',
    data: { tier: 'basic', active: false, raw: {} },
  });
  expect(r.numericValue === 0, 'numericValue should be 0 for inactive').toBeTruthy();
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
  expect(threw, 'should throw when scoped table has null subaccountId').toBeTruthy();
});

test('assertCanonicalUniqueness throws on scoped table with undefined subaccountId', () => {
  let threw = false;
  try {
    assertCanonicalUniqueness('canonical_subaccount_mutations', {});
  } catch {
    threw = true;
  }
  expect(threw, 'should throw when scoped table has no subaccountId key').toBeTruthy();
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
  expect(threw, 'should throw on unknown table').toBeTruthy();
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
    expect(CANONICAL_UNIQUENESS_MODE[t] !== undefined, `missing mode for ${t}`).toBeTruthy();
  }
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log('');
