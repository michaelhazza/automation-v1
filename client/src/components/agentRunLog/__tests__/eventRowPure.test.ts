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
import { buildAutomationSkillCompletedPayload } from '../../../../../shared/types/agentExecutionLog';
import {
  isAutomationSkillFailure,
  mapInvokeAutomationFailedViewModel,
  mapEventToViewModel,
  retryNeedsConfirmation,
  FALLBACK_WARN_CODES,
  type WarnSink,
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

// ── R2-1: Fallback warn-sink contract ──────────────────────────────────────

console.log('\n── R2-1: Fallback warn-sink contract ──');

function makeCapturingWarn(): { sink: WarnSink; calls: Array<{ code: string; ctx: Record<string, unknown> }> } {
  const calls: Array<{ code: string; ctx: Record<string, unknown> }> = [];
  const sink: WarnSink = (code, ctx) => calls.push({ code, ctx });
  return { sink, calls };
}

test('isAutomationSkillFailure: structured path does NOT warn', () => {
  const { sink, calls } = makeCapturingWarn();
  isAutomationSkillFailure({ skillType: 'automation', status: 'error', skillSlug: 'whatever' }, sink);
  assertEqual(calls.length, 0, 'no warn for structured path');
});

test('isAutomationSkillFailure: legacy slug fallback emits warn with stable code', () => {
  const { sink, calls } = makeCapturingWarn();
  isAutomationSkillFailure({ skillSlug: 'invoke_automation', status: 'error' }, sink);
  assertEqual(calls.length, 1, 'one warn');
  assertEqual(calls[0].code, FALLBACK_WARN_CODES.legacySkillSlugDetection, 'stable code');
  assertEqual(calls[0].ctx.skillSlug, 'invoke_automation', 'context includes slug');
});

test('isAutomationSkillFailure: non-match does NOT warn (we only warn on actual fallback hits)', () => {
  const { sink, calls } = makeCapturingWarn();
  isAutomationSkillFailure({ skillSlug: 'crm.query', status: 'error' }, sink);
  assertEqual(calls.length, 0, 'no warn for non-match');
});

test('mapInvokeAutomationFailedViewModel: structured provider does NOT warn', () => {
  const { sink, calls } = makeCapturingWarn();
  const ev = makeSkillCompletedEvent({ provider: 'mailchimp', resultSummary: 'The Gmail connection is not configured.' });
  mapInvokeAutomationFailedViewModel(ev, sink);
  assertEqual(calls.length, 0, 'no warn for structured provider');
});

test('mapInvokeAutomationFailedViewModel: regex fallback emits warn with stable code', () => {
  const { sink, calls } = makeCapturingWarn();
  const ev = makeSkillCompletedEvent({ resultSummary: 'The Mailchimp connection is missing.' });
  mapInvokeAutomationFailedViewModel(ev, sink);
  assertEqual(calls.length, 1, 'one warn');
  assertEqual(calls[0].code, FALLBACK_WARN_CODES.legacyProviderRegex, 'stable code');
});

test('mapEventToViewModel: threads warn sink to both inner functions', () => {
  const { sink, calls } = makeCapturingWarn();
  // Triggers BOTH the slug fallback AND the regex fallback in one call.
  const ev = makeSkillCompletedEvent({
    skillSlug: 'invoke_automation',
    resultSummary: 'The Mailchimp connection is missing.',
  });
  mapEventToViewModel(ev, sink);
  assertEqual(calls.length, 2, 'two warns — slug + regex');
  const codes = calls.map((c) => c.code).sort();
  assertEqual(codes, [FALLBACK_WARN_CODES.legacyProviderRegex, FALLBACK_WARN_CODES.legacySkillSlugDetection].sort(), 'both codes');
});

// ── R2-4: Strict payload builder ───────────────────────────────────────────

console.log('\n── R2-4: buildAutomationSkillCompletedPayload ──');

test('builder produces a payload that satisfies the strict contract', () => {
  const p = buildAutomationSkillCompletedPayload({
    skillSlug: 'invoke_automation.send_email',
    durationMs: 1234,
    status: 'error',
    resultSummary: 'Mailchimp connection is not set up.',
    errorCode: 'automation_missing_connection',
    idempotent: false,
    provider: 'mailchimp',
    connectionKey: 'mailchimp_account',
  });
  assertEqual(p.eventType, 'skill.completed', 'eventType set');
  assertEqual(p.critical, false, 'critical false');
  assertEqual(p.skillType, 'automation', 'skillType pinned');
  assertEqual(p.errorCode, 'automation_missing_connection', 'errorCode passed');
  assertEqual(p.idempotent, false, 'idempotent passed');
});

test('builder output flows through mapEventToViewModel without any warns', () => {
  const { sink, calls } = makeCapturingWarn();
  const payload = buildAutomationSkillCompletedPayload({
    skillSlug: 'invoke_automation.send_email',
    durationMs: 1234,
    status: 'error',
    resultSummary: 'Mailchimp connection is not set up.',
    errorCode: 'automation_missing_connection',
    idempotent: false,
    provider: 'mailchimp',
    connectionKey: 'mailchimp_account',
  });
  const ev = { ...makeSkillCompletedEvent({}), payload } as unknown as AgentExecutionEvent;
  const vm = mapEventToViewModel(ev, sink);
  assertEqual(calls.length, 0, 'strict-builder output bypasses ALL fallback paths');
  assertEqual(vm.kind, 'invoke_automation_failed', 'maps to failure row');
  if (vm.kind === 'invoke_automation_failed') {
    assertEqual(vm.provider, 'mailchimp', 'provider from structured field');
    assertEqual(vm.connectionKey, 'mailchimp_account', 'connectionKey from structured field');
    assertEqual(vm.idempotent, false, 'idempotent from structured field');
    assertEqual(vm.errorCode, 'automation_missing_connection', 'errorCode from structured field');
  }
});

// ── R3-5: Trust the discriminator (half-migrated payload edges) ────────────

console.log('\n── R3-5: Trust the structured discriminator ──');

test('structured emitter with provider:null → no regex fallback, no warn (R3-5 main case)', () => {
  const { sink, calls } = makeCapturingWarn();
  const ev = makeSkillCompletedEvent({
    skillType: 'automation',
    provider: null,
    resultSummary: 'The Mailchimp connection is missing.',
  });
  const vm = mapInvokeAutomationFailedViewModel(ev, sink);
  assertEqual(vm.provider, undefined, 'null provider stays undefined — emitter said "unknown", we trust them');
  assertEqual(calls.length, 0, 'NO warn — structured emitter is authoritative even when fields are null');
});

test('structured emitter with provider:undefined and matching resultSummary → no regex fallback', () => {
  const { sink, calls } = makeCapturingWarn();
  const ev = makeSkillCompletedEvent({
    skillType: 'automation',
    // provider intentionally not set
    resultSummary: 'The Mailchimp connection is missing.',
  });
  const vm = mapInvokeAutomationFailedViewModel(ev, sink);
  assertEqual(vm.provider, undefined, 'no regex parse despite resultSummary matching');
  assertEqual(calls.length, 0, 'NO warn');
});

test('structured emitter with connectionKey:null → null becomes undefined in view model', () => {
  const { sink, calls } = makeCapturingWarn();
  const ev = makeSkillCompletedEvent({
    skillType: 'automation',
    connectionKey: null,
    errorCode: 'automation_missing_connection',
  });
  const vm = mapInvokeAutomationFailedViewModel(ev, sink);
  assertEqual(vm.connectionKey, undefined, 'null normalised to undefined');
  assertEqual(vm.errorCode, 'automation_missing_connection', 'errorCode passes through');
  assertEqual(calls.length, 0, 'NO warn');
});

test('LEGACY emitter (no skillType) with matching resultSummary → DOES regex-fall-back and DOES warn', () => {
  // Confirms the trust contract is properly bidirectional —
  // legacy emitters still get the regex bridge.
  const { sink, calls } = makeCapturingWarn();
  const ev = makeSkillCompletedEvent({
    skillSlug: 'invoke_automation',
    // no skillType set — this is the legacy slug-shape path
    resultSummary: 'The Mailchimp connection is missing.',
  });
  const vm = mapInvokeAutomationFailedViewModel(ev, sink);
  assertEqual(vm.provider, 'Mailchimp', 'regex fallback fires for legacy emitter');
  assertEqual(calls.length, 1, 'ONE warn (regex fallback hit)');
  assertEqual(calls[0].code, FALLBACK_WARN_CODES.legacyProviderRegex, 'stable warn code');
});

// ── R3-3: Warn-code namespace verification ─────────────────────────────────

console.log('\n── R3-3: Dot-namespaced warn codes ──');

test('warn codes use dot-namespaced surface.signal format', () => {
  // R3-3: confirms the rename from underscore_only to dot-separated landed.
  // Future callers can rely on event_row.* prefix matching for log filters.
  assertEqual(FALLBACK_WARN_CODES.legacySkillSlugDetection, 'event_row.legacy_skill_slug_detection', 'slug code namespaced');
  assertEqual(FALLBACK_WARN_CODES.legacyProviderRegex, 'event_row.legacy_provider_regex', 'regex code namespaced');
  assertEqual(FALLBACK_WARN_CODES.legacySkillSlugDetection.startsWith('event_row.'), true, 'shared prefix for log filtering');
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
