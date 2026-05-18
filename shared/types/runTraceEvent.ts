// Shared types for Run Trace events (spec §4.4.4).
// Pure types and cursor helpers only — no DB access, no service imports.

import type { ControllerStyle } from './controllerStyle.js';
import type { GateLevel, RiskTier } from './riskTier.js';

// ---------------------------------------------------------------------------
// RunTraceEventType union (14 members — spec §4.4.4 Phase 1).
//
// `routing_path_chosen` was originally specified for Phase 1 sourced from
// `routing_outcomes`, but `routing_outcomes` lacks a `run_id`/`agent_run_id`
// column so the join is impossible without a schema change. The event is
// deferred to Phase 3 alongside canonical ledger consolidation when
// `routing_outcomes` gains a run linkage. See architecture.md § Run Trace.
// ---------------------------------------------------------------------------

export type RunTraceEventType =
  | 'controller_style_decided'
  | 'policy_envelope_resolved'
  | 'tool_proposed'
  | 'tool_security_decision'
  | 'tool_call'
  | 'tool_result'
  | 'llm_call'
  | 'delegation_spawned'
  | 'delegation_completed'
  | 'review_requested'
  | 'review_decided'
  | 'iee_step'
  | 'run_started'
  | 'run_terminated'
  // Phase 1 Showcase — file delivery events (spec §3.5 / INV-16)
  | 'phase1.file_delivery.uploaded'
  | 'phase1.file_delivery.expired'
  // Phase 1 Showcase — 42 Macro events (spec §3.5 / INV-16)
  | 'phase1.macro.run_started'
  | 'phase1.macro.run_completed'
  | 'phase1.macro.artifact_delivered'
  | 'phase1.macro.login_failed'
  | 'phase1.macro.run_stuck'
  // Phase 1 Showcase — Support Agent events (spec §3.5 / INV-16)
  | 'phase1.support.ticket_classified'
  | 'phase1.support.classify_failed'
  | 'phase1.support.draft_proposed'
  | 'phase1.support.draft_dispatched'
  | 'phase1.support.draft_blocked_by_policy'
  | 'phase1.support.collision_skipped'
  | 'phase1.support.ticket_terminal'
  | 'phase1.support.eval_drift_detected'
  // Phase 1 Showcase — file delivery read-surface events (spec §3.5 / INV-16)
  | 'phase1.file_delivery.signed_url_issued'
  | 'phase1.file_delivery.downloaded'
  // Phase 1 Showcase — 42 Macro failure events (spec §3.5 / INV-16)
  | 'phase1.macro.report_rendering_failed'
  | 'phase1.macro.artifact_upload_failed'
  // Operator Backend — operator-session lifecycle events (spec § 4.7)
  | 'operator-session.dispatched'
  | 'operator-session.chain_link_completed'
  | 'operator-session.chain_link_failed'
  | 'operator-session.chain_link_cancelled'
  | 'operator-session.fallback_engaged'
  | 'operator-session.auto_extending'
  | 'operator-session.task_completed'
  | 'operator-session.task_failed'
  | 'operator-session.task_cancelled'
  | 'operator-session.fresh_profile_restart'
  | 'operator-session.progressed'
  | 'operator-session.preparing_checkpoint'
  | 'operator-session.usability_restored'
  // Closed-loop skill improvement (spec §9.1 step 13)
  | 'amendment.proposed';

// ---------------------------------------------------------------------------
// RunTraceEventBase — fields common to every event
// ---------------------------------------------------------------------------

export interface RunTraceEventBase {
  id: string;
  runId: string;
  organisationId: string;
  timestamp: string; // ISO8601
  sequenceNumber: number;
  sourceTable: string;
  sourceId: string;
  /** true when this event's timestamp is after the run's terminal timestamp */
  late?: boolean;
}

// ---------------------------------------------------------------------------
// Per-event payload shapes (discriminated on eventType)
// ---------------------------------------------------------------------------

export type RunTraceEvent =
  | (RunTraceEventBase & {
      eventType: 'controller_style_decided';
      controllerStyle: ControllerStyle;
      source: string;
    })
  | (RunTraceEventBase & {
      eventType: 'policy_envelope_resolved';
      schemaVersion: number;
      sourceCounts: Record<string, number>;
    })
  | (RunTraceEventBase & {
      eventType: 'tool_proposed';
      toolSlug: string;
      proposedBy: string;
    })
  | (RunTraceEventBase & {
      eventType: 'tool_security_decision';
      toolSlug: string;
      riskTier: RiskTier;
      gateLevel: GateLevel;
      gateLevelSource: string;
    })
  | (RunTraceEventBase & {
      eventType: 'tool_call';
      toolSlug: string;
      actionId: string | null;
    })
  | (RunTraceEventBase & {
      eventType: 'tool_result';
      toolSlug: string;
      status: 'ok' | 'error';
      durationMs: number;
    })
  | (RunTraceEventBase & {
      eventType: 'llm_call';
      llmRequestId: string;
      provider: string;
      model: string;
      tokensIn: number;
      tokensOut: number;
      costWithMarginCents: number;
      durationMs: number;
    })
  | (RunTraceEventBase & {
      eventType: 'delegation_spawned';
      targetAgentId: string;
      delegationScope: string;
      depth: number;
    })
  | (RunTraceEventBase & {
      eventType: 'delegation_completed';
      targetAgentId: string;
      outcome: 'accepted' | 'rejected';
      reason: string | null;
    })
  | (RunTraceEventBase & {
      eventType: 'review_requested';
      toolSlug: string;
      requestedBy: string;
    })
  | (RunTraceEventBase & {
      eventType: 'review_decided';
      toolSlug: string;
      decision: GateLevel;
      decidedBy: string | null;
    })
  | (RunTraceEventBase & {
      eventType: 'iee_step';
      stepKind: string;
      durationMs: number;
    })
  | (RunTraceEventBase & {
      eventType: 'run_started';
      runType: string;
      triggeredBy: string;
    })
  | (RunTraceEventBase & {
      eventType: 'run_terminated';
      finalStatus: string;
      failureReason: string | null;
      totalDurationMs: number;
    })
  // Phase 1 Showcase — file delivery events (spec §3.5 / INV-16)
  | (RunTraceEventBase & {
      eventType: 'phase1.file_delivery.uploaded';
      artifactId: string;
      organisationId: string;
      agentRunId: string | null;
      ieeRunId: string | null;
      contentHash: string;
      sizeBytes: number;
      storageProvider: string;
      storageKey: string;
      mimeType: string;
      artifactKind: string;
      wasReplay: boolean;
    })
  | (RunTraceEventBase & {
      eventType: 'phase1.file_delivery.expired';
      artifactId: string;
      organisationId: string;
      retainUntil: string;
      ageDays: number;
    })
  // Phase 1 Showcase — 42 Macro events (spec §3.5 / INV-16)
  | (RunTraceEventBase & {
      eventType: 'phase1.macro.run_started';
      agentRunId: string;
      ieeRunId: string;
      organisationId: string;
    })
  | (RunTraceEventBase & {
      eventType: 'phase1.macro.run_completed';
      agentRunId: string;
      ieeRunId: string;
      organisationId: string;
      durationMs: number;
    })
  | (RunTraceEventBase & {
      eventType: 'phase1.macro.artifact_delivered';
      agentRunId: string;
      ieeRunId: string;
      organisationId: string;
      artifactId: string;
    })
  | (RunTraceEventBase & {
      eventType: 'phase1.macro.login_failed';
      agentRunId: string;
      ieeRunId: string;
      reason: string;
    })
  | (RunTraceEventBase & {
      eventType: 'phase1.macro.run_stuck';
      agentRunId: string;
      ieeRunId: string;
      organisationId: string;
      currentStep: string;
      stuckSinceMs: number;
      thresholdMs: number;
    })
  // Phase 1 Showcase — Support Agent events (spec §3.5 / INV-16)
  | (RunTraceEventBase & {
      eventType: 'phase1.support.ticket_classified';
      ticketId: string;
      intent: string;
      urgency: string;
      confidence: number;
    })
  | (RunTraceEventBase & {
      eventType: 'phase1.support.classify_failed';
      ticketId: string;
      parseError: string;
      rawModelOutputRedacted: string;
    })
  | (RunTraceEventBase & {
      eventType: 'phase1.support.draft_proposed';
      ticketId: string;
      draftId: string;
      controllerStyleAtPropose: string;
      riskTierResolved: number;
      perTicketVerdict: 'drafted_for_review' | 'drafted_and_dispatched';
    })
  | (RunTraceEventBase & {
      eventType: 'phase1.support.draft_dispatched';
      ticketId: string;
      draftId: string;
    })
  | (RunTraceEventBase & {
      eventType: 'phase1.support.draft_blocked_by_policy';
      ticketId: string;
      draftId: string;
      blockingPolicy: string;
    })
  | (RunTraceEventBase & {
      eventType: 'phase1.support.collision_skipped';
      ticketId: string;
      reason: 'concurrent_claim' | 'human_active';
      lastHumanActivityAgo?: number;
      perTicketVerdict: 'skipped_collision';
    })
  | (RunTraceEventBase & {
      eventType: 'phase1.support.ticket_terminal';
      ticketId: string;
      perTicketVerdict: 'escalated_to_human' | 'skipped_low_confidence' | 'skipped_no_action_needed';
      reason: string;
      claimReleasedAt: string;
    })
  | (RunTraceEventBase & {
      eventType: 'phase1.support.eval_drift_detected';
      evalRunId?: string;
      accuracyDelta?: number;
      judgeScoreDelta?: number;
      threshold?: number;
      reason?: 'regression_set_unavailable';
      rowCount?: number;
    })
  // Phase 1 Showcase — file delivery read-surface events (spec §3.5 / INV-16)
  | (RunTraceEventBase & {
      eventType: 'phase1.file_delivery.signed_url_issued';
      artifactId: string;
      organisationId: string;
      expiresAt: string;
      inlineDisposition: boolean;
      requestSource: 'run_trace_panel' | 'pdf_embed' | 'copy_link' | 'api_consumer';
    })
  | (RunTraceEventBase & {
      eventType: 'phase1.file_delivery.downloaded';
      artifactId: string;
      organisationId: string;
      downloaderUserId: string | null;
      byteCount: number;
      durationMs: number;
    })
  // Phase 1 Showcase — 42 Macro failure events (spec §3.5 / INV-16)
  | (RunTraceEventBase & {
      eventType: 'phase1.macro.report_rendering_failed';
      agentRunId: string;
      ieeRunId: string;
      attemptCount: number;
      lastError: string;
    })
  | (RunTraceEventBase & {
      eventType: 'phase1.macro.artifact_upload_failed';
      agentRunId: string;
      ieeRunId: string;
      artifactKind: string;
      lastError: string;
    })
  // Operator Backend — operator-session lifecycle events (spec § 4.7)
  | (RunTraceEventBase & {
      eventType: 'operator-session.dispatched';
      payload?: { chainSeq?: number; imageTag?: string; attemptNumber?: number };
    })
  | (RunTraceEventBase & {
      eventType: 'operator-session.chain_link_completed';
      payload?: { chainSeq?: number; attemptNumber?: number };
    })
  | (RunTraceEventBase & {
      eventType: 'operator-session.chain_link_failed';
      payload?: { chainSeq?: number; failureReason?: string; attemptNumber?: number };
    })
  | (RunTraceEventBase & {
      eventType: 'operator-session.chain_link_cancelled';
      payload?: { chainSeq?: number; attemptNumber?: number };
    })
  | (RunTraceEventBase & {
      eventType: 'operator-session.fallback_engaged';
      payload?: { chainSeq?: number; fromMode?: string; toMode?: string; reason?: string; stepIndex?: number };
    })
  | (RunTraceEventBase & {
      eventType: 'operator-session.auto_extending';
      payload?: { chainSeq?: number; attemptNumber?: number };
    })
  | (RunTraceEventBase & {
      eventType: 'operator-session.task_completed';
      payload?: { totalLinks?: number; totalElapsedMs?: number };
    })
  | (RunTraceEventBase & {
      eventType: 'operator-session.task_failed';
      payload?: { failureReason?: string };
    })
  | (RunTraceEventBase & {
      eventType: 'operator-session.task_cancelled';
      payload?: { cancelledByUserId?: string | null };
    })
  | (RunTraceEventBase & {
      eventType: 'operator-session.fresh_profile_restart';
      payload?: { priorAttemptNumber?: number; newAttemptNumber?: number };
    })
  | (RunTraceEventBase & {
      eventType: 'operator-session.progressed';
      payload?: { chainSeq?: number; stepIndex?: number; attemptNumber?: number };
    })
  | (RunTraceEventBase & {
      eventType: 'operator-session.preparing_checkpoint';
      payload?: { chainSeq?: number; attemptNumber?: number };
    })
  | (RunTraceEventBase & {
      eventType: 'operator-session.usability_restored';
      payload?: { connectionId?: string };
    })
  | (RunTraceEventBase & {
      eventType: 'amendment.proposed';
      amendmentId: string;
      skillSlug: string;
      kind: string;
      scorecardJudgementId: string | null;
    });

// ---------------------------------------------------------------------------
// Cursor encode / decode
// Four-tuple: (timestamp: string, sequenceNumber: number, sourceTable: string, sourceId: string)
// Encoded as opaque base64 string; clients treat it as opaque.
// ---------------------------------------------------------------------------

const CURSOR_SEPARATOR = '\x00';

export function encodeCursor(
  timestamp: string,
  sequenceNumber: number,
  sourceTable: string,
  sourceId: string,
): string {
  const raw = [timestamp, String(sequenceNumber), sourceTable, sourceId].join(CURSOR_SEPARATOR);
  return Buffer.from(raw, 'utf8').toString('base64');
}

export function decodeCursor(cursor: string): {
  timestamp: string;
  sequenceNumber: number;
  sourceTable: string;
  sourceId: string;
} {
  const raw = Buffer.from(cursor, 'base64').toString('utf8');
  const parts = raw.split(CURSOR_SEPARATOR);
  if (parts.length !== 4) {
    throw new Error('Invalid run trace cursor: unexpected format');
  }
  const [timestamp, sequenceNumberStr, sourceTable, sourceId] = parts;
  const sequenceNumber = Number(sequenceNumberStr);
  if (!Number.isInteger(sequenceNumber)) {
    throw new Error('Invalid run trace cursor: sequence number is not an integer');
  }
  return { timestamp, sequenceNumber, sourceTable, sourceId };
}

// ---------------------------------------------------------------------------
// RunTraceSummary — result shape returned alongside events
// ---------------------------------------------------------------------------

export interface RunTraceSummary {
  finalStatus: string | null;
  totalCostCents: number;
  totalDurationMs: number;
  eventCounts: Partial<Record<RunTraceEventType, number>>;
}
