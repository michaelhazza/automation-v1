# Spec Conformance Log (Re-verification Run)

**Spec:** `tasks/builds/phase-1-showcase-mvps/spec.md`
**Spec commit at check:** `b0fda916b12555927560e66a0e56d15f58559edb`
**Branch:** `feat/phase-1-showcase-mvps`
**Branch HEAD:** `910236f002ac82744394a68e1d0051bc4eed820c` (fix commit applied)
**Base:** `1447d29e781147179d2a0f5ce90a3f8ea19d6ba5` (merge-base with origin/main)
**Scope:** re-verification of 7 high-priority blockers closed by fix commit `910236f0`
**Prior run:** `tasks/review-logs/spec-conformance-log-phase-1-showcase-mvps-2026-05-10T10-00-17Z.md` (NON_CONFORMANT, 16 deferred)
**Run at:** 2026-05-10T10:36:38Z

---

## Summary

- Requirements re-verified:    7 (the closed-blocker set)
- PASS:                        7
- MECHANICAL_GAP -> fixed:     0
- DIRECTIONAL_GAP -> deferred: 0 (new)
- AMBIGUOUS -> deferred:       0 (new)

**Verdict:** CONFORMANT_AFTER_FIXES

The 7 high-priority blockers identified in the prior run are now closed in the codebase. The 9 medium/low priority items from the prior run remain deferred as previously triaged in `tasks/todo.md` under section "Deferred from spec-conformance review - phase-1-showcase-mvps (2026-05-10)" and were explicitly held over by the operator for post-merge follow-up. No new findings.

`npm run lint` reports 0 errors. `npm run typecheck` passes both project configs (root + server).

---

## Re-verified requirements

| REQ | Spec | Prior verdict | New verdict | Evidence |
|-----|------|---------------|-------------|----------|
| 4 | §6.1.4 | DIRECTIONAL_GAP (route never mounted) | PASS | `server/index.ts:216` imports `runArtifactsFinalizeRouter`; `server/index.ts:478` mounts it. Router defines `POST /api/internal/run-artifacts/finalize` at `server/routes/internal/runArtifactsFinalize.ts:37` matching spec §6.1.4 verbatim. |
| 5 | §6.1.2b | DIRECTIONAL_GAP (sweep job never wired) | PASS | `server/index.ts:732-741` registers `registerRunArtifactsRetentionSweepJob` inside the `pg-boss` boot block. Symbol exists at `server/jobs/runArtifactsRetentionSweepJob.ts:34`. |
| 27 | §5.3.2 | DIRECTIONAL_GAP (master prompt seeded as literal `{{MASTER_PROMPT_PLACEHOLDER}}`) | PASS | New `server/services/supportAgentMasterPrompt.ts` reads `server/prompts/support-agent-master.md`, strips frontmatter, substitutes 5 placeholders (`{{org_name}}`, `{{subaccount_name}}`, `{{min_confidence}}`, `{{voice_profile}}`, `{{escalation_categories}}`). Threaded through `processInbox` (`supportAgentExecutionService.ts:261-267`) and into `classifyTicket`, `proposeReplyForTicket`, `findCustomerHistory` skill handlers as a prepended system-message block. |
| 36 | §5.3.7, INV-8 | AMBIGUOUS (run-create site not visible) | PASS | `supportAgentExecutionService.ts:225-241` inserts the `agent_runs` row at run start using `subaccountAgentRunId` as PK with `onConflictDoNothing`. The `controller_style` column carries `.notNull().default('native')` at the schema level (`server/db/schema/agentRuns.ts:48`), satisfying INV-8 without an explicit field assignment. |
| 40 | §5.3.3 | DIRECTIONAL_GAP (`registerSupportAgentRunJob` never called) | PASS | `server/index.ts:742-751` registers the worker inside the `pg-boss` boot block. Symbol exists at `server/jobs/supportAgentRunJob.ts:33`. |
| 41 | §5.5.4 | DIRECTIONAL_GAP (`registerSupportEvalDailyJob` never called) | PASS | `server/index.ts:752-761` registers the worker inside the `pg-boss` boot block. Symbol exists at `server/jobs/supportEvalDailyJob.ts:22`. |
| 49 | §5.6.2 | DIRECTIONAL_GAP (`InboxAgentConfigTab` orphaned) | PASS | `client/src/pages/support/InboxConfigPage.tsx:271-294` composes `InboxAgentConfigTab` into the inbox config page below the legacy form. Legacy form's PATCH (lines 105-113) preserves Phase 1 fields (`minConfidence`, `voiceProfile`, `promptOverride`, `escalationCategories`) so save-from-either-form does not clobber values set via the other surface. |
| 52 | §3.5, INV-16 | DIRECTIONAL_GAP (events log-only; `agent_execution_events` double-write missing — broke outer-loop predicate) | PASS | New `server/services/phase1RunTraceEventEmitter.ts` provides best-effort double-write. Atomically allocates `sequence_number` from `agent_runs.next_event_seq` inside a transaction and inserts into `agent_execution_events` with the matching `event_type` discriminator. Called at 10 emit sites alongside structured-log emits: `collision_skipped` (concurrent_claim, human_active), `ticket_terminal` (low_confidence, skill_error), `draft_proposed` (autonomous, assisted), `ticket_classified`, `classify_failed`, `report_rendering_failed`, `artifact_upload_failed`. The outer-loop predicate at `supportAgentExecutionServicePure.ts:91-103` (`NOT EXISTS` over `agent_execution_events.event_type IN ('phase1.support.draft_proposed', 'phase1.support.collision_skipped', 'phase1.support.ticket_terminal')`) now finds rows; idempotency guard works at runtime. Best-effort semantics: failures warn-log without breaking the run. |

---

## Mechanical fixes applied this run

None. The fix commit `910236f0` (authored by the main session before this re-verification ran) closed all 7 items.

---

## Deferred items from prior run (unchanged, NOT re-flagged)

The following 9 medium/low items remain in `tasks/todo.md` under "Deferred from spec-conformance review - phase-1-showcase-mvps (2026-05-10)" exactly as the prior run logged them. They are explicitly held over for post-merge follow-up and are NOT new findings of this re-verification:

| REQ | One-line | Priority |
|-----|----------|----------|
| 28 | `default_system_skill_slugs` has `set_custom_field`, not `ask_clarifying_question` | medium |
| 30 | install route mounted under `/api/support/...` vs spec `/api/...` | medium |
| 18 | `phase1.macro.run_started/run_completed/artifact_delivered` never emitted | medium |
| 19 | `phase1.macro.run_stuck` emitted from worker not detector | medium |
| 42 | `phase1.support.draft_dispatched` and `draft_blocked_by_policy` never emitted | medium |
| 33 | `promptOverride` forbidden-token list far narrower than spec | medium |
| 12 | PDF determinism: xref-sort step omitted | low |
| 25 | `system_skills` row for `support.classify_ticket` not seeded | low |
| 34 | Master-prompt eval-gate before bump (process discipline) | low (OUT_OF_SCOPE) |

---

## Files modified by this run

None.

---

## Verification commands

- `npm run lint` -> 0 errors, 888 warnings (pre-existing)
- `npm run typecheck` -> passes both project configs (root + server)

---

## Next step

CONFORMANT_AFTER_FIXES. The 7 high-priority spec-conformance blockers are now closed in code. The branch is conformant against the in-scope portions of the spec for which this re-verification was requested.

The 9 deferred medium/low items remain explicitly held over per operator decision (recorded in the prior log and `tasks/todo.md`) — they are not blocking the next pipeline step.

Recommended next step: re-run `pr-reviewer` against the expanded changed-code set so the reviewer sees the post-fix state, then proceed to the finalisation pipeline.
