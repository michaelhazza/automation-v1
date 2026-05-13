**Status:** draft
**Spec date:** 2026-05-13
**Last updated:** 2026-05-14
**Author:** main session (Opus)
**Build slug:** skill-merge-consolidation-pass

---

# Skill merge — conditional consolidation pass

## Table of contents

1. Problem
2. Approach
3. Existing primitives reused
4. Contracts
5. Execution model
6. Config surface
7. UI surface (MergeReviewBlock)
8. File inventory
9. Phase / chunk plan
10. Execution-safety contracts
11. Testing posture
12. Deferred items
13. Non-goals
14. Open questions

Appendix — How this addresses the user's hypothesis

---

## 1. Problem

When the skill analyzer classifies an incoming skill as `PARTIAL_OVERLAP` or `IMPROVEMENT`, the classifier+merge LLM call produces a single merged version of the two skills. The merge prompt at `server/services/skillAnalyzerServicePure.ts:886–1076` includes a soft scope-discipline constraint ("merged instructions must not substantially exceed the length of the richer source skill; >30% longer = trim"), but enforcement is **prompt-side only**.

After the merge, `validateMergeOutput()` (`skillAnalyzerServicePure.ts:1866`) measures the actual length and emits two warning codes:

- `SCOPE_EXPANSION` (>40% over richer source, default; per `skill_analyzer_config.scope_expansion_standard_threshold`)
- `SCOPE_EXPANSION_CRITICAL` (>75% over richer source, default; per `scope_expansion_critical_threshold`)

These warnings **flag bloat but do not fix it**. The reviewer must trim manually in the Recommended column of `MergeReviewBlock.tsx`, or accept the bloat. There is no LLM consolidation step that takes the merged output and tightens it without losing capability.

Result: in observed test runs a non-trivial fraction of merges land in the `SCOPE_EXPANSION` band and ship as bloated outputs because the reviewer accepts the AI's first draft.

## 2. Approach

Add a **conditional consolidation pass**: a second LLM call that fires only when the post-merge validator detects scope expansion. The pass takes the merged skill and rewrites it for concision under hard preservation constraints (no content loss, all tool/skill refs preserved, all HITL gates preserved, invocation block preserved). The result replaces the bloated first-pass merge before the row is persisted.

Three design choices, pinned:

1. **Conditional, not unconditional.** Only fires when validator emits `SCOPE_EXPANSION` or `SCOPE_EXPANSION_CRITICAL`. Happy-path merges (output already within budget) pay no extra LLM cost. Trigger band is configurable.
2. **Separate LLM call, not a stronger single-call prompt.** Asking one prompt to simultaneously "preserve every unique fact" and "be terse" is a known LLM weak spot — the existing soft 30% cap in the merge prompt demonstrates it. Splitting into two passes lets each prompt have a single dominant objective: pass 1 = correctness, pass 2 = concision.
3. **One attempt, no escalation.** Consolidation `fails` only on timeout, parse failure, LLM error, or a newly-introduced hard-constraint violation (`HITL_LOST`, `INVOCATION_LOST`, `REQUIRED_FIELD_DEMOTED`, or `CAPABILITY_OVERLAP`) — in those cases revert to the original merge. A parsed output that is shorter than the pre-consolidation draft but still over the target ceiling is `succeeded`, not `failed`; the row keeps the smaller draft and retains its scope-expansion warning. Emit an informational warning either way. Never block the row.

The reviewer continues to see the existing three-column diff view (Current / Incoming / Recommended), but the Recommended column shows the **consolidated** output. A new informational banner exposes the consolidation outcome with the size delta so the reviewer can audit what changed; the pre-consolidation draft remains stored for debug.

## 3. Existing primitives reused

| Capability needed | Existing primitive | How used |
|---|---|---|
| LLM call from analyzer pipeline | `routeCall()` (`server/services/llmRouter.js`), already called in `skillAnalyzerJob.ts:891, 1807, 1974` | Third call site with `featureTag: 'skill-analyzer-consolidate'` for ledger separation |
| Prompt assembly | Pattern in `buildClassifyPromptWithMerge()` (`skillAnalyzerServicePure.ts:1082`) | New sibling function `buildConsolidationPrompt()` in the same module |
| Response parsing | Pattern in `parseClassificationResponseWithMerge()` | New sibling `parseConsolidationResponse()` returning a `ProposedMerge` shape |
| Post-LLM validation | `validateMergeOutput()` (`skillAnalyzerServicePure.ts:1866`) | Re-invoked on the consolidated output |
| Per-result LLM concurrency | `p-limit` with concurrency 3 in `skillAnalyzerJob.ts:790` | Consolidation runs inline inside the same limiter slot — no new concurrency primitive |
| Config snapshot for thresholds | `job.configSnapshot` → `ValidationThresholds` (`skillAnalyzerJob.ts:99–104`) | Extended with two new fields (see §6) |
| Warning tier map for new warning codes | `warningTierMap` jsonb on `skill_analyzer_config` (`skillAnalyzerConfig.ts:67`) | Three new codes added to default map (`CONSOLIDATION_APPLIED`, `CONSOLIDATION_DECLINED`, `CONSOLIDATION_FAILED`) |
| Reviewer audit trail | `originalProposedMerge` jsonb column on `skill_analyzer_results` | Repurposed: stores **post-consolidation** merge so Reset still hands the reviewer the best AI draft. Pre-consolidation draft moves to new column. |

No new tables, no new services, no new routes. One new migration (column adds + config defaults).

## 4. Contracts

### 4.1 Consolidation prompt input

The consolidation prompt receives:

- **MERGED SKILL (DRAFT):** the first-pass merge output (`name`, `description`, `definition`, `instructions`, `mergeRationale`).
- **RICHER SOURCE WORD COUNT:** the larger of base and non-base source instruction word counts — used as the target ceiling.
- **MERGED WORD COUNT:** current word count of the draft.
- **TARGET CEILING:** the richer source word count × (1 + `scopeExpansionStandardThreshold`). The pass aims to land at or below this ceiling.
- **PRESERVATION INVENTORY:** machine-extracted lists from the draft, tiered for safety.
  - **Tier 1 (hard, verbatim-required):** every backtick-wrapped tool/skill reference, every HITL gate phrase match, the invocation trigger block. Loss of any Tier 1 item in the consolidated output triggers `CONSOLIDATION_FAILED` and reverts to the pre-consolidation draft.
  - **Tier 2 (best-effort):** known tool/action names from the skill `definition` and `instructions` where they match registered tool/action identifiers in the system (e.g. unbackticked references like `Gmail search_emails`, `create_event`, `send_email`), plus HITL/approval/confirmation gate phrases that match a deterministic phrase set (`requires human approval`, `confirm before`, `do not send without`, etc.). Tier 2 matches are informational — loss is recorded in `consolidationNote` but does NOT by itself trigger `CONSOLIDATION_FAILED`; revert occurs only when `validateMergeOutput()` or a deterministic checker can prove capability loss (e.g. `HITL_LOST`, `INVOCATION_LOST`).
  - The prompt instructs the LLM that Tier 1 items must appear verbatim in the consolidated output, and Tier 2 items should be preserved unless the LLM can replace them with an equivalent reference.

### 4.2 Consolidation prompt instructions (key constraints)

- **Hard preservation list (mirrored from merge prompt):** every backticked tool/skill reference must survive; every HITL gate sentence must survive verbatim; the invocation trigger block must remain first; every named section must remain present (sections may shrink but not disappear); `input_schema.required` fields cannot be demoted; enum values cannot drop.
- **Reduction targets:** restate concepts only once, remove filler ("Note that…", "It's worth pointing out that…"), collapse multi-sentence explanations into one sentence where the meaning is preserved, deduplicate examples (keep the strongest), remove redundant headers.
- **Output ceiling:** "produce output ≤ TARGET CEILING words. If you cannot land at or below the ceiling without losing capability, return the draft unchanged and explain why in `consolidationNote`."
- **Self-check before responding:** every item in PRESERVATION INVENTORY appears in the output; every source section header appears; `input_schema` unchanged structurally; output is shorter than the draft (or equal, with a justification).

### 4.3 Consolidation response shape

```
{
  consolidatedMerge: ProposedMerge,           // same shape as classifier's proposedMerge
  consolidationNote: string,                  // 2–4 sentences: what was trimmed; what was kept
  declinedToConsolidate: boolean,             // true when LLM judged trimming would lose capability
  declineReason: string | null                // present when declinedToConsolidate=true
}
```

`ProposedMerge` shape: `{ name, description, definition, instructions, mergeRationale }` per `skillAnalyzerServicePure.ts:378–390`. Consolidation **must not change** `name`, `description`, `definition`, `mergeRationale` — only `instructions`.

Parser rejection rules — a response failing any of the following is rejected at parse time. Parser rejection is treated as `consolidationOutcome='failed'` (NOT `declined`): orchestration keeps the pre-consolidation draft, appends `CONSOLIDATION_FAILED` to the warning set, and records `failureReason='parse_rejected: <rule>'` in the warning detail. `declinedToConsolidate=true` is reserved for valid parsed responses where the model explicitly declines (see §5 step 5).

- The response mutates any of `name`, `description`, `definition`, or `mergeRationale`.
- `instructions` is not a string.
- `instructions` is empty or whitespace-only.
- `consolidationNote` is missing, not a string, or empty/whitespace-only.
- `declinedToConsolidate` is not a boolean.
- `declinedToConsolidate=true` but `declineReason` is null, empty, or whitespace-only.

### 4.4 New `MergeWarning` codes

| Code | Severity | Tier | When emitted |
|---|---|---|---|
| `CONSOLIDATION_APPLIED` | warning | informational | Consolidation ran and produced a smaller output. Detail records `{ preWords, postWords, reductionPct }`. |
| `CONSOLIDATION_DECLINED` | warning | informational | Consolidation ran but LLM returned `declinedToConsolidate=true`. Detail records `declineReason`. |
| `CONSOLIDATION_FAILED` | warning | informational | Consolidation call timed out, parse-failed, or post-consolidation validator detected a hard-constraint violation (HITL/tool-ref/invocation lost) and the system reverted to the pre-consolidation draft. Detail records `failureReason` (e.g. `parse_rejected: <rule>`, `timeout`, `hard_constraint_violation: <code>`). |

All three are informational tier — they never block approval and never participate in the critical-warning confirmation gate.

**Size-delta telemetry source.** The UI banner (§7) derives `preWords`, `postWords`, and `reductionPct` from the `CONSOLIDATION_APPLIED` warning detail, NOT from dedicated result columns. This avoids schema bloat: `mergeWarnings` already exists and the warning-detail object is the canonical source for consolidation telemetry. The `failureReason` field in `CONSOLIDATION_FAILED` detail and the `declineReason` field in `CONSOLIDATION_DECLINED` detail follow the same convention.

### 4.5 Source-of-truth precedence (post-consolidation row)

When consolidation runs, the result row's fields hold:

- `proposedMergedContent` — final merge the reviewer sees and edits (post-consolidation if it succeeded; pre-consolidation if it failed). **Source of truth at approval/execute time.**
- `originalProposedMerge` — what Reset rolls back to. Set to the post-consolidation merge when consolidation succeeded (so Reset gives the reviewer the best AI draft); set to pre-consolidation when consolidation failed.
- `preConsolidationMerge` (NEW) — the LLM's first-pass merge, captured before consolidation ran. Audit only; never used by Reset or Execute. Null when consolidation didn't run.
- `consolidationOutcome` (NEW, text enum) — one of `not_triggered | succeeded | declined | failed`. Drives the UI banner.
- `mergeWarnings` — final warning set after consolidation re-validation (existing column).

Precedence at Execute: `executionResolvedName` > `proposedMergedContent.name` (unchanged).

## 5. Execution model

**Inline / synchronous**, inside the per-result `p-limit(3)` slot in Stage 5 of `processSkillAnalyzerJob` (`skillAnalyzerJob.ts:796`). The consolidation call runs after `validateMergeOutput()` and before `insertSingleResult()`. No pg-boss job row, no new queue, no new stage.

Sequencing inside one result slot:

1. Existing merge LLM call (`routeCall` at line 891).
2. Existing post-LLM remediation (decontamination, invocation prepend, table recovery, output format recovery).
3. Existing `validateMergeOutput()` call (line 1217).
4. **NEW: consolidation gate.** If config has `consolidationEnabled=true` AND warnings include `SCOPE_EXPANSION` or `SCOPE_EXPANSION_CRITICAL` (subject to `consolidationTriggerSeverity` filter), capture pre-consolidation merge then run `routeCall` with consolidation prompt.
5. **NEW: consolidation parse + apply.** On a parser-valid response with `declinedToConsolidate=false`, replace `storedMerge` with `consolidatedMerge`. On a parser-valid response with `declinedToConsolidate=true`, orchestration ignores `consolidatedMerge` regardless of whether the response also carries a mutated payload, keeps the pre-consolidation draft, writes `consolidationOutcome='declined'`, and appends `CONSOLIDATION_DECLINED` (detail: `declineReason`). On parse rejection (per §4.3 rules), orchestration keeps the pre-consolidation draft, writes `consolidationOutcome='failed'`, and appends `CONSOLIDATION_FAILED` (detail: `failureReason='parse_rejected: <rule>'`).
6. **NEW: re-validate.** Re-run `validateMergeOutput()` on the final merge. If consolidation succeeded but introduced a hard-constraint violation (`HITL_LOST`, `INVOCATION_LOST`, `REQUIRED_FIELD_DEMOTED`, or `CAPABILITY_OVERLAP` newly emitted by consolidation), revert to pre-consolidation merge and emit `CONSOLIDATION_FAILED` with the violating code. **Warning-set replacement rule:** the final stored `mergeWarnings` MUST correspond to the final stored `proposedMergedContent`. When consolidation is reverted, discard the post-consolidation validation warnings, recompute (or restore) warnings against the pre-consolidation draft, then append `CONSOLIDATION_FAILED`. The reviewer never sees warnings for a draft they are not reviewing.
7. Existing confidence adjustment.
8. `insertSingleResult()` with the new fields.

**Outcome classification rule (`succeeded` vs `failed`).** The parsed consolidation output is `succeeded` when it is shorter than the pre-consolidation draft AND passes hard-preservation validation — even if `validateMergeOutput()` still emits `SCOPE_EXPANSION` or `SCOPE_EXPANSION_CRITICAL` because the output is below the pre-consolidation word count but still above the target ceiling. In that case the final warning set retains the applicable scope-expansion warning and appends `CONSOLIDATION_APPLIED`. The outcome is `failed` (and reverts to the pre-consolidation draft) only on parse failure, LLM timeout/error, or a newly-introduced hard-constraint violation. "Still bloated" is NOT a failure when the rest of the row is intact — the reviewer is genuinely seeing a smaller draft and the UI banner copy must reflect that.

This stays within the existing limiter slot so concurrency is unchanged (max 3 in-flight LLM calls across merge + consolidation combined). A consolidation call counts as one slot just like its merge.

Idempotency: job-time idempotency is provided by the existing per-slug skip in `skillAnalyzerJob.ts` — slugs that already have rows in `skill_analyzer_results` are not re-classified, so consolidation is never re-attempted on retry. `consolidationOutcome` is an audit field, NOT the idempotency guard. For rows written after migration `0346`, orchestration MUST always write one of `not_triggered | succeeded | declined | failed` (never NULL) — even when the consolidation gate does not fire, the orchestration writes `not_triggered`. Legacy rows (written before this migration) may be NULL; the UI treats NULL as display-equivalent to `not_triggered`, but legacy NULL rows MUST NOT be interpreted as eligible for re-consolidation.

## 6. Config surface

Two new columns on `skill_analyzer_config`:

| Column | Type | Default | Effect |
|---|---|---|---|
| `consolidation_enabled` | boolean | `true` | Master switch. When `false`, the consolidation gate is skipped entirely; behaviour matches today. |
| `consolidation_trigger_severity` | text | `'warning'` | One of `'warning'` (fire on SCOPE_EXPANSION or SCOPE_EXPANSION_CRITICAL) or `'critical'` (fire only on SCOPE_EXPANSION_CRITICAL). |

Both propagate through `job.configSnapshot` per the `v2 §11.11.4` invariant (`skillAnalyzerJob.ts:96`).

**`consolidation_trigger_severity` invariant.** Trigger severity is evaluated against the raw validator warning codes (`SCOPE_EXPANSION` / `SCOPE_EXPANSION_CRITICAL`), NOT against the operator-tunable `warningTierMap`. `'warning'` means trigger consolidation on either scope code; `'critical'` means trigger only on `SCOPE_EXPANSION_CRITICAL`. Changing `warningTierMap` MUST NOT change which warnings fire consolidation — this prevents an unexpected LLM-spend change when an operator re-tunes UI warning tiers. The two configs are independent: `warningTierMap` controls UI banner tiering and reviewer resolution flow; `consolidation_trigger_severity` controls LLM spend.

`warningTierMap` defaults are extended with the three new codes mapped to `informational`. Operators may override via the existing PATCH /config endpoint.

The three new warning codes are added to `DEFAULT_WARNING_TIER_MAP` (`skillAnalyzerServicePure.ts:431`), the `MergeWarningCode` union (`skillAnalyzerServicePure.ts:392`), and the `RESOLUTIONS_FOR_CODE` map (`skillAnalyzerServicePure.ts:547`) — all three are informational and need no reviewer resolution actions.

## 7. UI surface (MergeReviewBlock)

One additive change in `client/src/components/skill-analyzer/MergeReviewBlock.tsx`:

- New collapsible banner above the three-column diff, visible only when `result.consolidationOutcome` is one of `succeeded | declined | failed`.
- `succeeded`: green banner, copy "AI tightened this merge from {preWords} to {postWords} words ({reductionPct}% shorter) without losing capability." Below the size-delta line the banner shows the LLM's `consolidationNote` (2–4 sentences summarising what was trimmed and what was kept) so the reviewer can audit the change at a glance. Includes a "View pre-consolidation draft" disclosure that reveals the raw `preConsolidationMerge` instructions in a read-only collapsible.
- `declined`: amber banner, copy "AI reviewed this merge for tightening and judged it cannot be shortened without losing capability." Shows `declineReason`.
- `failed`: amber banner, copy "Tightening pass did not complete; reviewer is seeing the original merge." Shows failure reason.

No change to the editable Recommended column, no change to the existing diff highlighting, no change to Reset button behaviour (Reset still rolls back to `originalProposedMerge`, which is the best AI draft).

No new client-side state, no new API call. The new fields ride on the existing `GET /jobs/:jobId` response.

## 8. File inventory

| File | Change |
|---|---|
| `server/services/skillAnalyzerServicePure.ts` | Add `buildConsolidationPrompt(merged, sources, thresholds)` and `parseConsolidationResponse(raw)`. Extend `MergeWarningCode` union with three new codes. Extend `DEFAULT_WARNING_TIER_MAP` and `RESOLUTIONS_FOR_CODE`. |
| `server/jobs/skillAnalyzerJob.ts` | Insert consolidation gate between the existing `validateMergeOutput` call (line 1217) and the existing confidence adjustment (line 1332). Captures `preConsolidationMerge` and `consolidationOutcome` and passes them to `insertSingleResult`. |
| `server/services/skillAnalyzerService.ts` | Extend `insertSingleResult` signature + insert payload with `preConsolidationMerge`, `consolidationOutcome`, `consolidationNote`. Extend `getJob` projection to surface the three new fields in the result rows. No change to PATCH /merge or PATCH /action — consolidation is a read-only audit field after the job finishes. |
| `server/services/skillAnalyzerConfigService.ts` | Read + persist the two new config columns. Update `effectiveTierMap` baseline if needed. |
| `server/db/schema/skillAnalyzerConfig.ts` | Add `consolidationEnabled`, `consolidationTriggerSeverity` columns. Extend default `warningTierMap` with three new codes mapped to `informational`. |
| `server/db/schema/skillAnalyzerResults.ts` | Add `preConsolidationMerge` (jsonb, nullable), `consolidationOutcome` (text, nullable, enum `not_triggered | succeeded | declined | failed`), `consolidationNote` (text, nullable). |
| `server/db/migrations/0346_skill_merge_consolidation.sql` + `.down.sql` | Add the columns above. Add config column defaults. No backfill of existing rows (legacy results stay `null` and read as "consolidation did not run"). |
| `client/src/components/skill-analyzer/types.ts` | Add `preConsolidationMerge`, `consolidationOutcome`, `consolidationNote` to `AnalysisResult` type. |
| `client/src/components/skill-analyzer/MergeReviewBlock.tsx` | Add consolidation banner per §7. |
| `client/src/components/skill-analyzer/mergeTypes.ts` | Add the three new warning codes to the local `MergeWarningCode` union and tier map. |
| `server/services/__tests__/skillAnalyzerServicePure.consolidation.test.ts` (NEW, Vitest) | Pure-function tests for `buildConsolidationPrompt` and `parseConsolidationResponse`: prompt contains preservation inventory; parse rejects mutated non-instructions fields; parse handles `declinedToConsolidate=true`; integration of new warning codes into tier map. |

Total: 6 modified server files, 1 migration pair, 1 modified client component, 2 modified client type files, 1 new test file. No new routes, no new services, no new tables.

## 9. Phase / chunk plan

Single phase, four chunks. All chunks land on the same branch.

**Chunk 1 — Schema + config.**
Migration `0346` adds the three result columns and two config columns. Drizzle schema files updated. `skillAnalyzerConfigService` read path returns the new fields. `effectiveTierMap` includes the three new codes. No runtime behaviour change yet (job still skips consolidation because the gate is not wired).

**Chunk 2 — Pure functions + prompt.**
`buildConsolidationPrompt`, `parseConsolidationResponse`, preservation-inventory extraction helper, new warning codes added to all three maps in `skillAnalyzerServicePure.ts`. Pure tests authored. Still no orchestration wired.

**Chunk 3 — Orchestration.**
Wire the consolidation gate into `skillAnalyzerJob.ts` between existing validate and confidence-adjust steps. Extend `insertSingleResult` signature and call path. Extend `getJob` projection. End-to-end: a fresh job that trips SCOPE_EXPANSION runs consolidation and persists outcome fields.

**Chunk 4 — UI banner.**
`MergeReviewBlock.tsx` reads the new fields and renders the consolidation banner. Type extensions in `types.ts` / `mergeTypes.ts`. No new API call, no new state plumbing.

Dependency graph: Chunk 1 strictly before Chunks 2 and 3; Chunk 2 strictly before Chunk 3 (orchestration imports the pure functions); Chunk 4 depends on Chunk 1 (schema fields) but is independent of Chunks 2 and 3 at the type level.

## 10. Execution-safety contracts

- **Idempotency posture: row-presence-based.** Re-running consolidation on a result row is guarded by the existing per-slug skip in `skillAnalyzerJob.ts` (slugs already in `skill_analyzer_results` are not re-classified). `consolidationOutcome` is an audit field, NOT a state machine that gates retries. Post-migration rows always carry one of the four enum values; legacy NULL rows are never eligible for re-consolidation.
- **Retry classification: safe.** The consolidation LLM call has no side effect outside the in-memory `storedMerge`. If it throws, the orchestration catches, marks `consolidationOutcome='failed'`, and continues. No DB row exists yet at consolidation time.
- **Concurrency guard: none required.** Consolidation runs inside the per-result `p-limit(3)` slot before any DB write. Two workers cannot race because pg-boss assigns one worker per job.
- **Terminal event guarantee: unchanged.** The existing job's terminal state (`status='completed' | 'failed'`) and per-result `insertSingleResult` write remain the single terminal write per slug. Consolidation only modifies the payload of that write.
- **No-silent-partial-success.** If consolidation fails after the merge succeeded, the result still ships (with `consolidationOutcome='failed'` and a `CONSOLIDATION_FAILED` warning) — the merge alone is a valid outcome. There is no `partial` state because consolidation is not a deliverable, only a post-process polish.
- **HTTP status mapping: n/a.** No new unique constraints. PATCH endpoints unchanged.
- **State machine closure.** `consolidationOutcome` is a closed enum: `not_triggered | succeeded | declined | failed`. Adding values requires a spec amendment. Migration `0346` writes `NULL` for legacy rows only; orchestration for post-migration rows MUST write one of the four enum values, never NULL. The UI treats legacy `NULL` identically to `not_triggered`, but builders MUST NOT treat NULL as "consolidation not yet decided".
- **No-consolidation guarantee for non-merging classifications.** `DUPLICATE` and `DISTINCT` classifications produce no merge, so the consolidation gate MUST NOT fire and MUST NOT call `routeCall` with `featureTag: 'skill-analyzer-consolidate'`. These rows write `consolidationOutcome='not_triggered'` (per the §5 idempotency contract — never NULL for post-migration rows). Acceptance: a job containing only DUPLICATE/DISTINCT results spends zero consolidation LLM tokens.

## 11. Testing posture

Per `references/test-gate-policy.md` and `docs/spec-context.md`:

- **Pure-function tests (Vitest, allowed).** New file `skillAnalyzerServicePure.consolidation.test.ts`. Coverage targets:
  - prompt builder includes the tiered preservation inventory (Tier 1 verbatim list + Tier 2 best-effort list);
  - parser rejects mutated non-instructions fields, non-string/empty `instructions`, missing/empty `consolidationNote`, non-boolean `declinedToConsolidate`, and `declinedToConsolidate=true` with empty `declineReason`;
  - parser-rejected response routes to `consolidationOutcome='failed'` with `CONSOLIDATION_FAILED` and `failureReason='parse_rejected: <rule>'` (distinct from a valid `declined` response);
  - parser handles valid `declinedToConsolidate=true` and orchestration ignores any payload that carries with it (route to `consolidationOutcome='declined'`);
  - integration of the three new warning codes into the tier map and `RESOLUTIONS_FOR_CODE` map.
- **Static gates.** Lint + typecheck + build:server + build:client. All chunks must pass G1.
- **No new frontend tests, no new API contract tests, no E2E** (matches framing in `docs/spec-context.md`).
- **Manual smoke (operator).** After Chunk 4, run the analyzer against a known-bloating fixture (one ~2,000-word marketing skill matched against a ~600-word library skill — the canonical SCOPE_EXPANSION reproducer in prior test runs) and confirm: (a) consolidation banner renders, (b) Recommended column shows the tightened output, (c) Reset rolls back to the consolidated draft, (d) approval + execute still write the consolidated content to the system_skills row.

## 12. Deferred items

- **Consolidation for the rule-based fallback path.** When ANTHROPIC_API_KEY is unavailable or classification fails, the analyzer falls back to `buildRuleBasedMerge` (`skillAnalyzerJob.ts:691`) which produces a deterministic merge without an LLM. Consolidation requires an LLM call, so this branch never runs consolidation — `consolidationOutcome` stays `not_triggered`. Adding deterministic consolidation for the rule-based path is a separate body of work. Reason: the rule-based merge is already conservative and rarely trips SCOPE_EXPANSION.
- **Multi-pass consolidation.** Single attempt only. If the first pass over-trimmed and tripped a hard-constraint violation, we revert to the pre-consolidation draft rather than re-asking the LLM with adjusted instructions. Reason: keeps cost bounded and avoids amplifying LLM error modes.
- **Operator-triggered consolidation from the UI.** Currently consolidation runs only at job time. A future "Re-tighten this merge" button on the review page would let the operator re-run consolidation after manual edits. Reason: scope creep for this build; the in-pipeline pass solves the observed problem.
- **Section-by-section change tracking.** The consolidation banner shows the total word delta but not a section-by-section breakdown. The pre-consolidation draft is stored, so the diff is reconstructable, but no UI affordance ships in this build.
- **Consolidating new skill imports (DISTINCT).** Out of scope. DISTINCT classification produces no merge, so there is nothing to consolidate.
- **A/B comparison of consolidated vs. non-consolidated approval rates.** Telemetry to validate that consolidation reduces reviewer edit volume is not part of this build. The `consolidationOutcome` column makes the analysis tractable later.

## 13. Non-goals

- Not changing the merge prompt itself. The existing soft 30% cap stays. We are not trying to make the merge prompt better; we are adding a polish step after it.
- Not introducing a new model. Same `claude-sonnet-4-6` as the merge call, same routing context, same token ceiling (8192), same temperature (0.1). The consolidation prompt is shorter than the merge prompt, so the call is materially cheaper.
- Not changing reviewer workflow. The three-column diff, the editable Recommended column, the Reset button, the warning resolution UI, the approval gate — all unchanged. Consolidation is invisible to a reviewer who chooses not to look at the new banner.
- Not changing the warning resolution flow. Three new informational warnings; none require reviewer resolution; none enter the critical-warning confirmation phrase gate.
- Not changing classification (DUPLICATE / IMPROVEMENT / PARTIAL_OVERLAP / DISTINCT). Consolidation runs after classification is fixed.

## 14. Open questions

None blocking. Two minor calls the implementer may make:

1. Whether `CONSOLIDATION_FAILED` should be `informational` or `standard` tier. Spec proposes `informational` to match the "polish failure is acceptable" framing. If observed failure rate in dogfooding is high, operator can raise to `standard` via PATCH /config without a code change.
2. Whether the consolidation banner should show the pre-consolidation diff inline or only behind a disclosure. Spec proposes disclosure (collapsed by default) to keep the review page uncluttered. Trivial to flip.

---

## Appendix — How this addresses the user's hypothesis

The user's hypothesis: "Merging aggregates two skills into a superset, may bloat tokens, and the system does not run a simplification pass."

Verified state today:

- The merge prompt **does** instruct the LLM to keep the output within +30% of the richer source — so it isn't a naive union. But enforcement is soft; the LLM regularly overshoots when also instructed to preserve every unique fact.
- `validateMergeOutput()` **does** detect bloat post-hoc (SCOPE_EXPANSION / SCOPE_EXPANSION_CRITICAL warnings) but emits warnings only, not fixes.
- There is **no** second LLM consolidation pass. Trim is left to the reviewer.

This spec adds the missing pass, conditionally, gated by the warnings the validator already produces. Cost stays close to today's because the second call only fires on the subset of merges that actually need it.
