/**
 * WorkflowApproverPoolService — resolves an approver pool from an ApproverGroup.
 *
 * Paired pure helpers: workflowApproverPoolServicePure.ts.
 *
 * All DB queries filter by organisationId explicitly (tenant-isolation rule).
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { teams, teamMembers, workflowRuns, users } from '../db/schema/index.js';
import type { ApproverGroup, ApproverPoolSnapshot } from '../../shared/types/workflowStepGate.js';
import { resolveSpecificUsersPool } from './workflowApproverPoolServicePure.js';

export const WorkflowApproverPoolService = {
  /**
   * Resolve the full user-ID pool from an ApproverGroup descriptor.
   * Returns an ApproverPoolSnapshot (string[]).
   *
   * - specific_users: returns the provided IDs directly (validator already
   *   confirmed they exist).
   * - team: loads all non-deleted team members for the given team within the org.
   * - task_requester: loads the createdByUserId of the task that started the run.
   * - org_admin: loads all users in the org with role 'org_admin'.
   */
  async resolvePool(
    approverGroup: ApproverGroup,
    runContext: { taskId: string; runId: string },
    organisationId: string,
    _subaccountId: string | null
  ): Promise<ApproverPoolSnapshot> {
    const db = getOrgScopedDb('workflowApproverPoolService.resolvePool');

    switch (approverGroup.kind) {
      case 'specific_users': {
        return resolveSpecificUsersPool(approverGroup.userIds ?? []);
      }

      case 'team': {
        if (!approverGroup.teamId) {
          throw {
            statusCode: 400,
            message: 'approverGroup.teamId is required when kind is "team"',
            errorCode: 'approver_pool_missing_team_id',
          };
        }
        // Verify the team exists and belongs to this org (soft-delete aware).
        const [team] = await db
          .select({ id: teams.id })
          .from(teams)
          .where(
            and(
              eq(teams.id, approverGroup.teamId),
              eq(teams.organisationId, organisationId),
              isNull(teams.deletedAt)
            )
          );
        if (!team) {
          // Team not found or deleted — return empty pool (open gate).
          return [];
        }
        // Load all team members for this team within the org.
        const members = await db
          .select({ userId: teamMembers.userId })
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, approverGroup.teamId),
              eq(teamMembers.organisationId, organisationId)
            )
          );
        return members.map((m) => m.userId);
      }

      case 'task_requester': {
        // The "requester" is the user who started the workflow run.
        // Falls back to open pool if the run was system-initiated (no user).
        const [run] = await db
          .select({ startedByUserId: workflowRuns.startedByUserId })
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.id, runContext.runId),
              eq(workflowRuns.organisationId, organisationId)
            )
          );
        if (!run || !run.startedByUserId) {
          // No human requester on this run — open pool.
          return [];
        }
        return [run.startedByUserId];
      }

      case 'org_admin': {
        // The `role` column lives on the `users` table — query all org_admin
        // users scoped to this organisation.
        const admins = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organisationId, organisationId),
              eq(users.role, 'org_admin'),
              isNull(users.deletedAt)
            )
          );
        return admins.map((u) => u.id);
      }

      default: {
        // Narrow exhaustiveness — TypeScript will catch new kinds at compile time.
        const exhaustive: never = approverGroup.kind;
        throw {
          statusCode: 400,
          message: `Unknown approverGroup kind: ${exhaustive}`,
          errorCode: 'approver_pool_unknown_kind',
        };
      }
    }
  },
};
