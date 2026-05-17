# Handoff — sandbox-safety-batch

**Build slug:** sandbox-safety-batch
**Spec:** `tasks/builds/sandbox-safety-batch/spec.md`
**Plan:** `tasks/builds/sandbox-safety-batch/plan.md`
**Branch:** `claude/sandbox-safety-batch`
**Source branch at start:** `main` HEAD `795f0fed`

---

## Phase 2 (BUILD) — complete

**Plan path:** `tasks/builds/sandbox-safety-batch/plan.md`
**Chunks built:** 14 (1a, 1b, 2-14)
**Branch HEAD at handoff:** see `git rev-parse HEAD` (most recent commit on `claude/sandbox-safety-batch`)
**G1 attempts (per chunk):** all chunks 1 or 2 attempts; no chunk hit the 3-attempt cap.
**G2 attempts:** 1 (lint 0 errors, typecheck clean)
**G3 attempts:** 3 (1 post-spec-conformance-fix-loop, 1 post-blocker-fix-loop, 1 post-dual-reviewer — all clean)

**spec-conformance verdict:** CONFORMANT_AFTER_FIXES (`tasks/review-logs/spec-conformance-log-sandbox-safety-batch-2026-05-15T10-01-59Z.md`)
- Round 1: NON_CONFORMANT on REQ #31 (`tasks/review-logs/spec-conformance-log-sandbox-safety-batch-2026-05-15T09-27-43Z.md`)
- Fix-loop: commit `79310bbf` wired `telemetryWriter` at 12 of 14 `withSandboxProvider` call sites.
- Round 2: CONFORMANT_AFTER_FIXES. 2 residual log-only paths in private methods of e2bSandbox routed to todo.md.

**adversarial-reviewer verdict:** HOLES_FOUND (advisory; folded into fix-loop)
- F1 confirmed-hole: bare-db in `agentRunSoftDeleteService.ts` on FORCE-RLS table → switched to `getOrgScopedDb()`.
- F2 likely-hole: hashtext 32-bit collision → two-arg `pg_advisory_xact_lock` with full 64-bit UUID-derived entropy.
- F3 likely-hole: `char_length` vs `Buffer.byteLength` unit mismatch → SQL now uses `octet_length`.
- All folded into fix-loop commit `ea26290b`.

**pr-reviewer verdicts:**
- Round 1: CHANGES_REQUESTED (2 blocking + 5 should-fix + 4 consider). Blockers: B1 CHECK constraint vs app byte cap mismatch; B2 seven §8.36 empty-catch sites.
- Round 2 (post fix-loop): APPROVED (0 blocking, 1 should-fix deferred, 3 consider).
- Round 3 (post dual-reviewer): APPROVED (0 blocking, 0 should-fix, 0 consider). Verified all 5 dual-reviewer accepts.

**reality-checker verdict:** READY (Round 2)
- Round 1: NEEDS_WORK on criterion 5 (verify-* gate scripts) — paperwork gap.
- Round 2: READY after CI-deferred acknowledgement persisted in `progress.md`.

**dual-reviewer verdict:** APPROVED (`tasks/review-logs/dual-review-log-sandbox-safety-batch-2026-05-15T11-20-23Z.md`)
- 3 Codex iterations. 5 ACCEPT (race ordering in ceiling monitor, CRLF in test, template version allowlist for `local-dev-v1.0.0`, `credentialAliases.$type` correction + INSERT wire-up, `SUM::bigint` overflow fix, migration 0362 backfill). 3 REJECT.

**Fix-loop iterations:** 2 (post-spec-conformance for REQ #31; post-pr-reviewer-R1 for 5 blockers + 3 adversarial findings).

**REVIEW_GAP entries:** none. All required reviewers ran. `chatgpt-pr-review` enforced separately at Phase 3.

**Notable findings closed during this build:**
- 22 items from the spec (3 critical + 6 high + 5 REQ + 6 medium/observe + 2 additional) — all PASS or operator-acknowledged scope-deferral.
- 3 adversarial findings closed.
- 5 pr-reviewer blockers + 5 should-fix closed (1 deferred to todo.md).
- 5 dual-reviewer accepts closed.

**Notable framing corrections discovered during the build:**
- Spec §4 named `sandbox_harvest_runs` among the 5 missing-FK tables. That table does not exist. Actual 5th table is `sandbox_egress_audit`.
- SANDBOX-ADV-4.1 (case-insensitive credential-leak) was already fixed in PR #287 fix-loop. Chunk 9 verified + added the missing test.
- REQ #11/#28/#29 were already CONFORMANT per spec-conformance Round 2. Chunk 14 recorded acceptance, no code change.
- REQ #35 ambiguity was resolved 2026-05-15 by operator decision: event-driven listener via service-layer enqueue. New canonical helper `agentRunSoftDeleteService.softDeleteAgentRun()` is the only writer of `agent_runs.deleted_at`; an advisory verify gate flags drift.

**Doc-sync gate:** see `progress.md § Doc Sync gate`. KNOWLEDGE.md +6 patterns; all other docs verified clean or n/a.

**Open issues for finalisation (deferred to v2 or follow-up todos in `tasks/todo.md`):**
- REQ #57 v2-deferred (waits on e2b SDK install per SANDBOX-DEF-EGRESS-MECH) — see `req-57-decision.md`.
- 2 private-method log-only telemetry paths in e2bSandbox (`_harvestLogs`, `_harvestArtefacts`) — telemetry-writer wiring deferred per method-signature refactor follow-up.
- `makeTelemetryWriter` tx-context coupling — should-fix from pr-reviewer R2; deferred as documentation-only.
- 98 `from(agentRuns)` reader queries need `isNull(deletedAt)` filter before any caller wires `softDeleteAgentRun()`.
- Schema $type drift on `credentialAliases` — fixed in this build, but consumer integration waits on v2 SDK install.

---

## Phase 3 handoff prep

**Next:** Phase 3 (FINALISATION) runs inline in the same session per operator's autonomous-mode directive. Steps:
1. S2 branch-sync (auto-resolves known-shape conflicts in append-only artefact files).
2. G4 regression guard.
3. PR existence check (create if not present).
4. `chatgpt-pr-review` — MANUAL mode (paste-prompt prepared; operator drives ChatGPT-web rounds).
5. Final doc-sync sweep + KNOWLEDGE.md confirmation.
6. `tasks/todo.md` cleanup.
7. `tasks/current-focus.md` → MERGE_READY.
8. Apply `ready-to-merge` label.

The session STOPS at step 4 with the chatgpt-pr-review paste prompt ready for the operator.

---

## Phase 3 (FINALISATION) — complete

**PR number:** #326
**chatgpt-pr-review log:** `tasks/review-logs/chatgpt-pr-review-sandbox-safety-batch-2026-05-15T*.md` (4 rounds; R4 APPROVED)
**spec_deviations reviewed:** n/a (no spec_deviations recorded in Phase 2 handoff)

**Doc-sync sweep verdicts:**
- architecture.md updated: no — grepped sandbox helpers + sandbox_harvest_runs; zero stale references. New helpers are implementation details under existing § Sandbox Isolation primitive section.
- capabilities.md updated: n/a: internal refactor with no capability surface change
- integration-reference.md updated: n/a — sandbox is internal subsystem, not external integration
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: no — no changes to build discipline, conventions, agent fleet, or §8 rules
- frontend-design-principles.md updated: n/a — no UI changes
- KNOWLEDGE.md updated: yes (6 entries appended at Phase 2; cross-checked at Phase 3)
- spec-context.md updated: n/a — feature pipeline, not spec-review

**KNOWLEDGE.md entries added:** 6 (bare-db on FORCE RLS; hashtext 32-bit collision; char_length vs Buffer.byteLength; Drizzle $type is documentation; migration CHECK without backfill; optional-callback wiring at every caller)

**tasks/todo.md items removed/closed by this build:** 22 (3 critical + 6 high + 5 spec-conformance REQ + 6 medium/observe + 2 additional from the sandbox-isolation backlog sections)

**chatgpt-pr-review summary (4 rounds):**
- R1: F1 (3-layer tx-contract enforcement) + F2 (UTC quota boundary) — both applied.
- R2: F2 (ENOENT-only catch in resolveTemplateVersion + 2 new tests) applied; F1 duplicate auto-rejected per operator memory rule.
- R3: F1 duplicate (3rd raise) auto-rejected; minor advisory (docstring alignment) applied.
- R4: APPROVED. Operator-override on F1 implemented in R3→R4 transition — added named `assertOrgScopedTransactionActive()` helper to make the transaction-liveness contract visible at the assertion call site (mechanically equivalent to the prior runtime check but explicit by name). Hashtext docstring drift cleaned up as minor advisory.

**ready-to-merge label applied at:** 2026-05-15T22:00:11Z
