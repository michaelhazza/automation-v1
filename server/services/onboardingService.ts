import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reports } from '../db/schema/index.js';

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
    // Check GHL connection via connector_configs (if table exists)
    let ghlConnected = false;
    try {
      const ghlResult = await db.execute(
        sql`SELECT id FROM connector_configs WHERE organisation_id = ${orgId} AND connector_type = 'ghl' AND deleted_at IS NULL LIMIT 1`
      );
      ghlConnected = (ghlResult as unknown as unknown[]).length > 0;
    } catch {
      // connector_configs table may not have ghl type yet
    }

    // Check if subaccounts exist (agents provisioned = locations confirmed)
    let agentsProvisioned = false;
    try {
      const subResult = await db.execute(
        sql`SELECT count(*)::text as count FROM subaccounts WHERE organisation_id = ${orgId} AND deleted_at IS NULL`
      );
      const rows = subResult as unknown as Array<Record<string, unknown>>;
      agentsProvisioned = rows.length > 0 && parseInt(String(rows[0]?.count ?? '0')) > 0;
    } catch {
      // subaccounts table should exist
    }

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
      ghlConnected,
      agentsProvisioned,
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
    // Check if org has subaccounts — if so, sync is "complete"
    try {
      const subResult2 = await db.execute(
        sql`SELECT count(*)::text as count FROM subaccounts WHERE organisation_id = ${orgId} AND deleted_at IS NULL`
      );
      const rows2 = subResult2 as unknown as Array<Record<string, unknown>>;
      const count = parseInt(String(rows2[0]?.count ?? '0'));
      if (count > 0) {
        return {
          phase: 'complete',
          totalAccounts: count,
          completedAccounts: count,
          accounts: [],
        };
      }
    } catch {
      // fall through
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
