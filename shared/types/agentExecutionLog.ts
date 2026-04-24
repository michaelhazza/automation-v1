// Shared wire types for the Live Agent Execution Log.
// Spec: tasks/live-agent-execution-log-spec.md §5.2 — §5.5, §5.10.
//
// The discriminated union in this file is the central registry of event
// types. Adding a new event type has a checklist in spec §5.3a — follow it.

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
  | 'action';

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
  | 'tool.error';

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
  response: Record<string, unknown>;
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
