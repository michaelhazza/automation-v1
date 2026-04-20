# Spec review log — iteration 3

**Spec:** `tasks/llm-observability-ledger-generalisation-spec.md`
**Spec commit at start of iteration:** `2b5668c`
**Spec-context commit:** `00a67e9`
**Iteration:** 3 of 5
**Timestamp:** 2026-04-20T06:32:07Z

---

## Iteration-2 HITL decisions applied before iter-3 started

- **C2.4 (Top calls by cost):** already applied in §11.2 docstring, §11.3 endpoint row, §11.5, §11.6, §19.6 (with second nullable-revenue example). Prototype header "Top individual calls by cost" (line 990). Prototype row ordering is cost-descending (rows sorted $0.1824 → $0.0081). No additional prototype or spec edits required for C2.4.
- **C2.7 (Mockup UI controls):** already applied in §11.4.1 + §17 Deferred entry for footer-link real destinations. Prototype footer links were still `<a href="#">` — edited to decorative `<span>` per §11.4.1.

## Codex iter-3 findings (10 total)

| # | Finding | Classification | Disposition |
|---|---------|----------------|-------------|
| 1 | P2 gate state contradiction (gate "currently fails" vs whitelist covers analyzer) | Mechanical | Apply |
| 2 | HTTP response envelope drift (§11.3 bare payloads vs §19.9 `{data, meta}`) | Mechanical | Apply |
| 3 | DailyTrendRow example has `profitCents` but §19.5a says "NOT sent separately" | Mechanical | Apply |
| 4 | `CallDetail` lacks `organisationId` / `subaccountId` for promised drawer links | Mechanical | Apply |
| 5 | `SubacctRow` / `SourceTypeRow` / `ProviderModelRow` lack real contracts | Mechanical | Apply |
| 6 | `caller_cancel` required by §10.5 verification but not wired in §10.1 | Ambiguous | HITL |
| 7 | Authoritative mockup totals don't reconcile across tabs | Mechanical | Reject (dup of iter-2 C2.6) |
| 8 | Gross-profit margin badge 25.6% vs contract 20.6% | Mechanical | Apply |
| 9 | File inventory still claims a `TASK_TYPES` change (§5.2 retired that) | Mechanical | Apply |
| 10 | `ledgerArchivePure.test.ts` names a pure target that doesn't exist | Mechanical | Apply |

---

## Mechanical applications (8)

### [ACCEPT] Finding #1 — P2 gate state contradiction (§15.2, §9.2)
- §15.2 Verification currently says "gate runs and currently fails (analyzer still bypasses router); whitelist temporarily includes `skillAnalyzerJob.ts` until P3." Those two claims can't both be true — if the whitelist includes all analyzer hits, the gate passes.
- Also: whitelist text only names `skillAnalyzerJob.ts` but `skillAnalyzerService.ts:2063` is also a known direct-adapter hit (known since iter-1).
- **Fix applied:** reword §15.2 Verification paragraph to say the gate passes green on P2 with both `skillAnalyzerJob.ts` and `skillAnalyzerService.ts` in the whitelist; those two files leave the whitelist in P3 per §15.3.

### [ACCEPT] Finding #2 — HTTP response envelope (§11.3, §19.9)
- §11.3 endpoint table says responses are bare `PnlSummary`, `TopCallRow[]`, etc. §19.9 says every response is wrapped in `{data, meta}`. Two contracts for the same routes.
- **Fix applied:** reworded §11.3 header to clarify that the "Returns" column shows the `data` payload type; every endpoint's response body is `{data: <payload>, meta}` per §19.9. Single authoritative contract.

### [ACCEPT] Finding #3 — `DailyTrendRow.profitCents` contradiction (§19.5a)
- Example shows `profitCents: 17693`. Prose says `profitCents` is "derived client-side and NOT sent separately."
- **Fix applied:** removed `profitCents` from the `DailyTrendRow` example and the contract prose now consistently says the client derives it on render as `revenueCents - costCents`. Top-calls-page summary math reference removed — the top-calls list has its own `profitCents` per-row in `TopCallRow` (§19.6), which is the correct cite.

### [ACCEPT] Finding #4 — `CallDetail` missing link IDs (§11.6, §19.6)
- §11.6 drawer promises links to run, job, organisation, and subaccount. `CallDetail` only extends `TopCallRow` which has names but not IDs. Drawer cannot construct link URLs without IDs.
- **Fix applied:** extended `CallDetail` example in §19.6 with `organisationId`, `subaccountId` (nullable for overhead rows where `organisationName` is already null). `runId` and `sourceId` already present. Nullability notes added.

### [ACCEPT] Finding #5 — `SubacctRow` / `SourceTypeRow` / `ProviderModelRow` under-specified (§19.5)
- Prose "same shape family as OrgRow" leaves per-tab fields implicit: subaccount needs `subaccountId` + `organisationName`; source-type needs `orgsCount` + `pctOfCost`; provider-model needs `provider` + `model` + `avgLatencyMs` + `pctOfCost`.
- **Fix applied:** split §19.5 into three explicit sub-contracts (§19.5.1 `SubacctRow`, §19.5.2 `SourceTypeRow`, §19.5.3 `ProviderModelRow`) with fields, example, nullability. Kept existing `SourceTypeRow` `system` / `analyzer` examples.

### [REJECT] Finding #7 — Prototype totals don't reconcile
- Iter-2 C2.6 explicitly resolved this: "a prototype is illustrative, not numerical truth. If the user wants a full reconciliation pass, that is a separate mockup-update task."
- Codex is re-raising the same class of finding. The disposition stands.

### [ACCEPT] Finding #8 — Gross-profit margin badge (prototype line 186)
- Prototype KPI card shows "25.6% MARGIN" for `$5,614.13 / $27,206.90 = 20.6%`. §19.3 contract gives `margin: 20.6`.
- This differs from finding #7 because it's a single-cell mistake inside the headline KPI card, and it contradicts an explicit numeric contract (§19.3) — not a broader demo-dataset drift. Single-character fix.
- **Fix applied:** prototype line 186 changed from `25.6% MARGIN` to `20.6% MARGIN`.

### [ACCEPT] Finding #9 — `TASK_TYPES` change in §14.2 (stale retired language)
- §5.2 explicitly rejects extending `TASK_TYPES`. §14.2 line 1427 still says the schema file will "extend ... `TASK_TYPES` (via featureTag doc comment only — taxonomy stays on existing enum)."
- **Fix applied:** §14.2 `llmRequests.ts` change cell rewritten to say "Add 4 columns; extend `SOURCE_TYPES` and `LLM_REQUEST_STATUSES`; no `TASK_TYPES` change (§5.2 deliberately keeps the enum closed — feature identity lives on new `featureTag` column)."

### [ACCEPT] Finding #10 — `ledgerArchivePure.test.ts` needs a named pure target (§12.4, §14.8a)
- Test file in §14.8a tests "Cutoff date calculation from `LLM_LEDGER_RETENTION_MONTHS`," but §12.4 has the cutoff math inlined in `archiveOldLedgerRows()` — not pure.
- **Fix applied:** §12.4 extracted a named pure helper `computeArchiveCutoff(retentionMonths: number, now: Date): Date` into `server/jobs/llmLedgerArchiveJobPure.ts`. §14.8a test file target updated to reference the new pure module. §14 file inventory updated with the new pure file.

---

## HITL referred (1)

- **Finding #6 (`caller_cancel` required but not wired):** Ambiguous. Fix is either (a) narrow §10.5 verification #4 + §8.1's "analyzer migration wires this exactly" claim to timeout-only (**scope reduction**, directional) or (b) add a new cancel-path mechanism to §10.1 that wires UI cancel → pg-boss cancel → `AbortController.abort('caller_cancel')` (**scope addition**, directional). Either decision is the product-owner's, not mechanical. Written to the iter-3 checkpoint.

---

## Bonus mechanical follow-up

- **§11.4.1 cross-reference drift** — when the prototype footer links were switched from `<a>` to `<span>` (iter-2 C2.7 apply), a new comment line was inserted, which shifted the footer-link lines from `1143-1145` to `1144-1146`. §11.4.1's "Mockup location" column referenced the old line numbers. Updated in the same iteration.

---

## Iteration 3 Summary

- Mechanical findings accepted:  8 (plus 1 small cross-ref touch-up above)
- Mechanical findings rejected:  1 (finding #7 — duplicate of iter-2 C2.6)
- Directional findings:          0
- Ambiguous findings:            1 (finding #6)
- Reclassified → directional:    0
- HITL checkpoint path:          `tasks/spec-review-checkpoint-llm-observability-3-20260420T063207Z.md`
- HITL status:                   pending
- Spec commit after iteration:   (pending HITL resolution)
