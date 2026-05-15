# Spec Conformance Log

**Spec:** `tasks/builds/sandbox-safety-batch/spec.md`
**Spec commit at check:** `795f0fed` (branch base) -> `e40d65b2` (HEAD)
**Branch:** `claude/sandbox-safety-batch`
**Base:** `c92d2a81` (merge-base with `origin/main`)
**Scope:** all-of-spec (operator-confirmed full-branch verify per Setup Step C path 3)
**Changed-code set:** 54 files (50 code/migration + 4 docs)
**Run at:** 2026-05-15T09:27:43Z
**Commit at finish:** `79124cf1`

---

## Summary

- Requirements extracted:       22
- PASS:                         21
- MECHANICAL_GAP -> fixed:      0
- DIRECTIONAL_GAP -> deferred:  1
- AMBIGUOUS -> deferred:        0
- OUT_OF_SCOPE -> skipped:      0

**Verdict:** NON_CONFORMANT (1 blocking gap — see deferred items)

---

## Requirements extracted (full checklist)

### Critical (3)

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| SANDBOX-ADV-1.1 | §5.1 | Reconciliation job wraps DB work in `withOrgTx` | PASS |
| SANDBOX-ADV-5.1 | §5.2 | Ceiling-monitor + wall-clock-kill jobs are enqueued at sandbox start | PASS |
| SANDBOX-ADV-4.1 | §5.3 | Credential-leak detection is case-insensitive + unit test | PASS |

### High (6)

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| SANDBOX-ADV-2.1 | §6.1 | `templateVersion` validated against pinned allowlist (not raw env var) | PASS |
| SANDBOX-ADV-3.1 | §6.2 | Telemetry sequence allocator is race-safe; error-criticality events never silently dropped | PASS |
| SANDBOX-ADV-6.1 | §6.3 | Reconciliation reads `credential_aliases` JSONB column (not hardcoded `[]`) | PASS |
| REQ #6 | §6.4 | `sandbox_logs.line` carries `CHECK (char_length(line) <= 10000)` | PASS |
| REQ #20 | §6.5 | `sandboxMeteringQueryPure.ts` exists with named exports | PASS |
| REQ #57 | §6.6 | Credential value-threading: implemented OR explicitly v2-deferred with rationale in `tasks/todo.md` | PASS |

### Spec-conformance REQ (7)

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| REQ #11 | §7.1 | `runTask` calls `runHarvest` on the happy path | PASS |
| REQ #28 | §7.2 | `sandbox_start_failed` telemetry event emitted on failure paths | PASS |
| REQ #29 | §7.3 | `sandbox_start` telemetry event emitted on every start path | PASS |
| REQ #31 | §7.4 | `withSandboxProvider` diagnostics persisted to `sandbox_telemetry_events` (DB rows, not just logs) | DIRECTIONAL_GAP |
| REQ #36 | §7.5 | Ceiling-monitor + wall-clock-kill jobs call `provider.terminate()` before DB flip | PASS |
| REQ #35 | §7.6 | `sandboxArtefactPurgeJob` triggered from run-soft-delete via service-layer enqueue (operator-resolved) | PASS |
| REQ #55 | §7.7 | Sandbox teardown verification: post-terminate health check + audit | PASS |

### Medium / observe (6)

| REQ | Spec section | Requirement | Verdict |
|---|---|---|---|
| SANDBOX-ADV-1.2 | §8.1 | 5 sandbox tables carry `FOREIGN KEY (subaccount_id) REFERENCES subaccounts(id)` | PASS |
| SANDBOX-ADV-2.2 | §8.2 | `resolveSandboxProvider` / `InlineSandbox` no longer accept caller-supplied `env` | PASS |
| SANDBOX-ADV-3.2 | §8.3 | Provider-success vs ceiling-monitor race resolved (provider-result-wins) | PASS |
| SANDBOX-ADV-4.2 | §8.4 | S3 artefact filenames sanitised against path-traversal / absolute paths | PASS |
| SANDBOX-ADV-5.2 | §8.5 | Per-tenant log-storage quota check before insert | PASS |
| SANDBOX-R3-T1 | §8.6 | Reconciliation eligibility uses DB `SELECT NOW()` (not Node `new Date()`) | PASS |

---

## PASS — Evidence summary

### Critical (§5)

- **SANDBOX-ADV-1.1 (§5.1)** — `server/jobs/sandboxHarvestReconciliationJob.ts:138-149` wraps per-row work in `withOrgTx({ tx: orgTx, organisationId: row.organisation_id, source: 'jobs.sandboxHarvestReconciliation:per-row' })`. Wrap landed in PR #287 fix-loop B3; this branch adds the targeted shape test.
- **SANDBOX-ADV-5.1 (§5.2)** — `server/services/sandboxExecutionService.ts:455-483` enqueues both `SANDBOX_CEILING_MONITOR_JOB` and `SANDBOX_WALL_CLOCK_KILL_JOB` (the latter with `startAfter`) before the synchronous `provider.runTask()` call. State-claim-first per §8.10 — lease held from Case 1 INSERT.
- **SANDBOX-ADV-4.1 (§5.3)** — Pure helper `server/services/sandbox/credentialLeakFilenameGuardPure.ts` normalises via `toLowerCase()` + backslash-collapse + double-slash-collapse before the membership check. Caller migrated at `server/services/sandboxHarvestService.ts:42, 424`. 9-case targeted test covers case variants, backslash, double-slash, traversal, innocuous, empty.

### High (§6)

- **SANDBOX-ADV-2.1 (§6.1)** — `resolveTemplateVersion` in `server/services/executionBackends/ieeDevBackend.ts:86-108` reads `CURRENT_VERSION`, falls back to `process.env['SANDBOX_TEMPLATE_VERSION']`, and rejects any value not in `ALLOWED_TEMPLATE_VERSIONS` by throwing `FailureError('sandbox_input_rejected')`. Acceptance "validated against a pinned-digest allowlist" met.
- **SANDBOX-ADV-3.1 (§6.2)** — `server/lib/sandboxTelemetrySequencePure.ts` serialises allocation via `pg_advisory_xact_lock(hashtext(${sandboxExecutionId})::bigint)` with 23505 retry. `criticality === 'error'` throws `FailureError('sandbox_telemetry_drop')`. New failure reason at `shared/iee/failureReason.ts:85`. Both call sites migrated: `sandboxExecutionService.ts:81`, `sandboxHarvestService.ts:95`.
- **SANDBOX-ADV-6.1 (§6.3)** — Migration `0361_sandbox_credential_aliases.sql` adds JSONB; schema at `server/db/schema/sandboxExecutions.ts:42` carries `credentialAliases: jsonb('credential_aliases').notNull().$type<string[]>().default([])`. Reconciliation `server/jobs/sandboxHarvestReconciliationJob.ts:277` reads `credentialAliases: row.credential_aliases`.
- **REQ #6 (§6.4)** — Migration `0362_sandbox_logs_line_check.sql` adds `CONSTRAINT sandbox_logs_line_max_length CHECK (char_length(line) <= 10000)` with paired `.down.sql`.
- **REQ #20 (§6.5)** — `server/services/sandboxMeteringQueryPure.ts` exposes `buildOrgSandboxMinutesQuery`, `buildSubaccountSandboxMinutesQuery`, `rollupSandboxMinutes`, with ISO window validation; pure helper has zero transitive DB import.
- **REQ #57 (§6.6)** — Decision at `tasks/builds/sandbox-safety-batch/req-57-decision.md` (v2-deferred); `tasks/todo.md:1644` carries the deferred row referencing `SANDBOX-DEF-EGRESS-MECH`. Acceptance "explicitly v2-deferred with rationale" met.

### Spec-conformance REQ (§7)

- **REQ #11 (§7.1)** — `sandboxExecutionService.ts:40` imports `runHarvest`; `:565` calls it on the happy path with the full context object (subaccountId, runId, agentId, taskId, provider, templateName, templateVersion, outputSchemaRef, credentialAliases, policyArtefactLimits).
- **REQ #28 (§7.2)** — `sandbox_start_failed` emitted at `sandboxExecutionService.ts:513-516` with `reason: 'provider_unavailable'` + `providerErrorCode` on the catch path of `_attemptProviderStart`.
- **REQ #29 (§7.3)** — `sandbox_start` emitted at `sandboxExecutionService.ts:529-533` with `ceilings`, `network_policy`, `alias_count` after a successful `provider.runTask` return and before the `pending -> harvesting` transition.
- **REQ #36 (§7.5)** — `sandboxCeilingMonitorJob.ts:244-256` and `sandboxWallClockKillJob.ts:85-92` call `await getProvider().terminate(providerSandboxId)` via `withSandboxProvider({ phase: 'terminal', ... })` BEFORE the DB row flip; both catch terminate failure non-fatally. Interface `SandboxExecutionService.terminate(providerSandboxId: string): Promise<void>` at `sandboxProviderResolver.ts:25`; all three providers (e2b, local_docker, inline) implement it.
- **REQ #35 (§7.6)** — Canonical helper `server/services/agentRunSoftDeleteService.ts` performs `UPDATE agent_runs SET deleted_at = NOW() WHERE id = ? AND organisation_id = ? AND deleted_at IS NULL`, then enqueues `SANDBOX_ARTEFACT_PURGE_JOB` with `singletonKey: runId`. rowCount===1 assertion; suppression-is-success on enqueue failure (§8.33). Migration `0363_agent_runs_deleted_at.sql` lands the schema and the partial index. Advisory verify gate `scripts/gates/verify-agent-runs-soft-delete-canonical.sh` greps for direct `deletedAt` writes outside the helper. Matches operator decision 2026-05-15 (service-layer event-driven, not a DB trigger).
- **REQ #55 (§7.7)** — New pure verifier `server/services/sandbox/teardownVerifierPure.ts` (callback-injected health check). Wired at `e2bSandbox.ts:409` (harvest path) and `:459` (terminate path); both branches log `sandbox.teardown.verified` or `sandbox.teardown.unverified` with reason. 3-case targeted test covers the three branches (returns-false, returns-true, throws).

### Medium / observe (§8)

- **SANDBOX-ADV-1.2 (§8.1)** — Migration `0360_sandbox_subaccount_fks.sql` adds named `FOREIGN KEY (subaccount_id) REFERENCES subaccounts(id) ON DELETE RESTRICT` to all 5 tables (plan correctly resolved the spec-§4 misnaming of the 5th table: `sandbox_egress_audit`, not `sandbox_harvest_runs`). All 5 Drizzle schemas updated with `.references(() => subaccounts.id, { onDelete: 'restrict' })`.
- **SANDBOX-ADV-2.2 (§8.2)** — `resolveSandboxProvider()` is parameter-less; reads `process.env` directly. `InlineSandbox` constructor parameter-less; reads `NODE_ENV` + `SANDBOX_ALLOW_INLINE` itself. Forged-env bypass closed via TypeScript narrowing + boot-time runtime guards. 3-case test in `sandboxProviderResolverEnvInjectionPure.test.ts`.
- **SANDBOX-ADV-3.2 (§8.3)** — Pure helper `server/jobs/ceilingMonitorRaceDecisionPure.ts` encodes provider-result-wins rules across five cases. Consumed at `sandboxCeilingMonitorJob.ts:282` after a defensive re-read of `status`, `terminatedAt`, `harvestedAt`. Both `'provider'` and `'tied'` short-circuit with `sandbox.ceiling_monitor.lost_race_to_provider` log (suppression-is-success).
- **SANDBOX-ADV-4.2 (§8.4)** — Pure sanitiser `server/services/sandbox/artefactFilenameSanitiserPure.ts` returns discriminated union with `contains_path_traversal | absolute_path | disallowed_chars | empty` reasons. Wired at `sandboxHarvestService.ts:436` after credential-leak filter; rejection emits `artefact_upload_failed` at `criticality: 'error'`.
- **SANDBOX-ADV-5.2 (§8.5)** — Constant `MAX_LOG_BYTES_PER_ORG_PER_DAY = 100 * 1024 * 1024` at `server/lib/sandboxRetentionConstants.ts`. Pure arithmetic helper `logStorageQuotaPure.ts`. Caller at `sandboxHarvestService.ts:614-641` SUMs today's `char_length(line)` via `date_trunc('day', NOW() AT TIME ZONE 'UTC')` filter, then calls `checkLogStorageQuota`; rejects with `artefact_upload_failed` + `reason: 'log_quota_exceeded'` on `!allowed`.
- **SANDBOX-R3-T1 (§8.6)** — `sandboxHarvestReconciliationJob.ts:74` now uses `const [{ now: dbNow }] = await tx.execute<{ now: string }>(sql\`SELECT NOW() AS now\`)` (was Node `new Date()`). Per KNOWLEDGE.md 2026-05-11 "DB-anchored elapsed time" entry.

---

## Mechanical fixes applied

None. No mechanical gaps surfaced.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

### REQ #31 — withSandboxProvider diagnostics persisted to DB rows

**Spec section:** §7.4. **Verdict:** DIRECTIONAL_GAP.

**State of the seam.** The wrapper at `server/lib/withSandboxProvider.ts` now exposes an optional `telemetryWriter?: (event: ProviderDiagnosticEvent) => Promise<void>` field on `WithSandboxProviderOpts<T>` (line 47). The wrapper invokes the callback at all four diagnostic emission points alongside its existing `logger.warn` lines — slow-start (line 121-127), retry / rate-limit during onRetry (line 138-149), ambiguous-terminal in the catch (line 165-175), post-success slow-start observation (line 217). The callback's own throws are caught and logged as `sandbox.provider_diagnostic.telemetry_write_failed` (§8.36 — no empty catch). A 3-case targeted test at `server/services/__tests__/withSandboxProviderTelemetryWriterPure.test.ts` exercises the callback contract.

**The gap.** Zero production callers wire the `telemetryWriter`. All 12 `withSandboxProvider(...)` invocations across `sandboxCeilingMonitorJob.ts`, `sandboxWallClockKillJob.ts`, `e2bSandbox.ts`, `localDockerSandbox.ts`, and `sandboxHarvestService.ts` omit the field. The spec's acceptance — "diagnostics appear as DB rows after a sandbox provider call" — is therefore not satisfied. Only the seam exists.

**Why this is directional, not mechanical.** The fix is not a surgical add. Each of the 12 call sites needs a per-context decision about (a) whether the `sandbox_executions` row exists yet at the time of the call (the plan's R2 mitigation explicitly says pre-row calls must stay log-only), and (b) what tenancy fields the writer needs to populate the `sandbox_telemetry_events` NOT NULL columns (`organisationId`, `subaccountId`, `runId`, `agentId`, `taskId`, `templateName`, `templateVersion`, `provider`). Assembling the writer is a design decision: the writer's body needs to invoke `allocateAndInsertTelemetryEvent` (from Chunk 3) inside an existing `withOrgTx`, which means each caller must thread either an `OrgScopedTx` or the tenancy context — neither pattern is uniform across the 12 sites today.

**Routing.** `tasks/todo.md` already carries an entry for this REQ at **line 1317** with finding type "REQ #31 (Medium) — `withSandboxProvider` emits diagnostics only as logs, not DB rows" and a suggested approach that aligns with the work needed here. Per CLAUDE.md § "Deferred actions route to `tasks/todo.md` — single source of truth", the dedup rule applies: no new entry is appended; the existing entry remains the routing record.

---

## Files modified by this run

None. No mechanical fixes were applied.

---

## Next step

**NON_CONFORMANT** — 1 directional gap (REQ #31) must be addressed by the main session before `pr-reviewer`. The pre-existing `tasks/todo.md:1317` entry is the canonical routing record — no new todo was appended.

Recommended operator action: either

1. **Treat REQ #31 as in-scope for THIS PR.** Wire `telemetryWriter` at each in-row call site (sandboxHarvestService inner reads at lines 217/327/406/477, sandboxExecutionService `_attemptProviderStart`, sandboxCeilingMonitorJob.applyCeilingTransition terminate call at line 244, sandboxWallClockKillJob terminate call at line 85, e2bSandbox terminate/harvest paths). Writer body should invoke `allocateAndInsertTelemetryEvent` from Chunk 3 inside the caller's existing `withOrgTx`. Pre-row call sites (start phase, no execution row yet) keep `telemetryWriter` omitted — the plan's R2 mitigation accepts log-only at those points. Re-run `spec-conformance` after the wiring to flip the verdict to `CONFORMANT_AFTER_FIXES`.

2. **Carry REQ #31 forward.** Acknowledge it as incomplete in `tasks/builds/sandbox-safety-batch/progress.md` and proceed to `pr-reviewer` with this NON_CONFORMANT verdict recorded. The pre-existing `tasks/todo.md:1317` entry is sufficient routing.

The pre-existing todo entry suggests option 1 is the canonical close. The seam (callback hook) is already in place — the remaining work is wiring at each call site with row context.

**Commit at finish:** (recorded post-commit below)
