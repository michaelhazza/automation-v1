<!-- mission-control
active_spec: docs/baseline-capture-spec.md
active_plan: tasks/builds/baseline-capture/plan.md
build_slug: baseline-capture
branch: claude/baseline-capture
status: REVIEWING
last_updated: 2026-05-05
last_merged_pr: #262
last_merged_slug: stream-2-optimiser-finish
last_merged_branch: stream-2-optimiser-finish
last_merged_at: 2026-05-05T01:33:57Z
last_merged_commit: e75f9dbd
-->

# Current Focus

This file is the sprint-level pointer for the active session. Update it whenever the current spec, branch, or active sprint changes. A stale pointer is worse than no pointer — it actively misleads future sessions. If no spec is in flight, set both fields to `none`.

The HTML comment block at the top of this file is read by the Mission Control dashboard (`tools/mission-control/`). Keep the prose below it in sync with the block; if the two disagree, the prose is canonical and the block must be corrected. Status enum: `PLANNING` | `BUILDING` | `REVIEWING` | `MERGE_READY` | `MERGED` | `NONE`.

For per-session progress (what was done this session, what's next), write to `tasks/builds/<slug>/progress.md` — not here.

**Migration note (for sessions following historical plans):** Prior plans referencing "Update CLAUDE.md §'Current focus'" should now target this file (`tasks/current-focus.md`). Prior plans referencing "Update CLAUDE.md §'Key files per domain'" should now target `architecture.md § Key files per domain`.

---

**Active spec:** `docs/baseline-capture-spec.md`
**Active plan:** `tasks/builds/baseline-capture/plan.md`
**Active build slug:** `baseline-capture`
**Status:** **REVIEWING** — F3 baseline-capture build implemented + spec-conformance CONFORMANT (re-run) + pr-reviewer APPROVED + adversarial-reviewer ALL_CLOSED. HEAD `b516e26a`. Phase 2 handoff at `tasks/builds/baseline-capture/handoff.md`. Next step: launch finalisation-coordinator. **REVIEW_GAP:** dual-reviewer skipped (Codex CLI unavailable in this Claude Code web session); chatgpt-pr-review will be the second-opinion pass during Phase 3.

**Just MERGE_READY:** PR #261 — `pre-launch-hardening`. Phase 1 of the pre-launch P0 hardening plan. 24 of 25 P0 items closed across 6 chunks: OAuth state security (S-P0-1, S-P0-2 via durable `oauth_state_nonces` table, migrations 0277/0278; cleanup job `maintenance:oauth-state-cleanup` every 5 min), security primitives (S-P0-3 verify, S-P0-5 DB rate limiter on auth/forgot/reset with login 60s + forgot/reset 300s windows, S-P0-6 webhook HMAC boot assert, S-P0-7 OAuth postMessage origin allowlist, S-P0-8 multer 25MB cap, S-P0-9 forgot/reset DB rate limiter), auto-start onboarding via pg-boss (S-P0-4 GUC propagation, D-P0-1 `ghl:auto-start-onboarding` queue with singletonKey + per-org dedup window), customer-facing P0s (C-P0-1 integrationBlockService E-D4 hard-block via `integrationNotResumable` flag returning structured `TOOL_NOT_RESUMABLE`; C-P0-2 OAuth resume restart job `run:resumeAfterOAuth` + `pendingRunId` column; C-P0-3 Universal Brief routes stub; C-P0-6 soft-delete sweep), data integrity P0s (D-P0-2 step.approval_resolved emission; D-P0-3 23505→409 conversion via `insertRunRowWithUniqueGuard`; D-P0-4 version predicate via `OptimisticLockError`; D-P0-5 durable `task_events` table migration 0279 with FORCE RLS + explicit GUC inside service-opened transaction; D-P0-6 resolver atomicity; D-P0-7 run-depth fail-fast via `assertRunDepth` from `server/lib/runDepthGuard.ts` with `MAX_WORKFLOW_RUN_DEPTH = 10` throwing `RunDepthExceededError statusCode 422`), operational readiness P0s (O-P0-1 CI workspace-actor-coverage gate, O-P0-2 verifier sweep, O-P0-3 reseed env-guard + backup/restore runbook with task_events orphan validation queries, O-P0-4 verify reseed_restore_users transaction wrap, O-P0-5 skill-analyzer pipeline observability). **Pipeline:** `pr-reviewer` (CHANGES_REQUESTED → 6 fixes in `a06efdcf`) → `dual-reviewer` (Codex 1 iter, APPROVED with 2 deferrals) → `adversarial-reviewer` (HOLES_FOUND: 1 confirmed AR-1.1 task_events GUC + 2 likely AR-2.1 trust proxy / AR-3.1 OAuth resume RLS, all 3 fixed in `38d7c495`; 4 worth-confirming routed to `tasks/todo.md` in `ac3c53e8`) → `chatgpt-pr-review` (2 rounds, APPROVED with fixes; Round 1 4 fixes `161b1081`; Round 2 4 fixes `7f5991d6`). Doc-sync sweep complete. Phase 3 handoff: `tasks/builds/pre-launch-hardening/handoff.md`.

---

**Just merged:** PR #263 — `subaccount-artefacts` (`feat(F1): sub-account baseline artefacts + security hardening`, merged 2026-05-05 as `c3beac0e`). F1 sub-account baseline artefacts: `memory_blocks.tier` (1=always-pinned, 2=domain-matched), `memory_blocks.applies_to_domains`, `subaccounts.baseline_artefacts_status` (versioned JSONB). Six reserved-slug artefacts captured at onboarding via `baseline-artefacts-capture` workflow. Tier-1 blocks prepend to system prompt; Tier-2 blocks load on domain match. JSONB shape locked by `baselineArtefactsStatusSchema` with `version: 1` gate. JSONB updates use atomic `jsonb_set` SQL.

**Merge-ready:** PR #262 — `stream-2-optimiser-finish`. Sub-account Optimiser stream 2 — Phase 2 build closes the spec (`docs/sub-account-optimiser-spec.md`). Shipped: 8 query modules + 8 pure evaluators (snake_case Phase 0 evidence shapes per `shared/types/agentRecommendations.ts`), `runOptimiserScan` orchestration with single-snapshot `withOrgTx` for the 7 non-peer categories + nested `withAdminConnectionGuarded` for skillLatency, `runOptimiserScanJob` pg-boss handler on its own dedicated `optimiser-scan` queue, `registerOptimiserSchedule` + `registerAllOptimiserSchedules` boot-time self-heal (with explicit exclusion in `registerAllActiveSchedules` to avoid double-execution on the generic `agent-scheduled-run` queue), peer-medians materialised view (migration 0277) with FORCE-RLS-bypass via `rlsExclusions`, partial-mode handling when the view is empty, `median_version` snapshot-determinism guard, dashboard wiring via count-only `useAgentRecommendationsTotal()` hook (no full-list pre-mount, satisfies invariant 29), backfill script, AGENTS.md + 8 scan skill markdown files, structured log events at every lifecycle boundary (`optimiser.schedule.registered`, `optimiser.schedule.skipped_duplicate`, `optimiser.startup.recovery_summary`, `optimiser.scan.started/completed/failed/partial/job.completed`). Pipeline: spec-conformance NON_CONFORMANT → CONFORMANT_AFTER_FIXES (8 directional gaps; 6 closed in-branch — DG-1/DG-3/DG-7 fixed + DG-2/DG-5/DG-8 confirmed false-positives; DG-4 timezone + DG-6 cost-gate explicitly deferred per spec/plan) → pr-reviewer CHANGES_REQUESTED (B-1 double-execution-via-two-queues + N-1 stale JSDoc + N-3 redundant null-coalesce all fixed inline; advisory items S-1/S-2/S-3/S-4/N-2/N-4/OPS routed to `tasks/todo.md`) → dual-reviewer SKIPPED (Codex CLI unavailable in web session — REVIEW_GAP) → adversarial-reviewer SKIPPED (diff did not match security surface §5.1.2) → 3 prior-aborted-session ChatGPT findings (F1 invalid cron minute, F2 peer-medians view permission, F3 startup self-heal) committed in `030b234b` → fresh chatgpt-pr-review round 1 verdict APPROVED with 3 observability fixes auto-implemented + 4 verifications confirming pre-existing correctness. Doc-sync sweep complete — `architecture.md` updated (Sub-account Optimiser service layer + Key files per domain row; fixed stale `refreshPeerMediansJob.ts` → `refreshOptimiserPeerMedians.ts`, added queue-split + boot-self-heal + log-events bullets); 2 KNOWLEDGE.md entries appended. chatgpt-pr-review log: `tasks/review-logs/chatgpt-pr-review-stream-2-optimiser-finish-2026-05-05T00-24-31Z.md`. Phase 3 handoff: `tasks/builds/stream-2-optimiser-finish/handoff.md § Phase 3 (FINALISATION) — complete`.

> ⚠ **Dual-reviewer was skipped — reduced review coverage for this build.** The Codex CLI was unavailable in this Claude Code web session. `chatgpt-pr-review` was the primary second-opinion pass. Consider running `dual-reviewer` manually before merge if Codex becomes available.

---

**Just merged:** PR #258 — `workflows-v1-phase-2` **MERGED** to `main` 2026-05-04T10:24:40Z, squash-commit `0b26429c`. Phase 2 of Workflows V1 build — Chunks 9-16 + pre-chunk P0-P6 (real-time WebSocket, permissions API, Open Task View, Ask form, Files tab, Studio canvas, orchestrator changes). Pipeline: spec-conformance NON_CONFORMANT → fixes → pr-reviewer CHANGES_REQUESTED (Tier A + B 15 items applied in `28fb2e25`) → adversarial-reviewer HOLES_FOUND → chatgpt-pr-review 3 rounds (8 implement, 4 verify-safe, 3 deferred). 7 KNOWLEDGE.md patterns added. chatgpt-pr-review log: `tasks/review-logs/chatgpt-pr-review-workflows-v1-phase-2-2026-05-04T09-29-39Z.md`.

**Just merged:** PR #257 — `framework-standalone-repo` **MERGED** 2026-05-04T09:17:36Z, squash-commit `5090dc99`. Phase A portable sync engine — `setup/portable/sync.js` (~1413 lines, no external deps), 9 test files / 113 passing tests using `node:test`, substitution-engine + settings-merge + adopt-non-destructive contracts, FORBIDDEN_STRINGS scanner, `portable_framework_tests` CI gate. 5 KNOWLEDGE.md patterns appended. Phase 3 handoff: `tasks/builds/framework-standalone-repo/handoff.md`.

**Just merged:** PR #255 — `agentic-commerce`. Stripe SPT-backed agent spending primitive (~140 files, 7 migrations 0270–0275). New `SPEND_APPROVER` permission key, Stripe agent webhook handler with HMAC + dedup, 6 new payment skills, 6 new pg-boss jobs, 14 client surfaces. CI ALL GREEN after 5 intermediate failures (each peeled distinct contract layers). 4 KNOWLEDGE.md patterns appended.

**Just merged:** GHL Module C — Agency OAuth (PR #254, 2026-05-03). Two-tier token model, FORCE-RLS `connector_location_tokens` (migration 0269), agency columns on `connector_configs` (0268), webhook lifecycle dispatcher with HMAC + ordering invariant.

**Just merged:** `subaccount-optimiser` (PR #250, `028a9c10`) and PR #251 follow-up (`a460af16`). Stream 1 of the optimiser — agent_recommendations primitive + render version + dashboard wiring. PR #262 (above) is stream 2 — closes the spec.

**Just merged:** PR [#249](https://github.com/michaelhazza/automation-v1/pull/249) — lint-typecheck-post-merge-tasks (`9e751566`, 2026-05-01T09:33:13Z). Drives `npm run lint` and `npm run typecheck` to exit 0; wires `lint_and_typecheck` as a blocking CI gate.

**Recently merged on main:** PR #248 (three-coordinator dev pipeline spec — 2026-05-01), PR #247 (deferred-items-pre-launch impl plan — 2026-05-01), PR #246 (lint-typecheck-baseline — 2026-05-01), PR #245 (mandatory doc-sync sweep — 2026-04-30), PR #244 (tier 1 UI uplift — 2026-04-30), PR #243 (agentic engineering notes — 2026-04-30), PR #242 (paperclip hierarchy + Google Drive external doc refs — 2026-04-30), PR #241 (integration_tests CI gate fix — 2026-04-30), PR #240 (agent-as-employee Phases B/C/D/E — 2026-04-30), PR #234 (pre-prod-boundary-and-brief-api — 2026-04-29).

**Last updated:** 2026-05-05

---

**Pick-next queue:** See `tasks/todo.md` for the durable backlog.
