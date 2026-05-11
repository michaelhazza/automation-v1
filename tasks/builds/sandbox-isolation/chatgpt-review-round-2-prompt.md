# ChatGPT Spec Review — Round 2 Prompt (paste into the SAME chatgpt.com conversation as Round 1)

Continue the existing conversation. Copy the block below and paste it as a follow-up message.

## Copy from here ⬇

=====

I have applied all 11 of your Round 1 findings (F1-F5 + R1-R6) as technical fixes. Below is the full updated spec. Please review whether:

1. Each Round 1 finding is fully resolved (no half-fixes, no consistency drift introduced by the fix).
2. Any new issues emerged as a result of the fixes (especially around the `sandbox_logs` table, the start-claim lease model, the cost fallback estimator, the two-job ceiling monitor model, the org-boundary RLS / service-layer subaccount filtering shift).
3. There is anything left to lock before Phase 2 build kickoff.

If APPROVED, say so plainly. If there are remaining issues, list them as F1/F2/... per the Round 1 format. Don't re-litigate decisions already locked.

## Updated spec

[PASTE THE FULL CONTENT OF `tasks/builds/sandbox-isolation/spec.md` HERE (now 1630 lines)]

## Summary of changes applied (your reference)

- **F1 — sandbox_logs table.** New `server/db/schema/sandboxLogs.ts` + migration + RLS + prune job. §8.4 step 9, §17, §19.1, §19.4, §20.8 (new contract), §21.1 all updated. `tasks/todo.md` SANDBOX-DEF-LOG-SCHEMA closed.
- **F2 — Cost ceiling fallback estimator.** §10.2 adds `estimateSandboxCostCents = elapsedMs/1000 × templateResourceClass.maxCostCentsPerSecond` (vendor-published worst-case rate, pinned in `CURRENT_VERSION`). Worker terminates on estimate ≥ ceiling. Final billing reconciles via cost-correction ledger rows. §28 #4 locked.
- **F3 — Start-claim lease model.** §8.1 + §13.1 + §20.3 + §24.1. Lease columns: `provider_sandbox_id`, `start_claimed_at`, `start_claim_expires_at`, `start_attempt_count`. `MAX_START_ATTEMPTS = 3` cap drives `pending → provider_unavailable`. Lease reclaim transition added.
- **F4 — RLS wording.** §14.4 + §20.3-§20.6 + §21 + §29. RLS = organisation boundary (matches existing app convention). Subaccount filtering = service-layer predicate. Two-layer enforcement makes the brief §2.12 invariant satisfied.
- **F5 — 6 columns in llm_requests.** §19.4 updated. `correction_sequence` listed as the 6th column. Partial unique on `(sandbox_execution_id, correction_sequence) WHERE source_type = 'sandbox_compute_correction'`.
- **R1 — Split sandbox_input_rejected.** §14.2 reformatted with Surface A (DB enum) + Surface B (pre-row failure trace). `sandbox_input_rejected` moved to Surface B (calling run's failure trace only).
- **R2 — Ceiling monitor shape.** §10.2 picks two-job pg-boss model. Monitor re-enqueues every `monitorIntervalMs` with `singletonKey = sandbox_execution_id`. One-shot `sandbox-wall-clock-kill` job belt-and-braces at `wallClockMs + buffer`.
- **R3 — outputSchemaRef in §8.1.** Added to required input descriptor field list.
- **R4 — Cost-correction ledger rows.** §24.4 renamed events → ledger rows. Clarified no telemetry event type for corrections.
- **R5 — State machine cleanup.** §13.1: removed `pending → sandbox_input_rejected_*` from transitions; preflight failure is pre-row, not a row state.
- **R6 — CURRENT_VERSION ownership.** §15.2 rewritten. Developer commits `CURRENT_VERSION` in PR/tag commit. CI verifies built digest equals declared digest. Attestation lands via separate PR workflow (no CI auto-repo-mutation).

## Response format

```
## Verdict
APPROVED | CHANGES_REQUESTED | NEEDS_DISCUSSION

## Resolution of Round 1 findings
F1: RESOLVED | PARTIAL | NEW_ISSUE
F2: ...
(through R6)

## New findings (if any)
### Fn. [title]
**Severity:** ...
**Category:** ...
**Section:** ...
**Issue:** ...
**Suggested resolution:** ...
**Why this matters:** ...

## Remaining build-readiness gaps (if any)
...

## Lock recommendation
LOCK | DO NOT LOCK
```

Reply with the response above only.

=====

## ⬆ Paste up to here

## Operator instructions

Same as Round 1: replace the `[PASTE THE FULL CONTENT OF ...]` placeholder with the actual spec content (1630 lines). Paste into the existing chatgpt.com conversation (continue the same thread, don't open a new one). Paste ChatGPT's response back to me.
