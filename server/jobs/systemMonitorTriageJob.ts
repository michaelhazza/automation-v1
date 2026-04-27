/**
 * systemMonitorTriageJob (queue: system-monitor-triage)
 *
 * Concurrency model: pg-boss singletonKey=`triage:${incidentId}` (one triage in flight
 *                    per incident at a time) + pg_advisory_xact_lock(hashtext('triage:'
 *                    + incidentId)::bigint) inside the write_diagnosis transaction.
 *   Key/lock space:  per-incidentId. Two enqueues for the same incident (e.g. sweep +
 *                    incident-driven race) collapse at the queue layer; the advisory
 *                    lock catches same-process races inside write_diagnosis.
 *
 * Idempotency model: composite-key idempotent UPDATE inside write_diagnosis: skips
 *                    if system_incidents.agent_diagnosis_run_id already equals agentRunId.
 *                    Second job for the same incident finds the incident already diagnosed
 *                    and emits agent_triage_skipped via admit check.
 *   Failure mode:    pg-boss retry-up-to-3 on handler throw. Agent-side retry-up-to-2
 *                    on prompt-validation failure inside write_diagnosis. After exhaustion,
 *                    agent_triage_failed event is written; triage_attempt_count increments
 *                    to bound future retries. DLQ on hard fail.
 */

import { withSystemPrincipal } from '../services/principal/systemPrincipal.js';
import { runTriage } from '../services/systemMonitor/triage/triageHandler.js';
import { logger } from '../lib/logger.js';

export async function handleSystemMonitorTriage(job: { data: { incidentId: string } }): Promise<void> {
  const { incidentId } = job.data;
  if (!incidentId) {
    logger.error('system_monitor_triage_job_missing_incident_id', { jobData: job.data });
    throw new Error('systemMonitorTriageJob: incidentId is required');
  }

  await withSystemPrincipal(async () => {
    try {
      await runTriage(incidentId);
    } catch (err) {
      logger.error('system_monitor_triage_job_failed', {
        incidentId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err; // re-throw so pg-boss marks the job failed and retries
    }
  });
}
