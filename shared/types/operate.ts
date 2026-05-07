/**
 * shared/types/operate.ts — Shared TypeScript contracts for the Operate surface.
 *
 * Pure module: no React, no Express, no DB imports.
 *
 * C3 (ui-consolidation-operate): client-facing types consumed by the Operate
 * frontend pages and the api.ts wrappers.
 */

// ---------------------------------------------------------------------------
// ActivityItem
// ---------------------------------------------------------------------------

/** Spec §4.1 public enum for the trigger kind. Non-nullable on the wire. */
export type TriggerSource = 'schedule' | 'event' | 'manual' | 'api' | 'retry' | 'unknown';

export type ActivityType =
  | 'agent_run'
  | 'review_item'
  | 'health_finding'
  | 'inbox_item'
  | 'workflow_run'
  | 'workflow_execution'
  | 'email.sent'
  | 'email.received'
  | 'calendar.event_created'
  | 'calendar.event_accepted'
  | 'calendar.event_declined'
  | 'identity.provisioned'
  | 'identity.activated'
  | 'identity.suspended'
  | 'identity.resumed'
  | 'identity.revoked'
  | 'identity.archived'
  | 'identity.email_sending_enabled'
  | 'identity.email_sending_disabled'
  | 'identity.migrated'
  | 'identity.migration_failed'
  | 'identity.provisioning_failed'
  | 'actor.onboarded'
  | 'subaccount.migration_completed';

export type NormalisedStatus =
  | 'active'
  | 'attention_needed'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Client-facing ActivityItem. Refines the server shape with the C1 triggerSource field. */
export interface ActivityItem {
  id: string;
  type: ActivityType;
  status: NormalisedStatus;
  subject: string;
  actor: string;
  subaccountId: string | null;
  subaccountName: string | null;
  agentId: string | null;
  agentName: string | null;
  severity: 'critical' | 'warning' | 'info' | null;
  createdAt: string;
  updatedAt: string;
  detailUrl: string;
  triggeredByUserId: string | null;
  triggeredByUserName: string | null;
  triggerType: string | null;
  /** C1: spec §4.1 public name for the trigger kind. Non-nullable; 'unknown' when unrecognised. */
  triggerSource: TriggerSource;
  durationMs: number | null;
  runId: string | null;
}

export interface FilterOptionEntry {
  value: string;
  label: string;
  count: number;
}

export interface FilterOptions {
  type: FilterOptionEntry[];
  status: FilterOptionEntry[];
  actor: FilterOptionEntry[];
  subaccount: FilterOptionEntry[];
}

export interface ActivityQuery {
  type?: string[];
  status?: string[];
  from?: string;
  to?: string;
  agentId?: string;
  actorId?: string;
  actor?: string[];
  subaccount?: string[];
  severity?: string[];
  assignee?: string;
  q?: string;
  sort?: 'newest' | 'oldest' | 'severity' | 'attention_first';
  sortKey?: 'createdAt' | 'severity';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  /** Opaque base64 cursor from a prior response's nextCursor field. */
  cursor?: string;
}

// ---------------------------------------------------------------------------
// InboxItem
// ---------------------------------------------------------------------------

export type InboxItemKind = 'review_item' | 'approval' | 'task' | 'agent_run';

export type InboxBand = 'high' | 'needs_action' | 'previous';

/** Actions available on an InboxItem. Snooze is deferred (spec §10). */
export type InboxItemAction = 'approve' | 'reject' | 'archive';

export interface InboxItem {
  entityType: string;
  kind: InboxItemKind;
  entityId: string;
  title: string;
  status: string;
  isRead: boolean;
  isArchived: boolean;
  readAt: string | null;
  updatedAt: string;
  dueAt?: string | null;
  severity?: string | null;
  band: InboxBand;
  meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// RunTraceEvent — discriminated union by type
// ---------------------------------------------------------------------------

export interface MaskingProjection<T> {
  value: T | '<redacted>';
  truncated?: true;
}

interface RunTraceEventBase {
  id: string;
  runId: string;
  /** ISO timestamp */
  timestamp: string;
  sequenceIndex: number;
}

export interface RunTraceEventLlmCall extends RunTraceEventBase {
  type: 'llm_call';
  model: string;
  inputTokens: number;
  outputTokens: number;
  prompt: MaskingProjection<string>;
  response: MaskingProjection<string>;
}

export interface RunTraceEventToolCall extends RunTraceEventBase {
  type: 'tool_call';
  toolName: string;
  toolCallId: string;
  input: MaskingProjection<Record<string, unknown>>;
}

export interface RunTraceEventToolResult extends RunTraceEventBase {
  type: 'tool_result';
  toolCallId: string;
  result: MaskingProjection<unknown>;
  isError: boolean;
}

export interface RunTraceEventStepStart extends RunTraceEventBase {
  type: 'step_start';
  stepNumber: number;
  description?: string;
}

export interface RunTraceEventStepEnd extends RunTraceEventBase {
  type: 'step_end';
  stepNumber: number;
  durationMs?: number;
}

export type RunTraceEvent =
  | RunTraceEventLlmCall
  | RunTraceEventToolCall
  | RunTraceEventToolResult
  | RunTraceEventStepStart
  | RunTraceEventStepEnd;
