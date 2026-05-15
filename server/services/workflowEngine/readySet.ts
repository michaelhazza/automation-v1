import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { workflowStepRuns, memoryBlocks } from '../../db/schema/index.js';
import { logger } from '../../lib/logger.js';
import { emitWorkflowRunUpdate, emitSubaccountUpdate } from '../../websocket/emitters.js';
import { upsertFromWorkflow } from '../memoryBlockService.js';
import { getByPath, serialiseForBlock } from '../memoryBlockUpsertPure.js';
import { isBaselineSlug, tierFor, domainsFor } from '../../../shared/constants/baselineArtefacts.js';
import type { BaselineSlug } from '../../../shared/constants/baselineArtefacts.js';
import { subaccountOnboardingService } from '../subaccountOnboardingService.js';
import { resolveConfigurationAssistantAgentId } from '../workflowActionCallExecutor.js';
import { resolveWorkflowSlugForRun, hasPriorSuccessfulRunForSlug } from './definitionHelpers.js';
import { requireSubaccountId } from './types.js';
import type { WorkflowRun, WorkflowStepRun, WorkflowDefinition, WorkflowStep } from './types.js';

/**
 * Identifies the set of steps whose dependencies are all completed and
 * which themselves are still in 'pending' status.
 */
export function computeReadySet(def: WorkflowDefinition, stepRuns: WorkflowStepRun[]): WorkflowStep[] {
  const completedStepIds = new Set(
    stepRuns.filter((s) => s.status === 'completed' || s.status === 'skipped').map((s) => s.stepId),
  );
  const ready: WorkflowStep[] = [];
  for (const step of def.steps) {
    const sr = stepRuns.find((s) => s.stepId === step.id && s.status === 'pending');
    if (!sr) continue;
    const depsMet = step.dependsOn.every((d) => completedStepIds.has(d));
    if (depsMet) ready.push(step);
  }
  return ready;
}

/**
 * Materialise pending step run rows for any step in the definition that has
 * all its dependencies in a terminal state but does not yet have a live row.
 * Returns the number of rows materialised.
 */
export async function materialisePendingStepRuns(
  runId: string,
  def: WorkflowDefinition,
  liveStepRuns: WorkflowStepRun[],
): Promise<number> {
  const existingStepIds = new Set(liveStepRuns.map((s) => s.stepId));
  const terminalStepIds = new Set(
    liveStepRuns
      .filter((s) => s.status === 'completed' || s.status === 'skipped')
      .map((s) => s.stepId),
  );

  let materialised = 0;
  for (const step of def.steps) {
    if (existingStepIds.has(step.id)) continue;

    if (step.dependsOn.length === 0) {
      try {
        await db.insert(workflowStepRuns).values({
          runId,
          stepId: step.id,
          stepType: step.type,
          status: 'pending',
          sideEffectType: step.sideEffectType,
          dependsOn: step.dependsOn,
        });
        materialised++;
      } catch {
        // Unique constraint — another tick created it concurrently. Ignore.
      }
      continue;
    }

    const allDepsTerminal = step.dependsOn.every((d) => terminalStepIds.has(d));
    if (!allDepsTerminal) continue;

    const allDepsSkipped = step.dependsOn.every((d) => {
      const sr = liveStepRuns.find((s) => s.stepId === d);
      return sr?.status === 'skipped';
    });
    const status = allDepsSkipped ? 'skipped' : 'pending';

    try {
      await db.insert(workflowStepRuns).values({
        runId,
        stepId: step.id,
        stepType: step.type,
        status,
        sideEffectType: step.sideEffectType,
        dependsOn: step.dependsOn,
        ...(status === 'skipped' ? { completedAt: new Date() } : {}),
      });
      materialised++;
    } catch {
      // Unique constraint — concurrent tick handled it. Ignore.
    }
  }

  return materialised;
}

/**
 * Emits a structured event to both the per-run room and the subaccount-level
 * coarse room. Spec §8.2.
 */
export async function emitWorkflowEvent(
  runId: string,
  subaccountId: string | null,
  type: string,
  payload: Record<string, unknown>,
  options?: { suppressWebSocket?: boolean },
): Promise<void> {
  if (options?.suppressWebSocket) {
    const isFinalEvent = type === 'Workflow:run:status' && (
      payload.status === 'completed' ||
      payload.status === 'completed_with_errors' ||
      payload.status === 'failed' ||
      payload.status === 'cancelled' ||
      payload.status === 'partial'
    );
    if (!isFinalEvent) return;
  }
  let sequence = 0;
  try {
    const result = await db.execute(
      sql`UPDATE workflow_run_event_sequences SET last_sequence = last_sequence + 1 WHERE run_id = ${runId} RETURNING last_sequence`,
    );
    const row = (result as unknown as { rows?: Array<{ last_sequence: number | string }> }).rows?.[0];
    if (row) {
      sequence = typeof row.last_sequence === 'string' ? parseInt(row.last_sequence, 10) : row.last_sequence;
    }
  } catch (err) {
    logger.warn('workflow_ws_sequence_allocation_failed', {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  emitWorkflowRunUpdate(runId, type, { ...payload, sequence });
  if (type === 'Workflow:run:status' && subaccountId !== null) {
    emitSubaccountUpdate(subaccountId, type, { runId, ...payload, sequence });
  }
}

/**
 * Apply the run's knowledgeBindings[] on terminal completion.
 * Failures on individual bindings never block run completion.
 */
export async function finaliseRunKnowledgeBindings(
  run: WorkflowRun,
  def: WorkflowDefinition,
  liveStepRuns: WorkflowStepRun[],
): Promise<void> {
  const bindings = def.knowledgeBindings ?? [];
  if (bindings.length === 0) return;

  if (run.subaccountId === null) return;
  const subaccountId: string = run.subaccountId;

  const slug = await resolveWorkflowSlugForRun(run);
  if (!slug) {
    logger.warn('workflow_knowledge_binding_slug_missing', { runId: run.id });
    return;
  }

  let priorRunChecked = false;
  let priorRunExists = false;
  const ensurePriorRunChecked = async () => {
    if (priorRunChecked) return;
    priorRunExists = await hasPriorSuccessfulRunForSlug(run.subaccountId, slug, run.id);
    priorRunChecked = true;
  };

  const actorAgentId = await resolveConfigurationAssistantAgentId(run.organisationId);

  for (const binding of bindings) {
    const sr = liveStepRuns.find(
      (row) => row.stepId === binding.stepId && row.status === 'completed',
    );
    if (!sr) {
      await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:missing_output', {
        stepId: binding.stepId,
        blockLabel: binding.blockLabel,
        reason: 'step_not_completed',
      });
      continue;
    }

    const value = getByPath(sr.outputJson, binding.outputPath);
    if (value === undefined) {
      await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:missing_output', {
        stepId: binding.stepId,
        blockLabel: binding.blockLabel,
        outputPath: binding.outputPath,
        reason: 'output_path_unresolved',
      });
      continue;
    }

    if (binding.firstRunOnly) {
      await ensurePriorRunChecked();
      if (priorRunExists) {
        await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:first_run_only_skipped', {
          stepId: binding.stepId,
          blockLabel: binding.blockLabel,
        });
        continue;
      }
    }

    const serialised = serialiseForBlock(value);

    const baselineTierFields: {
      tier?: 1 | 2;
      appliesToDomains?: string[] | null;
      autoAttach?: boolean;
    } = {};
    if (slug === 'baseline-artefacts-capture' && isBaselineSlug(binding.blockLabel)) {
      const blockTier = tierFor(binding.blockLabel);
      if (blockTier === 1 || blockTier === 2) {
        baselineTierFields.tier = blockTier;
        const domains = domainsFor(binding.blockLabel);
        baselineTierFields.appliesToDomains = domains.length > 0 ? [...domains] : null;
        baselineTierFields.autoAttach = true;
      }
    }

    try {
      const result = await upsertFromWorkflow({
        organisationId: run.organisationId,
        subaccountId: requireSubaccountId(run),
        label: binding.blockLabel,
        content: serialised,
        mergeStrategy: binding.mergeStrategy ?? 'replace',
        sourceRunId: run.id,
        workflowSlug: slug,
        actorAgentId,
        confidence: binding.firstRunOnly ? 'low' : 'normal',
        ...baselineTierFields,
      });

      switch (result.kind) {
        case 'created':
          await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:created', {
            stepId: binding.stepId,
            blockLabel: binding.blockLabel,
            blockId: result.blockId,
            truncated: result.truncated,
          });
          if (result.truncated) {
            await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:truncated', {
              stepId: binding.stepId,
              blockLabel: binding.blockLabel,
              blockId: result.blockId,
            });
          }
          break;
        case 'updated':
          await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:updated', {
            stepId: binding.stepId,
            blockLabel: binding.blockLabel,
            blockId: result.blockId,
            truncated: result.truncated,
            mergeFallback: result.mergeFallback,
          });
          if (result.truncated) {
            await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:truncated', {
              stepId: binding.stepId,
              blockLabel: binding.blockLabel,
              blockId: result.blockId,
            });
          }
          if (result.mergeFallback) {
            await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:merge_fallback', {
              stepId: binding.stepId,
              blockLabel: binding.blockLabel,
              blockId: result.blockId,
            });
          }
          break;
        case 'skipped':
          if (result.reason === 'hitl_overwrite') {
            await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:hitl_required', {
              stepId: binding.stepId,
              blockLabel: binding.blockLabel,
              blockId: result.blockId,
              previewContent: result.previewContent,
            });
          } else if (result.reason === 'rate_limited') {
            await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:rate_limited', {
              stepId: binding.stepId,
              blockLabel: binding.blockLabel,
            });
          } else if (result.reason === 'empty_output') {
            await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:knowledge_binding:empty_output', {
              stepId: binding.stepId,
              blockLabel: binding.blockLabel,
            });
          }
          break;
      }
    } catch (err) {
      logger.error('workflow_knowledge_binding_error', {
        runId: run.id,
        stepId: binding.stepId,
        blockLabel: binding.blockLabel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * F1 §3 — per-step completion hook for `baseline-artefacts-capture`.
 * Throws propagate to the caller — errors here are not swallowed.
 */
export async function finaliseBaselineArtefactCapture(
  runId: string,
  subaccountId: string,
  organisationId: string,
  userId: string,
  liveStepRuns: WorkflowStepRun[],
): Promise<void> {
  const BASELINE_STEP_IDS = [
    'brand_identity',
    'voice_tone',
    'offer_positioning',
    'audience_icp',
    'operating_constraints',
    'proof_library',
  ] as const;

  for (const stepShortId of BASELINE_STEP_IDS) {
    const fullSlug = `baseline.${stepShortId}` as BaselineSlug;
    const sr = liveStepRuns.find((r) => r.stepId === stepShortId);
    if (!sr) continue;

    const tier = tierFor(fullSlug);

    if (sr.status === 'completed') {
      if (tier === 1 || tier === 2) {
        const blockLabel = fullSlug;
        const [block] = await db
          .select({ id: memoryBlocks.id })
          .from(memoryBlocks)
          .where(
            and(
              eq(memoryBlocks.organisationId, organisationId),
              eq(memoryBlocks.subaccountId, subaccountId),
              eq(memoryBlocks.name, blockLabel),
              isNull(memoryBlocks.deletedAt),
            ),
          );
        if (!block) {
          logger.warn('baseline_artefact_block_missing_at_finalise', {
            runId,
            slug: fullSlug,
            subaccountId,
          });
          continue;
        }
        await subaccountOnboardingService.markArtefactCaptured({
          organisationId,
          subaccountId,
          slug: fullSlug,
          userId,
          memoryBlockId: block.id,
        });
      } else {
        // tier === 3
        await subaccountOnboardingService.markArtefactCaptured({
          organisationId,
          subaccountId,
          slug: fullSlug,
          userId,
          tier3Payload: (sr.outputJson ?? {}) as Record<string, unknown>,
        });
      }
    } else if (sr.status === 'skipped' && tier === 3) {
      await subaccountOnboardingService.markArtefactSkipped({
        organisationId,
        subaccountId,
        slug: fullSlug,
        userId,
        reason: 'defer_for_later',
      });
    }
  }
}
