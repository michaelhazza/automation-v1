// Shared wire types for the Live Agent Execution Log.
// Spec: tasks/live-agent-execution-log-spec.md §5.2 — §5.5, §5.10.
//
// The discriminated union in this file is the central registry of event
// types. Adding a new event type has a checklist in spec §5.3a — follow it.

// Import and re-export EventOrigin for use within this file and by callers.
import type { EventOrigin } from './workflowStepGate.js';
export type { EventOrigin };

// ---------------------------------------------------------------------------
// Source-service tag
// ---------------------------------------------------------------------------

export type AgentExecutionSourceService =
  | 'agentExecutionService'
  | 'workspaceMemoryService'
  | 'memoryBlockService'
  | 'decisionTimeGuidanceMiddleware'
  | 'skillExecutor'
  | 'llmRouter'
  | 'runContextLoader'
  | 'orchestratorFromTaskJob'
  | 'requestClarification';

// ---------------------------------------------------------------------------
// Linked-entity taxonomy
// ---------------------------------------------------------------------------

export type LinkedEntityType =
  | 'memory_entry'
  | 'memory_block'
  | 'policy_rule'
  | 'skill'
  | 'data_source'
  | 'prompt'
  | 'agent'
  | 'llm_request'
  | 'action'
  | 'spend_ledger';

export interface LinkedEntity {
  type: LinkedEntityType;
  id: string;
  /** Human-readable label, resolved at read time. NOT persisted. */
  label: string;
}

// ---------------------------------------------------------------------------
// Permission mask — WIRE-ONLY, computed at read time from the caller's
// current permissions. NEVER persisted (spec §4.1a).
// ---------------------------------------------------------------------------

export interface PermissionMask {
  canView: boolean;
  canEdit: boolean;
  /** Stricter than canView — gates the raw-payload fetch endpoint. */
  canViewPayload: boolean;
  /** null when canView=false. */
  viewHref: string | null;
  /** null when canEdit=false. */
  editHref: string | null;
}

// ---------------------------------------------------------------------------
// Event-type union — discriminated by `eventType`, carries `critical` bit
// ---------------------------------------------------------------------------

export type AgentExecutionEventType =
  | 'orchestrator.routing_decided'
  | 'run.started'
  | 'prompt.assembled'
  | 'context.source_loaded'
  | 'memory.retrieved'
  | 'rule.evaluated'
  | 'skill.invoked'
  | 'skill.completed'
  | 'llm.requested'
  | 'llm.completed'
  | 'handoff.decided'
  | 'clarification.requested'
  | 'run.event_limit_reached'
  | 'run.completed'
  | 'tool.error'
  | 'run.terminal.summary_missing'
  | 'run.terminal.extracted_with_errorMessage';

export interface MemoryRetrievedTopEntry {
  id: string;
  score: number;
  excerpt: string;
}

export interface PromptAssembledLayerTokens {
  master: number;
  orgAdditional: number;
  memoryBlocks: number;
  skillInstructions: number;
  taskContext: number;
}

export type AgentExecutionEventPayload =
  | {
      eventType: 'orchestrator.routing_decided';
      critical: false;
      taskId: string;
      chosenAgentId: string;
      idempotencyKey: string;
      routingSource: 'rule' | 'llm' | 'fallback';
    }
  | {
      eventType: 'run.started';
      critical: true;
      agentId: string;
      runType: string;
      triggeredBy: string;
    }
  | {
      eventType: 'prompt.assembled';
      critical: false;
      assemblyNumber: number;
      promptRowId: string;
      totalTokens: number;
      layerTokens: PromptAssembledLayerTokens;
    }
  | {
      eventType: 'context.source_loaded';
      critical: false;
      sourceId: string;
      sourceName: string;
      scope: string;
      contentType: string;
      tokenCount: number;
      includedInPrompt: boolean;
      exclusionReason?: string;
    }
  | {
      eventType: 'memory.retrieved';
      critical: false;
      queryText: string;
      retrievalMs: number;
      topEntries: MemoryRetrievedTopEntry[];
      totalRetrieved: number;
    }
  | {
      eventType: 'rule.evaluated';
      critical: false;
      toolSlug: string;
      matchedRuleId?: string;
      decision: 'auto' | 'review' | 'block';
      guidanceInjected: boolean;
    }
  | {
      eventType: 'skill.invoked';
      critical: false;
      skillSlug: string;
      skillName: string;
      input: unknown;
      reviewed: boolean;
      actionId?: string;
    }
  | {
      eventType: 'skill.completed';
      critical: false;
      skillSlug: string;
      durationMs: number;
      status: 'ok' | 'error';
      resultSummary: string;
      actionId?: string;
      // ── Structured failure-context fields (preferred over parsing resultSummary).
      // Discriminator for what kind of skill ran. UI uses this instead of slug-prefix matching.
      skillType?: 'automation' | 'agent_decision' | 'action_call' | 'other';
      // Stable error code from the §5.7 vocabulary when status='error' and skillType='automation'.
      errorCode?: string;
      // Provider name (e.g. 'mailchimp', 'gmail') when the failure is connection-related.
      provider?: string;
      // Connection slot key (matches automations.requiredConnections[].key) when
      // errorCode is a connection failure (e.g. automation_missing_connection).
      connectionKey?: string;
      // Idempotency flag from automations.idempotent. When false, the UI must
      // confirm before retry (since the side effect may have already occurred).
      idempotent?: boolean;
    }
  | {
      eventType: 'llm.requested';
      critical: true;
      llmRequestId: string;
      provider: string;
      model: string;
      attempt: number;
      featureTag: string;
      payloadPreviewTokens: number;
    }
  | {
      eventType: 'llm.completed';
      critical: true;
      llmRequestId: string;
      status: string;
      tokensIn: number;
      tokensOut: number;
      costWithMarginCents: number;
      durationMs: number;
      payloadInsertStatus: 'ok' | 'failed';
      payloadRowId: string | null;
    }
  | {
      eventType: 'handoff.decided';
      critical: true;
      targetAgentId: string;
      reasonText: string;
      depth: number;
      parentRunId: string;
    }
  | {
      eventType: 'clarification.requested';
      critical: false;
      question: string;
      awaitingSince: string;
    }
  | {
      eventType: 'run.event_limit_reached';
      critical: true;
      eventCountAtLimit: number;
      cap: number;
    }
  | {
      eventType: 'run.completed';
      critical: true;
      finalStatus: string;
      totalTokens: number;
      totalCostCents: number;
      totalDurationMs: number;
      eventCount: number;
    }
  | {
      /** Delegation-scope / hierarchy errors emitted by skill handlers (INV-2, INV-3). */
      eventType: 'tool.error';
      critical: false;
      error: {
        code: string;
        message: string;
        context: Record<string, unknown>;
      };
    }
  | {
      /** H3: emitted when a run completes without a summary (side-channel; does not demote runResultStatus). */
      eventType: 'run.terminal.summary_missing';
      critical: false;
      runResultStatus: string;
    }
  | {
      /** HERMES-S1: emitted when errorMessage is threaded into extractRunInsights for a failed run. */
      eventType: 'run.terminal.extracted_with_errorMessage';
      critical: false;
      errorMessageLength: number;
    };

// ---------------------------------------------------------------------------
// Critical-event registry — single source of truth for the retry tier
// ---------------------------------------------------------------------------
//
// Pinned against the spec §5.3 table. The pure-test suite iterates this
// map and asserts that every member of `AgentExecutionEventType` is
// present + that the critical bit matches the spec.

export const AGENT_EXECUTION_EVENT_CRITICALITY: Readonly<
  Record<AgentExecutionEventType, boolean>
> = {
  'orchestrator.routing_decided': false,
  'run.started': true,
  'prompt.assembled': false,
  'context.source_loaded': false,
  'memory.retrieved': false,
  'rule.evaluated': false,
  'skill.invoked': false,
  'skill.completed': false,
  'llm.requested': true,
  'llm.completed': true,
  'handoff.decided': true,
  'clarification.requested': false,
  'run.event_limit_reached': true,
  'run.completed': true,
  'tool.error': false,
  'run.terminal.summary_missing': false,
  'run.terminal.extracted_with_errorMessage': false,
};

export function isCriticalEventType(eventType: AgentExecutionEventType): boolean {
  return AGENT_EXECUTION_EVENT_CRITICALITY[eventType] === true;
}

// ---------------------------------------------------------------------------
// Main wire shape
// ---------------------------------------------------------------------------

export interface AgentExecutionEvent {
  id: string;
  runId: string;
  organisationId: string;
  subaccountId: string | null;
  sequenceNumber: number;
  eventType: AgentExecutionEventType;
  eventTimestamp: string;
  durationSinceRunStartMs: number;
  sourceService: AgentExecutionSourceService;
  payload: AgentExecutionEventPayload;
  linkedEntity: LinkedEntity | null;
  /** WIRE-ONLY — computed fresh on every read. See spec §4.1a. */
  permissionMask: PermissionMask;
  // Workflows V1 — per-task event log fields
  taskId: string | null;
  taskSequence: number | null;
  eventOrigin: EventOrigin | null;
  eventSubsequence: number;
  eventSchemaVersion: number;
}

// ---------------------------------------------------------------------------
// Drilldown shapes
// ---------------------------------------------------------------------------

export interface AgentRunPromptLayerAttributions {
  master?: { startOffset: number; length: number };
  orgAdditional?: { startOffset: number; length: number };
  memoryBlocks?: Array<{ blockId: string; startOffset: number; length: number }>;
  skillInstructions?: Array<{ skillSlug: string; startOffset: number; length: number }>;
  taskContext?: { startOffset: number; length: number };
  [layerName: string]: unknown;
}

export interface AgentRunPrompt {
  id: string;
  runId: string;
  assemblyNumber: number;
  organisationId: string;
  subaccountId: string | null;
  assembledAt: string;
  systemPrompt: string;
  userPrompt: string;
  toolDefinitions: unknown[];
  layerAttributions: AgentRunPromptLayerAttributions;
  totalTokens: number;
}

export type PayloadModification =
  | {
      kind: 'truncated';
      field: string;
      originalSizeBytes: number;
      truncatedToBytes: number;
    }
  | {
      kind: 'tool_policy';
      field: string;
      policy: 'args-redacted' | 'args-never-persisted';
      toolSlug: string;
    };

export interface PayloadRedaction {
  path: string;
  pattern: string;
  replacedWith: string;
  count: number;
}

export interface AgentRunLlmPayload {
  llmRequestId: string;
  /** Denormalised agent-run id. Null for non-agent LLM callers. */
  runId: string | null;
  organisationId: string;
  subaccountId: string | null;
  systemPrompt: string;
  messages: unknown[];
  toolDefinitions: unknown[];
  /**
   * Provider response payload. `null` only on the failure path when no usable
   * provider output exists (provider rejected before stream open, network
   * error before any bytes arrived, response un-parseable). Partial responses
   * (streaming interrupted mid-completion, usage-without-content content-
   * policy refusals) are persisted as a non-null structurally-valid value.
   * Spec `2026-04-28-pre-test-integration-harness-spec.md` §1.5 Option A;
   * column made nullable by migration 0241. Consumers MUST narrow on null
   * before reading nested fields.
   */
  response: Record<string, unknown> | null;
  redactedFields: PayloadRedaction[];
  modifications: PayloadModification[];
  totalSizeBytes: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Paginated snapshot endpoint
// ---------------------------------------------------------------------------

export interface AgentExecutionEventPage {
  events: AgentExecutionEvent[];
  hasMore: boolean;
  highestSequenceNumber: number;
  /** Highest taskSequence in the page. null when the page contains no task-scoped events. */
  highestTaskSequence: number | null;
}

// ---------------------------------------------------------------------------
// Socket envelope — mirrors server/websocket/emitters.ts EventEnvelope
// ---------------------------------------------------------------------------

export interface AgentExecutionEventEnvelope {
  /** ${runId}:${sequenceNumber}:${eventType} — deduped by client LRU. */
  eventId: string;
  type: 'agent-run:execution-event';
  entityId: string;
  timestamp: string;
  /** permissionMask inside is the emit-time snapshot for the socket user. */
  payload: AgentExecutionEvent;
}

// ---------------------------------------------------------------------------
// Payload-persistence policy (tool-level opt-in — spec §4.5)
// ---------------------------------------------------------------------------

export type PayloadPersistencePolicy = 'full' | 'args-redacted' | 'args-never-persisted';

// ---------------------------------------------------------------------------
// Strict skill.completed payload for invoke_automation emitters
// ---------------------------------------------------------------------------
// The base `skill.completed` union member uses optional structured fields so
// existing emitters keep working. New automation-emitters should use this
// stricter shape via `buildAutomationSkillCompletedPayload()` to make the
// structured-fields contract a build-time check, not a runtime hope.
//
// `skillType: 'automation'` is required; that's what flips the UI into the
// invoke_automation failure row. errorCode + idempotent are required because
// without them the UI would fall back to the regex / unknown-idempotent paths.

export interface AutomationSkillCompletedPayload {
  eventType: 'skill.completed';
  critical: false;
  skillSlug: string;
  durationMs: number;
  status: 'ok' | 'error';
  resultSummary: string;
  actionId?: string;
  // Strict: all four below are required for the structured-fields path.
  skillType: 'automation';
  errorCode: string;
  idempotent: boolean;
  // Optional — only present for connection failures. Required when
  // errorCode === 'automation_missing_connection'.
  provider?: string;
  connectionKey?: string;
}

/**
 * Builder helper — call this from any new automation-emitting code path so
 * the compiler enforces the structured-fields contract. Returns a payload
 * that satisfies the base `skill.completed` union member shape, so it drops
 * straight into the existing event-write path.
 */
export function buildAutomationSkillCompletedPayload(
  fields: Omit<AutomationSkillCompletedPayload, 'eventType' | 'critical' | 'skillType'>,
): AutomationSkillCompletedPayload {
  return {
    eventType: 'skill.completed',
    critical: false,
    skillType: 'automation',
    ...fields,
  };
}
