# Iteration 3 — execution-backend-adapter-contract

**Date:** 2026-05-10
**Spec commit at start:** 9d5a90d26d569967f6cb0165f4891c324e402b63
**Codex output:** tasks/review-logs/_codex_spec_review_execution-backend-adapter-contract_iter3_2026-05-10T02-39-26Z.txt

## Findings classification

### Codex findings
| # | Section | Severity | Class | Disposition |
|---|---|---|---|---|
| 1 | §4.3, §13.4 | important | mechanical | accept — IEE discriminator names wrong column/values (was `iee_runs.task_type` `'browser_use'`/`'dev_runner'`; actual schema is `iee_runs.type` `'browser'`/`'dev'`) |
| 2 | §4.5, §9.2, §13.4 | important | mechanical | accept — shared-storage adapters' reconcile() not scoped per adapter; both IEE adapters would double-process the same `iee_runs` slice |

### Rubric findings (my own pass)

None new this iteration — F1 was a verifiable factual error against the schema; F2 was a sequencing/ownership gap that emerged from the iter2 simplification.

## Mechanical changes applied

**§4.3 / §13.4 / §17 risk #4 — IEE discriminator column + value fix (F1):**
Replace-all: `iee_runs.task_type` → `iee_runs.type`; `'browser_use' → 'iee_browser'` → `'browser' → 'iee_browser'`; `'dev_runner' → 'iee_dev'` → `'dev' → 'iee_dev'`. Verified against `server/db/schema/ieeRuns.ts:42` (`type: text('type').notNull().$type<'browser' | 'dev'>()`).

**§4.5 worked example (F2):**
IEE browser adapter's `reconcile()` body comment now states the per-type filter (`iee_runs.type = 'browser'` / `'dev'`); explicit cross-reference to § 9.2.

**§9.2 NEW — Shared-storage adapters and reconciliation scoping (F2):**
Added subsection: when two adapters share a `terminalStateTable`, each `reconcile()` MUST filter by its own slice; double-processing prevented. The discriminator is the same one the event handler uses to derive `backendId`. Asserted by `registryPure.test.ts` against an in-memory mock with two adapters sharing one `terminalStateTable`.

**§13.4 — back-reference (F2):**
Added cross-link to § 9.2 reconciliation scoping rule.

**§15 — registryPure.test.ts assertions (F2):**
Extended the test description to include the disjoint-reconcile-count assertion for shared-storage mocks.

## Rejected / reclassified findings

None.

## Iteration 3 Summary

- Mechanical findings accepted:  2 (Codex: 2, Rubric: 0)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0

The spec now correctly names the IEE discriminator column (`type`) and values (`'browser'`, `'dev'`) — implementation risk reduced, and the shared-storage reconciliation gap is closed with both a contract rule and a test assertion.
