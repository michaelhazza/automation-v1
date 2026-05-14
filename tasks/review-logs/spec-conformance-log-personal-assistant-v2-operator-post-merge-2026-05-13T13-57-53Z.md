# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md`
**Spec commit at check:** `e27a218a` (APPROVED) — per plan.md metadata
**Branch:** `claude/personal-assistant-post-merge-audit`
**Base:** merge-base `72f2849316a1bfe56325471579c85d9afddca062` with `main`
**Scope:** focused 8-area audit per caller invocation — Chunks 1a, 1b §4.6, 6, 7, 8
**Changed-code set:** branch carries 250+ files (full Phase 2 build); audit narrowed to the spec sections the caller named
**Run at:** 2026-05-13T13-57-53Z

---

## Caller-named focus areas

1. §4.1 schema (operator_run_files + delegation_outcomes columns + actions.approver_user_id)
2. §4.2 service files (operatorSandboxFileEventBridge* + operatorSessionInitialContextBundler*)
3. §4.3 operatorSessionLifecycleService.startSession integration point
4. §4.5 sandbox-template watcher
5. §4.6 shared types (file.created, file.modified in event criticality registry)
6. §5.7 UPSERT-derived version invariant (no SELECT-based event type)
7. §5.8 initial-context bundle hard cap (4096 bytes)
8. §9.3 concurrent file-write race handling

---

## Summary

- Requirements extracted:     20 (across the 8 focus areas)
- PASS:                       15
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 4
- AMBIGUOUS → deferred:       1
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (5 deferred gaps — see `tasks/todo.md`)

The five deferred items split as:
- Two **schema** divergences (subaccount_id nullability vs spec NOT NULL; data-source for timezone diverged from spec)
- Two **wiring** gaps (startSession and tool-registry handler exposed but no production caller invokes them)
- One **ambiguous** payload-shape divergence (`emittedAt` / `size` vs `sizeBytes` / `type` vs `eventType`)

Each of these is a design decision that the human operator should re-affirm before `pr-reviewer` runs. None is a mechanical missing-export gap.

---

## Requirements extracted (full checklist)

| REQ | Section | Verdict | Evidence |
|-----|---------|---------|----------|
| #1  | §4.1 migration 0345 | PASS | `migrations/0345_ea_controller_style_native_and_operator.sql` — UPDATE with idempotent predicate |
| #2  | §4.1 migration 0346 | PASS | `migrations/0346_actions_approver_user_id.sql` — ADD COLUMN with FK ON DELETE RESTRICT |
| #3  | §4.1 migration 0347 | PASS | `migrations/0347_delegation_outcomes_cross_owner_state.sql` — 3 cols + partial index |
| #4  | §4.1 migration 0348/0349 | DIRECTIONAL_GAP | `subaccount_id` added as NULL in 0349, spec required NOT NULL |
| #4b | §4.8 Drizzle | DIRECTIONAL_GAP | `server/db/schema/operatorRunFiles.ts` — `subaccountId` and `ownerUserId` lack `.notNull()` (paired with #4) |
| #5  | §4.8 Drizzle actions | PASS | `server/db/schema/actions.ts:57-58` defines `approverUserId` with restrict FK |
| #6  | §4.8 Drizzle delegationOutcomes | PASS | `server/db/schema/delegationOutcomes.ts:59-87` declares all 3 new cols + partial index doc |
| #7  | §4.3 RLS manifest | PASS | `server/config/rlsProtectedTables.ts:1302-1308` registers `operator_run_files` |
| #8  | §4.2 bridge impure | PASS | `server/services/operatorSandboxFileEventBridge.ts` — UPSERT, RETURNING version, emit |
| #9  | §4.2 bridge pure | PASS | `server/services/operatorSandboxFileEventBridgePure.ts` — full helper set |
| #10 | §4.2 bundler impure | DIRECTIONAL_GAP | Bundler reads timezone from `subaccount_agents.scheduleTimezone`, not `users` as spec specified; working_hours hardcoded null; recent_activity_summary omitted |
| #11 | §4.2 bundler pure | PASS | `operatorSessionInitialContextBundlerPure.ts` — 4096 cap, deterministic trim |
| #12 | §4.3 startSession wiring | DIRECTIONAL_GAP | `startSession` exists but has zero callers in the codebase; integration into `operator_runs` insert path is not present |
| #13 | §4.3 operatorSessionService wiring | DIRECTIONAL_GAP | `handleFileWriteToolCall` exposes the bridge but has zero callers; tool-registry integration is not present |
| #14 | §4.5 sandbox watcher | PASS | `infra/sandbox-templates/operator-session/file-watcher.js` — chokidar v3, realpath containment, redacted logging, IPC retry |
| #14b| §4.5 Dockerfile+entrypoint | PASS | `Dockerfile` installs `chokidar@3`; `entrypoint.sh` launches watcher; `CURRENT_VERSION` is `0.1.0-file-watcher` |
| #15 | §4.6 criticality registry | PASS | `shared/types/agentExecutionLog.ts:508-511` — all four entries with correct boolean |
| #16 | §4.6 operatorEvents.ts payloads | AMBIGUOUS | Payload shape uses `eventType`/`sizeBytes`/no `emittedAt`; spec §5.7 sketched `type`/`size`/with `emittedAt`. Field-naming convergence with the wider event union is the likely rationale, but not pinned in the spec |
| #17 | §5.7 no preflight SELECT | PASS | Grep for `SELECT.*FROM operator_run_files` in bridge returns zero hits |
| #18 | §5.8 4096-byte hard cap | PASS | `HARD_CAP_BYTES = 4096` constant + test coverage for the cap |
| #19 | §9.3 row 1 — parallel tool-call writes | PASS | Canonical UPSERT with `ON CONFLICT (agent_run_id, path) DO UPDATE SET version = operator_run_files.version + 1` |
| #20 | §9.3 row 2 — watcher dedupe | PASS | `handleWatcherEvent` accepts `existingContentSha256`, calls `shouldWatcherSkip`, returns suppression-is-success |

---

## Mechanical fixes applied

None. Every detected gap is directional (design judgement required) or ambiguous (intent unclear).

---

## Directional / ambiguous gaps (routed to `tasks/todo.md`)

- REQ #4 — `operator_run_files.subaccount_id` nullability divergence (NULL vs spec NOT NULL).
- REQ #4b — Paired Drizzle schema divergence (same column).
- REQ #10 — Initial-context bundler timezone source: spec said `users` table, code reads `subaccount_agents`; `working_hours` and `recent_activity_summary` deferred.
- REQ #12 — `operatorSessionLifecycleService.startSession` has no callers; spec wired it into the `operator_runs` insert path.
- REQ #13 — `operatorSessionService.handleFileWriteToolCall` has no callers; spec wired it into the tool-registry handler.
- REQ #16 — `OperatorFileEvent` payload shape: field naming and presence of `emittedAt` diverge from spec §5.7 contract sketch.

(REQ #4 and #4b consolidate into one todo entry — same root cause.)

---

## Files modified by this run

None (no mechanical fixes were applied).

---

## Next step

NON_CONFORMANT — five directional gaps should be triaged by the operator before `pr-reviewer`. See `tasks/todo.md` § "Deferred from spec-conformance review — personal-assistant-v2-operator (2026-05-13)".

Reading the gaps in context: REQ #12 and REQ #13 (no callers) are likely **deliberate** for V2 — the operator-runtime boot integration and tool-registry plumbing are infra-managed (spec §3 risks "External deployment of the rebuilt sandbox image ... is NOT a merge blocker"; plan Chunk 6/7 g1-checks did not require runtime wiring). REQ #4 (`subaccount_id` NULL) is a concrete schema divergence that may need an additional corrective migration before merge. REQ #10 (timezone source) is a substantive data-source choice. REQ #16 is naming convention convergence.

The operator should decide whether to:
(a) accept the wiring gaps as deferred-to-infra and document them in `progress.md`,
(b) author a corrective migration to enforce `subaccount_id NOT NULL` (or amend the spec),
(c) re-affirm the timezone source decision (spec amendment vs code fix),
(d) accept the payload naming convergence (spec amendment to align with the registry shape).

No re-run of `pr-reviewer` on an expanded changed-code set is required (no mechanical fixes landed).
