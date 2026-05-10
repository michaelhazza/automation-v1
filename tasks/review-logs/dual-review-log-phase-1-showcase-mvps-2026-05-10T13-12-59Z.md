# Dual Review Log — phase-1-showcase-mvps

**Files reviewed:** integrated branch `feat/phase-1-showcase-mvps` (Phase 1 Showcase MVPs — 42 Macro production hardening + run-artifact pipeline + Support Agent; 122 files / +12k LOC at the head of the branch; recent commits at `bc59aebe`, `a86d4caf`, `6061c6fd`, `910236f0`).
**Iterations run:** 3/3
**Timestamp:** 2026-05-10T13:12:59Z
**Commit at finish:** d3026f98

---

## Iteration 1

Codex reviewed against `main`. Five findings raised.

### [ACCEPT] server/services/supportAgentExecutionService.ts:507-509 — Honor non-draft classifier actions (P1)
**Reason:** The classifier returns `recommended_action ∈ {draft_reply, escalate_to_human, add_internal_note_only, close_as_no_action}` per `shared/types/supportClassifyTicketResult.ts`, but `executeTicketPipeline` only gates on `confidence` and ignores the explicit recommendation. In autonomous mode this drafts and dispatches a customer-facing reply for tickets the classifier explicitly said NOT to reply to. Spec §5.4.1 + §5.3.4 ("Per-ticket terminal verdicts") show the expected mapping: `escalate_to_human` → `escalated_to_human`; the other two non-draft cases → `skipped_no_action_needed`. Fix added a Step 4b branch that emits `phase1.support.ticket_terminal` with the correct verdict for non-`draft_reply` recommendations and a `phase1.support.escalation_action_pending` warn-log for the actions whose handlers do not yet exist (parallel to existing low-confidence path).

### [ACCEPT] server/services/supportEvalHarness.ts:47 — Use classifier enum values in eval fixtures (P1)
**Reason:** All five fixtures used informal intent strings (`billing`, `account_access`, `shipping`, `cancellation`, `returns`) but `SupportIntentSchema` permits only `billing_question`, `account_question`, `how_to_question`, `cancellation_request`, `complaint`, etc. Even a perfect classifier could never match — per-intent accuracy is permanently 0, the eval gate fails after two runs. Fix mapped each fixture to the closest enum value (`billing_question`, `account_question`, `how_to_question`, `cancellation_request`, `complaint`) with comments noting that future enum extensions could add dedicated `shipping_question` / `return_request` values.

### [ACCEPT] server/jobs/runArtifactsRetentionSweepJob.ts:121-122 — Stop the retention loop when deletes make no progress (P2)
**Reason:** Existing exit condition is `page.length < PAGE_SIZE`. If S3 is unavailable for a full page, every artifact's S3 delete fails (continue), no DB delete fires, `page.length` stays at `PAGE_SIZE`, and the next iteration re-reads the same 100 rows forever within a single tick. Real outage scenario hangs the worker. Fix tracked `pageDeleted` per page; if a full page yields zero DB deletes, set `pageExhausted = true` and warn-log. The next scheduled tick retries naturally.

### [ACCEPT] server/routes/agentRuns.ts:663 — Gate artifact listing with run visibility (P2)
**Reason:** `/api/agent-runs/:runId/artifacts` only required org-level `AGENTS_VIEW`, but `/api/run-artifacts/:id/download` and `/api/run-artifacts/:id/signed-url` additionally call `resolveAgentRunVisibility`. For system-managed runs hidden by the resolver, a user with org `AGENTS_VIEW` could still enumerate artifact IDs, display names, hashes, sizes — same surface as the gated routes. Fix added the same `resolveAgentRunVisibility` gate at the list endpoint, reusing the proven pattern from `runArtifacts.ts:106-114` (system-tier detection via `agents.system_agent_id` FK lookup).

### [REJECT] server/jobs/supportAgentRunJob.ts:73-78 — Wire a producer for support-agent-run jobs (P1)
**Reason:** The finding is real and important — there is no producer for the `support-agent-run` queue, so `enqueueSupportAgentRun` is never called from any schedule, webhook, or install path. The Support Agent is functionally idle in production despite worker registration. However: (1) this is already tracked as a deferred item (`tasks/todo.md` REQ #40); (2) `spec-conformance` marked it PASS prematurely on the basis that the worker is registered, missing that registration alone does not produce jobs; (3) the proper fix is a multi-file architectural change with design decisions about WHERE the dispatch hook lives — extend the existing `agent-scheduled-run` handler to dispatch by `applied_template_slug`, OR add a separate scheduler that iterates active installs, OR wire the Teamwork webhook adapter; this is not a small surgical fix. Surfacing the real gap belongs in a follow-up architectural decision, not a dual-reviewer pass. The deferred item REQ #40 in `tasks/todo.md` already exists; future work should reopen it with the clarification that "registration is wired; producer is not".

---

## Iteration 2

Codex reviewed `--uncommitted` (the four iteration-1 fixes). One finding raised. Codex stated explicitly: "TypeScript changes typecheck successfully and I did not find a discrete code correctness issue".

### [ACCEPT] .codex-review-tmp/iter1.txt:1-1 — Remove generated Codex transcript files (P2)
**Reason:** The temp directory `.codex-review-tmp/` was created during this run to work around a tool-path constraint and contains ~900KB of raw Codex session transcripts. Real risk — if committed accidentally they leak workspace paths and prompt content. Removed the directory entirely. Not adding to `.gitignore` because the directory is ephemeral to dual-reviewer sessions and not a recurring artifact.

---

## Iteration 3

Codex reviewed `--uncommitted` (cleanup applied). One finding raised against the iteration-1 fix to `supportAgentExecutionService.ts`.

### [REJECT-REWORK] server/services/supportAgentExecutionService.ts:519-522 — Preserve add-note recommendations instead of marking skipped (P2)
**Reason:** Codex correctly identified that the iteration-1 fix's catch-all `skipped_no_action_needed` for both `add_internal_note_only` and `close_as_no_action` loses the action signal — once the terminal event fires, the outer-loop predicate filters the ticket and the requested internal note is never created. However, reverting the fix returns to the prior bug (drafts a customer-facing reply when classifier said don't), which is strictly worse. The right adjustment is to preserve the fix's terminal-event behaviour but signal the deferred action via the existing `phase1.support.escalation_action_pending` warn-log pattern that the codebase already uses for low-confidence + skill-error escalation paths. Reworked the iteration-1 fix to:
  - Keep the terminal event for both branches (prevents customer-reply regression and prevents re-classify-and-skip loop on next ticks for the same customer message).
  - Emit `phase1.support.escalation_action_pending` for both `escalate_to_human` (existing pending actions: add_internal_note + assign) AND `add_internal_note_only` (new pending action: add_internal_note).
  - Skip the warn-log only for `close_as_no_action` (no side-effect skill required by spec semantics).
  - Updated `tasks/todo.md` PR-S6 to enumerate the four branches that need the action handlers wired in Phase 1.5 (low-confidence, skill-error, escalate_to_human, add_internal_note_only).

So the iter3 finding led to an in-place rework of the iter1 fix — net result is a strictly better outcome than either alternative Codex proposed.

---

## Changes Made

- `server/services/supportAgentExecutionService.ts` — added Step 4b branch that emits `phase1.support.ticket_terminal` for non-`draft_reply` recommended_actions, with `phase1.support.escalation_action_pending` warn-logs for the cases whose action skills are not yet implemented.
- `server/services/supportEvalHarness.ts` — corrected 5 fixture `expectedIntent` values to match the `SupportIntent` enum, with comments documenting the closest-mapping rationale.
- `server/jobs/runArtifactsRetentionSweepJob.ts` — added `pageDeleted` per-page progress tracker; exits the loop with a warn-log when a full page produces zero DB deletes (S3 outage protection).
- `server/routes/agentRuns.ts` — added `resolveAgentRunVisibility` gate to `/api/agent-runs/:runId/artifacts` listing; matches the gate already enforced on `/download` and `/signed-url`.
- `tasks/todo.md` — extended PR-S6 to enumerate the four execution-service branches that need `support.add_internal_note` / `support.assign` action handlers in Phase 1.5.

## Rejected Recommendations

- **Iter1 finding 5 — `support-agent-run` producer not wired.** Real architectural gap (Support Agent is functionally idle in production), but the proper fix is a multi-file design change about where the dispatch hook lives (extend existing scheduled-run handler vs. add separate scheduler vs. wire webhook adapter). Out of scope for a dual-reviewer surgical pass; already tracked in `tasks/todo.md` REQ #40 as a deferred architectural item. Surfaced the framing in this log so future work reopens REQ #40 with the clarification that worker registration alone does not equal job production.
- **Iter3 finding — Preserve add-note recommendations.** Adjudicated as REJECT-REWORK — Codex's underlying critique was right, but its suggested remedy (don't emit terminal) would cause a re-classify-and-skip loop. The existing iteration-1 fix was reworked in-place to use the codebase's established `phase1.support.escalation_action_pending` pattern, which gives operators visibility on the deferred action without losing the terminal-event guard.

---

## Verification

- `npm run lint` → 0 errors, 888 warnings (baseline preserved).
- `npm run typecheck` → both project configs pass cleanly.

---

**Verdict:** APPROVED (3 iterations, 5 fixes applied, 2 findings rejected with rationale; the one architectural gap surfaced — REQ #40 producer wiring — remains a deferred-backlog item already known to the team and is not a regression introduced by this branch).
