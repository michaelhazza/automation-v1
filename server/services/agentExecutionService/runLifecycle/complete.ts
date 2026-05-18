import { createHash } from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { logger } from '../../../lib/logger.js';
import { describeTransition } from '../../../../shared/stateMachineGuards.js';
import {
  agentRuns,
  agentRunSnapshots,
  subaccountAgents,
  agentExecutionEvents,
} from '../../../db/schema/index.js';
import { computeRunResultStatus } from '../../agentExecutionServicePure.js';
import { tryEmitAgentEvent } from '../../agentExecutionEventEmitter.js';
import { emitAgentRunUpdate, emitSubaccountUpdate } from '../../../websocket/emitters.js';
import { workspaceMemoryService } from '../../workspaceMemoryService.js';
import { agentBriefingService } from '../../agentBriefingService.js';
import { triggerService } from '../../triggerService.js';
import { validateArtefactForPersistence } from '../../taskArtefactValidator.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { project as projectToolCallsLogFromMessages } from '../../toolCallsLogProjectionService.js';
import { recordIncident } from '../../incidentIngestor.js';
import type { ServicePrincipal } from '../../principal/types.js';
import type { AgentRunRequest, AgentRunResult, RunExecutionContext } from '../types.js';

export async function finalizeRun(
  request: AgentRunRequest,
  ctx: RunExecutionContext,
): Promise<AgentRunResult> {
  const run = ctx.run!;
  const startTime = ctx.startTime;
  const scopedDb = getOrgScopedDb('complete.finalizeRun');

  // In-process / subprocess: the loop ran inline and the adapter
  // returned the loop result. The post-completion finalisation
  // block below handles the terminal write + side-effects.
  const loopResult = ctx.dispatchResult!.loopResult!;

  // ── 9. Finalise the run ─────────────────────────────────────────────
  const durationMs = Date.now() - startTime;
  let finalStatus = (loopResult.finalStatus ?? 'completed') as
    'completed' | 'completed_with_uncertainty' | 'failed' | 'timeout' | 'loop_detected' | 'budget_exceeded' | 'cancelled';

  if (loopResult.finalStatus === 'blocked_awaiting_integration') {
    // Run is paused — do NOT write completedAt or trigger finalisation.
    // The blocked state has already been persisted inside the loop.
    return {
      runId: run.id,
      status: 'blocked_awaiting_integration' as AgentRunResult['status'],
      summary: null,
      totalToolCalls: loopResult.totalToolCalls,
      totalTokens: loopResult.totalTokens,
      durationMs,
      tasksCreated: loopResult.tasksCreated,
      tasksUpdated: loopResult.tasksUpdated,
      deliverablesCreated: loopResult.deliverablesCreated,
    };
  }

  // Pre-fetch runMetadata once — consumed by both the Reporting Agent
  // finalize hook and Phase B's runResultStatus derivation (which reads
  // `hadUncertainty` from runMetadata, where the clarification-timeout
  // job writes it).
  const [preFinalizeRow] = await scopedDb
    .select({ runMetadata: agentRuns.runMetadata, errorMessage: agentRuns.errorMessage })
    .from(agentRuns)
    .where(eq(agentRuns.id, run.id))
    .limit(1);
  const preFinalizeMetadata =
    (preFinalizeRow?.runMetadata ?? null) as Record<string, unknown> | null;

  // T25 / T16 — Reporting Agent end-of-run hook. Runs the invariant
  // and persists the content fingerprint. No-op for non-Reporting-Agent
  // runs. Spec v3.4 §6.7.2 / §8.4.2.
  if (finalStatus === 'completed') {
    try {
      const { finalizeReportingAgentRun } = await import('../../../lib/reportingAgentRunHook.js');
      await finalizeReportingAgentRun({
        runId: run.id,
        subaccountAgentId: request.subaccountAgentId ?? null,
        organisationId: request.organisationId,
        runMetadata: preFinalizeMetadata,
      });
    } catch (err) {
      // Invariant or persist failed — downgrade to failed so the run
      // does not flip to completed in an inconsistent state.
      logger.error('reportingAgent.finalize_failed', {
        runId: run.id,
        error: err instanceof Error ? err.message : String(err),
      });
      finalStatus = 'failed';
    }
  }

  // Hermes Tier 1 Phase B §6.3 — derive runResultStatus for the
  // terminal write. `hadUncertainty` lives on runMetadata (the
  // clarification-timeout job at `clarificationTimeoutJob.ts` writes
  // it there); `hasError` is inferred from finalStatus; `hasSummary`
  // is the trimmed-length > 0 check.
  const hadUncertainty = preFinalizeMetadata?.hadUncertainty === true;
  const hasSummary = !!(loopResult.summary && loopResult.summary.trim().length > 0);
  const derivedRunResultStatus = computeRunResultStatus(
    finalStatus,
    /* hasError — only affects the 'completed' branch of computeRunResultStatus;
       ignored for all other terminal statuses which return directly */ finalStatus !== 'completed',
    hadUncertainty,
  );
  // H3: hasSummary is no longer passed to computeRunResultStatus. Summary absence
  // is surfaced via the summaryMissing side-channel below, not via 'partial' status.

  // Write-once guard (§6.3.1): add `AND run_result_status IS NULL` so
  // a second attempt at the same terminal write becomes a zero-row
  // UPDATE rather than an overwrite. `.returning()` lets us detect
  // that and log rather than silently drift from the first writer's
  // value.
  //
  // Round-3 review note: this terminal write does not yet flow through
  // `assertValidTransition`. The `runResultStatus IS NULL` predicate
  // already guards against overwriting a terminal row, but we log the
  // transition with `guarded: false` so operators can quantify the
  // unguarded-by-assert surface area against the F6 follow-up spec.
  logger.info('state_transition', describeTransition({
    kind: 'agent_run',
    recordId: run.id,
    to: finalStatus,
    site: 'agentExecutionService.finishLoop_normal',
    guarded: false,
  }));
  const terminalUpdate = await scopedDb.update(agentRuns).set({
    status: finalStatus,
    runResultStatus: derivedRunResultStatus,
    totalToolCalls: loopResult.totalToolCalls,
    inputTokens: loopResult.inputTokens,
    outputTokens: loopResult.outputTokens,
    totalTokens: loopResult.totalTokens,
    summary: loopResult.summary,
    tasksCreated: loopResult.tasksCreated,
    tasksUpdated: loopResult.tasksUpdated,
    deliverablesCreated: loopResult.deliverablesCreated,
    lastActivityAt: new Date(),
    completedAt: new Date(),
    durationMs,
    updatedAt: new Date(),
  })
    .where(and(eq(agentRuns.id, run.id), isNull(agentRuns.runResultStatus)))
    .returning({ id: agentRuns.id, nextEventSeq: agentRuns.nextEventSeq });
  if (terminalUpdate.length === 0) {
    logger.warn('runResultStatus.write_skipped', {
      runId: run.id,
      attemptedStatus: derivedRunResultStatus,
      writeSite: 'finishLoop_normal',
    });
  } else {
    // F22 — meaningful-run tracking hook for the non-IEE finalization path.
    // The IEE path calls this from the IEE adapter's post-commit hook
    // (`executionBackends/_ieeShared.ts::ieeFinalise`); without this
    // call, ordinary API/triggered runs never advance
    // `subaccount_agents.last_meaningful_tick_at` /
    // `ticks_since_last_meaningful_run`, which leaves the heartbeat
    // streak detector blind to the primary execution path. Best-effort —
    // a tracking-update failure must not flip a successful run to failed.
    try {
      const { updateMeaningfulRunTracking } = await import('../../agentRunFinalizationService.js');
      await updateMeaningfulRunTracking(run.id, finalStatus);
    } catch (err) {
      logger.warn('agentExecutionService.meaningful_hook_failed', {
        runId: run.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Live Agent Execution Log — critical terminal bookend (spec §5.3).
  // totalCostCents is read from the ledger; eventCount from the
  // just-returned nextEventSeq (number of events emitted so far this
  // run, which bounds the event count at this terminal).
  let totalCostCents = 0;
  try {
    const { getRunCostCentsFromLedger } = await import('../../../lib/runCostBreaker.js');
    totalCostCents = await getRunCostCentsFromLedger(run.id);
  } catch (err) {
    logger.warn('agentExecutionService.run_completed_cost_lookup_failed', {
      runId: run.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  // nextEventSeq is the highest sequence allocated before the terminal
  // event. Add 1 to count the run.completed event itself, so the
  // eventCount in the payload matches the number of rows the client
  // will see when it fetches /events (including this terminal event).
  const eventCount = (terminalUpdate[0]?.nextEventSeq ?? 0) + 1;
  tryEmitAgentEvent({
    runId: run.id,
    organisationId: request.organisationId,
    subaccountId: request.subaccountId ?? null,
    sourceService: 'agentExecutionService',
    payload: {
      eventType: 'run.completed',
      critical: true,
      finalStatus,
      totalTokens: loopResult.totalTokens,
      totalCostCents,
      totalDurationMs: durationMs,
      eventCount,
    },
  });

  // H3: summaryMissing side-channel — emit only when hasSummary is false so
  // consumers can correlate without demoting runResultStatus to 'partial'.
  if (!hasSummary) {
    tryEmitAgentEvent({
      runId: run.id,
      organisationId: request.organisationId,
      subaccountId: request.subaccountId ?? null,
      sourceService: 'agentExecutionService',
      payload: {
        eventType: 'run.terminal.summary_missing',
        critical: false,
        runResultStatus: derivedRunResultStatus ?? 'partial',
      },
    });
  }

  // Emit retrieval.summary event — spec §10.4, §11.4, Chunk 4B.
  // Fire-and-forget: partial-unique-index (run_id, event_type='retrieval.summary')
  // makes concurrent emits idempotent. Non-critical: failure logs and continues.
  {
    const { emitRetrievalSummary } = await import('../../retrievalObservabilityService.js');
    const { DEFAULT_CHUNK_TARGET_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS } = await import('../../documentChunkingServicePure.js');
    const retrievalSummaryPromise = emitRetrievalSummary({
      runId: run.id,
      organisationId: request.organisationId,
      result: ctx.retrievalResult!,
      chunkConfig: { targetTokens: DEFAULT_CHUNK_TARGET_TOKENS, overlapTokens: DEFAULT_CHUNK_OVERLAP_TOKENS },
    }).catch((err: unknown) => {
      logger.warn('agentExecutionService.retrieval_summary_emit_failed', {
        runId: run.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Observation emit for retrieval-summary — spec §7.3 Rev 2 composition.
    // Chains off retrievalSummaryPromise so the event row exists before the
    // FK-referencing observation row is inserted. Fire-and-forget: observation
    // failure does NOT roll back the retrieval-summary event.
    retrievalSummaryPromise.then(async () => {
      const { append } = await import('../../agentObservationService.js');
      const orgDb = getOrgScopedDb('agentExecutionService.observation_retrieval_summary');
      const [eventRow] = await orgDb
        .select({ id: agentExecutionEvents.id })
        .from(agentExecutionEvents)
        .where(
          and(
            eq(agentExecutionEvents.runId, run.id),
            eq(agentExecutionEvents.eventType, 'retrieval.summary'),
          ),
        )
        .limit(1);
      if (!eventRow) return; // event was deduplicated away before we could observe it
      const ik = createHash('sha256').update(`${run.id}:retrieval_summary`).digest('hex');
      const svcCtx: ServicePrincipal = {
        type: 'service',
        id: 'agentExecutionService',
        organisationId: request.organisationId,
        subaccountId: request.subaccountId ?? null,
        serviceId: 'agentExecutionService',
        teamIds: [],
      };
      return append(
        {
          agentId: run.agentId,
          eventId: eventRow.id,
          observationType: 'learned',
          body: 'Retrieval summary produced',
          metadata: { source_kind: 'retrieval_summary' },
          idempotencyKey: ik,
        },
        svcCtx,
      );
    }).then((observation) => {
      if (!observation) return;
      tryEmitAgentEvent({
        runId: run.id,
        organisationId: request.organisationId,
        subaccountId: request.subaccountId ?? null,
        sourceService: 'agentExecutionService',
        payload: {
          eventType: 'observation_emitted',
          critical: false,
          observationId: observation.id,
          observationType: 'learned',
          agentId: run.agentId,
          sourceKind: 'retrieval_summary',
        },
      });
    }).catch((err: unknown) => {
      logger.warn('agentExecutionService.observation_retrieval_summary_emit_failed', {
        runId: run.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // Surface terminal failures as system incidents for operator visibility.
  if (finalStatus === 'failed' || finalStatus === 'timeout' || finalStatus === 'loop_detected') {
    recordIncident({
      source: 'agent',
      summary: `Agent run ${finalStatus}: ${loopResult.summary?.slice(0, 200) ?? '(no summary)'}`,
      errorCode: finalStatus,
      organisationId: request.organisationId,
      subaccountId: request.subaccountId ?? null,
      correlationId: run.correlationId ?? undefined,
      errorDetail: { runId: run.id, finalStatus },
    });
  }

  // Brain Tree OS adoption P1 — build the structured handoff document
  // and persist it. Best-effort: a build failure logs and leaves the
  // column null. The run completion above is the source-of-truth state
  // change; this is a follow-up enrichment.
  try {
    const { buildHandoffForRun } = await import('../../agentRunHandoffService.js');
    const handoff = await buildHandoffForRun(run.id, request.organisationId);
    if (handoff !== null) {
      await scopedDb.update(agentRuns)
        .set({ handoffJson: handoff })
        .where(eq(agentRuns.id, run.id));
    }
  } catch (err) {
    logger.warn('agent_runs.handoff_build_failed', {
      runId: run.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Phase 2 (S12) — score injected memory entries against run output.
  // Idempotent: second call is a PK no-op. Best-effort: failure logs
  // and does not affect the run's persisted state.
  if (finalStatus === 'completed' && (ctx.injectedMemoryEntries?.length ?? 0) > 0) {
    try {
      const { scoreRun } = await import('../../memoryCitationDetector.js');
      const generatedText = typeof loopResult.summary === 'string'
        ? loopResult.summary
        : '';
      const toolCallArgs = Array.isArray(loopResult.toolCallsLog)
        ? loopResult.toolCallsLog
            .map((tc: unknown) => (tc as { input?: unknown })?.input)
            .filter((v) => v !== undefined && v !== null)
        : [];
      await scoreRun({
        runId: run.id,
        organisationId: request.organisationId,
        injectedEntries: ctx.injectedMemoryEntries!,
        generatedText,
        toolCallArgs,
      });
    } catch (err) {
      logger.warn('agent_runs.citation_score_failed', {
        runId: run.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Phase 8 / W3c — score applied memory_blocks against run output.
  // Reads appliedMemoryBlockIds populated at injection time (line ~774).
  // Best-effort: scoreRunBlocks swallows errors internally.
  if (finalStatus === 'completed') {
    try {
      const [runRow] = await scopedDb
        .select({ appliedMemoryBlockIds: agentRuns.appliedMemoryBlockIds })
        .from(agentRuns)
        .where(eq(agentRuns.id, run.id))
        .limit(1);
      const appliedBlockIds = runRow?.appliedMemoryBlockIds ?? [];
      if (appliedBlockIds.length > 0) {
        const { scoreRunBlocks } = await import('../../memoryCitationDetector.js');
        const generatedText = typeof loopResult.summary === 'string'
          ? loopResult.summary
          : '';
        await scoreRunBlocks({
          runId: run.id,
          organisationId: request.organisationId,
          appliedBlockIds,
          runOutputText: generatedText,
        });
      }
    } catch (err) {
      logger.warn('agent_runs.block_citation_score_failed', {
        runId: run.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Universal Brief artefact emission hook (Phase 2+).
  // Phase 1 prep only: the import above makes validateArtefactForPersistence
  // available here. Capabilities that produce BriefChatArtefacts will call
  // validateArtefactForPersistence() and persist to conversation_messages
  // once Phase 2 tables are in place.
  void validateArtefactForPersistence; // reference prevents dead-import lint removal

  // H-5: upsert toolCallsLog into the snapshot table
  await scopedDb.insert(agentRunSnapshots)
    .values({ runId: run.id, toolCallsLog: loopResult.toolCallsLog })
    .onConflictDoUpdate({
      target: agentRunSnapshots.runId,
      set: { toolCallsLog: loopResult.toolCallsLog },
    });

  // Sprint 3 P2.1 Sprint 3A — project the legacy toolCallsLog shape
  // from the append-only agent_run_messages log as an observability
  // check. The inline writer above is still the Sprint 3A source of
  // truth; this side call validates that the projection path is
  // consistent so Sprint 3B can drop the inline writer safely.
  //
  // Best-effort: any projection failure is logged and swallowed —
  // it must never block run completion or fail the request.
  try {
    const projected = await projectToolCallsLogFromMessages(run.id, request.organisationId);
    const inlineCount = loopResult.toolCallsLog.length;
    const projectedCount = projected.length;
    if (inlineCount !== projectedCount) {
      logger.warn('agent_run_messages.projection_mismatch', {
        runId: run.id,
        inlineCount,
        projectedCount,
      });
    }
  } catch (err) {
    logger.warn('agent_run_messages.projection_failed', {
      runId: run.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Update lastRunAt on subaccount_agents
  if (request.subaccountAgentId) {
    await scopedDb.update(subaccountAgents).set({
      lastRunAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(subaccountAgents.id, request.subaccountAgentId));
  }

  // Emit run completed event
  emitAgentRunUpdate(run.id, 'agent:run:completed', {
    status: finalStatus, summary: loopResult.summary,
    totalToolCalls: loopResult.totalToolCalls, totalTokens: loopResult.totalTokens,
    tasksCreated: loopResult.tasksCreated, durationMs,
  });

  // Workflows: if this agent run was dispatched by a Workflow step, route
  // its result back to the engine so the step run can be marked completed
  // and the next tick fired. Hook is non-blocking — failures are logged
  // and do not affect the agent run completion.
  try {
    const { notifyWorkflowEngineOnAgentRunComplete } = await import('../../workflowAgentRunHook.js');
    await notifyWorkflowEngineOnAgentRunComplete(run.id, {
      ok: true,
      output: { summary: loopResult.summary ?? '' },
    });
  } catch (err) {
    console.error('[AgentExecution] Workflow hook failed (non-fatal)', err);
  }
  emitSubaccountUpdate(request.subaccountId!, 'live:agent_completed', {
    runId: run.id, agentId: request.agentId, status: finalStatus,
  });

  // ── 10. Extract insights for workspace memory + entities ─────────────
  if (loopResult.summary) {
    try {
      // Hermes Tier 1 Phase B §6.4 — thread the outcome through so
      // extractRunInsights can branch entry-type promotion, quality
      // scoring, and provenance confidence per §6.5 / §6.7. The
      // primary agent-run completion path always passes a non-null
      // `runResultStatus` here (when derivedRunResultStatus is null
      // the run is not terminal and this branch is unreachable).
      // HERMES-S1: thread errorMessage from the pre-finalize DB read so
      // failed-without-throw runs surface the error to extractRunInsights.
      const threadedErrorMessage = derivedRunResultStatus === 'failed'
        ? (preFinalizeRow?.errorMessage ?? null)
        : null;
      if (threadedErrorMessage !== null) {
        tryEmitAgentEvent({
          runId: run.id,
          organisationId: request.organisationId,
          subaccountId: request.subaccountId ?? null,
          sourceService: 'agentExecutionService',
          payload: {
            eventType: 'run.terminal.extracted_with_errorMessage',
            critical: false,
            errorMessageLength: threadedErrorMessage.length,
          },
        });
      }
      const extractionOutcome = {
        runResultStatus: (derivedRunResultStatus ?? 'partial') as 'success' | 'partial' | 'failed',
        trajectoryPassed: null as boolean | null,
        errorMessage: threadedErrorMessage,
      };
      await workspaceMemoryService.extractRunInsights(
        run.id,
        request.agentId,
        request.organisationId,
        request.subaccountId!,
        loopResult.summary,
        extractionOutcome,
      );
    } catch (err) {
      console.error(`[AgentExecution] Memory extraction failed for run ${run.id}:`, err instanceof Error ? err.message : err);
    }

    // Entity extraction (non-blocking)
    workspaceMemoryService.extractEntities(
      run.id,
      request.organisationId,
      request.subaccountId!,
      loopResult.summary
    ).catch(err => {
      console.error(`[AgentExecution] Entity extraction failed for run ${run.id}:`, err instanceof Error ? err.message : err);
    });

    // Phase 2D: Enqueue agent briefing update (non-blocking, pg-boss only)
    import('../../queueService.js').then(({ queueService }) => {
      if ('send' in queueService) {
        (queueService as { send: (q: string, d: object) => Promise<unknown> }).send('agent-briefing-update', {
          organisationId: request.organisationId,
          subaccountId: request.subaccountId,
          agentId: request.agentId,
          runId: run.id,
          handoffJson: { summary: loopResult.summary, status: finalStatus },
        }).catch((err: unknown) => {
          console.error(`[AgentExecution] Briefing job enqueue failed for run ${run.id}:`, err instanceof Error ? err.message : String(err));
        });
      } else {
        // In-memory mode: run briefing update directly (fire-and-forget)
        agentBriefingService.updateAfterRun(
          request.organisationId,
          request.subaccountId!,
          request.agentId,
          run.id,
          { summary: loopResult.summary, status: finalStatus },
        ).catch((err: unknown) => {
          console.error(`[AgentExecution] Briefing update failed for run ${run.id}:`, err instanceof Error ? err.message : String(err));
        });
      }
    }).catch((err: unknown) => {
      // fire-and-forget: dynamic import failure is non-fatal (in-memory mode fallback)
      console.warn('[AgentExecution] Briefing enqueue import failed:', err instanceof Error ? err.message : String(err));
    });
  }

  // ── 11. Fire agent_completed triggers (non-blocking) ─────────────────
  triggerService.checkAndFire(
    request.subaccountId!,
    request.organisationId,
    'agent_completed',
    {
      runId: run.id,
      agentId: request.agentId,
      subaccountAgentId: request.subaccountAgentId,
      status: finalStatus,
    }
  ).catch((err: unknown) => {
    console.error('[AgentExecution] agent_completed trigger failed', {
      subaccountId: request.subaccountId,
      eventType: 'agent_completed',
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return {
    runId: run.id,
    status: finalStatus as AgentRunResult['status'],
    summary: loopResult.summary,
    totalToolCalls: loopResult.totalToolCalls,
    totalTokens: loopResult.totalTokens,
    durationMs,
    tasksCreated: loopResult.tasksCreated,
    tasksUpdated: loopResult.tasksUpdated,
    deliverablesCreated: loopResult.deliverablesCreated,
  };
}

export async function cleanupMcp(
  ctx: RunExecutionContext,
): Promise<void> {
  // ── 12. MCP cleanup (guaranteed) ────────────────────────────────────
  if (ctx.mcpClients?.size) {
    const run = ctx.run!;
    const { mcpClientManager } = await import('../../mcpClientManager.js');
    await mcpClientManager.disconnectAll(ctx.mcpClients).catch((e) => {
      logger.error('mcp.disconnect_failed', { runId: run.id, error: e instanceof Error ? e.message : String(e) });
    });
  }
}
