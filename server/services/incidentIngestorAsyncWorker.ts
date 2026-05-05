// pg-boss worker for async incident ingest (system-monitor-ingest queue).
// Deserialises the payload and calls ingestInline — same code path as sync mode.
import { logger } from '../lib/logger.js';
import { ingestInline, type IncidentInput } from './incidentIngestor.js';

export interface SystemMonitorIngestPayload {
  input: IncidentInput;
  correlationId: string | null;
}

export async function handleSystemMonitorIngest(
  payload: SystemMonitorIngestPayload
): Promise<void> {
  try {
    await ingestInline(payload.input);
  } catch (err) {
    logger.error('incident_ingest_worker_failed', {
      error: err instanceof Error ? err.message : String(err),
      source: payload.input?.source,
    });
    throw err; // re-throw so pg-boss marks the job failed for DLQ
  }
}
