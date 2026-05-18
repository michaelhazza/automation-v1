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
