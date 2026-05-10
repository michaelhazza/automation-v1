## Phase 1 (SPEC) — complete (forced precondition write)

**Spec path:** tasks/builds/execution-backend-adapter-contract/spec.md
**Build slug:** execution-backend-adapter-contract
**Branch:** claude/sandbox-execution-provider-DLfjn
**phase_status:** PHASE_1_COMPLETE

**Note:** Spec was authored and locked directly (not via spec-coordinator pipeline). Phase 1 preconditions written manually to unblock Phase 2 at operator direction.

**Spec locked:** 2026-05-10 — after spec-reviewer iterations 1–5 + chatgpt-spec-review rounds 1–2
**Spec review logs:**
- tasks/review-logs/chatgpt-spec-review-execution-backend-adapter-contract-2026-05-10T03-19-00Z.md
- tasks/review-logs/chatgpt-spec-review-execution-backend-adapter-contract-2026-05-10T03-42-11Z.md

**Phase 1 decisions:**
- Spec generalises the IEE delegation lifecycle into a named `ExecutionBackend` contract
- Five existing executionMode values become adapter implementations (no behaviour change in V1)
- `finaliseAgentRunFromIeeRun` → `finaliseAgentRunFromBackend` (generalised)
- `maintenance:iee-main-app-reconciliation` → `maintenance:backend-reconciliation` (generalised)
- `organisations.preferred_backends jsonb` column — schema-only forward-compat, not read by V1 dispatch
- New neutral type file `server/services/agentExecutionTypes.ts` to break import cycle
- New dir `server/services/executionBackends/` for registry, types, and adapter files

---

## Phase 2 (BUILD) — complete

**Plan path:** `tasks/builds/execution-backend-adapter-contract/plan.md`
**Chunks built:** 5 (all chunks committed; G1 passed for each)
**Branch HEAD at handoff:** `7e168c3c`
**phase_status:** PHASE_2_COMPLETE

**Build commits (in order):**
- Chunk 1 (`71fa2289`) — contract types + registry
- Chunk 2 (`3ed247db`) — migration 0313 + schema columns
- Chunk 3 (`f5940599`) — IEE adapters + finaliser generalisation (`8b3cbe3c` quality fix)
- Chunk 4 (`dfbcd0b4`) — native + claude-code adapters (`483886b5` quality fix)
- Chunk 5 (`1d948ecc`) — cutover + cron rename + alias removal (`c60079d1`, `f296b8a3` quality fixes)
- §8.32 cycle-prevention rule (`1898b1ef`) — added in same branch

**Branch-level review pass commits:**
- spec-conformance fix (`bfd86ac5`) — architecture.md stale name citations updated; `318cbd1d` log update
- EBAC-ADV-1 fix (`cb421d95`) — `organisationId` predicates added to IEE dispatch UPDATEs
- pr-reviewer Strong fix-loop (`91a8b09a`) — closed Strong #1 (cycle-prevention coverage), #2 (F2 derivation test), #3 (adapter registration unconditional), #4 (finalise() org predicates) + regex precision fix
- dual-reviewer fix (`44ac0cab`) — restored orphan-row event-emit stamping when `parentRun === null`; `7e168c3c` log update

**G1 attempts (per chunk):** 1 (each chunk passed first lint + typecheck)
**G2 attempts:** 1 (passed first lint + typecheck on integrated state)

**Branch-level review verdicts:**
- **spec-conformance:** CONFORMANT_AFTER_FIXES — 1 mechanical fix (architecture.md stale citations), 2 directional gaps deferred (EBAC-DG-1 F2 legacy-fallback test, EBAC-DG-2 CostModel value-set narrowing). Log: `tasks/review-logs/spec-conformance-log-execution-backend-adapter-contract-2026-05-10T08-46-26Z.md`
- **adversarial-reviewer:** HOLES_FOUND — auto-triggered (migrations + schema). 1 confirmed-hole (EBAC-ADV-1) fixed inline; 2 deferred to backlog (EBAC-ADV-2 race in `(pending, pending)` stuck-pair, EBAC-ADV-3 claudeCodeRunner injection). Log: `tasks/review-logs/adversarial-review-log-execution-backend-adapter-contract-2026-05-10T09-13-06Z.md`
- **pr-reviewer round 1:** CHANGES_REQUESTED — 0 blocking, 4 Strong, 2 non-blocking. Log: `tasks/review-logs/pr-review-log-execution-backend-adapter-contract-2026-05-10T09-26-22Z.md`
- **pr-reviewer round 2 (post fix-loop):** APPROVED — 1 minor non-blocking (cycle-coverage of `agentExecutionLoop.ts`). Log: `tasks/review-logs/pr-review-log-execution-backend-adapter-contract-2026-05-10T09-40-37Z.md`
- **dual-reviewer:** APPROVED — 1 P2 finding accepted (orphan-event-emit regression closed); Codex iteration 2 returned no findings. Log: `tasks/review-logs/dual-review-log-execution-backend-adapter-contract-2026-05-10T09-53-20Z.md`
- **pr-reviewer round 3 (post dual-reviewer):** APPROVED — 1 Strong (orphan-stamp integration test) deferred to EBAC-PR3-S1; 2 non-blocking. Log: `tasks/review-logs/pr-review-log-execution-backend-adapter-contract-2026-05-10T09-59-40Z.md`

**Fix-loop iterations:** 1 (Strong recommendations from pr-reviewer round 1) + 1 (dual-reviewer fix)

**Doc-sync gate verdicts:**
- `architecture.md`: yes (sections — agent run statuses §2192-2194, executionMode dispatch §3064-3076, reconciliation cron §3090-3095) — fixed by spec-conformance
- `docs/capabilities.md`: n/a — internal refactor, no product capability changes
- `docs/integration-reference.md`: n/a — no integration changes
- `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md`: yes — §8.32 cycle-prevention assertion-coverage rule added (commit `1898b1ef`)
- `CONTRIBUTING.md`: n/a — no lint-suppression policy changes
- `docs/frontend-design-principles.md`: n/a — no UI surface
- `KNOWLEDGE.md`: yes (4 entries — cycle-prevention regex precision, domain-primitive registration must not be queue-backend-gated, lifting code into a generic orchestrator drops leaf side-effects, capability-gated optional methods make adapter contract widenings cheap)
- `docs/spec-context.md`: n/a — feature pipeline, not a spec-review session
- `docs/decisions/`: no — `tasks/builds/execution-backend-adapter-contract/spec.md` is the durable record; ADR would duplicate
- `docs/context-packs/`: no — checked architecture.md anchor changes; section names unchanged
- `references/test-gate-policy.md`: n/a — no test-gate policy changes
- `references/spec-review-directional-signals.md`: n/a — feature pipeline, not a spec-review session
- `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md`: n/a — repo-specific architectural change, not framework-level

**Open issues for finalisation (deferred to backlog):**
- `EBAC-DG-1` — Restore F2 legacy-fallback behavioural assertion (acceptance §16 #14) at integration-test level
- `EBAC-DG-2` — Reconcile `CostModel` value-set narrowing with spec §4.1
- `EBAC-ADV-2` — Confirm IEE worker orphan-cleanup covers `(pending, pending)` stuck-pair scenario
- `EBAC-ADV-3` — Confirm `claudeCodeRunner.execute` uses `execFile`/`spawn` not `exec`
- `EBAC-PR3-S1` — Add integration test for orphan-stamp path in `_ieeShared.ts::ieeFinalise`

All five entries are recorded in `tasks/todo.md` under sections "Deferred from spec-conformance review", "Deferred from adversarial-reviewer", "Deferred from pr-reviewer round 3" (consolidated).

**Next:** open a new Claude Code session and type `launch finalisation`. This session ends here.

---

## Phase 3 (FINALISATION) — complete

**PR number:** #281
**chatgpt-pr-review log:** `tasks/review-logs/chatgpt-pr-review-execution-backend-adapter-contract-2026-05-10T10-27-36Z.md`
**spec_deviations reviewed:** n/a (none recorded in Phase 2 handoff)
**REVIEW_GAP:** none — dual-reviewer ran APPROVED in Phase 2

**S2 branch-sync:** merged main commits `2e6089ad` (PR #282 actionRegistry refactor) and `18deec86` (support-desk-canonical chore) cleanly. Auto-resolved 2 known-shape conflicts: `KNOWLEDGE.md` (union) and `tasks/current-focus.md` (ours). `architecture.md` auto-merged without conflict. Commit: `493fc7eb`.

**G4 regression guard:** PASSED on first attempt (lint 0 errors, typecheck clean across both tsconfigs).

**chatgpt-pr-review:** 3 rounds, manual mode.
- Round 1 — CHANGES_REQUESTED. 5 findings, all auto-applied as technical fixes (commit `33d724f6`):
  - B1 — boot-time backend registration is now FATAL; reorder to spec § 8.3 (api → headless → claude-code → iee_browser → iee_dev)
  - B2 — `claudeCodeBackend.backendTaskId` restored to `null`; sessionId stays in `toolCallsLog[0]`
  - T1 — `ParentRunNotDispatchable` rethrown with structured warn (verified no pre-cutover race-loser shape on `origin/main`)
  - T2 — new `FinaliseRequiresDelegatedAdapter` typed error; finaliser throws on capability mismatch instead of silent `false`
  - T3 — registration order fix folded into B1
- Round 2 — APPROVED with 1 optional polish (P1). P1 implemented (commit `f9588578`): comment rewording on `ParentRunNotDispatchable` re-throw site (verified ChatGPT's claim — `ParentRunNotDispatchable` has no `statusCode`, route layer renders 500 today, neutral wording applied)
- Round 3 — APPROVED with 0 findings. Operator signalled `done`. Finalisation commit `01051c78` appended 5 dated KNOWLEDGE.md patterns + log Final Summary + index entries.

**Doc-sync sweep verdicts (coordinator cross-check):**
- `architecture.md`: yes (Run statuses, executionMode dispatch, reconciliation cron — landed earlier in spec-conformance pass commit `bfd86ac5`)
- `docs/capabilities.md`: no — checked `execution backend`, `claude-code`, `iee_browser`, `iee_dev`, `backend adapter`; no capability surface change (internal refactor only)
- `docs/integration-reference.md`: no — checked `execution backend`, `iee`, `backend adapter`; zero matches; no integration behaviour change
- `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md`: yes (`DEVELOPMENT_GUIDELINES.md §8.32` cycle-prevention assertion-coverage rule, commit `1898b1ef`)
- `CONTRIBUTING.md`: n/a — no lint-suppression policy changes
- `docs/frontend-design-principles.md`: n/a — no UI surface in this PR
- `KNOWLEDGE.md`: yes (9 entries — 4 from Phase 2 build + 5 from chatgpt-pr-review finalisation; plus 1 stale-reference correction at line 1577)
- `docs/spec-context.md`: n/a — feature pipeline, not a spec-review session
- `docs/decisions/`: no — `tasks/builds/execution-backend-adapter-contract/spec.md` is the durable record; ADR would duplicate
- `docs/context-packs/`: no — checked architecture.md anchor changes; section names unchanged
- `references/test-gate-policy.md`: n/a — no test-gate policy changes
- `references/spec-review-directional-signals.md`: n/a — feature pipeline, not a spec-review session
- `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md`: n/a — repo-specific architectural change, not framework-level
- `docs/iee-delegation-lifecycle-spec.md` (additional, not in registered list): yes — added "Status: superseded (2026-05-10)" banner pointing at the new spec, citing the three rename pairs

**KNOWLEDGE.md entries added:** 9 (5 from chatgpt-pr-review finalisation: B1 fatal-boot, B2 contract-field semantics, P1 route-error-envelope wording, T1 verify-on-origin-main, T2 throw-on-capability-mismatch; 4 from Phase 2 build: cycle-prevention regex precision, domain-primitive registration must not be queue-backend-gated, lifting code into a generic orchestrator drops leaf side-effects, capability-gated optional methods make adapter contract widenings cheap)

**tasks/todo.md items removed:** 0 (5 deferred EBAC-* items remain open: EBAC-DG-1, EBAC-DG-2, EBAC-ADV-2, EBAC-ADV-3, EBAC-PR3-S1)

**ready-to-merge label applied at:** 2026-05-10T11:06:47Z
