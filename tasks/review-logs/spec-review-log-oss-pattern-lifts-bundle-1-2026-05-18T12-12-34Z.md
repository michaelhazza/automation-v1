# Spec Review Log — oss-pattern-lifts-bundle — Iteration 1

**Spec:** `docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md`
**Iteration:** 1 / 5
**Codex raw output:** `tasks/review-logs/_codex_oss-pattern-lifts-bundle_iter1_2026-05-18T12-12-34Z.txt`

## Table of contents
- Codex findings (1-14)
- Rubric findings (R1-R6)
- Rejected / reclassified
- Edits applied
- Counts

## Codex findings

**F1 §7.3/§13 — reviewItems.ts not in inventory.** Mechanical. Approval COMPLETE path call site is `reviewItems.ts`, not `dispatch.ts`. Fix: name reviewItems.ts in §7.3 COMPLETE side; add to §13.

**F2 §13 — modified-files count drift.** Mechanical. Heading says 9, table has 10 rows, summary says 10. Fix: reconcile after adding reviewItems.ts + agentExecutionLoop.ts + Pure file.

**F3 §13/§14 — server/jobs/index.ts does not exist.** Mechanical. Job handler registration lives at `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts`. Fix: replace inventory row.

**F4 §7.3/§8.1 — plaintext persistence contradiction.** Mechanical. §8.1 says plaintext must not be persisted but §7.3 stores it in actions.metadataJson. Fix: soften §8.1 invariant to "no logs/telemetry; tenant-scoped storage permitted" and explicitly carve out approval-kind persistence in actions.metadataJson (analogous to OAuth's agent_messages.meta).

**F5 §5.2/§15.1/§6.1 — singletonKey derivation under-specified.** Mechanical. §15.1 claims `singletonKey: runId` for the resume job; §5.2 just calls sendWithTx(tx, queue, payload) with no options. Fix: §5.2 specifies that completeWaitpoint passes `getJobConfig(resumeQueue)` to sendWithTx AND, for kind='oauth', sets `singletonKey: payload.runId`.

**F6 §5.2/§8.4/§15.1 — workflow-resume job config not forwarded.** Mechanical. Fix bundled with F5: completeWaitpoint must pass `getJobConfig(resumeQueue)` to sendWithTx for both kinds.

**F7 §7.3/§8.4 — approval resumePayload omits agentRunId.** Mechanical. Fix: add `agentRunId: action.agentRunId ?? undefined` to §7.3 approval resumePayload.

**F8 §7.3/§8.4 — approvedActionId is required at the waitpoint layer.** Mechanical. Fix: note that for kind='approval' waitpoints, `resumePayload.approvedActionId` is required; underlying workflow-resume queue contract unchanged.

**F9 §4.2/§5.2/§12 — completeWaitpoint must never use withAdminConnection.** Mechanical. Fix: add invariant statement to §4.2 and §5.2.

**F10 §5.2/§8.2/§10 — "status authoritative" overclaim.** Mechanical. The authoritative state is the pair (status, expires_at). Fix: §8.2 source-of-truth precedence amended.

**F11 §5.3/§17 — expireWaitpoints doesn't transition agent_runs / workflow_step_runs.** Mechanical (cross-mechanism gap). Lowest-effort resolution: keep existing blockedRunExpiryJob + approvalExpiryJob running unchanged; document that the new waitpoint sweep operates on the waitpoints table only, and downstream state cleanup remains the responsibility of the existing per-kind sweeps. Fix: §5.3 + §17 explicitly state this division of labour.

**F12 §3/§4.1/§5.1 — bound_run_id required-but-not-enforced.** Mechanical. Fix: §5.1 requires createWaitpoint to throw VALIDATION_FAILED when kind ∈ {oauth, approval} and boundRunId is missing.

**F13 §15.4/§18 — "terminal events emitted once" overclaim.** Mechanical (apply the weaker-claim option; transactional in-tx emission would be scope creep). Fix: amend §15.4 to "at-most-once, best-effort, post-commit; the waitpoint row is the source of truth, events are observability".

**F14 §16 — CI gate language too strict.** Mechanical. Fix: §16 spells out the split — getOrgScopedDb for create/complete, withAdminConnection for expire, with the standard guard-ignore-next-line annotation.

## Rubric findings

**R1 §7.2/§13 — CREATE side file inventory drift.** Mechanical. OAuth CREATE side is in `server/services/agentExecutionLoop.ts` (verified lines 856/883/902). §13 only lists agentResumeService.ts (COMPLETE side). Fix: add agentExecutionLoop.ts to §13 with row "OAuth CREATE side gated by WAITPOINT_PRIMITIVE_ENABLED".

**R2 §4.2/§5.3/§16 — withAdminConnection alone does not bypass RLS.** Mechanical. blockedRunExpiryJob.ts:51 runs `SET LOCAL ROLE admin_role` inside the connection. Without that, FORCE RLS would make the sweep see zero rows. Fix: §5.3 specify the SET LOCAL ROLE statement explicitly.

**R3 — duplicate of F1.** No separate fix.

**R4 §13/§16 — Pure test file naming convention.** Mechanical. waitpointService.ts is impure but the test file is named `*Pure.test.ts`, implying a pure module. Fix: add `server/services/waitpointServicePure.ts` (pure helpers: deriveTokenHash extension, state-transition predicate, plaintext generation) and keep `waitpointServicePure.test.ts` for that module; the service file itself gets tested through the pure module + a thin mocked-DB harness (no new file needed).

**R5 §13/§18 — total file counts must re-reconcile.** Mechanical. After R1 + F1 + R4: new files 6→7, modified files 10→12 (adding reviewItems.ts + agentExecutionLoop.ts). Fix: update §13 totals and §18.3.

**R6 §12 — route-guard inventory incomplete.** Mechanical. Approval `completeWaitpoint` runs from `server/routes/reviewItems.ts` under `ORG_PERMISSIONS.REVIEW_APPROVE`. Fix: §12 add this route guard row.

## Rejected / reclassified findings

None.

(F13 was ambiguous — Codex offered two options, one architectural (transactional emission, scope expansion) and one precision-of-claim (mechanical). Took the precision option.)

## Edits applied

(See spec edits and commit diff.)

## Counts

- Codex findings: 14
- Rubric findings: 5 distinct (R3 is dup of F1)
- Mechanical accepted: 14 + 5 = 19
- Mechanical rejected: 0
- Directional / ambiguous resolved: 0
- AUTO-DECIDED: 0
- Reclassified → directional: 0

