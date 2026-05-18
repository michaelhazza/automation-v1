# chatgpt-plan-review — deterministic-validators

**Date:** 2026-05-18
**Plan:** tasks/builds/deterministic-validators/plan.md
**Mode:** manual

---

## Round 1

**Operator feedback summary:** ChatGPT returned CHANGES_REQUESTED with 10 findings (2 high, 6 medium, 2 low) spanning sequencing, count mismatches, audit boundaries, testing posture, cost-attribution readiness, tenant-context contract, and one workflow improvement on `.registry-meta.json`.

**Findings:** 10 total (technical: 9, user-facing: 1)

### Decisions

| # | Finding | Severity | Triage | Decision | Rationale |
|---|---------|----------|--------|----------|-----------|
| 1 | Chunk 2 hard-depends on Chunk 1 for `validator_versions`, but invocation lives in Chunk 5 | medium / sequencing | technical | ACCEPT | Plan was over-stating the dep. Chunk 2 only exports the function; the table only needs to exist at Chunk 5 invocation time. Loosened the ordering note. |
| 2 | Chunk 4 says "9 remaining validators / 27 files" but the table lists 8 | high / bug | technical | ACCEPT | Spec §8 has 10 rows but only 9 are registered Validators. Chunk 2 ships 1 (`output_non_empty`), so 8 remain (24 files). Corrected heading, scope, file count, and acceptance criterion. |
| 3 | Programme acceptance claims `getAllValidatorSummaries()` returns 10 entries | high / bug | technical | ACCEPT | Registered catalogue is 9 (`output_helpful` is a rubric JSONB pattern per spec §8 closing note, not a Validator). Updated Goal 2 acceptance. |
| 4 | Chunk 3 vs Chunk 5 audit boundary ambiguous (dispatcher returns `invocationsToWrite[]` but Chunk 3 says "audit writes out of scope") | medium / clarity | technical | ACCEPT | Added explicit boundary block to Chunk 3: dispatcher CONSTRUCTS the DTO, Chunk 5's audit service PERSISTS it. Keeps dispatcher transaction-aware while isolating audit failure modes. |
| 5 | `validator_versions` boot snapshot row count conflicts with corrected catalogue size | medium / sequencing | technical | ACCEPT | Updated Chunk 5 dependencies note and acceptance criterion from 10 rows to 9 rows. Updated programme Goal 6. |
| 6 | Entity resolver `customerService.existsById` may introduce premature domain coupling | low / architecture | technical | ACCEPT | Reworded Chunk 2's `entityResolverRegistry.ts` contract: at chunk entry the executor verifies which entity-existence services actually exist and registers only real ones. `customerService.existsById` becomes illustrative; the map may ship empty in Phase 1 with `cited_entity_exists` tested against a mocked resolver. |
| 7 | Testing posture contradiction: spec §17 says "no API contract tests" but Chunk 6 has a route test | medium / bug | technical | ACCEPT | Reframed Chunk 6's `validators.test.ts` as a *targeted route unit test* (permission + response shape only), explicitly NOT an API contract test. Added the same clarification to the §8 testing-posture cross-check. |
| 8 | Chunk 5 cost-attribution branch ("assumes a cost column, confirm at chunk entry") is unresolved | medium / implementation readiness | technical | ACCEPT | Resolved at plan time: `scorecard_judgements` has NO cost column. Cost flows through `llm_requests` (written by `routeCall`). Deterministic verdicts skip `routeCall` and therefore write zero rows. No new column, no `cost = 0` literal — absence of an `llm_requests` row is the cost-attribution signal. Updated Chunk 5 contract and acceptance criterion. |
| 9 | `safety_class_check_failed` event may lack tenant context | medium / architecture | technical | ACCEPT | Spec §7.6 pins the payload to `{ scorecardId, checkSlug, runId, agentId }`. Consumers resolve tenant context via `agent_runs.organisationId` / `agent_runs.subaccountId` (NOT NULL columns) keyed by `runId`. Added an explicit error-handling note in Chunk 3 documenting this contract and the rationale (event shape stays stable across cross-brief integrations). |
| 10 | `.registry-meta.json` committed as CI output creates churn / stale-state risk | low / improvement | user-facing | REJECT (operator-accepted current approach) | Operator reviewed and accepted the existing strategy: committed seed file + CI overwrite. Risk 7 in the plan already documents the race condition. No plan changes required. |

### Changes applied

- Loosened Chunk 2 dependency from "Chunk 1 required" to "no hard dependency", with parallel-execution note in the dependency diagram.
- Renamed Chunk 4 heading and scope from "9 remaining / 27 files" to "8 remaining / 24 files", added a catalogue-count reconciliation paragraph at the top of the chunk.
- Updated Chunk 4 acceptance: `getAllValidatorSummaries()` returns 9 entries (not 10).
- Updated Chunk 5 boot-snapshot acceptance to 9 rows and added the `output_helpful` exclusion rationale.
- Added explicit "Audit-table boundary" block to Chunk 3 separating DTO construction from persistence.
- Replaced the conditional cost-column language in Chunk 5 with the resolved mechanism (no cost column; `llm_requests` ledger; absence of row = zero cost). Updated acceptance criterion to verify by SELECT on `llm_requests`.
- Added Chunk 3 tenant-context contract note for the `safety_class_check_failed` event.
- Reframed Chunk 6 route test as a "targeted route unit test", added scope-boundary text, and updated programme §8 testing-posture cross-check to reflect the carve-out.
- Reworded Chunk 2's `entityResolverRegistry.ts` contract to make the Phase 1 resolver set conditional on actual service availability.
- Updated programme Goal 2 acceptance (10-row catalogue / 9 registered validators) and Goal 6 acceptance (9 `validator_versions` rows).
- Updated plan TOC entry for Chunk 4 from "9 remaining" to "8 remaining".

### Operator decisions on user-facing findings

- Finding #10 (`.registry-meta.json` workflow): operator ACCEPTED the current approach (committed seed + CI overwrite). Plan retains existing language. Risk 7 documents the residual race condition as known and accepted.

### Round 1 summary

- Auto-applied: 9 technical findings (all)
- Operator-approved: 0
- Operator-rejected (accept-current-approach): 1 (Finding #10)
- Deferred: 0
- Plan state at end of Round 1: revised in place at `tasks/builds/deterministic-validators/plan.md`

---

## Round 2

**Operator feedback summary:** ChatGPT returned CHANGES_REQUESTED with 5 minor-cleanup findings (4 low, 1 medium): residual "remaining 9 validators" wording, Spec Goal 2 wording conflict, Chunk 6 strict-ordering mismatch with its own dependencies list, missing `server/index.ts` row in the Chunk 6 file table, and a "five evaluation_method variants" wording that conflicts with the six-value enum.

**Findings:** 5 total (technical: 5, user-facing: 0)

### Decisions

| # | Finding | Severity | Triage | Decision | Rationale |
|---|---------|----------|--------|----------|-----------|
| 1 | Chunk 2 text still says "remaining 9 validators ship in Chunk 4" | low / consistency | technical | ACCEPT | Round-1 residual; corrected scope text + out-of-scope text in Chunk 2 to "8 remaining". |
| 2 | Registered catalogue count conflicts with Spec Goal 2 wording ("10 named validators") | low / clarity | technical | ACCEPT | Added an executor-notes paragraph reconciling the plan's resolved "9 registered + 1 rubric pattern" count against spec §1 Goal 2's "10 named validators" phrasing. Plan reconciliation is authoritative; spec wording flagged as a doc-sync candidate at finalisation, not a build-time blocker. |
| 3 | Chunk 6 strict ordering says "depends only on Chunks 1+2" but the Chunk 6 dependencies block later says Chunks 1-5 | medium / sequencing | technical | ACCEPT | UI drill-in consumes verdict/evidence fields populated by Chunks 3+5. Updated the strict-ordering line to "Chunks 1 to 5 -> 6" with an explicit reason. |
| 4 | `server/index.ts` mount point omitted from Chunk 6 file table | low / implementation readiness | technical | ACCEPT | Added a `server/index.ts` modify row to the Chunk 6 file table (one-line route mount). File count updated from 8 to 9. |
| 5 | "Renders five display variants" / "all five evaluation_method variants" conflicts with the six-value enum | low / bug | technical | ACCEPT | Updated VerdictDrillIn file contract row and programme Goal 9 acceptance to "six display variants" with the six enum values listed explicitly (`deterministic`, `deterministic_external`, `hybrid_deterministic_fail`, `hybrid_semantic`, `semantic`, `inconclusive`). |

### Changes applied

- Chunk 2 scope and out-of-scope text: "remaining 9 validators" -> "remaining 8 validators".
- Chunk 6 strict ordering: "Chunks 1+2 -> 6" -> "Chunks 1 to 5 -> 6" with explicit reason citing Chunk 3 + Chunk 5 dependencies.
- Chunk 6 file table: added a `server/index.ts` modify row for `validatorsRouter` mounting; removed the "Mounted in `server/index.ts`" sentence from the `server/routes/validators.ts` row; updated file count from 8 to 9.
- Chunk 6 `VerdictDrillIn` contract: "five display variants" -> "six display variants" with the six enum values listed.
- Programme Goal 9 acceptance: same six-variant update with explicit enum values.
- Executor notes: added a Spec Goal 2 wording reconciliation paragraph.

### Operator decisions on user-facing findings

None — all five findings were technical.

### Round 2 summary

- Auto-applied: 5 technical findings (all)
- Operator-approved: 0
- Operator-rejected: 0
- Deferred: 0
- Plan state at end of Round 2: revised in place at `tasks/builds/deterministic-validators/plan.md`. Verdict: APPROVED (minor cleanup only, no remaining blockers).

---

## Final Summary

**Verdict:** APPROVED
**Rounds:** 2
**Auto-applied:** 14 findings (9 in Round 1 + 5 in Round 2)
**Operator-approved:** 0 findings
**Operator-rejected (accept-current-approach):** 1 finding (Round 1 #10, `.registry-meta.json` workflow)
**Deferred to tasks/todo.md:** 0 findings

Plan is finalised at `tasks/builds/deterministic-validators/plan.md`. Round 2 verdict was CHANGES_REQUESTED with minor cleanup only; all five findings were applied. No remaining blockers.

