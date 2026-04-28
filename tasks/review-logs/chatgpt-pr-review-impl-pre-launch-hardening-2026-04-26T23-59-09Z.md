# ChatGPT PR Review Session — impl-pre-launch-hardening — 2026-04-26T23-59-09Z

## Session Info
- Branch: `impl/pre-launch-hardening`
- PR: #211 — https://github.com/michaelhazza/automation-v1/pull/211
- Started: 2026-04-26T23:59:09Z
- Prior reviews: `pr-reviewer` then `dual-reviewer` (3 iters, 13 fixes accepted) — see `tasks/review-logs/dual-review-log-pre-launch-hardening-2026-04-26T23-46-19Z.md`
- Round 1 commit: `2a74291d` (pushed to `origin/impl/pre-launch-hardening`)

---

## Round 1 — 2026-04-26T23:59:09Z

### ChatGPT Feedback (raw)

```
Executive summary

This is a large, well-structured hardening PR with strong consistency across specs, invariants, and implementation. The direction is correct and aligns with a production-grade system. The main risks are silent contract drift (UI ↔ backend), RLS posture exceptions scaling unintentionally, and complexity creep in invariants vs enforcement. Nothing here blocks merge, but a few areas should be tightened before locking it in.

What's strong (keep as-is)
1. Spec ↔ implementation alignment (clear traceability spec → invariant → test → code path)
2. Idempotency + decision handling model
3. RLS discipline (with explicit exceptions)
4. Test coverage philosophy (pure tests, contract-focused tests)

Key risks / gaps to address

1. UI ↔ backend contract drift (approval flow)
   In BriefDetailPage.tsx: optimistic append decisionArtefact locally + also rely on WS events for reconciliation. Risk: duplicate artefacts, ordering inconsistencies, temporary divergence. Fix: enforce one source of truth — either optimistic + idempotent dedupe on artefactId, or pure WS reconciliation. Right now hybrid without a hard guard.

2. Option B-lite RLS posture (cached context)
   Service-layer filtering is now the only enforcement for subaccount isolation. Future engineers will forget to apply filters. Mandatory fix: a single shared guard function for all reads (e.g. assertSubaccountScopedRead(query, subaccountId)) + a grep/CI gate that fails if cached-context tables are queried without that guard. Right now the policy is documented, but not enforced mechanically.

3. Invariants vs enforceability gap
   Some invariants are philosophical or multi-step to verify; will silently degrade. Tighten: every invariant must map to at least one of CI gate, unit test, or runtime assertion. If any invariant is "manual only", it will rot.

4. Jobs allow-list pattern
   Allow-list approach is correct, but over time becomes a dumping ground for exceptions. Add constraint: each allow-list entry must include justification comment (you already do this) AND a linked invariant or spec section ID. Prevents "just add it to the list" later.

5. Error contract split (skills)
   v1: flat string error. Future: structured envelope. Risk: consumers depend on both formats; migration painful. Recommendation: add a normalisation layer now — always expose errorCode + errorMessage even if internally flat. Avoids breaking change later.

6. State machine integrity (runs / steps)
   Strong invariants but no visible runtime enforcement that invalid transitions are impossible. Add: centralised assertValidTransition(from, to), used everywhere (not optional).

7. Large PR risk (operational)
   ~10k lines, 125 files. Risk: hidden regressions, hard rollback surface. Recommendation: feature flags OR deploy in shadow mode for critical paths.

Smaller observations (positive)
- Good catch on (organisation_id, user_id, doc_set_hash) uniqueness.
- Naming consistency across specs is strong.
- "Non-goals" section in capabilities is clean and useful.

Final verdict: Ready to merge with minor tightening. If only three to fix: (1) approval-artefact dedup, (2) Option B-lite mechanical enforcement, (3) invariant→enforcement mapping completeness.
```

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| F1 | Approval artefact: optimistic append + WS append both unconditional, no `artefactId` dedup → real duplicate-render bug in `BriefDetailPage.tsx` | technical | implement | auto (implement) | medium | Confirmed real defect by reading `client/src/pages/BriefDetailPage.tsx:99-119, 160-167` — both `brief-artefact:new` and `brief-artefact:updated` blindly spread `[...prev, art]`. Trivial dedup-by-`artefactId` fix; user-experience side is invisible (today: occasional duplicate card; after fix: one card). Internal correctness only — not a UX/copy/workflow change. |
| F2 | Option B-lite mechanical enforcement: shared `assertSubaccountScopedRead` helper + CI gate banning cached-context reads without it | technical-escalated (architectural) | defer | user-approved (defer) | medium | Valid concern. Contradiction-check: spec § 8.7 (`docs/cached-context-infrastructure-spec.md`) explicitly names service-layer filters as the **chosen authority** and Option B-lite as a first-class permanent decision. Adding the guard is not wrong, but it is a new primitive (`DEVELOPMENT_GUIDELINES.md § 8.4`: prefer existing primitives, justify new ones) and a new CI gate that touches every cached-context call site (`referenceDocumentService`, `documentBundleService`, `bundleResolutionService`). scope_signal=architectural → escalated per agent rules. |
| F3 | Every invariant must map to at least one CI gate / test / runtime assertion | technical | reject | auto (reject) | low | Already implemented. `docs/pre-launch-hardening-invariants.md` lines 12-20 explicitly require an `*Enforcement:*` block on every invariant. A grep of the file shows every numbered invariant carries one. The recommendation describes a state the document already enforces. |
| F4 | Allow-list discipline: each entry must cite linked invariant or spec section ID, not just rationale | technical | implement | auto (implement) | low | Cheap doc-only change to `scripts/rls-not-applicable-allowlist.txt` header. File is currently empty, so this is a pre-emptive format rule that prevents the "dumping ground" failure mode ChatGPT flags. Aligns with `DEVELOPMENT_GUIDELINES.md § 6.3` ("System-scoped tables must document … why they are not added to RLS_PROTECTED_TABLES"). |
| F5 | Skill error envelope normalisation layer (always expose `errorCode` + `errorMessage` even when internally flat) | technical | reject | auto (reject) | low | Direct contradiction of locked architectural decision. `docs/pre-launch-hardening-spec.md` § 4.3 + line 2060 lock Branch A (grandfather flat-string `error: <code-string>`) per the cross-spec consistency sweep v1. Invariant 2.4 records "100% adherence to Branch A" as the done-criterion — adding a normalisation layer is partial-Branch-B and reintroduces the mixed-shape problem the invariant exists to prevent. |
| F6 | Centralised `assertValidTransition(from, to)` runtime guard for run / step state machine | technical-escalated (architectural) | defer | user-approved (defer) | medium | Valid in principle. Contradiction-check: invariants 6.1–6.5 already pin transition rules and select static-grep + pure-test enforcement (`docs/pre-launch-hardening-invariants.md` lines 247-285). Adding a runtime assertion is a new primitive used by every status-write site across `workflowEngineService`, `agentExecutionService`, `decideApproval`, etc. — meaningful blast radius. scope_signal=architectural → escalated per agent rules. |
| F7 | Feature flags OR shadow-mode deploy for critical paths to mitigate large-PR rollback surface | technical | reject | auto (reject) | medium | Direct contradiction of locked spec rule. `docs/pre-launch-hardening-invariants.md` § 5.2: "No feature flags. Rollout model is `commit_and_revert` (`docs/spec-context.md:36`). … `feature_flags: only_for_behaviour_modes` … not pre-launch hardening." `convention_rejections` mapping (spec-context.md:73) explicitly rejects this class of finding. |
| F8 | Smaller observations — positive notes on dismissals uniqueness, naming, non-goals | n/a | n/a | no-op | n/a | Praise only; no action required. |

### Auto-applied this round (pending user gate for F2 / F6)

- [auto] F1: dedup-by-`artefactId` in `BriefDetailPage.tsx` for both WS handlers and the optimistic POST-success path.
- [auto] F4: append "format rules" paragraph to `scripts/rls-not-applicable-allowlist.txt` requiring each new entry to cite a linked invariant or spec section ID.

### User decisions

User reply: `all as recommended` — **defer F2 and F6** (both routed to `tasks/todo.md` for follow-up specs).

- F2 (Option B-lite mechanical enforcement): **deferred** — to be specced post-launch when a concrete cross-subaccount data-leak trigger is observed (per spec § 8.7).
- F6 (`assertValidTransition` runtime guard): **deferred** — to be specced as a dedicated lifecycle-guard spec that defines the transition tables and picks the failure mode (throw vs log vs metric).

### Round 1 summary

| Outcome | Count | Items |
|---------|-------|-------|
| Auto-implemented | 2 | F1, F4 |
| Auto-rejected | 3 | F3, F5, F7 |
| User-approved (defer) | 2 | F2, F6 |
| No-op (praise) | 1 | F8 |
| **Total findings** | **8** | |

### Files changed this round

- `client/src/pages/BriefDetailPage.tsx` — F1 dedup-by-`artefactId`
- `scripts/rls-not-applicable-allowlist.txt` — F4 format-rules header
- `tasks/todo.md` — F2 + F6 deferred-item routing
- `tasks/review-logs/chatgpt-pr-review-impl-pre-launch-hardening-2026-04-26T23-59-09Z.md` — this log

### Verdict

**Round 1 complete.** Two implements applied, three rejects auto-decided against locked architectural decisions, two defers user-approved and routed for future specs. PR ready for next ChatGPT iteration if more feedback exists; otherwise PR is mergeable per the original ChatGPT verdict ("Ready to merge with minor tightening").

---

## Round 2 — 2026-04-27T (post round 1 commit `2a74291d`)

- Round 2 commit: `da31bfa7` (pushed to `origin/impl/pre-launch-hardening`)

### ChatGPT Feedback (raw)

```
[Round 2 raw feedback — 7 findings; ChatGPT challenged round-1 deferrals (especially F6),
 raised new ordering bug R2-1, write-side write-leakage R2-2 split from F2, meta-invariant
 R2-3, allowlist function-level annotation R2-4, getErrorCode helper R2-5, assertValidTransition
 minimal R2-6, observability meta-observation R2-7. Full text preserved in commit message.]
```

### User direction

User explicitly directed: **do not defer R2-6**. ChatGPT's follow-up review of triage agreed
("R2-6 is the most important decision in this round" / "is cheap now, very expensive later").
User also accepted ChatGPT's refinements on R2-1 (timestamp nuance) and R2-2 (split F2).

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| R2-1 | Artefact ordering: WS events for distinct artefactIds may arrive out of logical order; sort merged list by `serverCreatedAt` only when incoming has it | technical | implement | auto (implement) | medium | Real subtle bug. Server stamps `serverCreatedAt` at write time; client re-sorts only on stamped incomings to avoid optimistic flicker. Verified `resolveLifecyclePure` is pointer-based, not order-dependent — sort is safe. |
| R2-2 | Write-path leakage: F2 deferred reads, but writes can still attach to wrong subaccount | technical-escalated | defer (extend F2 → F2a/F2b split) | auto (defer) | medium-high | Split F2 into F2a (read) and F2b (write). F2b shipped a minimal observability surface (`server/lib/cachedContextWriteScope.ts`) NOW; full assert promotion deferred under F2b in `tasks/todo.md`. Read leakage = exposure; write leakage = corruption — splitting reflects different blast radii. |
| R2-3 | Meta-invariant: every invariant with runtime implication enforced at boundary, not just tested | technical | reject | auto (reject) | low | Subsumed by R2-6 (state-transition boundary) and F2b log (write-boundary). A philosophical meta-rule without specific code change adds no value beyond what R2-6 + F2b implement. |
| R2-4 | Allowlist function-level annotation `// @rls-allowlist-bypass: <table> [ref: ...]` | technical | implement (minimal, no CI gate) | auto (implement) | low | Extended `scripts/rls-not-applicable-allowlist.txt` format-rules header with rule #4 requiring function-level annotation on every caller of an allow-listed table. Grep-based discoverability; no CI gate (matches F2 architectural choice — new gate is a new primitive). |
| R2-5 | `getErrorCode(err)` helper — handles `string`, `{ code }`, `{ error: string }`, `{ error: { code } }`, `unknown` | technical | implement | auto (implement) | low | Soft helper, doesn't break Branch A (no envelope, no shape change). Stops string-parsing logic spreading across consumers. New file `shared/errorCode.ts` + 13 pure tests. Existing call sites migrate opportunistically. |
| R2-6 | Centralised `assertValidTransition(from, to)` runtime guard — minimal version, do NOT defer | technical | implement | user-directed (implement) | medium | **User-directed implement — round-1 defer overturned.** Minimal coverage scope per ChatGPT advice: terminal-write boundaries only (post-terminal mutation, terminal→terminal, unknown-status target). New `shared/stateMachineGuards.ts` + 18 pure tests + wired at 5 critical sites in `workflowEngineService.ts` and `agentRunFinalizationService.ts`. Remaining call sites (decideApproval, intermediate non-terminal moves, run-aggregation paths) routed to follow-up under `CHATGPT-PR211-F6 (FOLLOW-UP)`. |
| R2-7 | Operability/observability meta-observation | n/a | no-op | no-op | n/a | Informational — not actionable inside this PR. Captures that the next bottleneck is operability, not correctness. |

### Auto-applied this round

- **R2-1:**
  - `shared/types/briefResultContract.ts` — added optional `serverCreatedAt` to `BriefArtefactBase`.
  - `server/services/briefConversationWriter.ts` — stamps `serverCreatedAt` at persistence time; returns stamped copies via new `WriteMessageResult.stampedArtefacts`.
  - `server/services/briefApprovalService.ts` — uses stamped copy for the response artefact so optimistic insert sees the same timestamp the WS event will carry.
  - `client/src/pages/BriefDetailPage.tsx` — `mergeArtefactById` re-sorts by `serverCreatedAt` when incoming carries one; falls through to legacy replace-or-append for optimistic inserts without timestamps.

- **R2-2 (F2b minimal):**
  - `server/lib/cachedContextWriteScope.ts` — observability helper logging the `(organisationId, subaccountId)` scope tuple at every cached-context write boundary.
  - `server/services/referenceDocumentService.ts:create` and `server/services/documentBundleService.ts:create` — wired as the representative call sites; remaining call sites adopt under the deferred F2b spec.

- **R2-4:**
  - `scripts/rls-not-applicable-allowlist.txt` — extended format-rules header with rule #4 (function-level `@rls-allowlist-bypass` annotation requirement, grep-based, no CI gate).

- **R2-5:**
  - `shared/errorCode.ts` — new `getErrorCode(input)` helper; handles flat string, `{ code }`, `{ error: string }`, `{ error: { code } }`, null/undefined, Error-like objects.
  - `shared/__tests__/errorCodePure.test.ts` — 13 pure tests covering all input shapes.

- **R2-6:**
  - `shared/stateMachineGuards.ts` — new pure module; `assertValidTransition({ kind, recordId, from, to })` for `agent_run` / `workflow_run` / `workflow_step_run`. Throws `InvalidTransitionError` when `from` is terminal and `from !== to`, or when `to` is unknown. Same-state writes (idempotent retry) always pass.
  - `shared/__tests__/stateMachineGuardsPure.test.ts` — 18 pure tests.
  - `server/services/workflowEngineService.ts` — wired at `completeStepRunInternal` step terminal write, `completeStepRunInternal` context-overflow run-level terminal write, `failStepRun`, and dispatch-error path (log-and-skip variant since the outer block is itself an error handler).
  - `server/services/agentRunFinalizationService.ts` — wired at `finaliseAgentRunFromIeeRun` pre-update assertion.

### Routed to follow-up

- **F2 → F2a (read-side mechanical enforcement)** — existing deferred item retained.
- **F2b (write-side mechanical enforcement)** — new deferred item; promotes the log helper to a hard assertion with explicit `{ orgScoped: true }` discriminator.
- **F6 FOLLOW-UP** — extend `assertValidTransition` coverage to remaining status-write sites; add transition tables for intermediate non-terminal moves.

### Round 2 summary

| Outcome | Count | Items |
|---------|-------|-------|
| Auto-implemented | 4 | R2-1, R2-4, R2-5, R2-6 |
| Auto-rejected | 1 | R2-3 |
| Auto-deferred (split into follow-ups) | 1 | R2-2 (→ F2b) |
| No-op (informational) | 1 | R2-7 |
| **Total findings** | **7** | |

### Files changed this round

- `shared/stateMachineGuards.ts` (new)
- `shared/__tests__/stateMachineGuardsPure.test.ts` (new)
- `shared/errorCode.ts` (new)
- `shared/__tests__/errorCodePure.test.ts` (new)
- `shared/types/briefResultContract.ts` (added `serverCreatedAt`)
- `server/lib/cachedContextWriteScope.ts` (new)
- `server/services/workflowEngineService.ts` (assertValidTransition wiring at 4 sites)
- `server/services/agentRunFinalizationService.ts` (assertValidTransition wiring + import)
- `server/services/briefConversationWriter.ts` (stamp `serverCreatedAt`; return stamped copies)
- `server/services/briefApprovalService.ts` (use stamped copy in response)
- `server/services/referenceDocumentService.ts` (logCachedContextWrite)
- `server/services/documentBundleService.ts` (logCachedContextWrite)
- `client/src/pages/BriefDetailPage.tsx` (sort by `serverCreatedAt` in `mergeArtefactById`)
- `scripts/rls-not-applicable-allowlist.txt` (rule #4 — function-level annotation)
- `tasks/todo.md` (F2 split into F2a + F2b; F6 follow-up entry)

### Verdict

**Round 2 complete.** ChatGPT's two "must do before merge" items (R2-6 assertValidTransition, R2-1 ordering) shipped. R2-5 + R2-4 shipped as low-effort high-leverage additions. R2-2 split into F2a/F2b with F2b's minimal log/assert shipped now and full enforcement deferred. R2-3 rejected as subsumed by R2-6 + F2b. R2-7 captured as a "next phase" pointer (operability is the next bottleneck per ChatGPT's meta-observation). PR remains mergeable.

---

## Round 3 — 2026-04-27T (post round 2 commits `da31bfa7` / `f24a7220`)

- Round 3 commit: `2ff566a9` (pushed to `origin/impl/pre-launch-hardening`)

### ChatGPT Feedback (raw)

```
[Round 3 raw feedback — 7 findings; ChatGPT pushed for last 1–2% edge tightenings:
 R3-1 stable sort tiebreaker, R3-2 unguarded transition logging, R3-3 getErrorCode
 fallback for thrown Errors, R3-4 structured cached-context log fields, R3-5
 allowlist annotation function-name binding, R3-6 lifecycle determinism check,
 R3-7 meta "diminishing returns" note.]
```

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| R3-1 | Sort needs stable tiebreaker (artefactId) — multi-WS sequence can oscillate without it | technical | implement | auto (implement) | low-medium | Real correctness bug. ISO timestamps with second-precision can collide; tiebreak by `artefactId` (immutable, unique) gives deterministic ordering across re-sorts. |
| R3-2 | assertValidTransition coverage gap on resume/retry/agentic-loop terminal-write paths | technical | implement (log-only signal — full coverage stays in F6 follow-up) | auto (implement) | low | Added `describeTransition()` companion in `shared/stateMachineGuards.ts`. Wired at the two non-IEE agent-run terminal writes in `agentExecutionService` (`finishLoop_normal`, `finishLoop_catch`) with `guarded: false` so log queries can quantify the unguarded surface area. Full assertion adoption stays as `CHATGPT-PR211-F6 (FOLLOW-UP)`. |
| R3-3 | `getErrorCode` returns null for `new Error('msg')` — caller-side string parsing leaks back in | technical | implement | auto (implement) | low | Added optional `defaultCode` parameter (default null preserved for back-compat). Caller passes `'unknown_error'` to convert "no code found" into a recognisable sentinel. Importantly: `Error.message` is NOT treated as a code (free text ≠ stable code) — explicit test asserts this. |
| R3-4 | F2b log: add explicit `table` / `operation` / `hasSubaccountId` fields | technical | implement | auto (implement) | low | Cheap now, painful later. Promoted `CachedContextWriteScope` to require `table` + `operation` and added a `hasSubaccountId` boolean shortcut so log queries don't need to derive it. |
| R3-5 | Allowlist annotation must bind to function name (rename / move drift) | technical | implement | auto (implement) | low | Doc-rule extension: `// @rls-allowlist-bypass: <table> <function_name> [ref: ...]` — `<function_name>` MUST match the immediately-following declaration. Reviewer grep `@rls-allowlist-bypass` lists every annotated caller; mismatched annotations are surface-able by inspection. No CI gate (deliberate — matches F2 reasoning). |
| R3-6 | Lifecycle determinism: confirm `resolveLifecyclePure` stable under reordered inputs | technical | implement | auto (implement) | low | Added 2 pure tests proving `chainTips` / `superseded` are by-key identical across 4 input permutations. Resolver is pointer-based (parentArtefactId lookups), so determinism follows from algorithm — tests prevent regression. |
| R3-7 | Meta: "you're done with correctness work; diminishing returns from here" | n/a | no-op | no-op | n/a | Acknowledged. Operability / debuggability is the next phase per ChatGPT round 2 R2-7. |

### Auto-applied this round

- **R3-1:**
  - `client/src/pages/BriefDetailPage.tsx` — `mergeArtefactById` sort comparator now does primary-by-`serverCreatedAt`, tiebreak-by-`artefactId`. Inline comment explains the oscillation failure mode the tiebreaker fixes.

- **R3-2:**
  - `shared/stateMachineGuards.ts` — added `describeTransition()` + `TransitionEvent` interface as a logging companion to `assertValidTransition`. Returns a structured payload for the caller's logger so `shared/` stays free of logger imports.
  - `server/services/agentExecutionService.ts` — wired at the two non-IEE agent-run terminal writes (`finishLoop_normal` line ~1419, `finishLoop_catch` line ~1814) with `guarded: false`.

- **R3-3:**
  - `shared/errorCode.ts` — added `defaultCode` parameter (default `null`); added `Error.message` rejection clarification to JSDoc.
  - `shared/__tests__/errorCodePure.test.ts` — 4 new tests: thrown-Error fallback, null-with-default, message-rejection, unrelated-obj-with-default.

- **R3-4:**
  - `server/lib/cachedContextWriteScope.ts` — promoted `CachedContextWriteScope` to require `table` + `operation`; added `hasSubaccountId` boolean and `CachedContextOperation` type union.
  - `server/services/referenceDocumentService.ts` and `server/services/documentBundleService.ts` — call sites updated to pass the new fields.

- **R3-5:**
  - `scripts/rls-not-applicable-allowlist.txt` — extended format-rules header with the function-name-binding requirement and the rationale for it.

- **R3-6:**
  - `client/src/lib/__tests__/briefArtefactLifecyclePure.test.ts` — 2 new pure tests: chainTips identical across 4 orderings; superseded set identical across 3 orderings.

### Round 3 summary

| Outcome | Count | Items |
|---------|-------|-------|
| Auto-implemented | 6 | R3-1, R3-2, R3-3, R3-4, R3-5, R3-6 |
| No-op (informational) | 1 | R3-7 |
| **Total findings** | **7** | |

### Files changed this round

- `client/src/pages/BriefDetailPage.tsx` (R3-1)
- `shared/stateMachineGuards.ts` (R3-2)
- `server/services/agentExecutionService.ts` (R3-2)
- `shared/errorCode.ts` (R3-3)
- `shared/__tests__/errorCodePure.test.ts` (R3-3)
- `server/lib/cachedContextWriteScope.ts` (R3-4)
- `server/services/referenceDocumentService.ts` (R3-4)
- `server/services/documentBundleService.ts` (R3-4)
- `scripts/rls-not-applicable-allowlist.txt` (R3-5)
- `client/src/lib/__tests__/briefArtefactLifecyclePure.test.ts` (R3-6)
- `tasks/review-logs/chatgpt-pr-review-impl-pre-launch-hardening-2026-04-26T23-59-09Z.md` (this log)

### Verdict

**Round 3 complete.** ChatGPT's three "must do before merge (fast)" items shipped (R3-1 stable tiebreaker, R3-2 unguarded-transition logging, R3-3 getErrorCode fallback). The two "nice to have" items shipped as well (R3-4 structured log fields, R3-5 function-name binding). R3-6 lifecycle determinism verified via test. R3-7 acknowledged — next phase is operability, not correctness. Per ChatGPT round-3 final verdict: PR is "architecturally sound, internally consistent, hardened enough for production".

---

## Round 4 — 2026-04-27T (post round 3 commits `2ff566a9` / `ed770b1c`)

### ChatGPT Feedback (raw)

```
You've crossed the line from "solid PR" into "this is production-grade infrastructure."
There's nothing materially risky left.

Final verdict: You're done. Safe to merge. Architecturally coherent. Resistant to the
common failure modes. Not over-engineered.

Final sanity check (nothing new to build, just confirm) — 4 read-only 30-second checks:
  1. No silent bypass of state guards: no code path writes status that skips both
     assertValidTransition AND guarded:false logging.
  2. Cached-context write logging is actually reachable in at least one real write
     path in tests or dev.
  3. Artefact lifecycle still clean under stress: no code assumes "last item in
     array = latest artefact".
  4. Allowlist annotation is actually used: at least one real allowlisted function
     has the annotation and passes the grep.

Do NOT add more invariants, more guards, or further coverage now. Phase 2 work.

Post-merge non-blocking suggestion: build a "run debugger view" showing state
transitions / artefact chain / decision points / guard violations over time. Your
system is now correct but non-trivial to reason about — that's the next bottleneck.

Run gates, merge, and move on.
```

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| R4-1 | "You're done" verdict — no implementation work | n/a | no-op | no-op | n/a | Reviewer explicitly says no changes; warns against adding more invariants. |
| R4-2 | 4 read-only sanity checks (no-bypass / log-reachable / array-position / annotation-used) | technical | run as confirmations | auto (run, no code) | low | Reviewer-provided pre-merge confirmation pass. Cost is ~30s × 4; value is catching any regression introduced by rounds 1–3. |
| R4-3 | Post-merge "run debugger view" suggestion | technical-deferred | defer (Phase 2 / operability work) | auto (defer) | medium | Reviewer explicitly marks as Phase 2, non-blocking. Aligns with R2-7 / R3-7 ("operability is the next bottleneck"). Routed to `tasks/todo.md` under `CHATGPT-PR211-R4-RUN-DEBUGGER-VIEW`. |

### Sanity check results (R4-2)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | No silent bypass of state guards | ✓ pass | `assertValidTransition` wired at 5 sites (`agentRunFinalizationService.ts:292`, `workflowEngineService.ts:939, 2692, 2723, 2870`); 2 `describeTransition` log sites in `agentExecutionService.ts:1426, 1830` paired with `WHERE runResultStatus IS NULL`; remaining sites covered by pre-existing state-based WHERE clauses. No path skips both new infra AND WHERE guard. |
| 2 | Cached-context write logging reachable | ✓ pass | `logCachedContextWrite` imported and called in `server/services/referenceDocumentService.ts:8` and `server/services/documentBundleService.ts:19` — both real write paths invoked by route handlers. Not dead instrumentation. |
| 3 | No "last = latest" artefact assumption | ✓ pass | Round-3 sort changes added secondary `desc(...id)` to `orderBy(desc(createdAt))` clauses — already "latest first" so `[0]` is latest, not `[length-1]`. Single `artefactChain[length - 1]` use is in `server/lib/briefContractTestHarness.ts:229` (test harness, chain-by-construction order). All other `[length - 1]` patterns are unrelated pagination cursors. |
| 4 | Allowlist annotation actually used | ⚠ N/A by design | `scripts/rls-not-applicable-allowlist.txt` is empty — file header explicitly states "Currently empty — every tenant table on `main` is registered in `rlsProtectedTables.ts`". Zero `@rls-allowlist-bypass` annotations exist in source. Rule is theoretical until first real entry; adding a placeholder to "validate the rule" would violate reviewer's "do NOT add more invariants" guidance. |

### Auto-applied this round

- **R4-3 deferral:** `tasks/todo.md` — added `CHATGPT-PR211-R4-RUN-DEBUGGER-VIEW` deferred-item entry pointing at the "run debugger view" / state-transition timeline / artefact-chain-evolution operability surface as Phase 2 work. Aligns with R2-7 / R3-7 meta-thread.

### Files changed this round

- `tasks/review-logs/chatgpt-pr-review-impl-pre-launch-hardening-2026-04-26T23-59-09Z.md` (this log — Round 4 outcome + sanity check results)
- `tasks/todo.md` (R4-3 deferred-item entry)

### Round 4 summary

| Outcome | Count | Items |
|---------|-------|-------|
| No-op (verdict only) | 1 | R4-1 |
| Confirmed via sanity check (no code) | 1 | R4-2 (3 of 4 pass; check 4 N/A by design) |
| Auto-deferred to Phase 2 | 1 | R4-3 |
| **Total findings** | **3** | |

### Verdict

**Round 4 final.** Reviewer's verdict: "You're done. Safe to merge." All 3 items handled (verdict acknowledged, sanity checks run with 3 pass + 1 N/A-by-design, post-merge debugger-view suggestion deferred to Phase 2). No code changes this round — exactly what reviewer prescribed.

**PR ready for merge.**

---

## Session close

- **Total rounds:** 4 (3 substantive + 1 final verdict)
- **Total findings:** 25 (8 + 7 + 7 + 3)
- **Auto-implemented:** 12 (F1, F4, R2-1, R2-4, R2-5, R2-6, R3-1, R3-2, R3-3, R3-4, R3-5, R3-6)
- **Auto-rejected:** 4 (F3, F5, F7, R2-3)
- **User-approved (defer):** 2 (F2, F6)
- **Auto-deferred (split / Phase 2):** 2 (R2-2 → F2a/F2b; R4-3 → run-debugger-view)
- **No-op (praise / informational / verdict):** 5 (F8, R2-7, R3-7, R4-1, R4-2)

**Final disposition:** PR #211 ready to merge per reviewer's Round 4 verdict and confirmed by 4-check sanity pass. KNOWLEDGE.md updated with reusable patterns from this iteration.

