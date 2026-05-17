// subaccountOperatorSettingsService.ts — impure facade for subaccount_operator_settings.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.16
//
// ETag = String(settings_version) per R2-F3 (integer column, not timestamp).
// PATCH UPDATE uses settings_version = settings_version + 1.
// If-Match check: row.settings_version.toString() !== ifMatchHeader → 409 OPERATOR_SETTINGS_CONFLICT.

import { eq, and, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { subaccountOperatorSettings } from '../db/schema/index.js';
import type { SubaccountOperatorSettings } from '../db/schema/subaccountOperatorSettings.js';
import { setOrgAndSubaccountGUC } from '../lib/orgScoping.js';
import {
  extractSettingsSnapshot,
  getDefaultSettingsSnapshot,
  validateOperatorSettingsRange,
  deriveSettingsETag,
} from './subaccountOperatorSettingsServicePure.js';
import type { OperatorRunSettingsSnapshot } from '../../shared/types/operatorRuns.js';
import { OperatorBackendConflictError } from './operatorBackendErrors.js';

export type { SubaccountOperatorSettings };

export interface EffectiveOperatorSettings extends OperatorRunSettingsSnapshot {
  settingsVersion: number;
  etag: string;
}

export const subaccountOperatorSettingsService = {
  /**
   * Returns the effective settings for a subaccount, including the ETag.
   * If no row exists, returns the default settings with version=1.
   */
  async getEffectiveSettings(
    orgId: string,
    subaccountId: string,
  ): Promise<EffectiveOperatorSettings> {
    return getOrgScopedDb('subaccountOperatorSettingsService.getEffectiveSettings').transaction(async (tx) => {
      await setOrgAndSubaccountGUC(tx, orgId, subaccountId);

      const [row] = await tx
        .select()
        .from(subaccountOperatorSettings)
        .where(eq(subaccountOperatorSettings.subaccountId, subaccountId))
        .limit(1);

      if (!row) {
        const defaults = getDefaultSettingsSnapshot();
        return {
          ...defaults,
          settingsVersion: 1,
          etag: deriveSettingsETag(1),
        };
      }

      const snapshot = extractSettingsSnapshot({
        session_soft_cap_minutes: row.sessionSoftCapMinutes,
        auto_extend_grace_minutes: row.autoExtendGraceMinutes,
        max_chain_length: row.maxChainLength,
        max_wall_clock_per_task_days: row.maxWallClockPerTaskDays,
        per_task_budget_cap_minutes: row.perTaskBudgetCapMinutes,
        concurrent_operator_sessions_cap: row.concurrentOperatorSessionsCap,
      });

      return {
        ...snapshot,
        settingsVersion: row.settingsVersion,
        etag: deriveSettingsETag(row.settingsVersion),
      };
    });
  },

  /**
   * Returns the current row and ETag for conditional updates (If-Match).
   */
  async readForEtag(
    orgId: string,
    subaccountId: string,
  ): Promise<{ row: SubaccountOperatorSettings | null; etag: string }> {
    return getOrgScopedDb('subaccountOperatorSettingsService.readForEtag').transaction(async (tx) => {
      await setOrgAndSubaccountGUC(tx, orgId, subaccountId);

      const [row] = await tx
        .select()
        .from(subaccountOperatorSettings)
        .where(eq(subaccountOperatorSettings.subaccountId, subaccountId))
        .limit(1);

      if (!row) {
        return { row: null, etag: deriveSettingsETag(1) };
      }

      return { row, etag: deriveSettingsETag(row.settingsVersion) };
    });
  },

  /**
   * Applies a partial settings update with optimistic concurrency via If-Match.
   *
   * If ifMatchETag is provided and does not match the current settings_version,
   * throws OperatorBackendConflictError with kind='OPERATOR_SETTINGS_CONFLICT'.
   *
   * Increments settings_version atomically on every successful write.
   */
  async updateSettings(params: {
    orgId: string;
    subaccountId: string;
    patch: Partial<OperatorRunSettingsSnapshot>;
    updatedByUserId?: string;
    ifMatchETag?: string;
  }): Promise<{ row: SubaccountOperatorSettings; etag: string }> {
    validateOperatorSettingsRange(params.patch);

    return getOrgScopedDb('subaccountOperatorSettingsService.updateSettings').transaction(async (tx) => {
      await setOrgAndSubaccountGUC(tx, params.orgId, params.subaccountId);

      const [existing] = await tx
        .select()
        .from(subaccountOperatorSettings)
        .where(eq(subaccountOperatorSettings.subaccountId, params.subaccountId))
        .limit(1);

      if (params.ifMatchETag !== undefined) {
        const currentVersion = existing?.settingsVersion ?? 1;
        if (currentVersion.toString() !== params.ifMatchETag) {
          throw new OperatorBackendConflictError({
            kind: 'OPERATOR_SETTINGS_CONFLICT',
            currentState: { settings_version: currentVersion },
          });
        }
      }

      const patchColumns: Record<string, unknown> = {};
      if (params.patch.session_soft_cap_minutes !== undefined) {
        patchColumns.sessionSoftCapMinutes = params.patch.session_soft_cap_minutes;
      }
      if (params.patch.auto_extend_grace_minutes !== undefined) {
        patchColumns.autoExtendGraceMinutes = params.patch.auto_extend_grace_minutes;
      }
      if (params.patch.max_chain_length !== undefined) {
        patchColumns.maxChainLength = params.patch.max_chain_length;
      }
      if (params.patch.max_wall_clock_per_task_days !== undefined) {
        patchColumns.maxWallClockPerTaskDays = params.patch.max_wall_clock_per_task_days;
      }
      if (params.patch.per_task_budget_cap_minutes !== undefined) {
        patchColumns.perTaskBudgetCapMinutes = params.patch.per_task_budget_cap_minutes;
      }
      if (params.patch.concurrent_operator_sessions_cap !== undefined) {
        patchColumns.concurrentOperatorSessionsCap = params.patch.concurrent_operator_sessions_cap;
      }

      if (!existing) {
        const defaults = getDefaultSettingsSnapshot();
        const merged = { ...defaults, ...params.patch };

        const [created] = await tx
          .insert(subaccountOperatorSettings)
          .values({
            subaccountId: params.subaccountId,
            organisationId: params.orgId,
            sessionSoftCapMinutes: merged.session_soft_cap_minutes,
            autoExtendGraceMinutes: merged.auto_extend_grace_minutes,
            maxChainLength: merged.max_chain_length,
            maxWallClockPerTaskDays: merged.max_wall_clock_per_task_days,
            perTaskBudgetCapMinutes: merged.per_task_budget_cap_minutes,
            concurrentOperatorSessionsCap: merged.concurrent_operator_sessions_cap,
            settingsVersion: 1,
            updatedAt: new Date(),
            updatedByUserId: params.updatedByUserId ?? null,
          })
          .returning();

        return { row: created!, etag: deriveSettingsETag(created!.settingsVersion) };
      }

      const [updated] = await tx
        .update(subaccountOperatorSettings)
        .set({
          ...patchColumns,
          settingsVersion: sql`${subaccountOperatorSettings.settingsVersion} + 1`,
          updatedAt: new Date(),
          updatedByUserId: params.updatedByUserId ?? null,
        })
        .where(
          and(
            eq(subaccountOperatorSettings.subaccountId, params.subaccountId),
            eq(subaccountOperatorSettings.organisationId, params.orgId),
          ),
        )
        .returning();

      return { row: updated!, etag: deriveSettingsETag(updated!.settingsVersion) };
    });
  },
};
