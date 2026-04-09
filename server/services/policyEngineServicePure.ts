/**
 * policyEngineServicePure — Sprint 3 P2.3 pure helpers
 *
 * Confidence-gate upgrade and decision-time guidance selection are
 * isolated from the DB-bound `policyEngineService` here so they can be
 * unit-tested without Drizzle / the rule cache. The runtime entry points
 * in `policyEngineService.ts` delegate to these helpers.
 *
 * Two responsibilities:
 *
 *   1. `applyConfidenceUpgrade(decision, ctx, defaultThreshold, ruleOverride?)`
 *      — If a first-match rule produced an `auto` decision and the
 *      agent's tool_intent confidence is below the effective threshold
 *      (ruleOverride ?? defaultThreshold), upgrade the decision to
 *      `review`. `block` and `review` are always passed through
 *      unchanged. Missing confidence (null/undefined) counts as
 *      "below threshold" — we fail closed.
 *
 *   2. `selectGuidanceTexts(rules, ctx, matchesRule)` — Walks an
 *      ordered rule list and collects every rule whose `guidanceText`
 *      is non-empty AND which matches the evaluation context.
 *      Returns an array of distinct non-empty strings, preserving
 *      rule-priority order, de-duplicated in case two rules happen to
 *      carry identical text. Used by the decision-time guidance
 *      middleware to inject targeted instructions at tool-call time.
 *
 * Inputs are minimal structural types so the module can be consumed
 * without pulling in the Drizzle schema row type in tests.
 *
 * Contract: docs/improvements-roadmap-spec.md §P2.3.
 */

export type PolicyGateDecision = 'auto' | 'review' | 'block';

/**
 * Minimal context needed for confidence gating and guidance selection.
 * A subset of `PolicyContext` from policyEngineService.ts — we depend
 * only on what the pure helpers actually read.
 */
export interface ConfidenceContext {
  /** Agent's self-reported confidence for the tool call, 0..1. */
  toolIntentConfidence?: number | null;
}

/**
 * Minimal rule shape for `selectGuidanceTexts`. Mirrors the columns we
 * need; kept structural so tests don't have to build a full PolicyRule.
 */
export interface GuidanceRule {
  guidanceText?: string | null;
  [key: string]: unknown;
}

/**
 * Decides whether a tentative `auto` decision should be upgraded to
 * `review` based on the agent's tool_intent confidence.
 *
 * @param decision        The decision chosen by the first-match rule
 *                        loop (or the registry fallback).
 * @param ctx             Confidence context — supplies
 *                        `toolIntentConfidence`.
 * @param defaultThreshold The global `CONFIDENCE_GATE_THRESHOLD` from
 *                        server/config/limits.ts.
 * @param ruleOverride    Per-rule override
 *                        (`policyRules.confidence_threshold`). When
 *                        null / undefined, falls back to
 *                        `defaultThreshold`.
 *
 * Behaviour:
 *   - `block` and `review` are returned unchanged (confidence cannot
 *     down-gate a human-required decision).
 *   - `auto` is upgraded to `review` if confidence is missing or
 *     strictly below the effective threshold.
 *   - `auto` stays `auto` only when confidence ≥ effective threshold.
 */
export function applyConfidenceUpgrade(
  decision: PolicyGateDecision,
  ctx: ConfidenceContext,
  defaultThreshold: number,
  ruleOverride?: number | null,
): { decision: PolicyGateDecision; upgradedByConfidence: boolean; effectiveThreshold: number } {
  const effectiveThreshold =
    ruleOverride !== null && ruleOverride !== undefined ? ruleOverride : defaultThreshold;

  if (decision !== 'auto') {
    return { decision, upgradedByConfidence: false, effectiveThreshold };
  }

  const confidence = ctx.toolIntentConfidence;
  const hasConfidence = typeof confidence === 'number' && Number.isFinite(confidence);

  if (!hasConfidence || (confidence as number) < effectiveThreshold) {
    return { decision: 'review', upgradedByConfidence: true, effectiveThreshold };
  }

  return { decision: 'auto', upgradedByConfidence: false, effectiveThreshold };
}

/**
 * Collects non-empty `guidanceText` values from every rule that
 * matches the given context, preserving rule order and de-duplicating
 * identical strings.
 *
 * @param rules        Rule list in evaluation order (priority ASC).
 * @param ctx          Context passed to the matcher. Opaque to this
 *                     helper — forwarded to `matchesRule`.
 * @param matchesRule  Caller-supplied matcher (dependency-injected so
 *                     tests don't need the real `matchesRule` and the
 *                     runtime doesn't duplicate logic).
 *
 * The decision-time guidance middleware calls this once per tool call
 * and injects the returned strings as `<system-reminder>` blocks.
 */
export function selectGuidanceTexts<TRule extends GuidanceRule, TCtx>(
  rules: readonly TRule[],
  ctx: TCtx,
  matchesRule: (rule: TRule, ctx: TCtx) => boolean,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const rule of rules) {
    const text = rule.guidanceText;
    if (typeof text !== 'string') continue;
    const trimmed = text.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    if (!matchesRule(rule, ctx)) continue;

    seen.add(trimmed);
    out.push(trimmed);
  }

  return out;
}
