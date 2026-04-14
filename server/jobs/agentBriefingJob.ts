/**
 * Agent Briefing Job — Phase 2D: event-driven briefing regeneration.
 *
 * Payload contract and handler for the `agent-briefing-update` queue.
 * The worker is registered in queueService.ts alongside all other workers.
 * Enqueued after run completion (no cron schedule).
 *
 * The handler drives a single combined LLM call (via agentBriefingService)
 * that produces both the briefing narrative and a belief extraction array.
 * Belief merging is then handled by agentBeliefService.mergeExtracted() —
 * no second LLM call required.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentBriefingJobPayload {
  organisationId: string;
  subaccountId: string;
  agentId: string;
  runId: string;
  handoffJson: object;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function runAgentBriefingUpdate(payload: AgentBriefingJobPayload): Promise<void> {
  // 1. Combined briefing + belief extraction (single LLM call).
  //    updateAfterRun() saves the briefing and returns the raw beliefs array.
  const { agentBriefingService } = await import('../services/agentBriefingService.js');
  const rawBeliefs = await agentBriefingService.updateAfterRun(
    payload.organisationId,
    payload.subaccountId,
    payload.agentId,
    payload.runId,
    payload.handoffJson ?? {},
  );

  // 2. Merge extracted beliefs independently — failure must never affect
  //    briefing or run completion.
  if (rawBeliefs.length > 0) {
    try {
      const { agentBeliefService } = await import('../services/agentBeliefService.js');
      await agentBeliefService.mergeExtracted(
        payload.organisationId,
        payload.subaccountId,
        payload.agentId,
        payload.runId,
        rawBeliefs,
      );
    } catch {
      // Belief merge failure must never affect briefing or run completion
    }
  }
}
