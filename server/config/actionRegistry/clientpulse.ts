import { z } from 'zod';
import type { ActionDefinition } from './types.js';
import { defineCustomerMessagingWrite } from './factories.js';

export const clientpulseActions: Record<string, ActionDefinition> = {
  // ── ClientPulse Phase 4 intervention primitives ─────────────────────────
  // All 5 are review-gated: scenario-detector proposes, operator approves.
  // Namespaced to avoid collision with existing `send_email` / `create_task`.
  'crm.fire_automation': defineCustomerMessagingWrite({
    slug: 'crm.fire_automation',
    description: 'Fire a named CRM automation/workflow for a specific contact.',
    topics: ['clientpulse', 'intervention', 'crm'],
    // Spec §4.2.3 line 491: triggers a CRM automation that emits to the
    // contact (typically email/SMS landing). The action launches a sequence
    // rather than a single send — Tier 6 because the messaging will land.
    // defaultGateLevel remains 'review' so existing behaviour is unchanged (INV-8).
    riskTier: 6,
    verifyActionNoun: 'CRM trigger',
    payloadFields: ['automationId', 'contactId', 'scheduleHint', 'scheduledFor', 'provider'],
    parameterSchema: z.object({
      automationId: z.string().describe('The CRM automation/workflow ID to fire'),
      contactId: z.string().describe('The CRM contact ID the automation should run against'),
      scheduleHint: z.enum(['immediate', 'delay_24h', 'scheduled']).optional().describe('When to fire (default: immediate)'),
      scheduledFor: z.string().optional().describe('ISO timestamp — required when scheduleHint=scheduled'),
      provider: z.string().optional().describe('CRM provider (e.g. "ghl"); defaults to the subaccount configured CRM'),
    }),
    retryPolicy: {
      maxRetries: 2,
      strategy: 'exponential_backoff',
      retryOn: ['timeout', 'network_error', 'rate_limit'],
      doNotRetryOn: ['validation_error', 'auth_error', 'contact_not_found', 'automation_not_found'],
    },
  }),
  'crm.send_email': defineCustomerMessagingWrite({
    slug: 'crm.send_email',
    description: 'Send an email to a CRM contact via the client CRM. Supports merge-field tokens.',
    topics: ['clientpulse', 'intervention', 'crm', 'email'],
    // Spec §4.2.3 line 491: "Send email to client" → Tier 6 (lands in inbox).
    // defaultGateLevel remains 'review' so existing behaviour is unchanged (INV-8).
    riskTier: 6,
    verifyActionNoun: 'CRM email',
    payloadFields: ['from', 'toContactId', 'subject', 'body', 'scheduleHint', 'scheduledFor', 'provider'],
    parameterSchema: z.object({
      from: z.string().describe('From address or sender identifier'),
      toContactId: z.string().describe('CRM contact ID'),
      subject: z.string().describe('Email subject (may contain merge-field tokens)'),
      body: z.string().describe('Email body (may contain merge-field tokens)'),
      scheduleHint: z.enum(['immediate', 'delay_24h', 'scheduled']).optional(),
      scheduledFor: z.string().optional(),
      provider: z.string().optional(),
    }),
    retryPolicy: {
      maxRetries: 2,
      strategy: 'exponential_backoff',
      retryOn: ['timeout', 'network_error', 'rate_limit'],
      doNotRetryOn: ['validation_error', 'auth_error', 'recipient_not_found'],
    },
    requiredIntegration: 'ghl',
  }),
  'crm.send_sms': defineCustomerMessagingWrite({
    slug: 'crm.send_sms',
    description: 'Send an SMS to a CRM contact via the client CRM. Supports merge-field tokens.',
    topics: ['clientpulse', 'intervention', 'crm', 'sms'],
    // Spec §4.2.3 line 491: SMS to client lands on customer phone → Tier 6.
    // defaultGateLevel remains 'review' so existing behaviour is unchanged (INV-8).
    riskTier: 6,
    verifyActionNoun: 'CRM SMS',
    payloadFields: ['fromNumber', 'toContactId', 'body', 'scheduleHint', 'scheduledFor', 'provider'],
    parameterSchema: z.object({
      fromNumber: z.string().describe('Sender phone number (E.164)'),
      toContactId: z.string().describe('CRM contact ID'),
      body: z.string().describe('SMS body (may contain merge-field tokens)'),
      scheduleHint: z.enum(['immediate', 'delay_24h', 'scheduled']).optional(),
      scheduledFor: z.string().optional(),
      provider: z.string().optional(),
    }),
    retryPolicy: {
      maxRetries: 2,
      strategy: 'exponential_backoff',
      retryOn: ['timeout', 'network_error', 'rate_limit'],
      doNotRetryOn: ['validation_error', 'auth_error', 'recipient_not_found', 'invalid_number'],
    },
  }),
  'crm.create_task': defineCustomerMessagingWrite({
    slug: 'crm.create_task',
    description: 'Create a task on a CRM contact (assignee + due date + notes). Distinct from the internal board `create_task`.',
    topics: ['clientpulse', 'intervention', 'crm', 'task'],
    riskTier: 3,
    verifyActionNoun: 'CRM task',
    payloadFields: ['assigneeUserId', 'relatedContactId', 'title', 'notes', 'dueAt', 'priority', 'provider'],
    parameterSchema: z.object({
      assigneeUserId: z.string().describe('CRM user ID for the assignee'),
      relatedContactId: z.string().nullable().optional(),
      title: z.string().describe('Task title'),
      notes: z.string().optional().describe('Task notes / call script'),
      dueAt: z.string().describe('ISO timestamp for due date'),
      priority: z.enum(['low', 'med', 'high']).optional(),
      provider: z.string().optional(),
    }),
    retryPolicy: {
      maxRetries: 2,
      strategy: 'exponential_backoff',
      retryOn: ['timeout', 'network_error', 'rate_limit'],
      doNotRetryOn: ['validation_error', 'auth_error'],
    },
  }),
  config_update_organisation_config: {
    actionType: 'config_update_organisation_config',
    description: 'Apply a single dot-path patch to the organisation\'s operational_config_override JSONB. Writes config_history with change_source=config_agent. Sensitive paths route through review queue.',
    actionCategory: 'worker',
    topics: ['clientpulse', 'config', 'agent'],
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'review',
    riskTier: 3,
    createsBoardTask: false,
    payloadFields: ['path', 'value', 'reason', 'sourceSession'],
    parameterSchema: z.object({
      path: z.string().describe('dot-path into operational_config (e.g. alertLimits.notificationThreshold)'),
      value: z.unknown().describe('JSON-serialisable new value'),
      reason: z.string().describe('Operator rationale (logged)'),
      sourceSession: z.string().optional().describe('Chat session id (optional)'),
    }),
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: ['validation_error', 'drift_detected'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },
  notify_operator: {
    actionType: 'notify_operator',
    description: 'Internal operator-facing alert — writes a notification row + (on approval) fans out to configured channels (in-app, email, slack).',
    actionCategory: 'worker',
    topics: ['clientpulse', 'intervention', 'alert'],
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'review',
    riskTier: 3,
    createsBoardTask: false,
    payloadFields: ['title', 'message', 'severity', 'recipients', 'channels'],
    parameterSchema: z.object({
      title: z.string().describe('Alert title'),
      message: z.string().describe('Alert body'),
      severity: z.enum(['info', 'warn', 'urgent']).optional(),
      recipients: z.object({
        kind: z.enum(['preset', 'custom']),
        value: z.union([z.string(), z.array(z.string())]),
      }).describe('Preset recipient group or explicit user ID list'),
      channels: z.array(z.enum(['in_app', 'email', 'slack'])).min(1).describe('Channels to fan out to'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
    // Trust & Verification Layer §6.1 — review-gated alert: HITL approval is the
    // verification boundary; actionService wrapper has no comparable post-check shape.
    verify: null,
    verifyNullJustification:
      'Review-gated alert: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape',
    reversible: false,
    blastRadius: 'tenant',
  },

  // ── Universal Brief Phase 4: Clarifying + Sparring Partner skills ─────────
  ask_clarifying_questions: {
    actionType: 'ask_clarifying_questions',
    description: 'Draft up to 5 ranked questions to resolve brief ambiguity when Orchestrator confidence < 0.85.',
    actionCategory: 'api',
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: ['briefId', 'briefText', 'orchestratorConfidence', 'ambiguityDimensions'],
    parameterSchema: z.object({
      briefId: z.string().uuid().describe('Brief task ID'),
      briefText: z.string().min(1).max(2000).describe('Original brief text'),
      conversationContext: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })).optional().describe('Prior conversation turns for context'),
      orchestratorConfidence: z.number().min(0).max(1).describe('Current orchestrator confidence score'),
      ambiguityDimensions: z.array(z.enum(['scope', 'target', 'action', 'timing', 'content', 'other']))
        .min(1).describe('Dimensions flagged as ambiguous'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['llm_error'], doNotRetryOn: ['parse_failure'] },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  challenge_assumptions: {
    actionType: 'challenge_assumptions',
    description: 'Adversarial analysis identifying weakest assumptions in a proposed action when stakes are high.',
    actionCategory: 'api',
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: ['briefId', 'runtimeConfidence', 'stakesDimensions'],
    parameterSchema: z.object({
      briefId: z.string().uuid().describe('Brief task ID'),
      runtimeConfidence: z.number().min(0).max(1).describe('Runtime confidence at time of challenge'),
      stakesDimensions: z.array(z.enum(['irreversibility', 'cost', 'scope', 'compliance']))
        .min(1).describe('Stakes dimensions that triggered the challenge'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['llm_error'], doNotRetryOn: ['parse_failure'] },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  'crm.query': {
    actionType: 'crm.query',
    description: 'Answer a free-text CRM question using the CRM Query Planner.',
    actionCategory: 'api',
    isExternal: false,
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: ['rawIntent', 'subaccountId'],
    parameterSchema: z.object({
      rawIntent:    z.string().min(3).max(2000),
      subaccountId: z.string().uuid(),
    }),
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    idempotencyStrategy: 'read_only',
    readPath: 'liveFetch',
    liveFetchRationale: 'CRM Query Planner dispatches Stage 1/2 canonical reads when the intent matches a canonical registry entry (preferred path), and Stage 3 LLM-planned live reads through ghlReadHelpers when the intent requires a live-only field or entity. The canonical path is preferred and measured via planner.llm_skipped_rate; the live path is the fallback.',
    scopeRequirements: {
      validateSubaccountFields: ['subaccountId'],
      requiresUserContext: false,
    },
    mcp: {
      annotations: {
        readOnlyHint:    true,
        destructiveHint: false,
        idempotentHint:  true,
        openWorldHint:   true,
      },
    },
    onFailure: 'skip',
    // Trust & Verification Layer §6.1 — backfill candidate; the planner's response
    // is consumed inside the action service wrapper, so field_match on `results`
    // would need the dispatcher to unwrap before evaluation. Deferred.
    verify: null,
    verifyNullJustification:
      'External read via planner — backfill candidate; current actionService wrapper hides the inner results field from the runtime-check dispatcher',
    reversible: true,
    blastRadius: 'external',
  },

  // ── Cached Context Infrastructure (§6.6 / §4.5) ─────────────────────────
  cached_context_budget_breach: {
    actionType: 'cached_context_budget_breach',
    description:
      'Operator review gate: the assembled context prefix for a cached-context run ' +
      'exceeds the resolved execution budget. Payload contains the breach details, ' +
      'top document contributors, and suggested remediation actions. ' +
      'Approval re-runs assembly exactly once; rejection or timeout terminates the run.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'block',
    riskTier: 3,
    createsBoardTask: false,
    readPath: 'none',
    payloadFields: ['thresholdBreached', 'budgetUsed', 'budgetAllowed', 'topContributors', 'suggestedActions'],
    parameterSchema: z.object({
      thresholdBreached: z.enum(['max_input_tokens', 'per_document_cap']),
      budgetUsed: z.object({
        inputTokens: z.number(),
        worstPerDocumentTokens: z.number(),
      }),
      budgetAllowed: z.object({
        maxInputTokens: z.number(),
        perDocumentCap: z.number(),
      }),
      topContributors: z.array(z.object({
        documentId: z.string(),
        documentName: z.string(),
        tokens: z.number(),
        percentOfBudget: z.number(),
      })),
      suggestedActions: z.array(z.enum(['trim_bundle', 'upgrade_model', 'split_task', 'abort'])),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: [],
    },
    idempotencyStrategy: 'keyed_write',
  },

  // ── Thread Context (Chunk A — per-conversation living doc) ───────────────
  update_thread_context: {
    actionType: 'update_thread_context',
    description:
      'Update the conversation thread context: add/remove tasks, update task status, ' +
      'set or append to the approach note, and add/remove decisions. ' +
      'The thread context is a living document that persists across the conversation ' +
      'and is visible to the user in the Context tab.',
    actionCategory: 'worker',
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'auto',
    riskTier: 1,
    createsBoardTask: false,
    payloadFields: ['decisions', 'tasks', 'approach'],
    parameterSchema: z.object({
      decisions: z
        .object({
          add: z
            .array(
              z.object({
                clientRefId: z.string().optional().describe('Caller-supplied dedup ref — returned in createdIds'),
                decision: z.string().max(500).describe('Short decision statement (≤ 500 chars)'),
                rationale: z.string().max(1500).describe('Rationale for the decision (≤ 1500 chars)'),
              }),
            )
            .optional(),
          remove: z.array(z.string()).optional().describe('IDs of decisions to remove'),
        })
        .optional(),
      tasks: z
        .object({
          add: z
            .array(
              z.object({
                clientRefId: z.string().optional().describe('Caller-supplied dedup ref — returned in createdIds'),
                label: z.string().max(200).describe('Task description (≤ 200 chars)'),
              }),
            )
            .optional(),
          updateStatus: z
            .array(
              z.object({
                id: z.string().describe('Task ID to update'),
                status: z.enum(['pending', 'in_progress', 'done']),
              }),
            )
            .optional(),
          remove: z.array(z.string()).optional().describe('IDs of tasks to remove'),
        })
        .optional(),
      approach: z
        .object({
          replace: z.string().max(10000).optional().describe('Replace approach with this text (≤ 10,000 chars)'),
          appendNote: z.string().max(10000).optional().describe('Append a note to the existing approach (≤ 10,000 chars)'),
        })
        .optional(),
    }),
    retryPolicy: {
      maxRetries: 2,
      strategy: 'exponential_backoff',
      retryOn: ['DB_ERROR', 'NETWORK_ERROR'],
      doNotRetryOn: ['TASK_CAP_REACHED', 'DECISION_CAP_REACHED', 'APPROACH_TOO_LONG'],
    },
    mcp: {
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    idempotencyStrategy: 'keyed_write',
  },
};
