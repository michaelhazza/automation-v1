// System Incident Notify Job — pg-boss worker for system-monitor-notify queue.
// Fetches the updated incident row and broadcasts system_incident:updated to
// the system:sysadmin WebSocket room so the admin UI updates live.
import type PgBoss from 'pg-boss';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { systemIncidents } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { emitToSysadmin } from '../websocket/emitters.js';

interface NotifyPayload {
  incidentId: string;
  fingerprint: string;
  severity: string;
  occurrenceCount: number;
  correlationId: string | null;
}

export async function registerSystemIncidentNotifyWorker(boss: PgBoss): Promise<void> {
  // teamSize 4 gives cross-instance parallelism; teamConcurrency 1 serialises
  // each worker instance so a single jobs-burst for one incident can't fan out
  // duplicate WebSocket broadcasts from the same worker. The client handler
  // is idempotent on duplicates across workers, but intra-worker serialisation
  // reduces broadcast chatter under load.
  await (boss as any).work(
    'system-monitor-notify',
    { teamSize: 4, teamConcurrency: 1 },
    async (job: { data: NotifyPayload }) => {
      const { incidentId } = job.data;

      const [incident] = await db
        .select()
        .from(systemIncidents)
        .where(eq(systemIncidents.id, incidentId))
        .limit(1);

      if (!incident) {
        logger.warn('system_incident_notify.incident_not_found', { incidentId });
        return;
      }

      emitToSysadmin('system_incident:updated', incidentId, {
        incident: {
          id: incident.id,
          fingerprint: incident.fingerprint,
          status: incident.status,
          severity: incident.severity,
          source: incident.source,
          summary: incident.summary,
          occurrenceCount: incident.occurrenceCount,
          firstSeenAt: incident.firstSeenAt,
          lastSeenAt: incident.lastSeenAt,
          acknowledgedAt: incident.acknowledgedAt,
          resolvedAt: incident.resolvedAt,
        },
      });
    },
  );
}
