// Zod schema for the operator conversation-link artefact type.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.14 item 6
//
// MIME type: application/vnd.synthetos.operator-conversation-link+json;version=1
// Artefact kind: pointer to one chain-link's conversation history, used to
// compose the resume payload for the next chain link.

import { z } from 'zod';

export const OPERATOR_CONVERSATION_LINK_MIME =
  'application/vnd.synthetos.operator-conversation-link+json;version=1';

export const OperatorConversationLinkArtefactSchema = z.object({
  mime: z.literal(OPERATOR_CONVERSATION_LINK_MIME),
  // The operator_runs.id this conversation fragment belongs to
  chain_link_id: z.string().uuid(),
  // Position within the task's chain sequence
  chain_seq: z.number().int().positive(),
  // Attempt number (for fresh-profile restart grouping)
  attempt_number: z.number().int().positive(),
  // Opaque reference to the stored conversation (e.g. artefact store key)
  conversation_ref: z.string(),
  // When this artefact was written
  captured_at: z.string().datetime(),
});

export type OperatorConversationLinkArtefact = z.infer<typeof OperatorConversationLinkArtefactSchema>;
