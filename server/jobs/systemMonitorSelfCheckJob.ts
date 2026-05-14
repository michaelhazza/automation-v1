// System Monitor Self-Check Job — monitors the incident ingestor's own health.
//
// Runs every 5 minutes. If the process-local failure counter records >= 3
// ingest failures in the past 15 minutes, surfaces a self-referential incident
// so operators know the monitoring pipeline itself is degraded.
//
// Known limitation: the failure counter is process-local — in multi-instance
// deploys each process reports independently. Documented as acceptable for
// Phase 0.5 (push-notification fan-out comes in Phase 0.75).
import { getIngestFailuresInWindow, recordIncident } from '../services/incidentIngestor.js';
import { logger } from '../lib/logger.js';

export const SELF_CHECK_FAILURE_THRESHOLD = 3;
export const SELF_CHECK_WINDOW_MINUTES = 15;

// Emits `self_check_process_local_only` once per process on first consultation
// so operators surface the process-local counter limitation in the log pipeline
// (tagged-log-as-metric). Multi-instance deploys undercount failures across
// nodes — persisted-store replacement is tracked in Phase 0.75.
let hasWarnedProcessLocal = false;

export async function runSystemMonitorSelfCheck(): Promise<{
  failuresInWindow: number;
  incidentSurfaced: boolean;
}> {
  if (!hasWarnedProcessLocal) {
    hasWarnedProcessLocal = true;
    logger.warn('self_check_process_local_only', {
      windowMinutes: SELF_CHECK_WINDOW_MINUTES,
      threshold: SELF_CHECK_FAILURE_THRESHOLD,
    });
  }
  const failuresInWindow = getIngestFailuresInWindow(SELF_CHECK_WINDOW_MINUTES);

  logger.info('system_monitor_self_check', {
    failuresInWindow,
    windowMinutes: SELF_CHECK_WINDOW_MINUTES,
    threshold: SELF_CHECK_FAILURE_THRESHOLD,
  });

  if (failuresInWindow >= SELF_CHECK_FAILURE_THRESHOLD) {
    await recordIncident({
      source: 'self',
      summary: `Incident ingestor degraded: ${failuresInWindow} failures in last ${SELF_CHECK_WINDOW_MINUTES}m`,
      errorCode: 'ingest_pipeline_degraded',
      fingerprintOverride: 'self:ingestor:ingest_pipeline_degraded',
    });
    return { failuresInWindow, incidentSurfaced: true };
  }

  return { failuresInWindow, incidentSurfaced: false };
}
