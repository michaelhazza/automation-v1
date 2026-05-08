// server/services/scorecardJudgeRunnerPure.ts
// Pure helpers for the scorecard judge runner.
// Trust & Verification Layer spec §12.3.
// All exports are pure: no DB, no network, no filesystem.

import { createHash } from 'crypto';
import type { QualityCheck } from '../db/schema/scorecards.js';

// ── shouldSample ──────────────────────────────────────────────────────────────

// Sampling rates per grading_frequency enum:
//   off  → 0%   (never)
//   q1   → 25%  (1-in-4)
//   q2   → 50%  (1-in-2)
//   q3   → 75%  (3-in-4)
const SAMPLE_THRESHOLD: Record<'off' | 'q1' | 'q2' | 'q3', number> = {
  off: 0,
  q1: 25,
  q2: 50,
  q3: 75,
};

/**
 * Returns true if the (runId, scorecardId) tuple should be graded.
 * Deterministic: the same inputs always produce the same result.
 */
export function shouldSample(
  gradingFrequency: 'off' | 'q1' | 'q2' | 'q3',
  runId: string,
  scorecardId: string,
): boolean {
  const threshold = SAMPLE_THRESHOLD[gradingFrequency];
  if (threshold === 0) return false;
  if (threshold >= 100) return true;
  const hash = createHash('sha256').update(`${runId}:${scorecardId}`).digest();
  // First two bytes → 0-65535. Map to 0-99 for comparison.
  const bucket = ((hash[0]! << 8) | hash[1]!) % 100;
  return bucket < threshold;
}

// ── buildJudgePrompt ──────────────────────────────────────────────────────────

export interface JudgePromptInput {
  scorecardName: string;
  qualityCheckName: string;
  qualityCheckDesc: string | null | undefined;
  runSummary: string;
  agentName: string;
}

/**
 * Builds the LLM judge prompt for a single quality check.
 * Returns strict JSON instruction so the response is always parseable.
 * Opus-escalation decision (spec §9 Chunk 9): few-shot + system prompt ensures
 * the model does not wrap the JSON in markdown fences.
 */
export function buildJudgePrompt(input: JudgePromptInput): { system: string; user: string } {
  const { scorecardName, qualityCheckName, qualityCheckDesc, runSummary, agentName } = input;

  const system = `You are a strict quality evaluator for AI agent runs. Your job is to assess \
whether an agent's output meets a specific quality criterion. You MUST respond with ONLY a JSON \
object — no markdown fences, no preamble, no explanation outside the JSON.

Response format:
{"observedScore": <number from 0.0 to 1.0>, "judgeReasoning": "<one to three sentences>"}

Scoring guide:
0.0 = criterion clearly not met
0.5 = partially met or ambiguous
1.0 = criterion clearly and fully met`;

  const descBlock = qualityCheckDesc ? `\nCriterion description: ${qualityCheckDesc}` : '';
  const user = `Scorecard: ${scorecardName}
Quality criterion: ${qualityCheckName}${descBlock}

Agent name: ${agentName}
Agent run summary:
${runSummary}

Evaluate whether the criterion was met and respond with the JSON object.`;

  return { system, user };
}

// ── computeVerdict ────────────────────────────────────────────────────────────

const DEFAULT_PASS_MARK = 0.7;

/**
 * Maps an observedScore to a verdict.
 * Uses DEFAULT_PASS_MARK (0.7) when no quality-check-level override exists.
 */
export function computeVerdict(
  observedScore: number,
  passMark: number = DEFAULT_PASS_MARK,
): 'pass' | 'fail' | 'inconclusive' {
  if (!Number.isFinite(observedScore) || !Number.isFinite(passMark)) return 'inconclusive';
  if (observedScore < 0 || observedScore > 1) return 'inconclusive';
  return observedScore >= passMark ? 'pass' : 'fail';
}

// ── buildFanoutJobs ───────────────────────────────────────────────────────────

export interface AttachmentWithChecks {
  scorecardId: string;
  gradingFrequency: 'off' | 'q1' | 'q2' | 'q3';
  attachedAt: Date;
  qualityChecks: QualityCheck[];
}

export interface JudgeJobSpec {
  scorecardId: string;
  qualityCheckSlug: string;
}

/**
 * Given a run and its attached scorecards, returns the set of (scorecardId,
 * qualityCheckSlug) jobs to enqueue, applying sampling and the bounded-fanout
 * invariant (spec §12.3 R1 mitigation).
 *
 * maxJobs defaults to JUDGE_MAX_JOBS_PER_RUN (20).
 */
export function buildFanoutJobs(
  runId: string,
  attachments: AttachmentWithChecks[],
  maxJobs: number,
): { jobs: JudgeJobSpec[]; capped: boolean } {
  const sampled = attachments.filter(a =>
    shouldSample(a.gradingFrequency, runId, a.scorecardId) && a.qualityChecks.length > 0
  );

  // Sort by attachedAt for deterministic truncation order; scorecardId as stable tiebreaker
  const sortedSampled = [...sampled].sort((a, b) => {
    const dt = a.attachedAt.getTime() - b.attachedAt.getTime();
    return dt !== 0 ? dt : a.scorecardId.localeCompare(b.scorecardId);
  });

  const all: JudgeJobSpec[] = [];
  for (const attachment of sortedSampled) {
    for (const qc of attachment.qualityChecks) {
      all.push({ scorecardId: attachment.scorecardId, qualityCheckSlug: qc.slug });
    }
  }

  if (all.length <= maxJobs) {
    return { jobs: all, capped: false };
  }

  return { jobs: all.slice(0, maxJobs), capped: true };
}
