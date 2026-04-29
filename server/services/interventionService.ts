import { eq, and, gte, lt, isNull, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { interventionOutcomes, accountOverrides } from '../db/schema/index.js';
import type { InterventionType } from './orgConfigService.js';

// ---------------------------------------------------------------------------
// Intervention Service — cooldown, effectiveness tracking, account overrides
// ---------------------------------------------------------------------------

export const interventionService = {
  // ── Cooldown ────────────────────────────────────────────────────────────

  async checkCooldown(
    orgId: string,
    accountId: string,
    interventionSlug: string,
    config: InterventionType
  ): Promise<{ allowed: boolean; reason?: string }> {
    const cooldownHours = config.cooldownHours ?? 24;
    const cooldownScope = config.cooldownScope ?? 'executed';
    const windowStart = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

    // Check intervention_outcomes for recent interventions of this type
    const [recent] = await db
      .select()
      .from(interventionOutcomes)
      .where(and(
        eq(interventionOutcomes.organisationId, orgId),
        eq(interventionOutcomes.accountId, accountId),
        eq(interventionOutcomes.interventionTypeSlug, interventionSlug),
        gte(interventionOutcomes.createdAt, windowStart),
      ))
      .limit(1);

    if (recent) {
      // Check scope
      if (cooldownScope === 'any_outcome') {
        return { allowed: false, reason: `intervention_suppressed_cooldown: ${interventionSlug} for account ${accountId} within ${cooldownHours}h window (any_outcome)` };
      }
      if (cooldownScope === 'executed' && recent.outcome) {
        return { allowed: false, reason: `intervention_suppressed_cooldown: ${interventionSlug} already executed within ${cooldownHours}h` };
      }
      if (cooldownScope === 'proposed') {
        return { allowed: false, reason: `intervention_suppressed_cooldown: ${interventionSlug} already proposed within ${cooldownHours}h` };
      }
    }

    return { allowed: true };
  },

  // ── Effectiveness tracking ──────────────────────────────────────────────

  async recordOutcome(data: {
    organisationId: string;
    interventionId: string;
    accountId: string;
    interventionTypeSlug: string;
    healthScoreBefore?: number;
    healthScoreAfter?: number;
    measuredAfterHours?: number;
    triggerEventId?: string;
    runId?: string;
    configVersion?: string;
    /** Phase 4 — churn band at proposal time (read from action.metadataJson). */
    bandBefore?: string;
    /** Phase 4 — churn band at measurement time (read from latest assessment). */
    bandAfter?: string;
    /** Phase 4 — mark failed-execution outcomes so cooldown still respects them. */
    executionFailed?: boolean;
  }): Promise<boolean> {
    const delta = data.healthScoreAfter != null && data.healthScoreBefore != null
      ? data.healthScoreAfter - data.healthScoreBefore
      : null;

    let outcome: 'improved' | 'unchanged' | 'worsened' | undefined;
    if (delta != null) {
      if (delta > 5) outcome = 'improved';
      else if (delta < -5) outcome = 'worsened';
      else outcome = 'unchanged';
    }

    // Band-change attribution for B2: if either side changed band, the
    // outcome row carries both for easy downstream attribution queries.
    const bandChanged =
      data.bandBefore != null && data.bandAfter != null && data.bandBefore !== data.bandAfter;

    const result = await db
      .insert(interventionOutcomes)
      .values({
        organisationId: data.organisationId,
        interventionId: data.interventionId,
        accountId: data.accountId,
        interventionTypeSlug: data.interventionTypeSlug,
        triggerEventId: data.triggerEventId,
        runId: data.runId,
        configVersion: data.configVersion,
        healthScoreBefore: data.healthScoreBefore,
        healthScoreAfter: data.healthScoreAfter,
        outcome,
        measuredAfterHours: data.measuredAfterHours ?? 24,
        deltaHealthScore: delta,
        bandBefore: data.bandBefore,
        bandAfter: data.bandAfter,
        bandChanged,
        executionFailed: data.executionFailed ?? false,
      } as typeof interventionOutcomes.$inferInsert)
      .onConflictDoNothing({ target: interventionOutcomes.interventionId });

    return ((result as { rowCount?: number }).rowCount ?? 0) > 0;
  },

  // ── Account overrides ───────────────────────────────────────────────────

  async getAccountOverride(orgId: string, accountId: string) {
    const [override] = await db
      .select()
      .from(accountOverrides)
      .where(and(
        eq(accountOverrides.organisationId, orgId),
        eq(accountOverrides.accountId, accountId),
        // Only return non-expired overrides
        or(
          isNull(accountOverrides.expiresAt),
          gte(accountOverrides.expiresAt, new Date()),
        ),
      ))
      .limit(1);
    return override ?? null;
  },

  async setAccountOverride(orgId: string, accountId: string, data: {
    suppressScoring?: boolean;
    suppressAlerts?: boolean;
    reason?: string;
    expiresAt?: Date;
    createdBy?: string;
  }): Promise<void> {
    await db
      .insert(accountOverrides)
      .values({
        organisationId: orgId,
        accountId,
        suppressScoring: data.suppressScoring ?? false,
        suppressAlerts: data.suppressAlerts ?? false,
        reason: data.reason,
        expiresAt: data.expiresAt,
        createdBy: data.createdBy,
      })
      .onConflictDoUpdate({
        target: [accountOverrides.organisationId, accountOverrides.accountId],
        set: {
          suppressScoring: data.suppressScoring ?? false,
          suppressAlerts: data.suppressAlerts ?? false,
          reason: data.reason,
          expiresAt: data.expiresAt,
          updatedAt: new Date(),
        },
      });
  },

  async clearAccountOverride(orgId: string, accountId: string): Promise<void> {
    await db
      .delete(accountOverrides)
      .where(and(
        eq(accountOverrides.organisationId, orgId),
        eq(accountOverrides.accountId, accountId),
      ));
  },

  async clearExpiredOverrides(): Promise<number> {
    const result = await db
      .delete(accountOverrides)
      .where(lt(accountOverrides.expiresAt, new Date()))
      .returning();
    return result.length;
  },
};
