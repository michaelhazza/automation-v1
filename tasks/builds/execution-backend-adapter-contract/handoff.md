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
