# Handoff — oss-pattern-lifts-bundle

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md
**Branch:** spec-review/oss-pattern-lifts-bundle
**Build slug:** oss-pattern-lifts-bundle
**UI-touching:** no
**Mockup paths:** n/a
**Spec-reviewer iterations used:** 5 / 5 (cap reached)
**ChatGPT spec review log:** tasks/review-logs/chatgpt-spec-review-oss-pattern-lifts-bundle-2026-05-18T12-58-54Z.md
**Open questions for Phase 2:** none
**Decisions made in Phase 1:**

- Prompt-eval suite is OUT of scope (skip criterion not triggered — no production regression found by clients before the team). Deferred to a separate Standard build when triggered.
- Both call sites (OAuth in `agentResumeService.ts` + approval in `dispatch.ts`) migrate to the waitpoint primitive in V1, gated by `WAITPOINT_PRIMITIVE_ENABLED` env var. Follow-up cleanup PR removes old paths once production confirms both work.
- Token-only authority model: `completeWaitpoint` takes plaintext (OAuth — user presents it) or `waitpointId` (approval — internal call). No permission-key lookup in the service layer; authority checked at the route layer.
- Hard cut-off on expiry: `UPDATE WHERE expires_at > now()` — no grace window.
- Org-scoped RLS only (`app.organisation_id` GUC). `subaccount_id` is metadata, not an RLS predicate.
- Unified queue-based resume for OAuth via `sendWithTx` + `agent-run-resume-from-waitpoint` pg-boss job. Approval resume stays synchronous (Path B — `reviewService.approveItem`'s existing inline `resumeActionCallAfterApproval`); no new queue. OPLB-SR-IT4-D1 in `tasks/todo.md` tracks the future async-ification option.
- Stale bound-run at expiry: silent discard with `waitpoint.expired_no_run` log line.
- Single `WAITPOINT_PRIMITIVE_ENABLED` env var for both call sites; removed in follow-up cleanup PR.
- `resume_queue` is nullable; `kind='approval'` enforced NULL by DB CHECK (approval doesn't enqueue on completion); `kind='oauth'` enforced non-null by DB CHECK.
- Approval waitpoints store `id` (not plaintext) in `actions.metadataJson.waitpointId` — plaintext discarded after create.
- Telemetry split: live execution log + structured log when `bound_run_id IS NOT NULL` (OAuth only in V1); structured log only for approval (no bound agent run).
- `buildFailStepRunColumnSet` pure helper extracted to `stepLifecyclePure.ts`, consumed by both `failStepRunInternal` and `expireWaitpoints` approval-kind cleanup — closes the column-drift class.
- Migration number is `<NNNN>` placeholder; claim at merge time.

---

## Phase 2 (BUILD) — complete

**Plan path:** tasks/builds/oss-pattern-lifts-bundle/plan.md
**Chunks built:** 7
**Branch HEAD at handoff:** 87e88f57edac8d3c83f560f8d3df95c7ad9db83c
**G1 attempts (per chunk):** Chunk 1: 1, Chunk 2: 2 lint + 2 typecheck, Chunk 3: 1 lint + 2 typecheck, Chunk 4: 1, Chunk 5: 1, Chunk 6: 1, Chunk 7: 1
**G2 attempts:** 1 (lint 0 errors / 883 pre-existing warnings, typecheck clean)
**G3 attempts (post each fix-loop):** fix-loop r1: 1, fix-loop r2: 1
**spec-conformance verdict:** CONFORMANT (34/34 PASS) (tasks/review-logs/spec-conformance-log-oss-pattern-lifts-bundle-2026-05-18T21-28-36Z.md)
**adversarial-reviewer verdict:** HOLES_FOUND (0 confirmed / 2 likely / 4 worth-confirming; Phase 1 advisory, non-blocking). Both likely-holes (L1 atomicity, L2 sweep poisoning) closed via pr-reviewer fix-loops. (tasks/review-logs/adversarial-review-log-oss-pattern-lifts-bundle-2026-05-18T21-28-36Z.md)
**pr-reviewer verdict:** APPROVED (4 rounds total — r1 CHANGES_REQUESTED 6 Blocking → fix-loop r1 → r2 CHANGES_REQUESTED 1 new Blocking → fix-loop r2 → r3 APPROVED → r4 final re-review after dual-reviewer doc-and-observe edits → APPROVED with zero new findings)
**reality-checker verdict:** READY (8/8 criteria verified) (tasks/review-logs/reality-check-log-oss-pattern-lifts-bundle-2026-05-18T22-40-00Z.md)
**Fix-loop iterations:** 2 (round 1: 6 Blocking findings → commit 521873cc; round 2: 1 SAVEPOINT Blocking → commit 8f207f3b)
**dual-reviewer verdict:** APPROVED (Codex, 2 of 3 iterations; applied surgical doc-and-observe fix for the Sprint-3B `runAgenticLoop` hand-off gap pr-reviewer missed across 3 rounds. Commits 4d824c24 + 519a52a6. tasks/review-logs/dual-review-log-oss-pattern-lifts-bundle-2026-05-18T23-31-36Z.md)
**REVIEW_GAP entries:** none
**Doc-sync gate:** all 16 registered docs investigated. `architecture.md` updated (Waitpoint Primitive section); `KNOWLEDGE.md` updated (Trigger.dev decision entry). All others verified `n/a` per the grep-based investigation procedure — see `tasks/builds/oss-pattern-lifts-bundle/progress.md` § Doc Sync gate for the full verdict table.
**Open issues for finalisation:**
- `OPLB-DR-2026-05-19-D1` (tasks/todo.md) — waitpoint OAuth resume worker's `runAgenticLoop` hand-off is deferred to Sprint 3B. **Operator gate: do NOT flip `WAITPOINT_PRIMITIVE_ENABLED=true` in production until Sprint 3B wires the executeRun bootstrap.** Flag is default-false so this build ships safely.
- `OPLB-SR-IT4-D1` (tasks/todo.md, pre-existing) — future async-ification of approval resume.
- 3 Should-fix items deferred from pr-reviewer round 3 to follow-up: pgBossTxSend ON CONFLICT predicate width vs pg-boss partial unique indexes; `sql.raw` UUID template-string interpolation at `waitpointService.ts:316-325` (injection infeasible today but a footgun); missing SAVEPOINT-per-row recovery test.
- 2 Consider items: dead `let` declarations at `agentExecutionLoop.ts:871-872`; flag-flip rollback runbook documentation.
- 2 pre-existing `meta: cardContent as any` lint warnings — pre-date this build, routed to tasks/todo.md.

**Capability Registration (finalisation hint):** `n/a: internal refactor with no capability surface change` — the waitpoint primitive replaces two hand-rolled implementations with no observable change to user-facing capability surface; default-off flag means production behaviour is unchanged until Sprint 3B wires the runAgenticLoop hand-off.
