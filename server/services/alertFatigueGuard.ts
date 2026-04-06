import { eq, and, gte, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { anomalyEvents } from '../db/schema/index.js';
import type { AlertLimits } from './orgConfigService.js';

// ---------------------------------------------------------------------------
// Alert Fatigue Guard — portfolio-level alert limiting
//
// Prevents operator fatigue by capping alerts per run and per account per day.
// Used by the Portfolio Health Agent during scan cycles.
// ---------------------------------------------------------------------------

export class AlertFatigueGuard {
  private alertsThisRun = 0;
  private readonly limits: AlertLimits;

  constructor(limits: AlertLimits) {
    this.limits = limits;
  }

  /** Check if an alert should be delivered or suppressed */
  async shouldDeliver(
    organisationId: string,
    accountId: string,
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): Promise<{ deliver: boolean; reason?: string }> {
    // Low priority batching
    if (this.limits.batchLowPriority && severity === 'low') {
      return { deliver: false, reason: 'alert_batched_low_priority' };
    }

    // Per-run cap
    if (this.alertsThisRun >= this.limits.maxAlertsPerRun) {
      return { deliver: false, reason: `alert_suppressed_run_cap: ${this.alertsThisRun}/${this.limits.maxAlertsPerRun}` };
    }

    // Per-account per-day cap
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [result] = await db
      .select({ count: count() })
      .from(anomalyEvents)
      .where(and(
        eq(anomalyEvents.organisationId, organisationId),
        eq(anomalyEvents.accountId, accountId),
        gte(anomalyEvents.createdAt, todayStart),
      ));

    const todayCount = Number(result?.count ?? 0);
    if (todayCount >= this.limits.maxAlertsPerAccountPerDay) {
      return { deliver: false, reason: `alert_suppressed_account_day_cap: ${todayCount}/${this.limits.maxAlertsPerAccountPerDay}` };
    }

    this.alertsThisRun++;
    return { deliver: true };
  }

  /** Get count of alerts delivered this run */
  get alertCount(): number {
    return this.alertsThisRun;
  }
}
