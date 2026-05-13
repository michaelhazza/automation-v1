// operatorSessionSuspensionNotifier.ts — CS notification for operator-session suspension.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.13, §4.8b
//
// Emits the typed CS notification cs.operator_session.suspended_detected via
// recordIncident. Idempotency key: (connection_id, usability_state, detection_date).
//
// Triggers:
//   (a) first OPERATOR_SESSION_UNAVAILABLE hit on the §3.7 fallback path
//   (b) broker usability_state transition away from 'connected_usable'

import { recordIncident } from './incidentIngestor.js';
import { logger } from '../lib/logger.js';

export interface SuspensionDetectedInput {
  organisationId: string;
  subaccountId: string;
  /** Agent run that triggered the detection; null if triggered by broker state change. */
  agentRunId: string | null;
  connectionId: string;
  credentialId: string;
  /** Verbatim broker usability state at detection time. */
  usabilityState: string;
  /** Verbatim error class from the fallback path (e.g. 'session_unavailable'). */
  failureReason: string;
  /** Consent record id from Spec C (for disclosure retrieval in CS runbook). */
  consentRecordId: string | null;
  /** Timestamp from the persisted broker usability_state transition (NOT call time). */
  detectionTimestamp: Date;
  /** Correlation id for the triggering request. */
  requestId?: string;
}

/**
 * Emits the cs.operator_session.suspended_detected CS notification.
 *
 * Fire-and-forget (delegates to recordIncident which never throws).
 * Idempotency key: (connection_id, usability_state, detection_date).
 * detection_date is derived from the persisted broker usability_state transition
 * timestamp to ensure a stable key across retries.
 */
export async function notifyOperatorSessionSuspended(
  input: SuspensionDetectedInput,
): Promise<void> {
  const detectionDate = input.detectionTimestamp.toISOString().slice(0, 10);
  const idempotencyKey = `cs.operator_session.suspended_detected:${input.connectionId}:${input.usabilityState}:${detectionDate}`;

  logger.info('cs.operator_session.suspended_detected', {
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    agentRunId: input.agentRunId,
    connectionId: input.connectionId,
    credentialId: input.credentialId,
    usabilityState: input.usabilityState,
    failureReason: input.failureReason,
    consentRecordId: input.consentRecordId,
    firstDetectedAt: input.detectionTimestamp.toISOString(),
    requestId: input.requestId,
  });

  await recordIncident({
    source: 'agent',
    severity: 'high',
    summary: `Operator session suspended: ${input.usabilityState} for connection ${input.connectionId}`,
    errorCode: 'OPERATOR_SESSION_SUSPENDED',
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    affectedResourceKind: 'integration_connection',
    affectedResourceId: input.connectionId,
    correlationId: input.requestId,
    idempotencyKey,
    errorDetail: {
      event: 'cs.operator_session.suspended_detected',
      organisation_id: input.organisationId,
      subaccount_id: input.subaccountId,
      agent_run_id: input.agentRunId,
      connection_id: input.connectionId,
      credential_id: input.credentialId,
      usability_state: input.usabilityState,
      failure_reason: input.failureReason,
      consent_record_id: input.consentRecordId,
      first_detected_at: input.detectionTimestamp.toISOString(),
      request_id: input.requestId ?? null,
    },
  });
}
