// ---------------------------------------------------------------------------
// updateThreadContext.ts — Action handler for the update_thread_context action.
// Called by the autonomous agent execution system to update the per-conversation
// thread context (tasks, approach, decisions).
// ---------------------------------------------------------------------------

import { ACTION_REGISTRY } from '../config/actionRegistry.js';
import { conversationThreadContextService } from '../services/conversationThreadContextService.js';
import type { ThreadContextPatch, ThreadContextPatchResult } from '../../shared/types/conversationThreadContext.js';

const patchSchema = ACTION_REGISTRY['update_thread_context'].parameterSchema;

export const updateThreadContextHandler = async (
  patch: unknown,
  ctx: {
    conversationId: string;
    runId?: string;
    organisationId: string;
    subaccountId?: string | null;
  },
): Promise<ThreadContextPatchResult> => {
  // Validate patch shape — throws INVALID_PATCH (400) on malformed input
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success) {
    throw { statusCode: 400, message: 'Invalid patch', errorCode: 'INVALID_PATCH' };
  }

  return conversationThreadContextService.applyPatch(
    ctx.conversationId,
    ctx.organisationId,
    ctx.subaccountId ?? null,
    parsed.data as ThreadContextPatch,
    { runId: ctx.runId },
  );
};
