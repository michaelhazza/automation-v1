/**
 * server/services/teamsService.ts
 *
 * CRUD operations for teams and team members.
 * All operations are scoped to organisationId for tenant isolation.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { teams, teamMembers, users } from '../db/schema/index.js';
import type { Team } from '../db/schema/teams.js';
import { assertTeamNameValid } from './teamsServicePure.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function assertTeamExists(organisationId: string, teamId: string): Promise<Team> {
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.organisationId, organisationId), isNull(teams.deletedAt)));

  if (!team) {
    throw { statusCode: 404, message: 'Team not found', errorCode: 'team_not_found' };
  }
  return team;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const teamsService = {
  /**
   * List teams in an org, optionally filtered by subaccountId.
   */
  async listTeams(organisationId: string, subaccountId?: string): Promise<Team[]> {
    const conditions = [eq(teams.organisationId, organisationId), isNull(teams.deletedAt)];

    if (subaccountId !== undefined) {
      conditions.push(eq(teams.subaccountId, subaccountId));
    }

    return db.select().from(teams).where(and(...conditions));
  },

  /**
   * Create a team. 409 on duplicate name in scope (org + optional subaccount).
   */
  async createTeam(
    organisationId: string,
    name: string,
    subaccountId: string | undefined,
    _createdByUserId: string,
  ): Promise<Team> {
    const nameCheck = assertTeamNameValid(name);
    if (!nameCheck.ok) {
      throw { statusCode: 400, message: `Invalid team name: ${nameCheck.reason}`, errorCode: nameCheck.reason };
    }

    // Duplicate name check within scope
    const conditions = [
      eq(teams.organisationId, organisationId),
      eq(teams.name, name),
      isNull(teams.deletedAt),
    ];

    if (subaccountId !== undefined) {
      conditions.push(eq(teams.subaccountId, subaccountId));
    }

    const [existing] = await db.select({ id: teams.id }).from(teams).where(and(...conditions)).limit(1);
    if (existing) {
      throw { statusCode: 409, message: 'A team with this name already exists', errorCode: 'team_name_conflict' };
    }

    const [created] = await db
      .insert(teams)
      .values({
        organisationId,
        name,
        subaccountId: subaccountId ?? null,
      })
      .returning();

    return created!;
  },

  /**
   * Update a team's name.
   */
  async updateTeam(
    organisationId: string,
    teamId: string,
    patch: { name?: string },
  ): Promise<Team> {
    await assertTeamExists(organisationId, teamId);

    if (patch.name !== undefined) {
      const nameCheck = assertTeamNameValid(patch.name);
      if (!nameCheck.ok) {
        throw { statusCode: 400, message: `Invalid team name: ${nameCheck.reason}`, errorCode: nameCheck.reason };
      }
    }

    const [updated] = await db
      .update(teams)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
      })
      .where(and(eq(teams.id, teamId), eq(teams.organisationId, organisationId), isNull(teams.deletedAt)))
      .returning();

    if (!updated) {
      throw { statusCode: 404, message: 'Team not found', errorCode: 'team_not_found' };
    }

    return updated;
  },

  /**
   * Soft-delete a team.
   */
  async deleteTeam(organisationId: string, teamId: string): Promise<void> {
    await assertTeamExists(organisationId, teamId);

    await db
      .update(teams)
      .set({ deletedAt: new Date() })
      .where(and(eq(teams.id, teamId), eq(teams.organisationId, organisationId)));
  },

  /**
   * Add members to a team. Uses ON CONFLICT DO NOTHING; returns count of newly added rows.
   */
  async addTeamMembers(
    organisationId: string,
    teamId: string,
    userIds: string[],
  ): Promise<{ added: number }> {
    await assertTeamExists(organisationId, teamId);

    if (userIds.length === 0) {
      return { added: 0 };
    }

    const rows = userIds.map((userId) => ({
      teamId,
      userId,
      organisationId,
    }));

    const inserted = await db
      .insert(teamMembers)
      .values(rows)
      .onConflictDoNothing()
      .returning({ teamId: teamMembers.teamId });

    return { added: inserted.length };
  },

  /**
   * List members of a team with basic user info.
   */
  async listTeamMembers(
    organisationId: string,
    teamId: string,
  ): Promise<Array<{ teamId: string; userId: string; organisationId: string; addedAt: Date; firstName: string; lastName: string; email: string }>> {
    await assertTeamExists(organisationId, teamId);

    const rows = await db
      .select({
        teamId: teamMembers.teamId,
        userId: teamMembers.userId,
        organisationId: teamMembers.organisationId,
        addedAt: teamMembers.addedAt,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.organisationId, organisationId),
          isNull(users.deletedAt),
        )
      );

    return rows;
  },

  /**
   * Remove a member from a team.
   */
  async removeTeamMember(
    organisationId: string,
    teamId: string,
    userId: string,
  ): Promise<void> {
    await assertTeamExists(organisationId, teamId);

    await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, userId),
          eq(teamMembers.organisationId, organisationId),
        )
      );
  },
};
