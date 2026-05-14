**Status:** plan
**Plan date:** 2026-05-14
**Author:** architect (Opus, Phase 2 Step 3)
**Build slug:** skill-merge-consolidation-pass
**Branch:** claude/improve-skill-analyzer-RiFpB
**Spec:** tasks/builds/skill-merge-consolidation-pass/spec.md

---

# Implementation plan — skill merge conditional consolidation pass

## Table of contents

- Executor notes
- Model-collapse check
- 1. Architecture notes
  - 1.1 Where the consolidation gate slots in
  - 1.2 Pure-function module layout
  - 1.3 Post-merge enum convention
  - 1.4 Source-of-truth precedence (post-consolidation row)
  - 1.5 `consolidation_trigger_severity` vs `warningTierMap` independence
  - 1.6 Reused primitives (confirmed by direct file reads)
  - 1.7 Why not reuse — "invent new" justifications
- 2. Risks and mitigations
  - 2.1 Risk register
  - 2.2 Load-bearing assumptions
- 3. Chunk plan
  - Chunk 1 — Schema + config (additive only)
  - Chunk 2 — Pure functions + prompt + new warning codes
  - Chunk 3 — Orchestration (the gate)
  - Chunk 4 — UI banner
- 4. Spec-section coverage matrix
- 5. Open questions for the operator
- 6. Migration-number choice (decision)
- Review-round revisions
- Phase exit criteria

---

## Executor notes

- Task class: Significant. The full GRADED review posture applies once the four chunks are built: `spec-conformance` (spec-driven) → `pr-reviewer` → `reality-checker`. `adversarial-reviewer` is NOT applicable — diff does not cross the §5.1.2 security surface (no auth, no RLS, no tenant isolation change, no new external trigger). `dual-reviewer` is mandatory (skippable with `REVIEW_GAP` if Codex unavailable). `chatgpt-pr-review` is enforced in Phase 3 by `finalisation-coordinator`, not here.
- Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.
- All four chunks land on the same branch (`claude/improve-skill-analyzer-RiFpB`). No per-chunk branches.

---

## Model-collapse check

The candidate "collapsed call" would be: have the classifier+merge LLM already do the second-pass tightening in the same call (give it both the rich-source budget and the tightness mandate). Rejected:

1. The spec opens with empirical evidence (§1, §13 Appendix) that the existing single-call prompt already attempts this — there is a soft `+30%` cap baked into the merge prompt (lines 909-912 of `skillAnalyzerServicePure.ts`) AND a self-check step (line 1003) AND `validateMergeOutput` flags the failures post-hoc. The LLM regularly overshoots anyway because correctness ("preserve every unique fact") and concision ("be terse") are competing objectives. Frontier model jaggedness in this region is documented in the spec's design rationale (§2 choice 2).
2. The two-call decomposition aligns each prompt with a single dominant objective: pass 1 is correctness-dominated, pass 2 is concision-dominated. This is the inverse of a collapsible pipeline — it is a *deliberately uncollapsed* pipeline where prior collapsed attempts failed.
3. Cost is preserved by conditionality: pass 2 only fires on the `SCOPE_EXPANSION` subset (today's analyzer logs show this is a minority of merges). A single bigger prompt pays the same correctness budget on every merge, including the ones already within budget.

Decision: keep the two-call design as specified. No re-collapse.

---

## 1. Architecture notes

### 1.1 Where the consolidation gate slots in

The gate slots into Stage 5 of `processSkillAnalyzerJob` (`server/jobs/skillAnalyzerJob.ts`), inside the existing per-result `p-limit(3)` slot. Sequencing inside one slot (the implementer should think of this as **insertion between two existing fences**):

- Existing line 1217: `validateMergeOutput(...)` — the first-pass validator that emits `SCOPE_EXPANSION` / `SCOPE_EXPANSION_CRITICAL`.
- Existing lines 1229-1276: table-row recovery, output-format recovery, `CLASSIFIER_FALLBACK` prepend, skill-graph collision detection, batch-cross-ref warnings.
- Existing line 1332: `adjustClassifierConfidence(...)`.
- Existing line 1365: `insertSingleResult(...)`.

The **consolidation gate is inserted between line 1217 (validateMergeOutput first call) and line 1229 (table recovery)** because:

1. It only needs the first scope-expansion verdict, which 1217 produces.
2. The table-row recovery and output-format recovery operate on `storedMerge.instructions` — they should run on the **final** (post-consolidation) text, not the pre-consolidation text, so the reference appendix attaches to what the reviewer actually sees.
3. The skill-graph and cross-ref warnings examine the merged content for capability-overlap signals — these too should reflect the final text.
4. Confidence adjustment at line 1332 reads `mergeWarnings`. If consolidation replaced the merge and either added or kept scope warnings, this is the warning set the confidence adjuster must see.

Therefore the gate's full responsibility inside the slot is: capture `preConsolidationMerge` → run consolidation LLM call → on success, replace `storedMerge` and re-run `validateMergeOutput` → on hard-constraint violation in the post-validation result, revert and recompute warnings against the pre-consolidation draft → append the appropriate informational code (`CONSOLIDATION_APPLIED` | `CONSOLIDATION_DECLINED` | `CONSOLIDATION_FAILED`) → set `consolidationOutcome` and `consolidationNote` for `insertSingleResult`.

Note that the **re-validation must occur before the downstream recovery/collision blocks (table recovery, output format recovery, skill-graph collision)** because those blocks read the final warning set and the final instructions. Effectively: insert at line 1228 (after validateMergeOutput at 1217, before recoverDroppedTableRows at 1229).

**Placement authority (resolves spec §3/§5 sequencing ambiguity).** For this plan, the authoritative insertion point is **after** the first `validateMergeOutput(...)` call at line 1217 and **before** the table-row recovery (line 1229), the output-format recovery, the `CLASSIFIER_FALLBACK` prepend, and the skill-graph collision detection. The implementer treats these blocks as two cohorts:

- **Pre-consolidation cohort** — every block currently between the merge LLM call and line 1217 (the LLM-output normalisation work that produces a parseable `storedMerge`). These run unchanged, before consolidation.
- **Post-consolidation cohort** — every block currently between line 1229 and the line 1365 `insertSingleResult` call (table-row recovery, output-format recovery, classifier-fallback prepend, skill-graph collision, batch-cross-ref warnings). These run unchanged, after consolidation, and operate on the final `storedMerge`.

Do not move existing remediation blocks unless required by a type error. The spec sentence "runs after existing post-LLM remediation and before insert" refers to the pre-consolidation cohort above, not to the post-consolidation cohort. The post-consolidation cohort is **deliberately** downstream of the gate so the reference appendix, skill-graph signals, and cross-ref warnings all reflect what the reviewer sees.

### 1.2 Pure-function module layout

Two new pure functions live in `server/services/skillAnalyzerServicePure.ts` alongside the existing prompt-build and parse pair for classification-with-merge:

- `buildConsolidationPrompt(merged, richerSourceWords, mergedWords, thresholds)`. Returns `{ system: string; userMessage: string }` matching the shape returned by `buildClassifyPromptWithMerge`.
- `parseConsolidationResponse(raw, original)`. Mirrors `parseClassificationResponseWithMerge`'s rejection-on-malformed pattern, returning a typed rejection for any of six §4.3 rules so the caller can route to `CONSOLIDATION_FAILED` with `failureReason='parse_rejected: <rule>'`.

A third **pure** helper extracts the tiered preservation inventory from the pre-consolidation merge:

- `extractPreservationInventory(merged)`. Tier 1: backtick-wrapped tool/skill refs, the invocation block (extracted via the existing `extractInvocationBlock` already imported in the job), and HITL-gate phrase matches (a deterministic phrase set matching the merge prompt's "do not send without", "human approval required", etc.). Tier 2: known unbackticked tool/action identifiers and lower-confidence HITL phrases. This helper is pure and testable; the job orchestration calls it once per consolidation-gated result.

All three new functions are sized to fit cleanly in `skillAnalyzerServicePure.ts` (which already houses `buildClassifyPromptWithMerge` + `parseClassificationResponseWithMerge` + `validateMergeOutput`). No new module.

### 1.3 Post-merge enum convention

`consolidationOutcome` is a closed enum: `not_triggered | succeeded | declined | failed`. Two representations exist:

- DB column: `text` with no `CHECK` constraint enforced at the DB layer (the spec does not mandate a check; aligned with existing patterns like `executionResult` which is also `text` without a check constraint per `skillAnalyzerResults.ts:132-133`). Validation lives at the Drizzle `$type<>()` boundary and at the discriminated-union parser.
- TS literal union: `'not_triggered' | 'succeeded' | 'declined' | 'failed'` exported as `ConsolidationOutcome` from `skillAnalyzerServicePure.ts`. Adding a new value requires a spec amendment (per §10 state-machine closure).

Per `DEVELOPMENT_GUIDELINES.md §8.13` (discriminated-union validators) — when this build adds the enum and the orchestration path that writes it, both must land in the same commit so the validator's allow-list and the type union stay in sync. Chunk 1 ships the schema (Drizzle `$type<>()` annotation); Chunk 3 ships the orchestration writer. The first chunk's schema makes the column **always written by post-migration orchestration**, never NULL on a post-migration row.

### 1.4 Source-of-truth precedence (post-consolidation row)

Per spec §4.5, three jsonb representations of "the merge" exist on every PARTIAL_OVERLAP/IMPROVEMENT row after this build ships. The plan adopts the spec's precedence verbatim:

| Field | Reader role | Writer rule (post-migration) |
|---|---|---|
| `proposedMergedContent` | Source of truth at approval/execute time; reviewer edits this column | Set to post-consolidation merge on `succeeded`; pre-consolidation merge otherwise |
| `originalProposedMerge` | What Reset rolls back to | Set to post-consolidation merge on `succeeded` (so Reset gives the reviewer the best AI draft); pre-consolidation merge on `declined` / `failed` / `not_triggered` |
| `preConsolidationMerge` (NEW) | Audit only; never used by Reset or Execute | Set to the LLM's first-pass merge on `succeeded` / `declined` / `failed`. NULL on `not_triggered` (no consolidation ran) |

Two consequences for the implementer:

- The **only** path that writes `originalProposedMerge = postConsolidationMerge` is the `succeeded` branch of the consolidation gate. Every other path (legacy rows, rule-based fallback, DUPLICATE/DISTINCT, `declined`, `failed`, `not_triggered`) keeps the existing line 1378 behaviour: `originalProposedMerge: storedMerge ?? undefined`.
- The reviewer's Recommended column always shows `proposedMergedContent` — the existing `MergeReviewBlock.tsx` reader path is unchanged. The new banner is **purely additive** display.

### 1.5 `consolidation_trigger_severity` vs `warningTierMap` independence

Per spec §6, these two configs operate on different axes and the implementer MUST NOT collapse them:

- `consolidation_trigger_severity` ∈ `{'warning', 'critical'}` is evaluated against the **raw validator output** (`SCOPE_EXPANSION` and/or `SCOPE_EXPANSION_CRITICAL`). It controls LLM spend.
- `warningTierMap` controls UI banner tiering and reviewer resolution gating. Operators may map any code to any tier (including remapping `SCOPE_EXPANSION_CRITICAL` from `critical` to `informational`) without changing which warnings fire consolidation.

The gate code in Chunk 3 reads from `validationThresholds`-adjacent fields (newly extended `ConfigSnapshot`), not from the `tierMap`. Test coverage in Chunk 2 includes an assertion that mutating `warningTierMap` for the three new informational codes does NOT change consolidation triggering.

### 1.6 Reused primitives (confirmed by direct file reads)

| Capability | Primitive | Location | Notes |
|---|---|---|---|
| LLM call from analyzer | `routeCall` | `server/services/llmRouter.js` | New `featureTag: 'skill-analyzer-consolidate'` for ledger separation; reuses Sonnet 4.6, 8192 max tokens, 0.1 temperature |
| Per-result concurrency | `p-limit(3)` | `skillAnalyzerJob.ts:790` | Consolidation runs inside the same slot — no new limiter |
| Prompt assembly pattern | `buildClassifyPromptWithMerge` | `skillAnalyzerServicePure.ts:1082` | New sibling `buildConsolidationPrompt` |
| Response parsing | `parseClassificationResponseWithMerge` | `skillAnalyzerServicePure.ts` (existing) | New sibling `parseConsolidationResponse` |
| Post-LLM validation | `validateMergeOutput` | `skillAnalyzerServicePure.ts:1866` | Re-invoked on consolidated output |
| Invocation block extraction | `extractInvocationBlock` | already imported in `skillAnalyzerJob.ts:1196` | Reused inside `extractPreservationInventory` |
| Warning tier infra | `effectiveTierMap` | `skillAnalyzerConfigService.ts:82` | Reused unchanged; new codes added to `DEFAULT_WARNING_TIER_MAP` |
| Config snapshot | `job.configSnapshot` | `skillAnalyzerJob.ts:99` | Extended with two new fields, no shape change |
| Stamp / concurrency | n/a | n/a | No new write paths beyond the existing `insertSingleResult` |

No new tables, no new services, no new routes, no new jobs, no new limiters.

**Helper-extraction allowance (T5).** Chunk 3 may extract pure orchestration helpers for testability (the outcome predicate, the hard-violation set diff, the word-count delta computation). These extractions MUST live inside an existing file — either `server/services/skillAnalyzerServicePure.ts` (preferred when the helper is pure and side-effect-free) or `server/jobs/skillAnalyzerJob.ts` (acceptable when the helper closes over job-scoped state). DO NOT create a new service module, a new helpers module, or a new `consolidation/` subdirectory — the "no new services" stance applies even when the extraction is well-motivated.

### 1.7 Why not reuse — "invent new" justifications

| New element | Why not reuse |
|---|---|
| `preConsolidationMerge` column | `originalProposedMerge` is already overloaded (it powers Reset). The spec deliberately repurposes `originalProposedMerge` to "best AI draft" so Reset stays useful, requiring a third audit-only column for the first-pass artefact. Reusing `originalProposedMerge` for audit would break Reset semantics. |
| `consolidationOutcome` column | No existing enum on `skill_analyzer_results` captures "did consolidation run, with what outcome". Re-encoding into `mergeWarnings` would mean four codes instead of three (a `not_triggered` informational), and the spec's UI gate keys off the outcome directly. |
| `CONSOLIDATION_APPLIED` / `_DECLINED` / `_FAILED` codes | Existing codes describe validation findings; consolidation outcomes are orthogonal. Re-using `SCOPE_EXPANSION` semantics would conflate "AI tried to fix bloat" with "AI created bloat". |
| `consolidation_trigger_severity` config | No existing config field controls LLM-spend gating against the validator's severity output. `warningTierMap` is the only nearby primitive but it is the wrong axis (see §1.5). |
| `featureTag: 'skill-analyzer-consolidate'` | Distinct ledger tag is required so cost reporting can separate the two analyzer LLM passes. Reusing `'skill-analyzer-classify'` would muddle the metric. |

---

## 2. Risks and mitigations

### 2.1 Risk register

| # | Risk | Severity | Likelihood | Mitigation | Chunk |
|---|---|---|---|---|---|
| R1 | **Migration-number drift.** Spec text says `0346`; main now has `0346-0357` occupied (post-2026-05-14 S1 sync — PR #299 personal-assistant-v2-operator claimed `0351-0357` between plan authoring and the second review round). Wrong number = `drizzle-kit` history conflict at first DB push. | High | Confirmed | Use `0358_skill_merge_consolidation.sql` (+`.down.sql`). Verify the slot is still free at branch tip immediately before committing Chunk 1; rebase + renumber if main has merged 0358+ since the 2026-05-14 S1 sync. Patch the spec text (§5, §10) inline in the Chunk 1 migration commit so the spec reflects the actual number shipped. | C1 |
| R2 | **Warning-set replacement on revert.** Spec §5 step 6: when consolidation succeeds but introduces a hard-constraint violation, orchestration must revert to pre-consolidation merge AND recompute (or restore) warnings against that draft. If the implementer simply appends `CONSOLIDATION_FAILED` to the post-consolidation warnings, the reviewer sees warnings for a draft they cannot read. | Medium | Medium | Chunk 3 caches the pre-consolidation `mergeWarnings` (the array returned by the first `validateMergeOutput` call on line 1217) before running consolidation. On revert, use that cached array, then append `CONSOLIDATION_FAILED`. Encode this as a test of the orchestration helper (see C3 tests). | C3 |
| R3 | **Parser-reject vs decline conflation.** Spec §4.3 final paragraph: parser rejection MUST route to `consolidationOutcome='failed'` with `failureReason='parse_rejected: <rule>'`. The Round 2 spec edit (commit 35764257) explicitly addresses this. An implementer following only §5 step 5 (which describes valid `declined` responses) could mis-route a malformed response. | Medium | Medium | Chunk 2 implements `parseConsolidationResponse` returning a typed rejection for any of the rejection rules. Chunk 3's gate checks the parsed value: rejection → `failed`; valid + `declinedToConsolidate=true` → `declined`; valid + `declinedToConsolidate=false` → `succeeded` candidate, subject to re-validation. Pure tests assert each rule individually. | C2, C3 |
| R4 | **Idempotency posture confusion.** Spec §5 final paragraph + §10 idempotency-contract clause: `consolidationOutcome` is an audit field, NOT an idempotency guard. Row-presence in `skill_analyzer_results` is the guard. An implementer might over-engineer a "skip consolidation if outcome already set" branch. | Low | Low | Chunk 3 does NOT read `consolidationOutcome` before deciding to run consolidation. The existing per-slug skip in `skillAnalyzerJob.ts` (the "rows already in `skill_analyzer_results` skip Stage 5 entirely" pattern visible at line 794 `resumedSkippedCount`) is the only retry-time idempotency. Document this in the plan body and in a Chunk 3 inline comment. | C3 |
| R5 | **No-consolidation guarantee for DUPLICATE/DISTINCT.** Spec §10 final bullet: DUPLICATE/DISTINCT must write `consolidationOutcome='not_triggered'` and MUST NOT call `routeCall`. | Low | Low | Chunk 3 inserts the gate **inside** the `if (storedMerge)` block scope already in `skillAnalyzerJob.ts` (the branch that only runs for PARTIAL_OVERLAP/IMPROVEMENT) and emits `not_triggered` for paths that exit before the gate. The DISTINCT-immediate path at line 810-844 and the DUPLICATE path get `consolidationOutcome: 'not_triggered'` added to their `insertSingleResult` calls. | C3 |
| R6 | **Legacy NULL ambiguity.** Spec §10 state-machine-closure clause: legacy rows (pre-migration) may be NULL; UI treats NULL as display-equivalent to `not_triggered`; orchestration MUST NOT re-consolidate NULL rows. | Low | Low | The migration does not backfill (per spec §8 inventory note). The orchestration never reads `consolidationOutcome` to decide work (per R4). The UI banner in Chunk 4 gates on `outcome === 'succeeded' \|\| outcome === 'declined' \|\| outcome === 'failed'` — NULL and `'not_triggered'` both fall through and render no banner. | C1, C3, C4 |
| R7 | **Telemetry cascade — banner reads from warning detail.** Spec §4.4 last paragraph: size-delta telemetry rides on `CONSOLIDATION_APPLIED` warning detail (jsonb), NOT on dedicated columns. An implementer who adds `consolidationPreWords` / `consolidationPostWords` columns introduces schema bloat against the spec. | Low | Low | Chunk 1 does NOT add size-delta columns. Chunk 3 writes `{ preWords, postWords, reductionPct }` into the `detail` field of the `CONSOLIDATION_APPLIED` warning when emitting it. Chunk 4 parses this detail to render the banner. Pure tests verify the JSON shape. | C1, C3, C4 |
| R8 | **`warningTierMap` vs `consolidation_trigger_severity` collapse.** Per §1.5 above, these are independent and must be tested as such. An implementer who routes both through the same code path will silently couple them. | Medium | Medium | Chunk 3 gate predicate reads `configSnapshot.consolidationTriggerSeverity` directly against the raw warning code emitted by `validateMergeOutput`. It does NOT call `effectiveTierMap`. A targeted test in C2/C3 verifies this independence. | C3 |
| R9 | **Hard-constraint re-validation gap.** Spec §5 step 6: re-running `validateMergeOutput` after consolidation can surface a fresh `HITL_LOST`, `INVOCATION_LOST`, `REQUIRED_FIELD_DEMOTED`, or `CAPABILITY_OVERLAP` that the consolidator introduced. The implementer must check the post-validation set against this specific list, not against "any new warning". | Medium | Medium | Chunk 3 codifies the violation set as a const array (`HARD_CONSOLIDATION_VIOLATIONS`) and reverts iff the post-validation set contains any code in that list not present in the pre-consolidation set. The diff is set-vs-set, not order-sensitive. Test coverage in C3. | C3 |
| R10 | **"Still bloated" misclassification.** Spec §5 outcome-classification rule: a consolidated output shorter than the pre-consolidation draft but still over the target ceiling is `succeeded`, not `failed` (the row keeps the smaller draft and retains the scope warning). The Round 2 spec edit clarifies this — an implementer with only the §2 framing might revert. | Low | Low | The Chunk 3 success predicate is "parse OK AND `declinedToConsolidate=false` AND no new hard-constraint violation". It does NOT check ceiling adherence. Re-validation may keep `SCOPE_EXPANSION`/`SCOPE_EXPANSION_CRITICAL` — that is allowed and tested. | C3 |
| R11 | **`mergeRationale` source drift on success.** `mergeRationale` is a column written from the classifier's response (existing line 1380 `mergeRationale: mergeRationale`). The consolidation prompt is forbidden from changing `mergeRationale` per spec §4.3 (parser rejects mutations to non-instructions fields). On `succeeded`, the row's `mergeRationale` column still reflects the **classifier's** rationale, not a re-generated one. | Low | Low | Chunk 2 parser tests assert mutation rejection. Chunk 3 does NOT update the `mergeRationale` write at line 1380. Plan-time clarity: the row's `mergeRationale` field describes WHY the merge was constructed, not how it was consolidated; the new `consolidationNote` captures the latter. | C2, C3 |
| R12 | **Cross-batch collision detection runs after gate.** Stage 5b (`skillAnalyzerJob.ts:1421`) reads each row's `proposedMerge` for batch-vs-batch collision. If the gate ran in Stage 5 inline, Stage 5b sees the post-consolidation content — which is correct, because the reviewer also sees the post-consolidation content. | Low | Low | No code change needed in Stage 5b; the gate writes to `storedMerge` which Stage 5b already reads. Document in a Chunk 3 inline comment. | C3 (doc only) |
| R13 | **Spec text drift on migration number.** Spec §5 and §10 reference "migration `0346`" in load-bearing prose ("rows written after migration `0346`"). After we renumber to `0358`, those sentences become wrong. | Low | Confirmed | Chunk 1 patches the spec inline (two surgical edits in §5 and §10) in the same commit as the migration file, so the spec reflects the shipped reality. | C1 |
| R14 | **Build-server caching of removed fields.** If an implementer extends `insertSingleResult` (Chunk 3) before extending the schema (Chunk 1), the TS build sees fields that don't exist in `$inferInsert`. | Low | Low (with ordering) | Chunks have explicit `dependencies:` declarations. **C3 cannot proceed until C1's schema + migration land** (this is the only strict dependency the TS build enforces). **C2 is pure-function only and may technically land before C1** (per F3 / Chunk 2 dependencies), though the canonical build order remains C1 → C2 → C3 → C4 to reduce review complexity. C4 depends on C1's schema (for the new client types' fields), not on C3's orchestration. | (cross-chunk) |
| R15 | **Drift between client `mergeTypes.ts` and server `skillAnalyzerServicePure.ts`.** These two files duplicate the `MergeWarningCode` union and the `DEFAULT_WARNING_TIER_MAP` (intentionally, per the client-bundle isolation comment at `mergeTypes.ts:1-9`). Adding three codes to the server union without adding them to the client union breaks the client's tier-evaluation path. | Medium | Medium | Chunks 2 (server) and 4 (client) BOTH add the three new codes, both to the `MergeWarningCode` union and to `DEFAULT_WARNING_TIER_MAP`. The pre-flight checklist in Chunk 4 verifies parity against Chunk 2. | C2, C4 |
| R16 | **Rule-based fallback path interaction.** When `ANTHROPIC_API_KEY` is unavailable, the analyzer falls back to `buildRuleBasedMerge`. The gate must NOT call `routeCall` in that branch (spec §12 deferred-items). The fallback writes `consolidationOutcome='not_triggered'`. | Low | Low | Chunk 3 places the gate after the LLM-success branch only, sharing a code path with `storedMerge` produced by the classifier. The fallback path's `insertSingleResult` call at line 760-779 gets `consolidationOutcome: 'not_triggered'` added directly. | C3 |
| R17 | **8192-token output ceiling on consolidation.** The merge prompt already maxes Sonnet's 8192-token output ceiling. Consolidation output is shorter than the merge output (by design), so the ceiling is not a risk on the response — but the consolidation **prompt** plus the merged-skill instructions can push input tokens high on very large skills. | Low | Low | The consolidation prompt body is shorter than the classify-with-merge system prompt (~3K tokens) — the pre-consolidation merge instructions can be up to ~7K tokens, fitting comfortably within Sonnet's 200K input window. No special handling required. Document in Chunk 2 prompt-builder comment. | C2 |

### 2.2 Load-bearing assumptions

- `skill_analyzer_results` retains the existing `cascade` FK to `skill_analyzer_jobs` (verified in schema line 25). Adding three columns does not alter cascade behaviour.
- `effectiveTierMap` (config service line 82) merges DB tier map over `DEFAULT_WARNING_TIER_MAP`. Adding three new codes to `DEFAULT_WARNING_TIER_MAP` ensures legacy jobs (with snapshots that lack the three new codes) inherit the `informational` tier without explicit re-snapshotting.
- The existing `validateMergeOutput` call at `skillAnalyzerJob.ts:1217` returns the warnings array; the orchestration assigns it to a local `mergeWarnings`. Chunk 3 caches a copy before the gate so revert can restore.
- `mergeWarnings` survives JSON round-trip in `insertSingleResult` (it is jsonb on the column). New `CONSOLIDATION_APPLIED` detail (a JSON string of `{ preWords, postWords, reductionPct }`) round-trips the same way.
- `MergeWarning.detail` is typed as `string | undefined` (verified at `skillAnalyzerServicePure.ts:418`) — NOT a jsonb-typed object. Existing writers (lines 1912, 2009, 2075, 2094) stringify structured detail with `JSON.stringify(...)` exactly once; the column stores the warning record as a jsonb object whose `detail` field is the already-stringified payload. **T3 alignment:** all three new warning writers in this build (`CONSOLIDATION_APPLIED`, `_DECLINED`, `_FAILED`) stringify their detail payload once with `JSON.stringify(...)` — do NOT introduce a second encoding layer, do NOT store `detail` as a bare object. The UI banner in Chunk 4 parses with `JSON.parse(warning.detail ?? '{}')` and falls back to neutral copy on parse failure.

---

## 3. Chunk plan

Four chunks, in strict order C1 → C2 → C3 → C4, except C4 may parallelise with C3 once C1 lands (its dependency is purely on the schema fields). Each chunk's diff stays inside the file-inventory boundary; no drive-by edits.

### Chunk 1 — Schema + config (additive only)

```yaml
name: schema-config
spec_sections: "§4.5 column additions; §6 config columns + invariants; §8 file inventory (schema rows + migration); §10 state-machine closure (DB column type + NULL semantics); §13 spec-text patch for migration number"
files:
  - migrations/0358_skill_merge_consolidation.sql (NEW; verify 0358 is free at branch tip — if not, claim the next free slot)
  - migrations/0358_skill_merge_consolidation.down.sql (NEW)
  - server/db/schema/skillAnalyzerResults.ts (MODIFIED)
  - server/db/schema/skillAnalyzerConfig.ts (MODIFIED)
  - server/services/skillAnalyzerConfigService.ts (MODIFIED — read + ConfigPatch only)
  - tasks/builds/skill-merge-consolidation-pass/spec.md (MODIFIED — patch §5 + §10 migration-number text)
contracts:
  migrations/0358_skill_merge_consolidation.sql:
    - "ALTER TABLE skill_analyzer_results ADD COLUMN pre_consolidation_merge jsonb"
    - "ALTER TABLE skill_analyzer_results ADD COLUMN consolidation_outcome text"
    - "ALTER TABLE skill_analyzer_results ADD COLUMN consolidation_note text"
    - "ALTER TABLE skill_analyzer_config ADD COLUMN consolidation_enabled boolean NOT NULL DEFAULT true"
    - "ALTER TABLE skill_analyzer_config ADD COLUMN consolidation_trigger_severity text NOT NULL DEFAULT 'warning'"
    - "UPDATE skill_analyzer_config SET warning_tier_map = warning_tier_map || '{\"CONSOLIDATION_APPLIED\":\"informational\",\"CONSOLIDATION_DECLINED\":\"informational\",\"CONSOLIDATION_FAILED\":\"informational\"}'::jsonb WHERE key = 'default'"
    - "No backfill on skill_analyzer_results. Legacy rows: pre_consolidation_merge=NULL, consolidation_outcome=NULL, consolidation_note=NULL."
    - "Header comment: 'system-scoped tables touched: none. skill_analyzer_results and skill_analyzer_config are org-scoped; both already in RLS_PROTECTED_TABLES per existing migrations 0092/0155.'"
    - "Explicit no-CHECK rationale (T1) — header comment must include: 'No DB CHECK constraint is added on consolidation_outcome. This repo keeps similar result-state fields as text-only (see executionResult in skillAnalyzerResults.ts:132-133). Closure of the closed enum (not_triggered | succeeded | declined | failed) is enforced at the Drizzle $type<>() boundary, the parseConsolidationResponse parser, and the orchestration writer in skillAnalyzerJob.ts. Reviewers MUST NOT add a CHECK constraint without amending the spec.'"
  migrations/0358_skill_merge_consolidation.down.sql:
    - "ALTER TABLE skill_analyzer_config DROP COLUMN consolidation_trigger_severity"
    - "ALTER TABLE skill_analyzer_config DROP COLUMN consolidation_enabled"
    - "UPDATE skill_analyzer_config SET warning_tier_map = warning_tier_map - 'CONSOLIDATION_APPLIED' - 'CONSOLIDATION_DECLINED' - 'CONSOLIDATION_FAILED' WHERE key = 'default'"
    - "ALTER TABLE skill_analyzer_results DROP COLUMN consolidation_note"
    - "ALTER TABLE skill_analyzer_results DROP COLUMN consolidation_outcome"
    - "ALTER TABLE skill_analyzer_results DROP COLUMN pre_consolidation_merge"
  server/db/schema/skillAnalyzerResults.ts:
    - "Add columns matching migration column types and nullability:"
    - "  preConsolidationMerge: jsonb('pre_consolidation_merge')  // nullable"
    - "  consolidationOutcome: text('consolidation_outcome').$type<'not_triggered' | 'succeeded' | 'declined' | 'failed'>()  // nullable for legacy rows"
    - "  consolidationNote: text('consolidation_note')  // nullable"
    - "Comment block explains: NULL on legacy rows; post-migration rows always carry consolidationOutcome (orchestration writes 'not_triggered' when gate doesn't fire). preConsolidationMerge null on 'not_triggered'."
  server/db/schema/skillAnalyzerConfig.ts:
    - "Add columns:"
    - "  consolidationEnabled: boolean('consolidation_enabled').notNull().default(true)"
    - "  consolidationTriggerSeverity: text('consolidation_trigger_severity').$type<'warning' | 'critical'>().notNull().default('warning')"
    - "Extend default warningTierMap inline object to include CONSOLIDATION_APPLIED / _DECLINED / _FAILED all mapped to 'informational'. Drizzle default must match the migration's jsonb extension."
  server/services/skillAnalyzerConfigService.ts:
    - "Extend ConfigPatch with consolidationEnabled?: boolean and consolidationTriggerSeverity?: 'warning' | 'critical'. Validation: consolidationTriggerSeverity must be one of the two literals; throw {statusCode: 400, message: ...} otherwise. snapshotForJob already returns the full row, so the snapshot automatically carries the new fields once the row is written."
  spec.md:
    - "Replace '`0346`' in §5 idempotency-contract paragraph and §10 state-machine-closure paragraph with '`0358`' (or the actual claimed slot at commit time)."
error-handling:
  - "Drizzle generation failure on duplicate migration number: re-claim the next free slot at the moment of commit (rebase + rename); the file rename is the only fix path."
  - "ConfigPatch validation for consolidationTriggerSeverity rejects any value outside the literal pair with a 400. updateConfig already throws shape errors; this slot is a literal-list check."
  - "Down migration must be tested by hand at least once (drizzle migrate down) before chunk acceptance — order of DROP must reverse the ADDs to keep the column tail clean."
acceptance:
  - "`npm run lint` clean."
  - "`npm run typecheck` clean (both client and server tsconfigs)."
  - "Migration file applies cleanly against a fresh DB clone (drizzle-kit push / migrate); down migration reverses cleanly."
  - "`SELECT consolidation_enabled, consolidation_trigger_severity, warning_tier_map ? 'CONSOLIDATION_APPLIED' FROM skill_analyzer_config WHERE key='default'` returns (true, 'warning', true) after apply."
  - "`server/db/schema/index.ts` (or wherever skill_analyzer_results / config are exported) compiles with the new columns; no schema-level circular import (per DEVELOPMENT_GUIDELINES §3 leaf rule)."
  - "Spec migration-number references updated in the same commit as the migration file (R13)."
  - "No code in skillAnalyzerJob.ts / skillAnalyzerService.ts reads the new columns yet — Chunk 1 ships schema only; behaviour is unchanged."
dependencies:
  - "None — entry chunk."
```

**Module shape.** Public interface this chunk exposes: three new nullable columns on `skill_analyzer_results` (`pre_consolidation_merge`, `consolidation_outcome`, `consolidation_note`), two new NOT NULL columns on `skill_analyzer_config` (`consolidation_enabled`, `consolidation_trigger_severity`), and the extended `ConfigPatch` interface for the existing PATCH /config endpoint. Hidden behind it: the migration's DDL ordering, the jsonb concatenation operator (`||`) used to extend `warning_tier_map` without overwriting other operator customisation, the down-migration's reverse DDL, and the Drizzle `$type<>()` literal-union annotations that pre-narrow the TS surface so consumers in C2/C3/C4 never see a bare `string`.

### Chunk 2 — Pure functions + prompt + new warning codes

```yaml
name: pure-functions-and-warnings
spec_sections: "§3 primitives reuse (new pure-function siblings); §4.1, §4.2, §4.3 contracts; §4.4 new warning codes; §6 union + tier map + RESOLUTIONS_FOR_CODE extension; §11 testing posture (pure tests)"
files:
  - server/services/skillAnalyzerServicePure.ts (MODIFIED)
  - server/services/__tests__/skillAnalyzerServicePure.consolidation.test.ts (NEW; Vitest)
contracts:
  server/services/skillAnalyzerServicePure.ts:
    - "Extend MergeWarningCode union (line 392-410) with three new codes (in this order, immediately after 'CROSS_REFERENCES_DISTINCT'): 'CONSOLIDATION_APPLIED' | 'CONSOLIDATION_DECLINED' | 'CONSOLIDATION_FAILED'."
    - "Extend DEFAULT_WARNING_TIER_MAP (line 431) with the three new codes mapped to 'informational'."
    - "Extend RESOLUTIONS_FOR_CODE (line 547) with the three new codes mapped to [] (empty array — no reviewer action). Sorted alphabetically-by-block to match existing pattern."
    - "Export type ConsolidationOutcome = 'not_triggered' | 'succeeded' | 'declined' | 'failed'."
    - "Export type PreservationInventoryItem = { kind: 'tool_ref' | 'hitl_phrase' | 'invocation_block'; value: string }."
    - "Export type PreservationInventory = PreservationInventoryItem[]."
    - "Export function extractPreservationInventory(merged: ProposedMerge): { tier1: PreservationInventory; tier2: PreservationInventory }. Tier 1: every backtick-wrapped identifier in merged.instructions (regex /`([^`\\n]+)`/g) + invocation block (extractInvocationBlock helper, already exported) + HITL phrase matches from a hard phrase set ('do not send directly', 'do not post without approval', 'review before sending', 'human approval required', 'present to user for confirmation', 'do not send without', 'confirm before'). Tier 2: bare tool/skill identifiers matching a deterministic identifier shape (snake_case or kebab-case ≥ 4 chars containing an underscore or hyphen, NOT inside backticks, NOT inside markdown link targets) + lower-confidence HITL phrases ('confirm before', 'requires human approval', 'do not act without confirmation'). Tier 2's exact phrase set is the implementer's prerogative — keep it conservative; false-positives are tolerable since Tier 2 is informational. Pure function: no DB, no network, no clock."
    - "Export function buildConsolidationPrompt(merged: ProposedMerge, richerSourceWords: number, mergedWords: number, scopeExpansionStandardThreshold: number): { system: string; userMessage: string }. The system prompt opens with role framing ('You consolidate skill-merge outputs for length without losing capability'), includes verbatim the §4.2 hard-preservation list, the reduction targets, the output ceiling formula (target = richerSourceWords * (1 + standardThreshold), rounded), and the self-check checklist. The user message includes MERGED SKILL (DRAFT) as a JSON-serialised ProposedMerge minus mergeRationale, plus the PRESERVATION INVENTORY (tier 1 verbatim list + tier 2 best-effort list) computed via extractPreservationInventory, plus the word counts and target ceiling. Output format spec embedded in system prompt requests strict JSON matching the §4.3 response shape."
    - "Export type ConsolidationParseResult = { consolidatedMerge: ProposedMerge; consolidationNote: string; declinedToConsolidate: boolean; declineReason: string | null }."
    - "Export type ConsolidationParseRejection = { reason: 'mutated_name' | 'mutated_description' | 'mutated_definition' | 'rationale_missing_or_invalid' | 'mutated_rationale' | 'instructions_not_string' | 'instructions_empty' | 'note_missing_or_invalid' | 'declined_not_boolean' | 'decline_reason_missing' | 'malformed_json' }."
    - "Export function parseConsolidationResponse(raw: string, original: ProposedMerge): ConsolidationParseResult | ConsolidationParseRejection. Response shape per §4.3 declares consolidatedMerge: ProposedMerge — mergeRationale is therefore a required string field. Apply rejection rules in this order: (1) JSON.parse failure → 'malformed_json'; (2) consolidatedMerge.name !== original.name → 'mutated_name'; (3) description mismatch → 'mutated_description'; (4) definition deep-equal mismatch → 'mutated_definition'; (5a — NEW, F4) typeof mergeRationale !== 'string' OR mergeRationale.trim() === '' → 'rationale_missing_or_invalid' (catches missing-field + null + non-string + whitespace-only cases that would otherwise produce a malformed ProposedMerge downstream); (5b) mergeRationale !== original.mergeRationale → 'mutated_rationale'; (6) typeof instructions !== 'string' → 'instructions_not_string'; (7) instructions.trim() === '' → 'instructions_empty'; (8) consolidationNote missing/empty/whitespace → 'note_missing_or_invalid'; (9) typeof declinedToConsolidate !== 'boolean' → 'declined_not_boolean'; (10) declinedToConsolidate=true with null/empty declineReason → 'decline_reason_missing'. Returns the ConsolidationParseResult on success. NEVER throws — every malformed input maps to one of the rejection reasons above."
  server/services/__tests__/skillAnalyzerServicePure.consolidation.test.ts:
    - "test('buildConsolidationPrompt embeds tier-1 verbatim list + tier-2 best-effort list')"
    - "test('buildConsolidationPrompt sets target ceiling to richer-source words * (1 + standardThreshold) rounded')"
    - "test('buildConsolidationPrompt user message includes mergedWords and richerSourceWords numerics')"
    - "test('parseConsolidationResponse rejects mutated name')"
    - "test('parseConsolidationResponse rejects mutated description')"
    - "test('parseConsolidationResponse rejects mutated definition (deep-equal)')"
    - "test('parseConsolidationResponse rejects mutated mergeRationale when echoed back')"
    - "test('parseConsolidationResponse rejects missing mergeRationale field (rationale_missing_or_invalid)')"
    - "test('parseConsolidationResponse rejects null mergeRationale (rationale_missing_or_invalid)')"
    - "test('parseConsolidationResponse rejects non-string mergeRationale (rationale_missing_or_invalid)')"
    - "test('parseConsolidationResponse rejects whitespace-only mergeRationale (rationale_missing_or_invalid)')"
    - "test('parseConsolidationResponse rejects instructions=null')"
    - "test('parseConsolidationResponse rejects instructions=whitespace-only')"
    - "test('parseConsolidationResponse rejects missing consolidationNote')"
    - "test('parseConsolidationResponse rejects empty consolidationNote')"
    - "test('parseConsolidationResponse rejects non-boolean declinedToConsolidate')"
    - "test('parseConsolidationResponse rejects declinedToConsolidate=true with null declineReason')"
    - "test('parseConsolidationResponse accepts valid declinedToConsolidate=true with non-empty declineReason')"
    - "test('parseConsolidationResponse accepts valid succeeded response')"
    - "test('DEFAULT_WARNING_TIER_MAP contains CONSOLIDATION_APPLIED/_DECLINED/_FAILED at informational tier')"
    - "test('RESOLUTIONS_FOR_CODE for three new codes returns []')"
    - "test('extractPreservationInventory captures every backtick-wrapped identifier in tier1')"
    - "test('extractPreservationInventory captures invocation block in tier1')"
    - "test('extractPreservationInventory captures HITL phrases in tier1')"
    - "test('extractPreservationInventory does NOT promote tier-2 phrase variants into tier1')"
    - "Uses Vitest: import { test, expect, describe } from 'vitest'. No node:test. No DB import (gate verify-pure-helper-convention.sh)."
error-handling:
  - "parseConsolidationResponse never throws — all malformed inputs return a typed rejection. Callers (Chunk 3) treat any rejection as `consolidationOutcome='failed'` with `failureReason='parse_rejected:' + rejection.reason`."
  - "buildConsolidationPrompt never throws. If extractPreservationInventory returns empty lists (degenerate merge with no preservation-worthy elements), the prompt still renders with empty INVENTORY blocks — the orchestration is free to proceed."
  - "Adding a new MergeWarningCode without extending DEFAULT_WARNING_TIER_MAP, RESOLUTIONS_FOR_CODE, and the union in lockstep is a DEVELOPMENT_GUIDELINES §8.13 violation. The chunk modifies all three in the same diff."
acceptance:
  - "`npm run lint` clean."
  - "`npm run typecheck` clean."
  - "`npx vitest run server/services/__tests__/skillAnalyzerServicePure.consolidation.test.ts` — all tests pass."
  - "skillAnalyzerServicePure.ts continues to satisfy verify-pure-helper-convention.sh (no DB imports). Static check: the new test file has zero `db/` or `services/.*Service\\.ts` imports."
  - "No callers of the new functions yet — Chunk 2 ships pure functions; behaviour is unchanged."
dependencies:
  - "Chunk 1 recommended but NOT technically required (F3 correction). Chunk 2 is pure-function only: the `ConsolidationOutcome` TS literal union does not depend on the Drizzle schema column existing — Drizzle's `$type<>()` is consumed only by writers/readers (which land in Chunk 3). Chunk 2 may technically land before Chunk 1, provided no DB writer or reader consumes the new fields yet. The canonical build order remains C1 → C2 → C3 → C4 to reduce review complexity and surface schema/typing drift early, but the order is operator-preference, not type-coupling."
```

**Module shape.** Public interface this chunk exposes: three new exported functions (`buildConsolidationPrompt`, `parseConsolidationResponse`, `extractPreservationInventory`), three new exported types (`ConsolidationOutcome`, `ConsolidationParseResult`, `ConsolidationParseRejection`), three new entries on `MergeWarningCode` / `DEFAULT_WARNING_TIER_MAP` / `RESOLUTIONS_FOR_CODE`. Hidden behind it: the exact regex used to match backticked identifiers (kept private so the prompt builder can refine it without breaking consumers), the HITL phrase set (private const), the JSON-extraction tolerance in `parseConsolidationResponse` (it strips the same code-fence wrappers `parseClassificationResponseWithMerge` already tolerates), the order-of-rejection rule application (encoded inside the parser, not exposed), and the system-prompt copy itself (which the implementer may refine without breaking the typed surface).

### Chunk 3 — Orchestration (the gate)

```yaml
name: orchestration-gate
spec_sections: "§3 primitives reuse (third routeCall call site); §4.5 source-of-truth precedence implementation; §5 execution model (entire section); §6 trigger severity wiring; §8 file inventory (jobs + service rows); §10 idempotency / retry / concurrency / terminal-event guarantees; §12 deferred items (rule-based fallback gets 'not_triggered')"
files:
  - server/jobs/skillAnalyzerJob.ts (MODIFIED)
  - server/services/skillAnalyzerService.ts (MODIFIED)
contracts:
  server/jobs/skillAnalyzerJob.ts:
    - "Inside Stage 5 per-result block, between line 1217 (validateMergeOutput) and line 1229 (table-row recovery), insert the consolidation gate."
    - "Capture: const preConsolidationMergeWarnings = mergeWarnings.slice() before the gate runs (R2)."
    - "Gate predicate: configSnapshot.consolidationEnabled === true (or undefined for legacy snapshots — default-true semantics) AND mergeWarnings.some(w => w.code === 'SCOPE_EXPANSION' || w.code === 'SCOPE_EXPANSION_CRITICAL') AND (configSnapshot.consolidationTriggerSeverity === 'warning' || mergeWarnings.some(w => w.code === 'SCOPE_EXPANSION_CRITICAL'))."
    - "If gate does not fire: consolidationOutcome='not_triggered'; preConsolidationMerge=null; consolidationNote=null."
    - "If gate fires: capture preConsolidationMerge = JSON.parse(JSON.stringify(storedMerge)). Compute richerSourceWords = max(wordCount(base.instructions), wordCount(nonBase.instructions)). Compute mergedWords = wordCount(storedMerge.instructions)."
    - "Build prompt: const { system, userMessage } = buildConsolidationPrompt(storedMerge, richerSourceWords, mergedWords, configSnapshot.scopeExpansionStandardThreshold ?? 0.40)."
    - "Call routeCall with featureTag: 'skill-analyzer-consolidate', model: 'claude-sonnet-4-6', maxTokens: 8192, temperature: 0.1, provider: 'anthropic', systemCallerPolicy: 'bypass_routing', sourceType: 'analyzer', sourceId: jobId, organisationId: job.organisationId, taskType: 'general'. Same abort-controller timeout pattern as the merge call (SKILL_CLASSIFY_TIMEOUT_MS reused). Single attempt — NO retry escalation per spec §2 choice 3."
    - "postProcess (inside routeCall): pass-through. Do NOT call parseConsolidationResponse inside postProcess and do NOT throw on parser rejection — parser rejection is a content-level outcome, not a routeCall failure. The postProcess returns the raw model content string unchanged."
    - "After routeCall returns (or throws): call parseConsolidationResponse(rawContent, storedMerge) on the caller side. The parser returns either a typed ConsolidationParseResult or a typed ConsolidationParseRejection — it never throws. This keeps parser rejection (a content outcome) distinguishable from routeCall failure (a transport/timeout/llm_error outcome) in logs and in §4.3's failure-reason taxonomy (R3, F2)."
    - "Branch tree (four mutually exclusive branches, in evaluation order):"
    - "  (1) routeCall threw → catch the throw. consolidationOutcome='failed'. failureReason='timeout' on AbortError / TimeoutError, 'llm_error: <error.code or error.message slug>' otherwise. NEVER 'parse_rejected' on this branch (parser was not reached). Append warning { code: 'CONSOLIDATION_FAILED', severity: 'warning', message: 'Tightening pass did not complete — reviewer is seeing the original merge.', detail: JSON.stringify({ failureReason }) }. mergeWarnings stays as the pre-consolidation set. preConsolidationMerge captured pre-gate. storedMerge unchanged. consolidationNote=null."
    - "  (2) routeCall returned + parseConsolidationResponse returned a ConsolidationParseRejection → consolidationOutcome='failed'. failureReason='parse_rejected: ' + rejection.reason. Log skill_analyzer_consolidation_parse_failure with the rejection.reason. Append warning as in branch (1) with this failureReason. mergeWarnings stays as the pre-consolidation set. preConsolidationMerge captured pre-gate. storedMerge unchanged. consolidationNote=null."
    - "  (3) routeCall returned + ConsolidationParseResult with declinedToConsolidate=true → consolidationOutcome='declined'. consolidationNote=parsed.consolidationNote. preConsolidationMerge captured. storedMerge unchanged. Append warning { code: 'CONSOLIDATION_DECLINED', severity: 'warning', message: '...', detail: JSON.stringify({ declineReason: parsed.declineReason }) }. Per spec §5 step 5: ignore parsed.consolidatedMerge entirely on decline."
    - "  (4) routeCall returned + ConsolidationParseResult with declinedToConsolidate=false → provisional success. Replace storedMerge with parsed.consolidatedMerge. Re-run validateMergeOutput with the same arguments as the line 1217 call, but with the post-consolidation merge. Compute hardViolationSet = new Set<MergeWarningCode>(['HITL_LOST', 'INVOCATION_LOST', 'REQUIRED_FIELD_DEMOTED', 'CAPABILITY_OVERLAP'])."
    - "  Hard-constraint check (branch 4 continued): const preHard = new Set(preConsolidationMergeWarnings.filter(w => hardViolationSet.has(w.code)).map(w => w.code)); const postHard = new Set(postWarnings.filter(w => hardViolationSet.has(w.code)).map(w => w.code)); const newViolations = [...postHard].filter(c => !preHard.has(c))."
    - "  If newViolations.length > 0 (sub-revert of branch 4): storedMerge = preConsolidationMerge. mergeWarnings = preConsolidationMergeWarnings.slice() (cache restore). consolidationOutcome='failed'. failureReason='hard_constraint_violation: ' + newViolations.join(','). Append { code: 'CONSOLIDATION_FAILED', detail: JSON.stringify({ failureReason }) }. consolidationNote=null (discard the LLM's note when reverting). This sub-branch is the ONLY 'failed' path with a parsed note in hand; the rule still applies."
    - "  If newViolations.length === 0 (success of branch 4): mergeWarnings = postWarnings. consolidationOutcome='succeeded'. consolidationNote=parsed.consolidationNote. preWords = wordCount(preConsolidationMerge.instructions). postWords = wordCount(storedMerge.instructions). reductionPct = preWords > 0 ? Math.round((1 - postWords/preWords) * 100) : 0. Append { code: 'CONSOLIDATION_APPLIED', severity: 'warning', message: `AI tightened the merge from ${preWords} to ${postWords} words (${reductionPct}% shorter).`, detail: JSON.stringify({ preWords, postWords, reductionPct }) }."
    - "consolidationNote write rule (T4 — applies to all four branches): on every 'failed' outcome (transport failure, parse rejection, hard-constraint revert), consolidationNote=null. On 'declined', consolidationNote=parsed.consolidationNote. On 'succeeded', consolidationNote=parsed.consolidationNote. On 'not_triggered' (gate did not fire), consolidationNote=null."
    - "Pass through to existing line 1229 (table-row recovery) and onward. The downstream blocks now operate on the (possibly consolidated) storedMerge and the final mergeWarnings."
    - "On the insertSingleResult call at line 1365: add new args { preConsolidationMerge, consolidationOutcome, consolidationNote }. On the DISTINCT immediate-write path at line 826: add { preConsolidationMerge: null, consolidationOutcome: 'not_triggered', consolidationNote: null }. On the rule-based fallback path at line 760: same."
    - "originalProposedMerge precedence (per §1.4): pass `storedMerge` unchanged on success (it is now the post-consolidation merge), so line 1378's behaviour writes the post-consolidation merge into originalProposedMerge automatically. On failure-revert / declined / not-triggered, storedMerge is the pre-consolidation merge, which is what we want for Reset."
    - "Add logger.info('skill_analyzer_consolidation_outcome', { jobId, slug, outcome, preWords?, postWords?, declineReason?, failureReason? }) on every branch for observability."
  server/services/skillAnalyzerService.ts:
    - "insertSingleResult is typed against $inferInsert; once Chunk 1 lands, the new columns are part of $inferInsert automatically. No signature change to insertSingleResult itself — callers pass extra fields directly."
    - "getJob result projection at line 380 already does ...r spread on rawResults. The new columns flow through automatically as part of the typed select."
error-handling:
  - "routeCall throws inside the gate (branch 1): caught by an inline try/catch around the gate scope. consolidationOutcome='failed', failureReason='timeout' | 'llm_error: <code>' as appropriate. The row still ships. NEVER use the 'parse_rejected:*' failureReason on this branch — that taxonomy is reserved for branch 2."
  - "parser rejection (branch 2): parseConsolidationResponse returns a typed ConsolidationParseRejection — it does NOT throw. The orchestration inspects the discriminated return and routes to consolidationOutcome='failed' with failureReason='parse_rejected: <rejection.reason>'. This is intentionally distinct from branch 1 so the four-branch tree stays crisp in logs and reality-checker evidence."
  - "Network 429: routeCall's existing rate-limit handling applies. If routeCall surfaces the rate-limit as a thrown error, the gate sees branch 1 (transport failure) and sets failureReason='llm_error: 429' (or the slug routeCall uses)."
  - "If consolidation throws AND the gate is mid-state (preConsolidationMerge captured but storedMerge not yet replaced), revert state to pre-gate: discard any partial parse, restore mergeWarnings = preConsolidationMergeWarnings.slice()."
  - "DUPLICATE / DISTINCT path: no gate involvement; insert with consolidationOutcome='not_triggered' and consolidationNote=null."
acceptance:
  - "`npm run lint` clean."
  - "`npm run typecheck` clean."
  - "`npm run build:server` clean — the new `insertSingleResult` extra-field shape matches the schema's $inferInsert."
  - "End-to-end (manual): run analyzer against a known SCOPE_EXPANSION reproducer (operator-supplied fixture). Confirm: (a) skill_analyzer_results row has consolidation_outcome set to one of the four values; (b) mergeWarnings includes one of the three new codes when gate fired; (c) preConsolidationMerge null only on not_triggered; (d) on succeeded, proposedMergedContent has fewer instruction words than preConsolidationMerge."
  - "End-to-end (manual): run analyzer against a fixture that produces only DISTINCT / DUPLICATE results. Confirm consolidation_outcome='not_triggered' on every row AND llm_requests audit shows zero rows with featureTag='skill-analyzer-consolidate' for this job."
  - "Targeted unit test (T2 — 'still bloated but shorter = succeeded'): extract the success/revert outcome predicate (or the hard-violation set diff) into a pure helper inside skillAnalyzerServicePure.ts (recommended; counts under T5's helper-extraction allowance) and assert: GIVEN a consolidated output that is shorter than pre-consolidation but still emits SCOPE_EXPANSION on re-validation, WHEN the orchestration evaluates the outcome predicate, THEN it returns 'succeeded'; the row persists with consolidationOutcome='succeeded'; mergeWarnings retains SCOPE_EXPANSION; mergeWarnings appends CONSOLIDATION_APPLIED. This pins spec §5's outcome-classification rule and prevents a regression to the pre-Round-2 framing where a still-bloated post-consolidation merge would be misclassified as 'failed'."
  - "Targeted unit test (cross-reference): the same helper, with a post-consolidation merge that introduces a NEW HITL_LOST warning, returns 'failed' (hard-constraint revert) and the cached pre-consolidation warnings are restored."
dependencies:
  - "Chunk 1 (strict — schema columns must exist for $inferInsert)."
  - "Chunk 2 (strict — buildConsolidationPrompt, parseConsolidationResponse, ConsolidationOutcome, three new warning codes must exist)."
```

**Module shape.** Public interface this chunk exposes: the consolidation gate runs implicitly inside `processSkillAnalyzerJob`; no new exported job function, no new service method. The single externally observable change is that `skill_analyzer_results.consolidation_outcome` is always one of four values on post-migration rows, and `mergeWarnings` may contain one of three new codes. Hidden behind it: the timing of `preConsolidationMergeWarnings` capture, the hard-violation set definition, the order in which the gate's branches evaluate (parse rejection > timeout > declined > succeeded), the routeCall featureTag and the abort-controller reuse, the `wordCount` reuse, the JSON-deep-copy of `storedMerge` for the audit field, the `originalProposedMerge` precedence (it follows `storedMerge` so the existing line 1378 keeps working unchanged). Callers of `getJob` see three new fields — they are not required to read them; legacy UI continues to render the row.

### Chunk 4 — UI banner

```yaml
name: ui-banner
spec_sections: "§4.5 source-of-truth precedence (UI consumes); §4.4 size-delta telemetry from CONSOLIDATION_APPLIED detail; §7 entire section (banner copy + disclosure)"
files:
  - client/src/components/skill-analyzer/MergeReviewBlock.tsx (MODIFIED)
  - client/src/components/skill-analyzer/types.ts (MODIFIED)
  - client/src/components/skill-analyzer/mergeTypes.ts (MODIFIED)
contracts:
  client/src/components/skill-analyzer/types.ts:
    - "Add to AnalysisResult interface (after wasApprovedBefore):"
    - "  preConsolidationMerge?: ProposedMergedContent | null;"
    - "  consolidationOutcome?: 'not_triggered' | 'succeeded' | 'declined' | 'failed' | null;"
    - "  consolidationNote?: string | null;"
  client/src/components/skill-analyzer/mergeTypes.ts:
    - "Extend MergeWarningCode union with 'CONSOLIDATION_APPLIED' | 'CONSOLIDATION_DECLINED' | 'CONSOLIDATION_FAILED'."
    - "Extend DEFAULT_WARNING_TIER_MAP with three new codes mapped to 'informational'."
    - "Extend RESOLUTIONS_FOR_CODE with three new codes mapped to [] (empty array)."
    - "Extend warningLabel switch with three new cases: 'CONSOLIDATION_APPLIED' → 'Consolidation applied'; 'CONSOLIDATION_DECLINED' → 'Consolidation declined'; 'CONSOLIDATION_FAILED' → 'Consolidation failed'."
    - "Extend warningBadgeClass switch with three new cases: APPLIED → 'bg-emerald-100 text-emerald-800'; DECLINED → 'bg-amber-100 text-amber-800'; FAILED → 'bg-amber-100 text-amber-800'."
  client/src/components/skill-analyzer/MergeReviewBlock.tsx:
    - "Add ConsolidationBanner sub-component (defined inside the same file to match the existing pattern — MergeReviewBlock already houses several internal helpers)."
    - "Render <ConsolidationBanner result={result} /> immediately above the three-column diff container."
    - "Banner is null when result.consolidationOutcome is null or 'not_triggered'."
    - "Banner copy and tone per spec §7:"
    - "  succeeded: green accent ('bg-emerald-50 border-emerald-200 text-emerald-900'). Headline: 'AI tightened this merge from {preWords} to {postWords} words ({reductionPct}% shorter) without losing capability.' (Extract preWords/postWords/reductionPct from the CONSOLIDATION_APPLIED warning's detail JSON — fall back to neutral copy if detail unparseable.) Body: result.consolidationNote rendered as plain text (whitespace preserved). 'View pre-consolidation draft' disclosure (uses native <details> for simplicity, matching the codebase's preference for accessible primitives over custom components per frontend principles) — when expanded, shows preConsolidationMerge.instructions in a read-only <pre>."
    - "  declined: amber accent ('bg-amber-50 border-amber-200 text-amber-900'). Headline: 'AI reviewed this merge for tightening and judged it cannot be shortened without losing capability.' Body: extract declineReason from CONSOLIDATION_DECLINED warning's detail JSON, render after 'Reason: '."
    - "  failed: amber accent. Headline: 'Tightening pass did not complete — reviewer is seeing the original merge.' Body: extract failureReason from CONSOLIDATION_FAILED warning's detail JSON, render after 'Reason: '."
    - "No new state, no new API call. The banner reads result.consolidationOutcome + result.preConsolidationMerge + result.consolidationNote + the matching warning in result.mergeWarnings."
    - "Banner reads with optional chaining (?.) — if a legacy row arrives without the field (NULL), banner short-circuits to null."
    - "Use 'data-testid=\"consolidation-banner\"' on the outer div for any future smoke test the operator chooses to add."
error-handling:
  - "Detail JSON parse failure (defensive — shouldn't happen if Chunk 3 wrote the detail correctly): banner renders the neutral fallback copy ('AI tightened this merge to fit the target ceiling.') and omits the size delta. No throw."
  - "preConsolidationMerge missing on succeeded outcome (defensive): disclosure renders 'No pre-consolidation draft available' rather than throwing."
acceptance:
  - "`npm run lint` clean."
  - "`npm run typecheck` clean."
  - "`npm run build:client` clean — the new AnalysisResult fields type-check against the GET /jobs/:id response shape."
  - "Manual smoke (operator) per spec §11 — render a fixture row with consolidation_outcome='succeeded' and a non-null preConsolidationMerge; banner appears; disclosure opens; pre-consolidation text is visible."
  - "Manual smoke — render a row with consolidation_outcome='not_triggered'; banner does not appear."
dependencies:
  - "Chunk 1 (strict — schema columns must exist for the GET /jobs/:id response to carry them)."
  - "Chunk 2 is recommended but NOT strict — Chunk 4 can land after Chunk 1 alone if the orchestration is not yet wired, because the UI gracefully renders nothing on 'not_triggered' / null. However, the manual smoke step in acceptance requires Chunk 3 to produce real data; absent that, the manual step is deferred until Chunk 3 lands."
```

**Module shape.** Public interface this chunk exposes: three new optional fields on `AnalysisResult`, three new entries on the client-side `MergeWarningCode` union and supporting maps, and a single render path inside `MergeReviewBlock` that displays the consolidation banner. Hidden behind it: the conditional banner colour-coding, the warning-detail JSON parse with neutral-fallback, the disclosure component (HTML `<details>`), the read-only `<pre>` formatting for the pre-consolidation draft, and the data-testid that opens the door for future smoke tests. No new API call, no new state, no change to Reset / Approve / Execute paths.

---

## 4. Spec-section coverage matrix

| Spec section | Chunk(s) covering |
|---|---|
| §1 Problem | Context only — not implemented; covered by R1, R7 (warning detail shape derives from the §1 framing). |
| §2 Approach (3 design choices) | C3 (gate placement is conditional + separate call + single-attempt no-escalation). |
| §3 Existing primitives reused | C2 (pure-function siblings), C3 (routeCall third call site), C4 (effectiveTierMap + warningTierMap reuse). |
| §4.1 Consolidation prompt input | C2 (`buildConsolidationPrompt` + `extractPreservationInventory`). |
| §4.2 Consolidation prompt instructions | C2 (prompt copy is verbatim in `buildConsolidationPrompt`). |
| §4.3 Response shape + parser rejection rules | C2 (`parseConsolidationResponse`). |
| §4.4 New MergeWarning codes + size-delta telemetry source | C2 (server union/maps), C3 (writer), C4 (client union/maps + detail reader). |
| §4.5 Source-of-truth precedence (post-consolidation row) | C1 (column adds), C3 (writer rules), C4 (reader). |
| §5 Execution model (all sequencing rules) | C3. |
| §6 Config surface (both columns + trigger-severity invariant + tier-map independence) | C1 (column adds + ConfigPatch extension), C3 (gate predicate reads the snapshot, NOT tierMap — R8). |
| §7 UI surface (banner + disclosure) | C4. |
| §8 File inventory | All four chunks together; see file list per chunk. |
| §9 Phase plan | Adopted verbatim as the chunk plan. |
| §10 Execution-safety contracts | C3 (idempotency, retry, concurrency, terminal event, no-silent-partial-success, state-machine closure, no-consolidation guarantee). |
| §11 Testing posture | C2 (pure tests). No frontend / API / E2E per docs/spec-context.md. |
| §12 Deferred items | C3 (rule-based fallback emits `'not_triggered'`; rest are non-build items). |
| §13 Non-goals | No build action — documented stance. |
| §14 Open questions | See §5 below. |

All spec sections that name an implementation surface map onto at least one chunk. No gaps.

---

## 5. Open questions for the operator

Both questions are explicit in spec §14. Plan recommendations follow the spec's defaults; operator may flip without affecting the chunk plan.

1. **`CONSOLIDATION_FAILED` tier — informational vs standard.** Spec defaults to `informational` ("polish failure is acceptable" framing). The plan ships with informational. If observed failure rate during dogfooding is high enough that reviewers should be alerted, an operator can `PATCH /config { warningTierMap: { CONSOLIDATION_FAILED: 'standard' } }` without a code change — Chunk 1's migration sets the default but does not constrain operator overrides. **Plan recommendation: keep informational. Re-tune via PATCH after the first week of telemetry.**

2. **Banner pre-consolidation diff: inline vs disclosure.** Spec proposes disclosure (collapsed by default) to keep the review page uncluttered. Chunk 4 ships disclosure. Flipping to inline is a one-line render change — no schema or service impact. **Plan recommendation: ship disclosure as specified. Operator may toggle by editing the JSX line directly if dogfooding shows reviewers always expand it.**

No additional open questions surfaced during plan authoring. The four-chunk decomposition cleanly maps every spec section.

---

## 6. Migration-number choice (decision)

**Claimed slot: `0358_skill_merge_consolidation.sql` + `.down.sql`.**

**Slot-claim history:**

| Date | Claimed slot | Reason for shift |
|---|---|---|
| 2026-05-14 (plan v1) | `0351` | `0346-0350` occupied by iee-browser-on-e2b (PR #297) when plan was authored. `0351` was the next free slot. |
| 2026-05-14 (S1 sync) | **`0358`** | personal-assistant-v2-operator (PR #299) merged after plan v1, claiming `0351-0357`. R1's prediction came true literally: another build merged migrations to slot `0351` between plan acceptance and Chunk 1 commit. |

Verification at S1-sync time (2026-05-14, post `git merge origin/main`): `migrations/035*.sql` listing shows `0357_ea_controller_style_native_and_operator.sql` is the highest numbered file on `origin/main`. `0358` is free. Spec text (§5 last paragraph, §10 state-machine-closure clause) still refers to `0346` — this is stale and must be patched to `0358` in the Chunk 1 commit.

Chunk 1 ships the file as `0358` AND patches the two spec-text references in the same commit (R13). If main merges another migration to slot `0358` between plan acceptance and Chunk 1 commit, the builder rebases and claims the next free slot, repeating the spec-text patch with the new number.

The final number may shift again at the moment of final merge (per `CLAUDE.md §6` migration discipline). The final renumber happens immediately before merge, after rebasing onto latest main; if it does, the spec-text patch shifts with it.

---

## Review-round revisions

**Round 1 — 2026-05-14, chatgpt-plan-review (manual ChatGPT-web mode).** Review log: `tasks/review-logs/chatgpt-plan-review-skill-merge-consolidation-pass-2026-05-14T00-22-11Z.md`. Reviewer verdict: structurally sound, not blocked; 4 should-fix findings (F1–F4) and 5 tightenings (T1–T5). All applied:

| Finding | Where applied | Summary |
|---|---|---|
| F1 — gate placement authority | §1.1 new "Placement authority" paragraph | Distinguishes pre-consolidation cohort (≤ line 1217) from post-consolidation cohort (lines 1229–1365). Existing remediation blocks do not move. |
| F2 — parser rejection should not throw | Chunk 3 contracts + error-handling | postProcess is pass-through; parseConsolidationResponse runs after routeCall returns and returns a discriminated rejection rather than throwing. Four-branch tree explicit. |
| F3 — Chunk 2 strict dependency was over-stated | Chunk 2 dependencies | Relaxed to recommended-not-required; canonical order C1→C2→C3→C4 preserved by convention, not by type coupling. Chunk 3 remains strictly dependent on both. |
| F4 — missing-mergeRationale rejection | Chunk 2 parser contract + tests | New rule `rationale_missing_or_invalid` catches missing/null/non-string/whitespace-only `mergeRationale`; four new test cases. Mutation rule unchanged. |
| T1 — explicit "no DB CHECK" rationale | Chunk 1 migration header comment | Header comment now records the no-CHECK decision and the closure-enforcement chain (Drizzle $type<>(), parser, writer). |
| T2 — "still bloated but shorter = succeeded" test | Chunk 3 acceptance | New targeted unit test pinning §5's outcome-classification rule; second test pinning the hard-constraint revert. |
| T3 — warning detail single-stringify | §2.2 Load-bearing assumptions | Verified `MergeWarning.detail` is `string` at `skillAnalyzerServicePure.ts:418`; explicit "single stringify, no double encoding" rule recorded. |
| T4 — consolidationNote write rule per outcome | Chunk 3 contracts (last contract line) | Explicit rule: null on all `failed` paths (transport, parse, revert), null on `not_triggered`, parsed value on `declined` and `succeeded`. |
| T5 — helper-extraction allowance scope | §1.6 closing paragraph | Helper extractions allowed only inside existing files (`skillAnalyzerServicePure.ts` or `skillAnalyzerJob.ts`); no new modules/services/subdirectories. |

No directional findings raised; no structural changes to the chunk decomposition or spec coverage matrix.

**Round 2 — 2026-05-14, chatgpt-plan-review (lock decision + nit + S1 sync drift).** Reviewer verdict: "Round 1 findings applied cleanly. Plan ready to build. One tiny consistency nit." Plus a same-session `git merge origin/main` surfaced the migration-slot drift that R1 anticipated.

| Item | Where applied | Summary |
|---|---|---|
| Nit (R14 mitigation wording) | §2.1 R14 row | Mitigation said "C2 and C3 cannot proceed until C1 lands" — that contradicted F3's relaxation. Rewritten: "C3 cannot proceed until C1 lands. C2 is pure-function only and may technically land before C1; canonical order C1→C2→C3→C4 remains by convention." |
| Main sync (S1) — migration slot | §2.1 R1 row, §6 Migration-number choice, every contract block referencing `0351`, and the spec-text patch contract line | `git merge origin/main` brought in PR #299 (personal-assistant-v2-operator), which claimed migration slots `0351-0357`. Plan renumbered claim from `0351` → **`0358`**. R1's predicted "another migration claims the slot between plan acceptance and Chunk 1 commit" came true literally. Slot-claim history table added to §6 to preserve the audit trail. |
| Main sync (S1) — file inventory | §2.2 + plan-touched-files check | Audited main's diff: none of the plan's nine target files (skillAnalyzerJob.ts, skillAnalyzerService.ts, skillAnalyzerServicePure.ts, skillAnalyzerResults.ts, skillAnalyzerConfig.ts, skillAnalyzerConfigService.ts, MergeReviewBlock.tsx, mergeTypes.ts, types.ts) were modified by main. Plan's chunk decomposition and line-number anchors (1217 validateMergeOutput, 1232≈1229 recoverDroppedTableRows, 1332 adjustClassifierConfidence, 1365 insertSingleResult) remain valid post-merge. |
| Main sync (S1) — DEVELOPMENT_GUIDELINES §3 / §8.13 references | (no change required) | Architecture.md and DEVELOPMENT_GUIDELINES.md modified in main but the §3 leaf-import rule and §8.13 discriminated-union rule are unchanged in their substance. No plan edit. |

**Lock status:** plan locked for build. Ready for `superpowers:subagent-driven-development` execution on Sonnet (per CLAUDE.md plan-gate protocol — switch model before proceeding to Chunk 1).

---

## Phase exit criteria

Phase 2 exits when:

1. All four chunks land on `claude/improve-skill-analyzer-RiFpB`.
2. Each chunk's acceptance criteria are met (lint, typecheck, build:server/client, targeted unit tests for Chunk 2, manual smoke for Chunks 3 + 4).
3. Operator confirms the operator-supplied SCOPE_EXPANSION reproducer fixture exhibits the expected banner + telemetry on a real run.
4. `spec-conformance` returns CONFORMANT or CONFORMANT_AFTER_FIXES.
5. `pr-reviewer` returns APPROVED or APPROVED_WITH_MINOR.
6. `reality-checker` returns APPROVED with evidence (banner screenshots, llm_requests audit query result showing zero `skill-analyzer-consolidate` calls on a DUPLICATE/DISTINCT-only job, one `skill_analyzer_results` row with `consolidation_outcome='succeeded'` and a `CONSOLIDATION_APPLIED` warning whose detail parses to expected `{ preWords, postWords, reductionPct }`).
7. `dual-reviewer` returns APPROVED — or `REVIEW_GAP` is recorded with `reviewer: dual-reviewer | task-class: Significant | reason: codex unavailable | operator-override: no | remediation: <one-line>` in `tasks/builds/skill-merge-consolidation-pass/progress.md`.
8. `chatgpt-pr-review` is NOT run by feature-coordinator — it is enforced in Phase 3 by finalisation-coordinator.

Done = phase exit. Hand off to Phase 3.







