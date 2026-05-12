# Handoff — operator-backend

**phase_status:** PHASE_2_COMPLETE
**Paused at step:** Step 8 (chatgpt-spec-review)
**Reason:** chatgpt-spec-review is a manual ChatGPT-web review loop. It runs in a dedicated new Claude Code session via `/final-spec`, not as a sub-agent dispatched from the spec-coordinator session. Operator chose to pause this session, run `/final-spec` in a new session, then resume.

**Phase complete:** SPEC (partial — Codex review done, ChatGPT-web review pending)
**Next phase (when resumed):** BUILD (run `feature-coordinator` in a new session)
**Spec path:** [docs/superpowers/specs/2026-05-12-operator-backend-spec.md](../../../docs/superpowers/specs/2026-05-12-operator-backend-spec.md)
**Branch:** `claude/sandbox-execution-provider-DLfjn`
**Build slug:** `operator-backend`
**Source brief:** [tasks/builds/operator-backend/brief.md](./brief.md) (LOCKED v2.2, 2026-05-12)
**UI-touching:** yes
**Mockup paths:** [prototypes/operator-backend/](../../../prototypes/operator-backend/) (round 3.2, 20 prototypes)
**Mockup log:** [mockup-log.md](./mockup-log.md)

---

## Pipeline state at pause

| Step | Status | Notes |
|---|---|---|
| Step 0 — Context load + PLANNING lock | done | current-focus.md status `PLANNING`, build_slug `operator-backend` |
| Step 1 — TodoWrite list | done | |
| Step 2 — S0 branch-sync + freshness check | done | 2 commits behind → merged; one conflict (`.claude/agents/mockup-designer.md`) resolved by taking main's version (PR #289 + #290 strict superset). Post-merge typecheck clean. |
| Step 3 — Brief intake + UI-touch detection | done | Brief was already LOCKED v2.2 with 4 iteration history; UI-touch detected (mockups present) |
| Step 4 — Build slug derivation + directory creation | done | slug `operator-backend` derived from brief; directory already existed |
| Step 5 — Mockup loop | done | Mockups already at round 3.2 ("brief v2/v2.2 alignment sync"); 20 prototypes complete; operator confirmed treating the mockup loop as closed |
| Step 6 — Spec authoring | done | `docs/superpowers/specs/2026-05-12-operator-backend-spec.md` authored (1644 lines initial; 1805 lines after Codex review) |
| Step 7 — spec-reviewer (Codex loop) | done | 5/5 iterations used (cap hit), NEEDS_REVISION. 89 mechanical fixes applied across 5 commits. 1 directional finding routed to `tasks/todo.md § operator-backend deferred items` (OP-BACKEND-SR1 — capability literal import surface). Spec is mechanically much tighter; Codex was still surfacing ripples on iter 5 (expected for a Major spec of this size). Final report: `tasks/review-logs/spec-review-final-operator-backend-2026-05-12T06-12-00Z.md` |
| Step 8 — chatgpt-spec-review (MANUAL ChatGPT-web) | **pending** | Runs in a new Claude Code session via `/final-spec`. The operator is opening a separate session to do this. |
| Step 9 — Handoff write | partial | This file. Will be re-written as `PHASE_1_COMPLETE` after Step 8 completes. |
| Step 10 — current-focus.md → BUILDING | not yet | Held at PLANNING during pause |
| Step 11 — End-of-phase prompt + auto-commit | not yet | Will fire when Step 8 + 9 close |

---

## Spec-reviewer (Codex) iteration summary

Spec file went from 1644 lines to 1805 lines across 5 iterations. Highlights of mechanical fixes:

- **Schema:** new columns `settings_snapshot`, `cancel_requested_at`/`_by`, `credential_start_mode` (immutable, distinct from mutable `credential_mode`), `operator_chain_failure_count`, `gc_started_at`. UNIQUE key on `operator_runs` widened to `(agent_run_id, attempt_number, chain_seq)` so fresh-profile restart can reuse `chain_seq=1`.
- **State machines:** hard-cap-unresumable transitions, paused-state pre-conditions, cancellation sequencing, finaliser-redelivery semantics all pinned.
- **Concurrency:** slot accounting moved to `pg_advisory_xact_lock` (resolves unsafe `FOR UPDATE` on a count query). Finaliser idempotency keyed on `event_emitted_at`, not terminal status. Dispatch-crash recovery via `sandbox_start_key + adoptOrStart` (additive extension to Spec B's sandbox primitive, documented in § 2 / § 5.3). Task-terminal-event guard via pg-boss singleton key. Progress handler is sole writer for `last_progress_at` / `step_count`.
- **Inventory + contracts:** 16+ files added to § 5.1 / § 5.3 (notifier, errors helper, encryption helper, conversation artefact, error handler, permissions, CI workflow, OpenTaskView family, sandbox primitive extension, LLM-request writer extension). New contracts for `cs.operator_session.suspended_detected` payload, `ApiKeyEnvelope` shape, conversation-artefact MIME, encryption-helper signatures. Both `OperatorSessionEnvelope` and `ApiKeyEnvelope` now carry `subaccountId` for the three-way subaccount-match.
- **Cost attribution:** pinned on immutable `credential_start_mode` (not the mutable `credential_mode`) so a mid-link fallback swap doesn't retroactively re-attribute the pre-swap rows.

**Codex's cap-hit means:** every round of edits surfaced a new wave of consistency ripples Codex caught in the next round. The cap exhausted the deterministic budget; chatgpt-spec-review (Step 8) provides fresh eyes with different blind spots.

---

## Decisions made in Phase 1

- **S0 conflict resolution (mockup-designer.md):** took main's version verbatim. Main's PR #289 + #290 is a strict superset of branch commit `538f101b` (same codebase-grounding rule; main also enforces per-screen filename enumeration). Round 3 mockups already followed the stricter convention.
- **Mockup loop closed at round 3.2** without an explicit "complete" message in the log. The brief header "ready for spec authoring" + the round-3.2 "brief v2/v2.2 alignment sync" were treated as the close signal. Operator confirmed.
- **Single-phase build.** No sub-phase split. D8 (chain-resume required) and D11 (persistent profile required) are honoured: the whole Operator Backend ships in one phase.
- **Storage choice for per-subaccount settings:** new `subaccount_operator_settings` table rather than six columns on `subaccounts` — keeps the operator concern isolated, mirrors the existing `subaccount_optimiser_settings` shape.
- **Hyphenated namespace** for lifecycle events (`operator-session.*`) and dotted namespace for incident/audit events (`operator.*`). CI gate enforces.
- **Vendor codename "OpenClaw" purged** from code, schema, UI, telemetry, customer-facing copy. The codename appears only in vendor-specific config files (`Dockerfile`, env manifest).
- **Polling stays the V1 visibility primitive.** WebSocket bridge is best-effort. Streaming progress is Phase 3.5.
- **No feature flag for the new adapter.** Registers unconditionally at boot.
- **`server/lib/orgScoping.ts` is the canonical path** (the brief referenced `server/middleware/orgScoping.ts`; corrected in § 2 footnote).
- **Migration numbers 0327–0331** reserved for this spec's 5 migrations (latest existing is 0326 from operator-session-identity).

---

## Open questions for Phase 2

These are flagged in spec § 16 (Open questions) and intentionally NOT blockers:

1. Vendor product name (pinned in `Dockerfile` only).
2. `per_token` row schema linkage to `operator_run_id` (Zod schema update if needed).
3. Conversation-history per-link artefact format (MIME / Zod shape).
4. `is_resumable_now` signal source from the vendor operator runtime.
5. Status-pill colour vs auto-extend banner colour clash — UI implementation disambiguates.
6. Plan-tier display in the suspended-state banner — should not name the vendor.

---

## What to do to resume

1. Open a new Claude Code session.
2. Run `/final-spec` (the chatgpt-spec-review skill shortcut). Follow its manual round-by-round prompts; paste ChatGPT-web responses as instructed. Each round auto-applies mechanical / technical findings; user-facing findings route to you for approval.
3. When `/final-spec` closes (operator says "done" / "approved"), close that session.
4. Return to a new spec-coordinator session: type `launch spec-coordinator` (or `spec-coordinator: resume operator-backend`). The Step 0 PLANNING-lock invariant will detect this PAUSED handoff and resume at Step 9 (handoff finalisation → BUILDING transition).
5. Alternative shortcut: if `/final-spec` writes a clean review log AND the operator wants to skip the spec-coordinator resume, the operator may instead open a `feature-coordinator` session directly — `feature-coordinator` reads this file and treats it as the SPEC handoff (with the note that chatgpt-spec-review review log path is recorded in the review-logs directory). Either path works.

---

## Files touched in Phase 1 (so far)

**Authored (added or substantially modified):**
- `docs/superpowers/specs/2026-05-12-operator-backend-spec.md` (1805 lines, 5 spec-reviewer iterations)
- `tasks/current-focus.md` (PLANNING lock + build_slug `operator-backend`)
- `tasks/builds/operator-backend/handoff.md` (this file)
- `tasks/review-logs/spec-review-final-operator-backend-2026-05-12T06-12-00Z.md` (spec-reviewer final report)
- `tasks/todo.md` (1 OP-BACKEND-SR1 entry routed by spec-reviewer)
- Various spec-reviewer per-iteration log files in `tasks/review-logs/`

**Touched by S0 sync (operator-confirmed):**
- `.claude/agents/mockup-designer.md` (took main's version)

**Pre-existing (read but not modified):**
- `tasks/builds/operator-backend/brief.md` (LOCKED v2.2)
- `tasks/builds/operator-backend/mockup-log.md`
- `prototypes/operator-backend/` (20 prototypes, round 3.2)
- Predecessor specs A / B / C

---

---

## Phase 2 — BUILD (feature-coordinator, 2026-05-12 → 2026-05-13)

**Branch:** `claude/sandbox-execution-provider-DLfjn`
**HEAD at Phase 2 close:** `f464cb45`
**Phase 2 status:** COMPLETE → REVIEWING

### Phase 2 step-by-step

| Step | Status | Notes |
|---|---|---|
| 0 — Context load + BUILDING entry guard | done | chatgpt-spec-review log persisted; current-focus.md → BUILDING |
| 1 — TodoWrite list | done | 12-item chunk list |
| 2 — S1 branch sync | done | 0 commits behind origin/main; no collisions |
| 3 — architect (plan.md) | done | Rev 1: 12 chunks, 931 lines |
| 4 — chatgpt-plan-review | done | Round 1 (6 findings) + Round 2 (4 findings); all applied. Rev 3 plan. Log: `tasks/review-logs/chatgpt-plan-review-operator-backend-2026-05-12T08-30-00Z.md` |
| 5 — plan-gate | done | Operator approved Rev 3 plan |
| 6 — Per-chunk builder loop (12 chunks) | done | All 12 chunks built. G1 (lint + typecheck) passed each chunk. Total: 12 builder runs, 24 G1 checks (6 chunks needed ≤2 retries). |
| 7 — G2 integrated-state gate | done | lint 0 errors, typecheck clean, targeted tests pass |
| 8 — Branch-level review pass | done | spec-conformance (2 rounds: NON_CONFORMANT → CONFORMANT after event-name reconciliation); adversarial-reviewer (4 confirmed holes F1/F2/F3/R1 — all closed); pr-reviewer (CHANGES_REQUESTED → 5 blocking/high issues B1-B4+H1 closed in fix-loop) |
| 9 — Doc-sync gate | done | architecture.md (permissions + capability literals + dual-GUC pattern + migrations row), DEVELOPMENT_GUIDELINES.md (§9 checklist item 9), KNOWLEDGE.md (2 new gotcha entries) |
| 10 — Handoff write | done | This file (Phase 2 section) |
| 11 — current-focus.md → REVIEWING | done | |
| 12 — End-of-phase auto-commit | done | All above committed and pushed |

### Chunk summary

| Chunk | Scope | Commits | G1 attempts |
|-------|-------|---------|-------------|
| 1 | Schemas + migrations 0327-0331 + types + encryption + ExecutionMode | a597f54c | 2 |
| 2 | ExecutionCapability extension + capability CI gate | cc73a04e | 1 |
| 3 | Pure helpers + event registry + error classifier | 2f913244 | 2 |
| 4 | Sandbox template rename + adoptOrStart seam | cf730363 | 1 |
| 5 | Service layer + broker extensions + error handler | 29ac0cec | 2 |
| 6 | Adapter + lifecycle + pg-boss handlers | 600d4a12 | 2 |
| 7 | Routes + SUBACCOUNT_OPERATOR_SETTINGS_WRITE permission | f8e1bd96 | 2 |
| 8 | Client API helpers + shared operator types | 5d8af036 | 1 |
| 9 | Operator settings tab (AdminSubaccountDetailPage) | a6ca0c9e | 2 |
| 10 | Operator UI surfaces (OpenTaskView, modals, filter) | a812a23d | 2 |
| 11 | Docs sweep + ADR-0011 + CS runbook | 5394b5d8 | 1 |
| 12 | Checkpoint-logging gate + build smoke | 0cffc9f4 | 1 |

### Review pass outcomes

**spec-conformance:**
- Round 1 (commit 1f709aa1): NON_CONFORMANT — two gaps: naked event-string literals in handler and divergent event names (chain_link_started vs dispatched) across producer/consumer.
- Fix (commit 4106ad2b): added 20 per-event named constants to `shared/types/operatorBackendEvents.ts`; updated all emit sites; reconciled `runTraceEvent.ts` and `RunTraceEventRenderer.tsx`.
- Round 2 (commit 08c0211c): CONFORMANT.

**adversarial-reviewer:**
- 3 confirmed holes (F1/F2/F3) + 1 likely (R1). All closed in commit `85e07167`:
  - F1: finalisation handler missing dual-GUC → `operatorSessionCompletedHandler` and `agentRunFinalizationService` extended with organisationId/subaccountId and `setOrgAndSubaccountGUC`.
  - F2: fresh-profile-restart always 409 → `operatorRuns` reads wrapped in dual-GUC tx.
  - F3: credential broker missing org predicate → `requestOperatorSessionCredential` and `resolveFallback` require `organisationId` and filter on it.
  - R1: extend-budget not applied → reconciler now calls `subaccountOperatorSettingsService.updateSettings` (later superseded by B1 fix below).
- Log: `tasks/review-logs/adversarial-review-log-operator-backend-2026-05-12T09-xx.md` (content returned in-session; persisted as part of fix commit message).

**pr-reviewer:**
- CHANGES_REQUESTED — 4 blocking (B1-B4) + 1 high (H1) + 2 high + 2 medium.
- Fix-loop (commit 2550f228):
  - B1: extend-budget mutated subaccount-wide settings → per-task `agent_runs.per_task_budget_extension_minutes` column added (migration 0333); dispatcher composes effective cap from settings + per-task delta.
  - B2: dispatcher reads of operator_runs were bare db.select (no dual-GUC tx) → chain-seq always defaulted to 1 → UNIQUE constraint failure on link 2. Fixed: dual-GUC transaction wraps both reads.
  - B3: dispatcher agent_runs writes (orphan-path 'failed' + success-path 'delegated') were bare db.update (no GUC tx) → always 0 rows affected → every dispatch "race lost". Fixed: wrapped in setOrgGUC transactions.
  - B4: finalise parent UPDATE lacked status predicate → late finaliser could overwrite terminal parent. Dead branch also fixed (unreachable && condition removed). Parent UPDATE now excludes all terminal statuses; 0-rows result suppresses post-commit side effects.
  - H1: cancel predicate used `!= 'cancelled'` → could overwrite completed/failed runs. Fixed: closed set from spec §3.10.
- Log: `tasks/review-logs/pr-review-log-operator-backend-2026-05-13T00-00-00Z.md`.

### Key invariants locked in Phase 2

1. Dispatcher sole writer of `paused_* → delegated` (routes enqueue-only).
2. Dispatch success predicate: `IN ('pending','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded')` — excludes delegated, cancelled, wall-clock-exceeded, terminals.
3. All operator-table reads/writes call `setOrgAndSubaccountGUC(tx, orgId, subaccountId)`.
4. Budget extensions accumulate on `agent_runs.per_task_budget_extension_minutes` — never mutate `subaccount_operator_settings`.
5. Finalise parent UPDATE includes NOT-IN terminal predicate; 0-rows suppresses post-commit.
6. Cancel predecessor set is the closed spec §3.10 list — terminals excluded.
7. `operator-session.*` literals confined to `shared/types/operatorBackendEvents.ts` (CI gate enforced).
8. `checkpoint_payload` never logged (CI gate enforced).
9. ExecutionCapability literals confined to canonical definition sites (CI gate enforced).

### What finalisation-coordinator needs to do (Phase 3)

1. **S2 branch sync** — check if main has diverged since `f464cb45`. Auto-resolve append-only artefact conflicts; pause on code conflicts.
2. **G4 regression guard** — run lint + typecheck + targeted tests to confirm no regression from branch sync.
3. **PR existence check** — create PR on `claude/sandbox-execution-provider-DLfjn` if not already open.
4. **chatgpt-pr-review** — manual ChatGPT-web review (separate session). Full branch diff including B1-B4/H1 fix-loop and doc-sync commits.
5. **Full doc-sync sweep** — per `docs/doc-sync.md`. Note that Phase 2 already addressed architecture.md, DEVELOPMENT_GUIDELINES.md, and KNOWLEDGE.md. finalisation-coordinator should re-verify these and sweep the remaining registered docs.
6. **KNOWLEDGE.md pattern extraction** — Phase 2 gotchas already recorded; confirm nothing new surfaced in Phase 3 gap.
7. **tasks/todo.md cleanup** — `OP-BACKEND-SR1` deferred item from spec-reviewer (capability literal import surface) should be triaged: the CI gate `verify-execution-capability-references.sh` addresses it structurally; mark DONE or DEFERRED as appropriate.
8. **current-focus.md → MERGE_READY** and apply `ready-to-merge` label.

### Deferred items (non-blocking)

- **H2** (pr-reviewer): Routes access `db` directly — architecture rule violation. Operator tasks routes import `db` for the `readAgentRunOrThrow` helper and the fresh-profile-restart TX. Deferred: the pattern matches how other complex routes are structured in the repo; refactoring to services-only would require a new `agentRunReadService`. Logged in `tasks/todo.md` as backlog.
- **H3** (pr-reviewer): `_extractIsResumableNow` reads encrypted blob → always false for non-null payloads. Deferred: V1 writes no `checkpoint_payload` data yet; the ingestion pipeline is a separate phase. Add decrypt-before-read at that point.
- **L1/L2** (pr-reviewer): `is_resumable_now` has no pure test; `extendBudgetBodySchema` doesn't enforce 60-min step. Both low-priority; routed to `tasks/todo.md`.

**Last updated:** 2026-05-13 (Phase 2 complete)
