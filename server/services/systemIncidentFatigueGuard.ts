// System Incident Fatigue Guard — per-fingerprint daily cap + critical bypass.
// Subclass of AlertFatigueGuardBase for Phase 0.75 push-notification fan-out.
// Declared here so Phase 0.75 can import without re-architecting.
// NOT invoked in Phase 0.5 — reserved for push channels (email, Slack).
import { gte, and, eq, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { systemIncidentEvents } from '../db/schema/index.js';
import type { AlertLimits } from './orgConfigService.js';
import { AlertFatigueGuardBase } from './alertFatigueGuardBase.js';

export class SystemIncidentFatigueGuard extends AlertFatigueGuardBase {
  constructor(limits: AlertLimits) {
    super(limits);
  }

  protected async queryTodayCount(_fingerprint: string): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // NOTE: Counts ALL notification_surfaced events today (not scoped to _fingerprint).
    // Filtering by fingerprint requires a JOIN to system_incidents — deferred to Phase 0.75.
    // Phase 0.5 never invokes this guard, so global over-counting is harmless for now.
    const [result] = await db
      .select({ count: count() })
      .from(systemIncidentEvents)
      .where(and(
        eq(systemIncidentEvents.eventType, 'notification_surfaced'),
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
