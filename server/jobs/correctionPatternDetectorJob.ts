// server/jobs/correctionPatternDetectorJob.ts
// Daily sweep that clusters operator corrections and promotes pattern-detected
// memory_blocks to pending_review for HITL queue.
// Trust & Verification Layer spec §13.3.

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { memoryBlocks } from '../db/schema/memoryBlocks.js';
import { logger } from '../lib/logger.js';
import { cluster, parseEmbedding, parseSkillSlugFromBlockName } from '../services/correctionPatternDetectorPure.js';
import type { CorrectionInput } from '../services/correctionPatternDetectorPure.js';

// ── Environment-tuned defaults ────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = Number(process.env['CORRECTION_CLUSTER_SIMILARITY'] ?? '0.82');
const MIN_CLUSTER_SIZE = Number(process.env['CORRECTION_CLUSTER_MIN_SIZE'] ?? '3');
const WINDOW_DAYS = Number(process.env['CORRECTION_CLUSTER_WINDOW_DAYS'] ?? '30');
const TIGHTENING_SUGGESTIONS_ENABLED = (process.env['FEATURE_SCORECARD_TIGHTENING_SUGGESTIONS'] ?? 'true') === 'true';

const SOURCE = 'correction:pattern-detect' as const;

// ── Job result shape ──────────────────────────────────────────────────────────

export interface CorrectionPatternDetectorResult {
  status: 'success' | 'partial' | 'failed';
  orgsAttempted: number;
  orgsSucceeded: number;
  orgsFailed: number;
  clustersPromoted: number;
  durationMs: number;
}

// ── Main job entry point ──────────────────────────────────────────────────────

export async function runCorrectionPatternDetector(): Promise<CorrectionPatternDetectorResult> {
  const jobRunId = crypto.randomUUID();
  const startedAt = Date.now();

  logger.info(`${SOURCE}.started`, {
    jobRunId,
    windowDays: WINDOW_DAYS,
    similarityThreshold: SIMILARITY_THRESHOLD,
    minClusterSize: MIN_CLUSTER_SIZE,
    tighteningSuggestionsEnabled: TIGHTENING_SUGGESTIONS_ENABLED,
  });

  // Phase 1: enumerate all orgs under admin connection.
  let orgs: Array<{ id: string }>;
  try {
    orgs = await withAdminConnection(
      { source: SOURCE, reason: 'correction pattern sweep: enumerate orgs', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        return (await tx.execute(sql`SELECT id FROM organisations`)) as unknown as Array<{ id: string }>;
      },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result: CorrectionPatternDetectorResult = {
      status: 'failed', orgsAttempted: 0, orgsSucceeded: 0, orgsFailed: 0, clustersPromoted: 0, durationMs,
    };
    logger.error(`${SOURCE}.completed`, { jobRunId, ...result, error: err instanceof Error ? err.message : String(err) });
    return result;
  }

  let orgsSucceeded = 0;
  let orgsFailed = 0;
  let clustersPromoted = 0;

  // Phase 2: per-org processing inside tenant-scoped transactions.
  const windowCutoff = new Date();
  windowCutoff.setDate(windowCutoff.getDate() - WINDOW_DAYS);

  for (const org of orgs) {
    try {
      const promoted = await processOrg(org.id, windowCutoff, jobRunId);
      clustersPromoted += promoted;
      orgsSucceeded++;
    } catch (err) {
      orgsFailed++;
      logger.warn(`${SOURCE}.org_failed`, {
        jobRunId, orgId: org.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  const status = orgsFailed === 0 ? 'success' : orgsSucceeded > 0 ? 'partial' : 'failed';
  const result: CorrectionPatternDetectorResult = {
    status, orgsAttempted: orgs.length, orgsSucceeded, orgsFailed, clustersPromoted, durationMs,
  };
  logger.info(`${SOURCE}.completed`, { jobRunId, ...result });
  return result;
}

// ── Per-org processing ────────────────────────────────────────────────────────

async function processOrg(organisationId: string, windowCutoff: Date, jobRunId: string): Promise<number> {
  // Load correction blocks with non-null embeddings created in the window.
  const rawBlocks = await withAdminConnection(
    { source: SOURCE, reason: `org ${organisationId}: load correction blocks`, skipAudit: true },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      await tx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);
      return (await tx.execute(
        sql`
          SELECT id, owner_agent_id, name, content, embedding, created_at
          FROM memory_blocks
          WHERE organisation_id = ${organisationId}::uuid
            AND captured_via = 'operator_correction'
            AND deleted_at IS NULL
            AND created_at >= ${windowCutoff}
            AND embedding IS NOT NULL
        `,
      )) as unknown as Array<{
        id: string;
        owner_agent_id: string | null;
        name: string;
        content: string;
        embedding: unknown;
        created_at: string;
      }>;
    },
  );

  if (rawBlocks.length === 0) return 0;

  // Map to CorrectionInput, skip blocks with missing agentId or unparseable skillSlug.
  // §10.2 clustering dimensions: failedCheckId and entityType extend the grouping key.
  // memory_blocks does not carry a direct FK to scorecard_judgements; these fields
  // are populated as null until a future schema extension provides the linkage.
  const corrections: CorrectionInput[] = [];
  for (const block of rawBlocks) {
    if (!block.owner_agent_id) continue;
    const skillSlug = parseSkillSlugFromBlockName(block.name);
    if (!skillSlug) continue;
    const embedding = parseEmbedding(block.embedding);
    if (!embedding) continue;
    corrections.push({
      memoryBlockId: block.id,
      agentId: block.owner_agent_id,
      skillSlug,
      editedOutputEmbedding: embedding,
      capturedAt: block.created_at,
      content: block.content,
      failedCheckId: null,
      entityType: null,
    });
  }

  if (corrections.length === 0) return 0;

  // Run the pure clusterer.
  const clusters = cluster({
    corrections,
    similarityThreshold: SIMILARITY_THRESHOLD,
    minClusterSize: MIN_CLUSTER_SIZE,
    windowDays: WINDOW_DAYS,
  });

  if (clusters.length === 0) return 0;

  // Promote each cluster to a pending_review memory_block and optionally emit
  // a scorecard_tightening_suggestion recommendation.
  let promoted = 0;
  for (const clus of clusters) {
    try {
      await promoteCluster(organisationId, clus.agentId, clus.skillSlug, clus, jobRunId);
      promoted++;
    } catch (err) {
      logger.warn(`${SOURCE}.promote_failed`, {
        jobRunId, organisationId, agentId: clus.agentId, skillSlug: clus.skillSlug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return promoted;
}

// ── Cluster promotion ─────────────────────────────────────────────────────────

async function promoteCluster(
  organisationId: string,
  agentId: string,
  skillSlug: string,
  clus: { memberMemoryBlockIds: string[]; representativeEditedOutput: string; centroidEmbedding: number[] },
  jobRunId: string,
): Promise<void> {
  const synthesisName = `pattern:${agentId}:${skillSlug}:${jobRunId}`;
  const content = `Operator correction pattern detected for skill ${skillSlug}.\n\nRepresentative correction:\n${clus.representativeEditedOutput}\n\nCluster size: ${clus.memberMemoryBlockIds.length}`;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);
    await withOrgTx(
      { tx, organisationId, source: `${SOURCE}:promote` },
      async () => {
        const orgDb = getOrgScopedDb(`${SOURCE}:promote`);

        // Insert the synthesised pending-review block (idempotent via orgNameIdx).
        await orgDb
          .insert(memoryBlocks)
          .values({
            organisationId,
            ownerAgentId: agentId,
            name: synthesisName,
            content,
            capturedVia: 'auto_synthesised',
            confidence: 'low',
            qualityScore: '0.50',
            status: 'pending_review',
            source: 'auto_synthesised',
            isReadOnly: true,
          })
          .onConflictDoNothing();
      },
    );
  });

  logger.info(`${SOURCE}.cluster_promoted`, {
    jobRunId, organisationId, agentId, skillSlug,
    clusterSize: clus.memberMemoryBlockIds.length,
    synthesisName,
  });

  // Optional: emit scorecard tightening suggestion (best-effort, spec §10.5).
  if (TIGHTENING_SUGGESTIONS_ENABLED) {
    try {
      const { upsertRecommendation } = await import('../services/agentRecommendationsService.js');
      await upsertRecommendation(
        { organisationId, agentId },
        {
          scope_type: 'org',
          scope_id: organisationId,
          category: 'scorecard_tightening_suggestion',
          severity: 'info',
          title: `Correction pattern detected: ${skillSlug}`,
          body: `Operators keep correcting the ${skillSlug} skill on this agent. Consider tightening the relevant quality check's pass mark.`,
          evidence: { agentId, skillSlug, clusterSize: clus.memberMemoryBlockIds.length },
          dedupe_key: `${agentId}:${skillSlug}:tightening`,
        },
      );
    } catch (err) {
      // Best-effort per spec §10.5 — log and continue.
      logger.warn(`${SOURCE}.recommendation_failed`, {
        jobRunId, organisationId, agentId, skillSlug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

