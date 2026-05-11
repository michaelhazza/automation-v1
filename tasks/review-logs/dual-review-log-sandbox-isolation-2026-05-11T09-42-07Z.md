# Dual Review Log — sandbox-isolation

**Files reviewed:** entire sandbox-isolation primitive (server/services/sandbox*, server/jobs/sandbox*, server/db/schema/sandbox*, server/lib/withSandboxProvider*, migrations 0321-0324, shared/types/sandbox.ts, ieeDevBackend.ts) — 60+ files
**Iterations run:** 3/3
**Timestamp:** 2026-05-11T09:42:07Z
**Branch:** claude/evolve-sandbox-isolation-brief-Q51hc
**Pre-fix HEAD:** c5167bc5
**Commit at finish:** `37451d8a` (auto-push to remote failed: local OpenSSL CA store issue — `unable to get local issuer certificate`. Same symptom recorded in `spec-conformance-log-sandbox-isolation-2026-05-11T08-35-46Z.md` for commit `1656248c`. Commit is local; operator must push manually or fix the local CA bundle.)

---

## Iteration 1

Codex independent review surfaced 4 P1 findings.

### [ACCEPT] server/services/sandbox/sandboxProviderResolver.ts:95-100 — Bootstrap import gap
**Issue:** `e2bSandbox.ts` and `localDockerSandbox.ts` invoke `registerSandboxProvider(...)` at module-init time, but neither module is statically imported anywhere by production code (only by their own files and unit tests). `resolveSandboxProvider()` therefore finds an empty registry for `e2b`/`local_docker` and throws `sandbox provider X not registered` at first call. This bricks every production sandbox execution.
**Verification:** grep `e2bSandbox|localDockerSandbox` in server/ — only references are the modules themselves, their tests, and one in-comment mention from `sandboxExecutionService.ts`. The plan (C4 §391) explicitly designed this as a "bootstrap import" responsibility but no chunk wired it.
**Fix:** Added side-effect imports `./sandbox/e2bSandbox.js` and `./sandbox/localDockerSandbox.js` at the top of `sandboxExecutionService.ts` (the sole consumer of `resolveSandboxProvider`). Imports fire at module-init, registry populated before `getProvider()` runs.

### [REJECT] server/services/sandboxExecutionService.ts:482-484 — `_buildOutputFromRow` coerces non-terminal to `provider_unavailable`
**Issue:** When `_handleExistingRow` returns for Case 2 (in-flight `running`/`harvesting`) or Case 5 (`pending`+lease-active), `_buildOutputFromRow` coerces `terminalState` to `provider_unavailable`. Caller is told the sandbox failed when it's actually in-flight.
**Reason for reject:** Fix requires an architectural decision — change `SandboxRunTaskOutput` contract, throw a non-terminal sentinel error, or block-and-poll. None is mechanical. This is in the same family as the deferred B4 (ceiling-monitor enqueue) because the provider is currently synchronous; concurrent duplicate calls for the same `sandboxExecutionId` are an edge case that does not fire in V1. Logged to `tasks/todo.md` follow-up rather than fixed in-loop.

### [ACCEPT] server/services/sandboxHarvestService.ts:212-230 — Step 2 always throws `provider_file_read_not_implemented`
**Issue:** Step 2 unconditionally throws then catches → `output_validation_failed`. Every successful sandbox call fails harvest. However, `_attemptProviderStart` persists `providerOutput.output` onto `sandbox_executions.output_json` BEFORE invoking `runHarvest`, and step 1 reads that value as `step1.outputJson`. Step 2 ignores it.
**Fix:** Pass `step1.outputJson` into `step2OutputRead` as `storedOutputJson`. When populated, short-circuit through validation. The provider SDK file-read stub stays in place for the reconciliation fallback where the row may not carry pre-stored output.

### [ACCEPT] server/services/sandboxHarvestService.ts:166-173 — Reconciliation casts pending/running as `SandboxTerminalState`
**Issue:** `step1TerminalClassification` uses `if (row.status !== 'harvesting') return alreadyTerminal as SandboxTerminalState`. For stuck `pending`/`running` rows that the reconciliation sweep specifically targets, this cast is unsound — they are not terminal states. Downstream writes either CHECK-constraint-fail or surface a synthetic non-terminal value as if it were terminal.
**Fix:** Extended `reconcileExecution` in `sandboxHarvestReconciliationJob.ts` to flip stuck `pending`/`running` rows to `harvesting` BEFORE invoking the harvest service — symmetric with the existing `harvest_failed`/`artefact_upload_failed` flip. Step 1 then sees the expected `harvesting` status and enters the recovery path correctly.

---

## Iteration 2

Codex iteration 2 reviewed the iter1 fixes and surfaced 2 additional findings.

### [ACCEPT] server/jobs/sandboxHarvestReconciliationJob.ts:88-91 — Reconciliation sweep blind because `started_at` is never set
**Issue:** The sweep query filters on `started_at IS NOT NULL AND started_at < cutoff`. But `sandbox_executions.started_at` is never written by any code path — neither at INSERT, nor at the `pending → harvesting` transition, nor anywhere else. Every sandbox row therefore has `started_at = NULL` and is permanently invisible to reconciliation. The iter1 fix #4 only helps rows that already cleared the sweep's filter — but none ever do.
**Verification:** `grep -rn "startedAt\|started_at" server/services/sandbox*` and `server/jobs/sandbox*` — zero writes. Spec §20.3 lists `started_at` as a column but doesn't pin a specific write site.
**Fix:** Set `startedAt: now` on the Case 1 INSERT in `sandboxExecutionService.runTask`. Every row that ever held a lease now carries a `started_at` value the reconciliation sweep can see.

### [ACCEPT] server/services/sandboxHarvestService.ts step2OutputRead — Stored `null` rejected on canonical path
**Issue:** The iter1 fix #3 check `storedOutputJson !== null && storedOutputJson !== undefined` rejects legitimately-null stored output. While the type contract says null is a non-completed sentinel, the fast-path on the canonical run should trust the value the execution service just wrote (including null) because it's authoritative.
**Fix:** Differentiate canonical (`ctx.reconciliationAttempt === 0`) from reconciliation. In canonical mode, the execution service has just written `outputJson` — trust it as-is. In reconciliation mode, the original worker may have died before persisting output — require non-null to short-circuit; otherwise fall through to the SDK stub.

---

## Iteration 3

Codex iteration 3 reviewed the iter2 fixes and surfaced 1 additional P1 finding.

### [ACCEPT] server/services/sandboxExecutionService.ts:341-347 — Case 4 reclaim doesn't refresh `startedAt`
**Issue:** When Case 4 reclaims a stale `pending` row (the original worker died), the UPDATE sets `startClaimedAt`, `startClaimExpiresAt`, and `startAttemptCount` but leaves `startedAt` pinned to the original lease-claim timestamp. The reconciliation sweep computes its deadline from `startedAt`, so a freshly-reclaimed execution would be marked orphaned again on the next sweep tick (the original `startedAt` is already past the wall-clock+buffer cutoff that triggered the reclaim in the first place).
**Fix:** Add `startedAt: now` to the Case 4 reclaim UPDATE so the sweep timer restarts from the reclaim attempt.

Codex iter3 final report: "I did not find additional sandbox-isolation issues beyond this in the final pass."

---

## Changes Made

- `server/services/sandboxExecutionService.ts` — (a) side-effect bootstrap imports for `e2bSandbox` and `localDockerSandbox`; (b) `startedAt: now` on Case 1 lease-claim INSERT; (c) `startedAt: now` on Case 4 stale-lease reclaim UPDATE.
- `server/services/sandboxHarvestService.ts` — `step2OutputRead` signature now accepts `storedOutputJson`; canonical-mode short-circuit trusts the value (including null); reconciliation-mode short-circuit requires non-null; provider SDK stub remains as fallback for reconciliation with no stored output.
- `server/jobs/sandboxHarvestReconciliationJob.ts` — `reconcileExecution` now also flips stuck `pending`/`running` rows to `harvesting` before invoking the harvest service, symmetric with the existing `harvest_failed`/`artefact_upload_failed` flip.

Verification:
- `npm run lint`: 0 errors, 906 pre-existing warnings (unchanged).
- `npm run typecheck`: only the 2 pre-existing `@react-pdf/renderer` errors (confirmed pre-existing on main; not introduced by this build).
- Sandbox pure tests: 260/260 passed across 10 files (`sandboxExecutionServicePure`, `sandboxHarvestServicePure`, `sandboxHarvestReconciliationPure`, `sandboxCeilingMonitorPure`, `sandboxRetentionPure`, `withSandboxProviderPure`, `sandboxProviderResolverPure`, `e2bSandboxPure`, `localDockerSandboxPure`, `templateVersionParserPure`).

## Rejected Recommendations

- **Iter1 finding #2 (`_buildOutputFromRow` coerces non-terminal to `provider_unavailable`).** Rejected because the fix requires an architectural decision about how to signal "in-flight, please retry" (return-type change, throw, or block-and-poll). Same family as the explicitly-deferred B4 (ceiling-monitor pre-start enqueue) — the provider's `runTask` is currently synchronous, so concurrent duplicate calls for the same `sandboxExecutionId` are an edge case that does not fire in V1. Surface area for the follow-up build that splits provider into async start/poll/terminate.

---

**Verdict:** APPROVED (3 iterations, 6 findings adjudicated: 5 ACCEPTED + 1 REJECTED with architectural rationale; all accepted fixes implemented, lint + typecheck clean, 260 sandbox pure tests pass).
