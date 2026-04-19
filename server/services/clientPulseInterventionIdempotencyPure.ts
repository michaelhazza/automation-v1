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
  | 'clientpulse.operator_alert';

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
  const canonicalPayload = JSON.stringify(p.payload, Object.keys(p.payload).sort());
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
