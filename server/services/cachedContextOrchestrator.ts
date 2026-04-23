import { db } from '../db/index.js';
import { agentRuns, bundleResolutionSnapshots } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { AttachmentSubjectType } from '../db/schema/documentBundleAttachments.js';
import { resolve as resolveBudget, BudgetResolutionError, type ExecutionBudgetOverrides } from './executionBudgetResolver.js';
import { resolveAtRunStart, CACHED_CONTEXT_NO_BUNDLES_ATTACHED, CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING, CACHED_CONTEXT_SNAPSHOT_CONCURRENCY_LOST } from './bundleResolutionService.js';
import { assembleAndValidate, CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION } from './contextAssemblyEngine.js';
import { actionService } from './actionService.js';
import { hitlService } from './hitlService.js';
import { routeCall } from './llmRouter.js';
import { HITL_REVIEW_TIMEOUT_MS } from '../config/limits.js';
import type { HitlBudgetBlockPayload } from '../../shared/types/cachedContext.js';
import { isParseFailureError } from '../lib/parseFailureError.js';

// ---------------------------------------------------------------------------
// cachedContextOrchestrator — end-to-end cached-context pipeline (§6.6)
//
// Resolves budget + bundles → assembles prefix → validates → routes to LLM.
// Owns run-outcome classification and terminal write on agent_runs.
// ---------------------------------------------------------------------------

export type CachedContextOrchestratorResult =
  | {
      runOutcome: 'completed' | 'degraded';
      llmResponseContent: string;
      llmRequestId: string;
      bundleSnapshotIds: string[];
      prefixHash: string;
      cacheStats: {
        readTokens: number;
        creationTokens: number;
        hitType: 'miss' | 'partial' | 'full';
      };
    }
  | {
      runOutcome: 'failed';
      failureReason:
        | 'hitl_rejected'
        | 'hitl_timeout'
        | 'hitl_second_breach'
        | 'router_error'
        | 'provider_error'
        | 'parse_failure'
        | 'budget_resolution_error'
        | 'document_token_count_missing'
        | 'snapshot_integrity_violation'
        | 'snapshot_concurrency_lost'
        | 'no_bundles_attached';
      bundleSnapshotIds?: string[];
      variableInputHash?: string;
      prefixHash?: string;
      llmRequestId?: string;
    };

export interface CachedContextOrchestrator {
  execute(input: {
    organisationId: string;
    subaccountId: string | null;
    subjectType: AttachmentSubjectType;
    subjectId: string;
    agentId: string;
    runId: string;
    variableInput: string;
    instructions: string;
    modelFamily: string;
    taskConfig?: ExecutionBudgetOverrides;
    ttl?: '5m' | '1h';
  }): Promise<CachedContextOrchestratorResult>;
}

function classifyErrorCode(err: unknown): CachedContextOrchestratorResult & { runOutcome: 'failed' } {
  const code = (err as any)?.code as string | undefined;

  if (code === CACHED_CONTEXT_NO_BUNDLES_ATTACHED) {
    return { runOutcome: 'failed', failureReason: 'no_bundles_attached' };
  }
  if (code === CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING) {
    return { runOutcome: 'failed', failureReason: 'document_token_count_missing' };
  }
  if (code === CACHED_CONTEXT_SNAPSHOT_CONCURRENCY_LOST) {
    return { runOutcome: 'failed', failureReason: 'snapshot_concurrency_lost' };
  }
  if (code === CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION) {
    return { runOutcome: 'failed', failureReason: 'snapshot_integrity_violation' };
  }
  if (err instanceof BudgetResolutionError) {
    return { runOutcome: 'failed', failureReason: 'budget_resolution_error' };
  }
  if (isParseFailureError(err)) {
    return { runOutcome: 'failed', failureReason: 'parse_failure' };
  }
  const statusCode = (err as any)?.statusCode as number | undefined;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return { runOutcome: 'failed', failureReason: 'provider_error' };
  }
  return { runOutcome: 'failed', failureReason: 'router_error' };
}

async function writeTerminalOutcome(input: {
  runId: string;
  outcome: 'completed' | 'degraded' | 'failed';
  degradedReason: 'soft_warn' | 'token_drift' | 'cache_miss' | null;
  bundleSnapshotIds: string[] | null;
  variableInputHash: string | null;
  softWarnTripped: boolean;
}): Promise<void> {
  await db
    .update(agentRuns)
    .set({
      runOutcome: input.outcome,
      degradedReason: input.degradedReason ?? undefined,
      bundleSnapshotIds: input.bundleSnapshotIds !== null ? (input.bundleSnapshotIds as any) : undefined,
      variableInputHash: input.variableInputHash ?? undefined,
      softWarnTripped: input.softWarnTripped,
    })
    .where(
      and(
        eq(agentRuns.id, input.runId),
        isNull(agentRuns.runOutcome)
      )
    );
}

async function resolveAndAssemble(input: {
  organisationId: string;
  subaccountId: string | null;
  subjectType: AttachmentSubjectType;
  subjectId: string;
  modelFamily: string;
  taskConfig: ExecutionBudgetOverrides | undefined;
  variableInput: string;
  instructions: string;
}) {
  const resolvedBudget = await resolveBudget({
    organisationId: input.organisationId,
    modelFamily: input.modelFamily,
    taskConfig: input.taskConfig,
  });

  const { snapshots } = await resolveAtRunStart({
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    modelFamily: input.modelFamily,
  });

  const assemblyResult = await assembleAndValidate({
    snapshots,
    variableInput: input.variableInput,
    instructions: input.instructions,
    resolvedBudget,
  });

  return { resolvedBudget, snapshots, assemblyResult };
}

export const cachedContextOrchestrator: CachedContextOrchestrator = {
  async execute(input) {
    const {
      organisationId, subaccountId, subjectType, subjectId, agentId,
      runId, variableInput, instructions, modelFamily, taskConfig, ttl,
    } = input;

    let knownBundleSnapshotIds: string[] | undefined;
    let knownVariableInputHash: string | undefined;
    let knownPrefixHash: string | undefined;
    let knownLlmRequestId: string | undefined;

    try {
      // Steps 1–3: resolve budget + snapshots + assembly
      let resolveResult = await resolveAndAssemble({
        organisationId, subaccountId, subjectType, subjectId,
        modelFamily, taskConfig, variableInput, instructions,
      });

      knownBundleSnapshotIds = resolveResult.snapshots.map((s) => s.id);

      // Step 4: HITL path for budget_breach
      if (resolveResult.assemblyResult.kind === 'budget_breach') {
        const assemblyBreach = resolveResult.assemblyResult as any;
        const blockPayload: HitlBudgetBlockPayload = assemblyBreach.blockPayload ?? {
          kind: 'cached_context_budget_breach',
          ...assemblyBreach,
        };

        const proposed = await actionService.proposeAction({
          organisationId,
          subaccountId,
          agentId,
          agentRunId: runId,
          actionType: 'cached_context_budget_breach',
          gateOverride: 'block',
          payload: blockPayload as unknown as Record<string, unknown>,
          idempotencyKey: `ccb:${runId}`,
        });

        await db
          .update(agentRuns)
          .set({
            bundleSnapshotIds: knownBundleSnapshotIds as any,
          })
          .where(and(eq(agentRuns.id, runId), isNull(agentRuns.runOutcome)));

        const decision = await hitlService.awaitDecision(proposed.actionId, HITL_REVIEW_TIMEOUT_MS);

        if (!decision.approved) {
          const failureReason = decision.comment?.includes('timeout') ? 'hitl_timeout' : 'hitl_rejected';
          await writeTerminalOutcome({
            runId,
            outcome: 'failed',
            degradedReason: null,
            bundleSnapshotIds: knownBundleSnapshotIds,
            variableInputHash: null,
            softWarnTripped: false,
          });
          return { runOutcome: 'failed', failureReason, bundleSnapshotIds: knownBundleSnapshotIds };
        }

        // Approved: re-run steps 1–3 exactly once from current state
        resolveResult = await resolveAndAssemble({
          organisationId, subaccountId, subjectType, subjectId,
          modelFamily, taskConfig, variableInput, instructions,
        });
        knownBundleSnapshotIds = resolveResult.snapshots.map((s) => s.id);

        if (resolveResult.assemblyResult.kind === 'budget_breach') {
          await writeTerminalOutcome({
            runId,
            outcome: 'failed',
            degradedReason: null,
            bundleSnapshotIds: knownBundleSnapshotIds,
            variableInputHash: null,
            softWarnTripped: false,
          });
          return { runOutcome: 'failed', failureReason: 'hitl_second_breach', bundleSnapshotIds: knownBundleSnapshotIds };
        }
      }

      // Step 5: pre-call write — store snapshot IDs + variable input hash
      const okResult = resolveResult.assemblyResult as any; // kind === 'ok'
      const bundleSnapshotIds: string[] = okResult.bundleSnapshotIds ?? knownBundleSnapshotIds ?? [];
      const variableInputHash: string = okResult.variableInputHash ?? '';
      const assembledPrefixHash: string = okResult.prefixHash ?? '';
      const softWarnTripped: boolean = okResult.softWarnTripped ?? false;
      const routerPayload = okResult.routerPayload;
      const estimatedContextTokens: number = routerPayload?.estimatedContextTokens ?? 0;

      knownVariableInputHash = variableInputHash;
      knownPrefixHash = assembledPrefixHash;

      await db
        .update(agentRuns)
        .set({
          bundleSnapshotIds: bundleSnapshotIds as any,
          variableInputHash,
          softWarnTripped,
        })
        .where(and(eq(agentRuns.id, runId), isNull(agentRuns.runOutcome)));

      // Step 6: call LLM router
      const response = await routeCall({
        messages: routerPayload?.messages ?? [],
        system: routerPayload?.system,
        estimatedContextTokens,
        maxTokens: resolveResult.resolvedBudget.maxOutputTokens,
        prefixHash: assembledPrefixHash,
        cacheTtl: ttl ?? '1h',
        context: {
          organisationId,
          subaccountId: subaccountId ?? undefined,
          sourceType: 'agent_run',
          taskType: 'agent_task',
          executionPhase: 'main',
          runId,
          featureTag: 'cached-context',
        },
      });

      knownLlmRequestId = response.providerRequestId;

      // Step 7: parse cache usage
      const readTokens = response.cachedPromptTokens ?? 0;
      const cacheCreationTokens = (response as any).cacheCreationTokens ?? 0;
      const totalInputTokens = response.tokensIn ?? 0;

      let hitType: 'miss' | 'partial' | 'full';
      if (readTokens === 0 && cacheCreationTokens === 0) {
        hitType = 'miss';
      } else if (readTokens > 0 && cacheCreationTokens === 0) {
        hitType = 'full';
      } else {
        hitType = 'partial';
      }

      // Step 8: run outcome classification
      let runOutcome: 'completed' | 'degraded' = 'completed';
      let degradedReason: 'soft_warn' | 'token_drift' | 'cache_miss' | null = null;

      if (softWarnTripped) {
        runOutcome = 'degraded';
        degradedReason = 'soft_warn';
      } else if (estimatedContextTokens > 0 && totalInputTokens > estimatedContextTokens * 1.1) {
        runOutcome = 'degraded';
        degradedReason = 'token_drift';
      } else if (hitType === 'miss') {
        // cache_miss: full miss when a snapshot with this prefixHash existed in-window
        const priorSnap = await db
          .select({ id: bundleResolutionSnapshots.id })
          .from(bundleResolutionSnapshots)
          .where(eq(bundleResolutionSnapshots.prefixHash, assembledPrefixHash))
          .limit(1);
        if (priorSnap.length > 0) {
          runOutcome = 'degraded';
          degradedReason = 'cache_miss';
        }
      }

      // Step 9: terminal write
      await writeTerminalOutcome({
        runId,
        outcome: runOutcome,
        degradedReason,
        bundleSnapshotIds,
        variableInputHash,
        softWarnTripped,
      });

      return {
        runOutcome,
        llmResponseContent: response.content,
        llmRequestId: knownLlmRequestId ?? '',
        bundleSnapshotIds,
        prefixHash: assembledPrefixHash,
        cacheStats: { readTokens, creationTokens: cacheCreationTokens, hitType },
      };

    } catch (err) {
      const classified = classifyErrorCode(err);
      await writeTerminalOutcome({
        runId,
        outcome: 'failed',
        degradedReason: null,
        bundleSnapshotIds: knownBundleSnapshotIds ?? null,
        variableInputHash: knownVariableInputHash ?? null,
        softWarnTripped: false,
      }).catch(() => { /* terminal write failure is best-effort */ });

      return {
        ...classified,
        bundleSnapshotIds: knownBundleSnapshotIds,
        variableInputHash: knownVariableInputHash,
        prefixHash: knownPrefixHash,
        llmRequestId: knownLlmRequestId,
      };
    }
  },
};
