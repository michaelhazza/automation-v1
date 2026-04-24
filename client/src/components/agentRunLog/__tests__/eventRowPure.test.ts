/**
 * eventRowPure — tests for the EventRow presentation mapper.
 *
 * Runnable via:
 *   npx tsx client/src/components/agentRunLog/__tests__/eventRowPure.test.ts
 *
 * Covers:
 *   - structured field detection (skillType, provider, idempotent)
 *   - transitional regex fallback (parses provider from resultSummary)
 *   - retryNeedsConfirmation decision (the F3-A safety contract)
 *   - prefix-based slug fallback for emitters that haven't migrated yet
 */

import type { AgentExecutionEvent } from '../../../../../shared/types/agentExecutionLog';
import {
  isAutomationSkillFailure,
  mapInvokeAutomationFailedViewModel,
  mapEventToViewModel,
  retryNeedsConfirmation,
} from '../eventRowPure';

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

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeSkillCompletedEvent(payloadOverrides: Record<string, unknown>): AgentExecutionEvent {
  return {
    sequenceNumber: 1,
    eventType: 'skill.completed',
    durationSinceRunStartMs: 0,
    payload: {
      eventType: 'skill.completed',
      critical: false,
      skillSlug: 'invoke_automation',
      skillName: 'Send welcome email',
      durationMs: 1000,
      status: 'error',
      resultSummary: 'Automation step failed.',
      ...payloadOverrides,
    },
    permissionMask: { canView: true, canEdit: false },
  } as unknown as AgentExecutionEvent;
}

// ── isAutomationSkillFailure ───────────────────────────────────────────────

console.log('\n── isAutomationSkillFailure ──');

test('structured skillType=automation + status=error → true', () => {
  const ok = isAutomationSkillFailure({ skillType: 'automation', status: 'error', skillSlug: 'whatever' });
  assert(ok, 'should detect via structured skillType');
});

test('structured skillType=automation + status=ok → false', () => {
  const ok = isAutomationSkillFailure({ skillType: 'automation', status: 'ok', skillSlug: 'whatever' });
  assert(!ok, 'must require status=error');
});

test('legacy slug "invoke_automation" + status=error → true (transitional fallback)', () => {
  const ok = isAutomationSkillFailure({ skillSlug: 'invoke_automation', status: 'error' });
  assert(ok, 'must fall back to slug shape for un-migrated emitters');
});

test('legacy slug "automation.foo" prefix + status=error → true', () => {
  const ok = isAutomationSkillFailure({ skillSlug: 'automation.send_email', status: 'error' });
  assert(ok, 'must fall back to prefix shape');
});

test('non-automation skill (e.g. crm_query) → false', () => {
  const ok = isAutomationSkillFailure({ skillSlug: 'crm.query', status: 'error', skillType: 'other' });
  assert(!ok, 'must not match unrelated skills');
});

test('null/undefined payload → false (defensive)', () => {
  assert(!isAutomationSkillFailure(null), 'null payload');
  assert(!isAutomationSkillFailure(undefined), 'undefined payload');
});

// ── mapInvokeAutomationFailedViewModel ─────────────────────────────────────

console.log('\n── mapInvokeAutomationFailedViewModel ──');

test('prefers structured provider over regex parse', () => {
  const ev = makeSkillCompletedEvent({
    provider: 'mailchimp',
    resultSummary: 'The Gmail connection is not configured.',
  });
  const vm = mapInvokeAutomationFailedViewModel(ev);
  assertEqual(vm.provider, 'mailchimp', 'structured wins');
});

test('falls back to regex when provider absent — "The Mailchimp connection..."', () => {
  const ev = makeSkillCompletedEvent({
    resultSummary: "The Mailchimp connection isn't set up for this subaccount.",
  });
  const vm = mapInvokeAutomationFailedViewModel(ev);
  assertEqual(vm.provider, 'Mailchimp', 'parsed from resultSummary');
});

test('returns provider undefined when neither structured nor regex matches', () => {
  const ev = makeSkillCompletedEvent({ resultSummary: 'Something went wrong.' });
  const vm = mapInvokeAutomationFailedViewModel(ev);
  assertEqual(vm.provider, undefined, 'no provider');
});

test('passes through structured connectionKey, idempotent, errorCode', () => {
  const ev = makeSkillCompletedEvent({
    connectionKey: 'mailchimp_account',
    idempotent: false,
    errorCode: 'automation_missing_connection',
  });
  const vm = mapInvokeAutomationFailedViewModel(ev);
  assertEqual(vm.connectionKey, 'mailchimp_account', 'connectionKey');
  assertEqual(vm.idempotent, false, 'idempotent');
  assertEqual(vm.errorCode, 'automation_missing_connection', 'errorCode');
});

test('uses linkedEntity.label as stepName when present', () => {
  const ev = makeSkillCompletedEvent({});
  const evWithEntity = {
    ...ev,
    linkedEntity: { kind: 'workflow_step', id: 's1', label: 'Send welcome email' },
  } as unknown as AgentExecutionEvent;
  const vm = mapInvokeAutomationFailedViewModel(evWithEntity);
  assertEqual(vm.stepName, 'Send welcome email', 'linkedEntity wins');
});

test('falls back to skillName then skillSlug for stepName', () => {
  const ev = makeSkillCompletedEvent({ skillName: 'My Automation' });
  const vm = mapInvokeAutomationFailedViewModel(ev);
  assertEqual(vm.stepName, 'My Automation', 'skillName fallback');
});

// ── mapEventToViewModel ────────────────────────────────────────────────────

console.log('\n── mapEventToViewModel ──');

test('automation failure → invoke_automation_failed kind', () => {
  const ev = makeSkillCompletedEvent({ skillType: 'automation' });
  const vm = mapEventToViewModel(ev);
  assertEqual(vm.kind, 'invoke_automation_failed', 'kind');
});

test('automation success → default kind (don\'t use the failure row)', () => {
  const ev = makeSkillCompletedEvent({ skillType: 'automation', status: 'ok' });
  const vm = mapEventToViewModel(ev);
  assertEqual(vm.kind, 'default', 'success → default row');
});

test('non-skill event → default kind', () => {
  const ev = { ...makeSkillCompletedEvent({}), eventType: 'run.started' as const, payload: {} };
  const vm = mapEventToViewModel(ev as unknown as AgentExecutionEvent);
  assertEqual(vm.kind, 'default', 'unrelated event');
});

// ── retryNeedsConfirmation (F3 option A safety contract) ───────────────────

console.log('\n── retryNeedsConfirmation (F3-A safety) ──');

test('idempotent=true → no confirm needed', () => {
  assert(!retryNeedsConfirmation(true), 'true → false');
});

test('idempotent=false → confirm needed', () => {
  assert(retryNeedsConfirmation(false), 'false → true');
});

test('idempotent=undefined (unknown) → confirm needed (safer default)', () => {
  assert(retryNeedsConfirmation(undefined), 'undefined → true');
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
