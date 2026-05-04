import { db } from '../db/index.js';
import { teams, teamMembers, users } from '../db/schema/index.js';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';

export class TeamNameConflictError extends Error {
  readonly code = 'team_name_conflict' as const;
  constructor() {
    super('A team with that name already exists in this organisation');
  }
}

export class TeamNotFoundError extends Error {
  readonly code = 'team_not_found' as const;
  constructor() {
    super('Team not found');
  }
}

interface CreateTeamParams {
  organisationId: string;
  name: string;
  subaccountId?: string;
}

interface TeamRow {
  id: string;
  name: string;
  organisationId: string;
  subaccountId: string | null;
  memberCount: number;
  createdAt: Date;
}

async function listTeams(organisationId: string): Promise<TeamRow[]> {
  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      organisationId: teams.organisationId,
      subaccountId: teams.subaccountId,
      memberCount: sql<number>`count(${teamMembers.userId})`.mapWith(Number),
      createdAt: teams.createdAt,
    })
    .from(teams)
    .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .where(and(eq(teams.organisationId, organisationId), isNull(teams.deletedAt)))
    .groupBy(teams.id, teams.name, teams.organisationId, teams.subaccountId, teams.createdAt);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    organisationId: r.organisationId,
    subaccountId: r.subaccountId,
    memberCount: r.memberCount,
    createdAt: r.createdAt,
  }));
}

async function createTeam(params: CreateTeamParams): Promise<TeamRow> {
  const { organisationId, name, subaccountId } = params;

  const existing = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(
        eq(teams.organisationId, organisationId),
        eq(teams.name, name),
        isNull(teams.deletedAt)
      )
    )
    .limit(1);

  if (existing.length > 0) throw new TeamNameConflictError();

  const [row] = await db
    .insert(teams)
    .values({
      organisationId,
      name,
      subaccountId: subaccountId ?? null,
    })
    .returning();

  return {
    id: row.id,
    name: row.name,
    organisationId: row.organisationId,
    subaccountId: row.subaccountId,
    memberCount: 0,
    createdAt: row.createdAt,
  };
}

async function updateTeam(
  teamId: string,
  organisationId: string,
  name: string
): Promise<TeamRow> {
  const team = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(
        eq(teams.id, teamId),
        eq(teams.organisationId, organisationId),
        isNull(teams.deletedAt)
      )
    )
    .limit(1);

  if (team.length === 0) throw new TeamNotFoundError();

  const nameConflict = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(
        eq(teams.organisationId, organisationId),
        eq(teams.name, name),
        isNull(teams.deletedAt)
      )
    )
    .limit(1);

  if (nameConflict.length > 0 && nameConflict[0].id !== teamId) {
    throw new TeamNameConflictError();
  }

  const [updated] = await db
    .update(teams)
    .set({ name })
    .where(and(eq(teams.id, teamId), eq(teams.organisationId, organisationId)))
    .returning();

  const memberCountRows = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId));

  return {
    id: updated.id,
    name: updated.name,
    organisationId: updated.organisationId,
    subaccountId: updated.subaccountId,
    memberCount: memberCountRows[0]?.count ?? 0,
    createdAt: updated.createdAt,
  };
}

async function deleteTeam(teamId: string, organisationId: string): Promise<void> {
  const team = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(
        eq(teams.id, teamId),
        eq(teams.organisationId, organisationId),
        isNull(teams.deletedAt)
      )
    )
    .limit(1);

  if (team.length === 0) throw new TeamNotFoundError();

  await db
    .update(teams)
    .set({ deletedAt: new Date() })
    .where(and(eq(teams.id, teamId), eq(teams.organisationId, organisationId)));
}

interface MemberRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

async function listMembers(teamId: string, organisationId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.organisationId, organisationId),
        isNull(users.deletedAt)
      )
    );

  return rows;
}

async function addMembers(
  teamId: string,
  organisationId: string,
  userIds: string[]
): Promise<{ added: number }> {
  const team = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(
        eq(teams.id, teamId),
        eq(teams.organisationId, organisationId),
        isNull(teams.deletedAt)
      )
    )
    .limit(1);

  if (team.length === 0) throw new TeamNotFoundError();

  if (userIds.length === 0) return { added: 0 };

  const validUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, userIds), eq(users.organisationId, organisationId), isNull(users.deletedAt)));
  const validIds = validUsers.map((u) => u.id);

  if (validIds.length === 0) return { added: 0 };

  const values = validIds.map((userId) => ({
    teamId,
    userId,
    organisationId,
  }));

  const result = await db
    .insert(teamMembers)
    .values(values)
    .onConflictDoNothing()
    .returning({ userId: teamMembers.userId });

  return { added: result.length };
}

async function removeMember(
  teamId: string,
  organisationId: string,
  userId: string
): Promise<void> {
  const team = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(
        eq(teams.id, teamId),
        eq(teams.organisationId, organisationId),
        isNull(teams.deletedAt)
      )
    )
    .limit(1);

  if (team.length === 0) throw new TeamNotFoundError();

  await db
    .delete(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, userId),
        eq(teamMembers.organisationId, organisationId)
      )
    );
}

export const teamsService = {
  listTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  listMembers,
  addMembers,
  removeMember,
};
