# Spec Review Final Report — universal-brief

**Spec:** `docs/universal-brief-dev-spec.md`
**Spec commit at start:** `2706df6741a0924f2da78f9a6a6ea343f91d78cb`
**Spec commit at finish:** (uncommitted working-tree edits; +139 / −59 lines)
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`
**Iterations run:** 2 of 5
**Exit condition:** two-consecutive-mechanical-only

## Context freshness

Spec framing (§Framing) explicitly aligns to every axis of `docs/spec-context.md` — pre-production, static-gates-primary, pure-function-only runtime tests, commit-and-revert rollout, no feature flags, prefer existing primitives. No mismatch was logged to `tasks/todo.md`.

## Iteration summary table

| # | Codex findings | Rubric-added | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|---|---|---|---|---|---|---|
| 1 | 12 | 5 (+ 1 self-skipped + 1 cascade) | 17 core (+ 3 cascade/bonus = 20 total edits) | 0 | 0 | 0 | 0 (none needed tasks/todo.md) |
| 2 | 6 | 0 | 6 | 0 | 0 | 0 | 0 |

Two consecutive mechanical-only rounds triggered the early exit per the standard heuristic.

## Mechanical changes applied — by category

### Internal contradictions repaired
- Artefact storage: `conversation_messages.artefactIds` (ID array) → `artefacts` (full-blob JSONB array); §7.2 no-join rewording; §9.7 cascade; §13 entry cascade.
- Precedence algorithm ordering reconciled between §5.3 detailed algorithm and §15.2 risk-mitigation prose (authoritative > scope > priority > recency).
- Phase-2 vs Phase-3 types: `shared/types/briefFastPath.ts` advanced to Phase 2 for types-only; `BriefUiContext` extracted so Phase-2 `createBrief` does not depend on Phase-3 `ChatTriageInput`.
- §6.1 vs §10 shadow-eval execution model: reconciled as inline + soft-breaker fire-and-forget (not pg-boss queued).
- Phase 0 vs §12.2 harness fixture: pinned to a local synthetic fixture; CRM Planner harness adoption moved to Phase 9.
- §1 vs §5.1 vs §8.7 conversation-scope story: schema admits four scopes; Brief/Task/Agent-run-log populate the new tables, Agent scope stays on `agent_conversations`.
- Phase 5 success criteria vs Phase 5 stub: named `ruleConflictDetectorService.check()` no-op in Phase 5, real impl in Phase 6 behind identical signature.
- §7.11 "and `briefArtefactBackstop`" call-site claim struck (backstop is a validator, not a classifier call site).
- §7.10 approval-route corrected from `/api/actions/:actionId/approve` → `/api/review-items/:id/approve` (verified against `server/routes/reviewItems.ts`).

### Missing mechanisms pinned
- Rule `paused_at` column + index + derived `status` helper added (prior spec referenced `status='paused'` without persistence).
- `quality_score numeric(3,2)` column added to 0ZZZ SQL block (prose referenced it; SQL omitted it).
- `isAuthoritative` governance: new permission key `rules.set_authoritative` gating any flip; §4.6 governance note, §6.3.2 flow step 1, §7.8 PATCH check, §9.5 entry, §14.2 annotation.
- `conversation_messages.subaccountId` denormalised column + supplementary subaccount RLS policy + single-writer invariant (`briefConversationWriter`) documented in §5.1.
- Phase-2 `briefs.read` / `briefs.write` permissions (were mis-phased to Phase 5 while the routes shipped in Phase 2).

### Unnamed primitives pinned
- `server/services/briefSimpleReplyGeneratorPure.ts` (Phase 3) — deterministic canned-response generator for `simple_reply` / `cheap_answer`.
- `server/services/briefConversationWriter.ts` (Phase 2) — single write-path into `conversation_messages` + websocket emitter.
- `server/lib/briefVisibility.ts` (Phase 2) — `resolveBriefVisibility` helper.
- `server/services/briefArtefactBackstopPure.ts` (Phase 0) — backstop split into async wrapper + pure module.
- `server/routes/conversations.ts` (Phase 2) — generic conversation-message endpoints for Task / Agent-run-log scopes (§7.12 added).
- `server/lib/__tests__/briefContractTestHarness.example.test.ts` (Phase 0) — synthetic fixture exercising every harness assertion.

### File-inventory drift repaired
- Migration `0TTT_user_settings_suggestion_frequency.sql` (Phase 7) added.
- Existing schema-file edits inventoried in §14.2 (`tasks.ts`, `memoryBlocks.ts`, `agentRuns.ts`, `orgSettings.ts`, `userSettings.ts`).
- `conversations.ts` schema entry annotated as exporting both `conversations` and `conversationMessages`.
- Three new rows added to §10 execution-model table (Brief creation, conversation message persistence, websocket emission).
- Phase 2 "Services introduced" + "Routes introduced" updated to reflect the writer + conversations route.

### Deferred-items accounting tightened
- New Deferred items in §13: system-scoped user-captured rules; `verify-conversation-message-denorm.sh` static gate.
- "System rules" language removed from §9.5 so the contract (`RuleScope = subaccount | agent | org`) is self-consistent.

## Rejected findings

**None.** Every Codex finding across both iterations was real and mechanically fixable; no rejections logged.

## Directional and ambiguous findings (autonomously decided)

**None.** Every finding across both iterations hit a mechanical classification. Zero entries written to `tasks/todo.md` under any `Deferred spec decisions` heading.

## Review logs on disk

- `tasks/review-logs/spec-review-plan-universal-brief-20260422T031749Z.md` — pre-loop plan + context-freshness check
- `tasks/review-logs/spec-review-log-universal-brief-1-20260422T031749Z.md` — iteration 1 adjudication notes
- `tasks/review-logs/spec-review-log-universal-brief-2-20260422T031749Z.md` — iteration 2 adjudication notes
- `tasks/review-logs/_universal-brief-iter1-prompt.txt`, `_universal-brief-iter1-full-input.txt`, `_universal-brief-iter1-codex-output.txt` — Codex iteration 1 raw I/O
- `tasks/review-logs/_universal-brief-iter2-prompt.txt`, `_universal-brief-iter2-full-input.txt`, `_universal-brief-iter2-codex-output.txt` — Codex iteration 2 raw I/O
- `tasks/review-logs/spec-review-final-universal-brief-20260422T031749Z.md` — this file

## Mechanically tight, but verify directionally

The spec is now mechanically tight against the rubric and Codex's best-effort review. Every directional finding that could have surfaced was absent — the spec came in already aligned to the pre-production / no-feature-flags / rapid-evolution framing, so Codex raised only consistency, inventory, and missing-mechanism findings.

The review did NOT re-verify the framing-level product assumptions. Before calling the spec implementation-ready, confirm by re-reading the first ~200 lines (§Framing + §1 Overview + §2 Background):

1. **Scope and phasing still match intent.** This is a ~10–14-week multi-session feature. Confirm the Phase 0–9 sequencing and parallelism still match the product priority you have in mind before any Phase-2 implementation starts.
2. **Hard prerequisites still hold.** The spec lists ClientPulse Phase 4+4.5 + `extractRunInsights()` success-gating as prerequisites. Confirm both are still the right gates.
3. **Artefact contract is stable.** The spec implements the rev-5-locked `shared/types/briefResultContract.ts`. If the contract will evolve during implementation, the `contractVersion` mechanism in §4.1 is the right surface, but contract churn mid-implementation is expensive and should be avoided.
4. **`isAuthoritative` governance is sufficient.** This review closed the "boolean-without-governance" gap by requiring org-admin on set/clear. If the actual intent is that only system admins (not org admins) can set authoritative rules, the permission semantics need tightening before implementation.
5. **The `paused_at` column addition** is the minimum change to reconcile the status vocabulary. If the intent is a richer lifecycle (e.g., time-bound pauses, scheduled resumes), that's a design extension, not a mechanical fix.

**Recommended next step:** spot-check the five items above, then move to `architect` for any Phase-0 implementation plan. The spec does not need another `spec-reviewer` pass — three iterations remain on the lifetime budget (5 − 2 = 3) should a major stakeholder edit land later, but further iterations right now would hit diminishing returns.

---

*End of final report.*
