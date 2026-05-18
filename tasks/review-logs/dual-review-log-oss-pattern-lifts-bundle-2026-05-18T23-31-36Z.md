# Dual Review Log — oss-pattern-lifts-bundle

**Files reviewed:**
- server/db/schema/waitpoints.ts
- server/services/waitpointService.ts
- server/services/agentExecutionLoop.ts
- server/services/agentResumeService.ts
- server/lib/pgBossTxSend.ts
- server/jobs/agentRunResumeFromWaitpointJob.ts
- server/jobs/waitpointExpirySweepJob.ts
- migrations/0379_waitpoints_primitive.sql
- server/services/reviewService.ts
- server/services/workflowEngine/queueLifecycle/dispatch.ts
- server/services/workflowEngine/stepLifecyclePure.ts

**Iterations run:** 2/3
**Timestamp:** 2026-05-18T23-31-36Z

---

## Iteration 1

Codex review ran via `codex review --base main`. Output enumerated 2 P1 findings.

### Findings

**[P1] Actually resume the run in the waitpoint worker** — `server/jobs/agentRunResumeFromWaitpointJob.ts:61`
> When `WAITPOINT_PRIMITIVE_ENABLED` is on, this worker is the only consumer of a completed OAuth waitpoint, but `resumeAgentRun()` only rehydrates and returns checkpoint/context data; it does not clear `blocked_reason` or continue execution via `runAgenticLoop`. Since the return value is discarded here, a successful OAuth connect leaves the agent run blocked/running with no actual resume.

**[P1] Fix singleton conflict inference before enqueuing** — `server/services/waitpointService.ts:213`
> In the OAuth waitpoint completion path, `sendWithTx` inserts with a `singletonKey`, but its `ON CONFLICT (name, singletonkey) WHERE state NOT IN (...)` target does not match pg-boss's partial unique indexes, which also predicate on `singletonOn IS NULL` and the singleton-queue key prefix. PostgreSQL raises "no unique or exclusion constraint matching the ON CONFLICT specification", so completing an OAuth waitpoint rolls back before enqueueing the resume job.

### Decisions

[ACCEPT-DOCUMENT] server/jobs/agentRunResumeFromWaitpointJob.ts:61 — worker discards `resumeAgentRun` return value and never calls `runAgenticLoop`.
  Reason: Real correctness gap that pr-reviewer missed across 3 rounds. Spec §6.1 explicitly says the handler must "call `resumeAgentRun` → hand off to `runAgenticLoop`". The current implementation does the first half only.

  However, full fix is out of scope:
  - `resumeAgentRun` itself is a documented "Sprint 3A library entry point" (see header at `server/services/agentExecutionService/resume.ts:1-19`). Its own header says: "Sprint 3A exposes this as a callable library function but does NOT wire it to an HTTP endpoint or pg-boss job — that is Sprint 3B."
  - Wiring the hand-off to `runAgenticLoop` requires the full executeRun bootstrap (`orgProcesses`, `pipeline`, `mcpClients`, `mcpLazyRegistry`, `runContextData`, `hierarchyContext` — none returned by `resumeAgentRun`). That is substantive Sprint-3B-class work, not an in-build fix.
  - The flag `WAITPOINT_PRIMITIVE_ENABLED` is default-false; no production incident exists. The gap is latent, not live.

  Surgical fix applied:
  1. Worker header comment updated to honestly state the hand-off is INCOMPLETE / deferred to Sprint 3B, with the operational consequence (run stays blocked until expiry sweep cancels it) and the operator gate (do NOT flip the flag in production until Sprint 3B lands).
  2. `oauth.resume.deferred_no_handoff` warning log added after the `resumeAgentRun` call so the gap is observable in production telemetry.
  3. New deferred-items entry `OPLB-DR-2026-05-19-D1` added to `tasks/todo.md` enumerating: (a) what the spec calls for, (b) what's missing, (c) operational consequence, (d) the operator gate, (e) what wiring is required for Sprint 3B.

  This matches the spec's existing posture for `OPLB-SR-IT4-D1` (approval-resume async path also deferred to a future build).

[REJECT] server/services/waitpointService.ts:213 — `sendWithTx` `ON CONFLICT` predicate width mismatch vs pg-boss partial unique indexes.
  Reason: Explicitly on the caller's "Deferred items NOT to flag as new findings" list. pr-reviewer round 3 surfaced this as a deferred Should-fix item ("pgBossTxSend ON CONFLICT predicate width vs pg-boss partial unique indexes"). It's a known-deferred concern, not a new finding.

### Verification

After applying the surgical fix:
- `npm run lint`: 0 errors / 883 warnings (same as branch baseline; no regression).
- `npm run typecheck`: clean.

## Iteration 2

Codex review ran via `codex review --uncommitted`. Codex returned a summary verdict and no new findings:

> "The only production-code change adds documentation and an operator warning log around an already-deferred resume hand-off; it does not introduce a new incorrect state transition or runtime behavior. The remaining changes are task/review documentation updates."

Zero findings raised. Loop terminates per Step 4 of dual-reviewer protocol (no findings = done).

---

## Changes Made

- `server/jobs/agentRunResumeFromWaitpointJob.ts` — Updated header comment to document the deferred Sprint-3B hand-off; added `oauth.resume.deferred_no_handoff` warning log after `resumeAgentRun(runId)` call so the gap is observable in production. Behaviour unchanged in production (flag is default-false); telemetry now surfaces the gap if the flag is ever flipped.
- `tasks/todo.md` — Added deferred-items entry `OPLB-DR-2026-05-19-D1` describing the missing `runAgenticLoop` hand-off, the operator gate on flag-flip, and the Sprint-3B scope required to complete the wiring.

## Rejected Recommendations

- **[P1] Fix singleton conflict inference (`waitpointService.ts:213`)** — REJECTED because it appears in the caller's explicit "Deferred items NOT to flag as new findings" list. pr-reviewer round 3 carries this as a Should-fix item ("pgBossTxSend ON CONFLICT predicate width vs pg-boss partial unique indexes"); not a new finding.

---

**Verdict:** APPROVED — 2 Codex iterations; 1 P1 finding accepted with documenting/observability fix (full wiring deferred to Sprint 3B per operator gate); 1 P1 finding rejected as known-deferred.
**Commit at finish:** (set below by auto-commit step)
