import { z } from 'zod';
import type { ActionDefinition } from './types.js';
import { SupportProposedActionsSchema } from '../../../shared/types/supportProposedActions.js';
import {
  defineCanonicalRead,
  defineInternalStateWrite,
} from './factories.js';

export const supportActions: Record<string, ActionDefinition> = {
  // ── Support Desk skills ────────────────────────────────────────────────────
  'support.list_open_tickets': defineCanonicalRead({
    slug: 'support.list_open_tickets',
    description: 'List open support tickets, optionally filtered by inbox and status group.',
    topics: ['support'],
    riskTier: 0,
    payloadFields: ['inboxIds', 'statusGroup'],
    parameterSchema: z.object({
      inboxIds: z.array(z.string()).optional().describe('Filter to specific inbox IDs'),
      statusGroup: z.enum(['needs_attention', 'all_open', 'quarantined']).optional().describe('Status group filter (default: all_open)'),
    }),
    retryPolicy: { maxRetries: 2, strategy: 'exponential_backoff', retryOn: ['timeout', 'network_error'], doNotRetryOn: [] },
  }),
  'support.read_thread': defineCanonicalRead({
    slug: 'support.read_thread',
    description: 'Read the full message thread for a support ticket.',
    topics: ['support'],
    riskTier: 0,
    payloadFields: ['ticketId'],
    parameterSchema: z.object({
      ticketId: z.string().describe('Canonical ticket UUID'),
    }),
    retryPolicy: { maxRetries: 2, strategy: 'exponential_backoff', retryOn: ['timeout', 'network_error'], doNotRetryOn: [] },
  }),
  'support.propose_reply': defineInternalStateWrite({
    slug: 'support.propose_reply',
    description: 'Draft a public reply to a support ticket for operator review.',
    topics: ['support'],
    riskTier: 1,
    payloadFields: ['ticketId', 'body', 'proposedActions'],
    parameterSchema: z.object({
      ticketId: z.string().describe('Canonical ticket UUID'),
      body: z.string().min(1).describe('Reply body text'),
      proposedActions: SupportProposedActionsSchema.optional().describe('Additional actions to propose alongside the reply'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    idempotencyStrategy: 'state_based',
  }),
  'support.add_internal_note': defineInternalStateWrite({
    slug: 'support.add_internal_note',
    description: 'Draft an internal note on a support ticket.',
    topics: ['support'],
    riskTier: 1,
    payloadFields: ['ticketId', 'body'],
    parameterSchema: z.object({
      ticketId: z.string().describe('Canonical ticket UUID'),
      body: z.string().min(1).describe('Note body text'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    idempotencyStrategy: 'state_based',
  }),
  // Direct-object: actionCategory 'worker' + idempotentHint:true differ from defineCustomerMessagingWrite
  // defaults; verify/verifyNullJustification set by IIFE (blastRadius: 'tenant', not 'external').
  'support.approve_draft': {
    actionType: 'support.approve_draft',
    description: 'Approve and dispatch an AI-proposed support reply draft.',
    actionCategory: 'worker',
    topics: ['support'],
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: 'review',
    // Spec §4.2.3 max-tier rule: client-messaging that lands in customer inbox → Tier 6 (mirrors send_email).
    riskTier: 6,
    createsBoardTask: false,
    payloadFields: ['draftId', 'reviewNotes'],
    parameterSchema: z.object({
      draftId: z.string().describe('Canonical draft UUID'),
      reviewNotes: z.string().optional().describe('Notes recorded with the approval decision'),
    }),
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    idempotencyStrategy: 'keyed_write',
  },
  'support.reject_draft': defineInternalStateWrite({
    slug: 'support.reject_draft',
    description: 'Reject an AI-proposed support reply draft.',
    topics: ['support'],
    riskTier: 1,
    payloadFields: ['draftId', 'reason'],
    parameterSchema: z.object({
      draftId: z.string().describe('Canonical draft UUID'),
      reason: z.string().describe('Reason for rejection'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    idempotencyStrategy: 'state_based',
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  }),
  // Direct-object: actionCategory 'worker' not supported by defineExternalWrite (hardcodes 'api');
  // defaultGateLevel 'auto' and mcp.idempotentHint:true also differ from factory defaults.
  'support.set_status': {
    actionType: 'support.set_status',
    description: 'Change the status of a support ticket via the provider.',
    actionCategory: 'worker',
    topics: ['support'],
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: 'auto',
    riskTier: 2,
    createsBoardTask: false,
    payloadFields: ['ticketId', 'status'],
    parameterSchema: z.object({
      ticketId: z.string().describe('Canonical ticket UUID'),
      status: z.enum(['open', 'pending_internal', 'waiting_on_customer', 'resolved', 'closed']).describe('Target status'),
    }),
    retryPolicy: { maxRetries: 2, strategy: 'exponential_backoff', retryOn: ['timeout', 'network_error'], doNotRetryOn: ['auth_error'] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    idempotencyStrategy: 'keyed_write',
  },
  'support.assign': {
    actionType: 'support.assign',
    description: 'Assign or unassign a support ticket.',
    actionCategory: 'worker',
    topics: ['support'],
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: 'auto',
    riskTier: 2,
    createsBoardTask: false,
    payloadFields: ['ticketId', 'assigneeAgentExternalId'],
    parameterSchema: z.object({
      ticketId: z.string().describe('Canonical ticket UUID'),
      assigneeAgentExternalId: z.string().nullable().describe('External agent ID or null to unassign'),
    }),
    retryPolicy: { maxRetries: 2, strategy: 'exponential_backoff', retryOn: ['timeout', 'network_error'], doNotRetryOn: ['auth_error'] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    idempotencyStrategy: 'keyed_write',
  },
  'support.tag': {
    actionType: 'support.tag',
    description: 'Add or remove tags on a support ticket.',
    actionCategory: 'worker',
    topics: ['support'],
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: 'auto',
    riskTier: 2,
    createsBoardTask: false,
    payloadFields: ['ticketId', 'addTags', 'removeTags'],
    parameterSchema: z.object({
      ticketId: z.string().describe('Canonical ticket UUID'),
      addTags: z.array(z.string()).optional().describe('Tags to add'),
      removeTags: z.array(z.string()).optional().describe('Tags to remove'),
    }),
    retryPolicy: { maxRetries: 2, strategy: 'exponential_backoff', retryOn: ['timeout', 'network_error'], doNotRetryOn: ['auth_error'] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    idempotencyStrategy: 'keyed_write',
  },
  'support.find_customer_history': defineCanonicalRead({
    slug: 'support.find_customer_history',
    description: 'Find all support tickets for a contact by email address.',
    topics: ['support'],
    riskTier: 0,
    payloadFields: ['email'],
    parameterSchema: z.object({
      email: z.string().email().describe('Customer email address'),
    }),
    retryPolicy: { maxRetries: 2, strategy: 'exponential_backoff', retryOn: ['timeout', 'network_error'], doNotRetryOn: [] },
  }),
  'support.classify_ticket': defineCanonicalRead({
    slug: 'support.classify_ticket',
    description: 'Classify a support ticket by intent, urgency, and recommended action.',
    topics: ['support'],
    // INV-9: Risk Tier 1 per rubric for LLM-read-only classification.
    riskTier: 1,
    payloadFields: ['ticketId'],
    parameterSchema: z.object({
      ticketId: z.string().describe('Canonical ticket UUID to classify'),
    }),
    retryPolicy: { maxRetries: 2, strategy: 'exponential_backoff', retryOn: ['timeout', 'network_error'], doNotRetryOn: [] },
  }),
};
