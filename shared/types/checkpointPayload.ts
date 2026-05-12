// Zod schema for the operator_runs.checkpoint_payload JSONB field.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §4.6
//
// Producer: the operator runtime (emits via in-band checkpoint signal);
//           the adapter writes the row at chain-link completed terminal.
// Consumer: the resume payload composer at next chain-link dispatch.

import { z } from 'zod';

const OriginalTaskBriefRefSchema = z.object({
  kind: z.literal('agent_run_brief'),
  agent_run_id: z.string().uuid(),
  artefact_id: z.string(),
  snapshotted_at: z.string().datetime(),
});

const ConversationHistoryPointerSchema = z.object({
  kind: z.literal('artefact_chain'),
  artefact_ids: z.array(z.string()),
  history_window_size: z.number().int().positive(),
});

export const CheckpointPayloadSchemaV1 = z.object({
  version: z.literal(1),
  original_task_brief_ref: OriginalTaskBriefRefSchema,
  conversation_history_pointer: ConversationHistoryPointerSchema,
  current_page_url: z.string().url().optional(),
  last_action_summary: z.string().optional(),
  next_planned_step: z.string().optional(),
  last_state_screenshot_artefact_id: z.string().optional(),
  // Whether the runtime considers the current state safe to resume from
  is_resumable_now: z.boolean(),
  captured_at: z.string().datetime(),
});

export type CheckpointPayload = z.infer<typeof CheckpointPayloadSchemaV1>;
