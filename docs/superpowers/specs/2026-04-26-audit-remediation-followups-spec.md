# Audit Remediation Follow-ups — Post-Merge Backlog Spec

**Created:** 2026-04-26
**Status:** draft (post-merge backlog)
**Source PR:** #196 — `feat/codebase-audit-remediation-spec`
**Source spec:** `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md`
**Related logs:**
- `tasks/review-logs/spec-conformance-log-audit-remediation-2026-04-25T11-00-13Z.md`
- `tasks/review-logs/pr-reviewer-log-audit-remediation-2026-04-25T12-21-49Z.md`
- `tasks/review-logs/dual-review-log-audit-remediation-2026-04-25T13-10-00Z.md`
- ChatGPT PR review session log (final-review on PR #196)

---

## Contents

- [§0 Why this spec exists](#0-why-this-spec-exists)
- [§1 Items](#1-items)
  - [Group A — Defence-in-depth gaps](#group-a--defence-in-depth-gaps-phase-12-follow-on)
  - [Group B — Test coverage gaps](#group-b--test-coverage-gaps)
  - [Group C — Observability / drift guards](#group-c--observability--drift-guards)
  - [Group D — Pre-existing pre-merge gates](#group-d--pre-existing-pre-merge-gates-that-crossed-the-line-in-this-pr)
  - [Group E — Pre-existing test/gate failures](#group-e--pre-existing-testgate-failures-unmasked-in-this-pr)
  - [Group F — Performance / efficiency](#group-f--performance--efficiency-follow-ups)
  - [Group G — Operational / pre-deploy gates](#group-g--operational--pre-deploy-gates)
  - [Group H — System-level invariants](#group-h--system-level-invariants)
- [§2 Sequencing](#2-sequencing)
- [§3 Out of scope](#3-out-of-scope-explicit-rejects-do-not-re-litigate)
- [§4 Tracking](#4-tracking)

---

## §0 Why this spec exists

PR #196 landed three audit-remediation phases (Phase 1 RLS hardening, Phase 2 gate compliance, Phase 3 architectural integrity) across 136 files / +38k lines. Four review passes (spec-conformance → pr-reviewer → dual-reviewer → chatgpt-pr-review) surfaced a set of concrete, individually-accepted improvements that were **deferred only because the PR was already too large** — not because they were wrong.

This spec consolidates every accepted-but-deferred item into a single addressable backlog so they don't get lost. Rejected items and items already resolved in-branch are explicitly excluded (see §3).

**Sequencing posture:** none of these items block PR #196 merge. They are post-merge work, sequenced by dependency and risk.

## §1 Items

### Group A — Defence-in-depth gaps (Phase-1/2 follow-on)

#### A1. Principal-context propagation: convert import-presence to actual call sites

**Source:** pr-reviewer S-2.
**Files:** `server/config/actionRegistry.ts`, `server/services/connectorPollingService.ts`, `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts`, `server/routes/webhooks/ghlWebhook.ts` (4 of 5 — `intelligenceSkillExecutor.ts` is correctly import-presence-only per spec §5.4 line 919).

**Gap:** Each file imports `fromOrgId` to satisfy `verify-principal-context-propagation.sh` but never calls it. The `canonicalDataService` callers continue to use legacy `(orgId, accountId, …)` signatures. Original spec §5.4 prescribed actual `fromOrgId(...)` invocations at every `canonicalDataService` call.

**Required:**
- (Upstream prerequisite) Migrate `canonicalDataService` method signatures to accept `PrincipalContext` instead of separate `(orgId, accountId)` params. This is the gating change.
- Then thread `fromOrgId(organisationId, subaccountId)` calls at the per-call-site level per spec §5.4's "Fix per file" table.
- Update `verify-principal-context-propagation.sh` to assert call presence, not just import presence (so a future drift back to legacy is caught).

**Test signal:** unit test that constructs a `PrincipalContext`, calls a `canonicalDataService` method with it, asserts the right org/subaccount session vars are bound.

**Risk:** medium — touches the canonicalDataService surface. Schedule as a dedicated Phase-2-followup PR.

#### A2. RLS write-boundary enforcement guard

**Source:** chatgpt-pr-review Round 1 — Surgical C.
**Files:** new — likely `server/lib/db/rlsBoundaryGuard.ts` or extend `getOrgScopedDb`.

**Gap:** `rlsProtectedTables.ts` is a declarative registry; nothing enforces that new tables get registered, and nothing enforces that writes to those tables happen through an RLS-aware connection.

**Required:**
- A runtime guard that, on dev/test, asserts every write target table is either listed in `rlsProtectedTables` OR carries an explicit `@rls-not-applicable` annotation.
- A static gate (`scripts/verify-rls-protected-tables.sh`) that diffs the schema's tenant-scoped table list against the registry; fails on unregistered tables.
- A migration-time check that warns when a new table introduces an `organisation_id` column without a corresponding RLS policy.

**Test signal:** introduce a deliberate gap (commit a new tenant table without registering it); the gate must fail.

**Risk:** medium — new architectural primitive, cross-cutting. Schedule before any new tenant tables land.

#### A3. `briefVisibilityService` and `onboardingStateService` migrate to `getOrgScopedDb`

**Source:** pr-reviewer N-1.
**Files:** `server/services/briefVisibilityService.ts`, `server/services/onboardingStateService.ts`.

**Gap:** Both new services use raw `db` from the global pool. The modern pattern (used by `agentRunPromptService`, `documentBundleService`) is `withOrgTx` / `getOrgScopedDb`. They lock in the older pattern by mistake.

**Required:** thread `organisationId` through the read paths; replace `db.select().from(...)` with `getOrgScopedDb(organisationId).select().from(...)`. Mirror the pattern from `documentBundleService.ts:672`.

**Test signal:** existing route tests should still pass; assertion that the service does not import `db` directly.

**Risk:** low — internal-only refactor.

### Group B — Test coverage gaps

#### B1. Pure unit test for `saveSkillVersion` orgId-required throw contract

**Source:** pr-reviewer S-5.
**File:** new — `server/services/__tests__/skillStudioServicePure.test.ts` (or extend an existing pure test).

**Gap:** the orgId-required throw added in PR #196 (`saveSkillVersion: orgId is required for scope=…`) has no test locking the contract.

**Required:** three assertions — `saveSkillVersion(id, 'org', null, …)` throws with exact message; `saveSkillVersion(id, 'subaccount', null, …)` throws; `saveSkillVersion(id, 'system', null, …)` happy-path executes. Compatible with `runtime_tests: pure_function_only` posture (no DB required if you mock the transaction).

**Test signal:** the test itself.

**Risk:** zero.

#### B2. Job idempotency audit + tests

**Source:** chatgpt-pr-review Round 1, Risk #4.
**Files:** `server/jobs/bundleUtilizationJob.ts`, `server/jobs/measureInterventionOutcomeJob.ts`, `server/jobs/ruleAutoDeprecateJob.ts`, `server/jobs/connectorPollingSync.ts`.

**Gap:** four new/expanded jobs — no documented idempotency story for any of them. Risk: race conditions between concurrent runs, duplicate execution under retry, jobs assuming state completeness.

**Required (per job):**
1. Document the idempotency strategy in a header comment (claim+verify, upsert-on-conflict, advisory lock, etc.).
2. Add a unique-constraint or advisory-lock guard if not already present.
3. Add a regression test: invoke the job twice in quick succession; assert the second invocation is a no-op or produces the same result.
4. Verify retry behaviour: simulate a transient DB failure mid-execution; assert no partial state.

**Test signal:** double-invocation regression tests per job.

**Risk:** medium — touches scheduler-adjacent logic. Sequence after A1 (some jobs may need PrincipalContext-aware data access).

#### B2-ext. Job concurrency guard standard

**Source:** chatgpt-pr-review Round 2.

**Gap:** B2 covers idempotency (same input → same effect). It does NOT cover concurrency: two runners executing the same job in parallel can both be "idempotent" yet still double-work, double-load, or conflict. There is no standardised concurrency control mechanism across the four jobs.

**Required (per job):**
- Define exactly one concurrency control mechanism: **advisory lock (preferred)**, singleton key, or queue-level exclusivity.
- Document the choice in a header comment using the standard form:
  ```
  Concurrency model: advisory lock on <key>
  Idempotency model:  upsert-on-conflict (or claim+verify, etc.)
  ```
- Reject implicit "shouldn't happen" assumptions and reliance on scheduler timing as the concurrency story.

**Test signal:** simulate parallel execution (two concurrent job invocations); assert exactly one effective execution path completes work, the other is a no-op.

**Risk:** medium — concurrency-control bugs are hard to surface in test; live carefully behind feature flag if a job runs at high frequency.

**Leverage:** very high at scale — eliminates a class of "but the job IS idempotent, why is this still broken?" failures.

### Group C — Observability / drift guards

#### C1. Baseline violation counts in `verify-*.sh` scripts

**Source:** chatgpt-pr-review Round 1, Surgical B.
**Files:** all `scripts/verify-*.sh` that currently exit `0/1/2`.

**Gap:** today gates emit binary pass/fail. There's no measurable regression signal — a script going from 13 violations → 14 looks the same as 13 → 13 unless you eyeball it.

**Required:** every gate should emit `[GATE] <name>: violations=<count>` on every run, in addition to its current PASS/FAIL/WARN line. CI captures the count over time; baselines move only when explicitly approved.

**Test signal:** a script's emitted line is grep-able and parseable; a CI job shows the count over the last N commits.

**Risk:** low — additive only.

#### C2. Architect.md context-section drift guard

**Source:** chatgpt-pr-review Round 1, Surgical A.
**Files:** new lint check, e.g. `.claude/hooks/architect-context-guard.js` or `scripts/verify-architect-context.sh`.

**Gap:** the canonical context-files section in `.claude/agents/architect.md` was collapsed in PR #196. If a future edit accidentally empties it, the architect agent silently loses context-loading capability.

**Required:** a hook or gate that asserts (a) the section exists, (b) it lists at least N files, (c) every listed file path resolves on disk.

**Test signal:** delete a path from the section → gate fails.

**Risk:** low.

#### C3. Canonical registry drift validation tests

**Source:** chatgpt-pr-review Round 1, Surgical D.
**Files:** new test under `server/services/__tests__/canonicalRegistryDriftPure.test.ts`; touches `canonicalDataService`, `canonicalDictionaryRegistry`, query-planner registries.

**Gap:** registries are manually maintained. A new feature can introduce a canonical table without an entry; runtime first surfaces the gap on a query miss.

**Required:** a pure test that lists every table in the schema with a canonical-* prefix, every table named in `canonicalDictionaryRegistry`, and every table named by query-planner; asserts the three sets agree.

**Test signal:** add a `canonical_*` table without registering it → test fails.

**Risk:** low.

#### C4. `actionRegistry.ts` comment cleanup

**Source:** pr-reviewer N-3.
**File:** `server/config/actionRegistry.ts:2-4`.

**Gap:** comment says "callers of canonicalDataService within this file should use fromOrgId() when the service migrates" but the file doesn't actually call canonicalDataService.

**Required:** rewrite the comment to match reality — "Imported to satisfy `verify-principal-context-propagation.sh`; this registry does not invoke `canonicalDataService` directly today; future handler additions that do should pass `fromOrgId(organisationId, subaccountId)` explicitly."

**Risk:** zero.

### Group D — Pre-existing pre-merge gates that crossed the line in this PR

#### D1. `verify-input-validation.sh` (44) + `verify-permission-scope.sh` (13) baseline capture

**Source:** spec-conformance REQ #35.
**Files:** `scripts/verify-input-validation.sh`, `scripts/verify-permission-scope.sh`; spec §5.7 / progress.md.

**Gap:** spec §5.7 step 3 says "new regressions introduced by Phase 2 work itself MUST be resolved before merge." No `main`-state baseline was captured pre-Chunk-2, so we can't prove Phase 2 didn't introduce any of the 44 + 13 warnings.

**Required:** stash; checkout `main`; run both gates; capture counts; restore. If counts unchanged or lower, append baselines to spec §5.7 / progress.md (closing the audit). If Phase 2 introduced any new warnings, fix them per spec §5.7 step 3.

**Test signal:** the baseline numbers themselves, recorded in a checked-in artefact.

**Risk:** low — investigative only.

#### D2. Server cycle count 43 vs ≤5 — operator framing decision

**Source:** spec-conformance REQ #43, pr-reviewer S-4.
**Files:** `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md` §6.3 / §13.3 / §13.5A; `tasks/builds/audit-remediation/plan.md`.

**Gap:** spec §6.3 DoD target is `madge --circular server/ ≤ 5`. Actual count after PR #196 is 43. The schema-leaf cascade WAS broken (the headline 175→43 reduction happened); the residual 43 are pre-existing chains the audit didn't enumerate.

**Required:** operator decision between three framings —
(a) extend a follow-on Chunk to drive the count down further;
(b) re-scope §6.3's DoD to "schema-leaf root cycle resolved; absolute count moved to Phase 5A";
(c) accept the 43 residual to Phase 5A and update §14 with the triaged cluster breakdown (skillExecutor↔tools, agentExecutionService↔middleware chains, agentService↔llmService↔queueService chain).

Capture decision in spec amendment + commit.

**Risk:** zero — decision-only.

#### D3. `verify-skill-read-paths.sh` clean-up (P3-H8)

**Source:** spec-conformance REQ #32; already tracked in `tasks/todo.md:862`.
**File:** spec §5.5 work; specific files TBD by enumeration.

**Gap:** gate currently reports `Literal action entries: 94, with readPath: 99` (count mismatch of 5). Spec §5.5 explicitly deferred this as lowest-priority enumeration work.

**Required:** enumerate the 5 mismatch sites; either add the missing readPath tags or update the gate's expected count. Cross-reference existing P3-H8 entry in `tasks/todo.md`.

**Risk:** low.

### Group E — Pre-existing test/gate failures unmasked in this PR

#### E1. Pre-existing unit test failures (4)

**Source:** test gate run during final-review.
**Files:** `referenceDocumentServicePure.test.ts`, `skillAnalyzerServicePureFallbackAndTables.test.ts`, `skillHandlerRegistryEquivalence.test.ts`, `crmQueryPlanner/__tests__/crmQueryPlannerService.test.ts`.

**Gap:** all four fail identically on `main` HEAD `ee428901` and on this branch — pre-existing, NOT branch regressions. PR #196 surfaced them but did not introduce them.

**Required:** triage each one — either fix or document why it's permanently skipped. Do this BEFORE the next audit-runner pass so they don't keep showing up as "unrelated noise".

**Risk:** low — already broken.

#### E2. Pre-existing gate failures (2 — independent of skill-read-paths)

**Source:** test gate run during final-review.
**Files:** `scripts/verify-pure-helper-convention.sh` (7 violations); `scripts/verify-integration-reference.mjs` (1 blocking error in `integration_reference_meta` YAML parse + 26 warnings).

**Gap:** both gates fail on `main`. Same triage rule as E1 — fix or baseline.

**Required:** for `verify-pure-helper-convention.sh`, decide whether the 7 `*Pure.test.ts` files that don't import from a sibling are misnamed (rename) or genuinely pure-self-contained (carry an exception annotation). For `verify-integration-reference.mjs`, fix the YAML parse error in `integration_reference_meta`.

**Risk:** low.

### Group F — Performance / efficiency follow-ups

#### F1. `findAccountBySubaccountId` targeted method on `canonicalDataService`

**Source:** pr-reviewer N-2.
**File:** `server/services/canonicalDataService.ts` (extend) + `server/jobs/measureInterventionOutcomeJob.ts:208-218` (consume).

**Gap:** Phase-2 mechanical fix replaced a direct SELECT with `canonicalDataService.getAccountsByOrg(organisationId)` + client-side `.find()`. Functionally correct but fetches all accounts to find one. At scale this becomes a hot spot.

**Required:** add `findAccountBySubaccountId(orgId, subaccountId)` to `canonicalDataService`; route the job through it.

**Test signal:** a unit test asserting the new method emits a single-row SELECT with both predicates.

**Risk:** low.

#### F2. `configDocuments` route in-memory `parsedCache` durability

**Source:** pr-reviewer N-5.
**File:** `server/routes/configDocuments.ts:33-36, 103`.

**Gap:** pre-existing — the file's own comment says "Phase 3 in-memory cache — swapped for a table-backed cache in Phase 4." Same defect class as Phase-5A §8.1 rate-limiter durability work (key-value with TTL, per-process state).

**Required:** consume the same primitive that lands as part of Phase-5A `rateLimitStoreService` — likely a generic `kvStoreWithTtl` table-backed shape — to remove the multi-process bug.

**Risk:** low — single route surface; hidden behind cache-miss → re-parse.

### Group G — Operational / pre-deploy gates

#### G1. Migration sequencing verification (pre-merge / pre-deploy)

**Source:** chatgpt-pr-review Round 1, Risk #2.

**Gap:** PR #196 adds new tables, RLS policies, budget policies, bundle systems. Migration ordering risk: writes can silently fail under FORCE RLS; existing flows can break without obvious errors.

**Required (run BEFORE merging PR #196 to main):**
1. Spin up a fresh DB. Run all migrations 0001..0227 in order. Verify zero errors. Verify the schema matches the drizzle introspection.
2. Take a snapshot of staging DB. Run only the new migrations on top. Verify zero errors and zero data loss.
3. Smoke test: under `app.organisation_id` set, run a write to each of: `agents`, `automations`, `memory_review_queue`, `document_bundles`, `agent_run_snapshots`. Each must succeed.
4. Smoke test: with `app.organisation_id` UNSET, run the same writes. Each must fail closed (zero rows affected, no exception leaked).

**Test signal:** the script's exit code + the per-table write log.

**Risk:** zero (pre-deploy validation, not runtime change).

**Sequencing:** before merging PR #196.

#### G2. Post-merge smoke test runbook

**Source:** chatgpt-pr-review Round 1, post-merge checklist.

**Required (run IMMEDIATELY after merging PR #196):**
- Create one agent via the admin UI; assert no errors in client/server logs.
- Trigger one automation; assert the workflow run completes.
- Trigger one webhook (GHL); assert the canonical-row write succeeds.
- Wait for one cycle of: `bundleUtilizationJob`, `measureInterventionOutcomeJob`, `ruleAutoDeprecateJob`, `connectorPollingSync`. Assert each runs without exception.
- Tail logs for 10 min: count WARN-level lines pre-merge vs post-merge; investigate any spike.
- Tail LLM router metrics for 10 min: cost-per-request, retry rate; investigate any spike.
- Capture any unexpected behaviour as a `KNOWLEDGE.md` entry under "Post-merge observations: PR #196".

**Test signal:** the runbook completes without escalation.

**Risk:** zero (observational).

**Sequencing:** immediately after merge.

### Group H — System-level invariants

#### H1. Cross-service dependency null-safety contract

**Source:** chatgpt-pr-review Round 2.

**Gap:** services may read derived or asynchronously-populated data (rollups, bundle outputs, job-produced state, cached projections) without guaranteeing availability. This creates hidden coupling between consumers and producers, and a partial-failure mode where:
- jobs run out of order, or
- partial data exists mid-computation, or
- a consumer assumes completeness, and
- the system degrades silently instead of failing visibly.

The codebase already does this correctly in many places (nullable enrichment patterns) but it's not enforced as a rule, so new services regress to "assume populated" by default.

**Required:**
- Codify the rule: **No service may assume existence of derived data produced by a job, rollup, or async pipeline unless that existence is enforced by a DB constraint OR is synchronously produced inside the same transaction.**
- Document the rule in `architecture.md` § "Architecture Rules" so new code is held to it during review.
- For every service read of: rollups, bundle outputs, intervention-outcome state, pulse-derived metrics, canonical-row enrichment fields produced asynchronously — treat the data as nullable.
- On null:
  - Return `null` (or empty list / sentinel object) — never throw.
  - Emit a WARN-level log line `data_dependency_missing: <service>.<field> for <orgId>` so operators can detect ramp-up gaps without a hard failure.
- Add an audit script (`scripts/verify-derived-data-null-safety.sh` — could be a follow-up to C1's gate-baseline pattern) that flags any `.field!` non-null assertion or `if (!data) throw` pattern on known-async fields.

**Test signal:** for each service that consumes derived data, a unit test that simulates "upstream not yet populated" and asserts the service returns null/empty without throwing or cascading failure.

**Risk:** low (additive defensive code).

**Leverage:** very high — closes one of the most common silent-degradation failure modes at scale.

## §2 Sequencing

| Order | Item | Why |
|---|---|---|
| 1 | G1 — migration verification | **Pre-merge gate.** Block PR #196 merge until this passes. |
| 2 | G2 — post-merge smoke test | Immediately after merge. Catches anything G1 missed. |
| 3 | E1, E2 — pre-existing failures | Cleanup pass; unblocks future audit signal. |
| 4 | D1, D2, D3 — pre-merge gate cleanups | Closes spec §5.7 / §6.3 audit-trail items. |
| 5 | B1, C4 — zero-risk additive | Tiny, free; do anytime. |
| 6 | A3, F1, F2 — internal refactors | Independent; ship as small PRs. |
| 7 | C1, C2, C3 — drift / observability | Independent; ship as a single "drift-guard" PR. |
| 8 | H1 — cross-service null-safety contract | High-leverage system rule. Codify before further service expansion; small audit script + architecture.md rule. |
| 9 | A1 — principal-context propagation | Depends on `canonicalDataService` signature migration. Major work. |
| 10 | A2 — RLS write-boundary guard | Architectural primitive. Schedule with §13.5A or its own phase. |
| 11 | B2 + B2-ext — job idempotency + concurrency standard | After A1 (some jobs need PrincipalContext-aware data access). Bundle idempotency audit with the concurrency-guard standardisation in the same pass. |

## §3 Out of scope (explicit rejects, do NOT re-litigate)

- **chatgpt-pr-review Round 1 watch-fors** with no concrete claim — "scope blast radius" / "cross-service coupling" / "LLM cost surface expansion" — already auto-rejected as advisory; no actionable item to track.
- **Codex's `anyBlocked` revert proposal** — rejected by dual-reviewer Claude-adjudication; would have triggered TS2367. Already handled with a clarifying comment in `server/services/skillExecutor.ts:2261-2265`.
- **PR splitting** — ChatGPT itself recommended NOT splitting at this stage. PR #196 ships intact.
- **Adding more abstraction layers / logging systems** — explicit chatgpt-pr-review reject; do not expand scope into the existing PR.

## §4 Tracking

When work begins on any item in §1, move it to a build slug under `tasks/builds/<slug>/`. Update this spec's status field on each item completion. The spec is "complete" when every §1 item is checked or moved out.
