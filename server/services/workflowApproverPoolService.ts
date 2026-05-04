/**
 * WorkflowApproverPoolService — resolves approver pool snapshots by group kind.
 *
 * Spec: docs/workflows-dev-spec.md §5.1.
 *
 * Dispatches pool resolution to the appropriate handler based on
 * ApproverGroup.kind. DB queries are thin and scoped to the organisation.
 *
 * Re-exports userInPool from the pure module for call-site convenience.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { DB } from '../db/index.js';
import {
  tasks,
  teams,
  teamMembers,
  users,
  workflowRuns,
} from '../db/schema/index.js';
import type { ApproverGroup, ApproverPoolSnapshot } from '../../shared/types/workflowApproverGroup.js';
import { userInPool } from './workflowApproverPoolServicePure.js';
import { logger } from '../lib/logger.js';

export { userInPool } from './workflowApproverPoolServicePure.js';

// Transaction-aware db handle
type TxOrDb = DB | Parameters<Parameters<DB['transaction']>[0]>[0];

export const WorkflowApproverPoolService = {
  /**
   * Pure membership check — convenience wrapper on the service object.
   * Returns false when snapshot is null or empty, or userId is absent.
   */
  userInPool(
    snapshot: ApproverPoolSnapshot | null,
    userId: string,
  ): boolean {
    return userInPool(snapshot, userId);
  },

  /**
   * Resolve the approver pool snapshot for the given approver group.
   * Dispatches by `kind` and returns a flat list of user IDs.
   */
  async resolvePool(
    approverGroup: ApproverGroup,
    runContext: { runId: string; organisationId: string; subaccountId: string | null },
    tx?: TxOrDb,
  ): Promise<ApproverPoolSnapshot> {
    const dbHandle = tx ?? db;

    switch (approverGroup.kind) {
      case 'specific_users': {
        return approverGroup.userIds ?? [];
      }

      case 'task_requester': {
        const [row] = await (dbHandle as typeof db)
          .select({ createdByUserId: tasks.createdByUserId })
          .from(tasks)
          .innerJoin(workflowRuns, eq(workflowRuns.taskId, tasks.id))
          .where(
            and(
              eq(workflowRuns.id, runContext.runId),
              eq(workflowRuns.organisationId, runContext.organisationId),
            ),
          );

        if (!row) {
          logger.warn('workflow_approver_pool_task_requester_not_found', {
            runId: runContext.runId,
            organisationId: runContext.organisationId,
            reason: 'task_not_found',
          });
          return [];
        }

        if (row.createdByUserId === null) {
          logger.warn('workflow_approver_pool_task_requester_null', {
            runId: runContext.runId,
            organisationId: runContext.organisationId,
          });
          return [];
        }

        return [row.createdByUserId];
      }

      case 'team': {
        const teamId = approverGroup.teamId;
        if (!teamId) {
          logger.warn('workflow_approver_pool_team_empty', {
            teamId: undefined,
            organisationId: runContext.organisationId,
            reason: 'teamId_missing_in_approver_group',
          });
          return [];
        }

        const rows = await (dbHandle as typeof db)
          .select({ userId: teamMembers.userId })
          .from(teamMembers)
          .innerJoin(teams, eq(teamMembers.teamId, teams.id))
          .where(
            and(
              eq(teams.id, teamId),
              eq(teams.organisationId, runContext.organisationId),
              isNull(teams.deletedAt),
            ),
          );

        const userIds = rows.map((r) => r.userId);

        if (userIds.length === 0) {
          logger.warn('workflow_approver_pool_team_empty', {
            teamId,
            organisationId: runContext.organisationId,
          });
        }

        return userIds;
      }

      case 'org_admin': {
        const rows = await (dbHandle as typeof db)
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organisationId, runContext.organisationId),
              eq(users.role, 'org_admin'),
              isNull(users.deletedAt),
            ),
          );

        return rows.map((r) => r.id);
      }

      default: {
        // Exhaustive guard — TypeScript should catch unknown kinds at compile time.
        logger.warn('workflow_approver_pool_unknown_kind', {
          kind: (approverGroup as ApproverGroup).kind,
        });
        return [];
      }
    }
  },

};
