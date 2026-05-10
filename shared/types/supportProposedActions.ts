import { z } from 'zod';

/**
 * Proposed side-effect actions to apply to the ticket alongside sending the reply.
 * Stored as JSONB in canonical_ticket_drafts.proposed_actions.
 *
 * Note: 'closed' and 'unknown_provider_status' are intentionally excluded from setStatus —
 * the agent must not autonomously close tickets or set unknown statuses.
 */
export const SupportProposedActionsSchema = z.object({
  setStatus: z.enum([
    'open',
    'pending_internal',
    'waiting_on_customer',
    'resolved',
  ]).optional(),
  addTags: z.array(z.string()).optional(),
  removeTags: z.array(z.string()).optional(),
  setAssignee: z.union([
    z.object({ agentExternalId: z.string() }),
    z.null(),
  ]).optional(),
});

export type SupportProposedActions = z.infer<typeof SupportProposedActionsSchema>;
