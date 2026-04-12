import { eq, and, isNull, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reports, subaccounts, connectorConfigs } from '../db/schema/index.js';

export interface OnboardingStatus {
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
      ghlConnected: !!ghlRow,
      agentsProvisioned: (subResult?.total ?? 0) > 0,
      firstRunComplete: !!reportRow,
    };
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
