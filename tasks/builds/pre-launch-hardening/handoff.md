# Handoff — pre-launch-hardening — Phase 3 only

**Build slug:** `pre-launch-hardening`
**Branch (implementation):** `claude/pre-launch-phase-1`
**PR:** [#261](https://github.com/michaelhazza/automation-v1/pull/261)
**Scope class:** Significant
**Spec:** `docs/pre-launch-hardening-spec.md` (+ `docs/pre-launch-hardening-mini-spec.md`, `docs/pre-launch-hardening-invariants.md`)
**Plan:** `tasks/builds/pre-launch-hardening/plan.md` (1223 lines, 6 chunks + pre-flight)

---

## Build narrative

This build was an ad-hoc P0 hardening branch — not a spec-driven feature build through the formal three-coordinator pipeline. The implementation was driven directly from the `pre-launch-hardening-spec.md` against `claude/pre-launch-phase-1`, with each P0 item shipped as a chunk commit. Phase 1 (this PR) closed 24 of 25 P0 items; 1 item (C-P0-1 was implemented; C-P0-4/5/7/8 are the remaining items deferred to a follow-up branch per the plan exit gate).

**Items closed by this PR (24 of 25 P0):**
- Security: S-P0-1 through S-P0-9 — OAuth state security, DB rate limiter on auth/forgot/reset, webhook HMAC boot assert, postMessage origin allowlist, multer 25MB cap, GUC propagation on webhook/callback paths
- Customer-facing: C-P0-1 (integration-block E-D4 hard-block), C-P0-2 (OAuth resume restart job), C-P0-3 (Universal Brief routes stub), C-P0-6 (soft-delete sweep)
- Data integrity: D-P0-1 (pg-boss enqueue for onboarding), D-P0-2 through D-P0-7 (durable task events, optimistic lock, run-depth fail-fast, version predicate, 23505 → 409, resolver atomicity)
- Operational readiness: O-P0-1 through O-P0-5 (CI workspace-actor-coverage, verifier sweep, reseed env-guard, backup/restore runbook, skill-analyzer observability)

---

## Branch-level review pass

| Reviewer | Verdict | Notes |
|----------|---------|-------|
| `pr-reviewer` | CHANGES_REQUESTED → resolved | B1, B2, B3, S1, S2, S3 fixed in commit `a06efdcf` |
| `dual-reviewer` | APPROVED with deferrals | Codex 1 iteration; 2 items routed to `tasks/todo.md` |
| `adversarial-reviewer` | HOLES_FOUND → resolved | 1 confirmed (AR-1.1) + 2 likely (AR-2.1, AR-3.1) fixed in `38d7c495`; 4 worth-confirming routed to `tasks/todo.md` in `ac3c53e8` |
| `chatgpt-pr-review` | APPROVED with fixes | 2 rounds; 8 fixes implemented across `161b1081` + `7f5991d6`; 1 deferred item routed to `tasks/todo.md` |

Final HEAD before finalisation: `7f5991d6` — pushed to remote.

---

## Phase 3 (FINALISATION) — complete

**Captured:** 2026-05-04T23:40:44Z
**Coordinator:** finalisation-coordinator (Opus, 1M context)

**PR number:** #261
**chatgpt-pr-review log:** `tasks/review-logs/chatgpt-pr-review-pre-launch-phase-1-2026-05-04T21-49-01Z.md`
**spec_deviations reviewed:** n/a — no Phase 2 handoff existed; this build was an ad-hoc P0 hardening branch, not a spec-driven feature build through the formal pipeline. The build closely tracked `pre-launch-hardening-spec.md` chunk-by-chunk; deviations were limited to (a) the `task_events` table approach for D-P0-5 (chosen over the heavier `agent_execution_events.run_id` nullability migration originally suggested) and (b) E-D4 implemented via `integrationNotResumable` flag on the action registry rather than `idempotencyStrategy === 'unsafe'`. Both noted in architecture.md updates this pass.

**Doc-sync sweep verdicts:**

- KNOWLEDGE.md updated: yes (6 entries appended — 1 resolution + 5 patterns/gotchas covering: task_events resolves the run_id-NOT-NULL gap; `db.transaction()` from module pool needs explicit GUC under FORCE RLS; `app.set('trust proxy', N)` MUST be a hop count, never `true`; `db.execute(sql)` returns `QueryResult` not bare array; fire-and-forget enqueue catch blocks must log; `withOrgTx({ tx: db })` fakes ALS context without GUC)
- architecture.md updated: yes (sections: GHL Agency OAuth Integration — added "CSRF state nonce store" subsection; Key files per domain — refreshed `integrationBlockService` E-D4 entry, refreshed `taskEventService` durability/GUC entry, refreshed `workflowRunService` to add run-depth guard reference)
- capabilities.md updated: n/a — no skill / capability / integration add/remove/rename in this PR; pure hardening
- integration-reference.md updated: n/a — no scope, skill, status, or write-capability changes (CSRF-state durability is internal infrastructure, not an integration-behaviour change)
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: no — checked for log-and-swallow `getOrgScopedDb`, RLS write boundary, gate authoring, multi-tenancy section; the rules invoked by this PR (FORCE RLS GUC, `getOrgScopedDb` discipline, soft-delete on joins) are already documented; this PR follows them rather than introducing new ones
- frontend-design-principles.md updated: n/a — no UI pattern, hard rule, or worked example introduced; client-side change was `useOAuthPopup.ts` origin tightening (security primitive, not a UI design pattern)
- spec-context.md updated: n/a — not a spec-review session
- CONTRIBUTING.md updated: n/a — no lint-suppression policy or contributor-facing convention change
- docs/decisions/ (ADRs): n/a — no durable architectural decision locked this pass; the design choices made (`task_events` separate-table over `agent_execution_events` nullability, `trust proxy` hop count) are documented in KNOWLEDGE.md as patterns rather than ADRs because they're tactical hardening choices subordinate to existing locked contracts
- docs/context-packs/ updated: n/a — no `architecture.md` anchor renames in this pass
- references/test-gate-policy.md updated: n/a — no gate-posture change (the new `workspace-actor-coverage` CI job is an additional gate, not a posture change)
- references/spec-review-directional-signals.md updated: n/a — not a spec-review session
- .claude/FRAMEWORK_VERSION + CHANGELOG updated: n/a — no framework-level change

**KNOWLEDGE.md entries added:** 6
**tasks/todo.md items removed:** 0 (the items in `## Deferred from {dual-reviewer,adversarial-reviewer,chatgpt-pr-review} — pre-launch-phase-1` are the explicit follow-up backlog and stay; one item was annotated to reflect that the KNOWLEDGE.md doc work is now done while the source-code fix remains deferred)

**ready-to-merge label applied at:** 2026-05-04T23:40:44Z
