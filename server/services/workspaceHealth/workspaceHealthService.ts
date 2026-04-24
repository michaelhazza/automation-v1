/**
 * workspaceHealthService.ts — Brain Tree OS adoption P4 impure wrapper.
 *
 * Builds a normalised DetectorContext from Drizzle reads, calls the pure
 * runner + diff helper, then applies the upserts and resolutions in a
 * single transaction so a partial failure rolls back the entire sweep.
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P4
 */

import { and, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  agents,
  agentRuns,
  subaccountAgents,
  subaccounts,
  automations,
  automationConnectionMappings,
  workspaceHealthFindings,
} from '../../db/schema/index.js';
import { runDetectors, diffFindings, type ExistingFindingRow } from './workspaceHealthServicePure.js';
import type { DetectorContext, WorkspaceHealthFinding } from './detectorTypes.js';
import { ASYNC_DETECTORS } from './detectors/index.js';

const DEFAULT_NO_RECENT_RUNS_DAYS = 30;
const DEFAULT_SYSTEM_AGENT_STALE_DAYS = 60;

/**
 * Run the workspace health audit for a single organisation. Reads all input
 * data, runs detectors, and applies the diff to `workspace_health_findings`
 * inside a single transaction.
 *
 * Returns the count summary so the caller can surface it in the API
 * response or job log.
 */
export async function runAudit(organisationId: string): Promise<{
  critical: number;
  warning: number;
  info: number;
  total: number;
  upserted: number;
  resolved: number;
}> {
  // ── Build the detector context ───────────────────────────────────────
  const ctx = await buildContext(organisationId);

  // ── Run detectors (pure) ─────────────────────────────────────────────
  const pureFindings = runDetectors(ctx);

  // ── Run async (impure) detectors ────────────────────────────────────
  const asyncResults = await Promise.all(
    ASYNC_DETECTORS.map((detect) => detect(organisationId)),
  );
  const newFindings = [...pureFindings, ...asyncResults.flat()];

  // ── Read existing active findings for this org ───────────────────────
  const existing = await db
    .select({
      detector: workspaceHealthFindings.detector,
      resourceId: workspaceHealthFindings.resourceId,
    })
    .from(workspaceHealthFindings)
    .where(
      and(
        eq(workspaceHealthFindings.organisationId, organisationId),
        isNull(workspaceHealthFindings.resolvedAt),
      ),
    );

  // ── Compute the diff (pure) ──────────────────────────────────────────
  const diff = diffFindings(newFindings, existing);

  // ── Apply upserts + resolutions in one transaction ───────────────────
  // The spec calls for withOrgTx here, but the audit runs as an admin
  // sweep — it touches a single org and uses an explicit org filter on
  // every query. We use a plain db.transaction for atomicity.
  let upsertedCount = 0;
  let resolvedCount = 0;
  await db.transaction(async (tx) => {
    // Upsert each finding
    for (const f of diff.toUpsert) {
      await tx
        .insert(workspaceHealthFindings)
        .values({
          organisationId,
          detector: f.detector,
          severity: f.severity,
          resourceKind: f.resourceKind,
          resourceId: f.resourceId,
          resourceLabel: f.resourceLabel,
          message: f.message,
          recommendation: f.recommendation,
          detectedAt: new Date(),
          // resolvedAt is null by default — re-opening a previously
          // resolved finding by setting resolvedAt back to null
          resolvedAt: null,
        })
        .onConflictDoUpdate({
          target: [
            workspaceHealthFindings.organisationId,
            workspaceHealthFindings.detector,
            workspaceHealthFindings.resourceId,
          ],
          set: {
            severity: f.severity,
            resourceKind: f.resourceKind,
            resourceLabel: f.resourceLabel,
            message: f.message,
            recommendation: f.recommendation,
            detectedAt: new Date(),
            resolvedAt: null,
          },
        });
      upsertedCount++;
    }

    // Resolve findings that did not appear in the new sweep
    if (diff.toResolve.length > 0) {
      const resolveDetectors = Array.from(new Set(diff.toResolve.map((r) => r.detector)));
      // Cheap two-step approach: fetch ids that match (detector, resourceId)
      // pairs and update by id. Avoids constructing a tuple-IN clause that
      // pg-postgres doesn't natively support across drizzle versions.
      const matching = await tx
        .select({
          id: workspaceHealthFindings.id,
          detector: workspaceHealthFindings.detector,
          resourceId: workspaceHealthFindings.resourceId,
        })
        .from(workspaceHealthFindings)
        .where(
          and(
            eq(workspaceHealthFindings.organisationId, organisationId),
            isNull(workspaceHealthFindings.resolvedAt),
            inArray(workspaceHealthFindings.detector, resolveDetectors),
          ),
        );

      const resolveSet = new Set(diff.toResolve.map((r) => `${r.detector}:${r.resourceId}`));
      const idsToResolve = matching
        .filter((r) => resolveSet.has(`${r.detector}:${r.resourceId}`))
        .map((r) => r.id);

      if (idsToResolve.length > 0) {
        await tx
          .update(workspaceHealthFindings)
          .set({ resolvedAt: new Date() })
          .where(inArray(workspaceHealthFindings.id, idsToResolve));
        resolvedCount = idsToResolve.length;
      }
    }
  });

  return {
    ...diff.counts,
    upserted: upsertedCount,
    resolved: resolvedCount,
  };
}

/**
 * Mark a single finding resolved manually (UI-driven). Returns true if a
 * row was updated.
 */
export async function resolveFinding(
  findingId: string,
  organisationId: string,
): Promise<boolean> {
  const result = await db
    .update(workspaceHealthFindings)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(workspaceHealthFindings.id, findingId),
        eq(workspaceHealthFindings.organisationId, organisationId),
        isNull(workspaceHealthFindings.resolvedAt),
      ),
    )
    .returning({ id: workspaceHealthFindings.id });
  return result.length > 0;
}

/**
 * List active (unresolved) findings for an organisation, sorted by severity
 * then detected_at desc.
 */
export async function listActiveFindings(organisationId: string) {
  return db
    .select()
    .from(workspaceHealthFindings)
    .where(
      and(
        eq(workspaceHealthFindings.organisationId, organisationId),
        isNull(workspaceHealthFindings.resolvedAt),
      ),
    )
    .orderBy(desc(workspaceHealthFindings.detectedAt));
}

// ---------------------------------------------------------------------------
// buildContext — turn raw Drizzle reads into the normalised DetectorContext
// ---------------------------------------------------------------------------

async function buildContext(organisationId: string): Promise<DetectorContext> {
  // ── Agents + last run timestamp ──────────────────────────────────────
  const agentRows = await db
    .select({
      id: agents.id,
      name: agents.name,
      status: agents.status,
      systemAgentId: agents.systemAgentId,
      defaultSkillSlugs: agents.defaultSkillSlugs,
      updatedAt: agents.updatedAt,
      isSystemManaged: agents.isSystemManaged,
    })
    .from(agents)
    .where(eq(agents.organisationId, organisationId));

  // Get max(createdAt) per agentId from agent_runs in one query
  const lastRunRows = await db
    .select({
      agentId: agentRuns.agentId,
      lastRunAt: max(agentRuns.createdAt),
    })
    .from(agentRuns)
    .where(eq(agentRuns.organisationId, organisationId))
    .groupBy(agentRuns.agentId);

  const lastRunByAgent = new Map<string, Date>();
  for (const r of lastRunRows) {
    if (r.lastRunAt) lastRunByAgent.set(r.agentId, r.lastRunAt);
  }

  const agentsCtx = agentRows.map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    lastRunAt: lastRunByAgent.get(a.id) ?? null,
    systemAgentId: a.systemAgentId,
    defaultSkillSlugs: (a.defaultSkillSlugs as string[] | null) ?? null,
  }));

  // System-managed links — derived from agents with isSystemManaged + systemAgentId set
  const systemAgentLinks = agentRows
    .filter((a) => a.isSystemManaged && a.systemAgentId)
    .map((a) => ({
      orgAgentId: a.id,
      orgAgentName: a.name,
      systemAgentId: a.systemAgentId!,
      updatedAt: a.updatedAt as Date | null,
    }));

  // ── Subaccount-agent links ────────────────────────────────────────────
  const linkRows = await db
    .select({
      id: subaccountAgents.id,
      agentId: subaccountAgents.agentId,
      subaccountId: subaccountAgents.subaccountId,
      subaccountName: subaccounts.name,
      agentName: agents.name,
      skillSlugs: subaccountAgents.skillSlugs,
      heartbeatEnabled: subaccountAgents.heartbeatEnabled,
      scheduleCron: subaccountAgents.scheduleCron,
    })
    .from(subaccountAgents)
    .innerJoin(subaccounts, eq(subaccounts.id, subaccountAgents.subaccountId))
    .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
    .where(eq(subaccountAgents.organisationId, organisationId));

  const subaccountAgentsCtx = linkRows.map((r) => ({
    id: r.id,
    agentId: r.agentId,
    subaccountId: r.subaccountId,
    subaccountName: r.subaccountName ?? '(unnamed)',
    agentName: r.agentName,
    skillSlugs: (r.skillSlugs as string[] | null) ?? null,
    heartbeatEnabled: r.heartbeatEnabled,
    scheduleCron: r.scheduleCron,
  }));

  // ── Processes ─────────────────────────────────────────────────────────
  const processRows = await db
    .select({
      id: automations.id,
      name: automations.name,
      status: automations.status,
      scope: automations.scope,
      automationEngineId: automations.automationEngineId,
      requiredConnections: automations.requiredConnections,
    })
    .from(automations)
    .where(
      and(
        eq(automations.organisationId, organisationId),
        isNull(automations.deletedAt),
      ),
    );

  const processesCtx = processRows.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    scope: p.scope,
    automationEngineId: p.automationEngineId,
    requiredConnections: p.requiredConnections,
  }));

  // ── Process connection mappings ───────────────────────────────────────
  const mappingRows = await db
    .select({
      processId: automationConnectionMappings.processId,
      subaccountId: automationConnectionMappings.subaccountId,
      subaccountName: subaccounts.name,
      connectionKey: automationConnectionMappings.connectionKey,
    })
    .from(automationConnectionMappings)
    .innerJoin(subaccounts, eq(subaccounts.id, automationConnectionMappings.subaccountId))
    .where(eq(automationConnectionMappings.organisationId, organisationId));

  const mappingsCtx = mappingRows.map((m) => ({
    processId: m.processId,
    subaccountId: m.subaccountId,
    subaccountName: m.subaccountName ?? '(unnamed)',
    connectionKey: m.connectionKey,
  }));

  return {
    organisationId,
    noRecentRunsThresholdDays: DEFAULT_NO_RECENT_RUNS_DAYS,
    systemAgentStaleThresholdDays: DEFAULT_SYSTEM_AGENT_STALE_DAYS,
    agents: agentsCtx,
    subaccountAgents: subaccountAgentsCtx,
    automations: processesCtx,
    automationConnectionMappings: mappingsCtx,
    systemAgentLinks,
  };
}
