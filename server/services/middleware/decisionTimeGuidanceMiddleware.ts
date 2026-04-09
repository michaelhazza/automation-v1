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
import { hashToolCall } from './loopDetection.js';
import type { PreToolMiddleware, PreToolResult } from './types.js';

// ---------------------------------------------------------------------------
// In-memory per-run guidance dedup set.
//
// The intent here is "inject each matching guidance block AT MOST ONCE
// per (run, tool call id, guidance fingerprint)". Without this guard,
// the same policy rule would be emitted on every LLM turn where the
// agent tries the same tool with the same input — the injection is
// the thing that forced the retry, so it would repeat indefinitely
// and crowd out other guidance.
//
// Why not use the `preToolDecisions` cache?
//   * `runAgenticLoop` short-circuits the preTool pipeline via
//     `preToolDecisions` only for `block` / `continue` final states.
//     An `inject_message` result is deliberately NOT cached as a
//     PreToolDecision — caching it would stop the second preTool pass
//     (the one after the LLM has read the injected reminder) from
//     actually letting the tool through.
//
// Why a WeakMap keyed on MiddlewareContext?
//   * The ctx object lives exactly as long as the run. WeakMap gives
//     us implicit GC when the run finishes (no stale state across
//     runs), matches the lifetime we want, and avoids a global Map
//     keyed on runId that would leak forever.
//
// Why include the fingerprint in the key?
//   * Two retries of the same toolCallId can legitimately see
//     DIFFERENT guidance — e.g. a rule set changed mid-run, or the
//     tool input was mutated in response to an earlier injection.
//     Keying on (toolCallId, guidanceFingerprint) lets the new
//     guidance fire while still suppressing the exact same block
//     from being repeated.
//
// Resume note: on Sprint 3B resume, `emittedPerCtx` starts empty for
// the rehydrated ctx. This is correct — a resumed run may legitimately
// need the guidance re-emitted at the first tool call, since the
// previous worker's message history already carries the earlier copy
// for the LLM but the new worker's guard set has no memory of it.
// ---------------------------------------------------------------------------

const emittedPerCtx = new WeakMap<object, Set<string>>();

function shouldEmit(ctxKey: object, toolName: string, inputHash: string, fingerprint: string): boolean {
  let set = emittedPerCtx.get(ctxKey);
  if (!set) {
    set = new Set();
    emittedPerCtx.set(ctxKey, set);
  }
  // Key on (toolName, inputHash, fingerprint) — NOT toolCall.id, which
  // changes on every LLM retry and would cause an infinite inject loop.
  // Including inputHash ensures distinct calls to the same tool (e.g.
  // two send_email calls with different recipients) each receive
  // guidance, while retries of the exact same call are suppressed.
  const key = `${toolName}::${inputHash}::${fingerprint}`;
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
    const inputHash = hashToolCall(toolCall.name, toolCall.input);
    if (!shouldEmit(ctx, toolCall.name, inputHash, fingerprint)) {
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
