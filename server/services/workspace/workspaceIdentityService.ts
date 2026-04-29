import { eq, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { workspaceIdentities } from '../../db/schema/workspaceIdentities.js';
import { nextStatus, type IdentityAction } from './workspaceIdentityServicePure.js';
import type { WorkspaceIdentityStatus } from '../../../shared/types/workspace.js';

export interface TransitionResult {
  status: WorkspaceIdentityStatus;
  noOpDueToRace: boolean;
}

export const workspaceIdentityService = {
  /**
   * Applies a lifecycle transition to a workspace_identities row.
   * Race-safe: uses a predicate-guarded UPDATE (WHERE status = current.status).
   * If a concurrent writer changed the status first, returns noOpDueToRace: true.
   */
  async transition(
    identityId: string,
    action: IdentityAction,
    changedByUserId: string,
  ): Promise<TransitionResult> {
    const [current] = await db
      .select()
      .from(workspaceIdentities)
      .where(eq(workspaceIdentities.id, identityId));

    if (!current) {
      throw Object.assign(new Error('Workspace identity not found'), { statusCode: 404 });
    }

    const currentStatus = current.status as WorkspaceIdentityStatus;
    const targetStatus = nextStatus(currentStatus, action); // throws if forbidden

    const setValues: Partial<typeof workspaceIdentities.$inferInsert> = {
      status: targetStatus,
      statusChangedAt: new Date(),
      statusChangedBy: changedByUserId,
      updatedAt: new Date(),
    };

    // Only set archivedAt when first transitioning TO archived and it isn't already set
    if (targetStatus === 'archived' && !current.archivedAt) {
      setValues.archivedAt = new Date();
    }

    const updated = await db
      .update(workspaceIdentities)
      .set(setValues)
      .where(
        and(
          eq(workspaceIdentities.id, identityId),
          eq(workspaceIdentities.status, currentStatus),
        ),
      )
      .returning();

    if (updated.length === 0) {
      // Predicate guard rejected — a concurrent writer changed status first
      const [refreshed] = await db
        .select()
        .from(workspaceIdentities)
        .where(eq(workspaceIdentities.id, identityId));

      return {
        status: (refreshed?.status ?? currentStatus) as WorkspaceIdentityStatus,
        noOpDueToRace: true,
      };
    }

    return { status: targetStatus, noOpDueToRace: false };
  },

  /**
   * Updates email_sending_enabled on the identity row.
   */
  async setEmailSending(
    identityId: string,
    enabled: boolean,
    changedByUserId: string,
  ): Promise<void> {
    await db
      .update(workspaceIdentities)
      .set({
        emailSendingEnabled: enabled,
        statusChangedBy: changedByUserId,
        updatedAt: new Date(),
      })
      .where(eq(workspaceIdentities.id, identityId));
  },

  /**
   * Returns all workspace_identities rows for a given actor.
   */
  async getIdentitiesForActor(actorId: string) {
    return db
      .select()
      .from(workspaceIdentities)
      .where(eq(workspaceIdentities.actorId, actorId));
  },

  /**
   * Returns all workspace_identities rows for a given subaccount (all statuses).
   */
  async getActiveIdentitiesForSubaccount(subaccountId: string) {
    return db
      .select()
      .from(workspaceIdentities)
      .where(eq(workspaceIdentities.subaccountId, subaccountId));
  },

  /**
   * Returns a single identity by id, or null if not found.
   */
  async getIdentityById(identityId: string) {
    const [identity] = await db
      .select()
      .from(workspaceIdentities)
      .where(eq(workspaceIdentities.id, identityId));
    return identity ?? null;
  },
};
