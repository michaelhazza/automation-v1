// ---------------------------------------------------------------------------
// runOptimiserScan — Phase 2A orchestration core.
//
// Runs all 8 optimiser scan categories for a subaccount, dedupes against prior
// recommendations, renders new findings via LLM, and calls output.recommend.
//
// INVARIANTS:
//   25: TOTAL_CATEGORIES = 8, SCAN_FAILURE_CIRCUIT_BREAKER_THRESHOLD = 0.5
//   24: output.recommend calls are SEQUENTIAL (no Promise.all)
//   26: partial_run flag in evidence when partial mode
//   32: MAX(median_version) — never LIMIT 1 for the version read
//
// Called by the optimiser pg-boss job worker (Chunk 6), which wraps this
// call inside db.transaction + withOrgTx to set up the ALS context that
// getOrgScopedDb reads.
//
// Spec: docs/sub-account-optimiser-spec.md §5, §6, Phase 2
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import { logger } from '../../lib/logger.js';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { withAdminConnectionGuarded } from '../../lib/rlsBoundaryGuard.js';
import { evidenceHash as computeEvidenceHash } from '../../../shared/types/agentRecommendations.js';
import { renderRecommendation } from './renderRecommendation.js';
import { buildHandlerContext } from '../../lib/buildHandlerContext.js';

// Query modules
import { module as agentBudgetModule } from './queries/agentBudget.js';
import { module as escalationRateModule } from './queries/escalationRate.js';
import { module as inactiveWorkflowsModule } from './queries/inactiveWorkflows.js';
import { module as escalationPhrasesModule } from './queries/escalationPhrases.js';
import { module as memoryCitationModule } from './queries/memoryCitation.js';
import { module as routingUncertaintyModule } from './queries/routingUncertainty.js';
import { module as cacheEfficiencyModule } from './queries/cacheEfficiency.js';
import {
  skillLatencyModule,
  peerMediansViewIsPopulated,
  runSkillLatencyQuery,
} from './queries/skillLatency.js';

// Evaluators
import { evaluate as evaluateAgentBudget } from './recommendations/agentBudget.js';
import { evaluate as evaluateEscalationRate } from './recommendations/playbookEscalation.js';
import { evaluate as evaluateInactiveWorkflow } from './recommendations/inactiveWorkflow.js';
import { evaluate as evaluateEscalationPhrases } from './recommendations/repeatPhrase.js';
import { evaluate as evaluateMemoryCitation } from './recommendations/memoryCitation.js';
import { evaluate as evaluateRoutingUncertainty } from './recommendations/routingUncertainty.js';
import { evaluate as evaluateCacheEfficiency } from './recommendations/cacheEfficiency.js';
import { evaluateSkillSlow } from './recommendations/skillSlow.js';

import type { EvaluatorOutput, EvaluatorContext } from './recommendations/types.js';
import type { OrgScopedTx } from '../../db/index.js';

// ---------------------------------------------------------------------------
// Invariant 25: named constants — NEVER inline these literals
// ---------------------------------------------------------------------------
export const TOTAL_CATEGORIES = 8;
export const SCAN_FAILURE_CIRCUIT_BREAKER_THRESHOLD = 0.5;

export interface OptimiserRunSummary {
  subaccountId: string;
  organisationId: string;
  candidatesProduced: number;
  candidatesDeduped: number;
  failedCategories: string[];
  partialMode: boolean;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Severity rank helper — mirrors EvaluatorOutput.priorityTuple[0]
// ---------------------------------------------------------------------------

function severityRankFromString(s: 'info' | 'warn' | 'critical'): number {
  if (s === 'critical') return 3;
  if (s === 'warn') return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Load prior recommendations for deduplication.
//
// Selects the most recent row per (subaccount_id, category, dedupe_key)
// across all statuses. Built as a Map keyed by "${category}|${dedupeKey}".
// ---------------------------------------------------------------------------

async function loadPriorRecs(
  tx: OrgScopedTx,
  subaccountId: string,
): Promise<Map<string, { evidenceHash: string; evidence: Record<string, unknown> }>> {
  const rows = await tx.execute<{
    category: string;
    dedupe_key: string;
    evidence_hash: string;
    evidence: Record<string, unknown>;
  }>(sql`
    SELECT DISTINCT ON (category, dedupe_key)
      category,
      dedupe_key,
      evidence_hash,
      evidence
    FROM agent_recommendations
    WHERE scope_type = 'subaccount'
      AND scope_id = ${subaccountId}::uuid
    ORDER BY category, dedupe_key, created_at DESC, id DESC
  `);

  const map = new Map<string, { evidenceHash: string; evidence: Record<string, unknown> }>();
  for (const row of rows) {
    map.set(`${row.category}|${row.dedupe_key}`, {
      evidenceHash: row.evidence_hash,
      evidence: row.evidence,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// runOptimiserScan
// ---------------------------------------------------------------------------

export async function runOptimiserScan(
  subaccountId: string,
  organisationId: string,
  agentId: string,
): Promise<OptimiserRunSummary> {
  const started = Date.now();

  logger.info('optimiser.scan.started', {
    subaccountId,
    organisationId,
    scanCategory: 'all',
    durationMs: 0,
    resultCount: 0,
  });

  // Construct handlerContext at job-start; routes skillExecutor calls through
  // the boot-time factory (wave-4 CD1 cycle-break).
  const handlerContext = buildHandlerContext();

  const failedCategories: string[] = [];
  const allCandidates: EvaluatorOutput[] = [];
  let partialMode = false;
  let medianVersion = 0;

  // ── Step 1: get org-scoped db handle (ALS context must be set by caller) ─
  const tx = getOrgScopedDb('optimiser.runOptimiserScan');

  // ── Step 2: load prior recs for dedup ───────────────────────────────────
  const priorRecs = await loadPriorRecs(tx, subaccountId);

  // ── Step 3: peer-medians view check ─────────────────────────────────────
  // peerMediansViewIsPopulated manages its own admin connection internally.
  // When the view is empty we enter partial mode and skip skillLatency entirely.
  const viewPopulated = await peerMediansViewIsPopulated();
  if (!viewPopulated) {
    partialMode = true;
    logger.info('optimiser.scan.partial', {
      subaccountId,
      organisationId,
      medianVersion: 0,
    });
  }

  // ── Step 4: build evaluator context (shared across all categories) ───────
  const evalCtx: EvaluatorContext = {
    subaccountId,
    organisationId,
    medianVersion,
    priorRecsByDedupe: priorRecs,
  };

  // ── Step 5: run all 8 scan categories in one org-scoped tx snapshot ──────
  //
  // agentBudget
  try {
    const rows = await agentBudgetModule.run(tx, subaccountId);
    if (rows.length === 0) {
      logger.info('optimiser.scan.noop', { scanCategory: agentBudgetModule.category, subaccountId });
    } else {
      logger.info('optimiser.scan.completed', { scanCategory: agentBudgetModule.category, resultCount: rows.length, subaccountId, durationMs: 0 });
      allCandidates.push(...evaluateAgentBudget(rows, evalCtx));
    }
  } catch (err) {
    failedCategories.push(agentBudgetModule.category);
    logger.error('optimiser.scan.failed', { scanCategory: agentBudgetModule.category, error: err instanceof Error ? err.message : String(err), subaccountId });
  }

  // escalationRate
  try {
    const rows = await escalationRateModule.run(tx, subaccountId);
    if (rows.length === 0) {
      logger.info('optimiser.scan.noop', { scanCategory: escalationRateModule.category, subaccountId });
    } else {
      logger.info('optimiser.scan.completed', { scanCategory: escalationRateModule.category, resultCount: rows.length, subaccountId, durationMs: 0 });
      allCandidates.push(...evaluateEscalationRate(rows, evalCtx));
    }
  } catch (err) {
    failedCategories.push(escalationRateModule.category);
    logger.error('optimiser.scan.failed', { scanCategory: escalationRateModule.category, error: err instanceof Error ? err.message : String(err), subaccountId });
  }

  // skillLatency — special: uses withAdminConnectionGuarded for version read + query
  if (partialMode) {
    logger.info('optimiser.scan.noop', { scanCategory: skillLatencyModule.category, subaccountId, reason: 'partial_mode' });
  } else {
    try {
      let skillLatencyRows: Awaited<ReturnType<typeof runSkillLatencyQuery>> = [];
      // allowRlsBypass: read-only cross-tenant aggregate from optimiser_skill_peer_medians view
      await withAdminConnectionGuarded(
        { source: 'optimiser.scan.skillLatency', allowRlsBypass: false },
        async (adminTx: OrgScopedTx) => {
          // Invariant 32: use MAX not LIMIT 1 for version read; done inside admin connection for atomic consistency
          const versionRows = await adminTx.execute<{ max_version: number }>(
            sql`SELECT MAX(median_version) AS max_version FROM optimiser_skill_peer_medians`,
          );
          medianVersion = versionRows[0]?.max_version ?? 0;
          evalCtx.medianVersion = medianVersion;
          skillLatencyRows = await runSkillLatencyQuery(adminTx, subaccountId, medianVersion);
        },
      );
      if (skillLatencyRows.length === 0) {
        logger.info('optimiser.scan.noop', { scanCategory: skillLatencyModule.category, subaccountId });
      } else {
        logger.info('optimiser.scan.completed', { scanCategory: skillLatencyModule.category, resultCount: skillLatencyRows.length, subaccountId, durationMs: 0 });
        allCandidates.push(...evaluateSkillSlow(skillLatencyRows, evalCtx));
      }
    } catch (err) {
      failedCategories.push(skillLatencyModule.category);
      logger.error('optimiser.scan.failed', { scanCategory: skillLatencyModule.category, error: err instanceof Error ? err.message : String(err), subaccountId });
    }
  }

  // inactiveWorkflows
  try {
    const rows = await inactiveWorkflowsModule.run(tx, subaccountId);
    if (rows.length === 0) {
      logger.info('optimiser.scan.noop', { scanCategory: inactiveWorkflowsModule.category, subaccountId });
    } else {
      logger.info('optimiser.scan.completed', { scanCategory: inactiveWorkflowsModule.category, resultCount: rows.length, subaccountId, durationMs: 0 });
      allCandidates.push(...evaluateInactiveWorkflow(rows, evalCtx));
    }
  } catch (err) {
    failedCategories.push(inactiveWorkflowsModule.category);
    logger.error('optimiser.scan.failed', { scanCategory: inactiveWorkflowsModule.category, error: err instanceof Error ? err.message : String(err), subaccountId });
  }

  // escalationPhrases
  try {
    const rows = await escalationPhrasesModule.run(tx, subaccountId);
    if (rows.length === 0) {
      logger.info('optimiser.scan.noop', { scanCategory: escalationPhrasesModule.category, subaccountId });
    } else {
      logger.info('optimiser.scan.completed', { scanCategory: escalationPhrasesModule.category, resultCount: rows.length, subaccountId, durationMs: 0 });
      allCandidates.push(...evaluateEscalationPhrases(rows, evalCtx));
    }
  } catch (err) {
    failedCategories.push(escalationPhrasesModule.category);
    logger.error('optimiser.scan.failed', { scanCategory: escalationPhrasesModule.category, error: err instanceof Error ? err.message : String(err), subaccountId });
  }

  // memoryCitation
  try {
    const rows = await memoryCitationModule.run(tx, subaccountId);
    if (rows.length === 0) {
      logger.info('optimiser.scan.noop', { scanCategory: memoryCitationModule.category, subaccountId });
    } else {
      logger.info('optimiser.scan.completed', { scanCategory: memoryCitationModule.category, resultCount: rows.length, subaccountId, durationMs: 0 });
      allCandidates.push(...evaluateMemoryCitation(rows, evalCtx));
    }
  } catch (err) {
    failedCategories.push(memoryCitationModule.category);
    logger.error('optimiser.scan.failed', { scanCategory: memoryCitationModule.category, error: err instanceof Error ? err.message : String(err), subaccountId });
  }

  // routingUncertainty
  try {
    const rows = await routingUncertaintyModule.run(tx, subaccountId);
    if (rows.length === 0) {
      logger.info('optimiser.scan.noop', { scanCategory: routingUncertaintyModule.category, subaccountId });
    } else {
      logger.info('optimiser.scan.completed', { scanCategory: routingUncertaintyModule.category, resultCount: rows.length, subaccountId, durationMs: 0 });
      allCandidates.push(...evaluateRoutingUncertainty(rows, evalCtx));
    }
  } catch (err) {
    failedCategories.push(routingUncertaintyModule.category);
    logger.error('optimiser.scan.failed', { scanCategory: routingUncertaintyModule.category, error: err instanceof Error ? err.message : String(err), subaccountId });
  }

  // cacheEfficiency
  try {
    const rows = await cacheEfficiencyModule.run(tx, subaccountId);
    if (rows.length === 0) {
      logger.info('optimiser.scan.noop', { scanCategory: cacheEfficiencyModule.category, subaccountId });
    } else {
      logger.info('optimiser.scan.completed', { scanCategory: cacheEfficiencyModule.category, resultCount: rows.length, subaccountId, durationMs: 0 });
      allCandidates.push(...evaluateCacheEfficiency(rows, evalCtx));
    }
  } catch (err) {
    failedCategories.push(cacheEfficiencyModule.category);
    logger.error('optimiser.scan.failed', { scanCategory: cacheEfficiencyModule.category, error: err instanceof Error ? err.message : String(err), subaccountId });
  }

  // ── Step 6: circuit breaker ───────────────────────────────────────────────
  // Invariant 25: strictly > 0.5, not >=
  if (failedCategories.length / TOTAL_CATEGORIES > SCAN_FAILURE_CIRCUIT_BREAKER_THRESHOLD) {
    const successfulCategories = [
      agentBudgetModule.category,
      escalationRateModule.category,
      skillLatencyModule.category,
      inactiveWorkflowsModule.category,
      escalationPhrasesModule.category,
      memoryCitationModule.category,
      routingUncertaintyModule.category,
      cacheEfficiencyModule.category,
    ].filter((c) => !failedCategories.includes(c));

    logger.error('optimiser.scan.circuit_breaker', {
      subaccountId,
      organisationId,
      failedCategories,
      successfulCategories,
      totalCategories: TOTAL_CATEGORIES,
      failureRate: failedCategories.length / TOTAL_CATEGORIES,
    });

    return {
      subaccountId,
      organisationId,
      candidatesProduced: 0,
      candidatesDeduped: 0,
      failedCategories,
      partialMode,
      durationMs: Date.now() - started,
    };
  }

  // ── Step 7: pre-sort candidates ────────────────────────────────────────────
  // Sort by: severity desc (critical=3, warn=2, info=1), category asc, dedupeKey asc
  const sortedCandidates = [...allCandidates].sort((a, b) => {
    const aSev = severityRankFromString(a.severity);
    const bSev = severityRankFromString(b.severity);
    if (aSev !== bSev) return bSev - aSev; // desc: higher rank first
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    return a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0;
  });

  // ── Step 8: sequential output.recommend loop ───────────────────────────────
  // Invariant 24: SEQUENTIAL — no Promise.all on output.recommend calls.
  let candidatesDeduped = 0;

  // Build a minimal SkillExecutionContext for output.recommend calls.
  // orgProcesses is required by the type but unused by output.recommend.
  const skillContext = {
    runId: `optimiser:${subaccountId}:${Date.now()}`,
    organisationId,
    subaccountId,
    agentId,
    orgProcesses: [] as Array<{ id: string; name: string; description: string | null; inputSchema: string | null }>,
  };

  for (const candidate of sortedCandidates) {
    const { category, severity, dedupeKey, evidence, actionHint } = candidate;

    // Add partial_run flag to evidence when in partial mode (invariant 26)
    const effectiveEvidence: Record<string, unknown> = partialMode
      ? { ...evidence, partial_run: true }
      : evidence;

    const hash = computeEvidenceHash(effectiveEvidence);
    const priorKey = `${category}|${dedupeKey}`;
    const prior = priorRecs.get(priorKey);

    if (prior?.evidenceHash === hash) {
      candidatesDeduped++;
      logger.info('optimiser.scan.deduped', {
        subaccountId,
        category,
        dedupeKey,
        evidenceHash: hash,
      });
      continue;
    }

    // Render title + body via LLM (with evidence-hash cache)
    const rendered = await renderRecommendation(
      category,
      dedupeKey,
      hash,
      effectiveEvidence,
      organisationId,
    );

    // Call output.recommend via skill executor (invariant 24: sequential)
    const result = await handlerContext.skillExecutor.execute({
      skillName: 'output.recommend',
      input: {
        scope_type: 'subaccount',
        scope_id: subaccountId,
        category,
        severity,
        title: rendered.title,
        body: rendered.body,
        evidence: effectiveEvidence,
        action_hint: actionHint ?? null,
        dedupe_key: dedupeKey,
      },
      context: skillContext,
    }) as { success?: boolean; was_new?: boolean; recommendation_id?: string; reason?: string } | undefined;

    if (result?.was_new) {
      logger.info('optimiser.scan.created', {
        subaccountId,
        category,
        dedupeKey,
        severity,
        recommendationId: result.recommendation_id,
        cacheHit: rendered.cacheHit,
      });
    }
  }

  const summary: OptimiserRunSummary = {
    subaccountId,
    organisationId,
    candidatesProduced: sortedCandidates.length,
    candidatesDeduped,
    failedCategories,
    partialMode,
    durationMs: Date.now() - started,
  };

  logger.info('optimiser.scan.finished', {
    ...summary,
    scanCategory: 'all',
  });

  return summary;
}
