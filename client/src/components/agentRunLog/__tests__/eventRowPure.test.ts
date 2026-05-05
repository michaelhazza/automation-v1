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

import { expect, test } from 'vitest';
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
  expect(ok, 'should detect via structured skillType').toBeTruthy();
});

test('structured skillType=automation + status=ok → false', () => {
  const ok = isAutomationSkillFailure({ skillType: 'automation', status: 'ok', skillSlug: 'whatever' });
  expect(!ok, 'must require status=error').toBeTruthy();
});

test('legacy slug "invoke_automation" + status=error → true (transitional fallback)', () => {
  const ok = isAutomationSkillFailure({ skillSlug: 'invoke_automation', status: 'error' });
  expect(ok, 'must fall back to slug shape for un-migrated emitters').toBeTruthy();
});

test('legacy slug "automation.foo" prefix + status=error → true', () => {
  const ok = isAutomationSkillFailure({ skillSlug: 'automation.send_email', status: 'error' });
  expect(ok, 'must fall back to prefix shape').toBeTruthy();
});

test('non-automation skill (e.g. crm_query) → false', () => {
  const ok = isAutomationSkillFailure({ skillSlug: 'crm.query', status: 'error', skillType: 'other' });
  expect(!ok, 'must not match unrelated skills').toBeTruthy();
});

test('null/undefined payload → false (defensive)', () => {
  expect(!isAutomationSkillFailure(null), 'null payload').toBeTruthy();
  expect(!isAutomationSkillFailure(undefined), 'undefined payload').toBeTruthy();
});

// ── mapInvokeAutomationFailedViewModel ─────────────────────────────────────

console.log('\n── mapInvokeAutomationFailedViewModel ──');

test('prefers structured provider over regex parse', () => {
  const ev = makeSkillCompletedEvent({
    provider: 'mailchimp',
    resultSummary: 'The Gmail connection is not configured.',
  });
  const vm = mapInvokeAutomationFailedViewModel(ev);
  expect(vm.provider, 'structured wins').toBe('mailchimp');
});

test('falls back to regex when provider absent — "The Mailchimp connection..."', () => {
  const ev = makeSkillCompletedEvent({
    resultSummary: "The Mailchimp connection isn't set up for this subaccount.",
  });
  const vm = mapInvokeAutomationFailedViewModel(ev);
  expect(vm.provider, 'parsed from resultSummary').toBe('Mailchimp');
});

test('returns provider undefined when neither structured nor regex matches', () => {
  const ev = makeSkillCompletedEvent({ resultSummary: 'Something went wrong.' });
  const vm = mapInvokeAutomationFailedViewModel(ev);
  expect(vm.provider, 'no provider').toBe(undefined);
});

test('passes through structured connectionKey, idempotent, errorCode', () => {
  const ev = makeSkillCompletedEvent({
    connectionKey: 'mailchimp_account',
    idempotent: false,
    errorCode: 'automation_missing_connection',
  });
  const vm = mapInvokeAutomationFailedViewModel(ev);
  expect(vm.connectionKey, 'connectionKey').toBe('mailchimp_account');
  expect(vm.idempotent, 'idempotent').toBe(false);
  expect(vm.errorCode, 'errorCode').toBe('automation_missing_connection');
});

test('uses linkedEntity.label as stepName when present', () => {
  const ev = makeSkillCompletedEvent({});
  const evWithEntity = {
    ...ev,
    linkedEntity: { kind: 'workflow_step', id: 's1', label: 'Send welcome email' },
  } as unknown as AgentExecutionEvent;
  const vm = mapInvokeAutomationFailedViewModel(evWithEntity);
  expect(vm.stepName, 'linkedEntity wins').toBe('Send welcome email');
});

test('falls back to skillName then skillSlug for stepName', () => {
  const ev = makeSkillCompletedEvent({ skillName: 'My Automation' });
  const vm = mapInvokeAutomationFailedViewModel(ev);
  expect(vm.stepName, 'skillName fallback').toBe('My Automation');
});

// ── mapEventToViewModel ────────────────────────────────────────────────────

console.log('\n── mapEventToViewModel ──');

test('automation failure → invoke_automation_failed kind', () => {
  const ev = makeSkillCompletedEvent({ skillType: 'automation' });
  const vm = mapEventToViewModel(ev);
  expect(vm.kind, 'kind').toBe('invoke_automation_failed');
});

test('automation success → default kind (don\'t use the failure row)', () => {
  const ev = makeSkillCompletedEvent({ skillType: 'automation', status: 'ok' });
  const vm = mapEventToViewModel(ev);
  expect(vm.kind, 'success → default row').toBe('default');
});

test('non-skill event → default kind', () => {
  const ev = { ...makeSkillCompletedEvent({}), eventType: 'run.started' as const, payload: {} };
  const vm = mapEventToViewModel(ev as unknown as AgentExecutionEvent);
  expect(vm.kind, 'unrelated event').toBe('default');
});

// ── retryNeedsConfirmation (F3 option A safety contract) ───────────────────

console.log('\n── retryNeedsConfirmation (F3-A safety) ──');

test('idempotent=true → no confirm needed', () => {
  expect(!retryNeedsConfirmation(true), 'true → false').toBeTruthy();
});

test('idempotent=false → confirm needed', () => {
  expect(retryNeedsConfirmation(false), 'false → true').toBeTruthy();
});

test('idempotent=undefined (unknown) → confirm needed (safer default)', () => {
  expect(retryNeedsConfirmation(undefined), 'undefined → true').toBeTruthy();
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
  expect(calls.length, 'no warn for structured path').toBe(0);
});

test('isAutomationSkillFailure: legacy slug fallback emits warn with stable code', () => {
  const { sink, calls } = makeCapturingWarn();
  isAutomationSkillFailure({ skillSlug: 'invoke_automation', status: 'error' }, sink);
  expect(calls.length, 'one warn').toBe(1);
  expect(calls[0].code, 'stable code').toEqual(FALLBACK_WARN_CODES.legacySkillSlugDetection);
  expect(calls[0].ctx.skillSlug, 'context includes slug').toBe('invoke_automation');
});

test('isAutomationSkillFailure: non-match does NOT warn (we only warn on actual fallback hits)', () => {
  const { sink, calls } = makeCapturingWarn();
  isAutomationSkillFailure({ skillSlug: 'crm.query', status: 'error' }, sink);
  expect(calls.length, 'no warn for non-match').toBe(0);
});

test('mapInvokeAutomationFailedViewModel: structured provider does NOT warn', () => {
  const { sink, calls } = makeCapturingWarn();
  const ev = makeSkillCompletedEvent({ provider: 'mailchimp', resultSummary: 'The Gmail connection is not configured.' });
  mapInvokeAutomationFailedViewModel(ev, sink);
  expect(calls.length, 'no warn for structured provider').toBe(0);
});

test('mapInvokeAutomationFailedViewModel: regex fallback emits warn with stable code', () => {
  const { sink, calls } = makeCapturingWarn();
  const ev = makeSkillCompletedEvent({ resultSummary: 'The Mailchimp connection is missing.' });
  mapInvokeAutomationFailedViewModel(ev, sink);
  expect(calls.length, 'one warn').toBe(1);
  expect(calls[0].code, 'stable code').toEqual(FALLBACK_WARN_CODES.legacyProviderRegex);
});

test('mapEventToViewModel: threads warn sink to both inner functions', () => {
  const { sink, calls } = makeCapturingWarn();
  // Triggers BOTH the slug fallback AND the regex fallback in one call.
  const ev = makeSkillCompletedEvent({
    skillSlug: 'invoke_automation',
    resultSummary: 'The Mailchimp connection is missing.',
  });
  mapEventToViewModel(ev, sink);
  expect(calls.length, 'two warns — slug + regex').toBe(2);
  const codes = calls.map((c) => c.code).sort();
  expect(codes, 'both codes').toEqual([FALLBACK_WARN_CODES.legacyProviderRegex, FALLBACK_WARN_CODES.legacySkillSlugDetection].sort());
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
  expect(p.eventType, 'eventType set').toBe('skill.completed');
  expect(p.critical, 'critical false').toBe(false);
  expect(p.skillType, 'skillType pinned').toBe('automation');
  expect(p.errorCode, 'errorCode passed').toBe('automation_missing_connection');
  expect(p.idempotent, 'idempotent passed').toBe(false);
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
  expect(calls.length, 'strict-builder output bypasses ALL fallback paths').toBe(0);
  expect(vm.kind, 'maps to failure row').toBe('invoke_automation_failed');
  if (vm.kind === 'invoke_automation_failed') {
    expect(vm.provider, 'provider from structured field').toBe('mailchimp');
    expect(vm.connectionKey, 'connectionKey from structured field').toBe('mailchimp_account');
    expect(vm.idempotent, 'idempotent from structured field').toBe(false);
    expect(vm.errorCode, 'errorCode from structured field').toBe('automation_missing_connection');
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
  expect(vm.provider, 'null provider stays undefined — emitter said "unknown", we trust them').toBe(undefined);
  expect(calls.length, 'NO warn — structured emitter is authoritative even when fields are null').toBe(0);
});

test('structured emitter with provider:undefined and matching resultSummary → no regex fallback', () => {
  const { sink, calls } = makeCapturingWarn();
  const ev = makeSkillCompletedEvent({
    skillType: 'automation',
    // provider intentionally not set
    resultSummary: 'The Mailchimp connection is missing.',
  });
  const vm = mapInvokeAutomationFailedViewModel(ev, sink);
  expect(vm.provider, 'no regex parse despite resultSummary matching').toBe(undefined);
  expect(calls.length, 'NO warn').toBe(0);
});

test('structured emitter with connectionKey:null → null becomes undefined in view model', () => {
  const { sink, calls } = makeCapturingWarn();
  const ev = makeSkillCompletedEvent({
    skillType: 'automation',
    connectionKey: null,
    errorCode: 'automation_missing_connection',
  });
  const vm = mapInvokeAutomationFailedViewModel(ev, sink);
  expect(vm.connectionKey, 'null normalised to undefined').toBe(undefined);
  expect(vm.errorCode, 'errorCode passes through').toBe('automation_missing_connection');
  expect(calls.length, 'NO warn').toBe(0);
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
  expect(vm.provider, 'regex fallback fires for legacy emitter').toBe('Mailchimp');
  expect(calls.length, 'ONE warn (regex fallback hit)').toBe(1);
  expect(calls[0].code, 'stable warn code').toEqual(FALLBACK_WARN_CODES.legacyProviderRegex);
});

// ── R3-3: Warn-code namespace verification ─────────────────────────────────

console.log('\n── R3-3: Dot-namespaced warn codes ──');

test('warn codes use dot-namespaced surface.signal format', () => {
  // R3-3: confirms the rename from underscore_only to dot-separated landed.
  // Future callers can rely on event_row.* prefix matching for log filters.
  expect(FALLBACK_WARN_CODES.legacySkillSlugDetection, 'slug code namespaced').toBe('event_row.legacy_skill_slug_detection');
  expect(FALLBACK_WARN_CODES.legacyProviderRegex, 'regex code namespaced').toBe('event_row.legacy_provider_regex');
  expect(FALLBACK_WARN_CODES.legacySkillSlugDetection.startsWith('event_row.'), 'shared prefix for log filtering').toBe(true);
});

// ── Summary ────────────────────────────────────────────────────────────────