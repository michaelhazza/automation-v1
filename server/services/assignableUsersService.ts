/**
 * server/services/assignableUsersService.ts
 *
 * Impure service: resolves the assignable-user pool for a given subaccount,
 * scoped by caller role per §14.2.
 */

import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, subaccountUserAssignments, teams } from '../db/schema/index.js';
import type { AssignableUsersIntent, AssignableUser, AssignableTeam, AssignableUsersResponse } from '../../shared/types/assignableUsers.js';
import { assertAccessForResolve } from './assignableUsersServicePure.js';

export interface ResolvePoolInput {
  caller: {
    id: string;
    role: string;
    organisationId: string;
    subaccountIds: string[];
  };
  organisationId: string;
  subaccountId: string;
  intent: AssignableUsersIntent;
}

/**
 * Map DB user role to the AssignableUser role discriminant.
 * The DB uses: system_admin | org_admin | manager | user | client_user
 * The spec wants: org_admin | org_manager | subaccount_admin | subaccount_member
 */
function mapUserRole(dbRole: string, _isSubaccountMember: boolean): AssignableUser['role'] {
  if (dbRole === 'org_admin') return 'org_admin';
  if (dbRole === 'manager') return 'org_manager';
  if (dbRole === 'client_user') return 'subaccount_member';
  // 'user', 'system_admin', and any unknown role map to subaccount_member.
  // The schema has no separate subaccount_admin DB role; privilege levels surface
  // via is_subaccount_member on the response object, not via the role field.
  return 'subaccount_member';
}

export const assignableUsersService = {
  /**
   * Returns the list of subaccount IDs the given user is a member of.
   * Used by the route to populate callerSubaccountIds without importing db directly.
   */
  async getCallerSubaccountIds(userId: string, orgId: string): Promise<string[]> {
    const rows = await db
      .select({ subaccountId: subaccountUserAssignments.subaccountId })
      .from(subaccountUserAssignments)
      .where(and(eq(subaccountUserAssignments.userId, userId), eq(subaccountUserAssignments.organisationId, orgId)));
    return rows.map((r) => r.subaccountId);
  },

  async resolvePool(input: ResolvePoolInput): Promise<AssignableUsersResponse> {
    const { caller, organisationId, subaccountId } = input;
    // intent is carried through but does NOT branch in V1 — both intents resolve identically.

    // ── Access check ──────────────────────────────────────────────────────────
    const access = assertAccessForResolve({
      callerRole: caller.role,
      callerOrgId: caller.organisationId,
      callerSubaccountIds: caller.subaccountIds,
      targetOrgId: organisationId,
      targetSubaccountId: subaccountId,
    });

    if (!access.allowed) {
      throw { statusCode: 403, message: 'Forbidden', errorCode: 'forbidden' };
    }

    // ── Fetch subaccount member user IDs for membership flagging ──────────────
    const subaccountMemberRows = await db
      .select({ userId: subaccountUserAssignments.userId })
      .from(subaccountUserAssignments)
      .where(eq(subaccountUserAssignments.subaccountId, subaccountId));

    const subaccountMemberSet = new Set(subaccountMemberRows.map((r) => r.userId));

    // ── Fetch users ───────────────────────────────────────────────────────────
    let userRows: Array<{ id: string; email: string; firstName: string; lastName: string; role: string }>;

    if (caller.role === 'org_admin' || caller.role === 'manager' || caller.role === 'system_admin') {
      // Org admin / manager: all org users
      userRows = await db
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
        })
        .from(users)
        .where(
          and(
            eq(users.organisationId, organisationId),
            isNull(users.deletedAt),
          )
        );
    } else {
      // Subaccount user: only users in this subaccount
      userRows = await db
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
        })
        .from(users)
        .innerJoin(
          subaccountUserAssignments,
          and(
            eq(subaccountUserAssignments.userId, users.id),
            eq(subaccountUserAssignments.subaccountId, subaccountId),
          )
        )
        .where(
          and(
            eq(users.organisationId, organisationId),
            isNull(users.deletedAt),
          )
        );
    }

    const assignableUsers: AssignableUser[] = userRows.map((u) => {
      const isSubaccountMember = subaccountMemberSet.has(u.id);
      return {
        id: u.id,
        name: `${u.firstName} ${u.lastName}`.trim(),
        email: u.email,
        role: mapUserRole(u.role, isSubaccountMember),
        is_org_user: true,
        is_subaccount_member: isSubaccountMember,
      };
    });

    // ── Fetch teams with member counts ────────────────────────────────────────
    const teamRows = await db
      .select({
        id: teams.id,
        name: teams.name,
        memberCount: sql<number>`(
          SELECT COUNT(*)::int FROM team_members tm WHERE tm.team_id = ${teams.id}
        )`,
      })
      .from(teams)
      .where(
        and(
          eq(teams.organisationId, organisationId),
          isNull(teams.deletedAt),
        )
      );

    const assignableTeams: AssignableTeam[] = teamRows.map((t) => ({
      id: t.id,
      name: t.name,
      member_count: t.memberCount ?? 0,
    }));

    return { users: assignableUsers, teams: assignableTeams };
  },
};
