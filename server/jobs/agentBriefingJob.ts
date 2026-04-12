/**
 * Agent Briefing Job — Phase 2D: event-driven briefing regeneration.
 *
 * Payload contract for the `agent-briefing-update` queue.
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
