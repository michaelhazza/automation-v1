// System Incident Fatigue Guard — per-fingerprint daily cap + critical bypass.
// Subclass of AlertFatigueGuardBase for Phase 0.75 push-notification fan-out.
// Declared here so Phase 0.75 can import without re-architecting.
// NOT invoked in Phase 0.5 — reserved for push channels (email, Slack).
import { gte, and, eq, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { systemIncidentEvents, systemIncidents } from '../db/schema/index.js';
import type { AlertLimits } from './orgConfigService.js';
import { AlertFatigueGuardBase } from './alertFatigueGuardBase.js';

export class SystemIncidentFatigueGuard extends AlertFatigueGuardBase {
  constructor(limits: AlertLimits) {
    super(limits);
  }

  protected async queryTodayCount(fingerprint: string): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [result] = await db
      .select({ count: count() })
      .from(systemIncidentEvents)
      .innerJoin(systemIncidents, eq(systemIncidentEvents.incidentId, systemIncidents.id))
      .where(and(
        eq(systemIncidentEvents.eventType, 'notification_surfaced'),
        eq(systemIncidents.fingerprint, fingerprint),
        gte(systemIncidentEvents.occurredAt, todayStart),
      ));

    return Number(result?.count ?? 0);
  }

  protected getDayCapDimension(): string {
    return 'fingerprint';
  }

  /** Check if a push notification should be sent for this fingerprint. */
  async shouldDeliver(
    fingerprint: string,
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): Promise<{ deliver: boolean; reason?: string }> {
    // Critical severity bypasses the fatigue guard (always deliver)
    if (severity === 'critical') {
      this.alertsThisRun++;
      return { deliver: true };
    }
    return super.shouldDeliver(fingerprint, severity);
  }
}
