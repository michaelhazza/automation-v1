# Spec Review HITL Checkpoint — Iteration 3

**Spec:** `tasks/llm-observability-ledger-generalisation-spec.md`
**Spec commit:** `2b5668c` (at start of iteration 3; edits below landed on top but not yet committed)
**Spec-context commit:** `00a67e9`
**Iteration:** 3 of 5
**Timestamp:** 2026-04-20T06:32:07Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 4 until the finding below is resolved. Resolve by editing the `Decision:` line, then re-invoking the spec-reviewer agent.

---

## Summary

| # | Finding | Question | Recommendation | Why |
|---|---------|----------|----------------|-----|
| 3.1 | `caller_cancel` required by §10.5 but not wired in §10.1 | Narrow §10.5 verification to timeouts only, or add cancel-path wiring to §10.1? | **Narrow verification to timeouts only** for this spec; list the user-cancel wiring in §17 Deferred | Wiring a new UI/job-cancel path into the analyzer is out-of-scope scope creep; timeouts are the load-bearing abort reason for ledger debuggability today |

Iter-3 also applied 8 mechanical fixes in parallel with this checkpoint. Detail in `tasks/spec-review-log-llm-observability-3-20260420T063207Z.md`:
- **#1** P2 gate state reconciled (both analyzer files explicitly whitelisted, gate passes green on P2).
- **#2** §11.3 endpoint table clarified to name the `data` payload type; response envelope is uniformly `{data, meta}` per §19.9.
- **#3** §19.5a `DailyTrendRow.profitCents` removed from contract + example; net profit is derived client-side.
- **#4** §19.6 `CallDetail` extended with `organisationId` and `subaccountId` plus link-target nullability rules.
- **#5** §19.5 split into `19.5.1 SubacctRow`, `19.5.2 SourceTypeRow`, `19.5.3 ProviderModelRow` with explicit field shapes.
- **#7** REJECTED — duplicate of iter-2 C2.6 (prototype illustrative, not numerical truth).
- **#8** Prototype KPI card Gross Profit margin 25.6% → 20.6% (aligns with §19.3 contract).
- **#9** §14.2 stale `TASK_TYPES` change language removed — line now says "no `TASK_TYPES` change."
- **#10** §12.4 extracted named pure helper `computeArchiveCutoff(retentionMonths, now)` into `llmLedgerArchiveJobPure.ts`; §14.5 and §14.8a updated.

---

## Finding 3.1 — `caller_cancel` abort-reason required but not wired in analyzer migration

**Classification:** ambiguous (scope signal — the two candidate fixes are "narrow acceptance" = scope reduction vs "add wiring" = scope addition; both are directional)
**Signal matched:** Scope signals — "defer this until later" / "bring this forward to an earlier phase" when applied to acceptance-criteria items
**Source:** Codex iteration 3 (finding #6, severity important)
**Spec section:** §8.1 (line 778), §10.1 (lines 983-1021), §10.5 (line 1053), §16.3 (lines 1713-1718)

### Finding (verbatim)

> 6. `caller_cancel Is Required but Not Wired`
> Affected: `§8.1`, `§10.1`, `§10.5`, `§16.3` (spec lines 778-780, 983-1021, 1053-1054, 1713-1718)
> The spec requires the existing UI cancel path to produce `abort_reason='caller_cancel'`, but the migration snippet only shows timeout-driven `abort('caller_timeout')`. No section names the mechanism that propagates job cancellation into that `AbortController`.
> Suggested fix: add the exact cancel-path hook, file, and function that calls `abort('caller_cancel')`, or narrow the acceptance criteria to timeout aborts only.
> Severity: important

### Recommendation

**Narrow verification to timeouts-only for this spec; move user-cancel wiring to §17 Deferred.**

Concrete edits:

- **§8.1** (line 778): change "The analyzer migration in §10 wires this exactly" to "The analyzer migration in §10 wires the `caller_timeout` path exactly — it does not add a new UI-cancel hook. User-cancel (`caller_cancel`) remains a forward-looking abort-reason value in the CHECK constraint; wiring a UI/job-level cancel path into the analyzer's `AbortController` is deferred (§17)."
- **§10.5 verification #4** (line 1053): change to "Let a classify timeout via its existing `SKILL_CLASSIFY_TIMEOUT_MS` path and verify the resulting ledger row carries `status = 'aborted_by_caller'` and `abort_reason = 'caller_timeout'`." Drop the "existing UI cancel job path" clause.
- **§16.3** (lines 1713-1718): same change — remove the `caller_cancel` check, keep the `caller_timeout` check.
- **§17 Deferred items**: add a new entry: "**User-initiated cancel wiring for analyzer LLM calls (`caller_cancel`).** §8.1's abort-reason mechanism supports both `caller_timeout` and `caller_cancel`, but this spec only wires the timeout path in §10.1. Threading a UI/job-level cancel into the analyzer's `AbortController` requires a new cancel-propagation hook that does not exist today. Reason for deferral: the analyzer pg-boss job has no UI-cancel surface today; adding one is its own scope and out of this spec's generalisation work. The schema-level `abort_reason` value stays listed in the CHECK constraint so no future migration is needed when the wiring lands."

### Why

The spec's load-bearing observability claim is that every LLM call ends with a recordable status and reason. For this spec's deliverables — analyzer migration as the proof-of-concept — the relevant abort reason is **timeout**, which is already wired via the `SKILL_CLASSIFY_TIMEOUT_MS` handler migrated in §10.1. The `caller_cancel` reason is forward-looking — no analyzer UI-cancel path exists today, and adding one would introduce a new concern (job cancellation propagation through pg-boss → analyzer worker → `AbortController`) that is not part of the ledger-generalisation scope.

The alternative — adding the wiring now — widens P3 meaningfully. It introduces a new abstraction (cancellable long-running jobs) that the codebase does not yet have a primitive for. That belongs in a separate spec about cancellable background work, not the ledger generalisation. Preserving the schema value (`abort_reason = 'caller_cancel'` stays in the CHECK) means the wiring can land later without a migration.

Alternative "add the wiring now" — rejected per scope-containment rationale above.
Alternative "remove `caller_cancel` from the CHECK entirely" — rejected because the value is already referenced in §5 prose and §19 contracts, and removing it would require a larger spec rewrite that hides the abort-reason taxonomy from implementers who might wire the cancel path later.

### Classification reasoning

Two candidate fixes are directional: "narrow acceptance" is a scope-reduction call (**Scope signals: "Defer this until later"**), and "add wiring" is a scope-addition call (**Architecture signals: "Introduce a new abstraction"** — cancellable long-running jobs). Either resolution is the product-owner's decision, not a mechanical cleanup. Bias-to-HITL per the agent contract.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline. If `reject`, add a one-sentence reason. If `stop-loop`, the review loop exits immediately.

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing the `Decision:` line above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint, honour the decision, and continue to iteration 4.

If you want to stop the loop entirely without resolving the finding, set the decision to `stop-loop` and the loop exits immediately after honouring the already-applied mechanical fixes.
