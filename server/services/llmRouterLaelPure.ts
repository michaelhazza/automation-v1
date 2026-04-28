// Pure LAEL lifecycle helpers for llmRouter — no DB, no env, no side effects.
// Extracted so the gating predicate is unit-testable without booting the
// env-dependent router module. §1.1 LAEL-P1-1.

/**
 * Returns true only when all three conditions hold:
 *   1. The call is from an agent run (sourceType === 'agent_run').
 *   2. A runId is present (non-null, non-undefined, non-empty).
 *   3. The terminal status is NOT one of the pre-dispatch blocked states
 *      (budget_blocked, rate_limited, provider_not_configured) — those states
 *      short-circuit before provider dispatch, so there is no provider call
 *      to observe with llm.requested / llm.completed events.
 */
export function shouldEmitLaelLifecycle(
  ctx: { sourceType: string; runId?: string | null },
  terminalStatus: string,
): boolean {
  if (ctx.sourceType !== 'agent_run') return false;
  if (!ctx.runId) return false;
  if (
    terminalStatus === 'budget_blocked' ||
    terminalStatus === 'rate_limited' ||
    terminalStatus === 'provider_not_configured'
  ) {
    return false;
  }
  return true;
}
