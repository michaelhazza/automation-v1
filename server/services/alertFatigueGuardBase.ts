// Abstract base class for alert fatigue guards.
// Extracted from AlertFatigueGuard (Portfolio Health Agent) so the same
// per-run + per-day-cap logic can be reused by SystemIncidentFatigueGuard.
import type { AlertLimits } from './orgConfigService.js';

export abstract class AlertFatigueGuardBase {
  protected alertsThisRun = 0;
  protected readonly limits: AlertLimits;

  constructor(limits: AlertLimits) {
    this.limits = limits;
  }

  /** Per-subclass: query today's count for the given key. */
  protected abstract queryTodayCount(key: string): Promise<number>;

  /** Per-subclass: label for the per-day cap dimension (used in suppress reason). */
  protected abstract getDayCapDimension(): string;

  /** Check if an alert should be delivered or suppressed. */
  async shouldDeliver(
    key: string,
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

    // Per-key per-day cap
    const todayCount = await this.queryTodayCount(key);
    if (todayCount >= this.limits.maxAlertsPerAccountPerDay) {
      return {
        deliver: false,
        reason: `alert_suppressed_${this.getDayCapDimension()}_day_cap: ${todayCount}/${this.limits.maxAlertsPerAccountPerDay}`,
      };
    }

    this.alertsThisRun++;
    return { deliver: true };
  }

  /** Count of alerts delivered this run. */
  get alertCount(): number {
    return this.alertsThisRun;
  }
}
