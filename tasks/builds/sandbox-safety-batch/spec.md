---
status: DRAFT
date: 2026-05-15
author: main-session (claude opus 4.7)
scope_class: Significant
source_branch: main
build_slug: sandbox-safety-batch
output_location: tasks/builds/sandbox-safety-batch/spec.md
---

# Wave 2 Session C — sandbox safety + spec-conformance batch

Single coordinated PR closing the open sandbox-isolation backlog from spec-conformance, adversarial-reviewer, and chatgpt-pr-review (PR #287). Combines 3 critical + 6 high + 5 medium-observe + 6 spec-conformance REQ items.

This build is NOT a refactor. It is a multi-bug-fix batch with new migrations. Each item below is sized as a self-contained fix.

---

## 1. Scope

Closes the following `tasks/todo.md` items from sections "Sandbox isolation (PR #287)", "Deferred from spec-conformance review — sandbox-isolation", and "Deferred from adversarial-reviewer review — sandbox-isolation":

- **Critical (3)**: SANDBOX-ADV-1.1, SANDBOX-ADV-5.1, SANDBOX-ADV-4.1
- **High (6)**: SANDBOX-ADV-2.1, SANDBOX-ADV-3.1, SANDBOX-ADV-6.1, REQ #6, REQ #20, REQ #57
- **Spec-conformance REQ (5)**: REQ #11, REQ #28, REQ #29, REQ #31, REQ #36
- **Medium / observe (5)**: SANDBOX-ADV-1.2, SANDBOX-ADV-2.2, SANDBOX-ADV-3.2, SANDBOX-ADV-4.2, SANDBOX-ADV-5.2
- **Additional (3)**: REQ #35 (ambiguous), REQ #55, SANDBOX-R3-T1 (advisory)

**Total: ~22 items** in one coordinated PR.

## 2. Goals

1. Close every Sandbox CRITICAL and HIGH item with a code fix or migration.
2. Close every Spec-conformance REQ with the explicit fix the spec requires.
3. Close every Sandbox medium/observe item with either a fix or a documented decision.
4. Each fix is verified against the original spec section that defines the contract.
5. No behaviour change beyond what each fix's contract requires.

## 3. Non-Goals

- No changes to the spec for sandbox-isolation. Spec is the contract; this build conforms to it.
- No e2b SDK installation or real-provider wiring (SANDBOX-DEF-EGRESS-MECH, SANDBOX-F1 stay v2-backlog — they wait on the SDK).
- No changes to inline-sandbox provider beyond the env-injection bypass guard.
- No changes to ceiling-monitor logic beyond ensuring the queue enqueue happens.
- No changes to log-storage architecture beyond the per-tenant quota check.

## 4. Framing Assumptions

- Repo is pre-production. Testing posture is `static_gates_primary` per `docs/spec-context.md`.
- Sandbox-isolation spec (`tasks/builds/sandbox-isolation/spec.md` and related artefacts) is the authoritative contract. Every REQ item references its spec section directly.
- The sandbox subsystem is a self-contained set of services and jobs. The file paths most likely touched: `server/services/sandbox*`, `server/services/executionBackends/*`, `server/jobs/sandboxHarvest*`, `server/jobs/sandboxCeilingMonitor*`, `migrations/*`. Architect's chunk-0 sweep enumerates the exact file set.
- The 5 sandbox tables flagged for missing subaccount FKs are: `sandbox_executions`, `sandbox_logs`, `sandbox_artefacts`, `sandbox_telemetry_events`, `sandbox_harvest_runs` (architect verifies against `server/db/schema/`).
- `e2b` SDK is NOT installed; provider routes through the inline / dev backend stub. The spec's safety guarantees are enforced at the service tier, not the provider tier.
## 5. Items — Critical

### 5.1. SANDBOX-ADV-1.1 — Reconciliation job missing `withOrgTx` wrap (confirmed-hole)

Source: adversarial-reviewer log, high-priority pre-merge candidate.

Fix: wrap the reconciliation job's DB work in `withOrgTx({organisationId, ...})` after the run row loads its org. Default pattern matches Track A2 WF4 fix.

File: `server/jobs/sandboxHarvestReconciliationJob.ts` (architect confirms via chunk-0 sweep).

Acceptance: every tenant-scoped DB call inside the job runs inside `withOrgTx`. `verify-with-org-tx-or-scoped-db.sh` does not regress.

### 5.2. SANDBOX-ADV-5.1 — Ceiling-monitor + wall-clock-kill jobs never enqueued (likely-hole)

Source: adversarial-reviewer log.

Investigation: confirm whether the two jobs are registered via `createWorker` at boot AND whether their scheduled enqueue loop runs. If either is missing, wire it.

Acceptance: both jobs appear in the boot-time registration list AND a smoke-test confirms they receive jobs from the schedule queue.

### 5.3. SANDBOX-ADV-4.1 — Credential-leak defense is case-sensitive (confirmed-hole)

Source: adversarial-reviewer log.

Fix: change the credential-leak detection to case-insensitive matching. Add unit test for the case-insensitive path.

File: architect identifies during chunk-0 sweep — likely `server/services/sandbox/credentialLeakDetectorPure.ts` or equivalent.

Acceptance: targeted Vitest passes against case-insensitive credential strings. Existing case-sensitive tests still pass.

## 6. Items — High

### 6.1. SANDBOX-ADV-2.1 — `templateVersion` from env var unvalidated (likely-hole)

Fix: read pinned digest from `E2bSandbox.templateDigest`, not the env var. Audit rows now carry the pinned digest.

File: `server/services/executionBackends/ieeDevBackend.ts:131`.

Acceptance: env-var override path is removed OR validated against a pinned-digest allowlist.

### 6.2. SANDBOX-ADV-3.1 — Telemetry sequence allocator race silently drops events (likely-hole)

Fix: switch the allocator to `INSERT ... ON CONFLICT DO UPDATE SET sequence = sandbox_telemetry_events.sequence + 1 RETURNING sequence` with retry; OR use a Postgres advisory lock. At minimum: log dropped events at warn/error level.

Files: `server/services/sandboxExecutionService.ts:63-73`, `server/services/sandboxHarvestService.ts:81-91` (architect confirms post-Wave-1-split locations).

Acceptance: targeted Vitest for the race path passes. `criticality='error'` events are never silently dropped.

### 6.3. SANDBOX-ADV-6.1 — Reconciliation hardcodes `credentialAliases: []` (likely-hole)

Fix: add `credential_aliases` JSONB column to `sandbox_executions` via migration. Update reconciliation to read from the column.

File: `server/jobs/sandboxHarvestReconciliationJob.ts:183-187`.

Acceptance: column exists, reconciliation reads from it, ` Latent until C13` note removed.

### 6.4. REQ #6 — `sandbox_logs.line` length CHECK constraint

Fix: add `CHECK (char_length(line) <= 10000)` (or spec-mandated limit) via migration.

Acceptance: migration lands; raw `INSERT` with overlong line fails.

### 6.5. REQ #20 — `sandboxMeteringQueryPure.ts` missing

Fix: author the pure-helper file per spec §<ref>. Move metering query logic out of the impure service into the pure helper.

Acceptance: file exists with the exports spec §<ref> names; pure-helper test passes.

### 6.6. REQ #57 — Credential value-threading into `/workspace/secrets/` (high, ambiguous)

Investigation: confirm whether this is genuinely actionable in dev mode (no real provider). If actionable, implement; if not, document as v2-deferred with explicit reason (waits on real provider).

Acceptance: either implemented OR explicitly v2-deferred with rationale in `tasks/todo.md`.
## 7. Items — Spec-conformance REQ

### 7.1. REQ #11 (Critical) — `runTask` does not call `runHarvest` on the happy path

Fix: thread `runHarvest` call into the happy path per spec §<ref>.

Acceptance: targeted Vitest covering the happy path confirms harvest runs.

### 7.2. REQ #28 (Critical) — `sandbox_start_failed` telemetry event never emitted

Fix: emit the event on the failure paths the spec names.

Acceptance: grep confirms the emission sites; targeted Vitest passes for the failure path.

### 7.3. REQ #29 (Critical) — `sandbox_start` telemetry event never emitted

Fix: emit the event on every sandbox-start path.

Acceptance: grep confirms emission; targeted Vitest passes.

### 7.4. REQ #31 (Medium) — `withSandboxProvider` emits diagnostics only as logs, not DB rows

Fix: persist diagnostics to `sandbox_telemetry_events` or the spec-mandated table.

Acceptance: diagnostics appear as DB rows after a sandbox provider call.

### 7.5. REQ #36 (Medium) — Ceiling-monitor + wall-clock-kill jobs do not call provider terminate

Fix: ensure both jobs call the provider's `terminate(sandboxId)` when killing a sandbox.

Acceptance: targeted Vitest confirms terminate is called on both job paths.

### 7.6. REQ #35 (Medium, AMBIGUOUS) — `sandboxArtefactPurgeJob` trigger from run-soft-delete

Investigation: resolve the spec ambiguity with the operator before implementing. Default: trigger from run-soft-delete via DB trigger OR an event-driven listener — operator chooses during this build.

Acceptance: spec ambiguity resolved (operator-confirmed decision in `tasks/builds/sandbox-safety-batch/progress.md`); fix matches the resolved decision.

### 7.7. REQ #55 (Medium) — Sandbox teardown verification missing entirely

Fix: implement teardown verification per spec §<ref>. Likely: post-terminate health-check call + audit row.

Acceptance: targeted Vitest covers teardown verification path.

## 8. Items — Medium / observe

Per operator decision 2026-05-15: include in this PR for exhaustive bar.

### 8.1. SANDBOX-ADV-1.2 — Subaccount FK missing on 5 new sandbox tables

Fix: migration adds `FOREIGN KEY (subaccount_id) REFERENCES subaccounts(id)` to all 5 tables.

Tables (verify exact list during chunk 0): `sandbox_executions`, `sandbox_logs`, `sandbox_artefacts`, `sandbox_telemetry_events`, `sandbox_harvest_runs`.

Acceptance: migration lands; cross-subaccount inserts fail at DB level.

### 8.2. SANDBOX-ADV-2.2 — Inline-sandbox env-injection bypass

Fix: guard against forged `env` object in `resolveSandboxProvider`. CI gate catches static imports; add runtime check too.

Acceptance: targeted Vitest with forged `env` is rejected.

### 8.3. SANDBOX-ADV-3.2 — Race between provider success and ceiling-monitor `markForHarvest`

Fix: implement provider-result-wins semantics OR document as known race with monitoring.

Acceptance: race-window narrowed via DB transaction OR documented; targeted Vitest.

### 8.4. SANDBOX-ADV-4.2 — S3 path-traversal via filename

Fix: sanitise `artefact.filename` — strip `..`, leading `/`, validate against allowlist.

Acceptance: targeted Vitest with `..` and `/` in filename is rejected or sanitised.

### 8.5. SANDBOX-ADV-5.2 — No per-tenant log-storage quota

Fix: add per-tenant log-storage quota check before inserting into `sandbox_logs`. Reject (and log) when quota exceeded.

Acceptance: targeted Vitest exceeding quota is rejected.

### 8.6. SANDBOX-R3-T1 (advisory) — Reconciliation eligibility uses Node `new Date()`

Fix: migrate to DB `SELECT NOW()` for consistency.

File: `server/jobs/sandboxHarvestReconciliationJob.ts:72`.

Acceptance: clock source consistent with ceiling monitor.
## 9. Migrations

Expected new migrations (architect numbers sequentially during chunk 0):

| Migration | Purpose | Items |
|---|---|---|
| `<NNNN>_sandbox_subaccount_fks.sql` (+ down) | Add subaccount FK to 5 sandbox tables | 8.1 |
| `<NNNN>_sandbox_credential_aliases.sql` (+ down) | Add `credential_aliases` JSONB to `sandbox_executions` | 6.3 |
| `<NNNN>_sandbox_logs_line_check.sql` (+ down) | Add `CHECK (char_length(line) <= 10000)` | 6.4 |
| `<NNNN>_sandbox_usability_state_check.sql` (+ down) | OPTIONAL — only if OSI-DEF-9 deemed in-scope by operator | OSI-DEF-9 |

Each migration uses `IF EXISTS` / `IF NOT EXISTS` guards and has a paired `.down.sql`.

## 10. Acceptance Criteria

A build is complete when ALL of the following hold:

1. Every item in §5, §6, §7, §8 is either implemented per its fix description OR explicitly v2-deferred with rationale logged in `tasks/todo.md`.
2. `npm run build:server` exits 0.
3. `npm run lint` exits 0.
4. New migrations land with paired `.down.sql`.
5. `verify-rls-coverage.sh` + `verify-rls-protected-tables.sh` + `verify-with-org-tx-or-scoped-db.sh` pass.
6. Targeted Vitest runs pass for every item that authored new pure-helper logic.
7. `tasks/todo.md` items listed in §1 marked `[status:closed:pr:<num>]` in the merge commit.

## 11. Chunks (high-level)

Architect refines during plan phase. Expected shape:

- **Chunk 0**: scope verification + file-set sweep + REQ #35 ambiguity resolution + migration numbering + plan write
- **Chunks 1-3**: 3 critical items (§5)
- **Chunks 4-6**: 6 high items (§6)
- **Chunks 7-9**: 5 spec-conformance REQ items (§7)
- **Chunks 10-12**: 6 medium/observe items (§8)
- **Chunk N**: spec-conformance + pr-reviewer + final review pass

## 12. Out of Scope

The following sandbox items stay v2-backlog and are NOT addressed in this build:

- **SANDBOX-DEF-EGRESS-MECH** — egress interception mechanism (architecture decision; e2b SDK not installed)
- **SANDBOX-F1** — real e2b template digests / hashes (waits on SDK installation)
- **SANDBOX-R3-T2** — placeholder PUBLISHED_VERSION (covered by SANDBOX-F1)
- **OSI-DEF-2..13** — operator-session future-state items (separate subsystem)

Each is logged in `tasks/todo.md` with `[status:v2-backlog]` rationale.
