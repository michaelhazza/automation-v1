import { eq, and, gte, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { anomalyEvents } from '../db/schema/index.js';
import type { AlertLimits } from './orgConfigService.js';
import { AlertFatigueGuardBase } from './alertFatigueGuardBase.js';

// ---------------------------------------------------------------------------
// Alert Fatigue Guard — portfolio-level alert limiting
//
// Prevents operator fatigue by capping alerts per run and per account per day.
// Used by the Portfolio Health Agent during scan cycles.
// ---------------------------------------------------------------------------

export class AlertFatigueGuard extends AlertFatigueGuardBase {
  private readonly organisationId: string;

  constructor(limits: AlertLimits, organisationId: string) {
    super(limits);
    this.organisationId = organisationId;
  }

  protected async queryTodayCount(accountId: string): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [result] = await db
      .select({ count: count() })
      .from(anomalyEvents)
      .where(and(
        eq(anomalyEvents.organisationId, this.organisationId),
        eq(anomalyEvents.accountId, accountId),
        gte(anomalyEvents.createdAt, todayStart),
      ));

    return Number(result?.count ?? 0);
  }

  protected getDayCapDimension(): string {
    return 'account';
  }

  /** Check if an alert should be delivered or suppressed. */
  async shouldDeliver(
    accountId: string,
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): Promise<{ deliver: boolean; reason?: string }> {
    return super.shouldDeliver(accountId, severity);
  }
}
