import { lt, and, eq, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  canonicalMetricHistory,
  healthSnapshots,
  anomalyEvents,
} from '../db/schema/index.js';
import { orgConfigService, type DataRetentionConfig } from './orgConfigService.js';

// ---------------------------------------------------------------------------
// Data Retention Service — enforces configurable retention policies
//
// Runs as a daily pg-boss job. Deletes rows older than configured windows.
// null retention = skip (retain indefinitely).
// ---------------------------------------------------------------------------

export const dataRetentionService = {
  async cleanupForOrg(organisationId: string): Promise<{
    metricHistoryDeleted: number;
    healthSnapshotsDeleted: number;
    anomalyEventsDeleted: number;
  }> {
    const retention = await orgConfigService.getDataRetention(organisationId);
    if (!retention) {
      return { metricHistoryDeleted: 0, healthSnapshotsDeleted: 0, anomalyEventsDeleted: 0 };
    }

    const scopedDb = getOrgScopedDb('dataRetentionService.cleanupForOrg');
    let metricHistoryDeleted = 0;
    let healthSnapshotsDeleted = 0;
    let anomalyEventsDeleted = 0;

    // Metric history
    if (retention.metricHistoryDays != null) {
      const cutoff = new Date(Date.now() - retention.metricHistoryDays * 24 * 60 * 60 * 1000);
      const result = await scopedDb
        .delete(canonicalMetricHistory)
        .where(and(
          eq(canonicalMetricHistory.organisationId, organisationId),
          lt(canonicalMetricHistory.createdAt, cutoff),
        ))
        .returning();
      metricHistoryDeleted = result.length;
    }

    // Health snapshots
    if (retention.healthSnapshotDays != null) {
      const cutoff = new Date(Date.now() - retention.healthSnapshotDays * 24 * 60 * 60 * 1000);
      const result = await scopedDb
        .delete(healthSnapshots)
        .where(and(
          eq(healthSnapshots.organisationId, organisationId),
          lt(healthSnapshots.createdAt, cutoff),
        ))
        .returning();
      healthSnapshotsDeleted = result.length;
    }

    // Anomaly events
    if (retention.anomalyEventDays != null) {
      const cutoff = new Date(Date.now() - retention.anomalyEventDays * 24 * 60 * 60 * 1000);
      const result = await scopedDb
        .delete(anomalyEvents)
        .where(and(
          eq(anomalyEvents.organisationId, organisationId),
          lt(anomalyEvents.createdAt, cutoff),
        ))
        .returning();
      anomalyEventsDeleted = result.length;
    }

    return { metricHistoryDeleted, healthSnapshotsDeleted, anomalyEventsDeleted };
  },
};
