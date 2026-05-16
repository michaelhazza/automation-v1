// subaccountIeeBrowserSettingsService.ts — impure facade for subaccount_iee_browser_settings.
//
// ETag source: settingsVersion integer column (DB default 1 for real rows;
// synthesised defaults return settingsVersion: 0 as the "row absent" sentinel).
//
// PATCH uses optimistic concurrency via expectedSettingsVersion in body.
// Lazy-create: when expectedSettingsVersion === 0 and no row exists → INSERT.
// ETag conflict (409): expectedVersion !== currentVersion.
// Lazy-create race (23505 PK unique_violation): caught → re-read → 409.

import { and, eq, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { subaccountIeeBrowserSettings, auditEvents } from '../db/schema/index.js';
import {
  synthesiseDefaults,
  isETagConflict,
  isLazyCreate,
  isLazyCreatePkConflict,
  buildRolloutAuditRow,
} from './subaccountIeeBrowserSettingsServicePure.js';
import type { IeeBrowserSettingsResponse, PatchBody } from './subaccountIeeBrowserSettingsServicePure.js';

export type { IeeBrowserSettingsResponse };

// ---------------------------------------------------------------------------
// Row → response mapper
// ---------------------------------------------------------------------------

function rowToResponse(row: typeof subaccountIeeBrowserSettings.$inferSelect): IeeBrowserSettingsResponse {
  return {
    subaccountId: row.subaccountId,
    organisationId: row.organisationId,
    status: row.status,
    rolloutApproved: row.rolloutApproved,
    browserProfileRetentionDays: row.browserProfileRetentionDays,
    perTaskCostCeilingCents: row.perTaskCostCeilingCents,
    perSubaccountDailyCostCeilingCents: row.perSubaccountDailyCostCeilingCents,
    settingsVersion: row.settingsVersion,
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const subaccountIeeBrowserSettingsService = {
  /**
   * Returns the IEE browser settings for a subaccount.
   * If no row exists, returns synthesised defaults with settingsVersion: 0.
   */
  async getSettings(
    orgId: string,
    subaccountId: string,
  ): Promise<IeeBrowserSettingsResponse> {
    const scopedDb = getOrgScopedDb('subaccountIeeBrowserSettingsService.getSettings');
    const [row] = await scopedDb
      .select()
      .from(subaccountIeeBrowserSettings)
      .where(and(eq(subaccountIeeBrowserSettings.subaccountId, subaccountId), eq(subaccountIeeBrowserSettings.organisationId, orgId)))
      .limit(1);

    if (!row) {
      return synthesiseDefaults(subaccountId, orgId);
    }

    return rowToResponse(row);
  },

  /**
   * Applies a partial settings update with optimistic concurrency via expectedSettingsVersion.
   *
   * Lazy-create: when expectedSettingsVersion === 0 and row absent → INSERT defaults + diff.
   * ETag conflict: when expectedSettingsVersion !== currentVersion → throw 409.
   * Lazy-create race (23505 PK unique_violation): caught → re-read → throw 409.
   *
   * rolloutApproved is NOT accepted in the patch — use setRolloutApproval instead.
   */
  async updateSettings(params: {
    orgId: string;
    subaccountId: string;
    patch: Omit<PatchBody, 'expectedSettingsVersion'>;
    expectedSettingsVersion: number;
    actorUserId: string;
  }): Promise<IeeBrowserSettingsResponse> {
    const scopedDb = getOrgScopedDb('subaccountIeeBrowserSettingsService.updateSettings');

    const [existing] = await scopedDb
      .select()
      .from(subaccountIeeBrowserSettings)
      .where(and(eq(subaccountIeeBrowserSettings.subaccountId, params.subaccountId), eq(subaccountIeeBrowserSettings.organisationId, params.orgId)))
      .limit(1);

    const rowExists = existing !== undefined;

    // Lazy-create branch
    if (isLazyCreate(params.expectedSettingsVersion, rowExists)) {
      try {
        const [created] = await scopedDb
          .insert(subaccountIeeBrowserSettings)
          .values({
            subaccountId: params.subaccountId,
            organisationId: params.orgId,
            status: params.patch.status ?? 'off',
            rolloutApproved: false,
            browserProfileRetentionDays: params.patch.browserProfileRetentionDays ?? 30,
            perTaskCostCeilingCents: params.patch.perTaskCostCeilingCents ?? 100,
            perSubaccountDailyCostCeilingCents: params.patch.perSubaccountDailyCostCeilingCents ?? 500,
            settingsVersion: 1,
            updatedAt: new Date(),
            updatedByUserId: params.actorUserId,
          })
          .returning();

        return rowToResponse(created!);
      } catch (err) {
        if (isLazyCreatePkConflict(err)) {
          // Race: another request inserted first — re-read and return 409
          const [raceRow] = await scopedDb
            .select()
            .from(subaccountIeeBrowserSettings)
            .where(and(eq(subaccountIeeBrowserSettings.subaccountId, params.subaccountId), eq(subaccountIeeBrowserSettings.organisationId, params.orgId)))
            .limit(1);

          throw {
            statusCode: 409,
            message: 'Settings version conflict — another request already created this row',
            errorCode: 'IEE_BROWSER_SETTINGS_CONFLICT',
            currentEtag: String(raceRow?.settingsVersion ?? 1),
          };
        }
        throw err;
      }
    }

    // ETag check (row exists or version mismatch)
    const currentVersion = existing?.settingsVersion ?? 1;
    if (isETagConflict(params.expectedSettingsVersion, currentVersion)) {
      throw {
        statusCode: 409,
        message: 'Settings version conflict — reload and retry',
        errorCode: 'IEE_BROWSER_SETTINGS_CONFLICT',
        currentEtag: String(currentVersion),
      };
    }

    // Standard update
    const patchCols: Record<string, unknown> = {
      settingsVersion: sql`${subaccountIeeBrowserSettings.settingsVersion} + 1`,
      updatedAt: new Date(),
      updatedByUserId: params.actorUserId,
    };
    if (params.patch.status !== undefined) patchCols.status = params.patch.status;
    if (params.patch.browserProfileRetentionDays !== undefined) patchCols.browserProfileRetentionDays = params.patch.browserProfileRetentionDays;
    if (params.patch.perTaskCostCeilingCents !== undefined) patchCols.perTaskCostCeilingCents = params.patch.perTaskCostCeilingCents;
    if (params.patch.perSubaccountDailyCostCeilingCents !== undefined) patchCols.perSubaccountDailyCostCeilingCents = params.patch.perSubaccountDailyCostCeilingCents;

    const [updated] = await scopedDb
      .update(subaccountIeeBrowserSettings)
      .set(patchCols)
      .where(
        and(eq(subaccountIeeBrowserSettings.subaccountId, params.subaccountId), eq(subaccountIeeBrowserSettings.organisationId, params.orgId)),
      )
      .returning();

    return rowToResponse(updated!);
  },

  /**
   * Sets the rollout_approved flag. Admin-only.
   * Lazy-create: when expectedSettingsVersion === 0 and row absent → INSERT defaults + approved.
   * ETag conflict → 409. Lazy-create race (23505) → catch → re-read → 409.
   * Audit row inserted IN THE SAME TRANSACTION.
   */
  async setRolloutApproval(params: {
    orgId: string;
    subaccountId: string;
    approved: boolean;
    expectedSettingsVersion: number;
    actorUserId: string;
  }): Promise<IeeBrowserSettingsResponse> {
    const scopedDb = getOrgScopedDb('subaccountIeeBrowserSettingsService.setRolloutApproval');

    const [existing] = await scopedDb
      .select()
      .from(subaccountIeeBrowserSettings)
      .where(and(eq(subaccountIeeBrowserSettings.subaccountId, params.subaccountId), eq(subaccountIeeBrowserSettings.organisationId, params.orgId)))
      .limit(1);

    const rowExists = existing !== undefined;
    const priorRolloutApproved = existing?.rolloutApproved ?? false;

    // Lazy-create branch
    if (isLazyCreate(params.expectedSettingsVersion, rowExists)) {
      try {
        const [created] = await scopedDb
          .insert(subaccountIeeBrowserSettings)
          .values({
            subaccountId: params.subaccountId,
            organisationId: params.orgId,
            status: 'off',
            rolloutApproved: params.approved,
            browserProfileRetentionDays: 30,
            perTaskCostCeilingCents: 100,
            perSubaccountDailyCostCeilingCents: 500,
            settingsVersion: 1,
            updatedAt: new Date(),
            updatedByUserId: params.actorUserId,
          })
          .returning();

        await scopedDb.insert(auditEvents).values(
          buildRolloutAuditRow({
            actorUserId: params.actorUserId,
            orgId: params.orgId,
            subaccountId: params.subaccountId,
            priorValue: false,
            newValue: params.approved,
          }),
        );

        return rowToResponse(created!);
      } catch (err) {
        if (isLazyCreatePkConflict(err)) {
          const [raceRow] = await scopedDb
            .select()
            .from(subaccountIeeBrowserSettings)
            .where(and(eq(subaccountIeeBrowserSettings.subaccountId, params.subaccountId), eq(subaccountIeeBrowserSettings.organisationId, params.orgId)))
            .limit(1);

          throw {
            statusCode: 409,
            message: 'Settings version conflict — another request already created this row',
            errorCode: 'IEE_BROWSER_SETTINGS_CONFLICT',
            currentEtag: String(raceRow?.settingsVersion ?? 1),
          };
        }
        throw err;
      }
    }

    // ETag check
    const currentVersion = existing?.settingsVersion ?? 1;
    if (isETagConflict(params.expectedSettingsVersion, currentVersion)) {
      throw {
        statusCode: 409,
        message: 'Settings version conflict — reload and retry',
        errorCode: 'IEE_BROWSER_SETTINGS_CONFLICT',
        currentEtag: String(currentVersion),
      };
    }

    // Standard update
    const [updated] = await scopedDb
      .update(subaccountIeeBrowserSettings)
      .set({
        rolloutApproved: params.approved,
        settingsVersion: sql`${subaccountIeeBrowserSettings.settingsVersion} + 1`,
        updatedAt: new Date(),
        updatedByUserId: params.actorUserId,
      })
      .where(
        and(eq(subaccountIeeBrowserSettings.subaccountId, params.subaccountId), eq(subaccountIeeBrowserSettings.organisationId, params.orgId)),
      )
      .returning();

    await scopedDb.insert(auditEvents).values(
      buildRolloutAuditRow({
        actorUserId: params.actorUserId,
        orgId: params.orgId,
        subaccountId: params.subaccountId,
        priorValue: priorRolloutApproved,
        newValue: params.approved,
      }),
    );

    return rowToResponse(updated!);
  },
};
