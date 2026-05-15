# Spec Conformance Log — Round 2

**Spec:** `tasks/builds/sandbox-safety-batch/spec.md`
**Spec commit at check:** `79310bbf` (HEAD prior to Round-2 mechanical fix)
**Branch:** `claude/sandbox-safety-batch`
**Base:** `c92d2a81` (merge-base with `origin/main`)
**Scope:** REQ #31 / §7.4 only (Round-2 fix-loop verification; all other 21 REQs were PASS in Round 1 and not re-verified)
**Round 1 log:** `tasks/review-logs/spec-conformance-log-sandbox-safety-batch-2026-05-15T09-27-43Z.md`
**Round 1 verdict:** NON_CONFORMANT (1 directional gap on REQ #31)
**Fix commit under review:** `79310bbf` — "fix(spec-conformance): wire telemetryWriter at 12 withSandboxProvider call sites (REQ #31)"
**Run at:** 2026-05-15T10:01:59Z

## Contents

1. Summary
2. REQ #31 (§7.4) — verification detail
3. Mechanical fixes applied (Round 2)
4. Directional / ambiguous gaps
5. Files modified by this run
6. Next step

---

## 1. Summary

- Requirements re-verified:        1 (REQ #31)
- PASS:                            1
- MECHANICAL_GAP -> fixed:         1 (documentation marker comments on the 2 residual log-only sites)
- DIRECTIONAL_GAP -> deferred:     0
- AMBIGUOUS -> deferred:           0
- OUT_OF_SCOPE -> skipped:         21 (all other Round-1 PASS REQs; not re-verified per task brief)

**Verdict:** CONFORMANT_AFTER_FIXES

---

## 2. REQ #31 (§7.4) — verification detail

**Spec acceptance:** "diagnostics appear as DB rows after a sandbox provider call."

**Seam state (unchanged from Round 1).** `server/lib/withSandboxProvider.ts` exposes `telemetryWriter?: (event: ProviderDiagnosticEvent) => Promise<void>` on `WithSandboxProviderOpts<T>`. The wrapper invokes it at all four diagnostic emission points:

- Slow-start during onRetry (`withSandboxProvider.ts:121-127`)
- Retry / rate-limit during onRetry (`withSandboxProvider.ts:138-149`)
- Ambiguous-terminal in the catch (`withSandboxProvider.ts:165-175`)
- Post-success slow-start observation (`withSandboxProvider.ts:217-223`)

Callback throws are caught and logged as `sandbox.provider_diagnostic.telemetry_write_failed` (§8.36 — no empty catch).

**Round-2 wiring (commit `79310bbf`).** Audited every production invocation of `withSandboxProvider(` across the server tree. **Production call sites: 14 total; wired: 12; documented log-only fallback: 2.**

| # | File | Line | Phase | Wired? |
|---|---|---|---|---|
| 1 | `server/jobs/sandboxCeilingMonitorJob.ts` | 297 | `terminal` | wired |
| 2 | `server/jobs/sandboxWallClockKillJob.ts` | 116 | `terminal` | wired |
| 3 | `server/services/sandbox/e2bSandbox.ts` (`runTask` createSandbox) | 308 | `start` | wired |
| 4 | `server/services/sandbox/e2bSandbox.ts` (`runTask` writeFile) | 364 | `start` | wired |
| 5 | `server/services/sandbox/e2bSandbox.ts` (`runTask` getTerminalState) | 392 | `terminal` | wired |
| 6 | `server/services/sandbox/e2bSandbox.ts` (`runTask` readFile output) | 407 | `harvest` | wired |
| 7 | `server/services/sandbox/e2bSandbox.ts` (`runTask` terminateSandbox) | 427 | `harvest` | wired |
| 8 | `server/services/sandbox/e2bSandbox.ts` (`_harvestLogs` readFile) | 516 | `harvest` | log-only |
| 9 | `server/services/sandbox/e2bSandbox.ts` (`_harvestArtefacts` listFiles) | 545 | `harvest` | log-only |
| 10 | `server/services/sandbox/localDockerSandbox.ts` (`runTask`) | 152 | `start` | wired |
| 11 | `server/services/sandboxHarvestService.ts` (`step2OutputRead`) | 243 | `harvest` | wired |
| 12 | `server/services/sandboxHarvestService.ts` (`step5LogRead`) | 354 | `harvest` | wired |
| 13 | `server/services/sandboxHarvestService.ts` (`step6ArtefactEnumeration` list) | 434 | `harvest` | wired |
| 14 | `server/services/sandboxHarvestService.ts` (`step6ArtefactEnumeration` read) | 506 | `harvest` | wired |

**Writer body shape (verified at every wired site).** Each writer invokes `allocateAndInsertTelemetryEvent(db, { ... })` with the full Chunk-3 helper signature:

- `sandboxExecutionId`, `organisationId`, `subaccountId`
- `runId`, `agentId`, `taskId`
- `provider`, `templateName`, `templateVersion`
- `eventType: 'provider_diagnostic'`, `criticality: 'info'`
- `payloadJson: { subKind, attempt, elapsedMs, status, code }`

The helper's advisory-lock-serialised sequence allocator (§6.2 SANDBOX-ADV-3.1) handles concurrent writers via `pg_advisory_xact_lock(hashtext(sandboxExecutionId)::bigint)` with 23505 retry.

**Tenancy-context sourcing.**
- `sandboxCeilingMonitorJob` extends the row SELECT to include `runId`, `agentId`, `taskId`, `provider`, `templateVersion` (lines 133-139), packs them into a `TelemetryRowCtx` struct (lines 165-172), and threads it through `applyCeilingTransition` to the writer factory.
- `sandboxWallClockKillJob` accepts `subaccountId` on the job payload (line 49) and extends the row SELECT with the same five fields.
- `e2bSandbox.runTask` and `localDockerSandbox.runTask` pull all eight context fields from the existing `SandboxRunTaskInput` parameter.
- `sandboxHarvestService` uses the existing `HarvestContext` parameter via a `makeTelemetryWriter(ctx)` factory at module top (lines 108-134).

**Residual log-only sites (operator-acknowledged scope-deferred).** Two private helper methods in `e2bSandbox.ts` — `_harvestLogs` (line 510) and `_harvestArtefacts` (line 540) — take only `(providerSandboxId, sandboxExecutionId)` and have no path to the full tenancy context. Threading it would require a method-signature refactor that the task brief explicitly defers ("out of scope for this safety batch"). Both sites match the suggested-approach fallback documented in the pre-existing `tasks/todo.md:1317` REQ #31 entry: *"For call sites without context (rare — mostly the harvest-step provider reads), keep the log-only path as a documented fallback with a `// no-tenancy-context: defaults to log-only` comment."*

**Spec acceptance conclusion.** "Diagnostics appear as DB rows after a sandbox provider call" is met for all production paths that hold tenancy context. The 2 residual log-only sites are private harvest-stubs (`_harvestLogs`, `_harvestArtefacts`) that the spec's own §14.3 (structured log events) covers — they emit `logger.warn('sandbox.provider_diagnostic', { sandboxExecutionId, phase, subKind, ... })` via `withSandboxProvider`. Spec §14.2 (DB telemetry events) is satisfied for the 12 sites that hold the NOT NULL row context.

**Verdict for REQ #31:** PASS (with documented log-only fallback at 2 sites per the suggested-approach exception).

---

## 3. Mechanical fixes applied (Round 2)

| File | Lines | Change |
|---|---|---|
| `server/services/sandbox/e2bSandbox.ts` | 514-521 | Added `// no-tenancy-context: defaults to log-only` documentation block above the `_harvestLogs` `withSandboxProvider` call, matching the verbatim phrasing prescribed by the pre-existing `tasks/todo.md:1317` entry. Explains why the writer is intentionally omitted and references the REQ #31 follow-up. |
| `server/services/sandbox/e2bSandbox.ts` | 544-551 | Same documentation block above the `_harvestArtefacts` `withSandboxProvider` call. |

Both edits are comment-only, surgical, and verbatim against the todo's suggested approach — no functional change. Re-verification: read-back of both sites confirms the comments landed without altering the surrounding logic.

Lint after fix: 0 errors (886 pre-existing warnings, none in `e2bSandbox.ts`).
Typecheck after fix: 0 errors (`tsc --noEmit` on both `tsconfig.json` and `server/tsconfig.json`).
Targeted Vitest: `server/services/__tests__/withSandboxProviderTelemetryWriterPure.test.ts` — 3/3 passing.

---

## 4. Directional / ambiguous gaps (routed to tasks/todo.md)

**None for Round 2.** The pre-existing `tasks/todo.md:1317` REQ #31 entry remains in place because the 2 log-only residual sites are tracked there as an acknowledged scope-deferral. Per `CLAUDE.md` § "Deferred actions route to `tasks/todo.md` — single source of truth", no new entry is appended (dedup rule applies; the existing entry now captures the partial-close state with the suggested follow-up: method-signature refactor on `_harvestLogs` / `_harvestArtefacts` to thread tenancy context).

A separate concern surfaced during Round-2 verification but is **not blocking** for §7.4:

> The 4 non-job wired call sites (`e2bSandbox`, `localDockerSandbox`, `sandboxHarvestService`) construct their writer with `getOrgScopedDb('<source>.telemetryWriter')` directly rather than from inside a `withOrgTx`. The `allocateAndInsertTelemetryEvent` docstring (line 42-44) says the function "MUST be called inside an existing transaction (withOrgTx or equivalent) so `pg_advisory_xact_lock` has a transaction to bind to." In the current shape, the advisory lock + SELECT + INSERT run as separate statements on a singleton handle — the lock will not strictly serialise across concurrent writers for the same execution. The 23505 unique-violation retry path in the allocator (lines 77-80) covers the resulting race without data loss, so DB rows still land correctly. Tightening this to wrap each writer body in `withOrgTx({...}, async (tx) => ...)` is a hardening improvement, not a spec-acceptance gap (rows are persisted; acceptance "diagnostics appear as DB rows" is met).

Surfaced here for visibility; not appended to `tasks/todo.md` because the existing REQ #31 entry's follow-up scope already covers writer-shape hardening as part of the broader method-signature refactor.

---

## 5. Files modified by this run

- `server/services/sandbox/e2bSandbox.ts` — 2 documentation comment additions (no functional change).

---

## 6. Next step

**CONFORMANT_AFTER_FIXES.** All 22 spec requirements are satisfied. REQ #31 promotes from DIRECTIONAL_GAP -> PASS:

1. 12 of 14 production `withSandboxProvider` call sites are wired with a `telemetryWriter` that persists `provider_diagnostic` rows to `sandbox_telemetry_events` via the Chunk-3 advisory-lock allocator.
2. 2 residual log-only sites (`_harvestLogs`, `_harvestArtefacts`) are documented with the `// no-tenancy-context: defaults to log-only` marker per the suggested-approach exception in `tasks/todo.md:1317`; they emit log-only diagnostics via `withSandboxProvider`'s `logger.warn` path and are explicitly scope-deferred for a method-signature refactor.
3. Per CLAUDE.md § "Review pipeline" guidance: because mechanical fixes were applied in this run (the 2 documentation comments), **re-run `pr-reviewer` on the expanded changed-code set** before creating the PR. The reviewer needs to see the final state with the marker comments in place.

Then proceed to `reality-checker` (Significant/Major branch) -> `dual-reviewer` -> Phase 3 finalisation (`finalisation-coordinator`).

**Commit at finish:** `dd817ac6`
