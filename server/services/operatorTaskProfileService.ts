// operatorTaskProfileService.ts — impure facade for operator_task_profiles.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.15
//
// Every public method takes (orgId, subaccountId) as the first two parameters
// and calls setOrgAndSubaccountGUC as the first statement in the transaction.
// Profile GC uses withAdminConnectionGuarded + SET LOCAL ROLE admin_role.

import { eq, and, sql, lte } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { operatorTaskProfiles } from '../db/schema/index.js';
import type { OperatorTaskProfile } from '../db/schema/operatorTaskProfiles.js';
import { setOrgAndSubaccountGUC } from '../lib/orgScoping.js';
import { withAdminConnectionGuarded } from '../lib/rlsBoundaryGuard.js';
import {
  deriveProfileRetentionWindow,
  validateProfileStatusTransition,
} from './operatorTaskProfileServicePure.js';

export type { OperatorTaskProfile };

export const operatorTaskProfileService = {
  /**
   * Ensures an active profile row exists for (taskId, attemptNumber).
   * Creates one if absent; returns the existing row if present.
   *
   * Must be called at chain-link start after the sandbox volume is allocated.
   */
  async ensureActiveProfile(
    orgId: string,
    subaccountId: string,
    taskId: string,
    attemptNumber: number,
    volumeId: string,
  ): Promise<OperatorTaskProfile> {
    return getOrgScopedDb('operatorTaskProfileService.ensureActiveProfile').transaction(async (tx) => {
      await setOrgAndSubaccountGUC(tx, orgId, subaccountId);

      const [existing] = await tx
        .select()
        .from(operatorTaskProfiles)
        .where(
          and(
            eq(operatorTaskProfiles.taskId, taskId),
            eq(operatorTaskProfiles.attemptNumber, attemptNumber),
          ),
        )
        .limit(1);

      if (existing) {
        return existing;
      }

      const [created] = await tx
        .insert(operatorTaskProfiles)
        .values({
          taskId,
          organisationId: orgId,
          subaccountId,
          attemptNumber,
          volumeId,
          status: 'active',
        })
        .returning();

      return created!;
    });
  },

  /**
   * Schedules a profile for GC after the given retention window.
   * Sets status to 'scheduled_gc' and scheduledGcAt to now + retentionMs.
   */
  async scheduleGc(
    orgId: string,
    subaccountId: string,
    taskId: string,
    attemptNumber: number,
    retentionMs: number,
  ): Promise<void> {
    await getOrgScopedDb('operatorTaskProfileService.scheduleGc').transaction(async (tx) => {
      await setOrgAndSubaccountGUC(tx, orgId, subaccountId);

      const [row] = await tx
        .select()
        .from(operatorTaskProfiles)
        .where(
          and(
            eq(operatorTaskProfiles.taskId, taskId),
            eq(operatorTaskProfiles.attemptNumber, attemptNumber),
          ),
        )
        .limit(1);

      if (!row) return;

      validateProfileStatusTransition(row.status, 'scheduled_gc');

      const scheduledGcAt = deriveProfileRetentionWindow(new Date(), false);
      // Override with caller-supplied retention if it differs from the default.
      const gcAt = new Date(Date.now() + retentionMs);

      await tx
        .update(operatorTaskProfiles)
        .set({
          status: 'scheduled_gc',
          scheduledGcAt: gcAt < scheduledGcAt ? gcAt : scheduledGcAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(operatorTaskProfiles.taskId, taskId),
            eq(operatorTaskProfiles.attemptNumber, attemptNumber),
          ),
        );
    });
  },

  /**
   * Extends the GC retention window to 14 days for admin debug access.
   * Sets debugRetentionExtendedBy and resets scheduledGcAt.
   */
  async extendDebugRetention(
    orgId: string,
    subaccountId: string,
    taskId: string,
    actorUserId: string,
  ): Promise<void> {
    await getOrgScopedDb('operatorTaskProfileService.extendDebugRetention').transaction(async (tx) => {
      await setOrgAndSubaccountGUC(tx, orgId, subaccountId);

      const [row] = await tx
        .select()
        .from(operatorTaskProfiles)
        .where(eq(operatorTaskProfiles.taskId, taskId))
        .limit(1);

      if (!row) return;

      const extendedGcAt = deriveProfileRetentionWindow(new Date(), true);

      await tx
        .update(operatorTaskProfiles)
        .set({
          scheduledGcAt: extendedGcAt,
          debugRetentionExtendedBy: actorUserId,
          debugRetentionExtendedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(operatorTaskProfiles.taskId, taskId));
    });
  },

  /**
   * Reclaims stale gc_in_progress rows and re-schedules them.
   * Uses withAdminConnectionGuarded because GC crosses org boundaries.
   * Per spec §7.5: 30-minute stale window; admin role required.
   */
  async reclaimStaleGcInProgress(staleThresholdMs: number): Promise<number> {
    return withAdminConnectionGuarded(
      // allowRlsBypass: GC deliberately crosses org boundaries (retention pruner)
      { source: 'operatorTaskProfileGc', allowRlsBypass: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        const staleThreshold = new Date(Date.now() - staleThresholdMs);

        const updated = await tx
          .update(operatorTaskProfiles)
          .set({
            status: 'scheduled_gc',
            gcStartedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(operatorTaskProfiles.status, 'gc_in_progress'),
              sql`${operatorTaskProfiles.gcStartedAt} < ${staleThreshold}`,
            ),
          )
          .returning({ id: operatorTaskProfiles.id });

        return updated.length;
      },
    );
  },

  /**
   * Runs the scheduled GC sweep: finds profiles with status='scheduled_gc'
   * and scheduled_gc_at <= now(), transitions them to 'gc_done'.
   *
   * Provider 404 on volume delete is treated as gc_done (volume already gone).
   * Uses withAdminConnectionGuarded because GC crosses org boundaries.
   * Returns count of profiles transitioned to gc_done.
   */
  async runScheduledGcSweep(): Promise<number> {
    return withAdminConnectionGuarded(
      // allowRlsBypass: GC deliberately crosses org boundaries (retention pruner)
      { source: 'operatorTaskProfileGc', allowRlsBypass: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        const now = new Date();

        const updated = await tx
          .update(operatorTaskProfiles)
          .set({
            status: 'gc_done',
            updatedAt: now,
          })
          .where(
            and(
              eq(operatorTaskProfiles.status, 'scheduled_gc'),
              lte(operatorTaskProfiles.scheduledGcAt, now),
            ),
          )
          .returning({ id: operatorTaskProfiles.id });

        return updated.length;
      },
    );
  },
};
