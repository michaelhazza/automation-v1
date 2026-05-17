// Pure helpers for the Live Agent Execution Log service.
// No DB / IO / socket access — every function here takes inputs and
// returns outputs. Tested in
// server/services/__tests__/agentExecutionEventServicePure.test.ts.
//
// Spec: tasks/live-agent-execution-log-spec.md §5.2, §5.3, §6.2.

import type {
  AgentExecutionEventPayload,
  AgentExecutionEventType,
  AgentExecutionSourceService,
  LinkedEntity,
  LinkedEntityType,
} from '../../shared/types/agentExecutionLog.js';
import {
  AGENT_EXECUTION_EVENT_CRITICALITY,
  isCriticalEventType,
} from '../../shared/types/agentExecutionLog.js';
import { OBSERVATION_TYPES, OBSERVATION_SOURCE_KINDS } from '../../shared/types/agentObservations.js';

// ---------------------------------------------------------------------------
// Event-cap predicate
// ---------------------------------------------------------------------------

/** Non-critical event is capped when the current sequence is >= cap. */
export function isNonCriticalCapHit(currentSeq: number, cap: number): boolean {
  if (!Number.isInteger(cap) || cap <= 0) return false;
  return currentSeq >= cap;
}

// ---------------------------------------------------------------------------
// Duration math — clock-skew-safe
// ---------------------------------------------------------------------------

/**
 * Non-negative integer milliseconds between `startedAt` and `now`.
 * Clamps negative values (clock skew, client-before-server) to 0 so the
 * wire shape never carries a negative duration.
 */
export function computeDurationSinceRunStartMs(
  startedAtMs: number,
  nowMs: number,
): number {
  const raw = nowMs - startedAtMs;
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

// ---------------------------------------------------------------------------
// Envelope / eventId builder
// ---------------------------------------------------------------------------

/**
 * Builds a stable deduplication id for an event.
 *
 * Per-run events:  `${runId}:${sequenceNumber}:${eventType}` — see spec §5.10.
 * Per-task events: `task:${taskId}:${taskSequence}:${eventSubsequence}:${eventType}`
 */
export function buildEventId(
  runId: string,
  sequenceNumber: number,
  eventType: AgentExecutionEventType,
  taskContext?: { taskId: string; taskSequence: number; eventSubsequence: number },
): string {
  if (taskContext) {
    return `task:${taskContext.taskId}:${taskContext.taskSequence}:${taskContext.eventSubsequence}:${eventType}`;
  }
  return `${runId}:${sequenceNumber}:${eventType}`;
}

// ---------------------------------------------------------------------------
// Linked-entity invariants
// ---------------------------------------------------------------------------

const LINKED_ENTITY_TYPES: ReadonlyArray<LinkedEntityType> = [
  'memory_entry',
  'memory_block',
  'policy_rule',
  'skill',
  'data_source',
  'prompt',
  'agent',
  'llm_request',
  'action',
  'spend_ledger',
];

export function isValidLinkedEntityType(value: unknown): value is LinkedEntityType {
  return typeof value === 'string' && LINKED_ENTITY_TYPES.includes(value as LinkedEntityType);
}

export type LinkedEntityRef = Pick<LinkedEntity, 'type' | 'id'> | null;

/**
 * Null-together validation. The DB is permissive (both columns nullable);
 * the service enforces "both or neither" at write time.
 */
export function validateLinkedEntity(
  linked: LinkedEntityRef | undefined,
): { ok: true; normalised: LinkedEntityRef } | { ok: false; reason: string } {
  if (linked == null) return { ok: true, normalised: null };
  if (!linked.type && !linked.id) return { ok: true, normalised: null };
  if (!linked.type || !linked.id) {
    return { ok: false, reason: 'linked_entity_partial — type and id must be null-together or populated-together' };
  }
  if (!isValidLinkedEntityType(linked.type)) {
    return { ok: false, reason: `linked_entity_type_invalid — got ${String(linked.type)}` };
  }
  if (typeof linked.id !== 'string' || linked.id.length === 0) {
    return { ok: false, reason: 'linked_entity_id_empty' };
  }
  return { ok: true, normalised: { type: linked.type, id: linked.id } };
}

// ---------------------------------------------------------------------------
// Source-service tag
// ---------------------------------------------------------------------------

const SOURCE_SERVICES: ReadonlyArray<AgentExecutionSourceService> = [
  'agentExecutionService',
  'workspaceMemoryService',
  'memoryBlockService',
  'decisionTimeGuidanceMiddleware',
  'skillExecutor',
  'llmRouter',
  'runContextLoader',
  'orchestratorFromTaskJob',
  'requestClarification',
  'retrievalService',
  'workflowGateStallNotifyJob',
  'operatorSandboxFileEventBridge',
];

export function isValidSourceService(value: unknown): value is AgentExecutionSourceService {
  return (
    typeof value === 'string' &&
    SOURCE_SERVICES.includes(value as AgentExecutionSourceService)
  );
}

// ---------------------------------------------------------------------------
// Per-eventType payload validators
// ---------------------------------------------------------------------------
//
// One case per `AgentExecutionEventType`. Validators assert shape,
// required fields, and the critical bit against the single-source-of-truth
// registry in shared/types/agentExecutionLog.ts. Called from
// `appendEvent` before persist; failures raise early with a structured
// reason so we don't write broken rows.

export type PayloadValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isStr(v: unknown): v is string { return typeof v === 'string'; }
function isNum(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }
function isBool(v: unknown): v is boolean { return typeof v === 'boolean'; }
function isInt(v: unknown): v is number { return Number.isInteger(v); }
function isNonNegInt(v: unknown): v is number { return Number.isInteger(v) && (v as number) >= 0; }

export function validateEventPayload(
  eventType: AgentExecutionEventType,
  payload: AgentExecutionEventPayload,
): PayloadValidationResult {
  if (!isRecord(payload)) return { ok: false, reason: 'payload_not_object' };
  if (payload.eventType !== eventType) {
    return { ok: false, reason: `payload_type_mismatch — header ${eventType} vs payload ${String(payload.eventType)}` };
  }
  const expectedCritical = AGENT_EXECUTION_EVENT_CRITICALITY[eventType];
  if (typeof expectedCritical !== 'boolean') {
    return { ok: false, reason: `unknown_event_type — ${String(eventType)}` };
  }
  if (payload.critical !== expectedCritical) {
    return {
      ok: false,
      reason: `critical_bit_mismatch — ${eventType} expected ${expectedCritical}, got ${String(payload.critical)}`,
    };
  }

  const p = payload as Record<string, unknown>;
  switch (eventType) {
    case 'orchestrator.routing_decided':
      if (!isStr(p.taskId) || !isStr(p.chosenAgentId) || !isStr(p.idempotencyKey)) {
        return { ok: false, reason: 'orchestrator.routing_decided_missing_ids' };
      }
      if (!isStr(p.routingSource) || !['rule', 'llm', 'fallback'].includes(p.routingSource)) {
        return { ok: false, reason: 'orchestrator.routing_decided_bad_source' };
      }
      return { ok: true };

    case 'run.started':
      if (!isStr(p.agentId) || !isStr(p.runType) || !isStr(p.triggeredBy)) {
        return { ok: false, reason: 'run.started_missing_fields' };
      }
      return { ok: true };

    case 'prompt.assembled': {
      if (!isNonNegInt(p.assemblyNumber) || !isStr(p.promptRowId) || !isNonNegInt(p.totalTokens)) {
        return { ok: false, reason: 'prompt.assembled_missing_fields' };
      }
      if (!isRecord(p.layerTokens)) return { ok: false, reason: 'prompt.assembled_layer_tokens_missing' };
      const lt = p.layerTokens as Record<string, unknown>;
      if (
        !isNonNegInt(lt.master) ||
        !isNonNegInt(lt.orgAdditional) ||
        !isNonNegInt(lt.memoryBlocks) ||
        !isNonNegInt(lt.skillInstructions) ||
        !isNonNegInt(lt.taskContext)
      ) {
        return { ok: false, reason: 'prompt.assembled_layer_tokens_shape' };
      }
      return { ok: true };
    }

    case 'context.source_loaded':
      if (
        !isStr(p.sourceId) ||
        !isStr(p.sourceName) ||
        !isStr(p.scope) ||
        !isStr(p.contentType) ||
        !isNonNegInt(p.tokenCount) ||
        !isBool(p.includedInPrompt)
      ) {
        return { ok: false, reason: 'context.source_loaded_missing_fields' };
      }
      if (p.exclusionReason != null && !isStr(p.exclusionReason)) {
        return { ok: false, reason: 'context.source_loaded_bad_exclusion_reason' };
      }
      return { ok: true };

    case 'memory.retrieved':
      if (!isStr(p.queryText) || !isNonNegInt(p.retrievalMs) || !isNonNegInt(p.totalRetrieved)) {
        return { ok: false, reason: 'memory.retrieved_missing_fields' };
      }
      if (!Array.isArray(p.topEntries)) return { ok: false, reason: 'memory.retrieved_top_entries_not_array' };
      for (const e of p.topEntries) {
        if (!isRecord(e) || !isStr(e.id) || !isNum(e.score) || !isStr(e.excerpt)) {
          return { ok: false, reason: 'memory.retrieved_top_entry_shape' };
        }
      }
      return { ok: true };

    case 'rule.evaluated':
      if (!isStr(p.toolSlug) || !isBool(p.guidanceInjected)) {
        return { ok: false, reason: 'rule.evaluated_missing_fields' };
      }
      if (!isStr(p.decision) || !['auto', 'review', 'block'].includes(p.decision)) {
        return { ok: false, reason: 'rule.evaluated_bad_decision' };
      }
      if (p.matchedRuleId != null && !isStr(p.matchedRuleId)) {
        return { ok: false, reason: 'rule.evaluated_bad_matched_rule_id' };
      }
      return { ok: true };

    case 'skill.invoked':
      if (!isStr(p.skillSlug) || !isStr(p.skillName) || !isBool(p.reviewed)) {
        return { ok: false, reason: 'skill.invoked_missing_fields' };
      }
      if (p.actionId != null && !isStr(p.actionId)) {
        return { ok: false, reason: 'skill.invoked_bad_action_id' };
      }
      return { ok: true };

    case 'skill.completed':
      if (!isStr(p.skillSlug) || !isNonNegInt(p.durationMs) || !isStr(p.resultSummary)) {
        return { ok: false, reason: 'skill.completed_missing_fields' };
      }
      if (!isStr(p.status) || !['ok', 'error'].includes(p.status)) {
        return { ok: false, reason: 'skill.completed_bad_status' };
      }
      if (p.actionId != null && !isStr(p.actionId)) {
        return { ok: false, reason: 'skill.completed_bad_action_id' };
      }
      // Optional structured failure-context fields — UI uses these instead of
      // parsing resultSummary. All optional, so absence is fine; presence must
      // be the right shape.
      if (p.skillType != null && (!isStr(p.skillType) || !['automation', 'agent_decision', 'action_call', 'other'].includes(p.skillType))) {
        return { ok: false, reason: 'skill.completed_bad_skill_type' };
      }
      if (p.errorCode != null && !isStr(p.errorCode)) {
        return { ok: false, reason: 'skill.completed_bad_error_code' };
      }
      if (p.provider != null && !isStr(p.provider)) {
        return { ok: false, reason: 'skill.completed_bad_provider' };
      }
      if (p.connectionKey != null && !isStr(p.connectionKey)) {
        return { ok: false, reason: 'skill.completed_bad_connection_key' };
      }
      if (p.idempotent != null && !isBool(p.idempotent)) {
        return { ok: false, reason: 'skill.completed_bad_idempotent' };
      }
      return { ok: true };

    case 'llm.requested':
      if (
        !isStr(p.llmRequestId) ||
        !isStr(p.provider) ||
        !isStr(p.model) ||
        !isInt(p.attempt) ||
        !isStr(p.featureTag) ||
        !isNonNegInt(p.payloadPreviewTokens)
      ) {
        return { ok: false, reason: 'llm.requested_missing_fields' };
      }
      return { ok: true };

    case 'llm.completed':
      if (
        !isStr(p.llmRequestId) ||
        !isStr(p.status) ||
        !isNonNegInt(p.tokensIn) ||
        !isNonNegInt(p.tokensOut) ||
        !isInt(p.costWithMarginCents) ||
        !isNonNegInt(p.durationMs)
      ) {
        return { ok: false, reason: 'llm.completed_missing_fields' };
      }
      return { ok: true };

    case 'handoff.decided':
      if (
        !isStr(p.targetAgentId) ||
        !isStr(p.reasonText) ||
        !isNonNegInt(p.depth) ||
        !isStr(p.parentRunId)
      ) {
        return { ok: false, reason: 'handoff.decided_missing_fields' };
      }
      return { ok: true };

    case 'clarification.requested':
      if (!isStr(p.question) || !isStr(p.awaitingSince)) {
        return { ok: false, reason: 'clarification.requested_missing_fields' };
      }
      return { ok: true };

    case 'run.event_limit_reached':
      if (!isNonNegInt(p.eventCountAtLimit) || !isNonNegInt(p.cap)) {
        return { ok: false, reason: 'run.event_limit_reached_missing_fields' };
      }
      return { ok: true };

    case 'run.completed':
      if (
        !isStr(p.finalStatus) ||
        !isNonNegInt(p.totalTokens) ||
        !isInt(p.totalCostCents) ||
        !isNonNegInt(p.totalDurationMs) ||
        !isNonNegInt(p.eventCount)
      ) {
        return { ok: false, reason: 'run.completed_missing_fields' };
      }
      return { ok: true };

    case 'tool.error': {
      if (!isRecord(p.error)) return { ok: false, reason: 'tool.error_error_not_object' };
      const e = p.error as Record<string, unknown>;
      if (!isStr(e.code) || !isStr(e.message) || !isRecord(e.context)) {
        return { ok: false, reason: 'tool.error_missing_fields' };
      }
      return { ok: true };
    }

    case 'run.terminal.summary_missing':
      if (!isStr(p.runResultStatus)) return { ok: false, reason: 'run.terminal.summary_missing_missing_fields' };
      return { ok: true };

    case 'run.terminal.extracted_with_errorMessage':
      if (!isNonNegInt(p.errorMessageLength)) return { ok: false, reason: 'run.terminal.extracted_with_errorMessage_missing_fields' };
      return { ok: true };

    case 'runtime_check.completed': {
      if (!isStr(p.runId) || (p.eventId !== null && p.eventId !== undefined && !isStr(p.eventId)) || !isNonNegInt(p.sequenceNumber) || !isStr(p.skillSlug)) {
        return { ok: false, reason: 'runtime_check.completed_missing_id_fields' };
      }
      if (!isStr(p.state) || !['pass', 'fail', 'inconclusive', 'pending', 'not_applicable'].includes(p.state)) {
        return { ok: false, reason: 'runtime_check.completed_bad_state' };
      }
      if (!isStr(p.reasonCode) || !isStr(p.reasonText)) {
        return { ok: false, reason: 'runtime_check.completed_missing_reason_fields' };
      }
      if (!isStr(p.impact) || !['blocking', 'informational'].includes(p.impact)) {
        return { ok: false, reason: 'runtime_check.completed_bad_impact' };
      }
      if (!isStr(p.blastRadius) || !['self', 'tenant', 'external'].includes(p.blastRadius)) {
        return { ok: false, reason: 'runtime_check.completed_bad_blast_radius' };
      }
      if (!isBool(p.reversible)) {
        return { ok: false, reason: 'runtime_check.completed_missing_reversible' };
      }
      if (p.suggestedFix !== null && !isStr(p.suggestedFix)) {
        return { ok: false, reason: 'runtime_check.completed_bad_suggested_fix' };
      }
      return { ok: true };
    }

    case 'correction.captured': {
      if (!isStr(p.sourceRunId) || !isStr(p.sourceEventId) || !isStr(p.skillSlug) || !isStr(p.memoryBlockId)) {
        return { ok: false, reason: 'correction.captured_missing_fields' };
      }
      if (!isBool(p.forcedGradeEnqueued)) {
        return { ok: false, reason: 'correction.captured_missing_forced_grade_flag' };
      }
      return { ok: true };
    }

    case 'retrieval.summary':
      if (!isRecord(p.result) || !isRecord(p.chunkConfig)) {
        return { ok: false, reason: 'retrieval.summary_missing_fields' };
      }
      return { ok: true };

    case 'retrieval.always_available.mode_changed':
      if (
        !isStr(p.organisationId) ||
        !isStr(p.documentId) ||
        !isStr(p.oldMode) ||
        !isStr(p.newMode) ||
        !isStr(p.actorUserId) ||
        !isStr(p.occurredAt)
      ) {
        return { ok: false, reason: 'retrieval.always_available.mode_changed_missing_fields' };
      }
      return { ok: true };

    case 'observation_emitted':
      if (!isStr(p.observationId) || !isStr(p.observationType) || !isStr(p.agentId) || !isStr(p.sourceKind)) {
        return { ok: false, reason: 'observation_emitted_missing_fields' };
      }
      if (!(OBSERVATION_TYPES as ReadonlyArray<string>).includes(p.observationType)) {
        return { ok: false, reason: 'observation_emitted_invalid_observation_type' };
      }
      if (!(OBSERVATION_SOURCE_KINDS as ReadonlyArray<string>).includes(p.sourceKind)) {
        return { ok: false, reason: 'observation_emitted_invalid_source_kind' };
      }
      return { ok: true };

    case 'foundation.controller_style.derived':
      if (!isStr(p.runId) || !isStr(p.executionMode) || !isStr(p.controllerStyle) || !isStr(p.source)) {
        return { ok: false, reason: 'foundation.controller_style.derived_missing_fields' };
      }
      return { ok: true };

    case 'foundation.policy_envelope.resolved':
      if (!isStr(p.runId)) {
        return { ok: false, reason: 'foundation.policy_envelope.resolved_missing_fields' };
      }
      return { ok: true };

    case 'foundation.policy_envelope.resolution_failed':
      if (!isStr(p.runId) || !isStr(p.error)) {
        return { ok: false, reason: 'foundation.policy_envelope.resolution_failed_missing_fields' };
      }
      return { ok: true };

    case 'foundation.execution_environment.rejected':
      if (!isStr(p.runId) || !isStr(p.error)) {
        return { ok: false, reason: 'foundation.execution_environment.rejected_missing_fields' };
      }
      return { ok: true };

    case 'file.created':
      if (
        !isStr(p.agentRunId) ||
        !isStr(p.path) ||
        p.version !== 1 ||
        !isStr(p.mimeType) ||
        !isNonNegInt(p.sizeBytes) ||
        !isStr(p.contentSha256) ||
        !isStr(p.storageKey) ||
        !isStr(p.emittedBy)
      ) {
        return { ok: false, reason: 'file.created_missing_fields' };
      }
      return { ok: true };

    case 'file.modified':
      if (
        !isStr(p.agentRunId) ||
        !isStr(p.path) ||
        !isInt(p.version) ||
        (p.version as number) <= 1 ||
        !isStr(p.mimeType) ||
        !isNonNegInt(p.sizeBytes) ||
        !isStr(p.contentSha256) ||
        !isStr(p.storageKey) ||
        !isStr(p.emittedBy)
      ) {
        return { ok: false, reason: 'file.modified_missing_fields' };
      }
      return { ok: true };

    case 'cross_owner_substep.awaiting_initiator_decision':
      if (
        !isStr(p.parent_run_id) ||
        !isStr(p.substep_id) ||
        !isStr(p.initiatorUserId) ||
        !isStr(p.reason)
      ) {
        return { ok: false, reason: 'cross_owner_substep.awaiting_initiator_decision_missing_fields' };
      }
      return { ok: true };

    case 'cross_owner_substep.completed':
      if (
        !isStr(p.parent_run_id) ||
        !isStr(p.substep_id) ||
        !['success', 'partial', 'failed'].includes(p.status as string)
      ) {
        return { ok: false, reason: 'cross_owner_substep.completed_missing_fields' };
      }
      return { ok: true };

    case 'run.cancellation_requested':
      if (!isStr(p.parentRunId)) return { ok: false, reason: 'run.cancellation_requested_missing_fields' };
      return { ok: true };

    case 'run.terminal':
      if (p.status !== 'cancelled') return { ok: false, reason: 'run.terminal_missing_fields' };
      return { ok: true };

    default: {
      // Exhaustiveness check — if a new event type is added to the union
      // without a validator branch, TS will error on `_unused`.
      const _unused: never = eventType;
      return { ok: false, reason: `unhandled_event_type — ${String(_unused)}` };
    }
  }
}

// ---------------------------------------------------------------------------
// Re-exports for consumers
// ---------------------------------------------------------------------------

export { isCriticalEventType };
