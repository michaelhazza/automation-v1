/**
 * invokeAutomationStepPure — unit tests.
 * runnable via: npx tsx server/services/__tests__/invokeAutomationStepPure.test.ts
 *
 * Spec §11.2 Part 2 test matrix:
 *   - §5.7 error_code vocabulary
 *   - §5.8 scope-matching branch
 *   - §5.4a retry-guard clamp (authored maxAttempts > 3 → 3)
 *   - §5.4a overrideNonIdempotentGuard opt-in
 *   - §5.10a dispatch-time composition rejection (scope mismatch)
 *   - gate resolution from side_effects column (§5.4a rule 1)
 *   - input mapping resolution (§5.4)
 *   - output mapping projection (§5.5)
 */

import type { Automation } from '../../db/schema/automations.js';
import type { InvokeAutomationStep } from '../../lib/workflow/types.js';
import {
  resolveDispatch,
  resolveGateLevel,
  checkScope,
  shouldBlock_nonIdempotentGuard,
  clampMaxAttempts,
  projectOutputMapping,
  MAX_RETRY_ATTEMPTS,
  type RunScope,
  type TemplateCtx,
} from '../invokeAutomationStepPure.js';

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

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    name: 'Test Automation',
    organisationId: 'org-1',
    subaccountId: null,
    workflowEngineId: 'engine-1',
    webhookPath: '/webhook/test',
    inputSchema: null,
    outputSchema: null,
    requiredConnections: null,
    sideEffects: 'unknown',
    idempotent: false,
    status: 'active',
    description: null,
    orgCategoryId: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Automation;
}

function makeStep(overrides: Partial<InvokeAutomationStep> = {}): InvokeAutomationStep {
  return {
    id: 'step-1',
    name: 'Call Test Automation',
    type: 'invoke_automation',
    dependsOn: [],
    sideEffectType: 'reversible',
    outputSchema: {} as never,
    automationId: 'auto-1',
    inputMapping: { email: '{{ run.input.email }}' },
    ...overrides,
  } as InvokeAutomationStep;
}

const orgRun: RunScope = { organisationId: 'org-1', subaccountId: null };
const subRun: RunScope = { organisationId: 'org-1', subaccountId: 'sub-1' };
const ctx: TemplateCtx = { run: { input: { email: 'test@example.com' } } };
const renderTemplate = (expr: string, _ctx: TemplateCtx) =>
  expr.replace(/\{\{\s*run\.input\.(\w+)\s*\}\}/g, (_, k) => ((ctx.run as { input: Record<string,unknown> }).input[k] ?? '') as string);

// ── §5.8 Scope matching ───────────────────────────────────────────────────────

console.log('\n── §5.8 Scope matching ──');

test('org-scope automation accessible from org run', () => {
  assert(checkScope(orgRun, makeAutomation({ subaccountId: null })), 'org auto should be accessible from org run');
});

test('org-scope automation accessible from subaccount run', () => {
  assert(checkScope(subRun, makeAutomation({ subaccountId: null })), 'org auto should be accessible from subaccount run');
});

test('subaccount-native automation accessible from matching subaccount run', () => {
  assert(checkScope(subRun, makeAutomation({ subaccountId: 'sub-1' })), 'native auto accessible from matching subaccount');
});

test('subaccount-native automation not accessible from different subaccount run', () => {
  const otherRun: RunScope = { organisationId: 'org-1', subaccountId: 'sub-2' };
  assert(!checkScope(otherRun, makeAutomation({ subaccountId: 'sub-1' })), 'native auto should not cross subaccounts');
});

test('wrong org → scope mismatch', () => {
  const wrongOrgRun: RunScope = { organisationId: 'org-WRONG', subaccountId: null };
  assert(!checkScope(wrongOrgRun, makeAutomation()), 'wrong org should fail scope check');
});

test('resolveDispatch emits automation_scope_mismatch error code', () => {
  const wrongOrgRun: RunScope = { organisationId: 'org-WRONG', subaccountId: null };
  const result = resolveDispatch({
    step: makeStep(), run: wrongOrgRun, automation: makeAutomation(),
    engineBaseUrl: 'https://engine.example.com', renderTemplate, templateCtx: ctx,
  });
  assert(result.kind === 'error', 'should be error');
  if (result.kind === 'error') {
    assertEqual(result.error.code, 'automation_scope_mismatch', 'error code');
    // §5.7: automation_scope_mismatch is a pre-dispatch resolution failure
    // → 'execution' bucket. The test previously asserted 'validation' —
    // that matched the dispatcher bug, not the spec. Updated per spec.
    assertEqual(result.error.type, 'execution', 'error type');
    assertEqual(result.error.retryable, false, 'not retryable');
  }
});

// ── §5.4a Retry guard and clamp ───────────────────────────────────────────────

console.log('\n── §5.4a Retry guard + clamp ──');

test('clampMaxAttempts caps at 3', () => {
  assertEqual(clampMaxAttempts(10), MAX_RETRY_ATTEMPTS, 'max 10 → 3');
  assertEqual(clampMaxAttempts(4), MAX_RETRY_ATTEMPTS, 'max 4 → 3');
  assertEqual(clampMaxAttempts(3), 3, 'max 3 → 3');
  assertEqual(clampMaxAttempts(1), 1, 'max 1 → 1');
  assertEqual(clampMaxAttempts(undefined), MAX_RETRY_ATTEMPTS, 'undefined → 3');
});

test('non-idempotent automation blocks retry on attempt 2', () => {
  const auto = makeAutomation({ idempotent: false });
  const step = makeStep();
  assert(!shouldBlock_nonIdempotentGuard(auto, step, 1), 'attempt 1 should not block');
  assert(shouldBlock_nonIdempotentGuard(auto, step, 2), 'attempt 2 should block');
});

test('idempotent automation allows retry on attempt 2', () => {
  const auto = makeAutomation({ idempotent: true });
  const step = makeStep();
  assert(!shouldBlock_nonIdempotentGuard(auto, step, 2), 'idempotent should allow retry');
});

test('overrideNonIdempotentGuard bypasses retry block', () => {
  const auto = makeAutomation({ idempotent: false });
  const step = makeStep({ automationRetryPolicy: { maxAttempts: 2, overrideNonIdempotentGuard: true } });
  assert(!shouldBlock_nonIdempotentGuard(auto, step, 2), 'override should bypass block');
});

// ── §5.4a Gate resolution ─────────────────────────────────────────────────────

console.log('\n── §5.4a Gate resolution ──');

test('read_only automation → auto gate', () => {
  const auto = makeAutomation({ sideEffects: 'read_only' });
  assertEqual(resolveGateLevel(makeStep(), auto), 'auto', 'read_only → auto');
});

test('mutating automation → review gate', () => {
  const auto = makeAutomation({ sideEffects: 'mutating' });
  assertEqual(resolveGateLevel(makeStep(), auto), 'review', 'mutating → review');
});

test('unknown automation → review gate (safe default)', () => {
  const auto = makeAutomation({ sideEffects: 'unknown' });
  assertEqual(resolveGateLevel(makeStep(), auto), 'review', 'unknown → review');
});

test('explicit step gateLevel overrides automation side_effects', () => {
  const auto = makeAutomation({ sideEffects: 'mutating' });
  const step = makeStep({ gateLevel: 'auto' });
  assertEqual(resolveGateLevel(step, auto), 'auto', 'explicit gateLevel: auto wins');
});

// ── §5.4 Input mapping resolution ────────────────────────────────────────────

console.log('\n── §5.4 Input mapping ──');

test('resolveDispatch resolves template expressions in inputMapping', () => {
  const auto = makeAutomation({ sideEffects: 'read_only' });
  const result = resolveDispatch({
    step: makeStep({ inputMapping: { email: '{{ run.input.email }}' } }),
    run: orgRun, automation: auto,
    engineBaseUrl: 'https://engine.example.com', renderTemplate, templateCtx: ctx,
  });
  assert(result.kind === 'dispatch', 'should dispatch');
  if (result.kind === 'dispatch') {
    assertEqual(result.body.email as string, 'test@example.com', 'resolved email');
  }
});

test('resolveDispatch constructs webhookUrl from engineBaseUrl + webhookPath', () => {
  const auto = makeAutomation({ sideEffects: 'read_only', webhookPath: '/webhook/abc' });
  const result = resolveDispatch({
    step: makeStep(), run: orgRun, automation: auto,
    engineBaseUrl: 'https://engine.example.com', renderTemplate, templateCtx: ctx,
  });
  assert(result.kind === 'dispatch', 'should dispatch');
  if (result.kind === 'dispatch') {
    assertEqual(result.webhookUrl, 'https://engine.example.com/webhook/abc', 'webhook URL');
  }
});

// ── §5.5 Output mapping projection ───────────────────────────────────────────

console.log('\n── §5.5 Output mapping ──');

test('projectOutputMapping without outputMapping returns { response: body }', () => {
  const result = projectOutputMapping({ status: 'ok' }, undefined, renderTemplate, ctx);
  assertEqual(result, { response: { status: 'ok' } }, 'full response in .response');
});

test('projectOutputMapping with outputMapping projects fields', () => {
  const render = (_expr: string, _c: TemplateCtx) => 'projected-value';
  const result = projectOutputMapping({ id: '123' }, { contactId: '{{ response.id }}' }, render, ctx);
  assertEqual(result, { contactId: 'projected-value' }, 'projected field');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
