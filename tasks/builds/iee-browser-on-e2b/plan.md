# Implementation Plan — iee-browser-on-e2b

**Status:** LOCKED — accepted 2026-05-13 after 2 ChatGPT plan-review rounds (R1: 7 findings applied / 1 rejected on data; R2: 3 findings applied; final verdict APPROVED WITH ONE FIX)
**Plan date:** 2026-05-13
**Build slug:** `iee-browser-on-e2b`
**Branch:** `claude/migrate-browser-e2b-snI99`
**Spec:** `tasks/builds/iee-browser-on-e2b/spec.md` (LOCKED, accepted 2026-05-13 — 26 chatgpt-spec-review findings applied across 4 rounds [R1: 12 + R2: 7 + R3: 6 + R4: 1 = 26], final verdict APPROVED)
**Handoff:** `tasks/builds/iee-browser-on-e2b/handoff.md`
**Scope class:** Major (new subsystem, cross-cutting, architectural)
**Predecessors merged:** Spec A (#281), Spec B (#287), Spec D (#288)

## Table of contents

1. Model-collapse check
2. Architecture notes
3. System invariants (load-bearing across the build)
4. Stepwise implementation plan — 19 chunks (overview)
5. Per-chunk detail
   - Chunk 1 — `iee_browser_session_profiles` schema + migration 0346 + RLS
   - Chunk 2 — `subaccount_iee_browser_settings` schema + migration 0347 + RLS
   - Chunk 3 — `llm_requests` columns `subtype` + `warm_session_id` + CHECKs (migration 0348)
   - Chunk 4 — `browser_warm_sessions` schema + migration 0349 + RLS + shared-type extensions
   - Chunk 5 — FK on `llm_requests.warm_session_id` + unique partial index (migration 0350)
   - Chunk 6 — Sandbox template `iee-browser` (image + harness entrypoint)
   - Chunk 7 — e2b provider browser-class wiring
   - Chunk 8 — `playwrightContext.ts` sandbox-path resolution edit
   - Chunk 9 — `ieeBrowserProfileManager` service + named CI plan-gate
   - Chunk 10 — `browserWarmPool` service
   - Chunk 11 — Sandbox harvest cost-row subtype discriminator
   - Chunk 12 — IEE-browser dispatch wiring in `_ieeShared.ts`
   - Chunk 13 — Settings service + HTTP routes + admin rollout + client API
   - Chunk 14 — Operator-backend defaults module
   - Chunk 15A — Alarm event registration + pure evaluator + per-task inline alarm
   - Chunk 15B — End-of-day pg-boss rollup cron
   - Chunk 16 — UI: Operator settings tab + role predicate + tab pill
   - Chunk 17 — DigitalOcean retirement + `verify-no-do-references.sh` CI gate
   - Chunk 18 — Doc-sync + placeholder cost-report + calendar todo
6. Risks & mitigations
7. Self-consistency pass
8. Open lookups for Phase 2 / executor
9. Executor notes

---

## 1. Model-collapse check

**Question 1 — Does this feature decompose into ingest → extract → transform → render?**
No. This is a substrate redirect: the existing IEE browser executor (Playwright code in `worker/src/browser/`) is preserved byte-identical and re-targeted from a DigitalOcean VPS to an e2b sandbox. The work is plumbing, schema, lifecycle services, settings UI, and a CI retirement gate. There is no LLM extraction step in the new code surface.

**Question 2 — Is each step doing something a frontier multimodal model could do in a single call?**
No. The steps are deterministic IO: provision a sandbox volume, mount it, run Playwright, harvest profile, write a cost row, evict a warm session. No reasoning step, no judgement call, no document → schema extraction. The existing Playwright executor already does the agentic browser work and is out of scope.

**Question 3 — Can the whole pipeline collapse into one model call with a structured-output schema?**
No. **Reject collapse: rationale.** This build is substrate plumbing for an agentic browser executor that already exists. The runtime decisions a frontier model can collapse (parse a page, decide a click target, classify a failure) are still performed by the existing `worker/src/browser/` code (executor, contractEnforcedPage, observe, login, artifactValidator) which this spec explicitly preserves byte-identical. Collapsing the plumbing (warm-pool checkout, volume mount, cost-row write, kill-switch read) into a model call is a category error — these are correctness operations with DB unique constraints, FK invariants, RLS guards, and audit trails, where determinism and audit are the value.

**Decision recorded.** Proceed with the multi-chunk plumbing plan below.

---

## 2. Architecture notes

### Key decisions

1. **Reuse `SandboxExecutionService` (Spec B) rather than build a parallel sandbox client.** The interface already accepts `sandboxRequirement: 'browser'` (Spec A adapter contract). The e2b provider implementation at `server/services/sandbox/e2bSandbox.ts` is extended to branch on requirement and resolve template `iee-browser`. Rejected: a dedicated `browserSandboxService` (would duplicate the start-claim lease, harvest pipeline, template-version-coherence machinery already in Spec B).

2. **Three sibling tables, not extensions.** `iee_browser_session_profiles`, `subaccount_iee_browser_settings`, `browser_warm_sessions` are siblings of `operator_task_profiles` / `subaccount_operator_settings` rather than columns on existing tables. Rejected extension because keying shapes differ: many tasks share one profile here, one profile per task attempt there; warm sessions are per-subaccount audit rows with their own lifecycle.

3. **DB-enforced V1 invariants, not service-layer assertions.** Warm-pool size 1 per subaccount enforced via `UNIQUE INDEX browser_warm_sessions(subaccount_id) WHERE status='available'`. Idle-cost-row idempotency enforced via `UNIQUE INDEX llm_requests(warm_session_id) WHERE subtype='warm_pool'`. CHECK constraints null-safe via `IS DISTINCT FROM`. Service code cannot regress these invariants.

4. **FK `ON DELETE RESTRICT`, not `SET NULL`.** `llm_requests.warm_session_id → browser_warm_sessions(id) RESTRICT`. The service contract says rows are never deleted; the FK action surfaces accidental DELETE attempts as a constraint violation rather than silently nulling out idempotency-bearing data. Defensive, not load-bearing.

5. **Migration 0350 split from 0348.** Adding the FK to `llm_requests.warm_session_id` requires `browser_warm_sessions` to exist (migration 0349). The plan ships 0348 (columns + CHECKs only, no FK), then 0349 (table), then 0350 (FK + unique partial index). This is the locked ordering from spec §7.2. (Note: this spec originally reserved 0343–0347; renumbered to 0345–0349 in the 2026-05-13 S1 sync after PR #296 shipped 0343 + 0344 on main, then renumbered again to 0346–0350 in the 2026-05-14 S2 sync after PR #298 shipped `0345_memory_utility_30d`. Ordering invariant is preserved across both shifts.)

6. **Lease-then-tear-down warm-pool, no V1 reuse.** A leased warm session transitions `available → leased → terminated` after the task completes. No `leased → available` return path. Idle-cost row is emitted at exactly one point per warm session (teardown), keyed on `warmSessionId` for idempotency.

7. **Single named CI plan-gate (`ieeBrowserProfileManager.serialization.test.ts`) gates chunk 9.** Chunk 9 (profile manager) does not ship until this CI test confirms the e2b provider implementation honours Spec B's per-volume single-mount invariant. The test issues two concurrent `runTask` calls against the same `(org, subaccount, session_key)` profile volume and asserts provider-layer blocking + strictly serialised mount-event ordering.

8. **ETag PATCH semantics on both settings and rollout-approval.** `subaccount_iee_browser_settings.settings_version` is the ETag for both `PATCH /api/subaccounts/:id/iee-browser-settings` and `POST /api/admin/iee-browser/rollout-approval/:subaccountId`. Concurrent admins racing to flip rollout status hit HTTP 409 first-commit-wins.

9. **Pure / IO service split where logic is testable.** `subaccountIeeBrowserSettingsServicePure.ts` carries the validation predicates, defaults, ETag-conflict detection, and audit-row builder; `subaccountIeeBrowserSettingsService.ts` carries the DB IO. Same pattern as `subaccountOperatorSettingsService(Pure)`. Pure modules host any unit tests authored in this build.

10. **Chunk 17 (DO retirement) is the only one-way door.** All runtime chunks (1–16) ship first; the `verify-no-do-references.sh` CI gate lands in chunk 17 immediately after the deletes. If any prior chunk needs to be backed out, that is reversible. Deleting `worker/Dockerfile` and the VPS handlers is not.

### Patterns applied

- **Adapter pattern** — `_ieeShared.ts::ieeDispatch` is the existing adapter; the new browser branch sits inside it, delegating volume mount to `ieeBrowserProfileManager` and warm-session checkout to `browserWarmPool`. No new abstraction layer introduced.
- **Single responsibility** — each new service owns one concern: `browserWarmPool` (warm-session lifecycle), `ieeBrowserProfileManager` (volume lifecycle), `operatorSettingsDefaults` (the three constants).
- **Composition over inheritance** — `_ieeShared.ts::ieeDispatch` composes the launch-flag read + warm-pool checkout + profile mount + runTask. No new class hierarchy.

### Patterns rejected

- **No prompt-partition or LLM-routing changes.** This build does not touch prompt assembly or model routing.
- **No new pg-boss queue.** Profile GC reuses pg-boss daily cron; per-day cost-alarm evaluation reuses pg-boss end-of-day cron. Existing `iee-run-completed` queue handles task dispatch unchanged.
- **No new auth layer.** Admin rollout route reuses `requireRole('system_admin')`; settings GET/PATCH reuses the operator-settings permission split (`operator_settings.read` / `operator_settings.write`) + `resolveSubaccount`.

---

## 3. System invariants (load-bearing across the build)

The chunks below depend on these invariants holding across every chunk. Any violation is a blocker.

1. **Per-volume single-mount (Spec B).** A profile volume cannot be mounted to two concurrently-live sandboxes. The e2b provider implementation enforces this at the provider layer. Verified by the named CI gate `serialization.test.ts` before chunk 9 ships.
2. **`browser_warm_sessions` rows are never deleted.** State-transition only (`available → leased → terminated`). FK uses `ON DELETE RESTRICT` to surface contract violations.
3. **`subtype` and `warm_session_id` on `llm_requests` are null when `source_type != 'sandbox_compute'`.** Enforced by CHECK constraints null-safe via `IS DISTINCT FROM`.
4. **One available warm session per subaccount maximum.** Enforced by `UNIQUE INDEX browser_warm_sessions(subaccount_id) WHERE status='available'`. Two concurrent refills race; the loser gets `23505` and treats it as "another worker already refilled" (no error surface).
5. **One idle-cost row per warm session maximum.** Enforced by `UNIQUE INDEX llm_requests(warm_session_id) WHERE subtype='warm_pool'`. Re-runs of teardown are no-ops.
6. **Status default = `'off'` for `subaccount_iee_browser_settings`.** Migration 0347 sets DEFAULT 'off'. No mass-enable on backfill (brief §3.5 v7 invariant).
7. **RLS dual-GUC.** All three new tables use dual-GUC RLS (`app.organisation_id` + `app.subaccount_id` checks via `setOrgAndSubaccountGUC`). Subaccount filtering is enforced by RLS, not service code.
8. **No cross-tenant mount.** `ieeBrowserProfileManager.mount` asserts the task's `(org, subaccount)` matches the profile row's `(org, subaccount)` before the volume mounts. `session_key` is never sufficient alone to authorise a mount.
9. **Migration ordering 0346 → 0347 → 0348 → 0349 → 0350.** Forward-only. 0348 adds columns without FK; 0349 creates the FK target; 0350 adds FK + unique partial index.
10. **DO retirement is one-way.** Chunk 17 deletes 6 worker files + `worker/Dockerfile`; the `verify-no-do-references.sh` CI gate locks the absence.

---

## 4. Stepwise implementation plan — 19 chunks (overview)

The spec proposes 16 chunks in §6. This plan refines that into 19 builder-sized units. The three splits:

- Spec chunk 1 (schema migrations + RLS manifest entries) splits into 5 chunks (one per migration), respecting the locked migration ordering.
- Spec chunks 6 (sandbox harness) + 7 (`playwrightContext.ts` edit) are kept separate because the harness work lives in `infra/sandbox-templates/iee-browser/` (deployed image) while the path-resolution edit lives in `worker/src/browser/` (existing tree). Same release dependency, different repo zones.
- Spec chunk 15 (alarm wiring) splits into 15A (event registration + pure evaluator + per-task inline alarm at harvest) and 15B (end-of-day pg-boss rollup cron) so the cron-handler path lookup (which crosses `server/jobs/`) does not block the inline harvest-path alarm wiring. Reduces blast radius if either path takes longer than expected.

Forward-only dependency graph (no backward references):

```
 1 → 2 → 3 → 4 → 5
 6 ──────────────► 7 → 8
 1, 7 ─────────► 9 (plan-gated by serialization.test.ts)
 4, 7 ─────────► 10
 3, 5 ─────────► 11
 2, 9, 10, 11 ─► 12
 2 ───────────► 13
 2 ───────────► 14
 11, 2 ───────► 15A (event registration + per-task inline alarm)
 15A ─────────► 15B (end-of-day rollup cron)
 13 ──────────► 16
 1..16 ───────► 17 (one-way: DO retirement)
 17 ──────────► 18 (doc-sync, placeholder, todo)
```

Chunk naming honours the spec's chunk-order intent but applies the splits above. Counts: 5 schema chunks (1–5), 3 substrate chunks (6–8), 2 service chunks (9–10), 1 harvest discriminator (11), 1 dispatch wiring (12), 1 routes+API (13), 1 defaults module (14), 2 alarm chunks (15A inline + 15B rollup), 1 UI (16), 1 retirement+gate (17), 1 doc-sync+placeholder (18).

---

## 5. Per-chunk detail

### Chunk 1 — `iee_browser_session_profiles` schema + migration 0346 + RLS

**spec_sections:** §7.1, §7.2 (0346), §9, §10.1, §13.1 (profile lazy-create + mount), §13.7 (profile state machine)

**Files to create or modify:**
- `server/db/schema/ieeBrowserSessionProfiles.ts` (NEW)
- `server/db/schema/index.ts` (EXTEND — export new table)
- `server/config/rlsProtectedTables.ts` (EXTEND — add table name)
- `migrations/0346_create_iee_browser_session_profiles.sql` (NEW)
- `migrations/0346_create_iee_browser_session_profiles.down.sql` (NEW)

**Module shape:**
- *Public interface this chunk exposes:* `ieeBrowserSessionProfiles` Drizzle table export (column types, indexes, unique key `(organisation_id, subaccount_id, session_key)`). RLS manifest entry. No service methods.
- *What stays hidden behind it:* Column-level defaults, the dual-GUC RLS policy SQL, the `last_used_at` GC scan index, the `status` enum type predicate.

**Contracts:**
- Table columns per spec §10.1 (id, organisationId, subaccountId, sessionKey default `'default'`, volumeId, lastUsedAt, sizeBytes, sizeCapBytes default `524288000`, status `'active'|'scheduled_gc'|'gc_in_progress'|'gc_done'`, scheduledGcAt, gcStartedAt, retentionDaysOverride, createdAt, updatedAt).
- Indexes: `iee_browser_session_profiles_tenant_key_unique_idx` on `(organisation_id, subaccount_id, session_key)`; `iee_browser_session_profiles_last_used_at_idx`.
- RLS policy: dual-GUC predicate verbatim from `operator_task_profiles` policy.
- FK actions: `organisation_id → organisations(id) ON DELETE RESTRICT`; `subaccount_id → subaccounts(id) ON DELETE CASCADE`.

**Error handling:**
- Schema-layer only; no service throws.
- Unique-constraint `23505` on `(org, subaccount, session_key)` surfaces in chunk 9; chunk 1 only defines the constraint.

**Test considerations:**
- No tests in this chunk. Drizzle-generated migration verified by `npm run db:generate` shows the expected DDL.
- Chunk 9 will author the service-level lazy-create test against this table.

**Dependencies:** none.

**Acceptance criteria:**
- `migrations/0346_create_iee_browser_session_profiles.sql` creates the table with the spec §10.1 column shape, all indexes, the dual-GUC RLS policy, and the FKs.
- `.down.sql` drops policy + indexes + table cleanly.
- `server/db/schema/index.ts` exports `ieeBrowserSessionProfiles`.
- `server/config/rlsProtectedTables.ts` lists `iee_browser_session_profiles` in the manifest.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` (verify migration shape matches the Drizzle schema)

---

### Chunk 2 — `subaccount_iee_browser_settings` schema + migration 0347 + RLS

**spec_sections:** §7.1, §7.2 (0347), §8.3, §9, §10.2, §13.1 (settings PATCH), §13.7 (settings state — ETag, not lifecycle)

**Files to create or modify:**
- `server/db/schema/subaccountIeeBrowserSettings.ts` (NEW)
- `server/db/schema/index.ts` (EXTEND — export new table)
- `server/config/rlsProtectedTables.ts` (EXTEND — add table name)
- `migrations/0347_create_subaccount_iee_browser_settings.sql` (NEW)
- `migrations/0347_create_subaccount_iee_browser_settings.down.sql` (NEW)

**Module shape:**
- *Public interface this chunk exposes:* `subaccountIeeBrowserSettings` Drizzle table export with PK `subaccountId`, `settingsVersion` ETag column, the 4 user-facing fields (status, browserProfileRetentionDays, perTaskCostCeilingCents, perSubaccountDailyCostCeilingCents) + `rolloutApproved`.
- *What stays hidden behind it:* The dual-GUC RLS policy, the `DEFAULT 'off'` predicate on `status` (load-bearing for §3.5 brief invariant), the cascade vs restrict FK actions on `organisation_id`/`subaccount_id`.

**Contracts:**
- Table columns per spec §10.2 (subaccountId PK, organisationId, status default `'off'`, rolloutApproved default `false`, browserProfileRetentionDays default `30`, perTaskCostCeilingCents default `100`, perSubaccountDailyCostCeilingCents default `500`, settingsVersion default `1`, updatedAt, updatedByUserId).
- RLS policy: dual-GUC predicate matching `subaccount_operator_settings` policy verbatim.
- **Migration MUST default `status` to `'off'`** — brief §3.5 v7 invariant ("no mass enable on backfill"); reviewers will check the DDL string.

**Error handling:**
- Schema-layer only.
- PATCH ETag-conflict (HTTP 409) is implemented in chunk 13; this chunk only defines `settings_version`.

**Test considerations:**
- No tests in this chunk.

**Dependencies:** chunk 1 (migration ordering 0346 → 0347).

**Acceptance criteria:**
- `migrations/0347_create_subaccount_iee_browser_settings.sql` creates the table with DEFAULT 'off' on `status`, all column defaults, the dual-GUC RLS policy.
- `.down.sql` reverses cleanly.
- Schema index exports the new table; RLS manifest lists the table.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate`

---

### Chunk 3 — `llm_requests` columns `subtype` + `warm_session_id` + CHECKs (migration 0348)

**spec_sections:** §7.1 (`llm_requests` EXTEND), §7.2 (0348), §8.6, §10.3 (FK target), §13.1 (cost-row idempotency)

**Files to create or modify:**
- `server/db/schema/llmRequests.ts` (EXTEND — add `subtype text` nullable + `warmSessionId uuid` nullable, NO FK yet)
- `migrations/0348_llm_requests_add_subtype.sql` (NEW)
- `migrations/0348_llm_requests_add_subtype.down.sql` (NEW)

**Module shape:**
- *Public interface this chunk exposes:* Two new columns on `llm_requests` (`subtype text` nullable, `warm_session_id uuid` nullable) + two CHECK constraints (subtype enum gate; warm_session_id-vs-subtype consistency).
- *What stays hidden behind it:* The exact null-safe predicate using `IS DISTINCT FROM` (load-bearing for three-valued-logic correctness), the deliberate omission of the FK (lands in 0350 after 0349).

**Contracts:**
- Column 1: `subtype text` nullable. Values when `source_type = 'sandbox_compute'`: `'task' | 'warm_pool'`. Null otherwise.
- Column 2: `warm_session_id uuid` nullable. Non-null only when `subtype = 'warm_pool'`. No FK yet (FK lands in 0350).
- CHECK 1 (subtype enum gate, null-safe):
  ```sql
  CHECK ((source_type = 'sandbox_compute' AND subtype IN ('task','warm_pool'))
       OR (source_type IS DISTINCT FROM 'sandbox_compute' AND subtype IS NULL))
  ```
- CHECK 2 (warm_session_id consistency, null-safe):
  ```sql
  CHECK ((subtype = 'warm_pool' AND warm_session_id IS NOT NULL)
       OR (subtype IS DISTINCT FROM 'warm_pool' AND warm_session_id IS NULL))
  ```

**Error handling:**
- CHECK violations on existing rows during migration: existing `llm_requests` rows have `subtype = NULL`, `warm_session_id = NULL`. The CHECKs hold trivially via the `IS DISTINCT FROM` branches.
- Service-layer writes that violate the constraints will surface as `23514 check_violation`; chunks 11 (harvest write path) and 12 (warm-pool teardown writer in chunk 10) are responsible for producing valid rows.

**Test considerations:**
- No tests in this chunk.

**Dependencies:** chunk 2 (migration ordering 0347 → 0348). No dependency on chunk 4 (the target table for the FK does not exist yet; FK lands in chunk 5).

**Acceptance criteria:**
- Migration adds both columns nullable, both CHECK constraints with `IS DISTINCT FROM`.
- Migration does NOT add FK on `warm_session_id` (deferred to 0350).
- Migration does NOT add unique partial index on `warm_session_id` (deferred to 0350).
- `.down.sql` drops CHECKs + columns.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate`

---

### Chunk 4 — `browser_warm_sessions` schema + migration 0349 + RLS + shared-type extensions

**spec_sections:** §7.1, §7.2 (0349), §8.5, §8.6 (warm_session_id as FK target), §9, §10.3, §13.7 (warm-session state machine)

**Files to create or modify:**
- `server/db/schema/browserWarmSessions.ts` (NEW)
- `server/db/schema/index.ts` (EXTEND — export new table)
- `server/config/rlsProtectedTables.ts` (EXTEND — add table name)
- `migrations/0349_create_browser_warm_sessions.sql` (NEW)
- `migrations/0349_create_browser_warm_sessions.down.sql` (NEW)
- `shared/iee/failureReason.ts` (EXTEND — add 2 enum values: `iee_browser_launch_disabled`, `profile_harvest_failed`)
- `shared/types/sandbox.ts` (EXTEND — add optional `profileMount` + `warmSessionCheckoutId` fields to `SandboxRunTaskInput`)

**Module shape:**
- *Public interface this chunk exposes:* `browserWarmSessions` table (id PK, organisationId, subaccountId, sandboxId, templateName, templateVersion, status `'available'|'leased'|'terminated'`, createdAt, leasedAt, terminatedAt, idleCostCentsAttributed) + the partial UNIQUE index that enforces V1 size-1-per-subaccount + the dual-GUC RLS policy. Plus the two new `FailureReason` enum values and the two new optional `SandboxRunTaskInput` fields.
- *What stays hidden behind it:* The partial unique-index predicate (`WHERE status = 'available'`), the eviction-sweep index (`WHERE status = 'available'` on `created_at`), the `idleCostCentsAttributed` capacity-diagnostic column.

**Contracts:**
- Table columns per spec §10.3.
- Indexes: `browser_warm_sessions_subaccount_status_idx` (composite); `browser_warm_sessions_available_age_idx` partial on `(created_at) WHERE status='available'`; `browser_warm_sessions_subaccount_available_unique_idx` UNIQUE partial on `(subaccount_id) WHERE status='available'` (R2-F5 — DB-level enforcement of V1 invariant).
- RLS policy: dual-GUC predicate verbatim.
- `FailureReason` extension: add `iee_browser_launch_disabled` (chunk 12 launch-flag check) + `profile_harvest_failed` (chunk 12 partial-success handler).
- `SandboxRunTaskInput` extension per spec §8.1:
  ```typescript
  profileMount?: {
    sessionProfileId: string;       // uuid
    volumeId: string;
    userDataDirInSandbox: string;   // '/workspace/profile'
  };
  warmSessionCheckoutId?: string | null;
  ```

**Error handling:**
- Schema-layer + shared-type extensions only.
- Two concurrent refill triggers racing to INSERT an `available` row for the same subaccount: one wins, the second hits `23505 unique_violation` on `browser_warm_sessions_subaccount_available_unique_idx`. Chunk 10 (warm-pool service) catches the `23505` and treats it as "another worker already refilled" — no error surface to the caller.

**Test considerations:**
- No tests in this chunk.

**Dependencies:** chunk 3 (migration ordering 0348 → 0349). No dependency on chunks 1 or 2 beyond shared `organisations` / `subaccounts` tables (existing).

**Acceptance criteria:**
- Migration creates the table with the partial unique index, all FKs, the dual-GUC RLS policy.
- Status set is closed (`'available' | 'leased' | 'terminated'`); the V2 reuse value is NOT added.
- Shared-type extensions land in the same chunk so consumers in later chunks (12 dispatch, 15 alarms) compile.
- `.down.sql` reverses cleanly.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate`

---

### Chunk 5 — FK on `llm_requests.warm_session_id` + unique partial index (migration 0350)

**spec_sections:** §7.2 (0350), §8.6 (idempotency on warm_session_id), §10.3 (deletion contract), §13.1 (warm-session idle-cost-row key-based idempotency)

**Files to create or modify:**
- `migrations/0350_llm_requests_warm_session_id_fk.sql` (NEW)
- `migrations/0350_llm_requests_warm_session_id_fk.down.sql` (NEW)
- `server/db/schema/llmRequests.ts` (EXTEND — add `.references()` on the `warmSessionId` column now that the target exists)

**Module shape:**
- *Public interface this chunk exposes:* The FK `llm_requests.warm_session_id → browser_warm_sessions(id) ON DELETE RESTRICT` and the unique partial index `llm_requests(warm_session_id) WHERE subtype='warm_pool'`.
- *What stays hidden behind it:* The deliberate choice of `ON DELETE RESTRICT` over `SET NULL` (R3-F3 service-contract alignment — see invariant 2). The decision to enforce idempotency at the index layer rather than in service code.

**Contracts:**
- FK action: `ON DELETE RESTRICT` (not `SET NULL`). Rationale in spec §10.3 deletion contract: rows are never deleted; FK is defensive.
- Unique partial index: `CREATE UNIQUE INDEX llm_requests_warm_session_id_unique_idx ON llm_requests(warm_session_id) WHERE subtype = 'warm_pool'`.
- Drizzle schema update on `warmSessionId` column references `browserWarmSessions.id` with `onDelete: 'restrict'`.

**Error handling:**
- Constraint `23505` on the unique partial index surfaces if chunk 10 (warm-pool teardown writer) attempts to write a duplicate idle-cost row. Chunk 10 catches it as "already written" no-op.
- `23503` foreign-key violation on `warm_session_id` insert/update if the referenced `browser_warm_sessions` row does not exist. This should never happen given chunk 10's lifecycle — surfaces as 500 if it does (service-contract violation).

**Test considerations:**
- No tests in this chunk.

**Dependencies:** chunk 4 (target table must exist).

**Acceptance criteria:**
- Migration adds FK with `ON DELETE RESTRICT`.
- Migration adds unique partial index `WHERE subtype = 'warm_pool'`.
- Drizzle schema reference matches the SQL FK action.
- `.down.sql` drops the index + FK without touching the columns.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate`

---

### Chunk 6 — Sandbox template `iee-browser` (image + harness entrypoint)

**spec_sections:** §7.3, §11 (sandbox `runTask` execution model)

**Files to create or modify:**
- `infra/sandbox-templates/iee-browser/Dockerfile` (NEW)
- `infra/sandbox-templates/iee-browser/README.md` (NEW)
- `infra/sandbox-templates/iee-browser/harness/index.ts` (NEW — sandbox-side entrypoint)
- `infra/sandbox-templates/iee-browser/CURRENT_VERSION` (NEW — pin file matching the sibling template pattern at `infra/sandbox-templates/synthetos-sandbox/CURRENT_VERSION`)
- `infra/sandbox-templates/iee-browser/PUBLISHED_VERSION` (NEW — pin file matching the sibling template pattern)
- `infra/sandbox-templates/iee-browser/entrypoint.sh` (NEW if the harness needs a shell shim; otherwise harness/index.ts is the entry)

**Module shape:**
- *Public interface this chunk exposes:* A buildable sandbox template named `iee-browser` whose harness reads the supplied task payload, runs the Playwright executor (the worker code preserved byte-identical), writes harvest output to `/workspace/artefacts`, exits with a status. Plus the `CURRENT_VERSION` / `PUBLISHED_VERSION` files that Spec B's template-version-coherence machinery reads.
- *What stays hidden behind it:* The Playwright image digest pin, the ffmpeg install, the harness wakelock loop, the artefact-write path layout, the `userDataDir` mount path (resolved against `profileMount.userDataDirInSandbox = '/workspace/profile'` from chunk 4's shared type).

**Contracts:**
- Base image: `mcr.microsoft.com/playwright:v1.59.1-jammy` (digest-pinned). Deterministic-build rules per Spec B §15.2.
- Harness entry signature (TypeScript):
  ```typescript
  // infra/sandbox-templates/iee-browser/harness/index.ts
  type HarnessInput = {
    taskPayload: unknown;       // IEE browser task envelope (existing shape)
    profileMount: { userDataDirInSandbox: string };
    artefactsDir: string;       // '/workspace/artefacts'
  };
  async function main(input: HarnessInput): Promise<{ status: 'completed' | 'failed'; reason?: string }>;
  ```
- `CURRENT_VERSION` / `PUBLISHED_VERSION` shape: matches `infra/sandbox-templates/synthetos-sandbox/` pin format (verify the exact format when authoring; semver-string by convention).

**Error handling:**
- Harness exit codes: `0` on completed, non-zero on failed. Failure-reason classification produced by the existing `worker/src/loop/failureClassification.ts` (unchanged from today; the harness imports and reuses it).
- Volume-mount failure surfaces as `FailureReason: 'profile_harvest_failed'` if the mount is partial; the harness writes a failure artefact and exits non-zero.

**Test considerations:**
- No local tests in this chunk. The template build runs in CI's existing sandbox-template-build pipeline.
- Chunk 9's named CI gate (`serialization.test.ts`) covers the per-volume single-mount invariant when the template is mounted to a sandbox.

**Dependencies:** none (template is independent of schema chunks).

**Acceptance criteria:**
- Template directory builds against the deterministic-build rules in CI's existing sandbox-template-build pipeline (CI-only per the test-gates rule — no local `docker build` invocation required from the builder). The Dockerfile, pin files, and harness shape must conform to the sibling-template pattern so the CI pipeline picks the template up automatically.
- `CURRENT_VERSION` / `PUBLISHED_VERSION` files present and follow the sibling template pattern.
- Harness entrypoint preserves the Playwright executor invocation byte-identical (no edits to `worker/src/browser/executor.ts` et al.).

**Verification commands:**
- `npm run lint` (for harness/index.ts)
- `npm run typecheck` (for harness/index.ts)
- `npm run build:server` (verifies the harness compiles if it shares the server tsconfig path; otherwise skip)

---

### Chunk 7 — e2b provider browser-class wiring

**spec_sections:** §4 (decision 4 — extend SandboxExecutionService with `'browser'`), §5 (sandbox provider abstraction), §7.4 (`e2bSandbox.ts` EXTEND), §11 (sandbox runTask inline)

**Files to create or modify:**
- `server/services/sandbox/e2bSandbox.ts` (EXTEND — branch on `sandboxRequirement === 'browser'` → template `iee-browser`; mount profile volume at task dispatch)
- `server/services/sandbox/e2bSandboxPure.ts` (EXTEND — any pure helpers, template-name resolution)
- `server/services/sandbox/sandboxProviderResolver.ts` (EXTEND if needed — no interface change per spec §7.4; the `'browser'` requirement is already in `SandboxRequirement`)

**Phase 2 lookup Q3 resolution:** verified file path is `server/services/sandbox/e2bSandbox.ts` (confirmed by `Glob` during plan authoring). Spec §17 Q3 plan-gate is satisfied; no inventory update required.

**Module shape:**
- *Public interface this chunk exposes:* `runTask({ sandboxRequirement: 'browser', templateName: 'iee-browser', profileMount, ... })` resolves the `iee-browser` template, mounts the profile volume at the path supplied in `profileMount.userDataDirInSandbox`, and returns the existing `SandboxRunTaskResult` shape from Spec B.
- *What stays hidden behind it:* The template-version-coherence check (Spec B `assertNotLatestTemplateVersion`), the volume-mount provider call, the start-claim lease (Spec B), the harvest pipeline trigger.

**Contracts:**
- Input: `SandboxRunTaskInput` with `sandboxRequirement = 'browser'`, `templateName = 'iee-browser'`, `profileMount = { sessionProfileId, volumeId, userDataDirInSandbox }`, `warmSessionCheckoutId?: string | null` (chunk 4 shared-type extension).
- Output: existing `SandboxRunTaskResult` shape from Spec B (no new fields).
- Provider-layer invariant: per-volume single-mount holds (Spec B §8.x). This chunk does not introduce serialisation logic; it relies on Spec B's primitive.

**Error handling:**
- Template-not-found surfaces as Spec B's existing `TemplateLookupError` → 500 to caller (configuration bug, not user-recoverable).
- Mount failure surfaces as Spec B's existing `VolumeMountError`.
- Concurrent mount of the same volume blocks at the provider layer until the first releases (Spec B invariant); chunk 9's CI gate verifies this against e2b.

**Test considerations:**
- No tests in this chunk. Chunk 9 carries the named CI gate `serialization.test.ts` against this provider implementation.
- Existing `e2bSandboxPure.test.ts` and `sandboxProviderResolverPure.test.ts` should be inspected to confirm the `'browser'` branch is exercisable; the pure-test extension lives in chunk 9 alongside the integration gate.

**Dependencies:** chunk 6 (template image must exist for provider to resolve).

**Acceptance criteria:**
- `e2bSandbox.ts` branches on `sandboxRequirement === 'browser'` and resolves `templateName: 'iee-browser'`.
- The profile-volume mount path is read from `profileMount.userDataDirInSandbox` (not hardcoded) so chunk 8's `playwrightContext.ts` edit and the harness in chunk 6 share the same path source.
- No new public types introduced — only existing Spec B types extended in chunk 4.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

---

### Chunk 8 — `playwrightContext.ts` sandbox-path resolution edit

**spec_sections:** §7.5 (worker minor edit), §1 (goal 2 — Playwright code preserved byte-identical except path resolution)

**Files to create or modify:**
- `worker/src/browser/playwrightContext.ts` (MINOR EDIT — `buildUserDataDir(...)` resolves to the mounted volume path inside the sandbox)

**Module shape:**
- *Public interface this chunk exposes:* `buildUserDataDir({ organisationId, subaccountId, sessionKey, mountRoot })` returning a path under the supplied `mountRoot` (which is `'/workspace/profile'` inside the sandbox, supplied by the harness via `profileMount.userDataDirInSandbox`).
- *What stays hidden behind it:* The `SESSION_KEY_RE` validation (`/^[a-zA-Z0-9_-]{1,128}$/`), the path-traversal regex check, the corruption-recovery rename branch, the launch-failure backoff. All preserved.

**Contracts:**
- Function signature change: `buildUserDataDir({ organisationId, subaccountId, sessionKey })` → `buildUserDataDir({ organisationId, subaccountId, sessionKey, mountRoot })` where `mountRoot` is the absolute path inside the sandbox supplied by the harness. Existing callers default `mountRoot` to the legacy `BROWSER_SESSION_DIR` env var ONLY in dev/test contexts; production callers always supply.
- `SESSION_KEY_RE` unchanged. Path-traversal regex unchanged. Corruption-recovery rename unchanged. Launch-failure backoff unchanged.

**Error handling:**
- Invalid `sessionKey` (regex mismatch) throws `EnvironmentError` (existing class) with reason `'invalid_session_key'`.
- Path traversal attempt throws `SafetyError` with reason `'path_traversal_attempted'`.
- Both error classes are preserved from the existing implementation.

**Test considerations:**
- If a pure-test extension for `buildUserDataDir` is authored, it lives at `worker/src/browser/__tests__/playwrightContext.test.ts` (single-file Vitest, targeted execution only).
- Phase 2 lookup Q4 resolution: pre-existing host-disk profiles. Per spec §17 Q4 ("likely no-op given dogfood-first") and the dev-only `mountRoot` default — no migration needed; existing host-disk profiles are orphaned and reclaimed by ordinary filesystem cleanup. Chunk 9 (profile manager) treats first task per `(org, subaccount, session_key)` as a lazy-create; no host-disk import path is implemented.

**Dependencies:** chunk 6 (`profileMount.userDataDirInSandbox` is the value supplied to `mountRoot`).

**Acceptance criteria:**
- `buildUserDataDir` accepts a `mountRoot` argument and uses it instead of resolving from `BROWSER_SESSION_DIR` in the sandbox path.
- Dev/test paths (where `mountRoot` is not supplied) still work via the legacy fallback (so worker unit tests do not break).
- No edits to other `worker/src/browser/*.ts` files.
- No edits to `worker/src/loop/`, `worker/src/llm/`, `worker/src/persistence/`, or `worker/src/runtime/sampler.ts`.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run worker/src/browser/__tests__/playwrightContext.test.ts` (only if a pure-helper test is authored in this chunk)

---

### Chunk 9 — `ieeBrowserProfileManager` service + named CI plan-gate

**spec_sections:** §7.4 (`ieeBrowserProfileManager.ts` NEW), §8.2 (profile row shape + source-of-truth), §9 (no-cross-tenant-mount invariant), §13.1 (lazy-create + mount idempotency), §13.3 (concurrency guard — Spec B per-volume single-mount), §13.5 (`profile_harvest_failed`), §13.7 (profile state machine), §15 (named CI acceptance gate)

**Files to create or modify:**
- `server/services/sandbox/ieeBrowserProfileManager.ts` (NEW)
- `server/services/sandbox/ieeBrowserProfileManagerPure.ts` (NEW — pure helpers: mount-authorisation predicate, retention-window math, status-transition predicate)
- `server/services/sandbox/__tests__/ieeBrowserProfileManagerPure.test.ts` (NEW — unit tests for pure helpers; targeted vitest only)
- `server/services/sandbox/__tests__/ieeBrowserProfileManager.serialization.test.ts` (NEW — **named CI plan-gate** per spec §15 R2-F6; runs in CI only; chunk 9 does NOT ship until this test passes against the e2b provider)

**Module shape:**
- *Public interface this chunk exposes:* `ieeBrowserProfileManager` with methods:
  - `resolve({ organisationId, subaccountId, sessionKey }): Promise<ProfileRow>` — lazy-create + return canonical row.
  - `mount(profile, { organisationId, subaccountId }): Promise<MountedProfile>` — assert cross-tenant predicate then mount.
  - `unmount(mountedProfile): Promise<void>` — release.
  - `gcSweep(): Promise<{ scheduled: number; completed: number }>` — cron entry (called from existing pg-boss daily cron; chunk wires it).
  - `recoverCorruption(profile, reason): Promise<void>` — rename-to-`.corrupt.<ts>` inside the volume, audit emit.
- *What stays hidden behind it:* The unique-constraint `23505` catch on lazy-create + winner-row read, the `FOR UPDATE SKIP LOCKED` lock on GC claim, the audit-log row builder, the corruption-rename naming convention, the 500 MB size-cap enforcement, the retention-days resolver (uses `subaccount_iee_browser_settings.browserProfileRetentionDays` if set, else 30; range 7–90), the volume vs row reconciliation pass (volume is canonical for contents per §8.2).

**Contracts:**
- `ProfileRow` type matches `iee_browser_session_profiles` columns.
- `MountedProfile` type matches the `profileMount` shape in `SandboxRunTaskInput` (chunk 4 shared-type extension): `{ sessionProfileId, volumeId, userDataDirInSandbox }`.
- Mount-authorisation predicate (pure):
  ```typescript
  function assertSameTenant(profile: ProfileRow, ctx: { organisationId: string; subaccountId: string }): void;
  // throws SafetyError('cross_tenant_mount_attempted') if (org, subaccount) mismatch
  ```
- Status transitions: per spec §13.7 (`active → scheduled_gc → gc_in_progress → gc_done`; `scheduled_gc → active` reprieve).
- Idempotency: lazy-create is key-based (unique on `(org, subaccount, session_key)`); mount is state-based (`UPDATE ... WHERE id = $1 AND status = 'active'`).

**Error handling:**
- Cross-tenant mount attempt → `SafetyError('cross_tenant_mount_attempted')` → 500 to caller (invariant violation; should never reach a user-facing path).
- Profile in `scheduled_gc` or `gc_in_progress` → `EnvironmentError('profile_locked_for_gc')` — caller (chunk 12 dispatch) treats as a transient retry; the reprieve UPDATE in §13.7 lifts the lock.
- Size-cap breach at harvest → `FailureError('profile_harvest_failed')` — task surfaces as failed, profile transitions to `'scheduled_gc'`.
- Volume corruption → `EnvironmentError('profile_corruption_detected')` followed by `recoverCorruption()` rename; task retried on a fresh profile by upstream dispatch logic.

**Test considerations (pure unit tests in `ieeBrowserProfileManagerPure.test.ts`):**
- `assertSameTenant` rejects org mismatch, rejects subaccount mismatch, accepts exact match.
- Retention-days resolver clamps to [7, 90]; returns 30 when override is null and subaccount setting absent.
- Status-transition predicate accepts the valid transitions in §13.7; rejects forbidden ones (`gc_done → *`).

**Named CI plan-gate (`ieeBrowserProfileManager.serialization.test.ts`):**
- Issues two concurrent `runTask` calls against the same `(org, subaccount, session_key)` profile volume.
- Asserts (a) both calls eventually complete with status `'completed'`; (b) second call's start time ≥ N ms after first call's release; (c) per-volume mount events emitted in strictly serialised order.
- **Plan-gate semantics:** chunk 9 is NOT shippable until this test passes against the e2b provider implementation in chunk 7. If it fails, return to chunk 7 (provider mount logic) before continuing. The test runs in CI; builders wait for the CI signal.

**Dependencies:** chunk 1 (`iee_browser_session_profiles` table), chunk 4 (shared-type `profileMount`), chunk 7 (e2b provider for the serialization gate).

**Acceptance criteria:**
- All public methods preserve the invariants in §9 (cross-tenant assertion before mount).
- Lazy-create is key-based on `(org, subaccount, session_key)`; concurrent racing creators converge on the winner row.
- GC scheduler uses `FOR UPDATE SKIP LOCKED`.
- Corruption-recovery renames inside the volume (does not delete; preserves forensic trail).
- Audit log row emitted for mount, unmount, GC, corruption recovery, hard delete.
- Named CI gate passes against the e2b provider before chunk 9 is marked complete.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/sandbox/__tests__/ieeBrowserProfileManagerPure.test.ts` (pure tests authored in this chunk)

---

### Chunk 10 — `browserWarmPool` service

**spec_sections:** §7.4 (`browserWarmPool.ts` NEW), §8.5 (check-out / terminate / evictStale), §8.6 (idle-cost-row producer at teardown), §8.7 (`warm_pool_miss` metric), §11 (warm-pool in-process), §13.1 (warm-session check-out state-based), §13.7 (warm-session state machine)

**Files to create or modify:**
- `server/services/sandbox/browserWarmPool.ts` (NEW)
- `server/services/sandbox/browserWarmPoolPure.ts` (NEW — pure helpers: eviction-age predicate, refill-eligibility predicate)
- `server/services/sandbox/__tests__/browserWarmPoolPure.test.ts` (NEW — unit tests for pure helpers; targeted vitest only)

**Module shape:**
- *Public interface this chunk exposes:* `browserWarmPool` with methods:
  - `checkout({ organisationId, subaccountId }): Promise<{ warmSessionId; sandboxId; leaseToken } | null>` — returns null on starvation (cold-start fallthrough).
  - `terminate({ warmSessionId, reason }): Promise<void>` — unconditional teardown after task; computes cost internally (see "cost computation" below); emits idle-cost row; triggers refill if eligible. `reason` is a diagnostic discriminator (`'post_lease' | 'evict_stale' | 'feature_disabled'`); it does NOT affect the cost calculation. **Callers never supply `idleCostCents`.** This is a deliberate API choice: callers in failure paths (chunk 12's `finally` block, the evict cron) may have no reliable cost figure at the moment of teardown, and pushing billing math into `_ieeShared.ts` would split cost attribution across two services. `browserWarmPool` is the sole owner of warm-pool cost.
  - `evictStale(): Promise<{ evicted: number }>` — cron sweep (30 min default). For every claimed `available` row this method transitions to `terminated`, it ALSO writes the same `llm_requests` warm-pool idle-cost row that `terminate` writes (same `source_type='sandbox_compute'`, `subtype='warm_pool'`, `warm_session_id=$id` key). Internally `evictStale` delegates the two writes to the same private helper that `terminate` uses, so cost computation is owned in exactly one place. Idempotency is provided by the same `UNIQUE INDEX llm_requests(warm_session_id) WHERE subtype='warm_pool'` from chunk 5 (`23505` catch is no-op). This guarantees every terminated warm session — whether terminated via teardown-after-lease OR eviction-while-available — has exactly one billable idle-cost row, computed identically in both paths.
  - `refillIfEligible({ subaccountId }): Promise<void>` — internal; called by terminate or by an explicit prewarm path.
- *What stays hidden behind it:* The private `_terminateAndWriteCostRow(warmSessionId, reason)` helper that owns the duration math, rate lookup, cents calculation, both DB writes, and the `23505` no-op semantics. The atomic state-transition UPDATE (`SET status='terminated' WHERE id=$1 AND status IN ('leased','available') RETURNING`), the `23505` catch on refill (unique partial index handles the race; loser treats it as "another worker already refilled"), the eligibility check (`status='on' AND rolloutApproved=true` on `subaccount_iee_browser_settings`), the idle-duration math (`terminated_at - created_at` per R3-F6 — `leased_at` is diagnostic-only), the per-second/per-minute warm-pool rate read from the existing sandbox-cost primitive used by `sandboxHarvestService` (exact import path resolved at chunk start — see Open lookup 4 in §8), the `warm_pool_miss` metric emission, the e2b sandbox provisioning call.

**Contracts:**
- Lease-then-tear-down lifecycle: `available → leased → terminated`. No `leased → available` return path in V1.
- `checkout` is state-based idempotent: `UPDATE browser_warm_sessions SET status='leased', leased_at=now() WHERE id=$1 AND status='available' RETURNING`.
- `terminate` is state-based idempotent. Internally:
  1. Read the warm-session row for `warmSessionId` (single SELECT inside the same transaction).
  2. Compute `terminated_at = now()`, `duration_ms = terminated_at - created_at`, `idle_cost_cents = round(duration_ms / 1000 * warm_pool_rate_per_second)`. The rate comes from the existing sandbox-cost primitive used by `sandboxHarvestService` for `subtype='task'` rows (single source of truth — both subtypes share the same rate model). If the row is already in status `terminated`, skip (idempotent no-op; debug-log only).
  3. `UPDATE browser_warm_sessions SET status='terminated', terminated_at=$ts, idle_cost_cents_attributed=$cents WHERE id=$id AND status IN ('leased','available') RETURNING` — accepts both source states so the same UPDATE serves teardown-after-lease AND evict-while-available.
  4. INSERT into `llm_requests` with `source_type='sandbox_compute'`, `subtype='warm_pool'`, `warm_session_id=$id`, `cost_cents=$cents`. Unique partial index `llm_requests(warm_session_id) WHERE subtype='warm_pool'` makes the insert idempotent; `23505` catch is a no-op.
  5. Audit-log row records `reason` (`post_lease` / `evict_stale` / `feature_disabled`) for forensic trace; does not affect cost.
- Caller never supplies `idleCostCents`. `_ieeShared.ts` calls `terminate({ warmSessionId, reason: 'post_lease' })` from its `finally` block with no cost arithmetic.
- `evictStale` claims with `FOR UPDATE SKIP LOCKED`. For each claimed `available` row, it calls the same private `_terminateAndWriteCostRow(warmSessionId, 'evict_stale')` helper that `terminate` calls. Cost is therefore computed identically in both paths — same duration formula (`terminated_at - created_at`), same rate source, same insert helper, same `23505` no-op semantics. The unique partial index is the sole idempotency mechanism across both code paths. The `idle_cost_cents_attributed` column on `browser_warm_sessions` mirrors the cents written to `llm_requests` for diagnostic parity.
- Refill: `INSERT INTO browser_warm_sessions(...) WHERE NOT EXISTS(...)` plus the partial unique index defence; `23505` catch is "another worker already refilled".
- Idle-duration formula: `terminated_at - created_at` (full lifecycle of the sandbox is billable idle, whether ever leased or not). Per spec §8.6 R3-F6.
- `warm_pool_miss` metric payload: `{ subaccountId, reason: 'starvation' | 'feature_disabled' }`. Metric only; no incident row.

**Error handling:**
- Starvation (no available warm session for subaccount, OR subaccount Status=Off OR rolloutApproved=false) → returns `null` from `checkout`; emits `iee_browser.warm_pool_miss` metric. Caller (chunk 12) falls through to cold start.
- Concurrent checkout race → losing caller sees 0 rows; treats as starvation (returns null).
- Concurrent refill race → loser catches `23505` on the unique partial index; no error surface.
- Terminate-on-already-terminated session → 0 rows updated; idempotent no-op (debug-log only).
- Duplicate idle-cost-row attempt → `23505` on `llm_requests(warm_session_id) WHERE subtype='warm_pool'`; idempotent no-op.

**Test considerations (pure unit tests in `browserWarmPoolPure.test.ts`):**
- Eviction-age predicate: session created >30 min ago → evict; <30 min → keep.
- Refill-eligibility predicate: `status='on' AND rolloutApproved=true` → eligible; either false → not eligible.
- Idle-duration math: `terminated_at - created_at` returns expected millis; `leased_at` is NOT used.
- Cost-computation helper (pure): given `(createdAt, terminatedAt, ratePerSecond)` → returns expected `idleCostCents` (integer cents via `Math.round`). Boundary cases: zero duration → 0 cents; sub-second duration → 0 cents after rounding; long duration → exact integer cents.
- Cost-row builder parity: row-shape for the evict-while-available path equals row-shape for the lease-then-tear-down path (same `source_type`, `subtype`, `warm_session_id` key, same idle-duration formula, same rate source). One helper, two callers.

**Dependencies:** chunk 4 (`browser_warm_sessions` table + shared types), chunk 5 (FK + unique partial index on `llm_requests`), chunk 7 (e2b provider for sandbox provisioning).

**Acceptance criteria:**
- All four methods preserve the state-machine invariants in §13.7.
- Lease-then-tear-down: no `leased → available` path.
- `terminate({ warmSessionId, reason })` and `evictStale()` both delegate to one private helper that owns duration math, rate lookup, cents calculation, and the two DB writes. Cost computation lives in `browserWarmPool` only — no caller (including `_ieeShared.ts`) computes or passes cost figures.
- Idle-cost row written exactly once per warm session — covers BOTH `terminate` (post-lease) AND `evictStale` (terminate-while-available) paths. The two paths share one insert helper; the unique partial index on `llm_requests(warm_session_id) WHERE subtype='warm_pool'` is the sole idempotency mechanism.
- `warm_pool_miss` metric emits on starvation; never an incident row.
- DB-level invariants (V1 size-1, idempotency) are enforced by the indexes from chunks 4 and 5; service code catches `23505` as no-op.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/sandbox/__tests__/browserWarmPoolPure.test.ts`

---

### Chunk 11 — Sandbox harvest cost-row subtype discriminator

**spec_sections:** §7.4 (`sandboxHarvestService.ts` EXTEND), §8.6 (cost-row discriminator producer for `subtype='task'`), §13.1 (cost-row write path idempotency)

**Files to create or modify:**
- `server/services/sandboxHarvestService.ts` (EXTEND — write `subtype: 'task'` on every `source_type='sandbox_compute'` row this service emits)
- `server/services/__tests__/sandboxHarvestServicePure.test.ts` (EXTEND if a pure module exists; otherwise NEW test for the discriminator-resolution helper)

**Module shape:**
- *Public interface this chunk exposes:* Existing `sandboxHarvestService` interface, behaviour-extended: every `llm_requests` row this service writes with `source_type='sandbox_compute'` carries `subtype='task'`. The `subtype='warm_pool'` write path is owned by chunk 10 (`browserWarmPool.terminate`), not this chunk.
- *What stays hidden behind it:* The discriminator-resolution helper (input: sandbox-execution context; output: `'task'`), the column-write itself (a new bound parameter in the existing INSERT).

**Contracts:**
- Existing `sandboxHarvestService` signature unchanged at the public interface; only the inserted row shape changes.
- Discriminator resolution: for the harvest pipeline (post-task), `subtype = 'task'`. The `'warm_pool'` subtype is reserved for chunk 10's teardown writer.
- `warm_session_id` is always NULL when `subtype = 'task'` (CHECK 2 from chunk 3 enforces).

**Error handling:**
- CHECK violation on insert (`23514`) if a malformed row is constructed → service throw with HTTP 500 (programmer error; rejected before user surface).
- Existing harvest-pipeline errors (artefact validator, etc.) unchanged.

**Test considerations:**
- Pure-test for discriminator resolution: given a sandbox-execution context, returns `'task'`; never `'warm_pool'`.
- Pure-test for row-shape builder: when `subtype='task'`, `warm_session_id` is null; CHECK 2 would accept.

**Dependencies:** chunk 3 (`subtype` + `warm_session_id` columns + CHECKs).

**Acceptance criteria:**
- Every `source_type='sandbox_compute'` row written by `sandboxHarvestService` carries `subtype='task'`.
- No row attempts a `warm_pool` subtype from this service (that's chunk 10's lane).
- Existing harvest-pipeline behaviour is byte-identical otherwise.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/__tests__/sandboxHarvestServicePure.test.ts` (only the tests authored in this chunk)

---

### Chunk 12 — IEE-browser dispatch wiring in `_ieeShared.ts`

**spec_sections:** §7.4 (`_ieeShared.ts` EXTEND), §8.1 (`SandboxRunTaskInput` browser extension consumer), §8.4 (launch-flag check), §8.5 (warm-pool checkout consumer), §11 (sandbox runTask inline), §13.1 (launch-flag check read-only; warm-session checkout state-based), §13.4 (terminal event unchanged), §13.5 (profile_harvest_failed surface), §14 (`session_key` derivation)

**Files to create or modify:**
- `server/services/executionBackends/_ieeShared.ts` (EXTEND — browser branch inside `ieeDispatch`: launch-flag check → warm-pool checkout → profile resolve+mount → `SandboxExecutionService.runTask` → on completion, `browserWarmPool.terminate` if warm-leased)
- `server/services/executionBackends/__tests__/ieeSharedBrowserDispatchPure.test.ts` (NEW — pure test for the dispatch-decision predicate + `session_key` derivation)

**Module shape:**
- *Public interface this chunk exposes:* The existing `ieeDispatch({ type: 'browser', ... }): Promise<BackendDispatchResult>` entry. Behaviour-extended to honour launch-flag, warm-pool, profile mount.
- *What stays hidden behind it:* The launch-flag read (`subaccount_iee_browser_settings.status === 'on' AND rolloutApproved === true`), the cold-start fallthrough on warm-pool starvation, the `session_key` derivation (path (b) per-skill with `'default'` fallback per spec §14), the `profile_harvest_failed` surface on volume corruption, the post-task `browserWarmPool.terminate` call.

**Contracts:**
- Dispatch decision predicate (pure):
  ```typescript
  type DispatchDecision =
    | { kind: 'launch_disabled'; reason: FailureReason }   // 'iee_browser_launch_disabled'
    | { kind: 'warm_leased'; warmSessionCheckoutId: string; sandboxId: string }
    | { kind: 'cold_start' };
  function resolveDispatch(settings: SettingsRow, warmCheckout: WarmCheckoutResult): DispatchDecision;
  ```
- `session_key` derivation (per spec §14, locked path (b)):
  ```typescript
  function deriveSessionKey(taskPayload: { skillId?: string }): string {
    const raw = taskPayload.skillId ?? 'default';
    const sanitised = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
    return sanitised.length > 0 ? sanitised : 'default';
  }
  ```
- Launch-flag check: read `subaccount_iee_browser_settings` for the task's `subaccount_id`. If absent OR `status !== 'on'` OR `rolloutApproved !== true` → `FailureError('iee_browser_launch_disabled')`. **Read-only**; no DB write at this point.
- Profile mount: `ieeBrowserProfileManager.resolve(...)` then `mount(...)`. Cross-tenant assertion is inside `mount`.
- Warm-pool checkout: `browserWarmPool.checkout({...})`; null → cold start (no warm session).
- **Post-task teardown — finally-block guarantee.** If `checkout` returned a warm session (warm-leased path), the dispatcher MUST call `browserWarmPool.terminate({ warmSessionId, reason: 'post_lease' })` in a `finally` block wrapping the entire post-checkout flow (profile resolve, profile mount, `runTask`, harvest, failure mapping). Teardown runs even if mount throws, `runTask` throws, harvest throws, or failure mapping throws. The dispatcher does NOT compute or pass `idleCostCents` — cost attribution is owned entirely by `browserWarmPool.terminate` (chunk 10), which derives duration and cents from the warm-session row itself. This keeps the dispatcher's failure paths free of billing arithmetic. Without this guarantee a leased sandbox can remain stuck and unbilled until `evictStale` reclaims it. Idempotency is provided by chunk 10's state-based UPDATE plus the unique partial index on `llm_requests(warm_session_id)`, so double-invocation under unusual error paths is safe. The cold-start path (checkout returned null) has no teardown obligation.

**Error handling:**
- `FailureReason.iee_browser_launch_disabled` (new — chunk 4) → typed `FailureError`; the parent run records the failure and does NOT enqueue the task. In-flight tasks unaffected.
- `FailureReason.profile_harvest_failed` (new — chunk 4) → typed `FailureError` from harvest on volume corruption; task is `failed` not `partial`.
- Warm-pool starvation → returns `{ kind: 'cold_start' }` from the dispatch decision; no failure; metric only.
- `SafetyError` from cross-tenant mount → bubbles as 500 (invariant violation).
- All other errors (template lookup, mount failure, runTask failure) bubble from existing primitives.

**Test considerations (pure unit tests in `ieeSharedBrowserDispatchPure.test.ts`):**
- `deriveSessionKey`: `skillId='browse-google'` → `'browse-google'`; `skillId='   '` → `'default'`; `skillId=undefined` → `'default'`; `skillId='a'.repeat(200)` → 128-char prefix.
- `resolveDispatch`: settings absent → `launch_disabled`; `status='off'` → `launch_disabled`; `rolloutApproved=false` → `launch_disabled`; warm checkout returns row → `warm_leased`; warm checkout null → `cold_start`.

**Dependencies:** chunks 2 (settings table read), 9 (profile manager), 10 (warm pool), 11 (harvest discriminator).

**Acceptance criteria:**
- The browser branch of `ieeDispatch` honours the launch-flag check BEFORE any sandbox dispatch.
- Cold-start fallthrough never surfaces an error to the user; warm-pool starvation is a metric.
- **Post-task warm-pool teardown is called from a `finally` block** wrapping profile resolve + mount + `runTask` + harvest + failure mapping; teardown runs whether the inner flow completes, throws, or is rejected by failure classification. Idempotency is preserved by chunk 10's state-based UPDATE + the unique partial index on `llm_requests(warm_session_id)`; chunks 5 and 10 absorb double-invocation safely.
- `session_key` derivation follows spec §14 path (b) verbatim.
- No edits to the non-browser branches of `_ieeShared.ts`.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/executionBackends/__tests__/ieeSharedBrowserDispatchPure.test.ts`

---

### Chunk 13 — Settings service + HTTP routes + admin rollout + client API

**spec_sections:** §7.4 (`subaccountIeeBrowserSettings` service), §7.6 (`ieeBrowserSettingsApi.ts`), §7.7 (both new route files), §8.3 (settings row shape), §8.4 (admin rollout-approval ETag PATCH), §9 (permissions split + admin role), §13.1 (settings PATCH state-based; rollout-approval state-based), §13.3 (concurrency guards on both PATCH paths), §13.6 (no new 23505 → HTTP mapping needed for unique constraints; 409 for ETag conflict only)

**Files to create or modify:**
- `server/services/subaccountIeeBrowserSettingsServicePure.ts` (NEW — validation predicates, ETag-conflict detection, audit-row builder)
- `server/services/subaccountIeeBrowserSettingsService.ts` (NEW — DB IO)
- `server/services/__tests__/subaccountIeeBrowserSettingsServicePure.test.ts` (NEW — pure test for validation + ETag)
- `server/routes/subaccountIeeBrowserSettings.ts` (NEW — GET + PATCH for `/api/subaccounts/:id/iee-browser-settings`)
- `server/routes/adminIeeBrowserRollout.ts` (NEW — POST for `/api/admin/iee-browser/rollout-approval/:subaccountId`)
- `server/index.ts` (EXTEND — register the two new route files)
- `client/src/api/ieeBrowserSettingsApi.ts` (NEW — typed client functions matching the routes)

**Module shape:**
- *Public interface this chunk exposes:*
  - `getIeeBrowserSettings(subaccountId)` → row + ETag header.
  - `updateIeeBrowserSettings(subaccountId, draft, expectedSettingsVersion)` → updated row + new ETag, or 409.
  - `setRolloutApproval(subaccountId, approved, expectedSettingsVersion, actorUserId)` → updated row + new ETag + audit-log emit, or 409.
  - Plus typed client wrappers in `client/src/api/ieeBrowserSettingsApi.ts`.
- *What stays hidden behind it:* The Zod schema (`browserProfileRetentionDays` ∈ [7, 90], `perTaskCostCeilingCents` ∈ [1, 10000], `perSubaccountDailyCostCeilingCents` ∈ [1, 100000], `status` ∈ {'on','off'}); the lazy-create-on-first-PATCH branch (sentinel `expectedSettingsVersion = 0`); the audit-log-row builder; the `requireRole('system_admin')` enforcement on the admin route; the `resolveSubaccount` middleware composition; the `setOrgAndSubaccountGUC` transaction wrapper.

**Contracts:**

GET `/api/subaccounts/:id/iee-browser-settings`:
- Permissions: `authenticate` + `requirePermission('operator_settings.read')` + `resolveSubaccount`.
- Response 200: full settings row + `ETag: <settingsVersion>` header.
- If row absent: return **synthesised defaults** with `settingsVersion: 0` sentinel (meaning "row will be lazy-created on first PATCH"). UI never sees a 404.

PATCH `/api/subaccounts/:id/iee-browser-settings`:
- Permissions: `authenticate` + `requirePermission('operator_settings.write')` + `resolveSubaccount`.
- Body (Zod): `{ status?, browserProfileRetentionDays?, perTaskCostCeilingCents?, perSubaccountDailyCostCeilingCents?, expectedSettingsVersion }`. **`rolloutApproved` is NOT accepted on this endpoint** — must go through the admin rollout route.
- Response 200: updated row + new ETag.
- Response 400 on Zod failure.
- Response 409 on ETag conflict (0 rows updated).
- Lazy-create branch: `expectedSettingsVersion === 0` and row absent → INSERT defaults + apply diff in a single transaction.
- **Lazy-create race handling:** if the lazy-create INSERT hits `23505 unique_violation` on the PK `subaccount_id` (two admins both read synthesised defaults, both submit `expectedSettingsVersion=0`, both race to INSERT — loser collides), the service catches the `23505`, re-reads the latest row, and returns HTTP 409 with the current `settings_version`. Same first-commit-wins contract as the regular ETag mismatch path; both losers retry with the new ETag.

POST `/api/admin/iee-browser/rollout-approval/:subaccountId`:
- Permissions: `authenticate` + `requireRole('system_admin')` + `resolveSubaccount` (scopes the audit row).
- Body (Zod): `{ approved: boolean, expectedSettingsVersion: number }`.
- Inside `withOrgTx`: UPDATE with `WHERE settings_version = $expectedSettingsVersion`; emit audit-log row (`action: 'iee_browser.rollout_approval_set'`, `prior_value`, `new_value`, actor, tenant, timestamp) in the same transaction.
- Response 200 with updated row.
- Response 409 on ETag conflict.
- Lazy-create allowed only when `expectedSettingsVersion === 0`. Same `23505 → re-read → 409` race handling as the settings PATCH path: if two system_admins race to lazy-create with `expectedSettingsVersion=0`, the loser hits `23505` on PK `subaccount_id`, the service catches, re-reads the latest row, and returns HTTP 409 with current `settings_version`.

Audit-log row contract (existing schema):
```jsonc
{
  "action": "iee_browser.rollout_approval_set",
  "actorUserId": "<uuid>",
  "organisationId": "<uuid>",
  "subaccountId": "<uuid>",
  "priorValue": false,
  "newValue": true,
  "timestamp": "2026-05-13T12:00:00Z"
}
```

**Error handling:**
- HTTP mapping:
  - `400 BadRequest` — Zod failure.
  - `403 Forbidden` — permission / role denial.
  - `404 NotFound` — admin route on a subaccount that doesn't exist (settings GET returns defaults instead).
  - `409 Conflict` — ETag conflict (response body includes the current `settingsVersion`). This covers BOTH the `WHERE settings_version=$expected` UPDATE returning 0 rows AND the lazy-create `23505` PK collision path.
  - `500 InternalServerError` — unexpected service throw.
- Service throw shape: `{ statusCode, message, errorCode? }` per `architecture.md` route conventions.
- ETag conflict is the only domain-specific error class introduced by this chunk; all other failures are infrastructure (permission, validation, server) handled by the existing route conventions.

**Test considerations (pure unit tests in `subaccountIeeBrowserSettingsServicePure.test.ts`):**
- Zod schema rejects out-of-range retention days (6, 91), out-of-range ceilings (0, 10001 / 100001), invalid status.
- ETag-conflict predicate: given expected version vs current version → returns "conflict" if mismatch.
- Audit-row builder: given inputs, produces the exact JSON above.
- Lazy-create predicate: `expectedSettingsVersion === 0` and row absent → "lazy-create"; row present → "ETag mismatch (conflict)".
- Lazy-create race classifier (pure): given a Postgres error with `code='23505'` and constraint name covering the settings PK → "conflict (re-read and return 409)"; any other 23505 → rethrow as 500.

**Dependencies:** chunk 2 (`subaccount_iee_browser_settings` table).

**Acceptance criteria:**
- Both routes use `asyncHandler` (no manual try/catch).
- Routes call services only; no direct `db` access in route handlers.
- ETag is `settings_version` (integer) per spec §8.3.
- `requireRole('system_admin')` enforces the admin route narrowly.
- Audit-log row emitted in the same transaction as the UPDATE.
- Client API wrapper matches the route shapes; types exported for `OperatorSettingsTab.tsx` (chunk 16) to consume.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npm run build:client`
- `npx vitest run server/services/__tests__/subaccountIeeBrowserSettingsServicePure.test.ts`

---

### Chunk 14 — Operator-backend defaults module

**spec_sections:** §7.4 (`operatorSettingsDefaults.ts` NEW + operator-backend service EXTEND), §1 (goal 7 — 3 removed fields replaced by constants), §10.2 (DB columns stay; forward-compat)

**Files to create or modify:**
- `server/services/operatorBackend/operatorSettingsDefaults.ts` (NEW — exports the 3 constants)
- `<operator-backend service file>` (EXTEND — substitute constants for the 3 cut per-subaccount fields; exact file resolved at chunk start by grepping for the current readers of `autoExtendGraceMinutes`, `maxChainLength`, `maxWallClockPerTaskDays` on `subaccount_operator_settings`. Likely candidates per primitives search: `server/services/operatorChainSchedulerService.ts`, `server/services/operatorChainResumeService.ts`. Builder confirms before editing.)
- `server/services/operatorBackend/__tests__/operatorSettingsDefaultsPure.test.ts` (NEW — pure test that exports the expected constants)

**Module shape:**
- *Public interface this chunk exposes:* Three exported constants:
  ```typescript
  export const AUTO_EXTEND_GRACE_MINUTES = 30;
  export const MAX_CHAIN_LENGTH = 100;
  export const MAX_WALL_CLOCK_PER_TASK_DAYS = 30;
  ```
- *What stays hidden behind it:* Nothing — this module is intentionally trivial. The point is a single discoverable revisit location.

**Contracts:**
- The DB columns for these three fields on `subaccount_operator_settings` remain (forward-compat). The operator-backend service stops READING them; the UI stops EXPOSING them (chunk 16); no PATCH path writes them. Future spec amendment may resume per-subaccount reads.

**Error handling:**
- None. Trivial module.

**Test considerations:**
- Pure-test asserts the three constants match the values above.

**Dependencies:** chunk 2 (`subaccount_iee_browser_settings` table — strictly speaking this chunk doesn't depend on the new table, but spec §6 sequencing places the operator-backend edit after the settings chunk so the two settings-area edits don't conflict).

**Acceptance criteria:**
- The three constants exist with the spec values.
- The operator-backend service uses the constants instead of reading from `subaccount_operator_settings`.
- DB columns on `subaccount_operator_settings` are NOT dropped (forward-compat).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/operatorBackend/__tests__/operatorSettingsDefaultsPure.test.ts`

---

### Chunk 15A — Alarm event registration + pure evaluator + per-task inline alarm

**spec_sections:** §7.4 (`incidentIngestor` EXTEND), §8.7 (alarm events table — task + warm_pool_miss only in this chunk), §11 (per-task alarm inline at harvest), §13.1 (alarm event emit safe + idempotent)

**Files to create or modify:**
- `server/services/incidents/incidentIngestor.ts` (or wherever event names register — verify at chunk start; EXTEND — register all three events at once: `iee_browser.task_cost_anomaly` + `iee_browser.subaccount_cost_anomaly` + `iee_browser.warm_pool_miss`)
- `server/services/sandbox/ieeBrowserCostAlarmEvaluatorPure.ts` (NEW — pure evaluator: exports BOTH `evaluateTaskCost` and `evaluateDailyCost`; the daily-evaluator wiring lives in chunk 15B)
- `server/services/sandboxHarvestService.ts` (EXTEND — call the per-task evaluator on each `subtype='task'` row write and emit `iee_browser.task_cost_anomaly` if breached)
- `server/services/sandbox/__tests__/ieeBrowserCostAlarmEvaluatorPure.test.ts` (NEW — pure tests covering both evaluators)

**Module shape:**
- *Public interface this chunk exposes:* The three registered incident-system events (registered together in one place to keep the registry edit atomic) + the pure evaluator functions (both task-level and daily — daily is exported here, called in 15B).
- *What stays hidden behind it:* The idempotency-key composition (`(event_name, agent_run_id)` for task anomaly; `(event_name, subaccount_id, day_utc, ceiling_cents)` for daily anomaly), the UI-help-text strings (event names are hidden from UI per brief).

**Note on registration sequencing:** `iee_browser.subaccount_cost_anomaly` is registered in 15A but has no emit path until 15B wires the daily rollup. This is intentional — the incident-system registry edit is kept atomic (all three events in one commit, one review), and the registered-but-not-yet-emitting event between 15A merge and 15B merge is a no-op (no firing surface, no UI exposure, no test impact). It is NOT a dangling registration; 15B's dependency on 15A makes the sequencing explicit.

**Contracts:**
- Per-task evaluator (pure):
  ```typescript
  function evaluateTaskCost(
    cost: { agentRunId: string; ieeRunId: string; subaccountId: string; costCents: number },
    settings: { perTaskCostCeilingCents: number }
  ): { fire: false } | { fire: true; payload: TaskCostAnomalyPayload };
  ```
- Per-day evaluator (pure — exported here, wired in 15B):
  ```typescript
  function evaluateDailyCost(
    rollup: { subaccountId: string; dayUTC: string; spendCents: number },
    settings: { perSubaccountDailyCostCeilingCents: number }
  ): { fire: false } | { fire: true; payload: SubaccountCostAnomalyPayload };
  ```
- Idempotency keys per spec §8.7:
  - `iee_browser.task_cost_anomaly`: `(event_name, agent_run_id)` — at most one task-cost incident per run.
  - `iee_browser.subaccount_cost_anomaly`: `(event_name, subaccount_id, day_utc, ceiling_cents)` — re-runs cannot duplicate; ceiling change mid-day produces a new incident under the new ceiling.
  - `iee_browser.warm_pool_miss`: metric only, no key.

**Error handling:**
- `incidentIngestor` deduplicates on the idempotency key per existing contract; double-fire is a no-op.
- Evaluator throw on negative cost → 500 (programmer error).
- Per-task evaluator invoked at harvest row-write is safe under harvest retry (incident dedup key absorbs).

**Test considerations (pure unit tests):**
- `evaluateTaskCost`: cost > ceiling → `fire: true` with correct payload; cost == ceiling → `fire: false` (strict greater-than per spec §8.7); cost < ceiling → no fire.
- `evaluateDailyCost`: same pattern (tested here even though the wiring is in 15B).
- Payload-builder includes the correct ceiling at the moment of evaluation (covers the ceiling-change-mid-day case).

**Dependencies:** chunks 2 (settings table for ceilings), 3 + 5 (`subtype` column + FK), 11 (harvest writes the `subtype='task'` rows the per-task evaluator reads).

**Acceptance criteria:**
- Three incident-system entries registered with the spec idempotency keys (task anomaly, subaccount anomaly, warm_pool_miss metric).
- Per-task evaluator called inline at harvest row-write; emits `iee_browser.task_cost_anomaly` on breach.
- `evaluateDailyCost` exported and unit-tested; its DB-wiring lives in chunk 15B.
- UI never sees the event name (only plain-English help text per brief).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/sandbox/__tests__/ieeBrowserCostAlarmEvaluatorPure.test.ts`

---

### Chunk 15B — End-of-day pg-boss rollup cron

**spec_sections:** §7.4 (cron handler for end-of-day rollup), §8.7 (`iee_browser.subaccount_cost_anomaly` wiring), §11 (per-day alarm queued via pg-boss end-of-day cron)

**Files to create or modify:**
- `server/jobs/<existing pg-boss cron handler or new file>` (EXTEND or NEW — end-of-day rollup job per spec §11; resolved at chunk start by grepping for existing cron handler patterns in `server/jobs/`. Likely an extend of an existing daily-rollup handler if one exists; new file otherwise. Builder confirms before editing. This open-lookup is tracked in §8 below.)
- `server/jobs/__tests__/<matching test file if pure helper exists>.test.ts` (NEW or EXTEND — only if the cron handler exposes a pure helper worth unit-testing; otherwise the chunk relies on the already-unit-tested `evaluateDailyCost` from 15A)

**Module shape:**
- *Public interface this chunk exposes:* A pg-boss cron entry that, once per day UTC per subaccount, reads the day's `subtype='task'` + `subtype='warm_pool'` rows from `llm_requests`, sums spend cents per subaccount, calls `evaluateDailyCost` (from 15A), and on `fire: true` emits `iee_browser.subaccount_cost_anomaly` via the existing incident-ingestor.
- *What stays hidden behind it:* The per-day rollup SQL (sums `cost_cents` over `created_at::date = $day_utc` filtered by subaccount); the cron schedule registration; the "all subaccounts with status='on'" sweep.

**Contracts:**
- Cron schedule: end-of-day UTC (matches existing daily-rollup cadence; exact cron expression matches the cron handler's existing pattern if extending, otherwise `0 0 * * *` UTC).
- Per-run loop: iterate subaccounts where `subaccount_iee_browser_settings.status='on' AND rolloutApproved=true`. For each, compute `spendCents` for the previous UTC day across `llm_requests` rows where `subtype IN ('task','warm_pool')` and the subaccount matches via the `agent_runs`/`subaccount_id` join (existing pattern in cost-rollup code).
- Idempotency: relies entirely on `incidentIngestor`'s key-based dedup `(event_name, subaccount_id, day_utc, ceiling_cents)`. Retries of the cron job for the same day are no-ops.
- Ceiling-change-mid-day correctness: `evaluateDailyCost` is called with the ceiling AS OF the rollup moment; if the operator raised the ceiling earlier in the day and a previous incident was emitted under the lower ceiling, the new key `(..., ceiling_cents=NEW)` permits a fresh emission under the new ceiling (per spec §8.7).

**Error handling:**
- Cron failures are retryable safely (key-based incident dedup).
- A subaccount with no `subtype='task'` rows for the day produces `spendCents=0` → `fire: false` → no emission. Trivial no-op.
- A subaccount whose `subaccount_iee_browser_settings` row is absent is skipped (defensive; expected impossible because status=on implies row exists).

**Test considerations:**
- `evaluateDailyCost` is already unit-tested in 15A. This chunk's wiring is mostly SQL + cron registration; a pure-helper test is only authored if the wiring exposes one (typical pg-boss handlers are thin).

**Dependencies:** chunk 15A (`evaluateDailyCost` export + event registration).

**Acceptance criteria:**
- End-of-day rollup cron runs daily; emits `iee_browser.subaccount_cost_anomaly` on breach via the existing incident-ingestor.
- Ceiling-change-mid-day produces a new incident under the new ceiling (verified by the key composition).
- Cron retries are no-ops via idempotency-key dedup.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

---

### Chunk 16 — UI: Operator settings tab + role predicate + tab pill

**spec_sections:** §1 (goal 7 — 4 new + 3 removed fields, predicate broadened, tab pill relabel), §7.6, §9 (v5 predicate expansion)

**Files to create or modify:**
- `client/src/pages/AdminSubaccountDetailPage.tsx` (EDIT — `canSeeOperatorTab` (lines 44–46) + `canEditOperatorSettings` (line 47) gain `subaccount_admin`; tab pill text `Org admin` → `Admin` (v6 mockup))
- `client/src/pages/govern/operatorSettings/OperatorSettingsTab.tsx` (EDIT — remove 3 `NumberField`s; add 3rd section "IEE browser" with 4 fields: `ToggleField` Status; `NumberField` Browser profile retention; `CurrencyField` per-task ceiling; `CurrencyField` per-subaccount daily ceiling)
- `client/src/pages/govern/operatorSettings/_fields.tsx` (EXTEND — export new components `ToggleField` and `CurrencyField`; `NumberField` unchanged)

**Module shape:**
- *Public interface this chunk exposes:* The new `ToggleField` + `CurrencyField` components, the rebuilt `OperatorSettingsTab` section list, the broadened role gate.
- *What stays hidden behind it:* The save-footer ETag-PATCH wiring (calls `client/src/api/ieeBrowserSettingsApi.ts` from chunk 13), the optimistic-vs-server-version reconcile on 409, the in-place `Org admin` → `Admin` pill text change, the empty-state when the settings row is absent (UI renders defaults).

**Contracts:**
- `ToggleField` props: `{ label: string; helpText: string; value: 'on' | 'off'; onChange: (v: 'on' | 'off') => void; disabled?: boolean }`.
- `CurrencyField` props: `{ label: string; helpText: string; valueCents: number; onChangeCents: (v: number) => void; minCents: number; maxCents: number; disabled?: boolean }`. Renders `$` prefix per round 2/3 mockup.
- Role predicate (exact per spec §9):
  ```typescript
  const canSeeOperatorTab = mode === 'admin' && (
    _user.role === 'org_admin' || _user.role === 'manager' ||
    _user.role === 'subaccount_admin' || _user.role === 'system_admin'
  );
  const canEditOperatorSettings =
    _user.role === 'org_admin' || _user.role === 'subaccount_admin' || _user.role === 'system_admin';
  ```
- IEE browser section rows (in field order):
  1. Status — `ToggleField`, default `'off'` for new subaccounts.
  2. Browser profile retention — `NumberField`, days, range [7, 90], default 30.
  3. Per-task cost ceiling — `CurrencyField`, cents, range [1, 10000], default 100.
  4. Per-subaccount daily cost ceiling — `CurrencyField`, cents, range [1, 100000], default 500.

**UX considerations:**
- **Loading state:** while GET is in flight, render the section skeleton with disabled fields.
- **Empty state:** if the GET returns synthesised defaults (`settingsVersion: 0`), the section renders normally; the save footer wires `expectedSettingsVersion: 0` for the lazy-create branch on first save.
- **Error state on save:** 409 → show inline error "Settings were changed by another admin; reload to see latest"; 400 → field-level Zod errors; 403 → render the tab in read-only mode (button hidden when `canEditOperatorSettings === false`).
- **Permissions gating visibility:** the `canSeeOperatorTab` predicate gates the tab; `canEditOperatorSettings` gates the save footer.
- **Real-time updates:** none in V1 — the tab re-fetches on focus per existing pattern. No WebSocket room added.
- **Mockup parity:** matches `prototypes/iee-browser-on-e2b.html` locked at round 3.1.

**Error handling:**
- 409 conflict: user-visible "reload to see latest"; auto-refetch on user retry.
- 400 Zod failure: field-level error messages.
- 403: tab read-only.
- Network errors: standard "Try again" CTA matching existing operator-settings patterns.

**Test considerations:**
- No frontend tests per `docs/spec-context.md` (`frontend_tests: none_for_now`). Visual / behavioural verification is human-in-the-loop against the locked mockup.

**Dependencies:** chunk 13 (`client/src/api/ieeBrowserSettingsApi.ts` and the route shapes).

**Acceptance criteria:**
- 3 `NumberField`s removed from `OperatorSettingsTab.tsx` (the operator-backend ones).
- 4 fields added in a new "IEE browser" section.
- `canSeeOperatorTab` + `canEditOperatorSettings` predicates broadened per spec §9 (verbatim).
- Tab pill text `Org admin` → `Admin`.
- No edits to other client files beyond the three listed.
- No edits to `client/src/pages/govern/operatorSettings/_fields.tsx` `NumberField` — only new exports.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

---

### Chunk 17 — DigitalOcean retirement + `verify-no-do-references.sh` CI gate

**spec_sections:** §4 (decision 7 — DO code paths deleted in this PR), §5 (genuinely new piece (j) — CI gate), §7.5 (worker file deletions), §7.9b (CI gate definition)

**Files to create or modify:**
- `worker/Dockerfile` (DELETE)
- `worker/src/handlers/browserTask.ts` (DELETE)
- `worker/src/handlers/runHandler.ts` (DELETE)
- `worker/src/handlers/cleanupOrphans.ts` (DELETE)
- `worker/src/runtime/queueMetrics.ts` (DELETE)
- `worker/src/runtime/cost.ts` (DELETE)
- `scripts/gates/verify-no-do-references.sh` (NEW)

**Module shape:**
- *Public interface this chunk exposes:* The absence of the 6 worker files + the locked-in absence via the CI gate.
- *What stays hidden behind it:* The grep patterns for forbidden DO tokens, the allowed-exceptions list (`tasks/`, `docs/decisions/`, `tasks/review-logs/`, `KNOWLEDGE.md`), the path-existence assertions for the 6 deleted files.

**Contracts:**

`scripts/gates/verify-no-do-references.sh` contract:

Forbidden tokens (greps against the repo excluding allowed exceptions). Token list expanded after a Phase 2 audit of current shorthand references in the repo (`worker/src/runtime/cost.ts` and `docker-compose.yml` use `vps`/`VPS`/`droplet`; these are either deleted in chunk 17 or cleaned in this chunk):
- `DigitalOcean`
- `digitalocean`
- `digital_ocean` (snake-case variant; defensive)
- `DO_VPS`
- `DO_DROPLET`
- `droplet` (case-insensitive grep — `-i` flag; chunk-start audit pass confirms no infrastructure or product term collides; if any post-retirement reference is legitimate, list it as an allowed-exception path rather than soften the grep)
- `\bVPS\b` (word-boundary; uppercase only)
- `\bvps\b` (word-boundary; lowercase only — narrow to avoid matching unrelated substrings like `https`)

Pre-flight audit at chunk 17 start: builder runs each of the above greps against the repo with the allowed-exception path list, surfaces any unexpected hit, and either deletes the reference (if it is DO-substrate residue) or moves the file into the allowed-exception path list (if it is unrelated). Only after the audit passes clean does the gate script land; this prevents the gate from blocking unrelated code at first CI run.

**Allowed-exception hygiene rule.** Every entry on the allowed-exception path list — both the four initial entries (`tasks/`, `docs/decisions/`, `tasks/review-logs/`, `KNOWLEDGE.md`) and any added during the pre-flight audit — MUST carry a one-line `#` comment inside `verify-no-do-references.sh` explaining why that path is not DigitalOcean substrate residue. Examples:
- `tasks/` — `# audit / build artefacts; references are historical record, not live substrate`
- `docs/decisions/` — `# ADR archive; preserves the decision to retire DO`
- `<new entry>` — `# <reason this token is not DO residue>` (e.g., "`droplet` here refers to a UI animation primitive, not infrastructure")

The comment requirement prevents the exception list from becoming a quiet bypass route: a reviewer scanning the script sees both the path and its rationale. New entries without rationale comments fail review.

Forbidden paths (must NOT exist post-retirement):
- `worker/Dockerfile`
- `worker/src/handlers/browserTask.ts`
- `worker/src/handlers/runHandler.ts`
- `worker/src/handlers/cleanupOrphans.ts`
- `worker/src/runtime/queueMetrics.ts`
- `worker/src/runtime/cost.ts`

Allowed exceptions (excluded from grep — audit / decision trail):
- `tasks/`
- `docs/decisions/`
- `tasks/review-logs/`
- `KNOWLEDGE.md`

Exit code: 0 on clean, non-zero on any violation. CI fails on non-zero.

The script integrates into the existing static-gates suite (wired in via the same hooks as `scripts/gates/verify-sandbox-classification.sh` and siblings).

**Error handling:**
- Script-layer only.
- Pre-existing violations: a chunk-17 pre-flight audit runs the expanded grep list against the working tree before the gate script lands. Known pre-existing hits to address as part of this chunk:
  - `worker/src/runtime/cost.ts` — deleted in this chunk (already on the delete list).
  - `docker-compose.yml` — if it carries DO-substrate references, they are cleaned in this chunk; if the references are unrelated infrastructure terminology, the file path is added to the allowed-exception list. Builder makes this call after reading the file.
- Any other DO reference in `server/`, `client/`, `shared/`, `worker/` (excluding the allowed-exception paths) surfaces during the audit; the chunk addresses that violation in the same change (delete, rename, or allowed-exception list) before the script lands.

**Test considerations:**
- The script itself is shell; no targeted Vitest. Executed by CI (per the test-gates-CI-only rule, builders do not run it locally).

**Dependencies:** chunks 1–16 (everything in the runtime substrate must work before deletions are safe).

**Acceptance criteria:**
- All 6 worker files deleted.
- `worker/package.json` retained (install manifest for the harness image).
- `worker/src/browser/*.ts` other than `playwrightContext.ts` are UNCHANGED (boundary marker per spec §7.10).
- `worker/src/loop/*`, `worker/src/llm/*`, `worker/src/persistence/*`, `worker/src/runtime/sampler.ts` UNCHANGED.
- `scripts/gates/verify-no-do-references.sh` exists, is executable, and is wired into the static-gates suite.
- All locally-runnable commands below pass (the gate script itself runs in CI, not locally).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npm run build:client`

---

### Chunk 18 — Doc-sync + placeholder cost-report + calendar todo

**spec_sections:** §7.8 (5 docs updated + 1 new), §7.9 (placeholder + todo), §16 (deferred items — month-1 cost-report mechanics)

**Files to create or modify:**
- `architecture.md` (EDIT — update sandbox-substrate references; remove DigitalOcean from deployment-context tables; add IEE-browser sandbox class to sandbox-classification table)
- `docs/iee-development-spec.md` (EDIT — DELETE Part 10 per R2-F7 split decision)
- `docs/iee-on-e2b-rollout.md` (NEW — successor to deleted Part 10; describes e2b first-launch criteria, dogfood gate, rollout-approval mechanic, alarm thresholds, post-launch cost-report cadence)
- `tasks/windows-iee-setup-guide.md` (EDIT — production-target paragraph rewritten to "production runs on e2b"; dev-setup steps preserved)
- `docs/synthetos-governed-agentic-os-brief-v1.2.md` (EDIT — substrate references checked, updated)
- `tasks/strategic-recommendations.md` (EDIT — DigitalOcean cost lines deleted or marked superseded)
- `tasks/builds/iee-browser-on-e2b/cost-report-month-1.md` (NEW — PLACEHOLDER per spec §7.9; merge gate; template only)
- `tasks/todo.md` (EDIT — add calendar-dated todo: `[2026-06-12] Complete tasks/builds/iee-browser-on-e2b/cost-report-month-1.md from observed production traffic.`)

**Module shape:**
- *Public interface this chunk exposes:* Up-to-date documentation matching the shipped substrate; a placeholder cost-report file that ships in this PR but is filled 30 days post-launch; a calendar-dated todo capturing the post-launch deliverable.
- *What stays hidden behind it:* The exact prose edits to each doc file (mechanical doc-sync per `docs/doc-sync.md`); the cost-report template structure (mirror the placeholder columns: subaccount, total spend, per-task avg, warm-pool overhead, alarm-fires count, recommendation).

**Contracts:**
- Cost-report placeholder shape:
  ```markdown
  # IEE-on-e2b Month-1 Cost Report (PLACEHOLDER)

  Target completion: 2026-06-12 (30 days post-launch).

  ## Per-subaccount summary
  | Subaccount | Total spend (cents) | Per-task avg | Warm-pool overhead | Alarms fired | Recommendation |
  |---|---|---|---|---|---|
  | (filled post-launch) | | | | | |

  ## Aggregate
  - Total `subtype='task'` spend: TBD
  - Total `subtype='warm_pool'` spend: TBD
  - Ratio: TBD
  - Recommendation: TBD (keep warm pool / disable / re-tune sizing)
  ```
- Todo line shape: `[2026-06-12] Complete tasks/builds/iee-browser-on-e2b/cost-report-month-1.md from observed production traffic.` (exact text per spec §7.9).

**Error handling:**
- Doc-layer only. No runtime impact.

**Test considerations:**
- None. Doc-sync is verified by the doc-sync sweep at finalisation per `docs/doc-sync.md`.

**Dependencies:** chunk 17 (DO retirement must be complete so the doc edits reflect the shipped state, not the pre-shipped state).

**Acceptance criteria:**
- All 5 doc edits land.
- `docs/iee-development-spec.md` Part 10 is deleted (entire section).
- `docs/iee-on-e2b-rollout.md` exists with the described structure.
- Placeholder cost-report file exists with the template above.
- `tasks/todo.md` carries the calendar-dated todo.

**Verification commands:**
- `npm run lint` (no code change, but cheap to run)
- `npm run typecheck` (same)

---

## 6. Risks & mitigations

| Risk | Mitigation | Surfaced in |
|---|---|---|
| **One-vendor risk on e2b.** Substrate redirect concentrates all browser tasks on a single sandbox provider. Outage = total IEE browser outage. | `SandboxExecutionService` abstraction (Spec B) is the abstraction layer. Spec §4 decision 9 accepts this risk for V1; a second provider is a future spec, not V1 scope. | Spec §4(9), §16; this plan §6 |
| **Spec B per-volume single-mount invariant.** The "two concurrent dispatches for same profile" correctness story (§13.3) relies on Spec B's provider-layer single-mount, NOT on a row UPDATE. If the e2b provider implementation does not honour this, two concurrent tasks could corrupt a profile. | Named CI plan-gate `ieeBrowserProfileManager.serialization.test.ts` (chunk 9) verifies before chunk 9 ships. If the gate fails, return to chunk 7 (provider mount logic) before resuming. | Spec §13.3, §15 R2-F6; this plan chunk 9 |
| **Migration ordering.** 0348 adds `warm_session_id` columns but the FK + unique partial index land in 0350 after 0349 creates the target table. A migration applied out of order would either fail (FK target missing) or violate the spec (FK skipped). | Chunks 3 → 4 → 5 strictly serial. The plan ordering matches migration numbering. `npm run db:generate` after each chunk verifies Drizzle ↔ migration agreement. | Spec §7.2; this plan chunks 3, 4, 5 |
| **DO retirement irreversibility.** Chunk 17 deletes `worker/Dockerfile` + 5 worker handlers + 2 worker runtime files. If a runtime chunk has a latent bug, rolling back the substrate requires git revert of the deletion commit. | Chunk 17 is sequenced AFTER all 16 runtime / settings / UI chunks are confirmed working. CI gate `verify-no-do-references.sh` lands in the same chunk; if a follow-up regression needs DO references back, the gate must be amended deliberately. | Spec §4(7), §7.5; this plan chunk 17 |
| **Warm-pool starvation under bursty load.** V1 size = 1 per subaccount, not configurable. Multiple concurrent human-triggered tasks for the same subaccount will starve and fall through to cold start. | Acceptable for dogfood (operator-gated, low concurrency). V2 sizing telemetry is in §16 deferred items. The `warm_pool_miss` metric (§8.7) captures the signal for capacity planning. | Spec §16 deferred items; this plan chunk 10 |
| **Cost-row idempotency on warm-session teardown.** Without the unique partial index, a teardown retry could write two idle-cost rows for the same warm session, double-billing. | Unique partial index `llm_requests(warm_session_id) WHERE subtype='warm_pool'` in chunk 5 (migration 0350). Chunk 10 catches `23505` as no-op. The FK action `ON DELETE RESTRICT` (R3-F3) surfaces any accidental DELETE attempt as a constraint violation rather than silently nulling out idempotency-bearing data. | Spec §10.3 deletion contract, §13.1; this plan chunks 5, 10 |
| **Rollout-approval ETag race.** Two admins race to flip rollout state for the same subaccount; without an ETag, last write wins and one decision is silently lost. | `expectedSettingsVersion` predicate (R2-F4) on the admin route's UPDATE. Loser sees HTTP 409 with the current `settings_version`. Audit-log row written in the same transaction as the UPDATE. | Spec §8.4 R2-F4; this plan chunk 13 |
| **Q3 sandbox provider path drift.** Spec §17 Q3 flagged the e2b provider exact file path as a Phase 2 lookup. | Verified during plan authoring: `server/services/sandbox/e2bSandbox.ts` exists. Documented in chunk 7. No inventory update required. | Spec §17 Q3; this plan chunk 7 |
| **Q4 pre-existing host-disk profiles.** If `BROWSER_SESSION_DIR` already contains data, lazy-create on first task could orphan it. | Per spec §17 Q4 ("likely no-op given dogfood-first") — chunk 8's `playwrightContext.ts` edit defaults `mountRoot` only in dev/test; production callers always supply. Existing host-disk profiles are orphaned and reclaimed by ordinary filesystem cleanup. No migration step needed. | Spec §17 Q4; this plan chunk 8 |
| **Cross-tenant mount via `session_key` collision.** A maliciously or accidentally crafted `session_key` matching another tenant's key could attempt to mount across tenants. | `ieeBrowserProfileManager.mount` asserts the task's `(org, subaccount)` matches the profile row's `(org, subaccount)` BEFORE the volume mounts. `session_key` is never sufficient alone. Plus the dual-GUC RLS policy on `iee_browser_session_profiles` filters at the DB layer. | Spec §9 invariant 1; this plan chunk 9 |
| **Operator-backend defaults drift.** The 3 constants in `operatorSettingsDefaults` substitute for 3 per-subaccount fields whose DB columns remain. Future operator may forget the constants are the source. | Single discoverable module `operatorSettingsDefaults.ts` with all three constants. Future amendment that resumes per-subaccount reads will touch this file first. Spec §10.2 explicitly notes DB columns stay for forward-compat. | Spec §7.4; this plan chunk 14 |
| **Status default mass-enable risk on backfill.** A migration that defaults `subaccount_iee_browser_settings.status` to `'on'` would enable IEE browser substrate for every existing subaccount in one commit, bypassing the operator-gated dogfood-first invariant. | Migration 0347 sets `DEFAULT 'off'` explicitly. Spec §3.5 brief v7 invariant locked. Reviewers will check the DDL string against the spec at chunk 2. | Spec §10.2, §3.5; this plan chunk 2 |

---

## 7. Self-consistency pass

- **Goals ↔ chunks:** all 7 goals in spec §1 map to chunks here.
  - Goal 1 (e2b for all browser tasks, no DO target) → chunks 6, 7, 12, 17.
  - Goal 2 (Playwright code preserved) → chunk 8 (only path resolution edit); spec §7.10 boundary marker.
  - Goal 3 (persistent profile reuses §3.15 keying) → chunks 1, 9.
  - Goal 4 (first launch on e2b, dogfood-first, operator-gated) → chunks 2, 12, 13.
  - Goal 5 (cost observable from day one via `llm_requests`) → chunks 3, 5, 11, 15A, 15B.
  - Goal 6 (warm pool size 1 per enabled subaccount) → chunks 4, 5, 10, 12.
  - Goal 7 (Operator settings tab: 4 new, 3 removed, predicate broadened) → chunks 13, 14, 16.
- **File inventory ↔ chunks (cross-reference against spec §7):** every file in §7.1 through §7.9b appears in exactly one chunk.
  - §7.1 schema files: chunks 1, 2, 3 (`llm_requests`), 4 (warm sessions + shared types).
  - §7.2 migrations 0346–0350: chunks 1, 2, 3, 4, 5.
  - §7.3 sandbox template: chunk 6.
  - §7.4 server services: chunks 7 (e2b provider), 9 (profile manager), 10 (warm pool), 11 (harvest), 12 (`_ieeShared`), 13 (settings service), 14 (operator-backend defaults), 15A (incident ingestor + per-task alarm), 15B (end-of-day rollup cron).
  - §7.5 worker files: chunk 8 (`playwrightContext.ts` edit); chunk 17 (deletes).
  - §7.6 client UI: chunks 13 (`ieeBrowserSettingsApi.ts`), 16 (`AdminSubaccountDetailPage`, `OperatorSettingsTab`, `_fields`).
  - §7.7 routes: chunk 13 (both).
  - §7.8 docs: chunk 18.
  - §7.9 placeholder + todo: chunk 18.
  - §7.9b CI gate: chunk 17.
- **Spec sections §8–§14 ↔ chunks:** every prose section is implemented by at least one chunk's `spec_sections:` mapping.
  - §8.1 (`SandboxRunTaskInput` extension) → chunks 4, 7, 12.
  - §8.2 (profile row) → chunks 1, 9.
  - §8.3 (settings row) → chunks 2, 13.
  - §8.4 (launch-flag check + admin rollout) → chunks 12, 13.
  - §8.5 (warm-session check-out) → chunks 4, 10.
  - §8.6 (cost-row discriminator) → chunks 3, 5, 10, 11.
  - §8.7 (alarm events) → chunks 4 (failureReason extension), 10 (`warm_pool_miss` emission), 15A (all three event registrations + per-task alarm), 15B (per-day rollup wiring).
  - §9 (permissions / RLS) → chunks 1, 2, 4 (RLS policies); chunk 13 (route guards); chunk 9 (cross-tenant mount assertion).
  - §10.1 / 10.2 / 10.3 (schema details) → chunks 1, 2, 4.
  - §11 (execution model) → chunk 6 (template), chunk 7 (provider inline), chunk 10 (warm pool in-process), chunk 9 (profile GC queued via pg-boss), chunk 15A (per-task alarm inline at harvest), chunk 15B (per-day alarm queued via pg-boss).
  - §12 (phase sequencing — single phase) → entire chunk order honours forward-only dependency graph.
  - §13.1–§13.7 (execution-safety contracts) → distributed across chunks 1, 2, 3, 4, 5, 9, 10, 12, 13, 15A, 15B.
  - §14 (`session_key` derivation policy) → chunk 12 (the pure helper).
- **Chunk-ordering check:**
  - Migration ordering 0346 → 0347 → 0348 → 0349 → 0350 is preserved by chunks 1 → 2 → 3 → 4 → 5.
  - 0348 column-only-no-FK; 0350 FK-after-target-table → chunk 3 produces 0348 columns only, chunk 5 produces 0350 FK + index.
  - Chunk 9 (profile manager) ships only after the named CI gate passes against chunk 7's e2b provider.
  - Chunk 17 (DO retirement) is sequenced AFTER chunks 1–16 are confirmed working.
  - `verify-no-do-references.sh` ships in chunk 17 alongside the deletes.
- **Single-source-of-truth claims:**
  - `iee_browser_session_profiles` is canonical for profile metadata; volume is canonical for profile contents (spec §8.2). Chunks 1, 9.
  - `subaccount_iee_browser_settings` is canonical for per-subaccount config (spec §8.3). Chunks 2, 13.
  - `llm_requests` (with new `subtype`) is canonical for cost (spec §8.6). Chunks 3, 5, 10, 11.
  - `operatorSettingsDefaults` is the single discoverable revisit location for the three constants (spec §7.4). Chunk 14.
- **No backward references.** Verified each chunk's `Dependencies:` line lists only earlier chunks.
- **Locked architectural constraints honoured:**
  - Warm pool size 1 — chunks 4 (unique partial index) + 10 (service uses it).
  - Cleanup lease-then-tear-down (no V1 reuse) — chunk 10 (no `leased → available` path).
  - Profile size cap 500 MB — chunk 1 (column default `524288000`).
  - Retention default 30, range 7–90 — chunk 2 (column default 30), chunk 9 (resolver clamps), chunk 13 (Zod schema).
  - CHECK constraints null-safe via `IS DISTINCT FROM` — chunk 3.
  - FK `ON DELETE RESTRICT` not `SET NULL` — chunk 5.
- **Numeric-count reconciliation against spec §7.11 totals:**
  - 3 new tables → chunks 1, 2, 4. ✓
  - 5 migration pairs → chunks 1, 2, 3, 4, 5. ✓
  - 2 schema column extensions on `llm_requests` → chunks 3 (columns), 5 (FK + index). ✓
  - 2 shared-type extensions → chunk 4. ✓
  - 1 new sandbox template → chunk 6. ✓
  - 3 new server services → chunks 9 (profile), 10 (warm-pool), 14 (defaults). ✓
  - 6 worker files deleted → chunk 17. ✓
  - 1 worker file edited → chunk 8. ✓
  - 3 client files edited → chunk 16. ✓
  - 1 new client API client → chunk 13. ✓
  - 2 new HTTP route files → chunk 13. ✓
  - 1 new CI gate script → chunk 17. ✓
  - 5 doc files updated + 1 new doc → chunk 18. ✓
  - 1 placeholder + 1 calendar todo → chunk 18. ✓
  - 1 named CI integration acceptance test → chunk 9 plan-gate. ✓
  - 2 alarm-wiring chunks (15A inline + 15B cron rollup) replacing the spec's single alarm chunk → both ✓; total chunk count 19.
- **Operator preferences honoured:** chat-level summary will be terse (plan path + chunk count + open lookups). Per-chunk "Verification commands" stay narrow (no test gates).

---

## 8. Open lookups for Phase 2 / executor

1. **Operator-backend service file to edit (chunk 14).** Spec §7.4 row reads "`server/services/operatorBackend/<existing operator-backend service file>` EXTEND" — the exact filename is resolved at chunk 14 by grepping for the three current readers of `autoExtendGraceMinutes`, `maxChainLength`, `maxWallClockPerTaskDays` on `subaccount_operator_settings`. Likely candidates per primitives search: `server/services/operatorChainSchedulerService.ts`, `server/services/operatorChainResumeService.ts`. Builder confirms before editing.

2. **`server/services/incidents/incidentIngestor.ts` exact path (chunk 15A).** Spec §7.4 row reads "`server/services/incidents/incidentIngestor.ts` (or wherever event names register)". Builder verifies the exact path at chunk 15A start.

3. **Pg-boss cron handler for end-of-day rollup (chunk 15B).** Spec §11 specifies "queued via pg-boss end-of-day cron". The build slot is either an existing cron handler file extended (preferred) or a new file. Builder resolves at chunk 15B start by grepping for existing cron handler patterns in `server/jobs/`. This is the primary reason the original chunk 15 was split: the cron-handler lookup crosses `server/jobs/` and is isolated from the inline harvest-path alarm wiring in 15A.

4. **Sandbox-cost rate primitive used by `sandboxHarvestService` (chunk 10).** Chunk 10's `terminate` / `evictStale` cost computation reads the per-second warm-pool rate from the same primitive that `sandboxHarvestService` uses to price `subtype='task'` rows (single source of truth — both subtypes share the rate model). The exact import path is resolved at chunk 10 start by inspecting `sandboxHarvestService.ts` for its rate-source call site. If no shared primitive exists yet, the builder extracts one as part of chunk 10 (small refactor; harvest-side call site untouched semantically) so the rate model has one owner.

These are file-path lookups, not design questions. They do not block plan acceptance.

---

## 9. Executor notes

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

Builder posture for each chunk:

1. Read the chunk's `spec_sections:` and re-read those spec sections before writing code.
2. Confirm the `Dependencies:` chunks are merged / present in the working tree.
3. Implement the files listed under "Files to create or modify".
4. Run the chunk's "Verification commands" — only lint, typecheck, build:server/build:client when relevant, and the single-file targeted Vitest for tests authored in THIS chunk.
5. Mark the chunk's TodoWrite item complete; surface any architectural ambiguity to the operator as a sub-plan, not an inline fix.
6. Stop at the chunk boundary; do not chain into the next chunk without operator gating if the plan-review revisions are exhausted.

Chunk 9 has an additional plan-gate: the named CI test `server/services/sandbox/__tests__/ieeBrowserProfileManager.serialization.test.ts` must pass against the e2b provider (chunk 7) before chunk 9 is marked complete. The test runs in CI, not locally — wait for CI signal before progressing.

Chunk 17 is the one-way door. Do not start chunk 17 until chunks 1–16 are confirmed working and the operator has gated the retirement explicitly.

## End of plan

