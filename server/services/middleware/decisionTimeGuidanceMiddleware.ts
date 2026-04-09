/**
 * decisionTimeGuidanceMiddleware — Sprint 3 P2.3
 *
 * Injects situational `guidance_text` from matching `policy_rules`
 * rows as a `<system-reminder>` block at the moment a tool is about
 * to be called. This replaces the "front-load every instruction
 * into the master prompt" anti-pattern with targeted, context-aware
 * guidance — a rule for sensitive emails only fires when a
 * sensitive email is being sent, not on every turn.
 *
 * Pipeline position: this middleware runs in the `preTool` phase,
 * AFTER `proposeActionMiddleware`. That ordering is intentional:
 *
 *   1. proposeActionMiddleware decides whether the call is allowed.
 *      A blocked call must NOT trigger a guidance injection — it
 *      would be injected into the history of a dead conversation.
 *   2. If the call is continuing, this middleware runs, collects
 *      every matching rule's non-empty guidance_text, and returns
 *      `inject_message` so `runAgenticLoop` appends a user-role
 *      reminder before the LLM re-runs (cycle: LLM → preTool →
 *      inject → LLM → preTool → continue → tool execution).
 *
 * The rule cache inside `policyEngineService` is shared with
 * `evaluatePolicy`, so this adds no DB load on the hot path (same
 * org hit within 60 s reuses the cached rule list).
 *
 * No decision, no side effects on mwCtx. The middleware is idempotent
 * per tool call — runAgenticLoop already short-circuits the preTool
 * pipeline on cached decisions, so a replayed tool call will see the
 * same guidance exactly once.
 *
 * Contract: docs/improvements-roadmap-spec.md §P2.3.
 */

import { policyEngineService } from '../policyEngineService.js';
import type { PreToolMiddleware, PreToolResult } from './types.js';

// ---------------------------------------------------------------------------
// In-memory per-run guidance dedup set.
//
// `runAgenticLoop` already short-circuits the preTool pipeline via
// `preToolDecisions` cache, but that only helps for `block` / `continue`
// final states. An `inject_message` result is NOT cached as a
// PreToolDecision (that would defeat the reason for injecting it again
// on the next LLM turn). To prevent this middleware from injecting the
// same guidance block on every LLM turn after an injection, we track
// which (toolCallId, guidanceFingerprint) tuples we've already emitted
// on this ctx's run via a WeakMap keyed by MiddlewareContext itself.
// ---------------------------------------------------------------------------

const emittedPerCtx = new WeakMap<object, Set<string>>();

function shouldEmit(ctxKey: object, toolCallId: string, fingerprint: string): boolean {
  let set = emittedPerCtx.get(ctxKey);
  if (!set) {
    set = new Set();
    emittedPerCtx.set(ctxKey, set);
  }
  const key = `${toolCallId}::${fingerprint}`;
  if (set.has(key)) return false;
  set.add(key);
  return true;
}

export const decisionTimeGuidanceMiddleware: PreToolMiddleware = {
  name: 'decision_time_guidance',
  async execute(ctx, toolCall): Promise<PreToolResult> {
    // Subaccount must be resolved for policy rule matching. Org-level
    // runs without a subaccount fall through without injecting
    // anything — guidance rules today are subaccount-scoped or
    // org-wide (null subaccountId), and the current schema always
    // fills in subaccountId for runs that hit tool calls. Guard
    // defensively regardless.
    const subaccountId = ctx.request.subaccountId ?? null;
    if (!subaccountId) {
      return { action: 'continue' };
    }

    const guidance = await policyEngineService.getDecisionTimeGuidance({
      toolSlug: toolCall.name,
      subaccountId,
      organisationId: ctx.request.organisationId,
      input: toolCall.input,
    });

    if (guidance.length === 0) {
      return { action: 'continue' };
    }

    const fingerprint = guidance.join('\u0000');
    if (!shouldEmit(ctx, toolCall.id, fingerprint)) {
      return { action: 'continue' };
    }

    const block = [
      '<system-reminder>',
      'Decision-time guidance from policy rules (matched for this tool call):',
      '',
      ...guidance.map((g, i) => `${i + 1}. ${g}`),
      '',
      'Re-evaluate your tool call against this guidance before proceeding.',
      '</system-reminder>',
    ].join('\n');

    return { action: 'inject_message', message: block };
  },
};
