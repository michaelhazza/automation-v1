/**
 * Agent Briefing Job — Phase 2D: event-driven briefing regeneration.
 *
 * Registers a pg-boss worker for the `agent-briefing-update` queue.
 * Enqueued after run completion (no cron schedule). The handler delegates
 * to agentBriefingService.updateAfterRun which is fire-and-forget safe.
 *
 * Payload contract:
 *   { organisationId, subaccountId, agentId, runId, handoffJson }
 */

import type PgBoss from 'pg-boss';
import { agentBriefingService } from '../services/agentBriefingService.js';

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
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the `agent-briefing-update` worker with pg-boss.
 *
 * Called once at server boot. The worker processes briefing update jobs
 * enqueued after agent run completion.
 */
export function registerAgentBriefingJob(boss: PgBoss): void {
  boss.work<AgentBriefingJobPayload>(
    'agent-briefing-update',
    { teamSize: 2, teamConcurrency: 1 },
    async (job) => {
      const {
        organisationId,
        subaccountId,
        agentId,
        runId,
        handoffJson,
      } = job.data;

      if (!organisationId || !subaccountId || !agentId || !runId) {
        console.warn(
          `[AgentBriefingJob] Skipping job ${job.id} — missing required fields`,
        );
        return;
      }

      await agentBriefingService.updateAfterRun(
        organisationId,
        subaccountId,
        agentId,
        runId,
        handoffJson ?? {},
      );
    },
  );
}
