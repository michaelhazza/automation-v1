import { db } from '../db/index.js';
import { projects, agents } from '../db/schema/index.js';
import { eq, and, isNull, inArray } from 'drizzle-orm';

export interface ApiProject {
  id: string;
  organisationId: string;
  subaccountId: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'archived';
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
  status?: 'active' | 'paused' | 'archived';
  objective?: string | null;
  targetDate?: string | null;
  budgetUsd?: number | null;
  budgetWarnThresholdPct?: number;
  repositoryUrl?: string | null;
  linkedAgents?: string[];
}

export function toApiProject(row: typeof projects.$inferSelect): ApiProject {
  return {
    id: row.id,
    organisationId: row.organisationId,
    subaccountId: row.subaccountId,
    name: row.name,
    description: row.description ?? null,
    status: row.status as 'active' | 'paused' | 'archived',
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
  if (body.budgetUsd !== undefined) updates.budgetCents = body.budgetUsd === null ? null : Math.round(body.budgetUsd * 100);
  if (body.budgetWarnThresholdPct !== undefined) updates.budgetWarningPercent = body.budgetWarnThresholdPct;
  if (body.repositoryUrl !== undefined) updates.repoUrl = body.repositoryUrl;
  if (body.linkedAgents !== undefined) updates.linkedAgentIds = body.linkedAgents;
  return updates;
}

export const projectService = {
  async getById(orgId: string, projectId: string): Promise<ApiProject> {
    const [row] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organisationId, orgId), isNull(projects.deletedAt)));
    if (!row) throw { statusCode: 404, message: 'Project not found', errorCode: 'PROJECT_NOT_FOUND' };
    return toApiProject(row);
  },

  async patch(orgId: string, projectId: string, body: ProjectPatch): Promise<ApiProject> {
    const updates = fromApiPatch(body);

    if (body.linkedAgents !== undefined && body.linkedAgents.length > 0) {
      const validIds = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.organisationId, orgId), inArray(agents.id, body.linkedAgents), isNull(agents.deletedAt)));
      const validSet = new Set(validIds.map((r) => r.id));
      const missing = body.linkedAgents.filter((id) => !validSet.has(id));
      if (missing.length > 0) {
        throw { statusCode: 422, message: 'Unknown agent(s)', errorCode: 'INVALID_LINKED_AGENT', details: { missing } };
      }
    }

    const [row] = await db
      .update(projects)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.organisationId, orgId), isNull(projects.deletedAt)))
      .returning();
    if (!row) throw { statusCode: 404, message: 'Project not found', errorCode: 'PROJECT_NOT_FOUND' };
    return toApiProject(row);
  },
};
