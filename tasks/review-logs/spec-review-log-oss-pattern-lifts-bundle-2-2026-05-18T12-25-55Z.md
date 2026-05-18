# Spec Review Log — oss-pattern-lifts-bundle — Iteration 2

**Spec:** `docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md`
**Iteration:** 2 / 5
**Codex raw output:** `tasks/review-logs/_codex_oss-pattern-lifts-bundle_iter2_2026-05-18T12-25-55Z.txt`

## Findings (Codex F1-F8, all mechanical)

**F1 §7.3/§4.1/§8.4 — approval waitpoint binds wrong run id.** In `dispatch.ts`, `run.id` is the workflow run id; `waitpoints.bound_run_id` FKs to `agent_runs.id`. Fix: use `action.agentRunId` (loaded after the action is created) as `boundRunId`, and pass `agentRunId: action.agentRunId` in resumePayload. If `agentRunId` isn't available at this point in the call site, the binding falls back to undefined and we accept telemetry without `bound_run_id` (the column is nullable for system-level waits per §3).

**F2 §5.3/§7.2/§17 — blockedRunExpiryJob fallback broken when flag is on.** With the flag on, the waitpoint CREATE path doesn't write `agent_runs.blocked_expires_at`, so the existing sweep finds zero rows. The iteration-1 "division of labour" claim is broken. Correct fix: `expireWaitpoints` must perform the OAuth-kind downstream cleanup itself (transition `agent_runs.status` to cancelled with `cancelReason: 'integration_connect_timeout'`, clearing `blocked_reason` if set) using the same `assertValidTransition` + predicate-checked UPDATE pattern as `blockedRunExpiryJob`.

**F3 §5.3 — approvalExpiryJob doesn't sweep workflow_step_runs.** Existing `approvalExpiryJob` sweeps `agent_charges` only. No existing job exists for `workflow_step_runs.status='awaiting_approval'` expiry. Fix: `expireWaitpoints` must also transition `workflow_step_runs.status` out of `awaiting_approval` for expired approval waitpoints (transition to a cancellation/timeout state — name the target state explicitly using existing workflow step run status vocabulary). Where the existing approval flow has no formal "approval timed out" state, set status to `'failed'` with a stepRunResult naming the timeout.

**F4 §5.2/§7.3/§8.4 — sendWithTx does not accept deadLetter.** `sendWithTx` accepts `{retryLimit, expireInSeconds, priority, singletonKey}` only. Passing full `getJobConfig(queue)` would silently lose deadLetter routing. Fix: §5.2 says `completeWaitpoint` extracts only the supported subset from `getJobConfig(resumeQueue)`. The deadLetter contract is enforced at processor-creation time (existing pgBossRegistrations behaviour), not per-job-row.

**F5 §7.2/§8.1 — createWaitpoint must also return expiresAt.** The existing integration card persisted in `agent_messages.meta` requires `expiresAt` (lines 877 of agentExecutionLoop.ts). Current spec returns only `{plaintext}`. Fix: createWaitpoint returns `{plaintext, expiresAt: Date}`. Card construction uses the waitpoint's expiresAt; the current 24h `blockDecision.expiresAt` is REPLACED by the waitpoint's 1h expiry, matching the `expiresInSeconds: 3600` parameter.

**F6 §7.2/§13 — agentExecutionLoop helper reuse not specified.** Current loop calls `checkRequiredIntegration` which returns `{plaintext, tokenHash, expiresAt, integrationDedupKey, card, integrationId}`. With the flag on, the loop reuses `checkRequiredIntegration` for `{integrationDedupKey, card, integrationId}` metadata only and IGNORES the helper's own `{plaintext, tokenHash, expiresAt}` — substituting the values returned by `createWaitpoint`. `integration_dedup_key` continues to be persisted on `agent_runs` (it's a metadata column, not a state column, and double-block protection still applies). `integration_resume_token` and `blocked_expires_at` are NOT persisted with the flag on (waitpoints carry these). Fix: state this explicitly in §7.2.

**F7 §13/§16 — waitpointServicePure surface not pinned.** Pure module's exact exports were vague. Fix: list `generateWaitpointPlaintext()`, `validateCreateWaitpointParams(params)`, `isCompletableWaitpointRow(row, now)` as the V1 pure exports; `deriveTokenHash` is re-exported from `agentResumeService.ts` (per §3) so the pure module just imports it. §16 test list updated to match.

**F8 §14 — chunk sequencing bug for WAITPOINT_PRIMITIVE_ENABLED env var.** Env var Chunk 7 is required by Chunks 5+6. Fix: move env-var registration (env.ts read + docs/env-manifest.json) to Chunk 1 (alongside schema/migration); Chunk 7 retains architecture.md + KNOWLEDGE.md docs only.

## Rubric findings (mine)

None new this iteration — iteration 1's rubric pass plus Codex covered everything.

## Counts

- Codex findings: 8
- Rubric findings: 0
- Mechanical accepted: 8
- Mechanical rejected: 0
- Directional / ambiguous resolved: 0
- AUTO-DECIDED: 0
- Reclassified → directional: 0
