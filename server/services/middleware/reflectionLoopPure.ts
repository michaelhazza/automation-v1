/**
 * reflectionLoopPure — Sprint 3 P2.2 deterministic reflection loop helpers.
 *
 * The `review_code` methodology skill (`server/skills/review_code.md`)
 * produces a verdict line (`APPROVE` | `BLOCKED`) at the end of its output.
 * Today that verdict is prompt-only: a model that ignores the self-review
 * step faces no consequence. This module extracts the verdict
 * deterministically so the `reflectionLoopMiddleware` in the postTool
 * pipeline can enforce the "no write_patch without APPROVE" contract and
 * escalate to HITL after `MAX_REFLECTION_ITERATIONS` (`server/config/limits.ts`)
 * failed attempts.
 *
 * Kept pure (no DB, no env, no clock) so it can be unit-tested without
 * booting Postgres — mandatory under the `verify-pure-helper-convention`
 * gate.
 */

export type ReviewCodeVerdict = 'APPROVE' | 'BLOCKED';

/**
 * Extract the verdict from a `review_code` methodology output string.
 * Returns `null` when the output does not contain a parseable verdict
 * line (malformed, missing, or the skill didn't finish).
 *
 * Matching rules:
 *   - Search the LAST occurrence of "Verdict" in the output, followed by
 *     any whitespace/punctuation, followed by `APPROVE` or `BLOCKED`.
 *   - Matching is case-insensitive on the verdict keyword so `approve`,
 *     `Approved`, and `APPROVE.` all resolve to `'APPROVE'`.
 *   - When both verdicts appear (e.g. a BLOCKED section followed by a
 *     final APPROVE verdict) the LAST verdict wins. This matches how a
 *     reviewer would read the output.
 */
export function parseVerdict(output: string): ReviewCodeVerdict | null {
  if (typeof output !== 'string' || output.length === 0) return null;

  // Search the full string for any "Verdict ... (APPROVE|BLOCKED)" match.
  // The `g` flag + lastIndexOf semantics gives us the final verdict when
  // the output contains multiple candidates.
  const pattern = /verdict[\s:*_\-]*?\b(approve|blocked)\b/gi;
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = pattern.exec(output)) !== null) {
    last = match;
  }
  if (!last) return null;

  const verdict = last[1].toUpperCase();
  if (verdict === 'APPROVE' || verdict === 'BLOCKED') {
    return verdict;
  }
  return null;
}

/**
 * Input shape for `decideReflectionAction`. Keeps the signature narrow so
 * the middleware wrapper only has to project `MiddlewareContext` fields —
 * no DB or config state leaks into the pure logic.
 */
export interface ReflectionDecisionInput {
  /** Tool name that just finished executing. */
  toolName: string;
  /** String content of the tool result (methodology skills return strings). */
  toolResult: string;
  /** Current count of `review_code` invocations seen so far on this run. */
  reviewCodeIterations: number;
  /** Last parsed verdict from the most recent `review_code` call. */
  lastReviewCodeVerdict: ReviewCodeVerdict | null;
  /** Platform ceiling from `limits.MAX_REFLECTION_ITERATIONS`. */
  maxReflectionIterations: number;
}

/**
 * Output shape for `decideReflectionAction`. The `state` delta is applied
 * to the `MiddlewareContext` by the impure middleware wrapper AFTER the
 * decision is made, so the pure helper is the single source of truth for
 * both "what to do next" and "how the context changes".
 */
export interface ReflectionDecisionOutput {
  action:
    | { kind: 'continue' }
    | { kind: 'inject_message'; message: string }
    | { kind: 'escalate_to_review'; reason: string };
  stateDelta: {
    /** Updated verdict tracker — `undefined` means "do not write". */
    lastReviewCodeVerdict?: ReviewCodeVerdict | null;
    /** Updated iteration counter — `undefined` means "do not write". */
    reviewCodeIterations?: number;
  };
}

/**
 * Decide what the reflection loop should do next given the current run
 * state and the tool call that just completed. Pure and deterministic.
 *
 * Decision rules:
 *   1. `review_code` completed:
 *      a. Parse the verdict and update the state delta.
 *      b. If APPROVE → continue. The next write_patch will pass.
 *      c. If BLOCKED and iterations < max → inject_message, loop again.
 *      d. If BLOCKED and iterations >= max → escalate_to_review.
 *      e. If verdict unparseable → treat as BLOCKED for safety (same
 *         thresholds apply).
 *   2. `write_patch` (or `create_pr`) fired without a preceding APPROVE
 *      verdict → inject_message reminding the agent to run review_code
 *      first. This does NOT increment the iteration counter because the
 *      agent has not actually attempted reflection yet.
 *   3. Any other tool → continue with no state change.
 */
export function decideReflectionAction(
  input: ReflectionDecisionInput,
): ReflectionDecisionOutput {
  const {
    toolName,
    toolResult,
    reviewCodeIterations,
    lastReviewCodeVerdict,
    maxReflectionIterations,
  } = input;

  // ── 1. review_code completed ─────────────────────────────────────────
  if (toolName === 'review_code') {
    const parsed = parseVerdict(toolResult);
    // Unparseable is conservatively treated as BLOCKED so a model that
    // returns malformed output still hits the max-iterations ceiling.
    const effectiveVerdict: ReviewCodeVerdict = parsed ?? 'BLOCKED';
    const nextCount = reviewCodeIterations + 1;

    if (effectiveVerdict === 'APPROVE') {
      return {
        action: { kind: 'continue' },
        stateDelta: {
          lastReviewCodeVerdict: 'APPROVE',
          reviewCodeIterations: nextCount,
        },
      };
    }

    // BLOCKED path
    if (nextCount >= maxReflectionIterations) {
      return {
        action: {
          kind: 'escalate_to_review',
          reason: 'reflection_iterations_exhausted',
        },
        stateDelta: {
          lastReviewCodeVerdict: 'BLOCKED',
          reviewCodeIterations: nextCount,
        },
      };
    }

    return {
      action: {
        kind: 'inject_message',
        message:
          `Self-review verdict: BLOCKED ` +
          `(iteration ${nextCount}/${maxReflectionIterations}). ` +
          `Address the blocking issues from review_code before invoking ` +
          `write_patch.`,
      },
      stateDelta: {
        lastReviewCodeVerdict: 'BLOCKED',
        reviewCodeIterations: nextCount,
      },
    };
  }

  // ── 2. write_patch without APPROVE ────────────────────────────────────
  // write_patch requires an APPROVE verdict, then CONSUMES it so the next
  // write_patch in the same run must earn a fresh review. create_pr does
  // NOT require its own approval — it opens a PR for the patch that was
  // just approved + applied, and runs immediately after write_patch in
  // the normal flow.
  if (toolName === 'write_patch') {
    if (lastReviewCodeVerdict !== 'APPROVE') {
      return {
        action: {
          kind: 'inject_message',
          message:
            `Cannot submit a patch without an APPROVE verdict from ` +
            `review_code. Run review_code on your changes first, then ` +
            `re-invoke write_patch after the verdict resolves to APPROVE.`,
        },
        stateDelta: {},
      };
    }
    // Consume the approval so subsequent write_patch calls require a
    // fresh review_code pass. Without this, a single APPROVE would
    // greenlight all further patches in the same run.
    return {
      action: { kind: 'continue' },
      stateDelta: { lastReviewCodeVerdict: null },
    };
  }

  // ── 3. Default: continue ─────────────────────────────────────────────
  return { action: { kind: 'continue' }, stateDelta: {} };
}
