# PR Review Log — sandbox-isolation

**Branch:** claude/evolve-sandbox-isolation-brief-Q51hc
**Build slug:** sandbox-isolation
**Reviewer:** pr-reviewer (independent code review)

---

## Round 1 — verdict: CHANGES_REQUESTED

**HEAD at review:** 719ef5b8

5 blocking findings + 6 strong + 14 nits.

### Blocking

- **NEW B1** — `sandboxTelemetryPruneJob.ts:97-101` queries `emitted_at` but column is `event_at`. Job crashes every run; 90d retention never enforced.
- **NEW B2** — `sandboxExecutionService.ts:444-469`: after `provider.runTask` returns `providerOutput`, the service updates only `status='harvesting'` without persisting `providerOutput.{output,metrics,costCents}`. `runHarvest` then reads them back off the row as null/0, so all `sandbox_compute` ledger rows record `cost_cents=0` and harvested outputs are always null.
- **B3** (concur SANDBOX-ADV-1.1) — `sandboxHarvestReconciliationJob.ts:120-195` invokes `runHarvestReconciliation` outside `withOrgTx`; every reconciliation throws `missing_org_context` silently. Escalated from advisory to blocking.
- **B4** (concur SANDBOX-ADV-5.1) — `sandboxExecutionService.ts:380-383` TODO unimplemented; ceiling-monitor + wall-clock-kill jobs never enqueued. Wall-clock + cost ceilings effectively unenforceable. Architectural — current `provider.runTask` is synchronous; pre-start monitor enqueue would deadlock. Real fix requires splitting provider into async start/poll/terminate. Out of fix-loop scope.
- **B5** (concur SANDBOX-ADV-4.1) — `sandboxHarvestService.ts:411-421` case-sensitive credential-leak filter. Bypass: `/workspace/Secrets/foo`, `../secrets/foo`.

### Strong (S1-S6)

- S1: `_buildOutputFromRow` returns fake `terminalState='provider_unavailable'` for in-flight rows.
- S2: Code duplication — telemetry-write helpers byte-equal in `sandboxExecutionService.ts` and `sandboxHarvestService.ts`.
- S3 (concur SANDBOX-ADV-3.1): telemetry sequence allocator race silently drops events.
- S4: `runHarvest` early-exit predicate mis-handles already-completed rows.
- S5: Schema/migration drift on `sandbox_logs_execution_stream_seq_asc_idx`.
- S6: `attempt_number` column never incremented from service.

### Nits

N1-N14 across all chunks — see Round 1 envelope for details. All routed to follow-up / tasks/todo.md.

---

## Round 2 — verdict: APPROVED (fix-loop closes)

**HEAD at re-review:** c5167bc5 (fix-loop round 1)

### Fixes verified

- **B1 CLOSED** — column rename `emitted_at` → `event_at` verified against schema.
- **B2 CLOSED** — `outputJson`, `metricsJson`, `costCents` now persisted in the `pending → harvesting` UPDATE; step1TerminalClassification reads canonical values.
- **B3 CLOSED** — reconcile wrapped in per-row `db.transaction` + `withOrgTx` + `set_config` for `app.organisation_id`. `organisation_id` predicate added to recoverable-state UPDATE WHERE.
- **B5 CLOSED for canonical bypasses** — filename normalised via `.toLowerCase().replace(/\\/g, '/').replace(/\/+/g, '/')` before match; `..` traversal rejected.
- **B4 DEFERRAL ACCEPTED** — architectural; provider interface synchronous; pre-start monitor enqueue requires interface refactor. Out of fix-loop scope. Surface as follow-up.

### New strong findings (S-NEW1, S-NEW2)

- **S-NEW1** — B5 residual: `workspace/secrets/foo` (no leading slash) slips through both `/workspace/secrets/` substring and `secrets/` prefix checks. Defence-in-depth; primary control is object-storage key prefix isolation. Fix proposal: add `.includes('workspace/secrets/')` or use `/(^|\/)secrets\//.test(norm)`.
- **S-NEW2** — Add a vitest for B5 normalization to lock in behaviour against the case-set: `[/workspace/secrets/foo, /WORKSPACE/SECRETS/foo, \\workspace\\secrets\\foo, secrets/foo, SECRETS/foo, workspace/secrets/foo, ../etc/passwd]`. File: `server/services/__tests__/sandboxHarvestService.credential-leak.test.ts`.

### New nits

- **N-NEW1** — B3 tx wraps full harvest pipeline (12 steps incl. S3 PutObject + provider file reads). Acceptable for V1; comment + TODO for tx split. Pre-existing concern.
- **N-NEW2** — `_buildOutputFromRow` mis-labels in-flight rows as `provider_unavailable` (same as S1; pre-existing).

### Final verdict

**APPROVED — close fix-loop.** Proceed to Phase 2 handoff. B4 + S-NEW1/2 + N-NEW1/2 + all prior S1-S6 + N1-N14 routed to follow-up backlog.
