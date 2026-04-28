# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-04-28-pre-test-brief-and-ux-spec.md`
**Spec commit at check:** `eed49ee78d70c0bdd3e3a318df348fa6e4af2d10`
**Branch:** `pre-test-brief-and-ux-spec`
**Base (merge-base with main):** `e667d24f8a64032a6be81f7da69350fec40725c0`
**HEAD at check:** `c8acd7ede8d4c38ee33f05a8187f275a8a07140c`
**Scope:** all of spec (§1.1 DR2 + §1.2 S8 + §1.3 N7 + §1.4 S3) — caller confirmed all four items implemented.
**Changed-code set:** 27 files (caller-supplied; matches `git diff <feat-commits>^...HEAD`).
**Run at:** 2026-04-28T03:07:52Z

---

## Contents

- [Summary](#summary)
- [Per-item verdicts — §1.4 S3](#14-s3--dashboard-inline-error-banners--conformant-1-manual-step-deferral)
- [Per-item verdicts — §1.3 N7](#13-n7--paginate-brief-artefacts--conformant-1-manual-step-deferral)
- [Per-item verdicts — §1.2 S8](#12-s8--post-commit-websocket-emit-primitive--conformant-3-deferrals)
- [Per-item verdicts — §1.1 DR2](#11-dr2--brief-follow-up-re-invocation--conformant-3-deferrals)
- [Cross-spec items](#cross-spec-items)
- [Mechanical fixes applied](#mechanical-fixes-applied)
- [Directional / ambiguous gaps](#directional--ambiguous-gaps-routed-to-taskstodomd)
- [Files modified by this run](#files-modified-by-this-run)
- [Next step](#next-step)

---

## Summary

- Requirements extracted:     38
- PASS:                       29
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 9
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (9 directional gaps — see deferred items in `tasks/todo.md`).

The implementation lands the structural surface of all four spec items cleanly — every code-path requirement, every interface, every pure helper, every middleware mount, every branch-before-write invariant is present and matches the spec. The directional gaps are about test-scope, manual-smoke recording, and PR-prep workflow checkpoints (todo tickoffs, KNOWLEDGE.md entry, progress.md final summary) — none mechanical, all requiring human judgment to close.

---

## §1.4 S3 — Dashboard inline error banners — CONFORMANT (1 manual-step deferral)

| REQ | Verdict | Evidence |
|-----|---------|----------|
| S3-1 `DashboardErrorBanner.tsx` shared component | PASS | `client/src/components/DashboardErrorBanner.tsx:8-19` |
| S3-2 `failedSourceNames` pure helper | PASS | `client/src/components/dashboardErrorBannerPure.ts:1-15` |
| S3-3 `DashboardErrorMap` 4-key state on `DashboardPage.tsx` | PASS | `client/src/pages/DashboardPage.tsx:22-27, 51-53` |
| S3-4 Atomic `setErrors(cycleErrors)` once per cycle (NOT per promise) | PASS | `client/src/pages/DashboardPage.tsx:187-215` |
| S3-5 Banner mounted above main grid | PASS | `client/src/pages/DashboardPage.tsx:326` |
| S3-6 `ClientPulseDashboardPage` 2-key error state + atomic commit | PASS | `client/src/pages/ClientPulseDashboardPage.tsx:60-89, 108` |
| S3-7 Pure helper test (4-key + 2-key + unknown-key) | PASS | `client/src/components/__tests__/dashboardErrorBannerPure.test.ts` |
| S3-8 Manual smoke recorded in `progress.md` for both pages | DIRECTIONAL — progress.md shows "_pending_" — human-only step | `tasks/builds/pre-test-brief-and-ux/progress.md:42-44` |

## §1.3 N7 — Paginate brief artefacts — CONFORMANT (1 manual-step deferral)

| REQ | Verdict | Evidence |
|-----|---------|----------|
| N7-1 `briefArtefactCursorPure.ts` (encode/decode/isValid, null on garbage) | PASS | `server/services/briefArtefactCursorPure.ts:1-32` |
| N7-2 `computeNextCursor` (`limit + 1` fetch, drop overflow, emit cursor from kept tail) | PASS | `server/services/briefArtefactPaginationPure.ts:16-29` |
| N7-3 `getBriefArtefacts` returns `{items, nextCursor}` with strict tuple-less-than cursor predicate, ORDER BY `(created_at, id) DESC` | PASS | `server/services/briefCreationService.ts:119-185` |
| N7-4 Limit clamp `[1, 200]` + `brief_artefacts.limit_clamped` log only on actual clamp | PASS | `server/services/briefCreationService.ts:124-128` |
| N7-5 Sibling `getAllBriefArtefacts` for full-fetch internal use | PASS | `server/services/briefCreationService.ts:187-216` |
| N7-6 Route handler parses `limit`, decodes `cursor` (null-on-malformed → first page, no 400) | PASS | `server/routes/briefs.ts:76-91` |
| N7-7 `BriefDetailPage` "Load older" button + state + prepend handler | PASS | `client/src/pages/BriefDetailPage.tsx:116-117, 234-251, 281-293` |
| N7-8 Pure cursor test (round-trip, garbage, non-JSON, empty, wrong-shape × 2, wrong types) | PASS | `server/services/__tests__/briefArtefactCursorPure.test.ts` |
| N7-9 Pure pagination test (N<L, N=L, N=L+1, large page, limit=1) | PASS | `server/services/__tests__/briefArtefactPaginationPure.test.ts` |
| N7-10 Integration test (75 seeds → 50+cursor → 25+null cursor; concat; clamping; malformed cursor; 3-step interleave with 5 newer inserts) | PASS | `server/routes/__tests__/briefsArtefactsPagination.integration.test.ts:81-159` |
| N7-11 Manual smoke recorded for >50-artefact Brief | DIRECTIONAL — progress.md shows "_pending_" — human-only step | `tasks/builds/pre-test-brief-and-ux/progress.md:45` |

## §1.2 S8 — Post-commit websocket emit primitive — CONFORMANT (3 deferrals)

| REQ | Verdict | Evidence |
|-----|---------|----------|
| S8-1 `PostCommitStore` with three states (open/closed/absent), AsyncLocalStorage-backed | PASS | `server/lib/postCommitEmitter.ts:1-63` |
| S8-2 `flushAll` is best-effort, transitions to closed, logs `post_commit_emit_flushed` | PASS | `server/lib/postCommitEmitter.ts:29-41` |
| S8-3 `flushAll`/`reset` are terminal — second call is no-op | PASS | `server/lib/postCommitEmitter.ts:30, 43-44` |
| S8-4 Closed-store `enqueue(emit)` runs immediately + logs `post_commit_emit_fallback {reason: 'closed_store'}` | PASS | `server/lib/postCommitEmitter.ts:20-27` |
| S8-5 Middleware: flush on `res.finish` 2xx/3xx, reset + `post_commit_emit_dropped` on 4xx/5xx, reset on `res.close` | PASS — minor note: `dropped` log gated on `droppedCount > 0` (noise reduction vs. spec's literal "always log on 4xx/5xx"); contract preserved | `server/middleware/postCommitEmitter.ts:9-32` |
| S8-6 Mounted in `server/index.ts` AFTER org-tx middleware (spec §0.5 critical invariant) | PASS — note: there is no app-wide org-tx middleware; `withOrgTx` is per-route. The structural property "flush after commit" holds because route handlers complete (committing the inner `withOrgTx`) before `res.finish` fires | `server/index.ts:248` |
| S8-7 `briefConversationWriter.ts` 3 emits replaced with `getPostCommitStore() ? store.enqueue(...) : <inline>` pattern + `no_store` fallback log | PASS | `server/services/briefConversationWriter.ts:206-236` |
| S8-8 Three structured logs (`post_commit_emit_flushed` / `_dropped` / `_fallback`) at named sites | PASS | per S8-2 / S8-5 / S8-4 / S8-7 |
| S8-9 Unit test with all 8 cases per spec §1.2 Tests | PASS | `server/lib/__tests__/postCommitEmitter.test.ts` |
| S8-10 Integration test "middleware → writer → res.finish 2xx → emit fires; 5xx → emit dropped" | DIRECTIONAL — test simulates the lifecycle via raw `createPostCommitStore`/`flushAll`/`reset` calls; does NOT exercise the actual Express middleware nor `briefConversationWriter`. Spec wanted END-TO-END middleware+writer lifecycle | `server/services/__tests__/briefConversationWriterPostCommit.integration.test.ts` |
| S8-11 Manual smoke for 500-rollback case noted in progress.md | DIRECTIONAL — progress.md doesn't show §1.2 manual smoke | `tasks/builds/pre-test-brief-and-ux/progress.md` |
| S8-12 KNOWLEDGE.md entry for the post-commit emit pattern (spec §4 DoD item 6, named explicitly: "the most reusable pattern surfaced by this spec") | DIRECTIONAL — KNOWLEDGE.md diff has no post-commit-emit entry; authoring requires editorial judgment about how the pattern generalises | `KNOWLEDGE.md` |

## §1.1 DR2 — Brief follow-up re-invocation — CONFORMANT (3 deferrals)

| REQ | Verdict | Evidence |
|-----|---------|----------|
| DR2-1 `selectConversationFollowUpAction` pure predicate | PASS | `server/services/conversationsRoutePure.ts:1-9` |
| DR2-2 Predicate matrix test (brief / task / agent_run / agent / null / undefined / null conv / undefined conv) | PASS | `server/services/__tests__/conversationsRoutePure.test.ts` |
| DR2-3 `handleConversationFollowUp` extended to return `{message, route, fastPathDecision}` | PASS — note: literal spec wording says `ConversationMessage` but `writeConversationMessage` returns `WriteMessageResult`; impl uses the existing primitive, response-shape contract still holds | `server/services/briefConversationService.ts:109-162` |
| DR2-4 Branch-before-write mutual exclusion in `routes/conversations.ts` (spec §0.5 critical invariant) | PASS — `selectConversationFollowUpAction` runs at line 105, BEFORE either write call | `server/routes/conversations.ts:99-148` |
| DR2-5 Uniform response shape `{...message, route, fastPathDecision}` on every successful response (spec §0.5) | PASS | `server/routes/conversations.ts:132, 146` |
| DR2-6 Pass `conv.subaccountId ?? null` (spec wording) — impl uses `?? undefined` because `handleConversationFollowUp`'s `subaccountId?: string` rejects `null` | PASS — type-correct adaptation | `server/routes/conversations.ts:119` |
| DR2-7 Telemetry log `conversations_route.brief_followup_dispatched { conversationId, briefId, organisationId, fastPathDecisionKind }` | PASS — note: spec literal says `result.fastPathDecision.kind` but `FastPathDecision` has no `kind` field; impl uses `.route` (closest-equivalent) | `server/routes/conversations.ts:125-130` |
| DR2-8 Integration test exercising route end-to-end against fake LLM provider, asserts (a) one-row write, (b) fast-path classification fires, (c) orchestrator-routing job enqueues for `needs_orchestrator` | DIRECTIONAL — test only covers (a) noop-path one-row write, (b) DB-row→predicate dispatch, (c) writer's no-built-in-dedupe property; LLM classify + orchestrator enqueue assertions punted to manual smoke per the test's own header | `server/routes/__tests__/conversationsRouteFollowUp.integration.test.ts:17-26` |
| DR2-9 `tasks/todo.md § DR2` ticked off | DIRECTIONAL — line 375 still `[ ]`; PR-prep workflow item | `tasks/todo.md:375` |
| DR2-10 Manual smoke against dev DB recorded in progress.md | DIRECTIONAL — progress.md shows "_pending_" | `tasks/builds/pre-test-brief-and-ux/progress.md` |

## Cross-spec items

| REQ | Verdict | Evidence |
|-----|---------|----------|
| X-1 `tasks/todo.md` reflects all four closed items with `[x]` (spec §4 DoD item 2) | DIRECTIONAL — lines 359 (S8), 366 (N7), 374-375 (DR2), 770 (S3) all still `[ ]` (umbrella over DR2-9 + S8-12-tickoff + S3 / N7 tickoffs) | `tasks/todo.md` |
| X-2 `tasks/builds/pre-test-brief-and-ux/progress.md` final session-end summary (§4 DoD item 5) | DIRECTIONAL — only setup section present, no per-task results | `tasks/builds/pre-test-brief-and-ux/progress.md` |
| X-3 Spec §5 Tracking table populated with commit SHAs | DIRECTIONAL — table unmodified, all SHAs `—`, status `pending` | spec §5 |

## Mechanical fixes applied

None. No requirement met all five MECHANICAL_GAP criteria (spec-named target, surgical addition, no new pattern, fits the changed-code set, independently verifiable). Every gap is either authorial (KNOWLEDGE.md entry, progress.md summary, todo tickoffs, tracking-table SHAs), human-only (manual browser/dev smoke), or test-scope-divergence requiring the human to choose between expanding the carved-out integration test vs. accepting the smoke-test deferral.

## Directional / ambiguous gaps (routed to tasks/todo.md)

Routed under: `## Deferred from spec-conformance review — pre-test-brief-and-ux (2026-04-28)`

1. S3-8 — DashboardPage + ClientPulseDashboardPage manual smoke unrecorded
2. N7-11 — BriefDetailPage manual smoke for >50-artefact Brief unrecorded
3. S8-10 — Integration test scope materially smaller than spec (no end-to-end middleware+writer lifecycle exercised)
4. S8-11 — §1.2 500-rollback manual smoke unrecorded
5. S8-12 — KNOWLEDGE.md entry for post-commit emit pattern missing (spec §4 DoD item 6 names this explicitly)
6. DR2-8 — Integration test punts LLM classify + orchestrator enqueue assertions to manual smoke (spec §1.1 Tests required them inside the integration test)
7. DR2-10 — DR2 manual dev-DB smoke unrecorded
8. X-1 — tasks/todo.md spec-named tickoffs (DR2 / S8 / N7 / S3) all still unchecked
9. X-2 + X-3 — progress.md final summary missing; spec §5 Tracking table SHAs missing

## Files modified by this run

- `tasks/todo.md` (appended single section per spec-conformance contract — see deferred items above)
- `tasks/review-logs/spec-conformance-log-pre-test-brief-and-ux-2026-04-28T03-07-52Z.md` (this file)

No code edits. No test edits. No spec edits. The changed-code set on the branch is unchanged from the pre-conformance state.

## Next step

**NON_CONFORMANT** — 9 directional gaps must be closed by the main session before `pr-reviewer`.

The directional gaps split into three groups; the main session should triage each with the user before acting:

1. **Manual-smoke recordings** (S3-8, N7-11, S8-11, DR2-10). Cheapest to close: run the smoke per spec §1.x DoD, paste outcomes into `tasks/builds/pre-test-brief-and-ux/progress.md` § Manual smoke test results.
2. **Integration test scope** (S8-10, DR2-8). Either expand the two integration tests to match spec scope (end-to-end middleware+writer lifecycle for S8; fake-LLM + orchestrator-enqueue assertions for DR2), OR explicitly downgrade the spec's "carved-out integration test" requirement to "smoke + unit" and document the rationale in `progress.md`. The latter is acceptable per spec §0.2's caveat that integration tests are "permitted only inside the existing carve-out for hot-path concerns" — the maintainer can reasonably argue manual smoke covers DR2 hot-path, but that decision is directional.
3. **PR-prep workflow** (S8-12 KNOWLEDGE.md, X-1 todo tickoffs, X-2 progress final summary, X-3 spec §5 Tracking). Conventionally done at PR-open time; flagging now so they don't slip past the consolidated PR description.

After the main session addresses these, run `pr-reviewer` against the whole branch (no mechanical fixes were applied here, so the changed-code set is unchanged).

**Commit at finish:** _filled by auto-commit step below._
