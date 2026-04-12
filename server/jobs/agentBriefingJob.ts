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
  const { agentBriefingService } = await import('../services/agentBriefingService.js');
  await agentBriefingService.updateAfterRun(
    payload.organisationId,
    payload.subaccountId,
    payload.agentId,
    payload.runId,
    payload.handoffJson ?? {},
  );
}
