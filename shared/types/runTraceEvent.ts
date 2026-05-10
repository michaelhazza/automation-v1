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
  | 'run_terminated';

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
