/**
 * clientPulseInterventionIdempotencyPure — deterministic idempotency-key
 * builders for the intervention proposal lifecycle. No I/O.
 *
 * Contract: same logical intervention → same key, regardless of caller,
 * retry, or concurrent worker. Both `enqueueInterventionProposal` callers
 * (operator-driven submit + scenario-detector job) consume these.
 */

import { createHash } from 'crypto';

export type InterventionActionTypeName =
  | 'crm.fire_automation'
  | 'crm.send_email'
  | 'crm.send_sms'
  | 'crm.create_task'
  | 'notify_operator';

/**
 * Deterministic idempotency key for scenario-detector proposals. Same
 * (subaccount, template, churn assessment) → same key, every time.
 */
export function buildScenarioDetectorIdempotencyKey(p: {
  subaccountId: string;
  templateSlug: string;
  churnAssessmentId: string;
}): string {
  const raw = `clientpulse:intervention:scenario:${p.subaccountId}:${p.templateSlug}:${p.churnAssessmentId}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

/**
 * Deterministic idempotency key for operator-driven proposals. Keyed on the
 * payload hash so a UI double-click dedups (same payload → same key) but a
 * different contact / subject / schedule produces a distinct key. The
 * `templateSlug`, when present, is folded in so the same payload under two
 * different templates is still distinguishable.
 */
export function buildOperatorIdempotencyKey(p: {
  subaccountId: string;
  actionType: InterventionActionTypeName;
  payload: Record<string, unknown>;
  scheduleHint?: 'immediate' | 'delay_24h' | 'scheduled';
  templateSlug?: string | null;
}): string {
  const canonicalPayload = canonicalStringify(p.payload);
  const raw = [
    'clientpulse:intervention:operator',
    p.subaccountId,
    p.actionType,
    p.templateSlug ?? 'no-template',
    p.scheduleHint ?? 'immediate',
    canonicalPayload,
  ].join(':');
  return createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

/**
 * Recursive canonical JSON serialiser — sorts object keys at every depth so
 * the output is deterministic regardless of insertion order. Required for
 * idempotency-key derivation: payloads with nested objects (e.g. the
 * operator-alert `recipients: { kind, value }`) must contribute every leaf
 * to the hash, otherwise distinct intents would dedup.
 *
 * The naive `JSON.stringify(obj, Object.keys(obj).sort())` is wrong here —
 * the replacer-array filter applies recursively, dropping every nested key
 * not in the top-level allowlist.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`)
    .join(',')}}`;
}
