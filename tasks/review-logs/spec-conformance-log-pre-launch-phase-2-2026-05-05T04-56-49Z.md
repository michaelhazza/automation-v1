# Spec Conformance Log

**Spec:** `docs/pre-launch-hardening-mini-spec.md`
**Spec commit at check:** `9c3c6c37` (file unchanged at HEAD)
**Branch:** `claude/pre-launch-phase-2`
**Base:** `9c3c6c3740ff3005863f3942793c2a186e90e7e6` (merge-base with main)
**HEAD:** `ee4ed8a14c83cdf5a91db424601ffab1ef622fde`
**Scope:** Phase 2 surface — mini-spec Chunks 4, 5, 6 (Maintenance Job RLS Contract, Execution-Path Correctness, Gate Hygiene Cleanup). Mini-spec Chunks 1, 2, 3 (RLS Hardening Sweep, Schema Decisions + Renames, Dead-Path Completion) are OUT_OF_SCOPE — not implemented in Phase 2 plan; they are owned by separate phases / specs.
**Plan-to-spec mapping:** plan Chunk 6a → mini-spec Chunk 4; plan Chunk 6b → mini-spec Chunk 5; plan Chunk 7 → mini-spec Chunk 6. Mapping derived from plan source-ID citations and plan §6 / §7 text references to mini-spec items.
**Changed-code set:** 99 files (committed; 0 staged; 0 unstaged; 0 untracked excluding `.worktrees/`).
**Run at:** 2026-05-05T04:56:49Z
**Commit at finish:** `0f356ab260b81380fd96556cdaa96d2801eaac73`

---

## Contents

1. Summary
2. Requirements extracted (full checklist)
3. Mechanical fixes applied
4. Directional / ambiguous gaps (routed to tasks/todo.md)
5. Files modified by this run
6. Out-of-scope items (mini-spec Chunks 1, 2, 3)
7. Lint / typecheck verification (Step 5)
8. Next step

---

## 1. Summary

- Requirements extracted:     30
- PASS:                       27
- MECHANICAL_GAP → fixed:     1
- DIRECTIONAL_GAP → deferred: 3
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     mini-spec Chunks 1, 2, 3 (entire chunks; not enumerated as REQs above)

**Verdict:** CONFORMANT_AFTER_FIXES — 1 mechanical gap closed in-session (lint-fixture annotation); 3 directional gaps deferred to `tasks/todo.md` for human decision. None of the directional gaps are blockers for `pr-reviewer`; they represent operator-locked divergences (REQ #4), a missed sub-task (REQ #15), and a CI-dependent placeholder (REQ #29). Re-run `pr-reviewer` against the expanded changed-code set (the lint-fixture fix is the only new modification).

---

## 2. Requirements extracted (full checklist)

### Mini-spec Chunk 4 — Maintenance Job RLS Contract

| REQ # | Requirement (one-line) | Verdict | Evidence |
|---|---|---|---|
| 1 | `ruleAutoDeprecateJob.ts` mirrors admin/org tx contract | PASS | `server/jobs/ruleAutoDeprecateJob.ts:173-319` — Pattern B (global advisory lock + SAVEPOINT subtransactions). |
| 2 | `fastPathDecisionsPruneJob.ts` mirrors admin/org tx contract | PASS | `server/jobs/fastPathDecisionsPruneJob.ts:38-136` — admin tx for enumeration; per-org `withOrgTx` for DELETE. |
| 3 | `fastPathRecalibrateJob.ts` mirrors admin/org tx contract | PASS | `server/jobs/fastPathRecalibrateJob.ts:43-166` — admin tx for enumeration; per-org `withOrgTx` for SELECT + log emission. |
| 4 | Test added per job verifies a real row is decayed/pruned/recalibrated | DIRECTIONAL_GAP | Pure-function tests exist (`ruleAutoDeprecateJobPure.test.ts`, `fastPathDecisionsPruneJobPure.test.ts`, `fastPathRecalibrateJobPure.test.ts`) covering computation logic; no integration tests verifying actual row mutation. Operator-locked decision (no unit test suite during development) chooses pure tests. |

### Mini-spec Chunk 5 — Execution-Path Correctness

| REQ # | Requirement (one-line) | Verdict | Evidence |
|---|---|---|---|
| 5 | C4b-INVAL-RACE: re-check invalidation after I/O in `workflowEngineService.ts` | PASS | `server/services/workflowEngineService.ts:140-156` (post-call), :1693-1700 / :1878-1885 / :1945-1952 (pre-call) — all four `*Internal` helpers bracket external I/O with the discard predicate. |
| 6 | W1-43: dispatcher single-webhook defence-in-depth | PASS | `server/services/invokeAutomationStepService.ts:84-97, 195-205` — `assertSingleWebhook` returns `automation_composition_invalid` before engine load; pure mirror at `invokeAutomationStepServicePure.ts:18-24`. |
| 7 | W1-44: pre-dispatch `required_connections` resolution | PASS | `server/services/invokeAutomationStepService.ts:150-193` — `resolveRequiredConnections` runs before engine call; emits `automation_missing_connection` on failure. Pure helper at `resolveRequiredConnectionsPure.ts`. |
| 8 | W1-38: §5.7 error vocabulary closure | PASS | `grep -rE "automation_execution_error" server/` returns zero matches. Per consolidated spec § 1235 architect resolution, the ambiguous code was removed; engine-not-found surfaces as `automation_not_found` (line 95), engine-load-failed as `automation_composition_invalid` (line 162). |
| 9 | HERMES-S1: thread `errorMessage` into `extractRunInsights` | PASS | `server/services/agentExecutionService.ts:1836-1858` — `threadedErrorMessage` derived from `preFinalizeRow.errorMessage` for failed runs and passed via `extractionOutcome.errorMessage`. |
| 10 | H3-PARTIAL-COUPLING: decouple `partial` from summary presence | PASS | `server/services/agentExecutionServicePure.ts:564-593` — `computeRunResultStatus` signature is `(finalStatus, hasError, hadUncertainty)`; `hasSummary` removed. Caller at `agentExecutionService.ts:1541-1546` no longer passes summary state. |
| 11 | C4a-6-RETSHAPE: skill error envelope decision documented | PASS | `docs/pre-launch-hardening-spec.md:1321-1335` — Branch A grandfather (operator-locked § 12.4 of plan). Decision binding on Phase 2; migration deferred to Phase 3 if a UI consumer requires the structured shape. |
| 12 | Race-condition test for C4b passes | PASS | `server/services/__tests__/invalidationRecheckPure.test.ts:1-15` — covers `invalidated`, `cancelled`, `running`, `completed`, `pending`, empty discard truth table. |
| 13 | W1-43/44 enforced at dispatcher boundary with tests | PASS | `dispatcherDefenceInDepthPure.test.ts` (W1-43, 3 cases); `resolveRequiredConnectionsPure.test.ts` (W1-44, 11 cases including ordering and edge cases). |
| 14 | HERMES-S1 verified by failed-run-without-throw test | PASS | `extractRunInsightsErrorMessagePure.test.ts:1-58` — covers `failed` (with/without errorMessage), `success`, `partial`, non-terminal, undefined. |
| 15 | Skill error envelope contract one of two options and 100% adherent | DIRECTIONAL_GAP | Decision documented (REQ #11), but the CI grep gate that the plan promised (Task 6b.7 final bullet) is NOT shipped. `verify-agent-skill-contracts.ts` does not enforce return-shape adherence. Mixed nested-vs-flat shapes still appear in connector / oauth / skill-executor services — though it is unclear whether all of those count as "skill envelope" returns. Scope decision needed. |

### Mini-spec Chunk 6 — Gate Hygiene Cleanup

| REQ # | Requirement (one-line) | Verdict | Evidence |
|---|---|---|---|
| 16 | Create `server/config/actionCallAllowlist.ts` (P3-H4) | PASS | `server/config/actionCallAllowlist.ts:1-119` — exports `ACTION_CALL_ALLOWLIST` (alphabetised set, 109 entries) and `isActionCallAllowed`. |
| 17 | `measureInterventionOutcomeJob` canonicalAccounts via service (P3-H5) | PASS | `server/jobs/measureInterventionOutcomeJob.ts:69, 286-295` — `canonicalDataService.findAccountBySubaccountId(principal, subaccountId)`; passes `PrincipalContext` via `fromOrgId`. Closed in commit `3a9e628b` on main; verified intact at HEAD. |
| 18 | `referenceDocumentService.ts` no direct `anthropicAdapter` (P3-H6) | PASS | `server/services/referenceDocumentService.ts:7` — imports `countTokens` from `./llmRouter.js`; no adapter import. |
| 19 | PrincipalContext propagation through 5 callers (P3-H7 / S-2) | PASS | All 38 production-code call sites of `canonicalDataService.<method>` pass `principal` as first argument. Closed in prior commits `cc68168e`, `79b6e89f` on main. |
| 20 | Skill visibility drift fix (P3-M10) | PASS | `server/skills/smart_skip_from_website.md:5` and `weekly_digest_gather.md:5` — `visibility: basic`. Closed in commit `8279e200` on main. |
| 21 | YAML frontmatter on workflow skills (P3-M11) | PASS | `grep -L "^---" server/skills/*.md` returns only `README.md` (expected); all skill files have frontmatter. |
| 22 | `verify-integration-reference.mjs` explicit yaml import (P3-M12) | PASS | `scripts/verify-integration-reference.mjs:32` — `import { parse as parseYaml } from 'yaml';`. |
| 23 | Canonical dictionary entries (P3-M14) | PASS | `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts` — entries added in commit `79b6e89f` on main. No drift detected. |
| 24 | `docs/capabilities.md` editorial rule violation (P3-M16) | PASS | Closed in commit `8279e200` on main — "Anthropic-scale distribution" rewritten to "Hyperscaler-scale distribution". |
| 25 | Explicit package.json deps (P3-L1) | PASS | `package.json` declares `"yaml": "^2.8.3"` explicitly. |
| 26 | `.md` definitions for `ask_clarifying_questions` and `challenge_assumptions` (S2-SKILL-MD) | PASS | `server/skills/ask_clarifying_questions.md` and `challenge_assumptions.md` exist with valid frontmatter. Closed in commit `8279e200`. |
| 27 | Strengthen rule-conflict parser tests (S3-CONFLICT-TESTS) | PASS | `server/services/__tests__/ruleConflictDetectorServicePure.test.ts:1-165` (added on this branch) — covers direct contradiction, subset/superset, contradictory same-trigger, adjacent-overlap fixtures. |
| 28 | `saveSkillVersion` pure unit test (S5-PURE-TEST) | PASS | `server/services/__tests__/saveSkillVersionPure.test.ts:1-14` (added on this branch); pure helper `computeNextSkillVersion` at `skillVersioningPure.ts:2`. |
| 29 | Capture pre-Phase-2 baseline counts (SC-COVERAGE-BASELINE) | DIRECTIONAL_GAP | `tasks/builds/pre-launch-phase-2/progress.md:3-6` records the section heading but the two count rows are placeholder text ("update with actual count from first CI run"), not actual numbers. Cannot be auto-fixed from a local session — values must come from CI output. |
| 30 | Gate skips `import type` lines (RLS-CONTRACT-IMPORT) | PASS | `scripts/verify-rls-contract-compliance.sh:124` — `grep -v "import type"` filter present. Diff against main confirms the change landed on this branch. |

---

## 3. Mechanical fixes applied

### `scripts/__fixtures__/rls-contract/sample.ts`

- **Issue:** ESLint emitted 1 error: `'db' is defined but never used` on line 5. The fixture intentionally imports `db` as a value to demonstrate the violation pattern the gate detects; ESLint flagged this as a real lint error blocking the linter.
- **Fix:** added file-level `/* eslint-disable @typescript-eslint/no-unused-vars */` directive plus an explanatory comment block above the imports clarifying that the imports are deliberate and unused (the gate scans for the import lines themselves, not for runtime usage).
- **Spec quote (closest binding):** plan Task 7.12 — *"Add a fixture test: a new file in `scripts/__fixtures__/rls-contract/` containing both a runtime `import { db }` and an `import type { db }`. Document that only the runtime import should trigger the gate."*
- **Why MECHANICAL not DIRECTIONAL:** the fixture must exist with both shapes (the gate has nothing to verify against otherwise); the only design choice is which suppression mechanism to use, and `eslint-disable @typescript-eslint/no-unused-vars` is the standard one for fixture files. The fix does not change gate behaviour, does not modify any production code, and does not introduce a new pattern.

---

## 4. Directional / ambiguous gaps (routed to tasks/todo.md)

All three findings appended under `## Deferred from spec-conformance review — pre-launch-phase-2 (2026-05-05)` in `tasks/todo.md`.

- **REQ #4** — Maintenance-job done criteria: pure-function tests vs real-row integration tests. Operator-locked divergence (no unit test suite during development).
- **REQ #15** — Skill error envelope CI grep gate not implemented. Plan Task 6b.7 promised the gate; Chunk 7 shipped audit-stream-split + RLS-import-type gates but not the envelope adherence gate. Scope-of-detection decision needed.
- **REQ #29** — SC-COVERAGE-BASELINE numbers are placeholders, not actual CI counts. Cannot be fixed locally — values come from CI output, and CLAUDE.md forbids local gate runs.

---

## 5. Files modified by this run

- `scripts/__fixtures__/rls-contract/sample.ts` (3 lines added — comment + eslint-disable)
- `tasks/todo.md` (one new section appended at the end)

---

## 6. Out-of-scope items (mini-spec Chunks 1, 2, 3)

These chunks of `docs/pre-launch-hardening-mini-spec.md` are NOT implemented in the Phase 2 plan and were therefore skipped:

- **Mini-spec Chunk 1 — RLS Hardening Sweep** (P3-C1..C11, P3-H2, P3-H3, SC-1, GATES-2026-04-26-1). Covered by separate `pre-launch-hardening-specs` work / consolidated spec § 1.
- **Mini-spec Chunk 2 — Schema Decisions + Renames** (F6, F10, F11, F15, F21, F22, WB-1, DELEG-CANONICAL, W1-6, W1-29, BUNDLE-DISMISS-RLS, CACHED-CTX-DOC). Owned by consolidated spec § 2 / Phase 2 of consolidated.
- **Mini-spec Chunk 3 — Dead-Path Completion** (DR3, DR2, DR1, C4a-REVIEWED-DISP). Deferred to Phase 3 per plan § 12 "What comes next" — DR2/DR3 explicitly listed as Phase 3 items; DR1 and C4a-REVIEWED-DISP not addressed in Phase 2.

If you intended a wider scope (whole-mini-spec verification across all branches that have implemented these chunks), re-invoke `spec-conformance` with explicit scope confirmation per CLAUDE.md § *Local Dev Agent Fleet*.

---

## 7. Lint / typecheck verification (Step 5)

After applying the mechanical fix to `sample.ts`:
- `npm run lint` → 864 warnings, 0 errors (was 1 error pre-fix). All 864 warnings are pre-existing baseline.
- `npm run typecheck` → clean (zero errors). Two-pass `tsc --noEmit` against root and server tsconfig both green.

---

## 8. Next step

**CONFORMANT_AFTER_FIXES.** One mechanical gap was closed in-session. Three directional gaps routed to `tasks/todo.md` — none are blockers for `pr-reviewer`; all three represent decisions the operator should make rather than implementation gaps:

1. REQ #4 — accept the operator-locked divergence in the mini-spec text, or author DB-backed integration tests in a follow-up.
2. REQ #15 — author the skill-envelope adherence gate as a follow-up (scope decision required first).
3. REQ #29 — refresh the SC-COVERAGE-BASELINE placeholders with actual CI counts after the next CI run.

**Re-run `pr-reviewer` on the expanded changed-code set.** The fixture lint suppression is the only new modification beyond what the development session shipped; pr-reviewer should see the final state with that change in place.
