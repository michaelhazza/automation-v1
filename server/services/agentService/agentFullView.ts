import { eq, and, isNull, asc, desc, inArray, ne, sql as drizzleSql } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { agents, agentDataSources, users, agentPromptRevisions, agentTriggers as agentTriggersTable, agentRuns, skills, subaccountAgents } from '../../db/schema/index.js';
import { computeAgentEtag } from '../../lib/agentEtag.js';
import { diffByIdentityKey } from '../../lib/identityKeyDiff.js';
import { auditService } from '../auditService.js';
import { v4 as uuidv4 } from 'uuid';
import type { AgentPersonality, AgentFull } from './types.js';
import { makeSlug, _assertNotSystemManaged, _assertEtag } from './helpers.js';

/**
 * Retrieve the full agent payload used by the Build tab-editor UI.
 * All arrays are ordered per INVARIANT-Q1-A (createdAt ASC, id ASC) to
 * ensure deterministic ETag computation.
 */
export async function getFull(agentId: string, orgId: string): Promise<AgentFull> {
  const agentDataSourcesTable = agentDataSources;
  const getFullScopedDb = getOrgScopedDb('agentFullView.getFull');

  const [rawAgent] = await getFullScopedDb
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organisationId, orgId), isNull(agents.deletedAt)));

  if (!rawAgent) throw { statusCode: 404, message: 'Agent not found', errorCode: 'AGENT_NOT_FOUND' };

  // ── Skills (from defaultSkillSlugs joined to skills table) ──────────────
  const slugs: string[] = (rawAgent.defaultSkillSlugs ?? []) as string[];
  let skillRows: Array<{ id: string; key: string; name: string; configJson: unknown; status: 'enabled' | 'disabled' }> = [];
  if (slugs.length > 0) {
    const rows = await getFullScopedDb
      .select({ id: skills.id, slug: skills.slug, name: skills.name, isActive: skills.isActive, createdAt: skills.createdAt })
      .from(skills)
      .where(inArray(skills.slug, slugs))
      .orderBy(asc(skills.createdAt), asc(skills.id));
    skillRows = rows.map((s) => ({
      id: s.id,
      key: s.slug,
      name: s.name,
      configJson: {},
      status: s.isActive ? 'enabled' as const : 'disabled' as const,
    }));
  }

  // ── Data Sources (org-level only: subaccountAgentId IS NULL, scheduledTaskId IS NULL) ─
  const dataSources = await getFullScopedDb
    .select()
    .from(agentDataSourcesTable)
    .where(
      and(
        eq(agentDataSourcesTable.agentId, agentId),
        drizzleSql`${agentDataSourcesTable.subaccountAgentId} IS NULL`,
        drizzleSql`${agentDataSourcesTable.scheduledTaskId} IS NULL`,
      )
    )
    .orderBy(asc(agentDataSourcesTable.createdAt), asc(agentDataSourcesTable.id));

  // ── Triggers ─────────────────────────────────────────────────────────────
  // agentTriggers has no direct agentId FK — triggers link to agents through
  // subaccountAgents. We do a two-step query: find subaccountAgent IDs for
  // this org-level agent, then fetch triggers scoped to those IDs.
  const subaccountAgentRows = await getFullScopedDb
    .select({ id: subaccountAgents.id })
    .from(subaccountAgents)
    .where(and(eq(subaccountAgents.agentId, agentId), eq(subaccountAgents.organisationId, orgId)));

  const saIds = subaccountAgentRows.map((sa) => sa.id);

  const triggers = saIds.length > 0
    ? await getFullScopedDb
        .select()
        .from(agentTriggersTable)
        .where(
          and(
            inArray(agentTriggersTable.subaccountAgentId, saIds),
            isNull(agentTriggersTable.deletedAt),
          )
        )
        .orderBy(asc(agentTriggersTable.createdAt), asc(agentTriggersTable.id))
    : [];

  // ── Last 5 runs + 30d stats ───────────────────────────────────────────────
  const last5Runs = await getFullScopedDb
    .select({
      id: agentRuns.id,
      status: agentRuns.status,
      startedAt: agentRuns.startedAt,
      completedAt: agentRuns.completedAt,
      durationMs: agentRuns.durationMs,
      inputTokens: agentRuns.inputTokens,
      outputTokens: agentRuns.outputTokens,
    })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, agentId), eq(agentRuns.organisationId, orgId)))
    .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
    .limit(5);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [stats30d] = await getFullScopedDb
    .select({
      total: drizzleSql<number>`CAST(COUNT(*) AS INT)`,
      costUsd: drizzleSql<number>`COALESCE(SUM((${agentRuns.inputTokens} + ${agentRuns.outputTokens})::numeric / 1000000 * 3), 0)`,
    })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.agentId, agentId),
        eq(agentRuns.organisationId, orgId),
        drizzleSql`${agentRuns.createdAt} >= ${thirtyDaysAgo.toISOString()}`,
      )
    );

  // ── Budget ────────────────────────────────────────────────────────────────
  // Phase 1: agent LLM budget caps have no backing schema yet. These fields
  // are returned as null/zero and writes are accepted but not persisted.
  // Budget cap enforcement is a Phase 2 feature. The spendingBudgets table
  // is for agentic commerce spend (not LLM cost caps) and must not be
  // misread as dailyCapUsd / monthlyCapUsd values.
  const budget = {
    dailyCapUsd: null as number | null,
    monthlyCapUsd: null as number | null,
    warnThresholdPct: 0,
  };

  // ── Revision stats ────────────────────────────────────────────────────────
  const revisionStats = await getFullScopedDb
    .select({
      count: drizzleSql<number>`COUNT(*)::int`,
      lastEditedAt: drizzleSql<string>`MAX(${agentPromptRevisions.createdAt})`,
      lastAuthorId: drizzleSql<string>`(ARRAY_AGG(${agentPromptRevisions.changedBy} ORDER BY ${agentPromptRevisions.createdAt} DESC))[1]`,
    })
    .from(agentPromptRevisions)
    .where(and(eq(agentPromptRevisions.agentId, agentId), eq(agentPromptRevisions.organisationId, orgId)));

  const revStat = revisionStats[0];
  let revisionAuthor: string | null = null;
  if (revStat?.lastAuthorId) {
    const authorRows = await getFullScopedDb
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, revStat.lastAuthorId))
      .limit(1);
    revisionAuthor = authorRows.map(u => `${u.firstName} ${u.lastName}`.trim())[0] ?? null;
  }

  // ── Personality ───────────────────────────────────────────────────────────
  const rawPersonality = (rawAgent as unknown as { personality?: unknown }).personality;
  const personality: AgentPersonality = rawPersonality && typeof rawPersonality === 'object'
    ? rawPersonality as AgentPersonality
    : { traits: [], tone: '', description: '', enabled: false };

  const configure = {
    name: rawAgent.name,
    description: rawAgent.description ?? '',
    roleTitle: rawAgent.agentTitle ?? '',
    parentAgentId: rawAgent.parentAgentId ?? null,
    model: rawAgent.modelId,
    outputSize: (['compact', 'standard', 'extended'].includes(rawAgent.outputSize) ? rawAgent.outputSize : 'standard') as 'compact' | 'standard' | 'extended',
    allowSubaccountModelOverride: rawAgent.allowModelOverride,
    responseMode: rawAgent.responseMode as 'balanced' | 'expressive' | 'precise' | 'highly_creative',
  };

  const behaviour = {
    briefingTemplate: rawAgent.additionalPrompt ?? '',
    constraints: [] as string[],
  };

  const etagPayload = {
    configure,
    behaviour,
    personality,
    skills: skillRows.map((s) => ({ id: s.id, key: s.key, configJson: s.configJson, status: s.status })),
    dataSources: dataSources.map((d) => ({ id: d.id, kind: d.sourceType, ref: d.sourcePath, status: d.lastFetchStatus === 'ok' ? 'connected' as const : d.lastFetchStatus === 'error' ? 'error' as const : 'disconnected' as const })),
    triggers: triggers.map((t) => ({ id: t.id, kind: 'event' as const, spec: t.eventFilter ?? {}, status: t.isActive ? 'active' as const : 'paused' as const })),
    budget,
  };

  const etag = computeAgentEtag(etagPayload);

  return {
    id: rawAgent.id,
    etag,
    isSystemManaged: rawAgent.isSystemManaged,
    configure,
    behaviour,
    personality,
    skills: skillRows,
    dataSources: dataSources.map((d) => ({
      id: d.id,
      kind: d.sourceType,
      ref: d.sourcePath,
      status: d.lastFetchStatus === 'ok' ? 'connected' as const : d.lastFetchStatus === 'error' ? 'error' as const : 'disconnected' as const,
    })),
    triggers: triggers.map((t) => ({
      id: t.id,
      kind: 'event' as const,
      spec: t.eventFilter ?? {},
      status: t.isActive ? 'active' as const : 'paused' as const,
    })),
    budget,
    runs: {
      last5: last5Runs.map((r) => ({
        id: r.id,
        status: r.status,
        startedAt: r.startedAt?.toISOString() ?? '',
        completedAt: r.completedAt?.toISOString() ?? null,
        durationMs: r.durationMs ?? null,
        costUsd: ((r.inputTokens + r.outputTokens) / 1_000_000) * 3,
      })),
      total30d: Number(stats30d?.total ?? 0),
      cost30d: Number(stats30d?.costUsd ?? 0),
    },
    agentRevisionCount: revStat?.count ?? 1,
    lastRevisionEditedAt: revStat?.lastEditedAt ?? null,
    lastRevisionAuthor: revisionAuthor,
  };
}

export async function patchConfigure(
  agentId: string,
  orgId: string,
  expectedEtag: string,
  patch: Partial<AgentFull['configure']>,
  actor: { role?: string },
): Promise<AgentFull> {
  const current = await getFull(agentId, orgId);
  _assertNotSystemManaged(current, actor.role);
  _assertEtag(current, expectedEtag);

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const trimmedName = patch.name.trim();
    update.name = trimmedName;
    // Slug update: derive new slug from name (idempotent within org)
    const newSlug = makeSlug(trimmedName);
    // Check for slug conflict (excluding current agent)
    const [conflict] = await getOrgScopedDb('agentFullView.patchConfigure')
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.organisationId, orgId),
          eq(agents.slug, newSlug),
          ne(agents.id, agentId),
          isNull(agents.deletedAt),
        )
      );
    if (conflict) {
      throw { statusCode: 409, message: `An agent with slug "${newSlug}" already exists`, errorCode: 'SLUG_CONFLICT' };
    }
    update.slug = newSlug;
  }
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.roleTitle !== undefined) update.agentTitle = patch.roleTitle;
  if (patch.parentAgentId !== undefined) update.parentAgentId = patch.parentAgentId;
  if (patch.model !== undefined) update.modelId = patch.model;
  if (patch.outputSize !== undefined) update.outputSize = patch.outputSize;
  if (patch.allowSubaccountModelOverride !== undefined) update.allowModelOverride = patch.allowSubaccountModelOverride;
  if (patch.responseMode !== undefined) update.responseMode = patch.responseMode;

  await getOrgScopedDb('agentFullView.patchConfigure').transaction(async (tx) => {
    await tx.update(agents).set(update).where(and(eq(agents.id, agentId), eq(agents.organisationId, orgId)));
  });

  return getFull(agentId, orgId);
}

export async function patchBehaviour(
  agentId: string,
  orgId: string,
  expectedEtag: string,
  patch: Partial<AgentFull['behaviour']>,
  actor: { role?: string },
): Promise<AgentFull> {
  const current = await getFull(agentId, orgId);
  _assertNotSystemManaged(current, actor.role);
  _assertEtag(current, expectedEtag);

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.briefingTemplate !== undefined) update.additionalPrompt = patch.briefingTemplate;
  // Phase 1: constraints are not persisted (additionalPrompt is a single text field).
  // If constraints are provided, they are accepted but not stored.
  // Frontend sends only briefingTemplate in Phase 1.

  await getOrgScopedDb('agentFullView.patchBehaviour').transaction(async (tx) => {
    await tx.update(agents).set(update).where(and(eq(agents.id, agentId), eq(agents.organisationId, orgId)));
  });

  return getFull(agentId, orgId);
}

export async function patchPersonality(
  agentId: string,
  orgId: string,
  expectedEtag: string,
  patch: Partial<AgentPersonality>,
  actor: { role?: string },
): Promise<AgentFull> {
  const current = await getFull(agentId, orgId);
  _assertNotSystemManaged(current, actor.role);
  _assertEtag(current, expectedEtag);

  const merged: AgentPersonality = {
    ...current.personality,
    ...patch,
  };

  await getOrgScopedDb('agentFullView.patchPersonality').transaction(async (tx) => {
    // personality column is added by migration 0286
    await tx.execute(
      drizzleSql`
        UPDATE agents
        SET personality = ${JSON.stringify(merged)}::jsonb, updated_at = NOW()
        WHERE id = ${agentId} AND organisation_id = ${orgId}
      `
    );
  });

  return getFull(agentId, orgId);
}

export async function replaceSkills(
  agentId: string,
  orgId: string,
  expectedEtag: string,
  incoming: Array<{ id: string; key: string; name: string; configJson: unknown; status: 'enabled' | 'disabled' }>,
  options: { force?: boolean },
  actor: { role?: string },
): Promise<AgentFull> {
  const current = await getFull(agentId, orgId);
  _assertNotSystemManaged(current, actor.role);
  _assertEtag(current, expectedEtag);

  const diff = diffByIdentityKey(current.skills, incoming, (s) => s.id);

  if (!options.force && diff.silentlyRemoved.length > 0) {
    throw {
      statusCode: 409,
      message: 'Some skills would be removed. Pass force=true to confirm deletion.',
      errorCode: 'IDENTITY_KEY_DELETION_BLOCKED',
      removedIds: diff.silentlyRemoved.map((s) => s.id),
    };
  }

  // Audit: log identity-key removals if force=true (spec §4.2 identity-key safeguard + DEVELOPMENT_GUIDELINES §8.20)
  if (options.force && diff.silentlyRemoved.length > 0) {
    await auditService.log({
      action: 'agent_skills_removed_by_identity_key',
      organisationId: orgId,
      entityType: 'agent',
      entityId: agentId,
      actorType: 'system',
      metadata: {
        removedCount: diff.silentlyRemoved.length,
        removedSkillIds: diff.silentlyRemoved.map((s) => s.id),
        beforeCount: current.skills.length,
        afterCount: incoming.length,
      },
    });
  }

  // Derive new slugs list from incoming (added + updated = all that remain)
  const finalSlugs = incoming.map((s) => s.key);

  await getOrgScopedDb('agentFullView.replaceSkills').transaction(async (tx) => {
    await tx.update(agents)
      .set({ defaultSkillSlugs: finalSlugs, updatedAt: new Date() })
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, orgId)));
  });

  return getFull(agentId, orgId);
}

export async function replaceDataSources(
  agentId: string,
  orgId: string,
  expectedEtag: string,
  incoming: Array<{ id: string; kind: string; ref: string; status: 'connected' | 'disconnected' | 'error' }>,
  options: { force?: boolean },
  actor: { role?: string },
): Promise<AgentFull> {
  const agentDataSourcesTable = agentDataSources;

  const current = await getFull(agentId, orgId);
  _assertNotSystemManaged(current, actor.role);
  _assertEtag(current, expectedEtag);

  const diff = diffByIdentityKey(current.dataSources, incoming, (d) => d.id);

  if (!options.force && diff.silentlyRemoved.length > 0) {
    throw {
      statusCode: 409,
      message: 'Some data sources would be removed. Pass force=true to confirm deletion.',
      errorCode: 'IDENTITY_KEY_DELETION_BLOCKED',
      removedIds: diff.silentlyRemoved.map((d) => d.id),
    };
  }

  // Audit: log identity-key removals if force=true (spec §4.2 identity-key safeguard + DEVELOPMENT_GUIDELINES §8.20)
  if (options.force && diff.silentlyRemoved.length > 0) {
    await auditService.log({
      action: 'agent_data_sources_removed_by_identity_key',
      organisationId: orgId,
      entityType: 'agent',
      entityId: agentId,
      actorType: 'system',
      metadata: {
        removedCount: diff.silentlyRemoved.length,
        removedDataSourceIds: diff.silentlyRemoved.map((d) => d.id),
        beforeCount: current.dataSources.length,
        afterCount: incoming.length,
      },
    });
  }

  await getOrgScopedDb('agentFullView.replaceDataSources').transaction(async (tx) => {
    // Delete removed sources
    const toRemove = diff.silentlyRemoved.map((d) => d.id);
    if (toRemove.length > 0) {
      await tx.delete(agentDataSourcesTable).where(
        and(
          inArray(agentDataSourcesTable.id, toRemove),
          eq(agentDataSourcesTable.agentId, agentId),
        )
      );
    }
    // Update existing rows (sourcePath / sourceType)
    for (const d of diff.updated) {
      await tx.update(agentDataSourcesTable)
        .set({ sourcePath: d.ref, sourceType: d.kind as 'r2' | 's3' | 'http_url' | 'google_docs' | 'dropbox' | 'file_upload' | 'google_drive', updatedAt: new Date() })
        .where(and(eq(agentDataSourcesTable.id, d.id), eq(agentDataSourcesTable.agentId, agentId)));
    }
    // Insert new sources
    for (const d of diff.added) {
      await tx.insert(agentDataSourcesTable).values({
        id: uuidv4(),
        agentId,
        name: d.ref,
        sourceType: d.kind as 'r2' | 's3' | 'http_url' | 'google_docs' | 'dropbox' | 'file_upload' | 'google_drive',
        sourcePath: d.ref,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  });

  return getFull(agentId, orgId);
}

export async function replaceTriggers(
  agentId: string,
  orgId: string,
  expectedEtag: string,
  incoming: Array<{ id: string; kind: 'schedule' | 'event' | 'manual'; spec: unknown; status: 'active' | 'paused' }>,
  options: { force?: boolean },
  actor: { role?: string },
): Promise<AgentFull> {
  const current = await getFull(agentId, orgId);
  _assertNotSystemManaged(current, actor.role);
  _assertEtag(current, expectedEtag);

  const diff = diffByIdentityKey(current.triggers, incoming, (t) => t.id);

  if (!options.force && diff.silentlyRemoved.length > 0) {
    throw {
      statusCode: 409,
      message: 'Some triggers would be removed. Pass force=true to confirm deletion.',
      errorCode: 'IDENTITY_KEY_DELETION_BLOCKED',
      removedIds: diff.silentlyRemoved.map((t) => t.id),
    };
  }

  // Audit: log identity-key removals if force=true (spec §4.2 identity-key safeguard + DEVELOPMENT_GUIDELINES §8.20)
  if (options.force && diff.silentlyRemoved.length > 0) {
    await auditService.log({
      action: 'agent_triggers_removed_by_identity_key',
      organisationId: orgId,
      entityType: 'agent',
      entityId: agentId,
      actorType: 'system',
      metadata: {
        removedCount: diff.silentlyRemoved.length,
        removedTriggerIds: diff.silentlyRemoved.map((t) => t.id),
        beforeCount: current.triggers.length,
        afterCount: incoming.length,
      },
    });
  }

  await getOrgScopedDb('agentFullView.replaceTriggers').transaction(async (tx) => {
    // Soft-delete removed triggers
    const toRemove = diff.silentlyRemoved.map((t) => t.id);
    if (toRemove.length > 0) {
      await tx.update(agentTriggersTable)
        .set({ deletedAt: new Date() })
        .where(
          and(
            inArray(agentTriggersTable.id, toRemove),
            eq(agentTriggersTable.organisationId, orgId),
          )
        );
    }
    // Update existing
    for (const t of diff.updated) {
      await tx.update(agentTriggersTable)
        .set({
          isActive: t.status === 'active',
          eventFilter: t.spec as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(and(eq(agentTriggersTable.id, t.id), eq(agentTriggersTable.organisationId, orgId)));
    }
    // Phase 1: trigger creation is not supported at the org level. Triggers are
    // subaccount-scoped (linked via subaccountAgentId, not agentId), so a trigger
    // inserted here would be orphaned — it would not appear in getFull (which
    // filters by subaccountAgentId) and would not fire (the trigger service fires
    // by subaccountId). Until the Schedule tab is wired through the subaccount
    // route, reject add operations with a clear error.
    // See migration-gaps.md § "Triggers schema — no direct agentId column".
    if (diff.added.length > 0) {
      throw {
        statusCode: 501,
        message: 'Adding triggers via the org-level agent endpoint is not supported in Phase 1. Use the subaccount-scoped trigger routes.',
        errorCode: 'TRIGGER_ADD_NOT_SUPPORTED',
      };
    }
  });

  return getFull(agentId, orgId);
}

export async function patchBudget(
  agentId: string,
  orgId: string,
  expectedEtag: string,
  patch: Partial<{ dailyCapUsd: number | null; monthlyCapUsd: number | null; warnThresholdPct: number }>,
  actor: { role?: string },
): Promise<AgentFull> {
  // Phase 1: agent LLM budget caps have no backing schema yet.
  // Patches are accepted (ETag / permission checks still apply) but not persisted.
  // Phase 2 should add daily_cap_usd, monthly_cap_usd, warn_threshold_pct columns
  // to agents and implement the read/write path.
  void patch; // intentional no-op

  const current = await getFull(agentId, orgId);
  _assertNotSystemManaged(current, actor.role);
  _assertEtag(current, expectedEtag);

  return getFull(agentId, orgId);
}

export const agentFullViewMethods = {
  getFull,
  patchConfigure,
  patchBehaviour,
  patchPersonality,
  replaceSkills,
  replaceDataSources,
  replaceTriggers,
  patchBudget,
};
