import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { projects, agents, agentRuns } from '../db/schema/index.js';
import { eq, and, isNull, inArray, count, desc } from 'drizzle-orm';
import { IN_FLIGHT_RUN_STATUSES } from '../../shared/runStatus.js';

export interface ApiProject {
  id: string;
  organisationId: string;
  subaccountId: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'completed' | 'archived';
  color: string;
  objective: string | null;
  targetDate: string | null;
  budgetUsd: number | null;
  budgetWarnThresholdPct: number;
  repositoryUrl: string | null;
  linkedAgents: string[];
  migratedFromGoalsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPatch {
  name?: string;
  color?: string;
  description?: string;
  status?: 'active' | 'paused' | 'completed' | 'archived';
  objective?: string | null;
  targetDate?: string | null;
  budgetUsd?: number | null;
  budgetWarnThresholdPct?: number;
  repositoryUrl?: string | null;
  linkedAgents?: string[];
  // Legacy pass-through fields accepted by the subaccount route
  githubConnectionId?: string | null;
  goalId?: string | null;
  budgetCents?: number | null;
}

export interface CreateProjectInput {
  name?: string;
  description?: string;
  color?: string;
  repoUrl?: string;
  githubConnectionId?: string;
  targetDate?: string;
  budgetCents?: number;
  budgetWarningPercent?: number;
  goalId?: string;
}

export function toApiProject(row: typeof projects.$inferSelect): ApiProject {
  return {
    id: row.id,
    organisationId: row.organisationId,
    subaccountId: row.subaccountId,
    name: row.name,
    description: row.description ?? null,
    status: row.status as 'active' | 'paused' | 'completed' | 'archived',
    color: row.color,
    objective: row.objective ?? null,
    targetDate: row.targetDate?.toISOString() ?? null,
    budgetUsd: row.budgetCents !== null && row.budgetCents !== undefined ? row.budgetCents / 100 : null,
    budgetWarnThresholdPct: row.budgetWarningPercent ?? 75,
    repositoryUrl: row.repoUrl ?? null,
    linkedAgents: row.linkedAgentIds ?? [],
    migratedFromGoalsAt: row.migratedFromGoalsAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function fromApiPatch(body: ProjectPatch): Partial<typeof projects.$inferInsert> {
  const updates: Partial<typeof projects.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.description !== undefined) updates.description = body.description ?? null;
  if (body.status !== undefined) updates.status = body.status;
  if (body.color !== undefined) updates.color = body.color;
  if (body.objective !== undefined) updates.objective = body.objective ?? null;
  if (body.targetDate !== undefined) updates.targetDate = body.targetDate === null ? null : new Date(body.targetDate);
  if (body.budgetUsd !== undefined) {
    updates.budgetCents = body.budgetUsd === null ? null : Math.round(body.budgetUsd * 100);
  } else if (body.budgetCents !== undefined) {
    // Legacy callers send raw cents; convert only if budgetUsd is not also provided
    updates.budgetCents = body.budgetCents;
  }
  if (body.budgetWarnThresholdPct !== undefined) updates.budgetWarningPercent = body.budgetWarnThresholdPct;
  if (body.repositoryUrl !== undefined) updates.repoUrl = body.repositoryUrl;
  if (body.linkedAgents !== undefined) updates.linkedAgentIds = [...new Set(body.linkedAgents)];
  // Legacy pass-through fields
  if (body.githubConnectionId !== undefined) updates.githubConnectionId = body.githubConnectionId ?? null;
  if (body.goalId !== undefined) updates.goalId = body.goalId ?? null;
  return updates;
}

export const projectService = {
  async getById(orgId: string, projectId: string): Promise<ApiProject> {
    const [row] = await getOrgScopedDb('projectService.getById')
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organisationId, orgId), isNull(projects.deletedAt)));
    if (!row) throw { statusCode: 404, message: 'Project not found', errorCode: 'PROJECT_NOT_FOUND' };
    return toApiProject(row);
  },

  async list(orgId: string, subaccountId: string): Promise<ApiProject[]> {
    const rows = await getOrgScopedDb('projectService.list')
      .select()
      .from(projects)
      .where(and(
        eq(projects.subaccountId, subaccountId),
        isNull(projects.deletedAt),
      ))
      .orderBy(desc(projects.createdAt));
    return rows.map(toApiProject);
  },

  async create(orgId: string, subaccountId: string, data: CreateProjectInput, createdBy: string | null): Promise<ApiProject> {
    if (!data.name?.trim()) throw { statusCode: 400, message: 'name is required' };

    const [row] = await getOrgScopedDb('projectService.create').insert(projects).values({
      organisationId: orgId,
      subaccountId,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      color: data.color || '#6366f1',
      repoUrl: data.repoUrl?.trim() || null,
      githubConnectionId: data.githubConnectionId || null,
      targetDate: data.targetDate ? new Date(data.targetDate) : null,
      budgetCents: data.budgetCents ?? null,
      budgetWarningPercent: data.budgetWarningPercent ?? 75,
      goalId: data.goalId || null,
      createdBy,
    }).returning();
    return toApiProject(row);
  },

  async softDelete(orgId: string, subaccountId: string, projectId: string): Promise<{ success: true }> {
    const softDeleteScopedDb = getOrgScopedDb('projectService.softDelete');
    const [existing] = await softDeleteScopedDb
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.subaccountId, subaccountId), isNull(projects.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Project not found' };

    await softDeleteScopedDb.update(projects).set({ deletedAt: new Date() }).where(and(eq(projects.id, projectId), eq(projects.organisationId, orgId)));

    return { success: true };
  },

  async getInFlightRunCount(orgId: string, subaccountId: string): Promise<number> {
    const [result] = await getOrgScopedDb('projectService.getInFlightRunCount')
      .select({ count: count() })
      .from(agentRuns)
      .where(and(
        eq(agentRuns.subaccountId, subaccountId),
        inArray(agentRuns.status, [...IN_FLIGHT_RUN_STATUSES]),
        eq(agentRuns.isSubAgent, false),
      ));
    return Number(result?.count ?? 0);
  },

  async patch(orgId: string, projectId: string, body: ProjectPatch): Promise<ApiProject> {
    if (body.budgetUsd !== undefined && body.budgetUsd !== null) {
      if (!Number.isFinite(body.budgetUsd) || body.budgetUsd < 0) {
        throw { statusCode: 400, message: 'budgetUsd must be a non-negative finite number', errorCode: 'INVALID_BUDGET' };
      }
    }

    if (body.name !== undefined && body.name.trim() === '') {
      throw { statusCode: 400, message: 'name cannot be empty', errorCode: 'INVALID_NAME' };
    }

    const updates = fromApiPatch(body);

    const patchScopedDb = getOrgScopedDb('projectService.patch');
    if (body.linkedAgents !== undefined && body.linkedAgents.length > 0) {
      const validIds = await patchScopedDb
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.organisationId, orgId), inArray(agents.id, body.linkedAgents), isNull(agents.deletedAt)));
      const validSet = new Set(validIds.map((r) => r.id));
      const missing = body.linkedAgents.filter((id) => !validSet.has(id));
      if (missing.length > 0) {
        throw { statusCode: 422, message: 'Unknown agent(s)', errorCode: 'INVALID_LINKED_AGENT', details: { missing } };
      }
    }

    const [row] = await patchScopedDb
      .update(projects)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.organisationId, orgId), isNull(projects.deletedAt)))
      .returning();
    if (!row) throw { statusCode: 404, message: 'Project not found', errorCode: 'PROJECT_NOT_FOUND' };
    return toApiProject(row);
  },
};
