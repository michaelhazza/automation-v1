// CRM Query Planner — orchestration layer (spec §3 / §19)
// P1.1: Stage 1 golden path is wired. Stage 2 / Stage 3 throw NotImplementedError.

import { normaliseIntent } from './normaliseIntentPure.js';
import { matchRegistryEntry } from './registryMatcherPure.js';
import { executeCanonical, MissingPermissionError } from './executors/canonicalExecutor.js';
// canonicalQueryRegistry is lazily loaded so tests can inject a stub via deps.registry
// without triggering the drizzle-orm import chain (canonicalQueryRegistry → canonicalDataService → drizzle).
import { normaliseToArtefacts } from './resultNormaliserPure.js';
import { emit } from './plannerEvents.js';
import type { ExecutorContext } from '../../../shared/types/crmQueryPlanner.js';
import type { BriefChatArtefact, BriefCostPreview } from '../../../shared/types/briefResultContract.js';
import { FALLBACK_SUGGESTIONS } from './resultNormaliserPure.js';

// ── NotImplementedError ───────────────────────────────────────────────────────

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunQueryInput {
  rawIntent: string;
  subaccountId: string;
  briefId?: string;
}

export interface RunQueryOutput {
  artefacts: BriefChatArtefact[];
  costPreview: BriefCostPreview;
  stageResolved: 1 | 2 | 3;
  intentHash: string;
}

// Optional dependency injection for testing — production callers omit this.
export interface RunQueryDeps {
  registry?: import('../../../shared/types/crmQueryPlanner.js').CanonicalQueryRegistry;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUnsupportedError(intentHash: string): BriefChatArtefact {
  return {
    artefactId:  `crm-err-${intentHash}`,
    kind:        'error',
    errorCode:   'unsupported_query',
    message:     'This query is not yet supported. Try one of the listed alternatives.',
    suggestions: FALLBACK_SUGGESTIONS,
  };
}

// ── runQuery ──────────────────────────────────────────────────────────────────

export async function runQuery(
  input: RunQueryInput,
  context: ExecutorContext,
  deps: RunQueryDeps = {},
): Promise<RunQueryOutput> {
  const activeRegistry = deps.registry ??
    (await import('./executors/canonicalQueryRegistry.js')).canonicalQueryRegistry;
  const now = new Date().toISOString();
  const envelope = {
    at:           now,
    orgId:        context.orgId,
    subaccountId: context.subaccountId,
    runId:        context.runId,
    briefId:      input.briefId,
  };

  // ── Intent normalisation ──────────────────────────────────────────────────
  const intent = normaliseIntent(input.rawIntent);
  const intentHash = intent.hash;

  // ── Stage 1 — registry matcher ────────────────────────────────────────────
  const stage1Result = matchRegistryEntry(intent, activeRegistry, {
    callerCapabilities: context.callerCapabilities,
  });

  if (stage1Result !== null) {
    await emit({ kind: 'planner.stage1_matched', ...envelope, intentHash, registryKey: stage1Result.registryKey });

    try {
      const execResult = await executeCanonical(stage1Result.plan, context, activeRegistry);

      const { structured, approvalCards } = normaliseToArtefacts(
        stage1Result.plan,
        execResult,
        {
          subaccountId:            context.subaccountId,
          defaultSenderIdentifier: context.defaultSenderIdentifier,
        },
      );

      const artefacts: BriefChatArtefact[] = [structured, ...approvalCards];

      await emit({
        kind:             'planner.result_emitted',
        ...envelope,
        intentHash,
        artefactKind:     'structured',
        rowCount:         execResult.rowCount,
        truncated:        execResult.truncated,
        actualCostCents:  { total: execResult.actualCostCents, stage3: 0, executor: execResult.actualCostCents },
        stageResolved:    1,
      });

      return {
        artefacts,
        costPreview: stage1Result.plan.costPreview,
        stageResolved: 1,
        intentHash,
      };
    } catch (err) {
      if (err instanceof MissingPermissionError) {
        const artefact: BriefChatArtefact = {
          artefactId: `crm-perm-${intentHash}`,
          kind:       'error',
          errorCode:  'missing_permission',
          message:    err.message,
        };
        await emit({ kind: 'planner.error_emitted', ...envelope, intentHash, errorCode: 'missing_permission', stageResolved: 1 });
        return { artefacts: [artefact], costPreview: { predictedCostCents: 0, confidence: 'high', basedOn: 'static_heuristic' }, stageResolved: 1, intentHash };
      }
      throw err;
    }
  }

  // ── Stage 1 miss ──────────────────────────────────────────────────────────
  await emit({ kind: 'planner.stage1_missed', ...envelope, intentHash });

  // P1.1 guard — Stage 2 / Stage 3 not yet wired.
  // Remove this guard in P1.2 and wire the cache read / LLM fallback.
  throw new NotImplementedError(
    'Only Stage 1 is enabled in P1.1 — add this intent to the registry or wait for P1.2',
  );
}
