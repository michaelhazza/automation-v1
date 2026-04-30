// ---------------------------------------------------------------------------
// updateThreadContext.ts — Action handler for the update_thread_context action.
// Called by the autonomous agent execution system to update the per-conversation
// thread context (tasks, approach, decisions).
// ---------------------------------------------------------------------------

import { conversationThreadContextService } from '../services/conversationThreadContextService.js';
import type { ThreadContextPatch, ThreadContextPatchResult } from '../../shared/types/conversationThreadContext.js';

export const updateThreadContextHandler = async (
  patch: ThreadContextPatch,
  ctx: {
    conversationId: string;
    runId?: string;
    organisationId: string;
    subaccountId?: string | null;
  },
): Promise<ThreadContextPatchResult> => {
  return conversationThreadContextService.applyPatch(
    ctx.conversationId,
    ctx.organisationId,
    ctx.subaccountId ?? null,
    patch,
    { runId: ctx.runId },
  );
};
