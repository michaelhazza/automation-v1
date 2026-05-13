# Progress — operator-backend (Phase 2)

**Branch:** `claude/sandbox-execution-provider-DLfjn`
**Build slug:** `operator-backend`
**Spec:** [`docs/superpowers/specs/2026-05-12-operator-backend-spec.md`](../../../docs/superpowers/specs/2026-05-12-operator-backend-spec.md) (LOCKED, 1822 lines, 5 spec-reviewer iterations + 1 chatgpt-spec-review round)
**Plan:** [`plan.md`](./plan.md) (931 lines, 12 chunks)

---

## Phase 2 entry path

Operator took the alternative-shortcut path from [`handoff.md`](./handoff.md) — opened feature-coordinator directly without resuming spec-coordinator. Pre-Phase-2 cleanup performed in-session:
- chatgpt-spec-review log persisted at [`tasks/review-logs/chatgpt-spec-review-operator-backend-2026-05-12T07-12-47Z.md`](../../review-logs/chatgpt-spec-review-operator-backend-2026-05-12T07-12-47Z.md). Round 1 applied F1-F5 (hard-cap state-machine consistency, `paused_wall_clock_exceeded` split, cancel-vs-dispatch invariant, transactional stickiness derivation, UNIQUE-constraint explicitness). ChatGPT verdict: "ready for the feature-coordinator implementation plan."
- `current-focus.md` transitioned `PLANNING → BUILDING`.

---

## Step-by-step state

| Step | Status | Notes |
|---|---|---|
| 0 — Context load + BUILDING entry guard | done | spec-coordinator pre-work absorbed (chatgpt-spec-review log persisted; current-focus.md → BUILDING) |
| 1 — Top-level TodoWrite list (12 items) | done | |
| 2 — Branch-sync S1 + freshness check | done | 0 commits behind origin/main (27 ahead). No migration collisions. No merge needed. No post-merge typecheck owed. |
| 3 — architect (writes plan.md) | done | Rev 1: 12 chunks, 931 lines. Rev 2 applied after chatgpt-plan-review (see Step 4). |
| 4 — chatgpt-plan-review (MANUAL mode) | done | Round 1 verdict: 6 findings (F1-F6) — all auto-applied. Rev 2. Round 2 verdict: 4 findings (R2-F1 blocker, R2-F2 high, R2-F3 medium, cleanup) — all auto-applied. Rev 3. Log: `tasks/review-logs/chatgpt-plan-review-operator-backend-2026-05-12T08-30-00Z.md`. Closed APPROVED. |
| 5 — plan-gate | **pending** | Operator reply: `proceed` / `revise` / `abort`. |
| 6 — Per-chunk builder loop | pending | Expands to 12 sub-items after Step 5 passes. |
| 7 — G2 integrated-state gate | pending | |
| 8 — Branch-level review pass | pending | spec-conformance → adversarial-reviewer (conditional) → pr-reviewer → fix-loop → dual-reviewer (Codex availability check). |
| 9 — Doc-sync gate | pending | |
| 10 — Phase 2 handoff write | pending | |
| 11 — current-focus.md → REVIEWING | pending | |
| 12 — End-of-phase prompt + auto-commit | pending | |

---

## Architect findings worth flagging

**Critical gate not explicit in spec § 5.3:** `ExecutionMode` discriminator extension. Spec § 5.3 inventory did not enumerate the three-site extension needed for adapter registration to succeed at boot:
- `shared/types/executionEnvironment.ts` (union literal)
- `server/services/executionBackends/registry.ts:44` (`EXECUTION_MODES` Set)
- `server/db/schema/agentRuns.ts:41` ($type union)

Architect verified against `registry.ts:44-50` and extended Chunk 1's scope accordingly. Without this, `executionBackendRegistry.register(operatorManagedBackend)` throws `BackendCapabilityViolation` at boot.

## chatgpt-plan-review Rounds 1+2 (Rev 3) — locked architectural decisions

Round 1 surfaced 3 blockers + 2 high + 1 medium + 1 minor. All applied. Round 2 surfaced 1 blocker + 1 high + 1 medium + 1 cleanup. All applied. Rev 3 plan binds six invariants at the top plus the four R2 fixes:

1. **Dispatcher is sole writer of `paused_* → delegated`.** Retry / extend-budget routes are ENQUEUE-ONLY (F1).
2. **Dispatch success predicate** explicitly excludes `delegated`, `cancelled`, `paused_wall_clock_exceeded`, terminals; resets `operator_chain_failure_count=0` on success (F2 + R2 cleanup).
3. **Dual-GUC RLS for the three new tables.** New helper `setOrgAndSubaccountGUC` added in Chunk 1. `setOrgGUC` permitted only for org-scoped tables (F3 + R2-F2).
4. **Fresh-profile-restart predicate restricted** to `paused_chain_failure` AND latest chain-link `failure_class = profile_corruption` OR `failure_reason = OPERATOR_PROFILE_UNRECOVERABLE` (F6).
5. **Migration verification posture:** `npm run db:generate` only locally; CI applies + rolls back on PR open (F5).
6. **Architectural decisions resolved at plan time** (F4): `operator_managed → 'browser'`; canonical LLM-ledger writer `server/services/llmRouter.ts` (verified); route error-handler path is a builder preflight + commit-message documentation; vendor pinned version preserved verbatim from pre-rename file as Chunk 4 acceptance item; `is_resumable_now` field name as Chunk 6 builder-must-inspect acceptance item.

**Round 2 additional locked decisions:**
- **R2-F1:** Progress route path is `GET /api/subaccounts/:subaccountId/operator-sessions/:operatorRunId/progress` (subaccountId in path for dual-GUC before `operator_runs` read).
- **R2-F2:** `setOrgGUC` allowed for org-only tables; `setOrgAndSubaccountGUC` mandatory for all three operator tables. Chunk 7 acceptance criteria include a grep-zero check.
- **R2-F3:** `subaccount_operator_settings` uses `settings_version integer NOT NULL DEFAULT 1` column; ETag = `String(settings_version)`; PATCH increments via `settings_version + 1`. No seconds-based rounding.
- **R2 cleanup:** Dispatcher UPDATE includes `operator_chain_failure_count=0` reset on every successful dispatch.

---

## Vendor codename discipline

`OpenClaw` / `openclaw` (case-insensitive) MUST NOT appear in any chunk's code, schema, telemetry, UI, or customer-facing copy. Permitted only in:
- `infra/sandbox-templates/operator-session/Dockerfile`
- `infra/sandbox-templates/operator-session/CURRENT_VERSION`
- env manifest
- spec / brief / plan / changelog / git history

Chunk 12 verifies via grep before declaring done.

---

## Migration window

Migrations 0327-0331 reserved. Latest existing migration verified at `migrations/0326_operator_session_columns.sql`. Risk R3: concurrent main migration grabbing 0327 before merge → mechanical renumber across 5 .sql + 5 .down.sql + 5 manifest pointers + Drizzle journal regeneration.

---

**Last updated:** 2026-05-12 (Step 4 complete — chatgpt-plan-review Rounds 1+2 applied; plan is Rev 3; awaiting Step 5 plan-gate operator decision)
