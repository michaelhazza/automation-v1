import { db } from '../db/index.js';
import { users, subaccountUserAssignments, teams, teamMembers } from '../db/schema/index.js';
import { eq, and, isNull, sql } from 'drizzle-orm';
import type { AssignableUser, AssignableTeam, AssignableUsersIntent } from '../../shared/types/assignableUsers.js';

export class ForbiddenError extends Error {
  readonly code = 'forbidden' as const;
  constructor() {
    super('Forbidden');
  }
}

export type CallerRole = 'org_admin' | 'org_manager' | 'subaccount_admin' | 'subaccount_member';

export interface ResolvePoolParams {
  caller: { id: string; dbRole: string };
  organisationId: string;
  subaccountId: string;
  intent: AssignableUsersIntent;
}

function mapDbRoleToResponseRole(
  dbRole: string,
  hasSubaccountAssignment: boolean
): AssignableUser['role'] {
  if (dbRole === 'org_admin' || dbRole === 'system_admin') return 'org_admin';
  if (dbRole === 'manager') return 'org_manager';
  if (dbRole === 'user' && hasSubaccountAssignment) return 'subaccount_admin';
  return 'subaccount_member';
}

function isOrgUser(dbRole: string): boolean {
  return dbRole === 'org_admin' || dbRole === 'manager' || dbRole === 'system_admin';
}

async function resolvePool(
  params: ResolvePoolParams
): Promise<{ users: AssignableUser[]; teams: AssignableTeam[] }> {
  const { caller, organisationId, subaccountId, intent: _intent } = params;
  const { dbRole } = caller;

  if (dbRole === 'client_user') {
    throw new ForbiddenError();
  }

  const isOrgLevelCaller =
    dbRole === 'org_admin' || dbRole === 'system_admin' || dbRole === 'manager';

  if (dbRole === 'user') {
    const assignment = await db
      .select({ id: subaccountUserAssignments.id })
      .from(subaccountUserAssignments)
      .where(
        and(
          eq(subaccountUserAssignments.subaccountId, subaccountId),
          eq(subaccountUserAssignments.userId, caller.id)
        )
      )
      .limit(1);
    if (assignment.length === 0) {
      throw new ForbiddenError();
    }
  }

  let resolvedUsers: AssignableUser[];

  if (isOrgLevelCaller) {
    const rows = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: users.role,
        assignmentId: subaccountUserAssignments.id,
      })
      .from(users)
      .leftJoin(
        subaccountUserAssignments,
        and(
          eq(subaccountUserAssignments.userId, users.id),
          eq(subaccountUserAssignments.subaccountId, subaccountId)
        )
      )
      .where(
        and(
          eq(users.organisationId, organisationId),
          isNull(users.deletedAt)
        )
      );

    resolvedUsers = rows.map((row) => {
      const isMember = row.assignmentId !== null;
      return {
        id: row.id,
        name: `${row.firstName} ${row.lastName}`.trim(),
        email: isMember ? row.email : null,
        role: mapDbRoleToResponseRole(row.role, isMember),
        is_org_user: isOrgUser(row.role),
        is_subaccount_member: isMember,
      };
    });
  } else {
    // subaccount_admin (user with subaccount assignment) — sees only subaccount members
    const rows = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: users.role,
      })
      .from(subaccountUserAssignments)
      .innerJoin(users, eq(users.id, subaccountUserAssignments.userId))
      .where(
        and(
          eq(subaccountUserAssignments.subaccountId, subaccountId),
          isNull(users.deletedAt)
        )
      );

    resolvedUsers = rows.map((row) => ({
      id: row.id,
      name: `${row.firstName} ${row.lastName}`.trim(),
      email: row.email,
      role: mapDbRoleToResponseRole(row.role, true),
      is_org_user: isOrgUser(row.role),
      is_subaccount_member: true,
    }));
  }

  // Teams resolution
  const teamsBase = isOrgLevelCaller
    ? await db
        .select({
          id: teams.id,
          name: teams.name,
          memberCount: sql<number>`count(${teamMembers.userId})`.mapWith(Number),
        })
        .from(teams)
        .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
        .where(
          and(
            eq(teams.organisationId, organisationId),
            isNull(teams.deletedAt)
          )
        )
        .groupBy(teams.id, teams.name)
    : await db
        .select({
          id: teams.id,
          name: teams.name,
          memberCount: sql<number>`count(${teamMembers.userId})`.mapWith(Number),
        })
        .from(teams)
        .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
        .where(
          and(
            eq(teams.organisationId, organisationId),
            eq(teams.subaccountId, subaccountId),
            isNull(teams.deletedAt)
          )
        )
        .groupBy(teams.id, teams.name);

  const resolvedTeams: AssignableTeam[] = teamsBase.map((t) => ({
    id: t.id,
    name: t.name,
    member_count: t.memberCount,
  }));

  return { users: resolvedUsers, teams: resolvedTeams };
}

export const assignableUsersService = { resolvePool };
