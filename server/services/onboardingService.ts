import { eq, and, isNull, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reports, subaccounts, connectorConfigs, organisations } from '../db/schema/index.js';

export interface OnboardingStatus {
  /**
   * Session 1 (spec §7.3 / §7.4) — derived from
   * organisations.onboarding_completed_at IS NULL. Sole gate for "should the
   * wizard auto-open?"; orthogonal to the other three fields below, which
   * continue to drive the sync-progress screen + dashboard empty states.
   */
  needsOnboarding: boolean;
  ghlConnected: boolean;
  agentsProvisioned: boolean;
  firstRunComplete: boolean;
}

export class OnboardingService {
  /**
   * Derive onboarding progress from existing DB state.
   * No new column needed — we check:
   *   ghlConnected: org has a connector_config with type='ghl'
   *   agentsProvisioned: org has subaccounts (locations confirmed)
   *   firstRunComplete: org has at least one completed report
   */
  async getOnboardingStatus(orgId: string): Promise<OnboardingStatus> {
    // Session 1 (spec §7.4): the wizard-display gate lives on
    // organisations.onboarding_completed_at. The derivation fields below are
    // orthogonal and continue to drive other surfaces (sync-progress,
    // dashboard empty states).
    const [orgRow] = await db
      .select({ onboardingCompletedAt: organisations.onboardingCompletedAt })
      .from(organisations)
      .where(eq(organisations.id, orgId))
      .limit(1);
    const needsOnboarding = orgRow?.onboardingCompletedAt == null;

    // Check GHL connection (connector_configs has no deletedAt column)
    const [ghlRow] = await db
      .select({ id: connectorConfigs.id })
      .from(connectorConfigs)
      .where(
        and(
          eq(connectorConfigs.organisationId, orgId),
          eq(connectorConfigs.connectorType, 'ghl')
        )
      )
      .limit(1);

    // Check if subaccounts exist (agents provisioned = locations confirmed)
    const [subResult] = await db
      .select({ total: count() })
      .from(subaccounts)
      .where(and(eq(subaccounts.organisationId, orgId), isNull(subaccounts.deletedAt)));

    // Check first run complete — org has at least one completed report
    const [reportRow] = await db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.organisationId, orgId),
          eq(reports.status, 'complete'),
          isNull(reports.deletedAt)
        )
      )
      .limit(1);

    return {
      needsOnboarding,
      ghlConnected: !!ghlRow,
      agentsProvisioned: (subResult?.total ?? 0) > 0,
      firstRunComplete: !!reportRow,
    };
  }

  /**
   * Mark the org's onboarding as complete (spec §7.3 screen 4 / §7.4).
   * Idempotent — subsequent calls are no-ops.
   */
  async markOnboardingComplete(orgId: string): Promise<void> {
    await db
      .update(organisations)
      .set({ onboardingCompletedAt: new Date() })
      .where(eq(organisations.id, orgId));
  }

  /**
   * Get the sync status for the onboarding wizard.
   * In the full implementation this would query the connectorPollingService.
   * For now, returns a stub that the UI can consume.
   */
  async getSyncStatus(orgId: string): Promise<{
    phase: 'idle' | 'syncing' | 'complete' | 'error';
    totalAccounts: number;
    completedAccounts: number;
    accounts: Array<{
      accountId: string;
      displayName: string;
      status: 'pending' | 'syncing' | 'complete' | 'error';
      error?: string;
      preview?: {
        contactCount: number;
        opportunityCount: number;
        revenueTotal?: number;
      };
    }>;
  }> {
    const [subResult] = await db
      .select({ total: count() })
      .from(subaccounts)
      .where(and(eq(subaccounts.organisationId, orgId), isNull(subaccounts.deletedAt)));

    const subCount = subResult?.total ?? 0;
    if (subCount > 0) {
      // TODO(Module C): Once real sync state is persisted, derive actual phase from sync records.
      // Return 'syncing' here rather than 'complete' — reporting 'complete' immediately would
      // skip the sync progress screen before any report is actually generated.
      return {
        phase: 'syncing',
        totalAccounts: subCount,
        completedAccounts: 0,
        accounts: [],
      };
    }

    return {
      phase: 'idle',
      totalAccounts: 0,
      completedAccounts: 0,
      accounts: [],
    };
  }
}

export const onboardingService = new OnboardingService();
