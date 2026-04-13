/**
 * Agent Briefing Job — Phase 2D: event-driven briefing regeneration.
 *
 * Payload contract and handler for the `agent-briefing-update` queue.
 * The worker is registered in queueService.ts alongside all other workers.
 * Enqueued after run completion (no cron schedule).
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
  // 1. Briefing update (existing)
  const { agentBriefingService } = await import('../services/agentBriefingService.js');
  await agentBriefingService.updateAfterRun(
    payload.organisationId,
    payload.subaccountId,
    payload.agentId,
    payload.runId,
    payload.handoffJson ?? {},
  );

  // 2. Belief extraction (Phase 1 — fire-and-forget, independent of briefing)
  try {
    const { agentBeliefService } = await import('../services/agentBeliefService.js');
    await agentBeliefService.extractAndMerge(
      payload.organisationId,
      payload.subaccountId,
      payload.agentId,
      payload.runId,
      payload.handoffJson ?? {},
    );
  } catch {
    // Belief extraction failure must never affect briefing or run completion
  }
}
