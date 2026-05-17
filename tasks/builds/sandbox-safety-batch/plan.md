---
status: DRAFT
date: 2026-05-15
author: architect (claude opus 4.7)
build_slug: sandbox-safety-batch
spec: tasks/builds/sandbox-safety-batch/spec.md
upstream_spec: tasks/builds/sandbox-isolation/spec.md
chunks: 14
total_migrations: 4 (+ 4 paired .down.sql)
---

# Plan — sandbox-safety-batch

Closes 22 sandbox-isolation backlog items in a single coordinated PR. Each chunk is sized as a self-contained fix that conforms to an existing spec contract; this build does not amend the upstream `sandbox-isolation/spec.md`. CI runs the full gate suite — no `npm test`, no `scripts/verify-*.sh`, no `scripts/gates/*.sh` appear in any chunk's local verification commands.

---

## Contents

1. Model-collapse check
2. Architecture notes
   1. File-set sweep — spec item to verified current path
   2. 5-sandbox-table FK verification
   3. Migration numbering — sequential from 0360
   4. REQ #35 canonical helper — `softDeleteAgentRun()`
   5. Risk catalogue
3. Chunk decomposition
4. Per-chunk detail
   - Chunk 1a — Sandbox 5-table subaccount FK migration
   - Chunk 1b — Three column additions
   - Chunk 2 — REQ #35 canonical soft-delete helper
   - Chunk 3 — Telemetry sequence allocator race fix
   - Chunk 4 — Metering query pure helper
   - Chunk 5 — Reconciliation hardening
   - Chunk 6 — Provider-start lifecycle hardening
   - Chunk 7 — Ceiling-monitor + wall-clock-kill provider terminate
   - Chunk 8 — Inline-sandbox env-injection guard
   - Chunk 9 — Credential-leak case-insensitive verification + targeted Vitest
   - Chunk 10 — S3 path-traversal sanitisation
   - Chunk 11 — Per-tenant log-storage quota
   - Chunk 12 — Sandbox teardown verification
   - Chunk 13 — Provider-success vs ceiling-monitor race
   - Chunk 14 — REQ #57 v2-deferred decision + REQ #11/#28/#29 acceptance verification
5. Risks and mitigations
6. Executor notes
7. Self-consistency pass

---

## 1. Model-collapse check

**Question:** Does this 22-item batch decompose into ingest → extract → transform → render that a frontier multimodal model could collapse into a single structured-output call?

**Answer:** No. The batch is 22 pinpoint structural fixes — adding FK constraints, fixing a TOCTOU race in a sequence allocator, persisting log-level diagnostics to DB rows, sanitising filenames, wiring a canonical service-layer helper, fixing case-sensitivity in path comparisons, adding column-level CHECK constraints, and authoring a missing pure-helper file. None of the work is ML inference; every fix is a code-shape change to a specific code path that an LLM cannot collapse with a model call. Reject collapse.

---

## 2. Architecture notes

### 2.1 File-set sweep — spec item to verified current path

Every assumed path in spec §4 was re-confirmed via `Glob` / `Grep`. Notable corrections to the spec's framing assumptions are flagged.

| Spec § | Item ID | Verified file path(s) | Confirmation |
|---|---|---|---|
| 5.1 | SANDBOX-ADV-1.1 reconciliation `withOrgTx` | `server/jobs/sandboxHarvestReconciliationJob.ts:132-141` | Wrap already present (PR #287 fix-loop B3); chunk verifies + adds targeted test only |
| 5.2 | SANDBOX-ADV-5.1 monitor / kill enqueue | `server/services/sandboxExecutionService.ts:467-469` (TODO marker still present), `server/jobs/sandboxCeilingMonitorJob.ts`, `server/jobs/sandboxWallClockKillJob.ts` | Both jobs are registered (queueService.ts:1565-1600) but never receive work — confirmed hole |
| 5.3 | SANDBOX-ADV-4.1 credential-leak case-insensitive | `server/services/sandboxHarvestService.ts:448-465` | **Already fixed in PR #287 fix-loop B5** (commit `c5167bc5`). Chunk verifies + adds the missing Vitest. |
| 6.1 | SANDBOX-ADV-2.1 templateVersion env var | `server/services/executionBackends/ieeDevBackend.ts:131` | `process.env['SANDBOX_TEMPLATE_VERSION'] ?? 'v1.0.0'` — confirmed hole |
| 6.2 | SANDBOX-ADV-3.1 telemetry sequence race | `server/services/sandboxExecutionService.ts:73-84` (`_allocateTelemetrySequence`); `server/services/sandboxHarvestService.ts:84-95` (`allocateTelemetrySequence`) | Both files use the same TOCTOU pattern. Race confirmed in both; both call sites silently swallow 23505 on `error` criticality events |
| 6.3 | SANDBOX-ADV-6.1 reconciliation credentialAliases | `server/jobs/sandboxHarvestReconciliationJob.ts:274` | Hardcoded `credentialAliases: []` — confirmed hole |
| 6.4 | REQ #6 sandbox_logs line CHECK | `migrations/0322_create_sandbox_artefacts_telemetry_logs.sql` (creates `sandbox_logs`, no CHECK present); `server/db/schema/sandboxLogs.ts` | Schema lacks DB CHECK; service-layer truncation at `sandboxHarvestService.ts:333-337` partially substitutes |
| 6.5 | REQ #20 metering pure helper | **File missing** — no match for `sandboxMeteringQuery*.ts` anywhere in repo | Confirmed gap |
| 6.6 | REQ #57 credential value-threading | `server/services/sandbox/e2bSandbox.ts:258-265` | Stubbed `void alias.alias + targetPath`; no real value threading possible without provider SDK |
| 7.1 | REQ #11 runTask → runHarvest | `server/services/sandboxExecutionService.ts:38` (import), `:551-563` (call) | **Already fixed in commit `7d12f77f`**. Chunk verifies. |
| 7.2 | REQ #28 `sandbox_start_failed` event | `server/services/sandboxExecutionService.ts:386-389`, `:499-502` | **Already fixed in commit `7d12f77f`**. Chunk verifies. |
| 7.3 | REQ #29 `sandbox_start` event | `server/services/sandboxExecutionService.ts:515-519` | **Already fixed in commit `7d12f77f`**. Chunk verifies. |
| 7.4 | REQ #31 withSandboxProvider diagnostics → DB | `server/lib/withSandboxProvider.ts:105-176` (emits via `logger.warn` only) | Confirmed hole. Existing comment at lines 56-59 acknowledges the gap. |
| 7.5 | REQ #36 ceiling-monitor / wall-clock-kill provider terminate | `server/jobs/sandboxCeilingMonitorJob.ts:205-268`, `server/jobs/sandboxWallClockKillJob.ts:39-52` | Neither calls `provider.terminate()`; both flip row to `harvesting`. Confirmed hole |
| 7.6 | REQ #35 sandbox-artefact-purge trigger | `server/jobs/sandboxArtefactPurgeJob.ts:26-31` (accepts `runId` payload) | Job exists, registered. **No code currently enqueues it.** Operator decision: event-driven service-layer enqueue from canonical soft-delete helper. |
| 7.7 | REQ #55 teardown verification | Grep finds **zero** matches for `sandbox.teardown.verified` / `sandbox.teardown.unverified` in `server/`. `e2bSandbox.ts:378-388` terminates but does not verify | Confirmed hole |
| 8.1 | SANDBOX-ADV-1.2 5-table subaccount FK | See FK-verification table in §2.2 | Confirmed hole on all 5 tables |
| 8.2 | SANDBOX-ADV-2.2 inline-sandbox env injection | `server/services/sandbox/sandboxProviderResolver.ts:51` (`env: Record<string, string \| undefined> = process.env`); `server/services/sandbox/inlineSandbox.ts:25-35` | Caller-supplied `env` parameter on `resolveSandboxProvider` and `InlineSandbox.constructor` permits forged-env bypass |
| 8.3 | SANDBOX-ADV-3.2 provider-vs-ceiling race | `server/services/sandboxExecutionService.ts:_attemptProviderStart` (lines 458-547) vs `server/jobs/sandboxCeilingMonitorJob.ts:205-243` | Window narrow but present. Chunk decides between narrowing-fix and document-as-known. |
| 8.4 | SANDBOX-ADV-4.2 S3 path-traversal | `server/services/sandboxHarvestService.ts:495-540` (step 6/7 artefact upload flow) | Confirmed: filename validation only blocks `secrets/`-prefixed names, no general path-traversal sanitisation |
| 8.5 | SANDBOX-ADV-5.2 log-storage quota | `server/services/sandboxHarvestService.ts:320-410` (log-persist step) | No quota check anywhere |
| 8.6 | SANDBOX-R3-T1 reconciliation Node clock | `server/jobs/sandboxHarvestReconciliationJob.ts:73` (`const now = new Date()`) | Confirmed; advisory severity |

**Spec §4 framing-assumption corrections:**

- Spec assumes a `sandbox_harvest_runs` table among the 5 missing-FK tables. **No such table exists.** The five tables with `subaccount_id NOT NULL` columns and no FK are: `sandbox_executions`, `sandbox_logs`, `sandbox_artefacts`, `sandbox_telemetry_events`, `sandbox_egress_audit`.
- Spec implies SANDBOX-ADV-4.1 (credential-leak case-sensitivity) is still open. **Already fixed** by PR #287 fix-loop commit `c5167bc5` (line 448-465 normalises via `toLowerCase()` before checking). Chunk 9 verifies + adds the missing test.
- Spec implies REQ #11 / #28 / #29 require new wiring work. **All three are already passing** per spec-conformance Round 2 (2026-05-11T08-35-46Z). Verification-only in Chunk 14.
- Spec §4 references `sandboxHarvestServicePure.ts` for the metering query helper (REQ #20). The helper does not exist yet — Chunk 4 authors `server/services/sandboxMeteringQueryPure.ts` (top-level, mirrors sibling `sandboxHarvestServicePure.ts` placement).

### 2.2 5-sandbox-table FK verification

The `subaccounts` table primary key is `id UUID` (`server/db/schema/subaccounts.ts:22`). Each of the five sandbox tables carries `subaccount_id UUID NOT NULL` declared without a `REFERENCES subaccounts(id)` clause:

| Table | Schema file | Column declaration | Current FK | Migration adding the column |
|---|---|---|---|---|
| `sandbox_executions` | `server/db/schema/sandboxExecutions.ts:15` | `subaccountId: uuid('subaccount_id').notNull()` | None | `migrations/0321_create_sandbox_executions.sql:9` |
| `sandbox_logs` | `server/db/schema/sandboxLogs.ts:16` | `subaccountId: uuid('subaccount_id').notNull()` | None | `migrations/0322_create_sandbox_artefacts_telemetry_logs.sql` |
| `sandbox_artefacts` | `server/db/schema/sandboxArtefacts.ts:14` | `subaccountId: uuid('subaccount_id').notNull()` | None | `migrations/0322_create_sandbox_artefacts_telemetry_logs.sql:13` |
| `sandbox_telemetry_events` | `server/db/schema/sandboxTelemetryEvents.ts:46` | `subaccountId: uuid('subaccount_id').notNull()` | None | `migrations/0322_create_sandbox_artefacts_telemetry_logs.sql` |
| `sandbox_egress_audit` | `server/db/schema/sandboxEgressAudit.ts:16` | `subaccountId: uuid('subaccount_id').notNull()` | None | `migrations/0323_create_sandbox_egress_audit.sql` |

All five tables are post-PR #287 — they were created with the FK omitted. No existing data violates referential integrity in pre-production: the build has zero live runs against these tables. Therefore the FK can be added directly with `ALTER TABLE ... ADD CONSTRAINT ... NOT VALID; ALTER TABLE ... VALIDATE CONSTRAINT ...` (two-step add to keep the lock window narrow), or — given pre-production posture — a single `ALTER TABLE ... ADD CONSTRAINT ... REFERENCES subaccounts(id)` with no NOT VALID prefix. Chunk 1a takes the simpler approach.

### 2.3 Migration numbering — sequential from 0360

Two `0359_*` migrations are on main already (`0359_skill_analyzer_results_rls.sql` and `0359_workflow_runs_org_permissions.sql`) — the collision is inherited from main, not introduced by this branch. New migrations claim 0360 upward in the order below. Each ships with a paired `.down.sql`.

| Migration | Purpose | Items closed | Chunk |
|---|---|---|---|
| `0360_sandbox_subaccount_fks.sql` (+ down) | Add `FOREIGN KEY (subaccount_id) REFERENCES subaccounts(id)` to all 5 sandbox tables | 8.1 / SANDBOX-ADV-1.2 | Chunk 1a |
| `0361_sandbox_credential_aliases.sql` (+ down) | Add `credential_aliases JSONB NOT NULL DEFAULT '[]'::jsonb` to `sandbox_executions` | 6.3 / SANDBOX-ADV-6.1 | Chunk 1b |
| `0362_sandbox_logs_line_check.sql` (+ down) | Add `CHECK (char_length(line) <= 10000)` constraint on `sandbox_logs.line` | 6.4 / REQ #6 | Chunk 1b |
| `0363_agent_runs_deleted_at.sql` (+ down) | Add `deleted_at TIMESTAMPTZ` to `agent_runs` plus partial index on `(deleted_at) WHERE deleted_at IS NOT NULL` | REQ #35 / 7.6 | Chunk 1b |

Migration count: **4 new migrations + 4 paired `.down.sql` = 8 SQL files.**

### 2.4 REQ #35 canonical helper — `softDeleteAgentRun()`

**Current state.** `agent_runs` has no `deleted_at` column today (`server/db/schema/agentRuns.ts` carries no `deletedAt` field). Production code never writes `deletedAt` against `agentRuns`. The mitigation in `progress.md` therefore lands cleanly: no existing call sites need retrofitting.

**Canonical helper location.** New file `server/services/agentRunSoftDeleteService.ts`. Single responsibility (one exported function), depends only on `db` + `queueService` + `sandbox-artefact-purge` job name constant. Routes call this service; nothing else writes `agent_runs.deleted_at`.

**Public contract** (Chunk 2):

```ts
// server/services/agentRunSoftDeleteService.ts
export async function softDeleteAgentRun(input: {
  runId: string;
  organisationId: string;
  subaccountId: string;
}): Promise<{ deleted: boolean; reason?: 'not_found' | 'already_deleted' }>;
```

Behaviour:

1. UPDATE `agent_runs` SET `deleted_at = NOW()` WHERE `id = runId AND organisation_id = orgId AND deleted_at IS NULL`. Asserts `rowCount === 1` per §8.35; returns `{ deleted: false, reason: 'already_deleted' }` on zero rows.
2. On successful UPDATE: enqueue `queueService.sendJob('sandbox-artefact-purge', { runId, organisationId, subaccountId }, { singletonKey: runId })`.
3. Enqueue failure is logged at `logger.error` but does NOT roll back the soft-delete (the daily prune `sandboxLogsPruneJob` is a belt-and-braces fallback for orphaned artefacts; the reconciliation eligibility is captured in chunk-2's targeted test).
4. Suppression-is-success on `already_deleted` (§8.33 pattern).

**Verify gate** (Chunk 2 deliverable): new script `scripts/gates/verify-agent-runs-soft-delete-canonical.sh` (advisory, not blocking) — greps `server/` for `update(agentRuns).set(... deletedAt` outside `agentRunSoftDeleteService.ts`. Per `references/test-gate-policy.md` the gate is authored locally but runs only in CI. Targeted Vitest in Chunk 2 covers the helper's contract; the gate covers leakage.

**Caller wiring.** Zero callers today. The helper is introduced as the *future-only* canonical writer; this batch does not retrofit a non-existent code path. The build closes REQ #35 with: (a) schema column, (b) canonical helper + test, (c) verify gate, (d) the helper enqueues the purge job correctly.

### 2.5 Risk catalogue (≥ medium, with mitigation)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Race-fix for telemetry sequence allocator (Chunk 3) regresses harvest pipeline event-write throughput | Medium | Use Postgres advisory-lock-keyed-by-sandboxExecutionId with retry rather than rewriting to `INSERT ... ON CONFLICT DO UPDATE`. The advisory lock is per-execution and per-process, holds only across the INSERT, releases via try/finally. Targeted Vitest exercises 3+ concurrent inserts per execution and asserts every `criticality='error'` event is persisted. |
| R2 | `withSandboxProvider` diagnostic persistence (Chunk 6 REQ #31) requires threading `HarvestContext` into a `server/lib/` primitive that today has no DB dependency | Medium | Add an optional `telemetryWriter: (event: ProviderDiagnosticEvent) => Promise<void>` callback parameter to `withSandboxProviderOpts`. The harvest service / execution service supplies the callback (it owns the context). The lib stays DB-agnostic. Fallback: when `telemetryWriter` is undefined, retain the current log-only behaviour for early `start` phase calls that have no row yet. |
| R3 | Subaccount FK migration (Chunk 1a) breaks if any sandbox table contains a row with a `subaccount_id` not matching `subaccounts.id` | Low (pre-prod) | Pre-prod posture: zero live runs against these tables. Migration's `.down.sql` simply drops the constraint. If a stray row is found post-deploy, the FK addition fails fast — the migration is idempotent enough to re-run after a manual cleanup. |
| R4 | Inline-sandbox env-injection guard (Chunk 8) breaks existing tests that pass synthetic env via `resolveSandboxProvider(env)` parameter | Medium | Inspect `__tests__/sandboxProviderResolverPure.test.ts` (22 cases per handoff) before removing the parameter. Replace caller-supplied env path with a test-only override route — e.g. `resolveSandboxProvider()` reads `process.env` directly; tests use `vi.stubEnv`. Verify Pure test suite still passes. |
| R5 | Per-tenant log-storage quota (Chunk 11) needs a quota source-of-truth; spec does not name one | Medium | Default to a per-org-per-day cap computed from a constant in `server/lib/sandboxRetentionConstants.ts` (`MAX_LOG_BYTES_PER_ORG_PER_DAY = 100 MB`). No new DB column. The check fires inside the log-persist step in `sandboxHarvestService.ts` after counting bytes in the current batch and reading today's persisted total via a pure query. Operator-tunable later via env. |
| R6 | REQ #57 credential value-threading (Chunk 14) decides v2-deferred because the e2b SDK is not installed | Medium | Decision documented in plan + `tasks/todo.md`. SANDBOX-DEF-EGRESS-MECH already gates the SDK install. No code change in V1; the credential-broker integration arrives with the e2b SDK in a follow-up build. |
| R7 | Chunk 6 enqueue of ceiling-monitor and wall-clock-kill jobs collides with SANDBOX-B4 architectural limitation (synchronous `provider.runTask` blocks until terminal) | Medium | Phase the enqueue: `sandboxCeilingMonitorJob` is fire-and-monitor (re-enqueues itself on its own cadence) so enqueuing before the synchronous provider call still gives the monitor a tick after the provider completes. The wall-clock-kill is a one-shot at `wallClockMs + buffer`. Both are "belt-and-braces" with provider-side enforcement; the V1 limitation per SANDBOX-B4 is unchanged. Add a comment naming SANDBOX-B4 at the enqueue site. |
| R8 | Telemetry sequence allocator fix changes write-path behaviour while harvest pipeline is mid-flight in dev | Low | Pre-prod posture; no live harvest pipelines. The fix is idempotent: the new allocator produces the same `(execution_id, sequence)` tuples as the old one when there's no contention. Existing rows are unaffected. |
| R9 | Adding `deleted_at` to `agent_runs` (Chunk 1b) regresses queries that don't filter `WHERE deleted_at IS NULL` | Medium | Zero callers exist today (helper is new). All future agent_runs queries inherit the soft-delete contract from the canonical helper. Schema-file Drizzle column add is paired with documentation in the column's `comment:` string and a `KNOWLEDGE.md` entry (the doc-sync gate enforces). |
| R10 | Per-chunk targeted Vitest authoring drift: tests rely on internal helpers that get renamed or split during later chunks | Low | Each test imports from the same module surface the chunk under build exposes. Chunks are forward-only-dependent; later chunks do not rename earlier chunks' exports. Self-consistency pass below confirms. |

---

## 3. Chunk decomposition

Forward-only dependencies. Sizing rule: ≤5 files OR ≤1 logical responsibility per chunk. Migrations land before code that depends on the new columns.

| # | Chunk | Files | Depends on | Primary spec items |
|---|---|---|---|---|
| 1a | DB: sandbox subaccount FKs | 2 SQL + 5 schema = 7 | — | 8.1 / SANDBOX-ADV-1.2 |
| 1b | DB: 3 column additions | 6 SQL + 2 schema = 8 | — | 6.3 / 6.4 / REQ #35 prep |
| 2  | REQ #35 canonical soft-delete helper | 1 service + 1 test + 1 gate script = 3 | 1b | 7.6 / REQ #35 |
| 3  | Telemetry sequence race fix | 1 pure + 1 test + 2 callers = 4 | — | 6.2 / SANDBOX-ADV-3.1 |
| 4  | Metering query pure helper | 1 pure + 1 test = 2 | — | 6.5 / REQ #20 |
| 5  | Reconciliation hardening | 1 job edit + 1 test = 2 | 1b (credential_aliases) | 5.1 / 6.3 / 8.6 |
| 6  | Provider-start lifecycle | 1 service + 1 lib + 1 backend + 1 test = 4 | 3 | 5.2 / 6.1 / 7.4 |
| 7  | Ceiling-monitor + wall-clock-kill provider terminate | 2 jobs + 1 provider iface + 1 test = 4 | 6 | 7.5 / REQ #36 |
| 8  | Inline-sandbox env-injection guard | 1 resolver + 1 inline + 1 test = 3 | — | 8.2 / SANDBOX-ADV-2.2 |
| 9  | Credential-leak case-insensitive verification + test | 1 pure + 1 caller + 1 test = 3 | — | 5.3 / SANDBOX-ADV-4.1 |
| 10 | S3 path-traversal sanitisation | 1 pure + 1 test + 1 caller = 3 | 9 | 8.4 / SANDBOX-ADV-4.2 |
| 11 | Per-tenant log-storage quota | 1 pure + 1 service + 1 test = 3 | — | 8.5 / SANDBOX-ADV-5.2 |
| 12 | Teardown verification | 1 pure + 1 provider + 1 test = 3 | 7 | 7.7 / REQ #55 |
| 13 | Provider-success vs ceiling-monitor race | 1 pure + 1 test = 2 | 6, 7 | 8.3 / SANDBOX-ADV-3.2 |
| 14 | REQ #57 v2-deferred decision + REQ #11/#28/#29 verification | docs only (3) | — | 6.6 / 7.1 / 7.2 / 7.3 |

**Chunk count: 14. Total file count (modifications + creations + tests + migrations): ~50.**

Cross-cutting **DEVELOPMENT_GUIDELINES.md §8** rules each chunk relies on are cited inline below.

---

## 4. Per-chunk detail

### Chunk 1a — Sandbox 5-table subaccount FK migration

**Spec sections:** §8.1 (SANDBOX-ADV-1.2).

**Public interface this chunk exposes:** zero new app-level functions; DB constraint becomes load-bearing for every `sandbox_*` insert.

**What stays hidden:** migration internals — single SQL file containing five `ALTER TABLE ... ADD CONSTRAINT ... REFERENCES subaccounts(id)` statements.

**Files:**

- `migrations/0360_sandbox_subaccount_fks.sql` (new)
- `migrations/0360_sandbox_subaccount_fks.down.sql` (new)
- `server/db/schema/sandboxExecutions.ts` — add `.references(() => subaccounts.id)` on `subaccountId`
- `server/db/schema/sandboxLogs.ts` — same
- `server/db/schema/sandboxArtefacts.ts` — same
- `server/db/schema/sandboxTelemetryEvents.ts` — same
- `server/db/schema/sandboxEgressAudit.ts` — same

**Contracts:**

- SQL: 5 named constraints, one per table: `sandbox_executions_subaccount_id_fkey`, `sandbox_logs_subaccount_id_fkey`, `sandbox_artefacts_subaccount_id_fkey`, `sandbox_telemetry_events_subaccount_id_fkey`, `sandbox_egress_audit_subaccount_id_fkey`. All `REFERENCES subaccounts(id) ON DELETE RESTRICT`.
- Drizzle: each schema file's `subaccountId` column gains the `.references(() => subaccounts.id)` clause. Import added: `import { subaccounts } from './subaccounts.js';`.

**Error handling:** Migration may fail if any row carries a `subaccount_id` not present in `subaccounts(id)`. Pre-prod posture means zero such rows expected; if encountered, the migration error message names the offending table and row count. `.down.sql` drops the constraints.

**Tests:** none (schema-only chunk). Targeted Vitest is unnecessary — Drizzle types prove the wiring at compile time and the FK is enforced at the DB. Multi-tenant safety checklist §9: confirms each new FK respects `organisationId` boundary (the FK target `subaccounts.id` is org-scoped via existing `subaccounts.organisationId`).

**§8 rules cited:** §6.1 (append-only migration), §6.4 (Drizzle schema accompanies migration in same PR).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run db:generate` to verify the generated migration diff matches the handwritten SQL.

### Chunk 1b — Three column additions: credential_aliases, line CHECK, agent_runs.deleted_at

**Spec sections:** §6.3 (SANDBOX-ADV-6.1), §6.4 (REQ #6), §7.6 (REQ #35 schema prep).

**Public interface this chunk exposes:** three new columns visible to application code.

**What stays hidden:** migration internals.

**Files:**

- `migrations/0361_sandbox_credential_aliases.sql` (new) + `.down.sql`
- `migrations/0362_sandbox_logs_line_check.sql` (new) + `.down.sql`
- `migrations/0363_agent_runs_deleted_at.sql` (new) + `.down.sql`
- `server/db/schema/sandboxExecutions.ts` — add `credentialAliases: jsonb('credential_aliases').notNull().$type<string[]>().default([])`
- `server/db/schema/agentRuns.ts` — add `deletedAt: timestamp('deleted_at', { withTimezone: true })` and a partial index in the table-builder block

**Contracts:**

- `0361`: `ALTER TABLE sandbox_executions ADD COLUMN credential_aliases JSONB NOT NULL DEFAULT '[]'::jsonb;`
- `0362`: `ALTER TABLE sandbox_logs ADD CONSTRAINT sandbox_logs_line_max_length CHECK (char_length(line) <= 10000);`
- `0363`: `ALTER TABLE agent_runs ADD COLUMN deleted_at TIMESTAMPTZ; CREATE INDEX agent_runs_deleted_at_idx ON agent_runs (deleted_at) WHERE deleted_at IS NOT NULL;`

**Error handling:** `0362` may fail if any existing `sandbox_logs.line` row exceeds 10000 chars; pre-prod posture means none. Per §6.6 mitigation: the `0362.down.sql` drops the constraint; if the constraint addition fails, the data fix is a one-line `UPDATE sandbox_logs SET line = LEFT(line, 10000) WHERE char_length(line) > 10000;` operator runbook entry.

**Tests:** none (schema-only).

**§8 rules cited:** §6.1, §6.4.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run db:generate`.

### Chunk 2 — REQ #35 canonical soft-delete helper

**Spec sections:** §7.6 (REQ #35).

**Public interface this chunk exposes:**

```ts
export async function softDeleteAgentRun(input: {
  runId: string;
  organisationId: string;
  subaccountId: string;
}): Promise<{ deleted: boolean; reason?: 'not_found' | 'already_deleted' }>;
```

**What stays hidden:** the `UPDATE agent_runs SET deleted_at = NOW() WHERE id = ? AND organisation_id = ? AND deleted_at IS NULL` SQL; the `queueService.sendJob('sandbox-artefact-purge', ...)` call; the `rowCount === 1` assertion and the suppression-is-success conversion (§8.33).

**Files:**

- `server/services/agentRunSoftDeleteService.ts` (new)
- `server/services/__tests__/agentRunSoftDeleteServicePure.test.ts` (new) — pure test that mocks `db` and `queueService` and asserts on the call shapes
- `scripts/gates/verify-agent-runs-soft-delete-canonical.sh` (new, advisory) — greps for `update(agentRuns)` calls combined with `deletedAt` outside `agentRunSoftDeleteService.ts`

**Contracts:** as above. Service throws nothing under normal flow — returns `{ deleted: false, reason: 'already_deleted' \| 'not_found' }`. Re-throws on DB errors (raw FailureError).

**Error handling:**

- `rowCount === 0` → return `{ deleted: false, reason: 'already_deleted' }` if a row exists for `runId` but `deleted_at IS NOT NULL`; else `{ deleted: false, reason: 'not_found' }`. Suppression-is-success per §8.33.
- `rowCount > 1` (impossible given PK predicate) → throw with descriptive message.
- Purge-enqueue failure: log `logger.error('agent_run.soft_delete.purge_enqueue_failed', { runId, error })`, do NOT roll back the soft-delete. The daily sweep is the safety net.

**Tests (`agentRunSoftDeleteServicePure.test.ts`):**

- Mock-driven (no DB). Vitest. Imports `softDeleteAgentRun` and a mock `queueService`.
- Test 1: happy path — UPDATE returns rowCount 1, queueService.sendJob called with correct payload and `singletonKey: runId`.
- Test 2: already-deleted — UPDATE returns rowCount 0 + select returns row with deleted_at set → returns `{ deleted: false, reason: 'already_deleted' }`; sendJob NOT called.
- Test 3: not-found — UPDATE returns 0 + select returns empty → returns `{ deleted: false, reason: 'not_found' }`.
- Test 4: enqueue failure — sendJob throws, soft-delete still returns `{ deleted: true }`, `logger.error` called.

**Dependencies:** Chunk 1b (needs `agent_runs.deleted_at` column).

**§8 rules cited:** §8.10 (race-claim ordering — state write first, then external side effect), §8.33 (suppression-is-success), §8.35 (state-changing UPDATEs filter by org + status, assert rowCount===1), §8.36 (no empty catch).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/__tests__/agentRunSoftDeleteServicePure.test.ts`.

### Chunk 3 — Telemetry sequence allocator race fix

**Spec sections:** §6.2 (SANDBOX-ADV-3.1).

**Public interface this chunk exposes:** new pure helper consumed by two services.

```ts
// server/lib/sandboxTelemetrySequencePure.ts (new)
export async function allocateAndInsertTelemetryEvent(
  db: OrgScopedDb,
  rowToInsert: Omit<SandboxTelemetryEventInsert, 'sequence'>,
  opts?: { maxRetries?: number },
): Promise<{ sequence: number; inserted: boolean }>;
```

**What stays hidden:** the `pg_advisory_xact_lock(<bigint key derived from sandboxExecutionId>)` invocation; the retry-on-23505 loop with exponential backoff capped at 3 attempts; the conversion of `sandboxExecutionId` UUID → bigint key via Postgres `hashtext()`; the fail-loud-on-error-criticality path.

**Files:**

- `server/lib/sandboxTelemetrySequencePure.ts` (new) — pure helper (the "Pure" suffix is intentional; the function takes the `db` arg from the caller so the file itself has zero DB imports)
- `server/lib/__tests__/sandboxTelemetrySequencePure.test.ts` (new)
- `server/services/sandboxExecutionService.ts` — replace `_allocateTelemetrySequence` + `_writeTelemetryEvent` with calls to `allocateAndInsertTelemetryEvent`
- `server/services/sandboxHarvestService.ts` — replace `allocateTelemetrySequence` + `writeTelemetryEvent` similarly

**Contracts:**

- The helper internally uses `pg_advisory_xact_lock(hashtext(sandboxExecutionId)::bigint)` to serialise sequence allocation per-execution within a transaction, then INSERTs with `RETURNING sequence`. On 23505 race (impossible with the advisory lock but defended against): increment sequence + retry up to `maxRetries` (default 3). When all retries exhausted on an `error`-criticality event: throw `FailureError('sandbox_telemetry_drop')`. When all retries exhausted on `info` criticality: return `{ inserted: false }` and log warn — info-level events may be dropped per the existing posture, but `error` events must not.

**Error handling:** Distinguish `error` vs `info` criticality. The current code at `sandboxHarvestService.ts:122-134` silently swallows 23505 with `logger.warn` for all criticalities — the spec requires that `error` events never be silently dropped. Fail-loud path throws `FailureError('sandbox_telemetry_drop', { sandboxExecutionId, eventType, criticality })`.

**Tests (`sandboxTelemetrySequencePure.test.ts`):**

- Mock `db` with a queue-of-promises that simulates contention. Vitest.
- Test 1: single-writer path — returns sequence 1, then 2, then 3 in order.
- Test 2: concurrent-writers — 3 parallel calls all succeed, sequences are unique and contiguous (advisory lock serialises).
- Test 3: 23505 simulated once on info — returns `{ inserted: false }` after retry.
- Test 4: 23505 simulated repeatedly on error → throws `FailureError('sandbox_telemetry_drop')`.

**Dependencies:** None (the existing telemetry-events table is sufficient). Chunk 3 and Chunk 6 both edit `sandboxExecutionService.ts`; Chunk 3 lands first so Chunk 6 inherits the new write surface.

**§8 rules cited:** §8.10 (race-claim ordering), §8.19 (single shared `getErrorCode` helper for surfacing the 23505 code), §8.33 (`info` suppression-is-success).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/lib/__tests__/sandboxTelemetrySequencePure.test.ts`.

### Chunk 4 — Metering query pure helper

**Spec sections:** §6.5 (REQ #20).

**Public interface this chunk exposes:**

```ts
// server/services/sandboxMeteringQueryPure.ts (new)
export interface SandboxMinutesQueryInput {
  organisationId: string;
  subaccountId?: string;
  fromIso: string;
  toIso: string;
}
export interface SandboxMinutesQueryResult {
  scope: 'org' | 'subaccount';
  totalMinutes: number;
  byTemplate: Array<{ templateName: string; minutes: number }>;
}
export function buildOrgSandboxMinutesQuery(input: SandboxMinutesQueryInput): SqlFragment;
export function buildSubaccountSandboxMinutesQuery(input: SandboxMinutesQueryInput & { subaccountId: string }): SqlFragment;
export function rollupSandboxMinutes(rows: Array<{ templateName: string; wallClockMs: number }>): SandboxMinutesQueryResult;
```

**What stays hidden:** the SQL composition (`SELECT template_name, SUM(extract(epoch from terminated_at - started_at)) FROM sandbox_executions WHERE ...`), the per-template grouping, the time-bucket logic. Caller (a future service) invokes the helper, the service runs the query, the helper rolls up the rows.

**Files:**

- `server/services/sandboxMeteringQueryPure.ts` (new) — top-level placement matches sibling `sandboxHarvestServicePure.ts`. Per `verify-pure-helper-convention.sh`, the file must have zero transitive DB imports — it only builds and returns SQL fragments and runs the row-rollup.
- `server/services/__tests__/sandboxMeteringQueryPure.test.ts` (new)

**Contracts:** as above. The function signature spec §12.6 names `getOrgSandboxMinutes` / `getSubaccountSandboxMinutes` — we split into a "build query" + "rollup result" pair so the file stays pure. The caller (out of scope this build per spec §3 — metering route not in scope) wires the two.

**Error handling:** All inputs validated via Zod-like guard inside the helper; throws `Error('invalid_iso_window')` on malformed timestamps.

**Tests (`sandboxMeteringQueryPure.test.ts`):**

- Test 1: query builder produces the expected SQL fragment shape for org scope.
- Test 2: same for subaccount scope.
- Test 3: rollupSandboxMinutes correctly sums per-template wall-clock-ms → minutes.
- Test 4: empty input rows → totalMinutes=0, byTemplate=[].

**Dependencies:** none.

**§8 rules cited:** §8.21 (pure functions whose inputs may reorder are tested under input permutation — test 3 permutes the input array order across two runs).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/__tests__/sandboxMeteringQueryPure.test.ts`.

### Chunk 5 — Reconciliation hardening

**Spec sections:** §5.1 (SANDBOX-ADV-1.1 verify), §6.3 (SANDBOX-ADV-6.1), §8.6 (SANDBOX-R3-T1).

**Public interface this chunk exposes:** none new; existing handler keeps its export shape.

**What stays hidden:** internal change — replace hardcoded `credentialAliases: []` with read from `sandbox_executions.credential_aliases` column; replace `new Date()` with a SQL-driven now timestamp via `tx.execute(sql\`SELECT NOW() AS now\`)` returning the DB clock.

**Files:**

- `server/jobs/sandboxHarvestReconciliationJob.ts` — edit
- `server/jobs/__tests__/sandboxHarvestReconciliationJobShapePure.test.ts` (new — pure verification of the `StuckRow` projection and the new `credential_aliases` read)

**Contracts:**

- `StuckRow` interface gains `credential_aliases: string[]`.
- The SELECT at line 80-104 adds `credential_aliases` to the projection list.
- The call to `runHarvestReconciliation` at line 262-275 reads `credentialAliases: row.credential_aliases` (was `[]`).
- The `const now = new Date()` at line 73 becomes `const [{ now: dbNow }] = await tx.execute(sql\`SELECT NOW() AS now\`); const now = new Date(dbNow);` — keeps the wider code shape but anchors the timestamp DB-side.
- §5.1 SANDBOX-ADV-1.1 verification: the existing `withOrgTx` wrap at line 132-141 is already present from PR #287 fix-loop B3. The chunk includes a targeted test that proves the wrap is present (a positive assertion in the test, not a gate scan).

**Error handling:** unchanged.

**Tests (`sandboxHarvestReconciliationJobShapePure.test.ts`):**

- Test 1: assert the `StuckRow` shape includes `credential_aliases: string[]` field.
- Test 2: assert the `runHarvestReconciliation` call signature has `credentialAliases` sourced from the row, not a hardcoded literal.
- Test 3: assert the reconciliation function reads `now` via DB query rather than `new Date()` (static-source-string assertion or wrapper).

**Dependencies:** Chunk 1b (credential_aliases column).

**§8 rules cited:** KNOWLEDGE.md 2026-05-11 entry "DB-anchored elapsed time in correctness-sensitive paths" (canonical pattern for the `new Date()` → DB NOW migration).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/jobs/__tests__/sandboxHarvestReconciliationJobShapePure.test.ts`.

### Chunk 6 — Provider-start lifecycle hardening

**Spec sections:** §5.2 (SANDBOX-ADV-5.1), §6.1 (SANDBOX-ADV-2.1), §7.4 (REQ #31).

**Public interface this chunk exposes:**

- Optional `telemetryWriter` callback on `WithSandboxProviderOpts<T>` allowing the caller to thread DB writes through the wrapper.

**What stays hidden:** the enqueue order (monitor + kill BEFORE provider.runTask); the env-var → digest validation; the persistence-of-diagnostic-as-DB-row.

**Files:**

- `server/services/sandboxExecutionService.ts` — at line 467-469 (current TODO marker), insert `boss.send(SANDBOX_CEILING_MONITOR_JOB, {...})` and `boss.send(SANDBOX_WALL_CLOCK_KILL_JOB, {...})` calls before the synchronous `provider.runTask(input)`. State-claim-first per §8.10: the row's lease is already held (Case 1 INSERT completed) before enqueue.
- `server/services/executionBackends/ieeDevBackend.ts` — line 131: replace `process.env['SANDBOX_TEMPLATE_VERSION']` with a validated read against the parsed `parseCurrentVersion(...)` output from the template's `CURRENT_VERSION` file. The path: `templateVersionParserPure.parseCurrentVersion(readFileSync(...))` already exists; reuse.
- `server/lib/withSandboxProvider.ts` — extend `WithSandboxProviderOpts<T>` with `telemetryWriter?: (event: ProviderDiagnosticEvent) => Promise<void>`. Inside the wrapper, after every `logger.warn('sandbox.provider_diagnostic', ...)` call, also invoke `await opts.telemetryWriter?.(...)` if supplied.
- `server/services/__tests__/withSandboxProviderTelemetryWriterPure.test.ts` (new)

**Contracts:**

- `WithSandboxProviderOpts<T>` gains an optional `telemetryWriter` field.
- `ProviderDiagnosticEvent` type added: `{ subKind: 'slow_start' | 'rate_limit' | 'retry' | 'ambiguous_terminal'; attempt?: number; elapsedMs?: number; status?: number; code?: string; }`.
- Caller in `sandboxExecutionService._attemptProviderStart` supplies a `telemetryWriter` that calls into `allocateAndInsertTelemetryEvent` (from Chunk 3) using the row's tenancy context — the wrapper itself stays DB-agnostic.
- Caller in `sandboxHarvestService` (and `e2bSandbox.terminate*` call sites) does the same. When the wrapper is called pre-row (no execution row yet), `telemetryWriter` is undefined and we retain log-only behaviour.

**Error handling:** `telemetryWriter` errors are caught and logged at `logger.error('sandbox.provider_diagnostic.telemetry_write_failed', ...)`; they do not propagate (the diagnostic is observability, not correctness). §8.36 (no empty catch).

**Tests (`withSandboxProviderTelemetryWriterPure.test.ts`):**

- Test 1: callback invoked once per emitted diagnostic.
- Test 2: callback throws → wrapper does NOT throw; error logged.
- Test 3: callback undefined → behaviour identical to current state.
- Test 4: env-var template version validation in ieeDevBackend rejects unknown versions (this test goes in `server/services/executionBackends/__tests__/ieeDevBackendTemplateVersionPure.test.ts`, also authored here).

**Dependencies:** Chunk 3 (`allocateAndInsertTelemetryEvent` helper for the row-context writer).

**§8 rules cited:** §8.10 (state-claim-first ordering — enqueue monitors only after lease held), §8.15 (cross-path lifecycle hooks — monitor enqueue fires on every start path), §8.20 (deferred enforcement observability log — the `telemetryWriter` adds the missing DB row at the same boundary the log already emits).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/__tests__/withSandboxProviderTelemetryWriterPure.test.ts server/services/executionBackends/__tests__/ieeDevBackendTemplateVersionPure.test.ts`.

### Chunk 7 — Ceiling-monitor + wall-clock-kill provider terminate

**Spec sections:** §7.5 (REQ #36).

**Public interface this chunk exposes:** new `terminate` method on the `SandboxExecutionService` interface.

**What stays hidden:** the addition of `provider.terminate(providerSandboxId)` calls before the existing row-status flip.

**Files:**

- `server/jobs/sandboxCeilingMonitorJob.ts` — inside `applyCeilingTransition`, before the `db.update(...).set({ status: 'harvesting', ... })` call, invoke `await provider.terminate(row.providerSandboxId)` (via `withSandboxProvider({ phase: 'terminal', ... })`). Resolved provider via the same `_provider` singleton pattern as `sandboxExecutionService`.
- `server/jobs/sandboxWallClockKillJob.ts` — same: call `provider.terminate` before the DB UPDATE.
- `server/services/sandbox/sandboxProviderResolver.ts` — extend the `SandboxExecutionService` interface to include `terminate(providerSandboxId: string): Promise<void>` (currently absent — `e2bSandbox.terminateSandbox` exists on the SDK client but the service interface doesn't expose it).
- `server/jobs/__tests__/sandboxCeilingMonitorJobTerminatePure.test.ts` (new) — mock provider, assert `terminate` is called before the DB row update on both the harvesting and start_failed transitions.

**Contracts:** `SandboxExecutionService.terminate(providerSandboxId: string): Promise<void>` — idempotent (no-op if already closed). All three providers (e2b, local_docker, inline) implement this; e2b already has `terminateSandbox` internal, just exposed on the interface.

**Error handling:** terminate failure is non-fatal — log `logger.warn('sandbox.ceiling_monitor.provider_terminate_failed', { sandboxExecutionId, error })` and proceed with the DB UPDATE. The provider may already have closed the sandbox.

**Tests (`sandboxCeilingMonitorJobTerminatePure.test.ts`, `sandboxWallClockKillJobTerminatePure.test.ts`):**

- Test 1: ceiling tripped → terminate called → DB row flipped.
- Test 2: terminate throws → DB row still flipped; warn logged.
- Test 3: wall-clock-kill same pattern.

**Dependencies:** Chunk 6 (extended `WithSandboxProviderOpts` for diagnostics threading — the terminate call inside the monitor benefits from the same `telemetryWriter` capability).

**§8 rules cited:** §8.10 (state-claim-first — but here the order is "external action first, then state write" because terminating the provider is the precondition for safely flipping to harvesting; this is acceptable because the side effect is idempotent and the DB write is the source of truth).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/jobs/__tests__/sandboxCeilingMonitorJobTerminatePure.test.ts server/jobs/__tests__/sandboxWallClockKillJobTerminatePure.test.ts`.

### Chunk 8 — Inline-sandbox env-injection guard

**Spec sections:** §8.2 (SANDBOX-ADV-2.2).

**Public interface this chunk exposes:** narrowed function signatures.

**What stays hidden:** the resolver's removal of caller-supplied `env`; the `InlineSandbox.constructor` reading `process.env` directly.

**Files:**

- `server/services/sandbox/sandboxProviderResolver.ts` — remove the `env: Record<string, string | undefined> = process.env` parameter. Function reads `process.env` directly. Production callers already pass nothing (verified via grep); tests use `vi.stubEnv`.
- `server/services/sandbox/inlineSandbox.ts` — remove the constructor's `env` parameter; read `process.env` directly.
- `server/services/sandbox/__tests__/sandboxProviderResolverEnvInjectionPure.test.ts` (new) — assert that a forged-env object passed positionally is no longer accepted (compile-time TypeScript rejection counts; runtime guard reinforces).
- `server/services/sandbox/__tests__/sandboxProviderResolverPure.test.ts` — migrate the existing 22-case suite to `vi.stubEnv` for the test paths that currently pass synthetic env positionally.

**Contracts:**

- Before: `resolveSandboxProvider(env?: Record<string, string \| undefined>): SandboxExecutionService`
- After: `resolveSandboxProvider(): SandboxExecutionService` — reads `process.env` directly.
- Before: `new InlineSandbox(env?: Record<string, string \| undefined>)`
- After: `new InlineSandbox()` — reads `process.env` directly.

**Error handling:** unchanged guard semantics; the boot-time `FailureError` throws on misconfiguration are preserved.

**Tests (`sandboxProviderResolverEnvInjectionPure.test.ts`):**

- Test 1: with `NODE_ENV=test` + `SANDBOX_ALLOW_INLINE=1` via `vi.stubEnv`, resolveSandboxProvider returns `InlineSandbox`.
- Test 2: with `NODE_ENV=production`, resolveSandboxProvider throws on `SANDBOX_PROVIDER=inline`.
- Test 3: regression — a forged `env` cannot be supplied as a positional arg (TypeScript compile-time check; not a runtime test).

**Dependencies:** Inspect `server/services/sandbox/__tests__/sandboxProviderResolverPure.test.ts` (22-case existing suite per handoff). Migrate every call site that passed `env` positionally to use `vi.stubEnv`. Update the test file in the same chunk.

**§8 rules cited:** §8.2 (no drive-by cleanup — this is the chunk for env-bypass; the test-file migration is in-scope because the test surface IS the call surface being narrowed).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/sandbox/__tests__/sandboxProviderResolverEnvInjectionPure.test.ts server/services/sandbox/__tests__/sandboxProviderResolverPure.test.ts`.

### Chunk 9 — Credential-leak case-insensitive verification + targeted Vitest

**Spec sections:** §5.3 (SANDBOX-ADV-4.1).

**Public interface this chunk exposes:** new pure predicate.

```ts
// server/services/sandbox/credentialLeakFilenameGuardPure.ts (new)
export function isCredentialLeakFilename(filename: string): boolean;
```

**What stays hidden:** the fix landed in PR #287 fix-loop B5 (commit `c5167bc5`). `sandboxHarvestService.ts:448-465` already normalises filenames via `toLowerCase()` + backslash + double-slash collapse before testing membership in `'/workspace/secrets/'` and `'secrets/'` and `'..'`. Chunk 9 extracts that inline check into a pure helper so a targeted Vitest can exercise it directly.

**Files:**

- `server/services/sandbox/credentialLeakFilenameGuardPure.ts` (new)
- `server/services/sandboxHarvestService.ts` — replace inline normalisation at line 448-465 with `isCredentialLeakFilename(entry.filename)`
- `server/services/sandbox/__tests__/credentialLeakFilenameGuardPure.test.ts` (new)

**Contracts:** `isCredentialLeakFilename(filename)` returns `true` if `filename` (after lowercasing + slash normalisation) contains `/workspace/secrets/`, begins with `secrets/`, or contains `..`. Otherwise `false`. Inline call at the harvest step short-circuits with `artefact_upload_failed` + telemetry on `true`.

**Error handling:** none — pure predicate, returns boolean.

**Tests (`credentialLeakFilenameGuardPure.test.ts`):**

- Test 1: `'/workspace/secrets/x.token'` → true.
- Test 2: `'/workspace/Secrets/x.token'` → true (case bypass blocked).
- Test 3: `'/WORKSPACE/SECRETS/x.token'` → true (full-upper bypass blocked).
- Test 4: `'\\workspace\\secrets\\x.token'` → true (backslash normalised).
- Test 5: `'/workspace//secrets/x.token'` → true (double-slash normalised).
- Test 6: `'/workspace/artefacts/foo.txt'` → false (innocuous file).
- Test 7: `'../../etc/passwd'` → true (path-traversal pattern).

**Dependencies:** none.

**§8 rules cited:** §8.21 (input-permutation test — Test 3 permutes uppercase positions).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/sandbox/__tests__/credentialLeakFilenameGuardPure.test.ts`.

### Chunk 10 — S3 path-traversal sanitisation

**Spec sections:** §8.4 (SANDBOX-ADV-4.2).

**Public interface this chunk exposes:**

```ts
// server/services/sandbox/artefactFilenameSanitiserPure.ts (new)
export type SanitisedFilename =
  | { ok: true; sanitisedName: string }
  | { ok: false; reason: 'contains_path_traversal' | 'absolute_path' | 'disallowed_chars' | 'empty' };
export function sanitiseArtefactFilename(raw: string): SanitisedFilename;
```

**What stays hidden:** the allow-list of characters (alphanum + `.` + `-` + `_` + space); the `..` detection; the leading-slash rejection.

**Files:**

- `server/services/sandbox/artefactFilenameSanitiserPure.ts` (new)
- `server/services/sandboxHarvestService.ts` — in step 6 artefact enumeration after the credential-leak filter, call `sanitiseArtefactFilename(entry.filename)`. On `ok: false`, emit `writeTelemetryEvent(ctx, 'artefact_upload_failed', 'error', { filename, reason })` and return `artefact_upload_failed`.
- `server/services/sandbox/__tests__/artefactFilenameSanitiserPure.test.ts` (new)

**Contracts:** as above.

**Error handling:** sanitiser is pure — returns discriminated union. Caller emits the telemetry and short-circuits the harvest step.

**Tests (`artefactFilenameSanitiserPure.test.ts`):**

- Test 1: `'report.pdf'` → `ok: true, sanitisedName: 'report.pdf'`.
- Test 2: `'../etc/passwd'` → `ok: false, reason: 'contains_path_traversal'`.
- Test 3: `'/abs/path.txt'` → `ok: false, reason: 'absolute_path'`.
- Test 4: `''` → `ok: false, reason: 'empty'`.
- Test 5: `'file with space.txt'` → `ok: true` (spaces allowed, consistent with S3 keys); control chars rejected via `disallowed_chars`.
- Test 6: `'foo/bar.txt'` → `ok: false, reason: 'contains_path_traversal'` (the harvest pipeline does not allow nested paths under `/workspace/artefacts/`).

**Dependencies:** Chunk 9 (the credential-leak filter runs first; this is the second-pass filename guard).

**§8 rules cited:** §8.21 (permutation tests for the discriminated-union mapping).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/sandbox/__tests__/artefactFilenameSanitiserPure.test.ts`.

### Chunk 11 — Per-tenant log-storage quota

**Spec sections:** §8.5 (SANDBOX-ADV-5.2).

**Public interface this chunk exposes:**

```ts
// server/services/sandbox/logStorageQuotaPure.ts (new)
export interface LogQuotaCheckInput {
  organisationId: string;
  todayBytesAlreadyPersisted: number;
  thisBatchBytes: number;
}
export interface LogQuotaCheckResult {
  allowed: boolean;
  capBytes: number;
  exceededBy?: number;
}
export function checkLogStorageQuota(input: LogQuotaCheckInput): LogQuotaCheckResult;
export const MAX_LOG_BYTES_PER_ORG_PER_DAY: number; // 100 * 1024 * 1024
```

**What stays hidden:** the constant definition in `server/lib/sandboxRetentionConstants.ts`; the today-bucket boundary (UTC midnight).

**Files:**

- `server/lib/sandboxRetentionConstants.ts` — append `MAX_LOG_BYTES_PER_ORG_PER_DAY` constant
- `server/services/sandbox/logStorageQuotaPure.ts` (new)
- `server/services/sandboxHarvestService.ts` — inside step 9 (log persistence), before INSERT, run a SUM query against `sandbox_logs` for today (`persisted_at >= date_trunc('day', NOW())`) for this `organisationId` → pass result to `checkLogStorageQuota` → reject with `harvest_failed` + `criticality: 'error'` telemetry if `!allowed`
- `server/services/sandbox/__tests__/logStorageQuotaPure.test.ts` (new)

**Contracts:** as above. Caller responsible for querying today's persisted total; helper does pure arithmetic.

**Error handling:** quota exceeded → emit `writeTelemetryEvent(ctx, 'artefact_upload_failed', 'error', { reason: 'log_quota_exceeded', capBytes, exceededBy })`. (We reuse the existing `artefact_upload_failed` event type rather than adding a new `log_quota_exceeded` enum value — adding a new event-type kind would require a schema migration that Chunk 1b would have to land retroactively, and §8.13 requires the kind + validator update in the same commit. V2 follow-up can add a dedicated `log_quota_exceeded` enum value.)

**Tests (`logStorageQuotaPure.test.ts`):**

- Test 1: `todayBytes=0, batchBytes=1MB, cap=100MB` → allowed.
- Test 2: `todayBytes=99MB, batchBytes=2MB, cap=100MB` → not allowed, exceededBy=1MB.
- Test 3: edge — `todayBytes=cap, batchBytes=0` → allowed (boundary check).

**Dependencies:** none. Stand-alone.

**§8 rules cited:** §8.13 (discriminated-union validator — deferred decision logged inline; new enum value defers to v2), §8.24 (no module-level in-process cache here).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/sandbox/__tests__/logStorageQuotaPure.test.ts`.

### Chunk 12 — Sandbox teardown verification

**Spec sections:** §7.7 (REQ #55).

**Public interface this chunk exposes:**

```ts
// server/services/sandbox/teardownVerifierPure.ts (new)
export interface TeardownVerificationInput {
  providerSandboxId: string;
  postTerminateHealthCheck: () => Promise<boolean>;
}
export interface TeardownVerificationResult {
  verified: boolean;
  reason?: 'health_check_returned_true' | 'health_check_threw';
}
export async function verifyTeardown(input: TeardownVerificationInput): Promise<TeardownVerificationResult>;
```

**What stays hidden:** the post-terminate health check call; the structured log emission; the operator-page hook (which lands as a `logger.error('sandbox.teardown.unverified', ...)` — operator paging configured separately at the logger sink).

**Files:**

- `server/services/sandbox/teardownVerifierPure.ts` (new) — pure (takes a callback)
- `server/services/sandbox/e2bSandbox.ts` — at line 378-388, after the terminate, call `verifyTeardown({ providerSandboxId, postTerminateHealthCheck: () => this.sdkClient.isSandboxAlive(providerSandboxId) })`. If `verified === false`: emit `logger.error('sandbox.teardown.unverified', { ... })` + write a DB telemetry event via the harvest service if context is available. If verified: emit `logger.info('sandbox.teardown.verified', { ... })`.
- `server/services/sandbox/__tests__/teardownVerifierPure.test.ts` (new)

**Contracts:** as above. The pure helper takes the health-check callback so the file has zero provider-SDK imports.

**Error handling:** health-check throws → returns `{ verified: false, reason: 'health_check_threw' }`. Health-check returns true (sandbox still alive after terminate) → `{ verified: false, reason: 'health_check_returned_true' }`. Health-check returns false → `{ verified: true }`.

**Tests (`teardownVerifierPure.test.ts`):**

- Test 1: health-check returns false → verified.
- Test 2: health-check returns true → not verified, reason set.
- Test 3: health-check throws → not verified, reason set.

**Dependencies:** Chunk 7 (the `terminate()` method exposed on the provider interface).

**§8 rules cited:** §8.20 (deferred enforcement observability log at the same boundary), §8.31 (non-durable async operations — the operator-paging via logger.error is observability, not durable; comment in code explains residual risk).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/sandbox/__tests__/teardownVerifierPure.test.ts`.

### Chunk 13 — Provider-success vs ceiling-monitor race

**Spec sections:** §8.3 (SANDBOX-ADV-3.2).

**Public interface this chunk exposes:**

```ts
// server/jobs/ceilingMonitorRaceDecisionPure.ts (new)
export function decideCeilingVsProviderRaceOutcome(input: {
  rowStatusAtMonitorTick: SandboxExecutionStatus;
  providerOutputAvailable: boolean;
  monitorClaimedFirst: boolean;
}): { winner: 'provider' | 'monitor' | 'tied'; rationale: string };
```

**What stays hidden:** the rule "provider-result-wins" semantics — when the monitor and the provider both reach for the terminal-write, the provider's terminal output takes precedence because it carries the canonical metrics + cost. The decision function is a pure mapping consumed by the monitor's `applyCeilingTransition`.

**Files:**

- `server/jobs/ceilingMonitorRaceDecisionPure.ts` (new)
- `server/jobs/sandboxCeilingMonitorJob.ts` — at line 220-243, before the `db.update(... status: 'harvesting' ...)` re-read the row's `status` (it may already be `harvesting` from the provider path); call the decision function; if `winner === 'provider'`, log `sandbox.ceiling_monitor.lost_race_to_provider` and return without UPDATE (suppression-is-success per §8.33).
- `server/jobs/__tests__/ceilingMonitorRaceDecisionPure.test.ts` (new)

**Contracts:** as above.

**Error handling:** suppression-is-success per §8.33 when the monitor loses the race.

**Tests (`ceilingMonitorRaceDecisionPure.test.ts`):**

- Test 1: monitor ticks first, provider not done → `winner: 'monitor'`.
- Test 2: provider done before monitor → `winner: 'provider'`.
- Test 3: tied (both observe `harvesting` simultaneously) → `winner: 'tied'`; conservative resolution names provider.

**Dependencies:** Chunk 6 (monitor enqueue), Chunk 7 (monitor terminate path).

**§8 rules cited:** §8.10 (race-claim ordering), §8.33 (suppression-is-success — the monitor's "I lost" path returns success not failure).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/jobs/__tests__/ceilingMonitorRaceDecisionPure.test.ts`.

### Chunk 14 — REQ #57 v2-deferred decision + REQ #11/#28/#29 acceptance verification

**Spec sections:** §6.6 (REQ #57), §7.1 (REQ #11), §7.2 (REQ #28), §7.3 (REQ #29).

**Public interface this chunk exposes:** none — docs only.

**What stays hidden:** all four items are decided or verified.

**Files:**

- `tasks/builds/sandbox-safety-batch/req-57-decision.md` (new) — one-page rationale: REQ #57 is v2-deferred. The e2b SDK is not installed in V1 (per `SANDBOX-DEF-EGRESS-MECH`). The current stub at `e2bSandbox.ts:258-265` declares the file-mount intent. Threading the credential value requires the SDK's file-write API which is not available in the interface-stubbed mode. The credential broker (Spec C `operator-session-identity`) is the upstream issuer; integration lands when the SDK lands.
- `tasks/builds/sandbox-safety-batch/req-11-28-29-acceptance.md` (new) — three-paragraph acceptance note quoting the relevant lines from spec-conformance Round 2 log (already CONFORMANT_AFTER_FIXES). No code change.
- `tasks/todo.md` — append `REQ #57: deferred-to-v2 (waits on e2b SDK install per SANDBOX-DEF-EGRESS-MECH)` row under "Deferred from sandbox-isolation review — v2-backlog".

**Contracts:** docs only.

**Error handling:** n/a.

**Tests:** none.

**Dependencies:** none — final chunk.

**§8 rules cited:** §8.16 (allow-list discipline — every deferral cites a linked invariant ID).

**Verification commands:** `npm run lint` (catches markdown lint if configured; otherwise no-op).

---

## 5. Risks and mitigations (summary)

Tabulated in detail in **§2.5 of Architecture notes**. Medium-severity risks ≥3:

- **R1** — telemetry sequence allocator regression risk → advisory-lock approach with retry, targeted Vitest for concurrent writers.
- **R2** — withSandboxProvider DB-coupling risk → optional `telemetryWriter` callback, caller supplies context.
- **R4** — inline-sandbox env-removal breaks 22-case test suite → migrate tests to `vi.stubEnv` in same chunk.
- **R5** — log-storage quota with no operator-facing tunable → constant in `sandboxRetentionConstants.ts`; env-tunable in v2.
- **R6** — REQ #57 v2-deferred → documented; `SANDBOX-DEF-EGRESS-MECH` already gates the SDK install.
- **R7** — Chunk 6 monitor-enqueue collides with SANDBOX-B4 synchronous provider limitation → enqueue happens pre-call; monitor's self-re-enqueue cadence covers the in-flight window.
- **R9** — adding `deleted_at` to `agent_runs` regresses queries → zero callers today; canonical helper is the future-only writer; doc-sync gate enforces.

---

## 6. Executor notes

Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.

Operator standing rule (current memory): test execution during dev is skipped — typecheck only; test files are still authored. CI runs the suite. The plan reflects this: every chunk's "Verification commands" section lists only `npm run lint` + `npm run typecheck` (plus `npm run db:generate` for migration chunks); targeted Vitest paths are documented for executor inspection but not invoked locally.

---

## 7. Self-consistency pass

- **Goal vs implementation**: Every spec item from §5, §6, §7, §8 maps to exactly one chunk. Items already addressed in upstream PR #287 fix-loop (REQ #11, #28, #29, partially SANDBOX-ADV-4.1, partially SANDBOX-ADV-1.1) are verified — not re-implemented — in Chunks 9 and 14 with targeted Vitest authored to lock the existing fix in place.
- **Forward-only dependencies**: 1a/1b → 2; 1b → 5; 3 → 6; 6 → 7; 7 → 12, 13; 9 → 10. No cycles.
- **Single source of truth**: The canonical soft-delete helper in Chunk 2 is the only place `agent_runs.deleted_at` is written; the verify gate enforces. The telemetry sequence allocator in Chunk 3 is the only allocator; both callers (execution + harvest) migrate to it.
- **§8 rules applied**: §8.2, §8.10, §8.13, §8.15, §8.16, §8.19, §8.20, §8.21, §8.31, §8.33, §8.35, §8.36, §6.1, §6.4 cited inline.
- **Prose vs execution model**: Plan does not introduce a new state machine — it shores up the existing sandbox lifecycle. State/Lifecycle section therefore not added per §8.7 ("any spec that introduces or modifies a state machine ...").
