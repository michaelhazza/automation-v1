# Handoff — agentic-commerce — Phase 2 → Phase 3

**Build slug:** `agentic-commerce`
**Branch:** `claude/agentic-commerce-spending`
**Scope class:** Major
**Spec:** `tasks/builds/agentic-commerce/spec.md` — Final (chatgpt-spec-review APPROVED 5 rounds, 2026-05-03)
**Plan:** `tasks/builds/agentic-commerce/plan.md` — LOCKED (chatgpt-plan-review APPROVED 3 rounds, 2026-05-03)
**Captured:** 2026-05-04
**Phase 2 mode:** manual (no `feature-coordinator` orchestration; Phase 1 → Phase 2 transition was driven directly from the implementation session, so the canonical Phase 2 progress.md table was never advanced and the Phase 2 → Phase 3 handoff doc was not written until Phase 3 entry. This document is that handoff, written in retrospect from the artefacts on disk.)

## Table of Contents

- [Build summary](#build-summary)
- [Phase 2 verification matrix](#phase-2-verification-matrix)
- [Reviewer verdicts (one-line)](#reviewer-verdicts-one-line)
- [Spec deviations](#spec-deviations)
- [Open issues for finalisation](#open-issues-for-finalisation)
- [Deferred backlog (post-merge)](#deferred-backlog-post-merge)
- [Files changed (summary)](#files-changed-summary)
- [Branch state at handoff](#branch-state-at-handoff)
- [Sequence to Phase 3](#sequence-to-phase-3)

---

## Build summary

Stripe SPT-backed agent spending primitive — the second money-movement primitive in the codebase after the LLM Compute Budget (renamed in Chunk 1 from "Budget" to "Compute Budget" to make room for the new Spending Budget). 16 implementation chunks, ~140 files vs `origin/main`, 5 migrations (0270 rename, 0271 schema + RLS + append-only triggers, 0272 cost_aggregates RLS retrofit, 0273 stripe_agent integration_connections columns, 0274 actions.agent_id nullable). New SPEND_APPROVER permission key. New webhook handler (`stripeAgentWebhook.ts`) with HMAC verification, dedup (3 layers), tenant-context derivation, replay protection.

## Phase 2 verification matrix

| Gate | Verdict | Notes |
|---|---|---|
| G1 (per-chunk static) | PASS | Each chunk authored against the locked plan; static checks (lint, typecheck, build:server) green throughout. |
| G2 (integrated state) | PASS | After all 16 chunks, lint = 0 errors, typecheck = 0 errors, build:server clean, build:client clean. 726 baseline lint warnings (unchanged from pre-branch). |
| spec-conformance | CONFORMANT | Run 1 (2026-05-03T14:12:21Z) CONFORMANT_AFTER_FIXES (1 mechanical + 4 directional fixed; 4 additional DGs deferred to todo). Run 2 (2026-05-03T20:51:25Z) re-verification — 4 prior DGs CLOSED, 1 new DG surfaced (`agentId: ''` empty-string drift) and closed in branch. |
| pr-reviewer | APPROVED (after fixes) | Log: `tasks/review-logs/pr-review-log-agentic-commerce-2026-05-03T21-16-46Z.md`. Initial verdict CHANGES_REQUESTED with 5 blocking + 4 strong + 4 nice-to-have. All 5 blocking + 4 strong closed in-branch. 3 of 4 nice-to-have intentionally deferred with rationale (N1 schema-index re-export, N2 advisory-lock-tx comment, N3 `actionId ?? ''` — class already closed by spec-conformance widening). N4 out of scope. |
| dual-reviewer | SKIPPED | Codex unavailable in this session. Allowed per CLAUDE.md (local-dev only; auto-skip permitted). |
| adversarial-reviewer | HOLES_FOUND_TRIAGED | Log: `tasks/review-logs/adversarial-review-log-agentic-commerce-2026-05-03T22-07-50Z.md`. 1 blocker fixed in branch (Finding 2.2 — `connectionStatus` allowlist on Stripe webhook handler). 11 items deferred to `tasks/todo.md`. 3 reviewer findings dissolved against codebase contracts (false positives or by-design). |
| Doc-sync gate | PARTIAL | Inline-only updates landed in `architecture.md` and `docs/capabilities.md` during the implementation session. Full doc-sync sweep is **deferred to Phase 3** per the finalisation-coordinator contract. |

## Reviewer verdicts (one-line)

- **spec-conformance:** CONFORMANT (re-verification scope, with 1 latent DG closed)
- **pr-reviewer:** APPROVED-after-fixes (B1-B5 + S1-S4 closed; N1-N3 deferred with rationale; N4 out-of-scope)
- **dual-reviewer:** SKIPPED — Codex unavailable
- **adversarial-reviewer:** HOLES_FOUND_TRIAGED — 1 blocker fixed; 11 deferred; 3 dissolved

## Spec deviations

None. The plan was followed; no spec edits during implementation. One minor spec text edit during the pr-reviewer fix loop:

- **`tasks/builds/agentic-commerce/spec.md:305-307`** — `spending_policy_id`, `policy_version`, and `mode` documented as gate-time-snapshot rather than insert-time-immutable. This was a code-vs-trigger contradiction surfaced by pr-reviewer B1; the spec text was updated to match the resolved trigger carve-out (mutation permitted only on `proposed → X` transition).

No other spec text changed. Spec lock at commit `59fe9f44` remains the canonical source.

## Open issues for finalisation

The branch is in a state suitable for finalisation. All in-branch fixes are committed; the working-tree is clean (after the adversarial-reviewer fix lands as the next commit). Finalisation must:

1. **S2 branch sync.** Merge `origin/main` into the branch. As of Phase 2 close, the branch was 0 commits behind `origin/main` at S0 (Phase 1 entry). Re-check at S2 — main may have advanced.
2. **G4 regression guard.** Run the regression check.
3. **PR open.** No PR exists. Phase 3 must open it (or, per the four-step plan agreed with the operator, the main session opens it before launching Phase 3 in a fresh session).
4. **chatgpt-pr-review.** Manual ChatGPT-web rounds.
5. **Doc-sync sweep.** Per `docs/doc-sync.md`. Inline updates have already landed in `architecture.md` and `docs/capabilities.md`; the sweep should verify no other reference doc was invalidated by the schema rename, the new SPEND_APPROVER permission, the Stripe webhook handler, or the new state machine. Specifically check:
   - `architecture.md` § Key files per domain (new spend domain entry points)
   - `architecture.md` § Architecture Rules (state-machine guards, RLS-protected tables list)
   - `docs/capabilities.md` (new "Agent spending" capability + 6 new skills)
   - `KNOWLEDGE.md` (any pattern worth extracting from the 16-chunk build)
   - `references/project-map.md` and `references/import-graph/` regeneration
6. **KNOWLEDGE.md pattern extraction.** Candidate patterns to consider:
   - Trigger-based append-only with caller-identity GUC (`app.spend_caller`, `set_config(..., true)` / `SET LOCAL`) — the `agent_charges` table is the codebase's first use; previous append-only tables (`llm_requests`, `audit_events`, `mcp_tool_invocations`) used app-layer enforcement.
   - Three-table approval-channel grant model (`org_approval_channels`, `subaccount_approval_channels`, `org_subaccount_channel_grants`) — first cross-tenant grant primitive; useful template for future cross-tenant feature gates.
   - Pre-insert + post-resolution-snapshot pattern for state-machine rows (the B1 / spec §305-307 pattern: insert with placeholder, lock + read + UPDATE inside the same advisory-lock transaction).
   - ISO 4217 minor-unit exponent enforcement at *both* webhook ingestion and request creation (single pure helper consumed at two boundaries).
   - Webhook `connectionStatus` allowlist (NOT exclusion-list) — the adversarial-reviewer Finding 2.2 fix is a generalisable pattern for any webhook where the secret persists across state changes.
7. **`tasks/todo.md` cleanup.** The new "Deferred from adversarial-reviewer — agentic-commerce (2026-05-03)" section adds 11 items to the post-merge backlog. Phase 3 should leave them untouched; they will be picked up in a follow-up sprint.
8. **`tasks/current-focus.md` → MERGE_READY.** After CI is green and the PR is approved, the mission-control block status field flips from `REVIEWING` → `MERGE_READY`.
9. **Apply `ready-to-merge` label.** Triggers the heavyweight CI test gates that are forbidden locally (per CLAUDE.md §4).

## Deferred backlog (post-merge)

Three sections in `tasks/todo.md` capture the agentic-commerce backlog. None of these are blockers for Phase 3 finalisation; they are tracked for post-merge sprints:

- `## Deferred from spec-conformance review — agentic-commerce (2026-05-04)` — 4 closed checkboxes (DGs from the original 14:12:21Z run, all closed in-branch).
- `## Deferred from spec-conformance review — agentic-commerce (2026-05-03 re-verification)` — 1 closed checkbox (the `agentId: ''` drift, closed in-branch).
- `## Deferred from adversarial-reviewer — agentic-commerce (2026-05-03)` — **11 open items** (AC-ADV-1 through AC-ADV-11). Range from stylistic cleanup to product questions to small reliability/hardening tasks. Lowest-friction picks: AC-ADV-1 (set_config → SET LOCAL consistency), AC-ADV-5 (sql.raw → tagged template), AC-ADV-11 (PATCH disabledAt input validation).

## Files changed (summary)

~140 files vs `origin/main`. Full list available via `git diff --name-only origin/main...HEAD`. High-level grouping:

- **5 migrations** (0270 rename, 0271 schema + RLS + append-only triggers, 0272 cost_aggregates RLS retrofit, 0273 stripe_agent integration_connections columns, 0274 actions.agent_id nullable).
- **10+ new schema files** under `server/db/schema/`.
- **5 new routes** (4 CRUD: `agentCharges`, `approvalChannels`, `spendingBudgets`, `spendingPolicies` + 1 webhook: `webhooks/stripeAgentWebhook`).
- **15+ new services** (`spendingBudgetService`, `chargeRouterService`, `approvalChannelService`, `sptVaultService`, `stripeAgentWebhookService`, `agentSpendAggregateService`, `agentChargeAllowlistPure`, `computeBudgetService`, `connectionTokenService`, `spendSkillHandlers`, etc., each with pure/impure split where relevant).
- **6 new pg-boss jobs** (`agentSpendRequestHandler`, `agentSpendCompletionHandler`, `approvalExpiryJob`, `executionWindowTimeoutJob`, `shadowChargeRetentionJob`, `stripeAgentReconciliationPollJob`).
- **New SPEND_APPROVER permission key** in `server/lib/permissions.ts`.
- **6 new skill markdown files** (`issue_refund.md`, `pay_invoice.md`, `promote_spending_policy_to_live.md`, `purchase_resource.md`, `subscribe_to_service.md`, `top_up_balance.md`).
- **~14 new client surfaces** (`SpendingBudgetsListPage`, `SpendingBudgetDetailPage`, `SpendLedgerPage`, `SptOnboardingPage`, `OrgApprovalChannelsPage`, `SubaccountApprovalChannelsPage`, plus `client/src/components/spend/*` and `client/src/components/approval/GrantManagementSection.tsx`).
- **Worker loop updates** for SPT delivery + completion handler (`worker/src/loop/executionLoop.ts`, `worker/src/persistence/runs.ts`, etc.).

## Branch state at handoff

- HEAD (committed): `be750ad2` (`feat(agentic-commerce): implement spec + close all reviewer findings`) plus the spec/plan-locking + spec-conformance log commits on top, plus the next commit (this handoff + bookkeeping + adversarial-reviewer fix) about to land.
- Working tree: clean after this commit. Static gates: PASS (lint 0 errors, typecheck 0 errors, build:server clean).
- Tests: written but not run locally per CLAUDE.md "test gates are CI-only" rule — CI will run them on PR open.
- Uncommitted state at this handoff write: bookkeeping (this handoff + progress.md + current-focus.md update) + adversarial-reviewer log + the AC-ADV-2.2 webhook fix + tasks/todo.md update. All under the about-to-land bookkeeping commit.

## Sequence to Phase 3

1. Commit this handoff + bookkeeping + adversarial-reviewer fix (main session).
2. Open the PR (main session, manual `gh pr create`).
3. New session: `launch finalisation`.
