export type FastPathRoute =
  | 'simple_reply'       // direct canned answer; no Orchestrator LLM call
  | 'needs_clarification' // Orchestrator masterPrompt invokes ask_clarifying_questions skill
  | 'needs_orchestrator'  // full Path A/B/C/D routing
  | 'cheap_answer';      // bounded direct answer (e.g. pipeline velocity → canned query)

export type TaskScope = 'subaccount' | 'org' | 'system';

export interface TaskUiContext {
  // NOTE: 'task_intake_chat' replaces 'brief_chat' — intentionally distinct from 'task_chat'
  surface: 'global_ask_bar' | 'task_intake_chat' | 'task_chat' | 'agent_chat' | 'agent_run_chat';
  currentSubaccountId?: string;
  currentOrgId: string;
  userPermissions: Set<string>;
}

export interface FastPathDecision {
  route: FastPathRoute;
  scope: TaskScope;
  confidence: number;
  tier: 1 | 2;
  secondLookTriggered: boolean;
  keywords?: string[];
  reasoning?: string;
}

/**
 * Unified response shape for any task-creation result. Returned by
 * POST /api/task-intake and by every `task_created` arm of POST /api/session/message
 * (Path A pendingRemainder resolution, Path B decisive command, Path C plain submission).
 *
 * Spec §7.4.
 */
export interface TaskCreationEnvelope {
  /** Newly-created task ID. UUID. */
  taskId: string;
  /** Conversation thread for the task. UUID. */
  conversationId: string;
  /** Fast-path triage decision computed before persistence. */
  fastPathDecision: FastPathDecision;
  /** Resolved organisation; always present. */
  organisationId: string;
  /** Resolved subaccount, or null if the task is org-scoped. */
  subaccountId: string | null;
  /** Display name for the resolved organisation. May be null when not pre-loaded. */
  organisationName: string | null;
  /** Display name for the resolved subaccount. May be null per the same rule. */
  subaccountName: string | null;
}

/** Canonical discriminated-union arm for the `task_created` response type. Shared by server and client. */
export type TaskCreatedResponse = { type: 'task_created' } & TaskCreationEnvelope;
