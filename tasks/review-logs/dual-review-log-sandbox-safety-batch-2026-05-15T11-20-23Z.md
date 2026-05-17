# Dual Review Log — sandbox-safety-batch

**Files reviewed:** branch `claude/sandbox-safety-batch` vs `main` (~55 files, 22 sandbox-isolation backlog items, 4 migrations 0360-0363, 1 new canonical service)
**Iterations run:** 3/3
**Timestamp:** 2026-05-15T11:20:23Z
**Commit at finish:** b3e65022e2e3819417af32dd1061fda328fce437

---

## Iteration 1

Codex output (3 findings):

[ACCEPT] server/jobs/sandboxCeilingMonitorJob.ts:295-301 — terminate is called BEFORE the row re-read that detects "provider won the race"; in the harvesting transition the order should be re-read → check race → terminate only if monitor won. Calling terminate first defeats the purpose of the provider-result-wins semantics from spec §8.3 SANDBOX-ADV-3.2.
  Reason: Real logic bug. Spec §8.3 codified provider-result-wins; the whole point of the re-read+decision is to back off when the provider has reached harvest. Terminating before that check kills an in-progress harvest. V1 path is currently dormant (status='running' never set per SANDBOX-B4) but the code is the correctness target. Fix is small.

[REJECT] server/jobs/sandboxWallClockKillJob.ts:116-121 — same race class (terminate before status re-read).
  Reason: Scope-expansion beyond chunk 13's spec, which covered only the ceiling monitor. Plan §496 explicitly accepts the "external action first, then state write" tradeoff for idempotent terminate + DB-as-source-of-truth. Wall-clock-kill is the BELT-AND-BRACES guard; firing past `wallClockMs+30s` means the provider is overdue and termination is acceptable behaviour. Adding race-detection here is a v2 hardening, not a V1 fix. V1 path also dormant (status='running' never set).

[ACCEPT] server/services/executionBackends/ieeDevBackend.ts:70-74 — `ALLOWED_TEMPLATE_VERSIONS = ['v1.0.0']` rejects the committed `infra/sandbox-templates/synthetos-sandbox/CURRENT_VERSION` value of `version=local-dev-v1.0.0`. Every sandbox-class `iee_dev` dispatch from the repo default would throw `sandbox_input_rejected`.
  Reason: Production-impacting regression. KNOWLEDGE.md [2026-05-11] explicitly establishes `local-dev-v1.0.0` as the deliberate pre-publish sentinel — the strict CI gate exempts `local-dev-*` versions to keep the pre-first-publish flow green. The allowlist must include `local-dev-v1.0.0` alongside `v1.0.0`.

Also fixed during this iteration: `server/jobs/__tests__/sandboxCeilingMonitorJobTerminatePure.test.ts` — the static-source-string assertions in this test file were brittle to CRLF/LF line endings (it searched `'db\n      .update(...)'` but Windows checkout produces CRLF). Per DEVELOPMENT_GUIDELINES.md §5 (Strip CRLF when parsing files on Windows), normalised the source string with `.replace(/\r/g, '')` on read. Pre-existing brittleness exposed by the edit; counted under the canonical "fix the brittleness, not just the coordinates" rule.

## Iteration 2

Codex output (4 findings):

[REJECT] server/services/sandboxExecutionService.ts:455-456 — monitors armed while row still `pending` with `provider_sandbox_id = NULL`; if provider.runTask runs past `wallClockMs`, the ceiling monitor takes the start-failed branch and marks the execution `provider_unavailable` rather than terminating it.
  Reason: SANDBOX-B4 known and documented limitation. Plan §450-453 explicitly states "provider.runTask blocks until terminal, so the monitor's first tick fires after the call resolves; the monitor's self-re-enqueue loop covers the in-flight window." Fix requires splitting `provider.runTask` into `start()` + `wait()` with intermediate persistence of provider_sandbox_id — a major architectural change deferred to v2.

[ACCEPT] server/db/schema/sandboxExecutions.ts:42 + server/services/sandboxExecutionService.ts (runTask INSERT) — `credentialAliases` column defaults to `[]` and `runTask` never sets it in the `NewSandboxExecution` row; reconciliation reads `row.credential_aliases` to rebuild redaction patterns and will miss them for every credentialed task.
  Reason: Real bug — spec §6.3 explicitly says "Update reconciliation to read from the column", but chunk 5's design only addressed the READ path. The WRITE path was missed: runTask's INSERT never populates the column, so the reconciliation read always returns `[]`. Spec intent (SANDBOX-ADV-6.1) was to fix the hardcoded empty array; the implementation merely moved the empty array from a constant to a DB column default — the bug persists. Fixed by adding `credentialAliases: input.credentialIssuanceContext.aliases` to the INSERT row. Also corrected the schema $type from `string[]` to `CredentialIssuanceAlias[]` so the type system reflects the actual stored shape.

[ACCEPT] server/services/sandboxMeteringQueryPure.ts:70 — `SUM(lr.sandbox_wall_clock_ms)::int` overflows int4 (~24.8 days of summed wall-clock ms in the query window). For metering queries that aggregate many executions, the cast fails.
  Reason: Real V1 correctness concern. Helper is currently zero-callers (chunk 4 pure helper not yet wired), so fixing now is cheaper than after callers exist. Changed `::int` → `::bigint`, widened `SandboxMeteringRow.wallClockMs` type to `number | string` to accept the pg driver's bigint-as-string serialisation, and added `Number()` coercion in `rollupSandboxMinutes` before arithmetic. Test contract preserved — the tests pass numeric literals which still type-check.

[ACCEPT] migrations/0362_sandbox_logs_line_check.sql:3 — adds CHECK constraint `char_length(line) <= 10000` immediately; the previous application cap was 65,536 bytes (MAX_LOG_LINE_BYTES), so any existing row with a line > 10,000 chars would block the migration.
  Reason: Real deploy-safety issue. Migration is still pre-merge (not yet deployed anywhere — placeholder name pattern per DEVELOPMENT_GUIDELINES.md §6.2 allows editing during PR development). Added a defensive `UPDATE sandbox_logs SET line = left(line, 10000) WHERE char_length(line) > 10000` before the ALTER TABLE so over-cap rows are pre-truncated. Pre-prod posture means no production data is affected; the change is a deploy-time safety belt for any environment with accumulated test data.

## Iteration 3

Codex output (1 finding — duplicate of iter 2 #1):

[REJECT] server/services/sandboxExecutionService.ts:461-474 — re-surface of the SANDBOX-B4 known-limitation finding (arm monitors after the row goes to `running`).
  Reason: Auto-reject per operator memory `feedback_chatgpt_review_duplicate_findings` — repeats of decided findings on later rounds are treated as auto-applied. Same rationale as iter 2 #1: documented known limitation deferred per plan §450-453; fix requires major architectural change to split `provider.runTask`.

Iteration 3 had zero accepts → loop terminated.

---

## Changes Made

- `server/jobs/sandboxCeilingMonitorJob.ts` — re-read row status BEFORE terminating in the harvesting branch; back out without terminate when provider won the race (spec §8.3 SANDBOX-ADV-3.2 correctness).
- `server/jobs/__tests__/sandboxCeilingMonitorJobTerminatePure.test.ts` — normalise CRLF in the test fixture's static-source-string read per DEVELOPMENT_GUIDELINES.md §5.
- `server/services/executionBackends/ieeDevBackend.ts` — add `local-dev-v1.0.0` to `ALLOWED_TEMPLATE_VERSIONS` so the pre-publish sentinel from `CURRENT_VERSION` is not rejected (KNOWLEDGE.md [2026-05-11]).
- `server/db/schema/sandboxExecutions.ts` — type `credentialAliases` column as `CredentialIssuanceAlias[]` (was `string[]`).
- `server/services/sandboxExecutionService.ts` — populate `credentialAliases` on the INSERT row in `runTask` so reconciliation can rebuild redaction patterns for credentialed tasks (spec §6.3 SANDBOX-ADV-6.1 write-path completion).
- `server/services/sandboxMeteringQueryPure.ts` — cast `SUM(sandbox_wall_clock_ms)::bigint`; widen `wallClockMs` type to `number | string`; coerce via `Number()` in `rollupSandboxMinutes`.
- `migrations/0362_sandbox_logs_line_check.sql` — backfill-truncate over-cap rows before adding the CHECK constraint.

## Rejected Recommendations

- **Iter 1 #2 — wall-clock kill race**: scope-expansion beyond chunk 13's spec; plan §496 explicitly accepts the design tradeoff (idempotent terminate + DB as source of truth); V1 path dormant.
- **Iter 2 #1 / Iter 3 #1 — arm monitors before row goes to `running`**: SANDBOX-B4 known limitation; deferred per plan §450-453 to a major v2 refactor of `provider.runTask` into start/wait phases.

---

**Verdict:** APPROVED (3 iterations, 5 fixes applied across 7 files)
