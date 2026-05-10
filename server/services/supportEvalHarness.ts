// supportEvalHarness.ts — Support Agent eval harness service.
// Spec: tasks/builds/phase-1-showcase-mvps/spec.md §5.5.1, §5.5.2, §5.5.3, §5.5.4
//
// Loads a regression fixture set, runs classify + judge scoring per ticket,
// accumulates accuracy and judge scores, inserts a support_eval_runs row, and
// emits phase1.support.eval_drift_detected (via logger.warn) if drift detected.
//
// For MVP: hardcoded 5-ticket fixture set (Foundry refresh is Phase 1.5).
// LLM calls use routeCall via the system sourceType path.
// partial=true if any LLM call fails.
//
// INV-16: event type verbatim from shared/types/runTraceEvent.ts

import { eq, desc } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { supportEvalRuns } from '../db/schema/supportEvalRuns.js';
import { routeCall } from './llmRouter.js';
import { logger } from '../lib/logger.js';
import {
  buildJudgePrompt,
  computeDrift,
  type SupportEvalRunSnapshot,
} from './supportEvalHarnessPure.js';
import {
  buildClassifyPrompt,
  buildSentinelResult,
} from './skillHandlers/supportClassifyTicketPure.js';
import { SupportClassifyTicketResultSchema } from '../../shared/types/supportClassifyTicketResult.js';

// ---------------------------------------------------------------------------
// Hardcoded fixture set (MVP — Foundry refresh in Phase 1.5)
// ---------------------------------------------------------------------------

interface EvalFixture {
  ticketId: string;
  ticketSubject: string;
  latestMessage: string;
  expectedIntent: string;
  voiceProfile: string;
}

const EVAL_FIXTURES: EvalFixture[] = [
  {
    ticketId: 'fixture-001',
    ticketSubject: 'Billing charge I did not authorise',
    latestMessage: 'I see a charge on my account that I did not make. Please refund it immediately.',
    expectedIntent: 'billing',
    voiceProfile: 'Professional, empathetic, solution-oriented.',
  },
  {
    ticketId: 'fixture-002',
    ticketSubject: 'Cannot log in to my account',
    latestMessage: 'My password reset email never arrived. I have checked spam.',
    expectedIntent: 'account_access',
    voiceProfile: 'Professional, empathetic, solution-oriented.',
  },
  {
    ticketId: 'fixture-003',
    ticketSubject: 'Where is my shipment?',
    latestMessage: 'My order was placed 10 days ago and tracking shows it has not moved in 5 days.',
    expectedIntent: 'shipping',
    voiceProfile: 'Professional, empathetic, solution-oriented.',
  },
  {
    ticketId: 'fixture-004',
    ticketSubject: 'How do I cancel my subscription?',
    latestMessage: 'I want to cancel before my next renewal date. What is the process?',
    expectedIntent: 'cancellation',
    voiceProfile: 'Professional, empathetic, solution-oriented.',
  },
  {
    ticketId: 'fixture-005',
    ticketSubject: 'Product arrived damaged',
    latestMessage: 'The item was broken when I opened the box. I have photos.',
    expectedIntent: 'returns',
    voiceProfile: 'Professional, empathetic, solution-oriented.',
  },
];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const THRESHOLD_CLASSIFICATION_MIN = 0.85;
const THRESHOLD_JUDGE_MIN = 4.0; // 0–5 scale per spec §5.5.2 ("initial threshold: >= 4.0 / 5.0")
const PROMPT_VERSION = 1;
const MODEL_ID = 'claude-sonnet-4-5';
const DRIFT_ACCURACY_ALERT_THRESHOLD = 0.10; // >10% drop triggers emit
const DRIFT_JUDGE_ALERT_THRESHOLD = 0.10;

// ---------------------------------------------------------------------------
// runOnce — main entry point
// ---------------------------------------------------------------------------

export async function runOnce(organisationId: string): Promise<{ evalRunId: string; partial: boolean }> {
  logger.info('support.eval_harness.started', { organisationId });

  let partial = false;
  const classificationResultsByIntent: Record<string, { correct: number; total: number }> = {};
  const judgeScores: number[] = [];

  for (const fixture of EVAL_FIXTURES) {
    // -- Classify step --
    let detectedIntent: string;
    try {
      const { system, user } = buildClassifyPrompt(
        fixture.ticketSubject,
        fixture.latestMessage,
        [],
      );
      const classifyResponse = await routeCall({
        messages: [{ role: 'user', content: user }],
        system,
        context: {
          organisationId,
          sourceType: 'system',
          taskType: 'general',
          executionPhase: 'execution',
          routingMode: 'ceiling',
          featureTag: 'support-eval-classify',
        },
      });
      const rawContent = classifyResponse.content ?? '{}';
      const parsed = SupportClassifyTicketResultSchema.safeParse(JSON.parse(rawContent));
      detectedIntent = parsed.success ? parsed.data.intent : buildSentinelResult('parse_failure').intent;
    } catch {
      partial = true;
      detectedIntent = buildSentinelResult('llm_error').intent;
    }

    const intent = fixture.expectedIntent;
    if (!classificationResultsByIntent[intent]) {
      classificationResultsByIntent[intent] = { correct: 0, total: 0 };
    }
    classificationResultsByIntent[intent].total += 1;
    if (detectedIntent === intent) {
      classificationResultsByIntent[intent].correct += 1;
    }

    // -- Judge scoring step --
    try {
      const judgePrompt = buildJudgePrompt(
        `${fixture.ticketSubject}\n${fixture.latestMessage}`,
        `[Simulated reply for intent: ${intent}]`,
        intent,
        fixture.voiceProfile,
      );
      const judgeResponse = await routeCall({
        messages: [{ role: 'user', content: judgePrompt }],
        context: {
          organisationId,
          sourceType: 'system',
          taskType: 'general',
          executionPhase: 'execution',
          routingMode: 'ceiling',
          featureTag: 'support-eval-judge',
        },
      });
      const judgeJson = JSON.parse(judgeResponse.content ?? '{"overall": 0}') as { overall?: number };
      const overallScore = typeof judgeJson.overall === 'number' ? judgeJson.overall : 0;
      judgeScores.push(Math.max(0, Math.min(5, overallScore))); // 0–5 scale per spec §5.5.2
    } catch {
      partial = true;
      judgeScores.push(0);
    }
  }

  // Build accuracy-per-intent map (0.0 – 1.0)
  const classificationAccuracyPerIntent: Record<string, number> = {};
  for (const [intent, { correct, total }] of Object.entries(classificationResultsByIntent)) {
    classificationAccuracyPerIntent[intent] = total > 0 ? correct / total : 0;
  }

  const draftJudgeScoreAvg =
    judgeScores.length > 0
      ? judgeScores.reduce((sum, s) => sum + s, 0) / judgeScores.length
      : 0;

  // Fetch the most-recent previous row BEFORE inserting so the query cannot
  // race with a concurrent admin trigger that also calls runOnce.
  // Both reads and writes go through the org-scoped tx (set up by createWorker
  // for the daily job, or the orgScoping middleware for the admin route) so
  // FORCE RLS on support_eval_runs evaluates correctly.
  const orgDb = getOrgScopedDb('supportEvalHarness.runOnce');
  const [previousRow] = await orgDb
    .select()
    .from(supportEvalRuns)
    .where(eq(supportEvalRuns.organisationId, organisationId))
    .orderBy(desc(supportEvalRuns.runAt))
    .limit(1);

  const [inserted] = await orgDb
    .insert(supportEvalRuns)
    .values({
      organisationId,
      classificationAccuracyPerIntent,
      draftJudgeScoreAvg: String(draftJudgeScoreAvg.toFixed(2)),
      thresholdClassificationMin: String(THRESHOLD_CLASSIFICATION_MIN.toFixed(2)),
      thresholdJudgeMin: String(THRESHOLD_JUDGE_MIN.toFixed(2)),
      promptVersion: PROMPT_VERSION,
      modelId: MODEL_ID,
      skillTemplateHashes: {},
      rowCount: EVAL_FIXTURES.length,
      partial,
    })
    .returning({ id: supportEvalRuns.id });

  const evalRunId = inserted.id;

  logger.info('support.eval_harness.run_inserted', {
    organisationId,
    evalRunId,
    partial,
    draftJudgeScoreAvg,
    classificationAccuracyPerIntent,
  });

  await detectAndEmitDrift(organisationId, evalRunId, classificationAccuracyPerIntent, draftJudgeScoreAvg, partial, previousRow ?? null);

  return { evalRunId, partial };
}

// ---------------------------------------------------------------------------
// listLatest — read surface for admin route
// ---------------------------------------------------------------------------

export async function listLatest(
  organisationId: string,
  limit = 5,
): Promise<typeof supportEvalRuns.$inferSelect[]> {
  const orgDb = getOrgScopedDb('supportEvalHarness.listLatest');
  return orgDb
    .select()
    .from(supportEvalRuns)
    .where(eq(supportEvalRuns.organisationId, organisationId))
    .orderBy(desc(supportEvalRuns.runAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Internal: drift detection + event emission
// ---------------------------------------------------------------------------

async function detectAndEmitDrift(
  organisationId: string,
  currentEvalRunId: string,
  classificationAccuracyPerIntent: Record<string, number>,
  draftJudgeScoreAvg: number,
  currentPartial: boolean,
  previousRow: typeof supportEvalRuns.$inferSelect | null,
): Promise<void> {
  if (previousRow === null) {
    return;
  }

  const currentSnapshot: SupportEvalRunSnapshot = {
    id: currentEvalRunId,
    classificationAccuracyPerIntent,
    draftJudgeScoreAvg,
    thresholdClassificationMin: THRESHOLD_CLASSIFICATION_MIN,
    thresholdJudgeMin: THRESHOLD_JUDGE_MIN,
    partial: currentPartial,
    rowCount: EVAL_FIXTURES.length,
  };

  const previousSnapshot: SupportEvalRunSnapshot = {
    id: previousRow.id,
    classificationAccuracyPerIntent: previousRow.classificationAccuracyPerIntent as Record<string, number>,
    draftJudgeScoreAvg: Number(previousRow.draftJudgeScoreAvg),
    thresholdClassificationMin: THRESHOLD_CLASSIFICATION_MIN,
    thresholdJudgeMin: THRESHOLD_JUDGE_MIN,
    partial: previousRow.partial,
    rowCount: previousRow.rowCount,
  };

  const drift = computeDrift(currentSnapshot, previousSnapshot);

  if (drift === null) {
    return;
  }

  const accuracyDropped =
    drift.accuracyDelta !== null && drift.accuracyDelta < -DRIFT_ACCURACY_ALERT_THRESHOLD;
  const judgeDropped = drift.judgeScoreDelta < -DRIFT_JUDGE_ALERT_THRESHOLD;

  if (accuracyDropped || judgeDropped) {
    // INV-16: event type verbatim from shared/types/runTraceEvent.ts
    logger.warn('phase1.support.eval_drift_detected', {
      organisationId,
      evalRunId: currentEvalRunId,
      accuracyDelta: drift.accuracyDelta,
      judgeScoreDelta: drift.judgeScoreDelta,
      accuracyThreshold: DRIFT_ACCURACY_ALERT_THRESHOLD,
      judgeThreshold: DRIFT_JUDGE_ALERT_THRESHOLD,
    });
  }
}
