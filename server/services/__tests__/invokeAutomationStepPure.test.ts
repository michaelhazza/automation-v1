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

import { expect, test } from 'vitest';
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
    automationEngineId: 'engine-1',
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
  expect(checkScope(orgRun, makeAutomation({ subaccountId: null })), 'org auto should be accessible from org run').toBeTruthy();
});

test('org-scope automation accessible from subaccount run', () => {
  expect(checkScope(subRun, makeAutomation({ subaccountId: null })), 'org auto should be accessible from subaccount run').toBeTruthy();
});

test('subaccount-native automation accessible from matching subaccount run', () => {
  expect(checkScope(subRun, makeAutomation({ subaccountId: 'sub-1' })), 'native auto accessible from matching subaccount').toBeTruthy();
});

test('subaccount-native automation not accessible from different subaccount run', () => {
  const otherRun: RunScope = { organisationId: 'org-1', subaccountId: 'sub-2' };
  expect(!checkScope(otherRun, makeAutomation({ subaccountId: 'sub-1' })), 'native auto should not cross subaccounts').toBeTruthy();
});

test('wrong org → scope mismatch', () => {
  const wrongOrgRun: RunScope = { organisationId: 'org-WRONG', subaccountId: null };
  expect(!checkScope(wrongOrgRun, makeAutomation()), 'wrong org should fail scope check').toBeTruthy();
});

test('system-scoped automation (organisationId=null) accessible from any run', () => {
  const sysAuto = makeAutomation({ organisationId: null as unknown as string, subaccountId: null });
  expect(checkScope(orgRun, sysAuto), 'system auto should be accessible from org run').toBeTruthy();
  expect(checkScope(subRun, sysAuto), 'system auto should be accessible from subaccount run').toBeTruthy();
});

test('resolveDispatch emits automation_scope_mismatch error code', () => {
  const wrongOrgRun: RunScope = { organisationId: 'org-WRONG', subaccountId: null };
  const result = resolveDispatch({
    step: makeStep(), run: wrongOrgRun, automation: makeAutomation(),
    engineBaseUrl: 'https://engine.example.com', renderTemplate, templateCtx: ctx,
  });
  expect(result.kind === 'error', 'should be error').toBeTruthy();
  if (result.kind === 'error') {
    expect(result.error.code, 'error code').toBe('automation_scope_mismatch');
    // §5.7: automation_scope_mismatch is a pre-dispatch resolution failure
    // → 'execution' bucket. The test previously asserted 'validation' —
    // that matched the dispatcher bug, not the spec. Updated per spec.
    expect(result.error.type, 'error type').toBe('execution');
    expect(result.error.retryable, 'not retryable').toBe(false);
  }
});

// ── §5.10a rule 4 — multi-webhook assertion ───────────────────────────────────

console.log('\n── §5.10a Multi-webhook assertion ──');

test('resolveDispatch rejects empty webhookPath', () => {
  const auto = makeAutomation({ sideEffects: 'read_only', webhookPath: '' });
  const result = resolveDispatch({
    step: makeStep(), run: orgRun, automation: auto,
    engineBaseUrl: 'https://engine.example.com', renderTemplate, templateCtx: ctx,
  });
  expect(result.kind === 'error', 'should be error').toBeTruthy();
  if (result.kind === 'error') {
    expect(result.error.code, 'error code').toBe('automation_composition_invalid');
    expect(result.error.type, 'error type').toBe('validation');
    expect(result.error.retryable, 'not retryable').toBe(false);
  }
});

test('resolveDispatch rejects comma-separated webhookPath (multi-webhook)', () => {
  const auto = makeAutomation({ sideEffects: 'read_only', webhookPath: '/webhook/a,/webhook/b' });
  const result = resolveDispatch({
    step: makeStep(), run: orgRun, automation: auto,
    engineBaseUrl: 'https://engine.example.com', renderTemplate, templateCtx: ctx,
  });
  expect(result.kind === 'error', 'should be error').toBeTruthy();
  if (result.kind === 'error') {
    expect(result.error.code, 'error code').toBe('automation_composition_invalid');
  }
});

test('resolveDispatch accepts valid single webhookPath', () => {
  const auto = makeAutomation({ sideEffects: 'read_only', webhookPath: '/webhook/test' });
  const result = resolveDispatch({
    step: makeStep(), run: orgRun, automation: auto,
    engineBaseUrl: 'https://engine.example.com', renderTemplate, templateCtx: ctx,
  });
  expect(result.kind === 'dispatch', 'should dispatch with valid path').toBeTruthy();
});

// ── §5.4a Retry guard and clamp ───────────────────────────────────────────────

console.log('\n── §5.4a Retry guard + clamp ──');

test('clampMaxAttempts caps at 3', () => {
  expect(clampMaxAttempts(10), 'max 10 → 3').toEqual(MAX_RETRY_ATTEMPTS);
  expect(clampMaxAttempts(4), 'max 4 → 3').toEqual(MAX_RETRY_ATTEMPTS);
  expect(clampMaxAttempts(3), 'max 3 → 3').toBe(3);
  expect(clampMaxAttempts(1), 'max 1 → 1').toBe(1);
  expect(clampMaxAttempts(undefined), 'undefined → 3').toEqual(MAX_RETRY_ATTEMPTS);
});

test('non-idempotent automation blocks retry on attempt 2', () => {
  const auto = makeAutomation({ idempotent: false });
  const step = makeStep();
  expect(!shouldBlock_nonIdempotentGuard(auto, step, 1), 'attempt 1 should not block').toBeTruthy();
  expect(shouldBlock_nonIdempotentGuard(auto, step, 2), 'attempt 2 should block').toBeTruthy();
});

test('idempotent automation allows retry on attempt 2', () => {
  const auto = makeAutomation({ idempotent: true });
  const step = makeStep();
  expect(!shouldBlock_nonIdempotentGuard(auto, step, 2), 'idempotent should allow retry').toBeTruthy();
});

test('overrideNonIdempotentGuard bypasses retry block', () => {
  const auto = makeAutomation({ idempotent: false });
  const step = makeStep({ automationRetryPolicy: { maxAttempts: 2, overrideNonIdempotentGuard: true } });
  expect(!shouldBlock_nonIdempotentGuard(auto, step, 2), 'override should bypass block').toBeTruthy();
});

// ── §5.4a Gate resolution ─────────────────────────────────────────────────────

console.log('\n── §5.4a Gate resolution ──');

test('read_only automation → auto gate', () => {
  const auto = makeAutomation({ sideEffects: 'read_only' });
  expect(resolveGateLevel(makeStep(), auto), 'read_only → auto').toBe('auto');
});

test('mutating automation → review gate', () => {
  const auto = makeAutomation({ sideEffects: 'mutating' });
  expect(resolveGateLevel(makeStep(), auto), 'mutating → review').toBe('review');
});

test('unknown automation → review gate (safe default)', () => {
  const auto = makeAutomation({ sideEffects: 'unknown' });
  expect(resolveGateLevel(makeStep(), auto), 'unknown → review').toBe('review');
});

test('explicit step gateLevel overrides automation side_effects', () => {
  const auto = makeAutomation({ sideEffects: 'mutating' });
  const step = makeStep({ gateLevel: 'auto' });
  expect(resolveGateLevel(step, auto), 'explicit gateLevel: auto wins').toBe('auto');
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
  expect(result.kind === 'dispatch', 'should dispatch').toBeTruthy();
  if (result.kind === 'dispatch') {
    expect(result.body.email as string, 'resolved email').toBe('test@example.com');
  }
});

test('resolveDispatch constructs webhookUrl from engineBaseUrl + webhookPath', () => {
  const auto = makeAutomation({ sideEffects: 'read_only', webhookPath: '/webhook/abc' });
  const result = resolveDispatch({
    step: makeStep(), run: orgRun, automation: auto,
    engineBaseUrl: 'https://engine.example.com', renderTemplate, templateCtx: ctx,
  });
  expect(result.kind === 'dispatch', 'should dispatch').toBeTruthy();
  if (result.kind === 'dispatch') {
    expect(result.webhookUrl, 'webhook URL').toBe('https://engine.example.com/webhook/abc');
  }
});

// ── §5.5 Output mapping projection ───────────────────────────────────────────

console.log('\n── §5.5 Output mapping ──');

test('projectOutputMapping without outputMapping returns { response: body }', () => {
  const result = projectOutputMapping({ status: 'ok' }, undefined, renderTemplate, ctx);
  expect(result, 'full response in .response').toEqual({ response: { status: 'ok' } });
});

test('projectOutputMapping with outputMapping projects fields', () => {
  const render = (_expr: string, _c: TemplateCtx) => 'projected-value';
  const result = projectOutputMapping({ id: '123' }, { contactId: '{{ response.id }}' }, render, ctx);
  expect(result, 'projected field').toEqual({ contactId: 'projected-value' });
});

test('projectOutputMapping resolves {{ response.* }} from responseBody', () => {
  // Real render that reads response.id from the merged context.
  const realRender = (expr: string, c: TemplateCtx) => {
    const match = expr.match(/\{\{\s*response\.(\w+)\s*\}\}/);
    if (match) return (c.response as Record<string, unknown>)?.[match[1]];
    return expr;
  };
  const result = projectOutputMapping(
    { id: 'contact-abc', name: 'Acme' },
    { contactId: '{{ response.id }}', contactName: '{{ response.name }}' },
    realRender,
    ctx,
  );
  expect(result, 'response fields resolved').toEqual({ contactId: 'contact-abc', contactName: 'Acme' });
});

// ── Summary ──────────────────────────────────────────────────────────────────
