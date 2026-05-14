# Adversarial Review Log — sandbox-isolation

**Branch:** claude/evolve-sandbox-isolation-brief-Q51hc
**Build slug:** sandbox-isolation
**Spec:** tasks/builds/sandbox-isolation/spec.md
**HEAD at review:** 1656248c (post spec-conformance R2 + harvest-pipeline-wiring fix)
**Reviewer:** adversarial-reviewer (Phase 1 advisory; non-blocking per feature-coordinator §8.2)
**Verdict:** **HOLES_FOUND** (2 confirmed-holes, 4 likely-holes, 5 worth-confirming)

## Files reviewed (~26)

migrations/0321-0324, 5 sandbox schemas, sandboxExecutionService.ts, sandboxHarvestService.ts, both *Pure.ts files, sandbox/sandboxProviderResolver.ts, sandbox/inlineSandbox.ts, sandbox/e2bSandbox.ts + e2bSandboxPure.ts, sandbox/localDockerSandbox.ts + Pure, ieeDevBackend.ts + Pure, all 7 sandbox jobs, withSandboxProvider.ts, sandboxJobNames.ts, orgScopedDb.ts, rlsProtectedTables.ts, scripts/gates/verify-no-inline-sandbox-outside-test.sh.

## Confirmed holes (2)

### Finding 1.1 — Reconciliation job missing `withOrgTx` wrap

**File:** `server/jobs/sandboxHarvestReconciliationJob.ts:120-195`

`reconcileExecution(tx, row)` calls `runHarvestReconciliation(...)`, which uses `getOrgScopedDb()` at every harvest step. The job runs under `withAdminConnection` but never wraps the harvest invocation in `withOrgTx({ tx, organisationId: row.organisation_id })`. AsyncLocalStorage holds admin context. Every reconciliation call will throw `missing_org_context` (caught silently by per-row try/catch). Stuck executions cannot be reconciled — permanently stranded. Separately, `tx.execute(UPDATE sandbox_executions ... WHERE id = ANY(...))` (lines 162-167) runs on admin connection without RLS — WHERE has no `organisation_id` predicate.

**Fix:** Wrap `reconcileExecution` in `db.transaction(async (orgTx) => { withOrgTx({ tx: orgTx, organisationId: row.organisation_id }, async () => { await reconcileExecution(orgTx, row); }); })`. Add `AND organisation_id = ${row.organisation_id}::uuid` to UPDATE WHERE. Pattern: `sandboxTelemetryPruneJob.ts:91-105`.

**Severity:** Functional (reconciliation never works) + tenant isolation.

### Finding 4.1 — Credential-leak defense is case-sensitive

**File:** `server/services/sandboxHarvestService.ts:411-421`

Step 6 of harvest blocks artefacts whose filename contains `/workspace/secrets/` or starts with `secrets/` — using JavaScript case-sensitive string operations. Bypass paths: `/workspace/Secrets/myalias.token`, `/WORKSPACE/SECRETS/foo`, `../secrets/myalias.token`. e2b SDK `listFiles` response not normalised before comparison.

**Exploit:** Tenant submits task. Sandbox writes `echo $SECRET_TOKEN > /workspace/Secrets/exfil.token`. Filter misses capitalised variant. Credential value uploaded to S3, accessible via artefact ref returned in `runTask` output.

**Fix:** Normalise: `const norm = entry.filename.toLowerCase().replace(/\\/g, '/').replace(/\/+/g, '/');` then check on `norm`. Reject filenames containing `..` or absolute paths outside `/workspace/artefacts/`.

**Severity:** Latent until C13 wires real credential injection. Currently `e2bSandbox.ts:254-265` stubs credential injection. Fix BEFORE C13 lands.

## Likely holes (4)

### Finding 2.1 — `templateVersion` from env var unvalidated

**File:** `server/services/executionBackends/ieeDevBackend.ts:131`

`templateVersion: process.env['SANDBOX_TEMPLATE_VERSION'] ?? 'v1.0.0'` flows verbatim to `sandbox_executions.template_version` and e2b metadata tags. The `assertNotLatestTemplateVersion` guard only blocks the literal string `'latest'`. Audit rows can carry forged version strings if `SANDBOX_TEMPLATE_VERSION` env is compromised. Actual e2b sandbox image is safe (uses pinned `templateDigest` from PUBLISHED_VERSION). Audit-row vs sandbox-image divergence breaks spec G12.

**Fix:** Read pinned digest from resolved `E2bSandbox.templateDigest` rather than env var at dispatch time.

### Finding 3.1 — Telemetry sequence allocator race silently drops events

**File:** `server/services/sandboxExecutionService.ts:63-73` + `server/services/sandboxHarvestService.ts:81-91`

Both `_allocateTelemetrySequence` functions read `MAX(sequence) + 1` then INSERT. Concurrent writers for the same `sandboxExecutionId` can both read same MAX and collide on INSERT. The `23505` handler swallows silently. For `criticality='error'` events (`sandbox_start_failed`, `credential_leak_attempted`, `sandbox_terminal`), a security-relevant event may be silently lost with no audit trace.

**Fix:** `INSERT ... ON CONFLICT (sandbox_execution_id, sequence) DO UPDATE SET sequence = ... RETURNING sequence` with retry, OR Postgres advisory lock keyed on `sandboxExecutionId`. At minimum: log the dropped event at `warn`/`error` level.

### Finding 5.1 — Ceiling-monitor + wall-clock-kill jobs never enqueued

**File:** `server/services/sandboxExecutionService.ts:380-383` (TODO unimplemented)

Lines 380-383: `// TODO(C11a): enqueue sandboxCeilingMonitorJob via sandboxJobNames before invoking the provider so the monitor starts ticking from sandbox-start time.` Both jobs are registered as workers but never enqueued. Wall-clock enforcement is provider-side only (e2b SDK `timeout` — best-effort). Tenant code can run beyond spec §10.1 30-min hard cap with cost charged but unenforced.

**Fix:** In `_attemptProviderStart` after `pending → running` UPDATE succeeds, enqueue both jobs via `boss.send` with `singletonKey: sandboxExecutionId` and appropriate `startAfter`.

### Finding 6.1 — Reconciliation hardcodes `credentialAliases: []` (redaction gap)

**File:** `server/jobs/sandboxHarvestReconciliationJob.ts:183-187`

Reconciliation passes `credentialAliases: []`, so `composeRedactionPatternSet` has only default patterns. If canonical harvest fails after step 5 log read but before step 9 log persistence, reconciliation re-reads logs without alias-specific redaction patterns. Credential values embedded in log lines may persist unredacted.

**Severity:** Latent until C13 wires real credentials. Fix storage shape now (add `credential_aliases` JSONB column to `sandbox_executions`) so it's ready when C13 lands.

## Worth-confirming (5)

### Finding 1.2 — Subaccount FK missing on all 5 new tables

`migrations/0321..0323` — `subaccount_id UUID NOT NULL` with no `REFERENCES subaccounts(id)`. RLS only enforces `organisation_id`. If service layer passes `subaccountId` from another organisation, no DB-level check catches it. Confirm `credentialBrokerService.issueCredential` validates subaccount ownership before issuing.

### Finding 2.2 — Inline-sandbox env-injection bypass

`server/services/sandbox/sandboxProviderResolver.ts:50-51` — accepts injected `env` object. Caller can pass `{ NODE_ENV: 'test', SANDBOX_ALLOW_INLINE: '1' }` to bypass guards. CI gate checks static imports, not dynamic env injection. `InlineSandbox` constructor's repeat-check is the defence-in-depth backstop.

### Finding 3.2 — Provider-success vs ceiling-monitor markForHarvest race

`server/services/sandboxExecutionService.ts:439-452` — if ceiling-monitor's `markForHarvest` fires between `provider.runTask` returning and the atomic `pending → harvesting` UPDATE, the row is already `harvesting` with `errorReason='timed_out'`. Service UPDATE matches 0 rows. Harvest reads `errorReason='timed_out'` and classifies as timed-out — overriding successful provider completion. A completed execution billed as timed-out with no cost row.

### Finding 4.2 — S3 path-traversal via filename

`server/services/sandboxHarvestService.ts:516` — S3 key built with `${ctx.organisationId}/${ctx.subaccountId}/${ctx.sandboxExecutionId}/${artefact.filename}`. `artefact.filename` from provider not sanitised. Filename like `../../other-execution-uuid/output.json` could overwrite another execution's artefact (S3 doesn't normalise `..`).

### Finding 5.2 — Per-execution log-stream cap but no per-tenant quota

`server/services/sandboxHarvestService.ts:311-312` — `MAX_LOG_STREAM_BYTES = 10_485_760` (10 MB) per stream. With stdout + stderr both at cap = 20 MB per execution. No per-tenant total quota. 90-day retention prune. Tenant could fill DB before pruning fires.

## Additional observations

- `sandboxHarvestService.ts:253-258` — `resolveOutputSchema` always returns `null`, falling back to `z.unknown()`. Validate step is a no-op for V1 (only the 1 MB size cap actually gates output content).
- `e2bSandbox.ts:254-265` — Credential injection stubbed; latent risks (4.1, 6.1) materialise when C13 wires real injection.
- `migrations/0324` — `sandbox_compute` CHECK requires `sandbox_vcpu_seconds IS NOT NULL`, but harvest writes `String(0)` for V1 (no real metering). Synthetic zero-cost rows may need `sandbox_compute_correction` once real metering lands.
- `withSandboxProvider.ts:139-153` — If `boss.send` for reconciliation fails, exception is logged-and-swallowed. Combined with Finding 5.1, only 5-min cron sweep recovers stuck executions.

## Operator-prioritisation candidates (high-value pre-merge fixes)

- **Finding 1.1** (reconciliation `withOrgTx` wrap) — functional bug, every reconciliation throws today
- **Finding 5.1** (ceiling-monitor enqueue) — resource-abuse vector, TODO is one paragraph of code
- **Finding 4.1** (case-insensitive credential-leak filter) — one-line normalisation fix

The remaining 8 are appropriate for the post-merge backlog or Phase 3 chatgpt-pr-review's discretion.

## Routing decision

Per feature-coordinator §8.2, adversarial-reviewer findings are non-blocking advisory. All 11 items routed to tasks/todo.md for Phase 3 chatgpt-pr-review and post-merge prioritisation.

---
