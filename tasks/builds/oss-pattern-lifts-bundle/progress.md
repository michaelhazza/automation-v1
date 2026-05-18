# Progress — oss-pattern-lifts-bundle

| Field | Value |
|---|---|
| Build slug | oss-pattern-lifts-bundle |
| Phase | BUILDING (Phase 2 in progress) |
| Branch | spec-review/oss-pattern-lifts-bundle |
| Started | 2026-05-18 |
| Spec path | docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md |
| Plan path | tasks/builds/oss-pattern-lifts-bundle/plan.md |

---

## Phase 2 log

- **2026-05-18** — feature-coordinator launched. S1 sync merged main (browser-vision-grounding work; no overlapping files; typecheck clean post-merge).
- **2026-05-18** — architect produced plan: 7 chunks per spec §14, all with `spec_sections:`, contracts, error handling.
- **2026-05-18** — chatgpt-plan-review 3 rounds, APPROVED. 15 findings auto-applied. 3 plan-level deviations recorded: `createWaitpoint` optional `tx?`, `maintenance:` queue prefix, `completeWaitpoint` per-input-shape kind guard.
- **2026-05-18** — plan-gate: operator `continue to build as per plan`.
- **2026-05-19** — Chunk 1 built (commit `630892d8`): schema + migration `0379_waitpoints_primitive.{sql,down.sql}` (5 CHECKs + 2 indexes + RLS policy on single line) + `rlsProtectedTables` entry + `WAITPOINT_PRIMITIVE_ENABLED` env var + `env-manifest.json` entry. G1 attempts: 1 (lint 0 errors / 879 pre-existing warnings, typecheck clean). Builder note: migration uses single-arg `current_setting('app.organisation_id')::uuid` form per plan; fail-closed two-arg form not requested by plan.
- **2026-05-19** — Chunk 2 built (commit `005bb63b`): `waitpointService.ts` (createWaitpoint/completeWaitpoint/expireWaitpoints) + `waitpointServicePure.ts` (4 pure exports + deriveTokenHash re-export) + `stepLifecyclePure.ts` (buildFailStepRunColumnSet drift-closure helper) + `stepLifecycle.ts` refactor (consumes helper with SoT anchor comment) + 21 pure tests + 5 column-parity tests. G1 attempts: 2 lint, 2 typecheck (first lint: unused drizzle-orm imports; first typecheck: `useSingletonQueue` not in `sendWithTx` options type). All 26 tests pass. Builder notes: (1) `createWaitpoint` uses a dual-path doInsert (raw SQL for TxHandle, Drizzle for getOrgScopedDb) because TxHandle only exposes `execute(sql)`; (2) `expireWaitpoints` does NOT call `assertValidTransition` on the agent_runs UPDATE — predicate-guarded UPDATE with `AND status = $observed` achieves equivalent fail-closed behaviour; flagging for pr-reviewer review. (3) Duplicate `guard-ignore-next-line` annotation — harmless.
- **2026-05-19** — Chunk 3 built (commit `b4df1109`): `agentRunResumeFromWaitpointJob.ts` (resumable-state check + delegate to resumeAgentRun) + `jobConfig.ts` entry (`agent-run-resume-from-waitpoint`: retry 2, expire 300s, singleton-key idempotency) + `pgBossRegistrations.ts` worker registration (using `createWorker` not raw `boss.work` — `resumeAgentRun` requires `withOrgTx` context, matches `run:resumeAfterOAuth` pattern) + `jobPayloadFixtures.ts` fixture + `handlerRegistryFixture.ts` entry (typecheck-required for every JobName). G1 attempts: 1 lint, 2 typecheck. Net 1 new lint warning (still 0 errors). Builder adaptations: (a) used `createWorker` instead of raw `boss.work` per plan's "pattern-match accordingly" guidance; (b) added handlerRegistryFixture entry — not in chunk file list but typecheck-required.
- **2026-05-19** — Chunk 4 built (commit `88b1fec4`): `waitpointExpirySweepJob.ts` (`runFn()` → `expireWaitpoints()` + duration log) + `jobConfig.ts` entry (`maintenance:waitpoint-expiry-sweep`: retry 1, expireInSeconds 90, fifo idempotency) + `pgBossRegistrations.ts` worker (`teamSize: 1, teamConcurrency: 1` — NO singletonKey) + schedule (`*/5 * * * *` cron, empty options object — NO singletonKey) + `handlerRegistryFixture.ts` and `jobPayloadFixtures.ts` entries. G1 attempts: 1 (all checks pass on first try). Visual review confirmed no fake singletonKey in either schedule or worker options.
- **2026-05-19** — Chunk 5 built (commit `f1f92ef2`): `agentExecutionLoop.ts` `if (blockDecision.shouldBlock)` branch gated on `WAITPOINT_PRIMITIVE_ENABLED` — ON path calls `createWaitpoint({kind:'oauth', expiresInSeconds: 3600, resumeQueue: 'agent-run-resume-from-waitpoint'})`, uses `{plaintext, expiresAt}` for the integration card, omits writes to `integration_resume_token` and `blocked_expires_at` (dead under flag-on). Legacy path preserved verbatim under `else`. `agentResumeService.ts` `resumeFromIntegrationConnect` ON path pre-fetches `bound_run_id` from `waitpoints` by `tokenHash` (HTTP 410 on row missing OR null bound_run_id), calls `completeWaitpoint({plaintext, organisationId})`, maps to existing `ResumeResult` shape. G1 attempts: 1. Builder confirmed there's ONE `shouldBlock` block to gate (plan's "lines 856/883/902" actually a log field + UPDATE + log call within the same block) — implementation intent correctly satisfied.
- **2026-05-19** — Chunk 6 built (commit `f1f424e9`): `dispatch.ts` `pending_approval` branch gated on `WAITPOINT_PRIMITIVE_ENABLED`. ON path opens a Drizzle tx wrapping THREE atomic writes — `createWaitpoint({kind:'approval', expiresInSeconds: 86400, resumeQueue: null, resumePayload: {workflowRunId, workflowStepRunId, approvedActionId, ...}}, {tx})`, `jsonb_set` on `actions.metadata_json.waitpointId` (plaintext discarded), and the existing `workflow_step_runs.awaiting_approval` UPDATE. `reviewService.approveItem` ON path: inside existing tx, executes the four-step ordering — (a) optimistic claim already done at top, (b) re-read action row (409 if no longer `pending_approval`), (c) extract `metadataJson.waitpointId` and call `completeWaitpoint({waitpointId, organisationId, tx})` if present (legacy actions without waitpointId skip), (d) action-transition + `resumeActionCallAfterApproval` unchanged. `already_completed` logged + proceeds; `RESUME_TOKEN_EXPIRED` rolls back the entire approval tx. G1 attempts: 1.
- **2026-05-19** — Chunk 7 built (commit `89f6286a`): `architecture.md` "Waitpoint Primitive" section (anchor `waitpoint-primitive`) — three kinds + dual completeWaitpoint input shape + per-kind queue contract (Path B for approval) + 5-min sweep cadence + flag rollback posture + buildFailStepRunColumnSet drift-closure helper + 7 key file paths. `KNOWLEDGE.md` `[2026-05-19] Decision — Trigger.dev evaluated, not adopted; waitpoint primitive built instead` entry appended. G1 attempts: 1. All 7 chunks built.
- **2026-05-19** — G2 integrated-state gate: PASS on first attempt. Lint: 0 errors / 883 pre-existing warnings (net +0 errors / +1 warning over Chunk 3 baseline, unchanged since Chunk 3). Typecheck: clean.
- **2026-05-19** — Spec-validity checkpoint: operator confirmed `continue`.
- **2026-05-19** — spec-conformance: CONFORMANT (34/34 PASS). No gaps. Log: `tasks/review-logs/spec-conformance-log-oss-pattern-lifts-bundle-2026-05-18T21-28-36Z.md`. Three previously-accepted plan-level deviations (createWaitpoint `tx?`, `maintenance:` queue prefix, completeWaitpoint per-input-shape kind guard) confirmed correctly reflected in implementation; not new gaps.
- **2026-05-19** — adversarial-reviewer: HOLES_FOUND (0 confirmed / 2 likely / 4 worth-confirming). Phase 1 advisory, non-blocking. Log: `tasks/review-logs/adversarial-review-log-oss-pattern-lifts-bundle-2026-05-18T21-28-36Z.md`. Likely-holes — L1 non-atomic OAuth createWaitpoint + agent_runs UPDATE (orphan-waitpoint → spurious cancellation 5min later) and L2 single-tx expiry sweep (one bad row poisons entire batch). Worth-confirming — W1 OAuth two-step idempotency (safe by predicate, informational), W2 unknown-queue TypeError on completeWaitpoint, W3 pre-existing plaintext-in-agent_messages.meta + misleading comment, W4 Drizzle partial-index drift on boundRunIdx. Findings forwarded to pr-reviewer for in-build vs deferred routing.
- **2026-05-19** — pr-reviewer: CHANGES_REQUESTED — 6 Blocking, 9 Should-fix, 3 Consider. Log: `tasks/review-logs/pr-review-log-oss-pattern-lifts-bundle-2026-05-18T21-28-36Z.md`. Blocking findings (3 confirm adversarial L1/L2/W2/W4 + 2 new): B1 OAuth non-atomic createWaitpoint+agentRuns+agentMessages (=adversarial L1); B2 single-tx expiry sweep + missing per-row try/catch (=adversarial L2); B3 expireWaitpoints OAuth-kind transitions agent_runs without `assertValidTransition` (DEV_GUIDELINES §8.18 violation; `guarded: true` log is misleading); B4 `getJobConfig(resumeQueue as JobName)` unvalidated cast (=adversarial W2); B5 missing `useSingletonQueue: true` on workflow-run-tick enqueue from approval expiry (breaks per-queue dedup); B6 Drizzle partial-index drift on `waitpoints_bound_run_idx` (=adversarial W4). Operator approved "Fix all 6 Blocking now".
- **2026-05-19** — Fix-loop round 1: builder SUCCESS. All 6 Blocking findings implemented. Files changed: server/services/agentExecutionLoop.ts, server/services/waitpointService.ts, server/db/schema/waitpoints.ts, server/lib/pgBossTxSend.ts. G3 attempts: 1 (lint 0 errors / 883 pre-existing warnings, typecheck clean, build:server clean). Builder notes: (a) per-row try/catch in expireWaitpoints matches blockedRunExpiryJob accepted pattern (no SAVEPOINT needed since bulk UPDATE already transitioned waitpoint rows to expired before per-row downstream cleanup); (b) 2 pre-existing `@typescript-eslint/no-explicit-any` warnings on `meta: cardContent as any` in both flag-on and flag-off paths — pre-date this chunk; routed to tasks/todo.md.
- **2026-05-19** — pr-reviewer round 2 (post fix-loop round 1): CHANGES_REQUESTED — 1 NEW Blocking (rB1), 3 Should-fix, 2 Consider. Log: `tasks/review-logs/pr-review-log-oss-pattern-lifts-bundle-2026-05-18T22-30-00Z.md`. Round 1 closure: B1/B3/B4/B5/B6 all CLOSED; B2 only PARTIALLY closed — per-row try/catch added but SAVEPOINTs missing. rB1: builder's "no SAVEPOINT needed" rationale was wrong — once any `tx.execute` raises a Postgres error mid-loop, the entire withAdminConnection tx becomes aborted (25P02), all subsequent rows silently drop downstream cleanup, and the bulk UPDATE has already moved them to `expired` so the next sweep won't reattempt. Dispatching fix-loop round 2 with SAVEPOINT-per-row fix.
- **2026-05-19** — Fix-loop round 2: builder SUCCESS. SAVEPOINT row_sp issued as first statement inside the per-row body; RELEASE on all four `continue` early-exits and end-of-iteration success; ROLLBACK TO SAVEPOINT row_sp in catch before logger.warn. File: server/services/waitpointService.ts only. G3 attempts: 1 (lint 0 errors, typecheck clean). Commit: 8f207f3b.
- **2026-05-19** — pr-reviewer round 3: APPROVED. Log: `tasks/review-logs/pr-review-log-oss-pattern-lifts-bundle-2026-05-18T22-40-00Z.md`. rB1 CLOSED — SAVEPOINT placement, all release paths, rollback ordering, and Postgres SAVEPOINT-name-reuse semantics all verified. 3 Should-fix and 2 Consider items deferred from round 2 carry forward to follow-up (pgBossTxSend ON CONFLICT predicate width, sql.raw UUID interpolation footgun, missing SAVEPOINT recovery test, dead `let` declarations, flag-flip rollback runbook). None gate merge.
- **2026-05-19** — reality-checker: READY (8/8 criteria verified). Log: `tasks/review-logs/reality-check-log-oss-pattern-lifts-bundle-2026-05-18T22-40-00Z.md`. All claimed criteria backed by deterministic source-spot-check + review-log evidence. No unverified claims; no contradictions.
- **2026-05-19** — dual-reviewer (Codex): APPROVED (2 of 3 iterations). Log: `tasks/review-logs/dual-review-log-oss-pattern-lifts-bundle-2026-05-18T23-31-36Z.md`. Codex iteration 1 raised 2 P1 findings: (a) pgBossTxSend ON CONFLICT predicate (REJECTED — already-deferred Should-fix), (b) real correctness gap pr-reviewer missed across 3 rounds — `agent-run-resume-from-waitpoint` worker calls `resumeAgentRun(runId)` and discards the return; `resumeAgentRun` is a Sprint 3A library entry point that never had Sprint 3B `runAgenticLoop` wiring built. Surgical doc-and-observe fix applied (commit `4d824c24`): honest header comment, `oauth.resume.deferred_no_handoff` warning log, and `OPLB-DR-2026-05-19-D1` deferred-items entry in tasks/todo.md gating `WAITPOINT_PRIMITIVE_ENABLED=true` flag-flip on Sprint 3B completion. Flag stays default-false so zero production impact. Codex iteration 2 confirmed APPROVED with zero new findings. Log hash recorded in commit `519a52a6`.

- **2026-05-19** — pr-reviewer round 4 (post-dual-reviewer re-review): APPROVED. Log: `tasks/review-logs/pr-review-log-oss-pattern-lifts-bundle-2026-05-18T23-50-00Z.md`. Zero new findings — surgical doc-and-observe additions confirmed correctly placed, levelled, and routed.

## Doc Sync gate

Candidates derived from diff: `waitpoints` (table), `waitpointService` / `waitpointServicePure`, `createWaitpoint` / `completeWaitpoint` / `expireWaitpoints`, `agent-run-resume-from-waitpoint`, `maintenance:waitpoint-expiry-sweep`, `WAITPOINT_PRIMITIVE_ENABLED`, `buildFailStepRunColumnSet`, `stepLifecyclePure`, `0379_waitpoints_primitive`, telemetry events (`waitpoint.created/completed/expired/expired_no_run/expired_no_step/expiry.row_failed`, `oauth.resume.deferred_no_handoff`), `useSingletonQueue`, validators (`validateCreateWaitpointParams`, `validateCompleteInputShapeMatchesKind`, `isCompletableWaitpointRow`, `generateWaitpointPlaintext`).

- architecture.md updated: yes (Waitpoint Primitive section, anchor `waitpoint-primitive`)
- capabilities.md updated: n/a: internal refactor with no capability surface change
- integration-reference.md updated: n/a — no integration behaviour, scope, status, OAuth provider, MCP preset, capability slug, or alias change; OAuth integration card and resume flow remain observable-unchanged under default-off flag
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: n/a — no change to build discipline, conventions, agent fleet, review pipeline, or locked rules (RLS / service-tier / gates / migrations / §8 development discipline)
- CONTRIBUTING.md updated: n/a — no lint-suppression policy or contributor convention change
- frontend-design-principles.md updated: n/a — backend primitive only; zero UI changes
- KNOWLEDGE.md updated: yes (1 entry — `[2026-05-19] Decision — Trigger.dev evaluated, not adopted; waitpoint primitive built instead`)
- spec-context.md updated: n/a
- docs/decisions/ updated: no — spec §1 explicitly authored the Trigger.dev evaluation to KNOWLEDGE.md, not as an ADR; the doc-sync ADR-preference for "chose X over Y" durable decisions is acknowledged but not enforced retroactively in this build. Promotion to an ADR could be a follow-up housekeeping task; not blocking
- docs/context-packs/ updated: n/a — new architecture.md anchor `waitpoint-primitive` added; no existing anchors moved, renamed, or removed (context-pack anchor references unaffected)
- references/test-gate-policy.md updated: n/a — no test gate added, removed, renamed; no umbrella-command change
- references/spec-review-directional-signals.md updated: n/a — spec-reviewer not invoked in this build
- docs/incident-response.md updated: n/a — no SEV / oncall / timeline-log / post-mortem / escalation-path change
- docs/testing-transition-plan.md updated: n/a — no migration trigger, sequencing, or phasing change
- .claude/FRAMEWORK_VERSION + .claude/CHANGELOG.md updated: n/a — repo-specific build; no agent-fleet or framework-convention change
- scripts/verify-* updated: n/a — no gate added/removed/renamed; no suppression-grammar or baseline-expiry-policy change

Grep-verification trail: zero `waitpoint*`, `WAITPOINT_PRIMITIVE_ENABLED`, `useSingletonQueue`, or `buildFailStepRunColumnSet` hits in any registered doc not listed `yes` above; doc-sync investigation procedure executed against all 16 registered docs.

- **2026-05-19** — Phase 2 complete. All reviews APPROVED. Doc-sync gate executed against all 16 registered docs. Handoff written. Transitioning to Phase 3 (finalisation).

## Environment snapshot
- last_chunk_committed: chunk 7
- head: 89f6286a89fe986ee9ca6499c34273c7fcc5fe93
- package_lock_md5: 1fa84d77b2ed10d665849cc70a34b52b
- migration_count: 505
- captured_at: 2026-05-18T21:06:01Z

---

## Phase 1 log

- **2026-05-18** — spec-coordinator launched. Brief: `docs/oss-pattern-lifts-bundle-brief.md`.
- **2026-05-18** — S0 branch sync complete. 2 commits behind main; merged cleanly. Operator override applied for concurrent `browser-vision-grounding` BUILDING state.
- **2026-05-18** — Intent intake complete. Scope class: Significant. UI touch: none (no mockup loop).
- **2026-05-18** — Step 3a duplication check: clear / clear / proceed.
- **2026-05-18** — Step 3b grill-me complete (8 rounds). Key decisions:
  - Prompt-eval suite: OUT of scope (skip criterion not triggered).
  - Both call sites (OAuth + approval) migrate in V1.
  - Token-only authority model for `completeWaitpoint`.
  - Hard cut-off on expiry race (no grace window).
  - Org-scoped RLS only (`app.organisation_id`).
  - Unified queue-based resume via `sendWithTx` for all kinds.
  - Stale bound-run at expiry: silent discard + `waitpoint.expired_no_run` log.
  - Single `WAITPOINT_PRIMITIVE_ENABLED` env var for rollback; removed in follow-up cleanup PR.
- **2026-05-18** — Slug ratified: `oss-pattern-lifts-bundle`. Directory created.

## PLANNING lock override

`operator-override: yes-2026-05-18` — `browser-vision-grounding` was BUILDING on `origin/main` at S0 time. Operator explicitly approved proceeding with a concurrent spec. Both builds tracked under their own `tasks/builds/` slugs.

Step 5 mockup loop: skipped — `ui_touch = false`.
