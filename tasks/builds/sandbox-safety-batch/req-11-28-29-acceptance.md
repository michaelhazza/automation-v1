# REQ #11 / #28 / #29 — acceptance verification

**Date:** 2026-05-15
**Build:** sandbox-safety-batch
**Status:** accepted (no code change required)

These three REQ items were already CONFORMANT per spec-conformance Round 2 (log: `tasks/review-logs/spec-conformance-log-sandbox-isolation-2026-05-11T08-35-46Z.md`). This batch only records that acceptance; no new code is needed.

## REQ #11 — `runTask` invokes `runHarvest` after successful provider start

Round-2 verdict (§2 REQ #11):

> **Round 2 verdict:** **PASS**
>
> The end-to-end happy path is now functional.

Key evidence from the log:
- Import wired at `server/services/sandboxExecutionService.ts:28`: `import { runHarvest } from './sandboxHarvestService.js';`
- Atomic `pending → harvesting` transition at lines 438-452 using `assertValidTransition` and a `WHERE status='pending'` guarded UPDATE.
- Harvest invocation at lines 457-469 passing the full context object matching the `runHarvest` signature at `sandboxHarvestService.ts:857-871`.

Fix landed in commit `7d12f77f`.

## REQ #28 — `sandbox_start_failed` telemetry event

Round-2 verdict (§2 REQ #28):

> **Round 2 verdict:** **PASS**
>
> Both pre-start failure sites covered (spec §13.1 names exactly two `pending → provider_unavailable` paths).
> **Gate impact** — `scripts/gates/verify-sandbox-minimum-events.sh:73-84` (Pass 1) greps `sandboxExecutionService.ts` for `sandbox_start_failed` excluding `import type` lines. Both occurrences in the file (lines 306, 412) are inside function bodies, not import lines. **Pass 1 will now succeed.**

Two emission sites:
- Path A `_attemptProviderStart` catch block — `server/services/sandboxExecutionService.ts:411-415` — writes `sandbox_start_failed` with `criticality='error'` and payload `{ reason: 'provider_unavailable', providerErrorCode: <FailureReason> }`.
- Path B `_handleExistingRow` MAX_START_ATTEMPTS cap — `server/services/sandboxExecutionService.ts:305-309` — writes `sandbox_start_failed` with `criticality='error'` and payload `{ reason: 'provider_unavailable', providerErrorCode: 'start_attempt_count_cap_3' }`.

Both write `criticality='error'` with payloads matching spec §13.1. Fix landed in commit `7d12f77f`.

## REQ #29 — `sandbox_start` telemetry event

Round-2 verdict (§2 REQ #29):

> **Round 2 verdict:** **PASS**
>
> **Gate impact** — `scripts/gates/verify-sandbox-minimum-events.sh:96-104` (Passes 2/3) greps `sandboxExecutionService.ts`, `sandboxHarvestService.ts`, and `withSandboxProvider.ts` for `'sandbox_start'` excluding `import type` lines. The occurrence at line 428 is inside a function body. **Passes 2 and 3 will now succeed.**

Single emission site at `server/services/sandboxExecutionService.ts:428-432`. Fires with `criticality='info'` and payload `{ ceilings, network_policy, alias_count }` on every post-start path (after `provider.runTask` returns successfully and before the `pending → harvesting` transition). Fix landed in commit `7d12f77f`.
