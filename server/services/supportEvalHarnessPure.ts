// supportEvalHarnessPure.ts — Pure helpers for the Support Agent eval harness.
// Spec: tasks/builds/phase-1-showcase-mvps/spec.md §5.5.1, §5.5.2, §5.5.3, §5.5.4, §7.3
//
// No DB access, no network, no side effects. All decision logic lives here so
// the Bash gate script and the daily job are thin callers only.
//
// INV-16: event type 'phase1.support.eval_drift_detected' is verbatim from shared/types/runTraceEvent.ts

// ---------------------------------------------------------------------------
// Snapshot shape (read from support_eval_runs, passed to gate functions)
// ---------------------------------------------------------------------------

export interface SupportEvalRunSnapshot {
  id: string;
  classificationAccuracyPerIntent: Record<string, number>;
  draftJudgeScoreAvg: number;
  thresholdClassificationMin: number;
  thresholdJudgeMin: number;
  partial: boolean;
  rowCount: number;
}

// ---------------------------------------------------------------------------
// Gate decision
// ---------------------------------------------------------------------------

export type GateVerdict = 'pass' | 'fail' | 'fail_open';

export interface GateResult {
  verdict: GateVerdict;
  reason: string;
}

/**
 * Decide whether the eval gate passes.
 *
 * Rules (spec §7.3):
 * - Fewer than 2 rows → fail_open (regression set unavailable)
 * - Both rows partial → fail_open
 * - Fail ONLY when BOTH rows are below threshold for the SAME metric
 * - Otherwise pass
 */
export function evaluateGateDecision(rows: SupportEvalRunSnapshot[]): GateResult {
  if (rows.length < 2) {
    return {
      verdict: 'fail_open',
      reason: `Fewer than 2 eval rows available (found ${rows.length}); failing open`,
    };
  }

  const [current, previous] = rows;

  if (current.partial) {
    return {
      verdict: 'fail_open',
      reason: 'Most recent eval run is partial; failing open',
    };
  }

  if (previous.partial) {
    return {
      verdict: 'fail_open',
      reason: 'Previous eval run is partial; failing open',
    };
  }

  const classificationFails =
    isClassificationBelowThreshold(current.classificationAccuracyPerIntent, current.thresholdClassificationMin) &&
    isClassificationBelowThreshold(previous.classificationAccuracyPerIntent, previous.thresholdClassificationMin);

  const judgeFails =
    isJudgeScoreBelowThreshold(current.draftJudgeScoreAvg, current.thresholdJudgeMin) &&
    isJudgeScoreBelowThreshold(previous.draftJudgeScoreAvg, previous.thresholdJudgeMin);

  if (classificationFails) {
    return {
      verdict: 'fail',
      reason: 'Classification accuracy below threshold in both recent eval runs',
    };
  }

  if (judgeFails) {
    return {
      verdict: 'fail',
      reason: 'Draft judge score below threshold in both recent eval runs',
    };
  }

  return {
    verdict: 'pass',
    reason: 'Eval thresholds met',
  };
}

// ---------------------------------------------------------------------------
// Threshold check helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the average classification accuracy across all intents
 * is below the given threshold (0.0 – 1.0 scale).
 */
export function isClassificationBelowThreshold(
  accuracy: Record<string, number>,
  threshold: number,
): boolean {
  const values = Object.values(accuracy);
  if (values.length === 0) return true;
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  return avg < threshold;
}

/**
 * Returns true when the judge score average is below the given threshold.
 */
export function isJudgeScoreBelowThreshold(score: number, threshold: number): boolean {
  return score < threshold;
}

// ---------------------------------------------------------------------------
// Drift math
// ---------------------------------------------------------------------------

export interface DriftResult {
  /** current avg classification - previous avg classification; null if classification maps are empty */
  accuracyDelta: number | null;
  /** current draftJudgeScoreAvg - previous draftJudgeScoreAvg */
  judgeScoreDelta: number;
}

function avgAccuracy(accuracy: Record<string, number>): number | null {
  const values = Object.values(accuracy);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compute accuracy and judge-score deltas between two consecutive eval runs.
 * Returns null when previous is null (first run — no baseline to compare against).
 */
export function computeDrift(
  current: SupportEvalRunSnapshot,
  previous: SupportEvalRunSnapshot | null,
): DriftResult | null {
  if (previous === null) {
    return null;
  }

  const currentAvg = avgAccuracy(current.classificationAccuracyPerIntent);
  const previousAvg = avgAccuracy(previous.classificationAccuracyPerIntent);

  const accuracyDelta =
    currentAvg !== null && previousAvg !== null ? currentAvg - previousAvg : null;

  const judgeScoreDelta = current.draftJudgeScoreAvg - previous.draftJudgeScoreAvg;

  return { accuracyDelta, judgeScoreDelta };
}

// ---------------------------------------------------------------------------
// Judge prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the LLM judge prompt used to score a candidate draft reply.
 *
 * The judge prompt asks the model to rate the reply on:
 *   - Accuracy to the ticket intent
 *   - Tone alignment with the voice profile
 *   - Helpfulness for the customer
 *
 * Returns a score from 0.0 to 1.0 embedded in JSON.
 */
export function buildJudgePrompt(
  ticketBody: string,
  draftReply: string,
  intent: string,
  voiceProfile: string,
): string {
  return `You are a quality judge evaluating a support agent's draft reply.

## Customer Ticket
${ticketBody}

## Classified Intent
${intent}

## Voice Profile
${voiceProfile}

## Draft Reply
${draftReply}

## Task
Rate the draft reply on the following criteria (each 0.0–5.0):
1. accuracy: Does it correctly address the customer's intent?
2. tone: Does it match the specified voice profile?
3. helpfulness: Will the customer find this reply useful and complete?

Respond with ONLY valid JSON in this exact shape:
{"accuracy": <float>, "tone": <float>, "helpfulness": <float>, "overall": <float>}

The "overall" score is the average of the three criteria. Use the full 0.0 to 5.0 range. Do not include any other text.`;
}
