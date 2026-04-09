/**
 * policyEngineService scope-validation tests — runnable via:
 *   npx tsx server/services/__tests__/policyEngineService.scopeValidation.test.ts
 *
 * Sprint 2 P1.1 regression guard for the rule matcher. Confirms that a
 * rule scoped to subaccount X is not applied to a context evaluated for
 * subaccount Y, and that org-wide rules (subaccountId: null) still apply
 * across every subaccount. Without this assertion a future refactor of
 * matchesRule could leak a privileged auto-rule across tenant
 * boundaries.
 *
 * Pure tests — no DB. We call `matchesRule` directly (exported for
 * tests) instead of going through evaluatePolicy.
 */

import { matchesRule } from '../policyEngineService.js';
import type { PolicyRule } from '../../db/schema/policyRules.js';

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

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const SUB_X = '11111111-1111-1111-1111-1111111111aa';
const SUB_Y = '11111111-1111-1111-1111-1111111111bb';

/** Build a minimal PolicyRule for tests. */
function rule(partial: Partial<PolicyRule> = {}): PolicyRule {
  const base: PolicyRule = {
    id: '22222222-2222-2222-2222-222222222222',
    organisationId: ORG_A,
    subaccountId: null,
    toolSlug: 'send_email',
    priority: 100,
    conditions: {},
    decision: 'review',
    evaluationMode: 'first_match',
    interruptConfig: null,
    allowedDecisions: null,
    descriptionTemplate: null,
    timeoutSeconds: null,
    timeoutPolicy: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  return { ...base, ...partial };
}

console.log('');
console.log('policyEngineService.matchesRule — Sprint 2 P1.1 scope validation');
console.log('');

// ── Tool slug matching ─────────────────────────────────────────────
test('exact tool slug matches', () => {
  assert(
    matchesRule(
      rule({ toolSlug: 'send_email' }),
      { toolSlug: 'send_email', subaccountId: SUB_X, organisationId: ORG_A },
    ),
    'exact match',
  );
});

test('wildcard tool slug matches any tool', () => {
  assert(
    matchesRule(
      rule({ toolSlug: '*' }),
      { toolSlug: 'send_email', subaccountId: SUB_X, organisationId: ORG_A },
    ),
    'wildcard matches send_email',
  );
  assert(
    matchesRule(
      rule({ toolSlug: '*' }),
      { toolSlug: 'create_deal', subaccountId: SUB_X, organisationId: ORG_A },
    ),
    'wildcard matches create_deal',
  );
});

test('different tool slug does not match', () => {
  assert(
    !matchesRule(
      rule({ toolSlug: 'send_email' }),
      { toolSlug: 'create_deal', subaccountId: SUB_X, organisationId: ORG_A },
    ),
    'rule for send_email must not apply to create_deal',
  );
});

// ── Subaccount scoping (the primary guard) ─────────────────────────
test('org-wide rule (subaccountId: null) applies to any subaccount', () => {
  const r = rule({ subaccountId: null });
  assert(
    matchesRule(r, { toolSlug: 'send_email', subaccountId: SUB_X, organisationId: ORG_A }),
    'org-wide rule applies to SUB_X',
  );
  assert(
    matchesRule(r, { toolSlug: 'send_email', subaccountId: SUB_Y, organisationId: ORG_A }),
    'org-wide rule applies to SUB_Y',
  );
});

test('subaccount-scoped rule matches the same subaccount', () => {
  assert(
    matchesRule(
      rule({ subaccountId: SUB_X }),
      { toolSlug: 'send_email', subaccountId: SUB_X, organisationId: ORG_A },
    ),
    'same subaccount matches',
  );
});

test('subaccount-scoped rule does NOT leak to a different subaccount', () => {
  // This is the core regression guard. A rule scoped to SUB_X must not
  // apply to a context evaluated for SUB_Y — even within the same org.
  assert(
    !matchesRule(
      rule({ subaccountId: SUB_X, decision: 'auto' }),
      { toolSlug: 'send_email', subaccountId: SUB_Y, organisationId: ORG_A },
    ),
    'cross-subaccount rule must not match',
  );
});

// ── Conditions matching ────────────────────────────────────────────
test('empty conditions always match', () => {
  assert(
    matchesRule(
      rule({ conditions: {} }),
      { toolSlug: 'send_email', subaccountId: SUB_X, organisationId: ORG_A, input: {} },
    ),
    'empty conditions',
  );
});

test('condition equality matches identical input', () => {
  assert(
    matchesRule(
      rule({ conditions: { recipient_type: 'internal' } }),
      {
        toolSlug: 'send_email',
        subaccountId: SUB_X,
        organisationId: ORG_A,
        input: { recipient_type: 'internal', subject: 'hi' },
      },
    ),
    'matching condition',
  );
});

test('condition mismatch fails the match', () => {
  assert(
    !matchesRule(
      rule({ conditions: { recipient_type: 'internal' } }),
      {
        toolSlug: 'send_email',
        subaccountId: SUB_X,
        organisationId: ORG_A,
        input: { recipient_type: 'external' },
      },
    ),
    'mismatching condition must not apply',
  );
});

test('conditions present but no input fails the match', () => {
  assert(
    !matchesRule(
      rule({ conditions: { recipient_type: 'internal' } }),
      { toolSlug: 'send_email', subaccountId: SUB_X, organisationId: ORG_A },
    ),
    'missing input with required conditions must not match',
  );
});

// ── Layered checks ─────────────────────────────────────────────────
test('subaccount mismatch short-circuits even if conditions would match', () => {
  assert(
    !matchesRule(
      rule({
        subaccountId: SUB_X,
        conditions: { recipient_type: 'internal' },
      }),
      {
        toolSlug: 'send_email',
        subaccountId: SUB_Y,
        organisationId: ORG_A,
        input: { recipient_type: 'internal' },
      },
    ),
    'subaccount gate beats condition match',
  );
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
