/**
 * server/services/runtimeCheckService.ts
 *
 * Impure orchestrator for per-step runtime-check evaluation.
 * Spec: tasks/builds/trust-verification-layer/spec.md §11.1, §11.2, §11.5, §10.4.
 *
 * Contract:
 *   - MUST NEVER throw into the caller — errors resolve to inconclusive.
 *   - Hard timeout: RUNTIME_CHECK_TIMEOUT_MS env var (default 250ms).
 *   - Timeout resolves to inconclusive, never to fail (spec §11.5).
 *   - Idempotent INSERT via ON CONFLICT DO NOTHING on
 *     (run_id, sequence_number, skill_slug, attempt_number).
 *   - All DB writes use getOrgScopedDb — runtime_check_results is FORCE-RLS'd.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { runtimeCheckResults } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import {
  evaluateApiStatus2xx,
  evaluateFieldMatch,
  evaluateExternalReturns,
  evaluateRowExists,
  classifyTimeoutAsInconclusive,
  assertCustomHandlerRegistered,
  type EvalResult,
} from './runtimeCheckServicePure.js';
import type {
  RuntimeCheckKind,
  RuntimeCheckBlastRadius,
  RuntimeCheckState,
} from '../../shared/types/runtimeCheck.js';
import { tryEmitAgentEvent } from './agentExecutionEventEmitter.js';
import { createRuntimeCheckFailItem } from './inboxService.js';

// ---------------------------------------------------------------------------
// Timeout constant
// ---------------------------------------------------------------------------

const RUNTIME_CHECK_TIMEOUT_MS =
  parseInt(process.env['RUNTIME_CHECK_TIMEOUT_MS'] ?? '250', 10) || 250;

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

export interface RuntimeCheckEvaluateInput {
  runId: string;
  eventId?: string | null;
  sequenceNumber: number;
  skillSlug: string;
  attemptNumber?: number;
  organisationId: string;
  subaccountId: string | null;
  checkKind: RuntimeCheckKind | null | undefined;
  toolResult: unknown;
  blastRadius: RuntimeCheckBlastRadius;
  reversible: boolean;
}

// ---------------------------------------------------------------------------
// Core evaluation dispatch
// ---------------------------------------------------------------------------

async function dispatchEvaluation(
  checkKind: RuntimeCheckKind,
  toolResult: unknown,
  sequenceNumber: number,
  skillSlug: string,
): Promise<EvalResult> {
  switch (checkKind.kind) {
    case 'api_status_2xx': {
      // Resolve statusCode from tool result — number or nested object field.
      let statusCode: unknown = toolResult;
      if (typeof toolResult === 'object' && toolResult !== null) {
        const r = toolResult as Record<string, unknown>;
        statusCode = r['statusCode'] ?? r['status'] ?? toolResult;
      }
      return evaluateApiStatus2xx(statusCode as number, checkKind.expectedStatusRange);
    }

    case 'field_match': {
      // Walk the dot-separated outputPath into the tool result.
      const parts = checkKind.outputPath.split('.');
      let value: unknown = toolResult;
      for (const part of parts) {
        if (value == null || typeof value !== 'object') { value = undefined; break; }
        value = (value as Record<string, unknown>)[part];
      }
      return evaluateFieldMatch(value, checkKind.outputPath, checkKind.expectedShape);
    }

    case 'external_returns': {
      return evaluateExternalReturns(toolResult, checkKind.provider, checkKind.expectedField);
    }

    case 'row_exists': {
      // Impure: perform the DB read here. The table name is from the actionRegistry
      // (compile-time configuration). matchKey resolves the lookup value from the
      // tool result. Uses parameterized sql query to protect against injection on
      // the value (the table name comes from trusted registry config).
      const matchValue =
        typeof toolResult === 'object' && toolResult !== null
          ? (toolResult as Record<string, unknown>)[checkKind.matchKey]
          : undefined;

      if (matchValue == null) {
        return evaluateRowExists(false);
      }

      const rows = await getOrgScopedDb('runtimeCheckService.row_exists').execute(
        sql`SELECT 1 FROM ${sql.raw(checkKind.table)} WHERE id = ${String(matchValue)} LIMIT 1`,
      );
      const rowCount = Array.isArray(rows)
        ? rows.length
        : (rows as { rows?: unknown[] }).rows?.length ?? 0;
      return evaluateRowExists(rowCount > 0);
    }

    case 'custom_handler': {
      // assertCustomHandlerRegistered throws a typed shape when not registered.
      // We catch it in the caller and resolve to inconclusive.
      assertCustomHandlerRegistered(checkKind.handlerName);
      // Handler name is registered; no execution bridge wired yet.
      return {
        state: 'inconclusive',
        reasonCode: 'custom_handler_not_executed',
        reasonText: `Custom handler '${checkKind.handlerName}' is registered but no execution bridge is wired yet.`,
      };
    }

    default: {
      const _exhaustive: never = checkKind;
      void _exhaustive;
      return {
        state: 'inconclusive',
        reasonCode: 'unknown_check_kind',
        reasonText: `Unknown check kind encountered at step ${sequenceNumber} for skill '${skillSlug}'.`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Main exported evaluate function
// ---------------------------------------------------------------------------

export async function evaluate(input: RuntimeCheckEvaluateInput): Promise<EvalResult> {
  // No check configured — persist not_applicable and return.
  if (input.checkKind == null) {
    const notApplicable: EvalResult = {
      state: 'not_applicable',
      reasonCode: 'no_check_configured',
      reasonText: `No runtime check configured for skill '${input.skillSlug}'.`,
    };
    await persistAndEmit(input, notApplicable);
    return notApplicable;
  }

  const attemptNumber = input.attemptNumber ?? 1;

  // Timeout guard: resolves to inconclusive after RUNTIME_CHECK_TIMEOUT_MS.
  // Timeout is NOT a failure — per spec §11.5 it is always inconclusive.
  const timeoutResult: EvalResult = classifyTimeoutAsInconclusive(
    input.skillSlug,
    input.sequenceNumber,
  );

  let evalResult: EvalResult;
  try {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), RUNTIME_CHECK_TIMEOUT_MS);

    const checkPromise = dispatchEvaluation(
      input.checkKind,
      input.toolResult,
      input.sequenceNumber,
      input.skillSlug,
    );
    // Swallow late rejections from checkPromise after the timeout wins the race.
    checkPromise.catch(() => { /* race lost — result discarded */ });

    // Timeout resolves (never rejects) to inconclusive on abort.
    const timeoutPromise: Promise<EvalResult> = new Promise((resolve) => {
      controller.signal.addEventListener('abort', () => resolve(timeoutResult), { once: true });
    });

    evalResult = await Promise.race([checkPromise, timeoutPromise]);
    clearTimeout(timeoutHandle);
  } catch (err) {
    // Evaluation error — resolve to inconclusive. Preserve typed error from
    // assertCustomHandlerRegistered if present.
    const errMessage = err instanceof Error ? err.message : String(err);
    logger.warn('runtimeCheckService.evaluation_error', {
      runId: input.runId,
      skillSlug: input.skillSlug,
      sequenceNumber: input.sequenceNumber,
      error: errMessage,
    });

    const typedErr = err as { state?: string; reasonCode?: string; reasonText?: string };
    evalResult = typedErr.state === 'inconclusive' && typedErr.reasonCode
      ? { state: 'inconclusive', reasonCode: typedErr.reasonCode, reasonText: typedErr.reasonText ?? errMessage }
      : { state: 'inconclusive', reasonCode: 'RUNTIME_CHECK_INTERNAL', reasonText: `Internal error: ${errMessage}` };
  }

  await persistAndEmit(input, evalResult, attemptNumber);
  return evalResult;
}

// ---------------------------------------------------------------------------
// Persist + emit + approval gate
// ---------------------------------------------------------------------------

async function persistAndEmit(
  input: RuntimeCheckEvaluateInput,
  evalResult: EvalResult,
  attemptNumber = 1,
): Promise<void> {
  const {
    runId, eventId, sequenceNumber, skillSlug,
    organisationId, subaccountId, blastRadius, reversible,
  } = input;

  const impact: 'blocking' | 'informational' =
    blastRadius === 'external' ? 'blocking' : 'informational';

  try {
    // Idempotent INSERT — ON CONFLICT DO NOTHING prevents duplicate rows on
    // retry. getOrgScopedDb ensures the org GUC is set on the connection,
    // required by FORCE RLS on runtime_check_results.
    await getOrgScopedDb('runtimeCheckService.persistAndEmit')
      .insert(runtimeCheckResults)
      .values({
        organisationId,
        subaccountId,
        runId,
        eventId,
        sequenceNumber,
        skillSlug,
        attemptNumber,
        state: evalResult.state as RuntimeCheckState,
        reasonCode: evalResult.reasonCode,
        reasonText: evalResult.reasonText,
        impact,
        suggestedFix: null,
        blastRadius,
        reversible,
      })
      .onConflictDoNothing();
  } catch (persistErr) {
    logger.warn('runtimeCheckService.persist_failed', {
      runId,
      skillSlug,
      sequenceNumber,
      error: persistErr instanceof Error ? persistErr.message : String(persistErr),
    });
    // Do not rethrow — observational only.
  }

  // Emit runtime_check.completed into agent_execution_events (fire-and-forget).
  tryEmitAgentEvent({
    runId,
    organisationId,
    subaccountId,
    sourceService: 'agentExecutionService',
    payload: {
      eventType: 'runtime_check.completed',
      critical: false,
      runId,
      eventId,
      sequenceNumber,
      skillSlug,
      state: evalResult.state as RuntimeCheckState,
      reasonCode: evalResult.reasonCode,
      reasonText: evalResult.reasonText,
      impact,
      blastRadius,
      reversible,
      suggestedFix: null,
    },
  });

  // Approval gate — external blast radius + fail or inconclusive only.
  // Per spec §11.2: never fires for 'self', 'tenant', or pass/pending/not_applicable.
  // Wraps in its own withOrgTx so the org GUC is set for the FORCE-RLS-checked
  // INSERT into `tasks` (B-1 fix: previously called getOrgScopedDb outside any
  // transaction, which always threw and silently dropped notifications).
  if (
    blastRadius === 'external' &&
    (evalResult.state === 'fail' || evalResult.state === 'inconclusive')
  ) {
    void (async () => {
      try {
        // guard-ignore-next-line: with-org-tx-or-scoped-db reason="fire-and-forget approval gate: must open its own transaction to set GUC before withOrgTx; no ALS context available in this callback"
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`,
          );
          await withOrgTx(
            { tx, organisationId, subaccountId, source: 'runtimeCheckService.inboxNotify' },
            async () => {
              await createRuntimeCheckFailItem({
                runId,
                skillSlug,
                sequenceNumber,
                state: evalResult.state as 'fail' | 'inconclusive',
                reasonText: evalResult.reasonText,
                reasonCode: evalResult.reasonCode,
                organisationId,
                subaccountId,
              });
            },
          );
        });
      } catch (inboxErr) {
        logger.warn('runtimeCheckService.inbox_item_failed', {
          runId,
          skillSlug,
          sequenceNumber,
          error: inboxErr instanceof Error ? inboxErr.message : String(inboxErr),
        });
      }
    })();
  }
}
