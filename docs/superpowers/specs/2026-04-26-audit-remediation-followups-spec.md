# Audit Remediation Follow-ups — Post-Merge Backlog Spec

**Created:** 2026-04-25
**Last revised:** 2026-04-26 (ChatGPT review Round 4 — edge-case enforcement, drift prevention, follow-up coupling)
**Status:** draft (post-merge backlog, ready for spec-reviewer)
**Source PR:** #196 — `feat/codebase-audit-remediation-spec` (merged at `f824a03`)
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
    - [A1a — Principal-context propagation: service surface change (no gate hardening)](#a1a--principal-context-propagation-service-surface-change-no-gate-hardening)
    - [A1b — Principal-context propagation: gate hardening + caller enforcement](#a1b--principal-context-propagation-gate-hardening--caller-enforcement)
    - [A2 — RLS write-boundary enforcement guard](#a2--rls-write-boundary-enforcement-guard)
    - [A3 — briefVisibilityService + onboardingStateService → getOrgScopedDb](#a3--briefvisibilityservice--onboardingstateservice--getorgscopeddb)
  - [Group B — Test coverage gaps](#group-b--test-coverage-gaps)
    - [B1 — saveSkillVersion orgId-required throw test](#b1--saveskillversion-orgid-required-throw-test)
    - [B2 + B2-ext — Job idempotency audit + concurrency standard](#b2--b2-ext--job-idempotency-audit--concurrency-standard)
  - [Group C — Observability / drift guards](#group-c--observability--drift-guards)
    - [C1 — Baseline violation counts in verify-*.sh scripts](#c1--baseline-violation-counts-in-verify-sh-scripts)
    - [C2 — architect.md context-section drift guard](#c2--architectmd-context-section-drift-guard)
    - [C3 — Canonical registry drift validation tests](#c3--canonical-registry-drift-validation-tests)
    - [C4 — actionRegistry.ts comment cleanup](#c4--actionregistryts-comment-cleanup)
  - [Group D — Pre-existing pre-merge gates](#group-d--pre-existing-pre-merge-gates-that-crossed-the-line-in-this-pr)
    - [D1 — verify-input-validation + verify-permission-scope baseline capture](#d1--verify-input-validation--verify-permission-scope-baseline-capture)
    - [D2 — Server cycle count operator framing decision](#d2--server-cycle-count-operator-framing-decision)
    - [D3 — verify-skill-read-paths.sh cleanup (P3-H8)](#d3--verify-skill-read-pathssh-cleanup-p3-h8)
  - [Group E — Pre-existing test/gate failures unmasked in this PR](#group-e--pre-existing-testgate-failures-unmasked-in-this-pr)
    - [E1 — Pre-existing unit test failures (4)](#e1--pre-existing-unit-test-failures-4)
    - [E2 — Pre-existing gate failures (2)](#e2--pre-existing-gate-failures-2)
  - [Group F — Performance / efficiency](#group-f--performance--efficiency-follow-ups)
    - [F1 — findAccountBySubaccountId targeted method](#f1--findaccountbysubaccountid-targeted-method)
    - [F2 — configDocuments parsedCache durability](#f2--configdocuments-parsedcache-durability)
  - [Group G — Operational / pre-deploy gates](#group-g--operational--pre-deploy-gates)
    - [G1 — Migration sequencing verification (superseded — PR merged)](#g1--migration-sequencing-verification-superseded--pr-merged)
    - [G2 — Post-merge smoke test runbook](#g2--post-merge-smoke-test-runbook)
  - [Group H — System-level invariants](#group-h--system-level-invariants)
    - [H1 — Cross-service dependency null-safety contract](#h1--cross-service-dependency-null-safety-contract)
- [§2 Sequencing](#2-sequencing)
- [§3 Out of scope](#3-out-of-scope-explicit-rejects-do-not-re-litigate)
- [§4 Definition of Done](#4-definition-of-done)
- [§5 Tracking](#5-tracking)

---

## §0 Why this spec exists

PR #196 landed three audit-remediation phases (Phase 1 RLS hardening, Phase 2 gate compliance, Phase 3 architectural integrity) across 136 files / +38k lines. Four review passes (`spec-conformance` → `pr-reviewer` → `dual-reviewer` → `chatgpt-pr-review`) surfaced a set of concrete, individually-accepted improvements that were **deferred only because the PR was already too large** — not because they were wrong.

This spec consolidates every accepted-but-deferred item into a single addressable backlog so they don't get lost. Rejected items and items already resolved in-branch are explicitly excluded (see §3).

**Status as of this revision:** PR #196 has merged to `main` at commit `f824a03`. The pre-merge-gated item (G1) is therefore historical context only — it cannot be retroactively run. Post-merge work (G2) and the rest of the backlog (A–F, H) remain actionable.

**Pre-implementation audit (2026-04-25):** every code-claim in this spec was cross-checked against the current codebase. Result: 14/17 code-based items VALID (gap exists exactly as claimed), 3 PARTIAL (gap real, but with nuance — A1 (now split into A1a/A1b per ChatGPT review Round 1), A2, C4), 1 NOT VERIFIABLE (D2 is a decision item, not a code claim). The spec proceeds with all items.

**Sequencing posture:** none of these items are blocking; PR #196 is already shipped. They are post-merge work, sequenced by dependency and risk. See §2.

**Reviewer's contract:** each item below carries the same shape — Source, Files, Goal, Approach, Acceptance criteria, Tests, Dependencies, Risk, Definition of Done. A future implementer should be able to pick up a single item and ship it without rereading the source review logs. **Per-item status is tracked in §5 Tracking** — items do not carry an inline `Status:` field; the §5 table is the single source of truth so a status update only needs to land in one place.

**Testing posture (per `docs/spec-context.md`):** this spec sticks to (a) pure-function unit tests under the `*Pure.ts` + `*.test.ts` convention, (b) new static gates, and (c) the carved-out integration-test envelope already documented for hot-path concerns — RLS, idempotency / concurrency-control, and crash-resume parity. Items that propose runtime tests (A1a RLS-context binding, A2 RLS write-boundary guard, B2 job idempotency / concurrency, H1 derived-data null-safety) sit inside that carve-out. Items that propose anything outside the carve-out (e.g. multi-process integration tests in F2) call it out explicitly and downgrade to a documented manual smoke step where the framing requires it.

### §0.1 Gate quality bar (cross-cutting)

This spec adds several new static gates (C1, C2, C3, D3, E2, H1, plus the A1b gate hardening and A2's schema-diff gate). Individually each is justified; together they risk noisy CI, slow iteration, and engineers learning to ignore failures. Before any gate ships as **blocking**, it MUST meet all three of:

1. **False-positive rate < 5%** on the current `main` corpus. Estimate this by running the gate against `main` and inspecting every reported violation; if more than 1-in-20 are legitimate code that the gate misclassifies, the gate is too coarse to ship blocking.
2. **Deterministic failure mode** — the gate must always identify the same set of violations on the same input. No environment-dependent matching, no ordering-dependent regex, no time-of-day variance.
3. **Median time-to-fix < 10 minutes** for a typical hit — the violator can read the gate's output, locate the offender, and resolve it without rerunning the gate more than once.

If any of the three fails: ship the gate as **advisory** (logs the violation, exits 0) and promote to blocking only after the criteria hold over a 2-3 week observation window. Items in this spec that flag a gate as advisory-on-first-ship: H1. Items where the gate is blocking from day 1: A1b, A2 (schema-diff phase), C1 emit-line discipline, C2, C3. Each per-item DoD must state which mode the gate ships in.

This rule applies only to **new** gates introduced by this spec. Existing gates' modes are unchanged.

### §0.2 No new primitives unless named (cross-cutting)

No item in §1 may introduce a new abstraction, primitive, helper module, or system-level pattern unless that primitive is **explicitly named in the item's Files list and Approach section**. This prevents accidental mini-frameworks, helper sprawl, and inconsistency across items.

Concrete consequences:
- A1a / A1b introduce no new primitive — `withPrincipalContext` and `fromOrgId` already exist.
- A2 names exactly three new files (`server/lib/rlsBoundaryGuard.ts`, `scripts/verify-rls-protected-tables.sh`, `scripts/rls-not-applicable-allowlist.txt`) plus one hook. No additional helpers may emerge from A2 implementation. The `scripts/verify-rls-protected-tables.sh` gate carries three checks (schema-vs-registry diff per A2 step 1, `allowRlsBypass: true`-justification-comment enforcement per A2 flag-drift protection, AND the write-path advisory grep per A2 Phase-3 Proxy-coverage-completeness section per ChatGPT review Round 4) — a single file with three checks, not three files.
- B2 introduces no new primitive — uses existing `pg_advisory_xact_lock`, claim+verify, and lease patterns.
- F2 explicitly does NOT introduce a new generic `kvStoreWithTtl` primitive (already documented in §3 Out of scope and the F2 Approach).
- H1 names exactly two new files (`scripts/verify-derived-data-null-safety.sh` + the allowlist; `server/lib/derivedDataMissingLog.ts`). Anything else proposed during implementation is out-of-scope drift.

If implementation surfaces a need for a primitive not named in the item's Files list, **stop and write a follow-up spec** rather than expanding scope inline. This rule reinforces `prefer_existing_primitives_over_new_ones: yes` from `docs/spec-context.md`.

### §0.3 No cross-item scope expansion (cross-cutting)

An item in §1 may not expand its scope to fix adjacent issues discovered during implementation. If an implementer working on item X finds a problem in item Y's territory, or finds a problem outside any current item's territory, they MUST:

1. Stop, log the finding in `tasks/todo.md` (or as a new backlog item with the same shape as §1's items), and
2. Continue X's implementation against X's stated scope only.

The cost of allowing in-flight scope expansion is exactly the failure mode this spec was created to avoid: PR #196's 136-file blast radius landed because adjacent issues kept getting absorbed into the active branch. The ChatGPT review of this spec called this out explicitly for A1, A2, and B2; the rule generalises to every item.

This rule does NOT prevent integrity-fix mechanical edits inside the item's named files (e.g. fixing a forward reference within `canonicalDataService.ts` while migrating its surface in A1a). It DOES prevent "while I'm in here, let me also rename this unrelated helper" or "this caller is broken in a way the spec doesn't name, let me fix it as part of A3".

### §0.4 Determinism over cleverness (cross-cutting)

Where multiple implementation approaches exist for any item in §1, **preference MUST be given to the most deterministic and inspectable option over the most concise or abstract**. This rule aligns the implementation discipline already encoded in A1b (regex with AST fallback, not "infer from context"), A2 (explicit `allowRlsBypass` flag, not SQL inspection), B2 (injected `__testHooks` seam, not timing-based race control), C3 (forced two-set-or-three-set decision, not "either path is fine"), and D3 (explicit per-occurrence comment listing, not "trust the constant").

Concrete consequences:
- A regex pass that surfaces every match a human can read beats a clever metaprogramming approach that infers context.
- An explicit flag a caller passes beats inference from upstream/downstream code shape.
- A test seam that lets the test set the race outcome beats a `pg_sleep` that "usually" produces it.
- A forced binary decision documented in the spec beats a "we'll see at implementation time" branch.
- A list of every excluded item beats a calibration constant that "subtracts the right number".

If two approaches produce the same observable behaviour but differ on inspectability or determinism, pick the more inspectable / more deterministic one — even if it is more verbose. The goal is a spec that survives contact with implementation by multiple engineers without each engineer needing to re-derive the original intent. This rule is the meta-pattern under §0.1 (gate quality), §0.2 (no new primitives), and §0.3 (no scope expansion); it is stated explicitly so future items default to the same posture.

### §0.5 No silent success on partial execution (cross-cutting, per ChatGPT review Round 4)

Any operation in this spec — job, service method, gate, runtime guard, refactored consumer — that **partially executes** before discovering it cannot complete MUST do exactly one of the following:

1. **Roll back fully.** The partial state is unwound and the operation returns the same observable state it started with. Preferred for items where rollback is cheap (single-tx writes, in-memory caches).
2. **Return a structured partial-state result.** The operation returns a result shape that names which sub-steps succeeded and which did not (e.g. `{ status: 'partial', completed: [...], failed: [{ step, reason }] }`). Preferred for items where rollback is impossible (idempotent multi-step pipelines).
3. **Log explicit partial execution.** The operation emits at least one log line naming what was completed and what was not, at WARN level, before returning.

**What this rule rejects:** an operation that catches an error, swallows it, and returns a "success" shape that does not reflect the partial state. This is the failure mode the rule is named for — silent partial success is the worst kind of inconsistency because downstream callers cannot detect it.

**Concrete consequences across this spec:**
- B2's `{ status: 'noop', reason, jobName }` shape (with the §B2 Approach step 5 zero-side-effects invariant) is the canonical "rolled back fully" pattern for jobs.
- A2's runtime guard throws `RlsBoundaryUnregistered` / `RlsBoundaryAdminWriteToProtectedTable` on a protected-boundary violation rather than silently dropping the write.
- H1's null-safety helper (`logDataDependencyMissing`) is the canonical "log explicit partial execution" pattern for derived-data reads — the read returns `null`/empty/sentinel AND emits a WARN line naming the missing dependency.
- A1a's deprecated-shim path (during A1a only) MUST forward to the new `(principal, ...)` body — it MUST NOT silently no-op the call when `organisationId` is missing; the new body either succeeds or throws.

This rule generalises the per-item discipline already encoded in B2, A2, and H1 — codifying it at §0 ensures any future item added to this spec inherits the same posture without restating it. `architecture.md` § Architecture Rules carries one line stating this rule (landed in the same architecture.md update wave as the B2-ext concurrency-model rule and the H1 null-safety rule, not as a separate write).

### §0.6 Architecture default lock scope (cross-cutting, per ChatGPT review Round 4)

Where any item in §1 introduces or formalises a concurrency control mechanism for a job (B2 / B2-ext explicitly, plus any future job added to the four-job set), the **default lock scope is per-org** unless the job explicitly requires global serialization. "Per-org" means the advisory-lock key (or claim predicate, lease key, etc.) is parameterised on `organisationId` so two distinct orgs can run the job in parallel; a single org can only have one runner active at a time.

**Why this default matters:** without an explicit default, different engineers or agents will pick different lock scopes for similar jobs (org-level, global, per-entity), producing hard-to-debug contention or under-locking in production. The four jobs in B2 already follow this default in spirit — `bundleUtilizationJob` and `measureInterventionOutcomeJob` are per-org, `connectorPollingSync` is per-connection (which is a per-org sub-scope), and `ruleAutoDeprecateJob` is the documented exception (global). Stating the default explicitly forecloses the "I'll just pick one" failure mode for any future job.

**Concrete consequences:**
- A new job authored under §B2's standard MUST default to per-org lock scope. The header-comment block lists the lock scope explicitly so a reviewer can compare against the default at a glance.
- `ruleAutoDeprecateJob`'s global lock is OK because the job's per-job documentation block (per the §B2 standard header form) names the exception and explains the rationale ("global advisory lock — single runner; no per-org parallelism needed for nightly cadence").
- Any future deviation from per-org scope MUST carry the same rationale-in-header treatment. Reviewers MUST reject a global-lock job that does not explain why per-org doesn't fit.
- `architecture.md` § Architecture Rules carries one line stating this default — added in the same paragraph that B2-ext lands the concurrency-model rule, not as a separate rule.

This rule is the lock-scope analogue of §0.4 (determinism over cleverness): when the choice is between "an explicit default that handles the common case" and "let each engineer decide ad-hoc", pick the default.

### §0.7 Baseline rot prevention (cross-cutting, per ChatGPT review Round 4)

This spec records gate violation counts in the centralised store at `scripts/guard-baselines.json` (per `scripts/lib/guard-utils.sh`'s `check_baseline()` flow). The risk over time: baseline counts slowly creep upward as developers fold one extra exemption per PR, the running total stops triggering CI failure (the baseline is "current state"), and the gate's signal degrades to "things are about as bad as they were". The rule:

**Any PR that increases a baseline count in `scripts/guard-baselines.json` MUST include a PR-description note explaining why the increase is acceptable.** The note shape: `Baseline increase: <guard_id> from <N> to <M>. Reason: <one-sentence justification — what new code added the violation(s) and why it is OK to ship without fixing>.` "Just folding in pre-existing surface area" is acceptable; "didn't have time" is NOT.

**Concrete consequences:**
- A reviewer MUST reject a PR that increases a baseline without the note. The note is checked by the reviewer; there is no automated CI check (baseline diffs are inherently noisy, and an automated check would generate false positives on legitimate refactors that touch the gated surface). The rule is enforced socially, the same way the no-amend / no-force-push conventions are.
- Baseline DECREASES never require a note — a downward delta is always acceptable and welcome.
- A "no-change-but-cleanup" PR (decreases the baseline) is preferred over a "feature + baseline-increase" PR. When in doubt, split the work.
- Any guard whose baseline has grown more than 20% over the last quarter (rolling) should trigger an explicit reset-and-fix sweep, scoped as a separate spec — the gate's signal has eroded enough that the next baseline-increase PR is hard to evaluate.

This rule applies to every gate this spec touches (existing gates being baselined for the first time, AND new gates that ship with their initial baseline at zero or a documented starting count). E2 in particular must follow this rule when capturing its `verify-pure-helper-convention.sh` and `verify-integration-reference.mjs` baselines — see E2 Acceptance criteria.

---

## §1 Items

### Group A — Defence-in-depth gaps (Phase-1/2 follow-on)

**Note on splitting (per ChatGPT review Round 1):** The original A1 was a single 3-5-day item. It has been split into A1a (service-surface change, no gate hardening) and A1b (gate hardening + caller enforcement, with old signatures removed). Splitting reduces blast radius — the surface change can land independently and be exercised in dev/test before the gate flips and forces every caller to comply. **Effort estimate (revised):** A1a 2-3 days; A1b 1-2 days. Total ~4-5 days, slightly higher than the original "3-5 days" because the split adds a coordination cost — but each sub-PR is reviewable in isolation.

#### A1a — Principal-context propagation: service surface change (no gate hardening)

**Source:** pr-reviewer S-2 (split per ChatGPT review Round 1).

**Audit verdict (2026-04-25):** PARTIAL — gap is real. All 4 files import `fromOrgId` but `grep -n "fromOrgId(" <file>` returns zero call sites in any of them. `canonicalDataService` method signatures still accept bare `(organisationId, accountId, …)` (e.g. `upsertAccount(organisationId, connectorConfigId, …)` at `server/services/canonicalDataService.ts:261`, `upsertContact(organisationId, accountId, …)` at `:294`). The verify script (`scripts/verify-principal-context-propagation.sh:29`) accepts an import as proof of compliance — it does not check call presence.

**Files:**
- Caller files (4 of 5 — `server/services/intelligenceSkillExecutor.ts` is correctly import-presence-only per the original audit spec §5.4 line 919):
  - `server/config/actionRegistry.ts`
  - `server/services/connectorPollingService.ts`
  - `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts`
  - `server/routes/webhooks/ghlWebhook.ts`
- Service surface to migrate: `server/services/canonicalDataService.ts` (31 exported methods at the time of this writing).
- Type/shim: `server/services/principal/fromOrgId.ts`, `server/services/principal/types.ts` (existing).

**Goal:** add `PrincipalContext` as the accepted first-parameter shape on every `canonicalDataService` method, and migrate every non-test caller to pass it. **Do NOT flip the gate yet** — A1a leaves the gate at file-level import enforcement; A1b flips it to call-site granularity.

**Approach (in order):**
1. **Inventory.** Enumerate every `canonicalDataService.<method>(...)` call site in `server/` (excluding `__tests__`). Group by method signature shape: `(orgId)`-only, `(orgId, accountId)`, `(accountId, orgId?)`, write methods, etc. Capture the inventory in `tasks/builds/<slug>/canonical-call-sites.md` so the migration is auditable.
2. **Service-side migration.** For each `canonicalDataService` method, change the signature to accept `PrincipalContext` as the first parameter; derive `organisationId` (and `subaccountId` where applicable) from it internally. The current method surface mixes two shapes — most methods are positional (`getAccountById(accountId, organisationId)` etc.), and a small number take an args-object (`listInactiveContacts(args: { orgId, subaccountId, ... })` at `:493`). Migration shape per category:
   - **Positional methods** become `(principal: PrincipalContext, ...rest)` — `principal` is the new first positional, the original positional args (e.g. `accountId`) follow.
   - **Args-object methods** become `(principal: PrincipalContext, args: { ... })` — `principal` is the first positional, the original args object becomes the second positional. The `orgId` / `subaccountId` fields come OUT of the args object (they live on `principal` now); other fields stay where they were.
   - The choice between "second positional principal-on-args" (`{ principal, ...args }`) and "split positional" (`(principal, args)`) must be uniform — pick one for the whole service. Recommended: split positional, since most methods are positional today and a single shape is easier to grep against in the gate (this becomes load-bearing in A1b).

   Each method body MUST wrap its DB work in `withPrincipalContext(principal, async (tx) => { ... })` from `server/db/withPrincipalContext.ts` — this is the named primitive that binds `app.current_subaccount_id`, `app.current_principal_type`, `app.current_principal_id`, and `app.current_team_ids` on top of the org-scoped tx that `withOrgTx` already opened. The `app.organisation_id` session var is set by the upstream `withOrgTx` opened in `server/middleware/auth.ts` or `server/lib/createWorker.ts`; principal vars are set by `withPrincipalContext`. Read methods that accept `accountId` keep `accountId` as a separate parameter — `PrincipalContext` describes the requesting principal, not the target row.
3. **Brief shim allowed during A1a only.** A1a may keep the old positional `(organisationId, ...)` signature as a deprecated overload that internally calls `fromOrgId(organisationId, null)` and forwards to the new `(principal, ...)` body. The shim exists to let A1a land without forcing every caller to migrate in the same PR — it is **temporary**. A1b removes the shim. The shim must carry a `// @deprecated — remove in A1b` JSDoc tag so a grep can find every shim in A1b.
4. **Caller migration.** Update every call site identified in step 1 to pass `fromOrgId(organisationId, subaccountId)` (or `fromOrgId(organisationId, null)` where there is no subaccount in scope). The 4 import-only files convert their imports into actual calls. **Do NOT** rely on the shim for new code — every caller migrates in A1a; the shim is only there to permit a multi-PR rollout if A1a itself is split further.
5. **PrincipalContext-construction discipline.** A `PrincipalContext` value MUST be obtained via one of:
   - The `fromOrgId(organisationId, subaccountId)` constructor in `server/services/principal/fromOrgId.ts`, OR
   - Propagation of an existing `PrincipalContext` value already in scope (e.g. a function parameter typed `principal: PrincipalContext`, or a value pulled out of `withPrincipalContext`'s callback signature).

   Inline object literals (`{ organisationId: '…', subaccountId: '…', … } as PrincipalContext`), bare `as PrincipalContext` casts on a partial object, and ad-hoc helpers that return a `PrincipalContext`-shaped object are NOT acceptable in non-test code. This is a contract reinforcement — A1b's gate matcher (per its positive-allowlist) already enforces this at the `canonicalDataService.<method>(` call boundary; this rule extends the discipline to every site where a `PrincipalContext` is materialised.

   Tests are exempt: test fixtures may construct `PrincipalContext` values inline so test setup stays terse. Production code must use `fromOrgId` or propagation.

**Acceptance criteria:**
- Every `canonicalDataService` method accepts `PrincipalContext` as its first parameter (with deprecated overload retained per step 3).
- Every non-test caller in `server/` passes `fromOrgId(...)` or an existing `PrincipalContext` value.
- TypeScript compiles cleanly. `npm run build:server` passes.
- The existing file-level gate (`scripts/verify-principal-context-propagation.sh`) continues to pass at file granularity (unchanged in A1a).

**Tests required:**
- New: `server/services/__tests__/canonicalDataService.principalContext.test.ts` — constructs a `PrincipalContext` via `fromOrgId(orgId, subaccountId)`, calls one read method (e.g. `getAccountById`) and one write method (e.g. `upsertAccount`), asserts:
  - `withPrincipalContext` is invoked inside the method body (verified via spy / mock on the imported helper).
  - The org-scoped session var (`app.organisation_id`) is bound by the upstream `withOrgTx` for the duration of the call.
  - The principal session vars (`app.current_subaccount_id`, `app.current_principal_type`, `app.current_principal_id`, `app.current_team_ids`) are bound by `withPrincipalContext` when the principal carries those fields.
  - Calling without `PrincipalContext` (e.g. passing `null as any`) throws a clear error before any DB work is done.

**Dependencies:** none.

**Risk:** medium. Touches the entire `canonicalDataService` surface (31 methods) and every non-test caller. Mitigation: shim retained during A1a so a half-migrated state is reviewable; the gate is NOT flipped until A1b.

**Definition of Done:**
- All caller files updated; all method signatures migrated; every method body wraps its DB work in `withPrincipalContext(...)`.
- Deprecated shim retained on every method with the `// @deprecated — remove in A1b` JSDoc tag.
- New unit test under `__tests__` locks the contract.
- `npm run build:server`, `npm run lint`, and the existing `scripts/verify-principal-context-propagation.sh` all pass.
- A1a row in `§5 Tracking` is checked.

---

#### A1b — Principal-context propagation: gate hardening + caller enforcement

**Source:** pr-reviewer S-2 (split per ChatGPT review Round 1).

**Goal:** with A1a's surface change shipped, flip the gate from file-level to call-site granularity, remove the deprecated shims, and prove the gate fires on a deliberate regression.

**Files:**
- Gate to harden: `scripts/verify-principal-context-propagation.sh`.
- Service surface: `server/services/canonicalDataService.ts` (remove `// @deprecated — remove in A1b` shims from all 31 methods).
- Existing callers (verify still compliant after shim removal).

**Approach (in order):**

**Pre-condition — shim-usage detection (per ChatGPT review Round 4).** A1b MUST NOT begin until the implementer has confirmed every caller migrated off the deprecated overload during A1a. The spec-described worry: A1a permitted the shim, callers may silently still depend on it, tests pass anyway, and A1b's shim-removal then breaks production paths that were never migrated. Mandatory pre-flight checks (run BEFORE any code in step 1):

1. `grep -rn "@deprecated — remove in A1b" server/` — assert exit count is N (the count A1a landed) and no caller-side suppression / re-export removed the tag from any shim. Every shim must still carry the tag at A1b kickoff.
2. `grep -rn "canonicalDataService\.\w+(\s*organisationId" server/ | grep -v __tests__` — assert exit count is **0**. Any non-test caller that still passes a bare `organisationId` first argument to a `canonicalDataService.<method>(` invocation is a missed A1a migration; it MUST be migrated and merged BEFORE A1b proceeds.
3. `grep -rn "canonicalDataService\.\w+(\s*orgId" server/ | grep -v __tests__` — same check against the alternative variable name. Asserted count: **0**.
4. Cross-check: list every file from A1a's `tasks/builds/<slug>/canonical-call-sites.md` inventory and confirm each call site now passes `fromOrgId(...)` or a `: PrincipalContext`-typed identifier. Any inventory entry without a verified migration blocks A1b.

If any check returns non-zero, A1b stops and the offending caller migrates first (in A1a's PR or as a follow-up A1a-2 PR). The grep commands above are the pre-condition; no "checked manually" or "looks fine" variant is acceptable. Capture the four greps' exact output (commit hash, file:line list, exit codes) in `tasks/builds/<slug>/progress.md` so a reviewer can confirm A1b started cleanly.

1. **Remove shims.** Grep for `// @deprecated — remove in A1b`; delete each deprecated overload. After deletion, only the `(principal, ...)` signature remains.
2. **Gate hardening.** Update `scripts/verify-principal-context-propagation.sh` so that the file-level "imports a principal-context utility" check is no longer enough — every `canonicalDataService.<method>(` invocation in the file must pass a `PrincipalContext`-shaped first argument (call-site-level enforcement, not file-level). The right approach is a positive allowlist of accepted first-argument shapes rather than a narrow negative matcher:
   - **Positive allowlist (accepted first-argument shapes):** the gate accepts a `canonicalDataService.<method>(` call only when the first argument matches one of:
     - `fromOrgId(` / `fromOrgId<` (the explicit constructor)
     - `withPrincipalContext(` (called inline)
     - A locally-typed `PrincipalContext` variable — detected via a same-file `: PrincipalContext` annotation in scope (function parameter list or `const principal: PrincipalContext = ...`).
   - **Bare identifiers, raw object literals (`{ organisationId: ... }` style), and spread expressions in the first-argument position are violations.** Note that under A1a's split-positional shape, the args object — when present — is the SECOND positional argument, not the first; an object literal as the second argument is fine. The gate's matcher inspects only the first argument's shape.
   - Implementation: a small TypeScript-aware lint rule using the TypeScript compiler API would be ideal, but a regex pass is sufficient for v1 — match `canonicalDataService\.\w+\(\s*([^)]*)` and assert the first argument starts with `fromOrgId(`, `withPrincipalContext(`, or matches a known same-file `: PrincipalContext`-typed identifier.
   - **Regex-fallback contract.** The regex matcher's known weak spots (per ChatGPT review Round 2): imported typed variables (e.g. `import { defaultPrincipal } from '../fixtures'` then `canonicalDataService.upsertAccount(defaultPrincipal, …)`), destructured parameters, helper-function wrappers that return a `PrincipalContext`. These categories produce false negatives (unsafe call slips through) or false positives (legitimate call flagged) under the regex approach. **Constraint — concrete trigger (per ChatGPT review Round 3):** the FP/FN rate is measured against a **minimum sample of 50 `canonicalDataService.<method>(` call sites** drawn from current `main` during the first dogfooding pass. If the sample contains **≥3 confirmed misclassifications** (false negatives where an unsafe call passed, or false positives where a legitimate call was flagged) caused by the categories above, AST fallback is **mandatory** — the implementer MUST upgrade the matcher to a minimal TypeScript AST check scoped ONLY to `canonicalDataService.<method>(` call expressions. The AST check inspects the type of the first argument's identifier and asserts it resolves to `PrincipalContext`. The AST upgrade is implemented inside the gate script (or a sibling `.mjs` co-located with it), NOT as a new general-purpose AST primitive. This decision must be made at implementation time based on the sampled rate; do not leave it to "we'll see" — log the sample (50 sites, file:line list) and the misclassification count in the build-slug progress log and either ship the regex with evidence that <3 misclassifications were observed, or ship the AST upgrade with the same evidence. If fewer than 50 call sites exist on `main` at the time of measurement, sample every call site that exists; the ≥3-misclassification trigger still applies.
   - Keep import-only suppression available via `is_suppressed` AND via the `@principal-context-import-only` annotation (see step 3) for legitimate cases (e.g. `intelligenceSkillExecutor.ts`).
   - The gate must reject a file that imports `canonicalDataService` and has at least one invocation that does NOT pass a `PrincipalContext`-shaped first argument, even if other invocations in the same file are correctly migrated.
3. **Annotation contract.** Files that legitimately import without calling (e.g. registry files where the import is forward-looking) must carry a top-of-file annotation: `// @principal-context-import-only — reason: <one-sentence rationale>`. The gate scans for this annotation and exempts the file.
4. **Suppression sweep / baseline.** This gate's violation count is recorded in the centralized baseline store at `scripts/guard-baselines.json` (keyed on `principal-context-propagation`, consistent with every other guard in `scripts/lib/guard-utils.sh`'s `check_baseline()` flow). After A1a's caller migration, the entry must drop to zero. Do NOT introduce a per-guard `tasks/baselines/*.txt` — that pattern is rejected throughout this spec.
5. **Gate-quality bar (per §0.1).** The hardened gate ships **blocking** from day 1 — A1a's caller migration drove FP-rate to zero on `main`, the matcher is deterministic (regex pass), and a typical fix is "wrap the offending arg in `fromOrgId(...)`" which takes <1 minute.

**Acceptance criteria:**
- All `// @deprecated — remove in A1b` overloads deleted from `canonicalDataService.ts`.
- `scripts/verify-principal-context-propagation.sh` fails when **any** `canonicalDataService.<method>(` invocation in an importing file passes a non-`PrincipalContext` first argument (call-site granularity, not file granularity), AND when the file has no `@principal-context-import-only` annotation.
- A deliberate test regression — drop a `fromOrgId(...)` call from any caller, leaving a bare-`organisationId` invocation — causes the gate to fail even if other invocations in the same file are correctly migrated.
- Gate emits the C1 standard count line `[GATE] principal-context-propagation: violations=<count>` (assumes C1 has shipped per §2 sequencing).

**Tests required:**
- Gate self-test: a fixture file under `scripts/__tests__/principal-context-propagation/` that intentionally violates the new rule (one fixture per accepted-shape category — bare identifier, object literal, spread); the gate must report each.

**Dependencies:** A1a (must ship before A1b — A1b removes the shims A1a introduced). C1 preferred (so the hardened gate emits the standard count line from day 1).

**Risk:** low — A1a already migrated every caller; A1b is mostly mechanical (delete shims, flip the gate's matcher, add fixture tests).

**Definition of Done:**
- Pre-condition shim-usage greps (per Approach pre-flight section above) executed BEFORE any A1b code change; output captured in `tasks/builds/<slug>/progress.md`; counts: greps 2 and 3 == 0, grep 1 == N (the A1a-landed shim count), and the cross-check from inventory passes for every entry.
- All shims deleted.
- Gate updated to call-site granularity with the positive-allowlist matcher; baseline entry in `scripts/guard-baselines.json` regenerated; deliberate-regression fixtures pass for each accepted-shape category.
- `npm run build:server`, `npm run lint`, and `bash scripts/verify-principal-context-propagation.sh` all pass.
- A1b row in `§5 Tracking` is checked.

---



#### A2 — RLS write-boundary enforcement guard

**Source:** chatgpt-pr-review Round 1 — Surgical C.

**Audit verdict (2026-04-25):** PARTIAL — `server/config/rlsProtectedTables.ts` exists and is comprehensive (47 entries with rationale). But: no runtime guard exists that enforces new tables get registered or that writes go through an RLS-aware connection. No file `rlsBoundaryGuard.ts` or `scripts/verify-rls-protected-tables.sh`. The header comment in `rlsProtectedTables.ts:8` references `scripts/gates/verify-rls-coverage.sh` — the actual script lives at `scripts/verify-rls-coverage.sh` (no `gates/` subdirectory in this repo); it verifies the registry-vs-migrations linkage, not the schema-vs-registry diff or write-path enforcement.

**Files (new + edits):**
- New: `server/lib/rlsBoundaryGuard.ts` — runtime guard layered on top of `getOrgScopedDb` / `withAdminConnection` (sibling to `orgScopedDb.ts`, NOT under a new `server/lib/db/` subdirectory; the existing DB helpers live directly under `server/lib/`).
- New: `scripts/verify-rls-protected-tables.sh` — schema-vs-registry diff gate.
- New: `scripts/rls-not-applicable-allowlist.txt` — explicit allowlist for tables that legitimately have `organisation_id` but no RLS (single source of truth for both the gate and the runtime guard; supersedes the schema-file-comment annotation that earlier drafts proposed but neither schema-introspection nor SQL-parsing can read).
- New: `.claude/hooks/rls-migration-guard.js` — pre-commit hook that warns when a new migration creates an `organisation_id` column without an accompanying `CREATE POLICY`. Scans `migrations/*.sql` (top-level — this repo's migrations live at `migrations/`, NOT `server/db/migrations/`).
- Edits: `server/config/rlsProtectedTables.ts` (header-comment path correction), `scripts/verify-rls-coverage.sh` (cross-link to new gate).
- Test: `server/lib/__tests__/rlsBoundaryGuard.test.ts`.

**Goal:** make the `rlsProtectedTables` registry self-enforcing on three fronts — (1) schema drift (every tenant table appears), (2) migration-time signal (new tables prompt explicit RLS decisions), (3) write-path enforcement (writes to listed tables refuse non-RLS-aware connections in dev/test).

**Phasing (per ChatGPT review Round 1):** A2 ships in three sequential phases, NOT all at once. The three phases are independently mergeable; each one delivers value standalone and de-risks the next.

- **A2-Phase-1 — schema-vs-registry diff gate** (steps 1 + 4 below). Pure static check; no runtime impact. Confidence-builder for the more invasive phases. Gate-quality bar: blocking on day 1 — deterministic SQL parse, FP-rate is zero on current `main`, fix-time is "register the table or add to allowlist" (<5 min).
- **A2-Phase-2 — migration-time hook** (step 3 below). Advisory-only PostToolUse hook; non-blocking warning. Adds signal at the moment a new table is authored.
- **A2-Phase-3 — runtime guard** (step 2 below — Proxy-based write interception). Highest blast radius — wraps `getOrgScopedDb` and introduces `withAdminConnectionGuarded`. Ship LAST, only after Phases 1 + 2 have been live for a sprint with no false-positive regressions in dev/test. Gate-quality bar: ships in dev/test only (no production impact); promote to "no override allowed" only after a 2-3 week observation window per §0.1.

**Confidence gate between phases:** before promoting Phase N -> Phase N+1, confirm no false-positive issues filed by developers against the previous phase. If FP rate is non-zero, fix the offending matcher before the next phase ships. This is the discipline that prevents "developers add allowlists everywhere and the system loses integrity" — call out explicitly in the build-slug progress log when each promotion happens.

**Approach (in order — phase boundaries marked):**

**[Phase 1 — schema-diff gate]**
1. **Schema-vs-registry drift gate (`scripts/verify-rls-protected-tables.sh`).** Parse the SQL migrations under `migrations/*.sql` (the SQL files are the source of truth for what tables exist with what columns) for every `CREATE TABLE` that includes an `organisation_id` column. Diff that set against `rlsProtectedTables`:
   - Tables in migrations but not registry AND not in `scripts/rls-not-applicable-allowlist.txt` → fail with "Add to `rlsProtectedTables` or to `rls-not-applicable-allowlist.txt`".
   - Tables in registry but not in any migration → fail with "Stale registry entry".
   - Tables in `rls-not-applicable-allowlist.txt`: exempt. The allowlist file carries a one-line rationale per entry.
**[Phase 3 — runtime guard]**
2. **Runtime guard (`server/lib/rlsBoundaryGuard.ts`).** Ship LAST per the A2 phasing above. Export `assertRlsAwareWrite(tableName)` invoked in dev/test only (gated on `process.env.NODE_ENV !== 'production'`). The guard does NOT hook into a Drizzle-internal middleware (this codebase has no such seam). Instead, it is invoked at the two places that already mediate every service-layer write:
   - **Wrap `getOrgScopedDb`'s returned handle** with a Proxy that intercepts `.insert(table)`, `.update(table)`, `.delete(table)` calls. On each, call `assertRlsAwareWrite(table)`. If the table is in `rlsProtectedTables`, the call is OK (the handle is org-scoped by construction). If the table is not in `rlsProtectedTables` AND not in `rls-not-applicable-allowlist.txt`, throw `RlsBoundaryUnregistered`.
   - **Wrap the `tx` argument that `withAdminConnection(options, fn)` passes into its callback.** `withAdminConnection` is a callback-based API (`withAdminConnection(options, async (tx) => { ... })`), not a handle factory — it does NOT return a handle the caller can wrap externally. The guard introduces a thin shim, e.g. `withAdminConnectionGuarded(options, async (guardedTx) => { ... })`, defined in `rlsBoundaryGuard.ts`, that internally calls `withAdminConnection(options, async (tx) => fn(proxy(tx)))` and applies the Proxy interception to `tx` before user code sees it. Callers migrate to `withAdminConnectionGuarded` over time; the unwrapped `withAdminConnection` is left in place so existing audit-bypass callers don't break.
   - **Admin-bypass declaration is explicit, not inferred.** Earlier drafts of this spec proposed scanning the admin callback for a `SET LOCAL ROLE admin_role` SQL execution and treating its presence as the deliberate-bypass signal. Per ChatGPT review Round 2, this approach is unsafe — string-based SQL detection is non-deterministic (the SQL may be parameterised, dynamically built, or executed conditionally relative to a write), and "scan the callback" is not guaranteed to run before the write fires. Replace SQL inspection with an **explicit declaration** on the wrapper signature:
     - `withAdminConnectionGuarded({ allowRlsBypass: true }, async (guardedTx) => { ... })` — caller has affirmatively declared they intend to bypass RLS. Writes to registered tables succeed.
     - `withAdminConnectionGuarded({ allowRlsBypass: false }, async (guardedTx) => { ... })` — default. Writes to registered tables throw `RlsBoundaryAdminWriteToProtectedTable`.
     - `allowRlsBypass: true` callers are still responsible for the actual `SET LOCAL ROLE admin_role` SQL inside the callback per `withAdminConnection`'s existing contract; the flag is the *intent declaration*, not the *mechanism*. The guard only checks the flag — it does NOT inspect SQL.
   - **Flag-drift protection (per ChatGPT review Round 3).** `allowRlsBypass: true` is the kind of flag that gets set "casually" once and then spreads across the codebase as people copy-paste it without thinking — silently defeating the very protection A2 is meant to add. Mitigate via two complementary controls:
     - **Mandatory inline justification comment.** Every call site that passes `allowRlsBypass: true` MUST carry an inline comment on the same line (or the line immediately above) explaining why the bypass is necessary. Shape: `// allowRlsBypass: <one-sentence justification — what cross-org write this is and why RLS would block it>`. A justification that says "needed" or "admin work" is not sufficient — the comment must name the operation (e.g. "retention pruner deletes across all orgs", "migration backfill for table X", "audit-replay tooling").
     - **CI gate enforces the comment.** The existing `scripts/verify-rls-protected-tables.sh` (Phase 1 gate) is **extended** to also grep for `allowRlsBypass:\s*true` across `server/` and fail if any hit lacks a justification comment within ±1 line. No new gate script — the check lives inside the same `verify-rls-protected-tables.sh` file already named in §0.2's A2 file list, so this remains within the "exactly three new files plus one hook" budget for A2. The check ships **blocking** alongside A2 Phase 3 (the runtime guard) so the comment requirement lands at the same moment the flag becomes meaningful. Gate-quality bar (per §0.1): deterministic regex, FP-rate is zero by construction (the comment is either present or it isn't), fix-time is "write the justification comment" (<2 minutes).
   - **Proxy must not change method signatures.** The Proxy applied to the org-scoped handle and to the admin `tx` argument intercepts `.insert(table)`, `.update(table)`, and `.delete(table)` for the boundary check, but it MUST forward all arguments unchanged and return whatever the underlying method returns. The guard does NOT add parameters, change return types, alter the chained-builder semantics (`.insert(...).values(...).returning(...)`), or wrap return values. A caller that switches from a raw handle to a guarded handle must observe identical behaviour at the call site — the only visible change is that protected-boundary writes throw in dev/test instead of silently proceeding.
   - Production behaviour: the guard is no-op (the policy itself enforces). Mitigates risk of false positives in prod, while making dev/test loud.
   - This is wrapper-level enforcement, not Drizzle middleware — it composes with existing primitives instead of inventing a new one.
   - **Proxy coverage completeness — write-path constraint (per ChatGPT review Round 4).** The Proxy intercepts `.insert(table)`, `.update(table)`, and `.delete(table)` calls on the wrapped handle. It does NOT see writes that bypass those builder methods — specifically `.execute(sql\`...\`)` raw queries, `.transaction(...)`-nested writes that re-use a non-wrapped handle, and indirect writes via service-layer helper wrappers that hold their own pre-wrap reference to the underlying client. To prevent false-confidence "the guard is on" while writes route around it, A2 Phase 3 introduces a written contract enforced at code-review time AND at gate level:
     - **Service-layer write contract.** All service-layer writes to tenant-scoped tables (i.e. tables in `rlsProtectedTables`) MUST go through one of: (a) a Drizzle builder method (`.insert` / `.update` / `.delete`) on a `getOrgScopedDb` handle or a `withAdminConnectionGuarded` `tx`, OR (b) an explicit call to `assertRlsAwareWrite(tableName)` immediately before the write executes. Raw `.execute(sql)` writes against a tenant table are violations unless the call is preceded by `assertRlsAwareWrite(tableName)` on the same logical path.
     - **Advisory grep gate (added inside the existing `scripts/verify-rls-protected-tables.sh`, no new file).** The Phase 1 gate gains a third check (alongside the schema-vs-registry diff and the `allowRlsBypass: true` justification check): grep `server/` for `\.execute\(\s*sql` calls and report any that reference a tenant-table name from `rlsProtectedTables` without a same-block `assertRlsAwareWrite(` call within ±10 lines. **Advisory mode initially** — emits the violation, exits 0, baseline tracked in `scripts/guard-baselines.json` per C1. Promotion to blocking follows the §0.1 Gate Quality Bar protocol (FP-rate <5% on `main`, ≥2-3 weeks of stable signal, deterministic match). The check lives inside the existing `verify-rls-protected-tables.sh` file (single file with three checks now: schema diff + flag justification + write-path advisory) — preserves §0.2's A2 file budget.
     - **Why this is named explicitly.** The §B2 / §H1 work depends on raw `.execute(sql)` for advisory-lock acquisition, claim queries, and migration-shaped writes. Those are NOT writes to tenant tables themselves (they hit lock-keyspace, claim-token columns on rows the org owns, etc.) — but the guard's *coverage shape* is fuzzy without an explicit written contract. The contract above closes the fuzziness without expanding A2's runtime scope (no Proxy coverage of `.execute`; the guard stays at builder-method level; the constraint lives at code-review and gate level).
**[Phase 2 — migration hook]**
3. **Migration-time hook (`.claude/hooks/rls-migration-guard.js`).** Ships AFTER Phase 1 (schema-diff gate) and BEFORE Phase 3 (runtime guard). PostToolUse hook that runs on Write/Edit to `migrations/*.sql` (top-level path — confirmed by `ls migrations/` showing migrations 0001..0227+):
   - Parse the SQL diff. If a new `CREATE TABLE` includes `organisation_id`, look for a matching `CREATE POLICY` in the same file or any sibling file in the same migration set.
   - If absent, emit an advisory warning (not blocking) that points at the registry file and asks the author to register the table or add it to `rls-not-applicable-allowlist.txt`.
4. **Allowlist contract.** Tables that legitimately have `organisation_id` but no RLS (e.g. system-wide read replicas, audit ledgers) appear in `scripts/rls-not-applicable-allowlist.txt` with a one-line rationale. Both the schema-vs-registry gate and the runtime guard read this file. (Earlier drafts proposed an in-source `@rls-not-applicable` annotation, but neither SQL parsing nor live schema introspection sees TS comments, so the file-based allowlist is the only viable source of truth across all enforcement points.)

**Acceptance criteria:**
- `bash scripts/verify-rls-protected-tables.sh` exits 0 on the current main.
- Adding a new tenant table without registering it (and without an entry in `rls-not-applicable-allowlist.txt`) → gate fails.
- Adding a new entry to `rlsProtectedTables` for a non-existent table → gate fails.
- A unit test in `rlsBoundaryGuard.test.ts` writes to an unregistered table via a `getOrgScopedDb` handle in dev mode → throws `RlsBoundaryUnregistered`.
- A unit test writes to a registered table via `withAdminConnectionGuarded({ allowRlsBypass: false }, …)` in dev mode → throws `RlsBoundaryAdminWriteToProtectedTable`. The same write under `withAdminConnectionGuarded({ allowRlsBypass: true }, …)` succeeds.
- Same writes under `NODE_ENV=production` → no throw (production path delegates to the policy).
- The migration guard emits a warning when a deliberately-uncovered migration is staged.

**Tests required:**
- New: `server/lib/__tests__/rlsBoundaryGuard.test.ts` — five cases:
  1. `getOrgScopedDb` handle writes to a registered table → succeeds.
  2. `getOrgScopedDb` handle writes to an unregistered, non-allowlisted table in dev → throws `RlsBoundaryUnregistered`.
  3. `getOrgScopedDb` handle writes to a table listed in `rls-not-applicable-allowlist.txt` → succeeds.
  4. `withAdminConnectionGuarded({ allowRlsBypass: false }, …)` callback writes to a registered table in dev → throws `RlsBoundaryAdminWriteToProtectedTable`.
  5. `withAdminConnectionGuarded({ allowRlsBypass: true }, …)` callback writes to a registered table in dev → succeeds (deliberate admin bypass is declared via flag).
  6. Proxy-transparency check: a chained call (`tx.insert(table).values(row).returning()`) executed via a guarded handle returns the same shape as the same chain on a raw handle — exercises the "Proxy must not change signatures" contract.
- Gate self-test: fixture migration under `scripts/__tests__/rls-protected-tables/` introducing a deliberate gap; gate must fail.

**Dependencies:** none. This item is a foundational primitive that should land BEFORE any new tenant-scoped tables. If a new feature is being designed concurrently, sequence A2 first.

**Risk:** medium. New architectural primitive that touches the write path. Mitigation: phased rollout (see Phasing block above). Phase 1 (schema-diff gate) is additive and zero-runtime-risk; Phase 2 (migration hook) is advisory-only; Phase 3 (runtime guard) is dev/test-only and gated on a clean Phase-1+2 observation window. Production path is never affected by any phase.

**Definition of Done — A2-Phase-1 (schema-diff gate):**
- `scripts/verify-rls-protected-tables.sh` and `scripts/rls-not-applicable-allowlist.txt` shipped; gate exits 0 on current `main`; deliberate-gap fixture fails it.
- Gate emits the C1 standard count line `[GATE] rls-protected-tables: violations=<count>`.

**Definition of Done — A2-Phase-2 (migration hook):**
- `.claude/hooks/rls-migration-guard.js` shipped as advisory-only PostToolUse hook.
- Authoring a migration with `organisation_id` but no `CREATE POLICY` emits the warning.
- No false-positive issues filed against Phase 1 in the preceding sprint (confidence gate per Phasing block).

**Definition of Done — A2-Phase-3 (runtime guard):**
- `server/lib/rlsBoundaryGuard.ts` shipped; `withAdminConnectionGuarded` shim available.
- Tests pass for all five cases listed in Tests required below.
- `scripts/verify-rls-protected-tables.sh` extended with the `allowRlsBypass: true` justification-comment check (per the flag-drift protection in A2 Approach step 2). Every existing call site that passes `allowRlsBypass: true` carries an inline justification comment; gate fails on any unjustified call site; deliberate-removal fixture proves the check fires. The check is blocking — no advisory-mode interim.
- `scripts/verify-rls-protected-tables.sh` extended with the write-path advisory check (per the Proxy coverage completeness section in A2 Approach step 2): grep for `\.execute\(\s*sql` calls referencing tenant-table names without a same-block `assertRlsAwareWrite(` within ±10 lines. **Ships advisory** — emits violations, exits 0; baseline recorded in `scripts/guard-baselines.json`. Promotion to blocking follows §0.1 protocol; promotion date logged in `tasks/builds/<slug>/progress.md` if/when the criteria hold.
- `architecture.md` § Architecture Rules updated with one line: "Request- and job-scoped writes to tenant-scoped tables must go through `getOrgScopedDb`. All service-layer writes to tenant-scoped tables MUST go through Drizzle builder methods (`.insert` / `.update` / `.delete`) on a `getOrgScopedDb` handle or a `withAdminConnectionGuarded` `tx`, OR explicitly call `assertRlsAwareWrite(tableName)` immediately before the write. Raw `.execute(sql)` writes against tenant tables without a preceding `assertRlsAwareWrite` call are violations. Deliberate cross-org writes (migrations, retention pruners, audit-replay tooling) go through `withAdminConnectionGuarded({ allowRlsBypass: true }, fn)` and must `SET LOCAL ROLE admin_role` inside the callback per the existing `withAdminConnection` contract. Bypass intent is declared via the `allowRlsBypass` flag, not inferred from SQL inspection. Every `allowRlsBypass: true` call site MUST carry an inline justification comment naming the cross-org operation; CI enforces this. Tables that legitimately have `organisation_id` but no RLS appear in `scripts/rls-not-applicable-allowlist.txt` with a one-line rationale."
- No false-positive issues filed against Phases 1+2 in the preceding 2-3 weeks (confidence gate per §0.1).
- Spec status field for A2 in `§5 Tracking` is checked when all three phases complete. Partial completion is reflected in Tracking via "phase X done" annotations rather than a single binary check.

---

#### A3 — briefVisibilityService + onboardingStateService → getOrgScopedDb

**Source:** pr-reviewer N-1.

**Audit verdict (2026-04-25):** VALID. `server/services/briefVisibilityService.ts:9` and `server/services/onboardingStateService.ts:13` both `import { db } from '../db/index.js'` and use raw `db.select(...)`/transactions. Neither imports `getOrgScopedDb` or `withOrgTx`. Modern reference pattern at `server/services/documentBundleService.ts:672` (`const db = getOrgScopedDb('documentBundleService')`).

**Files:**
- `server/services/briefVisibilityService.ts` (read paths at `:30`, `:49`, plus any others discovered during migration).
- `server/services/onboardingStateService.ts` (transaction at `:51` and any read paths).
- Reference: `server/services/documentBundleService.ts:672` (modern pattern).

**Goal:** bring both services in line with the post-Phase-1 RLS pattern. Removes the latent risk that defence-in-depth weakens silently if RLS were ever bypassed at the connection level.

**Approach:**
1. **briefVisibilityService.ts:** replace the file-scope `import { db }` with `import { getOrgScopedDb } from '../lib/orgScopedDb.js'`. Inside each function (`resolveBriefVisibility`, `resolveConversationVisibility`), call `const tx = getOrgScopedDb('briefVisibilityService')` at function entry — NOT at module top. `getOrgScopedDb` throws `failure('missing_org_context')` when there is no active `withOrgTx` block, and module top-level evaluation runs at import time before any tx is opened. Replace the existing `db.select(...)` calls with `tx.select(...)`. The org-scoped tx already has `app.organisation_id` bound by the upstream `withOrgTx` opened in the auth middleware or `createWorker`.
2. **onboardingStateService.ts:** same pattern — function-local `getOrgScopedDb` calls. The transaction currently at `:51` (`db.insert(...)` followed by chained calls) should be rewritten to use the org-scoped handle: `const tx = getOrgScopedDb('onboardingStateService'); await tx.insert(...).values({ ... })...`. Direct use of `withOrgTx` is NOT appropriate inside services — `withOrgTx(ctx: OrgTxContext, fn)` is the entry-point primitive used by `server/middleware/auth.ts` (HTTP path) and `server/lib/createWorker.ts` (pg-boss path), not a per-call helper. Service code that needs a fresh nested transaction uses `getOrgScopedDb` and chains `.transaction(async (innerTx) => { ... })` on the returned handle.
3. **Verify no behaviour change.** The org-scoped tx binds `app.organisation_id` per request/job; queries already filter by `organisationId` in the WHERE clause, so RLS becomes belt-and-braces, not the primary filter.
4. **Lint guardrail.** Note that `scripts/verify-rls-contract-compliance.sh` allowlists `server/services/**` (lines 40-48 of the script), so it does NOT today catch raw `db` imports inside services — once these two files are migrated, the only enforcement is code review until the planned A2 schema-vs-registry gate ships. If A2 lands first, no further work is needed; if A3 ships first, accept that the regression-prevention guarantee for new services arrives later with A2.

**Acceptance criteria:**
- Neither service imports `db` from `../db/index.js`.
- Both services have at least one new pure-function unit test under `server/services/__tests__/` covering the org-scoped read/transaction path. (Audit verified: there are NO existing tests for `briefVisibilityService.ts` or `onboardingStateService.ts` on current main — this acceptance criterion mandates new coverage rather than relying on hypothetical existing tests.)
- Manual smoke: a brief read with the request principal's org bound returns the expected row; a deliberate org-mismatch returns `{ canView: false, canWrite: false }` (RLS now provides the secondary filter).

**Tests required:**
- New: `server/services/__tests__/briefVisibilityServicePure.test.ts` — happy-path test that mocks `getOrgScopedDb` and asserts each function under test calls it with the expected source string and uses the returned tx for the read.
- New: `server/services/__tests__/onboardingStateServicePure.test.ts` — happy-path test that exercises the transaction path under `getOrgScopedDb` (mocked).
- Both tests follow the `node:test` + `node:assert` convention.

**Dependencies:** none. Pure refactor.

**Risk:** low. Internal-only.

**Definition of Done:**
- Both services use `getOrgScopedDb` (with nested `.transaction(...)` where the existing logic needs a transaction). Neither service imports `withOrgTx` directly — `withOrgTx` stays in middleware / `createWorker`.
- Tests pass. `npm run build:server` (TypeScript-checks server tree), `npm run lint`, `npm test` for the relevant suites.
- Spec status field for A3 in `§5 Tracking` is checked.

---

### Group B — Test coverage gaps

#### B1 — saveSkillVersion orgId-required throw test

**Source:** pr-reviewer S-5.

**Audit verdict (2026-04-25):** VALID. Two identical throws exist at `server/services/skillStudioService.ts:303` and `:312` with the message `saveSkillVersion: orgId is required for scope=${scope}`. No test file `server/services/__tests__/skillStudioServicePure.test.ts` exists, and no existing pure test covers these throws.

**Files:**
- New: `server/services/__tests__/skillStudioServicePure.test.ts`.
- Subject: `server/services/skillStudioService.ts:295–319` (`saveSkillVersion` scope-branch logic).

**Goal:** lock the contract that `saveSkillVersion` rejects null/undefined `orgId` for `org` and `subaccount` scopes, while permitting it for `system` scope. Pure test (no DB) — mock the transaction.

**Approach:**
1. Create `server/services/__tests__/skillStudioServicePure.test.ts`.
2. Use the repo-native `node:test` + `node:assert` harness (NOT Jest — there is no Jest in this repo). Imports follow the existing `*Pure.test.ts` convention:
   ```ts
   import { strict as assert } from 'node:assert';
   import { test } from 'node:test';
   import { saveSkillVersion } from '../skillStudioService.js';
   ```
   Mock the transaction wrapper so the test stays within `runtime_tests: pure_function_only` posture (consistent with existing `*Pure.test.ts` files in the codebase).
3. Three assertions using `assert.rejects` / a happy-path `await`:
   ```ts
   await assert.rejects(
     () => saveSkillVersion(skillId, 'org', null, payload),
     /saveSkillVersion: orgId is required for scope=org/,
   );
   await assert.rejects(
     () => saveSkillVersion(skillId, 'subaccount', null, payload),
     /saveSkillVersion: orgId is required for scope=subaccount/,
   );
   await saveSkillVersion(skillId, 'system', null, payload); // happy path — must not throw
   ```
4. Use exact-message matching where feasible to make a future drift in the error text fail the test.

**Acceptance criteria:**
- The test file exists and passes.
- A deliberate change to the throw message (e.g. dropping `orgId is required`) fails the test.
- The test runs in <500ms — pure, no DB.

**Tests required:** the test itself is the deliverable.

**Dependencies:** none.

**Risk:** zero — purely additive.

**Definition of Done:**
- File created; `npx tsx --test server/services/__tests__/skillStudioServicePure.test.ts` passes (the repo's `node:test` runner is invoked via `tsx`; there is no `npm test -- <pattern>` shortcut — the closest aggregate is `npm run test:unit` which runs `bash scripts/run-all-unit-tests.sh`).
- Spec status field for B1 in `§5 Tracking` is checked.

---

#### B2 + B2-ext — Job idempotency audit + concurrency standard

**Source:** chatgpt-pr-review Round 1 Risk #4 (B2) + Round 2 (B2-ext).

**Audit verdict (2026-04-25):** VALID. Three of four jobs have no documented idempotency or concurrency strategy:
- `server/jobs/bundleUtilizationJob.ts` — no header comment, no guard.
- `server/jobs/measureInterventionOutcomeJob.ts` — no header comment, no guard.
- `server/jobs/ruleAutoDeprecateJob.ts` — no header comment, no guard.
- `server/jobs/connectorPollingSync.ts:22-37` — DOES carry an advisory-style lease pattern (`UPDATE integration_connections SET sync_lock_token = gen_random_uuid()` with skip-if-held). This job is partially compliant; only needs a header comment formalising the model.

No double-invocation regression tests exist for any of the four.

**Files:**
- `server/jobs/bundleUtilizationJob.ts`
- `server/jobs/measureInterventionOutcomeJob.ts`
- `server/jobs/ruleAutoDeprecateJob.ts`
- `server/jobs/connectorPollingSync.ts`
- New tests: `server/jobs/__tests__/<jobName>.idempotency.test.ts` for each.
- New: `architecture.md` § Architecture Rules — one paragraph codifying the standard.
- New (optional but recommended): `scripts/verify-job-concurrency-headers.sh` — gate that checks each `server/jobs/*.ts` carries the standard header. Note that `scripts/verify-job-idempotency-keys.sh` already exists and enforces `idempotencyStrategy` declarations on `JOB_CONFIG` entries in `server/config/jobConfig.ts` — that gate covers the *enqueue-side* dedup contract. The proposed new gate is *complementary*, not duplicative: it verifies the *handler-side* concurrency-and-idempotency-model header comment, which is a different shape of declaration. Implementers may instead extend `verify-job-idempotency-keys.sh` to cross-check that every `JOB_CONFIG` entry's handler file carries the standard header — that approach reuses an existing gate and is the preferred extension path if it can be done without expanding the gate's complexity beyond ~30 lines.

**Goal:** every long-running or cron-driven job declares (a) its concurrency control mechanism, (b) its idempotency strategy. Eliminates the "but the job IS idempotent, why is this still broken?" failure mode. B2 covers idempotency (same input → same effect). B2-ext covers concurrency (two runners in parallel cannot both perform work).

**Per-job ordering (per ChatGPT review Round 1):** the four jobs ship in this strict order — do NOT bundle them in one PR. Each job is its own mini-spec; the next does not start until the previous is merged. Lowest-risk-first reduces blast radius and surfaces standardisation issues early.

1. **`connectorPollingSync` first** — already lease-protected; the change is mostly comment-only (formalising the existing model in the standard header). Validates the standard header shape against a real working job before it propagates.
2. **`bundleUtilizationJob` second** — needs new advisory-lock + upsert work, but is disabled-until-Phase-6 per its file header, so a regression is contained.
3. **`measureInterventionOutcomeJob` third** — claim+verify pattern; runs hourly in production, so a regression has user-facing schedule impact. Ship after the standard is proven on the previous two.
4. **`ruleAutoDeprecateJob` last** — global advisory lock + `WHERE deprecated_at IS NULL` predicate; nightly cadence makes it the safest to land last (least frequent invocation).

Treat each job's PR as a mini-spec — one job, one header migration, one regression test, one merged PR. Do not start the next job until the previous one has been live for at least one scheduled cycle without alerts.

**Approach:**

1. **Standardise the header contract.** Every job file carries a header comment in this exact form:
   ```ts
   /**
    * <jobName>
    *
    * Concurrency model: <advisory lock on <key> | singleton key | queue-level exclusivity>
    *   Mechanism:       <pg_advisory_xact_lock | UPDATE … RETURNING claim | …>
    *   Key/lock space:  <description of the lock identifier>
    *
    * Idempotency model: <upsert-on-conflict | claim+verify | content-addressed | replay-safe>
    *   Mechanism:       <description>
    *   Failure mode:    <what happens if a partial state is observed mid-execution>
    */
   ```
2. **Per job — assess and patch:**

   **bundleUtilizationJob.ts** — bundles utilisation rollup.
   - Concurrency: pg advisory lock keyed on the literal `bundleUtilizationJob` (or `(orgId, jobName)` tuple if per-org).
   - Idempotency: replay-safe — recompute the rollup deterministically from current state and `INSERT … ON CONFLICT DO UPDATE` on `(orgId, bundleId, windowStart)`.
   - Add: header comment, advisory lock acquisition wrapping the work, `ON CONFLICT` clauses in the upsert.

   **measureInterventionOutcomeJob.ts** — outcome measurement.
   - Concurrency: per-org advisory lock to allow parallel orgs but serialise within an org.
   - Idempotency: claim+verify — claim a measurement window via `UPDATE … WHERE measured_at IS NULL RETURNING id`. If zero rows, no-op.
   - Add: header, claim query, regression test.

   **ruleAutoDeprecateJob.ts** — deprecates rules per quality decay.
   - Concurrency: global advisory lock (single runner — no per-org parallelism needed for low-frequency cron).
   - Idempotency: idempotent by construction (decay applies the same delta given the same input within a clock tick) but explicit `WHERE deprecated_at IS NULL` predicate prevents re-deprecating.
   - Add: header, advisory lock, `WHERE` predicate.

   **connectorPollingSync.ts** — already lease-protected at `:22-37`.
   - Concurrency: lease via `sync_lock_token` UPDATE with skip-if-held semantics. Already in place — prevents two runners from both acquiring the lock.
   - Idempotency (separately): phase-aware execution. The lease addresses concurrency, NOT idempotency on retry-after-release. For replay-safety, each phase must carry an independent no-op-if-already-done predicate (e.g. "phase=fetch returns early if `last_sync_at > started_at - lookback`"; "phase=process_batch uses an `INSERT … ON CONFLICT DO UPDATE` upsert keyed on the source-event id"). The handler header MUST enumerate per-phase idempotency mechanisms, not collapse "lease holds → both properties hold" — that's the conflation B2 explicitly fixes.
   - Add: header comment formalising the lease as the concurrency mechanism AND the per-phase no-op predicates as the idempotency mechanism (these are two distinct contract elements). Audit the existing phases against the per-phase predicate requirement; add any predicate that is missing.

3. **Per-job double-invocation regression test.** Each job gets `server/jobs/__tests__/<job>.idempotency.test.ts` exercising:
   - **Sequential double-invocation:** call the job twice in a row; assert state matches single-invocation, no duplicate side effects.
   - **Parallel double-invocation:** start two invocations concurrently via `Promise.all([job(), job()])`; assert exactly one performs work (the other returns no-op or yields the same final state).
   - **Mid-execution failure:** simulate a transient throw inside the work block; on retry, assert no partial state is left behind.

   **Race-window control — deterministic harness contract (per ChatGPT review Round 2).** The parallel double-invocation test MUST control the race window via an **injected test hook**, NOT solely via `pg_sleep` or wall-clock timing. Each job exposes a test-only seam (e.g. an exported `__testHooks` object with a `pauseBetweenClaimAndCommit?: () => Promise<void>` callback that defaults to a no-op in production and is awaited at the critical race point — between the lock/claim acquisition and the work commit). The test sets the hook to a controlled awaitable (e.g. a deferred promise), starts both invocations, observes that one is parked at the hook while the other is blocked on the lock/claim, then resolves the deferred. This produces a deterministic race outcome regardless of host load, CI scheduling jitter, or `pg_sleep` precision.
   - `pg_sleep(0.1)` is acceptable as an *additional* widening tool, NOT as the primary mechanism — flaky tests that depend on timing alone fail intermittently in CI and create false confidence in the underlying concurrency model.
   - The test hook is a named primitive per §0.2 — it lives on the existing job module's exports as a `__testHooks` object (one per job), not as a new shared helper.
   - The hook MUST be a no-op in production (`if (process.env.NODE_ENV === 'production') return;` at the call site, OR the hook defaults to `async () => {}` and is overridden only inside tests). Production behaviour is unchanged.
   - **Production-safety invariant (per ChatGPT review Round 4).** `__testHooks` MUST satisfy ALL three conditions below in every job that exposes one. A developer who forgets to reset the hook between tests, or who accidentally imports the hook module from production code, MUST NOT be able to alter production execution:
     1. **Tree-shaken or no-op in production builds.** Either (a) the `__testHooks` export is removed from the bundle when `NODE_ENV === 'production'` (e.g. via a `if (process.env.NODE_ENV !== 'production')` block around the export, with the call-site dead-code-eliminated by the bundler), OR (b) the hook's default value is `async () => {}` and the call site short-circuits on production via the `if (process.env.NODE_ENV === 'production') return;` pattern above. Either approach is acceptable; the choice MUST be documented in the job's header comment.
     2. **No execution change when unset.** If `__testHooks.<hookName>` has not been overridden (i.e. holds its default `async () => {}` value), the call site MUST behave identically to a job with no hook at all — same timing within scheduling jitter, same observable side effects, same return shape. Centralise this via the canonical pattern `if (!__testHooks.<hookName>) return; await __testHooks.<hookName>();` at every call site so the unset path is a single conditional skip, not an awaited no-op that adds microtask scheduling overhead.
     3. **Reset-on-import enforcement at test boundaries.** Each job's test file MUST reset `__testHooks` to its default values in a `beforeEach` (or equivalent `node:test` hook) so a forgotten override in one test does not leak into the next. The reset is a one-line assignment per hook key. Document the reset pattern in the first idempotency test that lands so subsequent tests follow it.

   The optional gate (step 4 below) gains a complementary advisory check: grep `server/jobs/` for any unconditional `await __testHooks.` call (i.e. one not guarded by the canonical `if (!__testHooks.<hookName>) return;` pattern) and report any hits. Advisory only — fix-time is "wrap in the conditional"; FP-rate is zero by construction.
4. **Optional gate (`scripts/verify-job-concurrency-headers.sh`).** Lints every `server/jobs/*.ts` for the presence of `Concurrency model:` and `Idempotency model:` lines in the header. Fail otherwise. Cheap to write, prevents future drift.

5. **No-op return semantics (per ChatGPT review Round 2).** When a job invocation does not perform work (because a sibling invocation already holds the lock / already claimed the row / the predicate filtered out everything), the job MUST return a structured result, not throw and not silently exit. The contract:
   - **Return shape:** `{ status: 'noop', reason: <one-of: "lock_held" | "no_rows_to_claim" | "predicate_filtered" | "already_processed">, jobName: <string> }`.
   - **Logging:** emit one INFO line `job_noop: <jobName> reason=<reason>` per invocation that returns no-op. INFO, NOT WARN — a no-op due to a peer invocation is expected, not a degradation.
   - **NOT silent.** A job that returns without logging makes "did the second invocation no-op or fail silently?" undebuggable in production. Every no-op return MUST emit the line.
   - **NOT a throw.** A no-op throw bubbles up through the queue runner as a job failure, triggering retry and metrics noise. No-op is success-with-no-work, not failure.
   - **Zero-side-effects invariant (per ChatGPT review Round 3).** A `{ status: 'noop' }` outcome MUST guarantee zero writes and zero side effects — not "best effort". Any pre-write condition (advisory-lock check, claim query, predicate filter) MUST be evaluated **before mutation begins**. Specifically: a job that opens a transaction, performs a write, then discovers it should no-op, MUST NOT return `{ status: 'noop' }` — that outcome is reserved for paths where no mutation occurred. If a partial write is observed, the job MUST roll back and return the work-performed shape (or throw, if rollback failed). This makes idempotency strict: downstream callers and tests can rely on `noop` meaning "nothing changed", full stop. The sequential and parallel double-invocation regression tests (step 3 above) MUST assert this — after a `noop` return, an independent read of the affected rows shows the same state as before the invocation.
   - The parallel double-invocation regression test (step 3 above) asserts that exactly one invocation returns `{ status: 'noop', reason: '<expected reason for that job> }` and the other returns the work-performed shape.

**Acceptance criteria:**
- All four jobs carry the standard header.
- Each job has a non-trivial guard (advisory lock, claim+verify, lease) — `bundleUtilizationJob` and `ruleAutoDeprecateJob` get advisory locks; `measureInterventionOutcomeJob` gets a claim+verify; `connectorPollingSync` keeps its lease.
- Each job has a passing double-invocation regression test. The parallel-invocation test uses the injected `__testHooks` seam, NOT solely `pg_sleep` / wall-clock timing.
- A no-op invocation returns the structured `{ status: 'noop', reason, jobName }` shape and emits the `job_noop:` INFO log line. The test asserts both.
- (If gate added) `bash scripts/verify-job-concurrency-headers.sh` exits 0; deliberately removing the header from one job → fails.

**Tests required:** four new test files under `server/jobs/__tests__/`.

**Dependencies:** A1a (Principal-context propagation: service surface change). `measureInterventionOutcomeJob` and `bundleUtilizationJob` read canonical data via `canonicalDataService` — sequencing B2 after A1a means the new tests can use `PrincipalContext` from the start. A1b (gate hardening) is not strictly required before B2 — the new tests pass `PrincipalContext` either way.

**Risk:** medium. Concurrency-control bugs are notoriously hard to surface in tests. Mitigations:
- Land per-job in separate commits so a regression in one is isolated.
- Run the new parallel tests N=10 times to surface flakiness early. This repo's test runner is `tsx` invoked via shell scripts (see `package.json` scripts), not Jest — implement the repeat by either (a) wrapping the parallel-double-invocation case in a 10-iteration `for` loop inside the test file itself, or (b) re-invoking `tsx server/jobs/__tests__/<job>.idempotency.test.ts` 10 times from `scripts/run-all-unit-tests.sh` for the affected files only. Do NOT add Jest as a dependency.
- Roll out the highest-frequency job (likely `connectorPollingSync`) first — it already has a lease, so the change is comment-only; gives confidence in the standard before risk-bearing changes.

**Definition of Done — B2 (idempotency only):**
- All four jobs carry the **Idempotency model:** section of the header with named mechanism per job (`bundleUtilizationJob`: replay-safe upsert; `measureInterventionOutcomeJob`: claim+verify; `ruleAutoDeprecateJob`: idempotent-by-construction with `WHERE deprecated_at IS NULL` predicate; `connectorPollingSync`: per-phase no-op predicates).
- Each job has a passing **sequential double-invocation regression test** — calling the job twice in a row produces the same final state as a single invocation.
- B2 row in `§5 Tracking` is checked when these criteria hold, even if B2-ext's concurrency criteria are still in flight.

**Definition of Done — B2-ext (concurrency only):**
- All four jobs carry the **Concurrency model:** section of the header with named lock primitive per job (advisory lock / lease / claim+verify).
- Each job has a passing **parallel double-invocation regression test** — `Promise.all([job(), job()])` produces exactly one work-performed outcome.
- (Optional) the gate (either a new `verify-job-concurrency-headers.sh` or an extension of `verify-job-idempotency-keys.sh`) exits 0 with the standard header present in every `server/jobs/*.ts`.
- `architecture.md` § Architecture Rules carries one paragraph: "Cron and long-running jobs MUST declare a Concurrency model and an Idempotency model in a header comment using the standard form. See `server/jobs/connectorPollingSync.ts` for the canonical example. **Default lock scope is per-org** — the advisory-lock key (or claim predicate, lease key, etc.) is parameterised on `organisationId` so distinct orgs run in parallel while a single org serialises. Any deviation (global serialization, per-entity scope, etc.) MUST be justified inline in the header's `Concurrency model:` section. Operations that partially execute MUST follow §0.5 of the audit-remediation-followups spec (roll back fully, OR return a structured partial-state result, OR log explicit partial execution at WARN level) — silent partial-success returns are rejected." (The H1 derived-data null-safety rule lands as a separate paragraph per H1's own DoD; this paragraph covers concurrency, lock-scope default, and the partial-execution rule for jobs.)
- B2-ext row in `§5 Tracking` is checked.

**Note on partial completion:** B2 and B2-ext may ship in separate PRs in either order. The split DoD above lets `§5 Tracking` reflect partial progress accurately — B2 can complete before B2-ext does, or vice versa.

---



### Group C — Observability / drift guards

#### C1 — Baseline violation counts in verify-*.sh scripts

**Source:** chatgpt-pr-review Round 1 — Surgical B.

**Audit verdict (2026-04-25):** VALID. Sampled `scripts/verify-principal-context-propagation.sh` and `scripts/verify-action-call-allowlist.sh`. Neither emits a parseable count line. The shared `emit_summary` helper at `scripts/lib/guard-utils.sh:124` emits human-readable text only: `Summary: $files_scanned files scanned, $violations violations found`.

**Files:**
- `scripts/lib/guard-utils.sh` (single source of change for ~30 scripts that use the helper).
- Audit pass: every `scripts/verify-*.sh` and `scripts/verify-*.mjs` that does NOT use `emit_summary` (one-off scripts) needs a per-file edit.

**Goal:** every gate emits a machine-grep-able `[GATE] <guard_id>: violations=<count>` line on every run, in addition to its current human-readable output. CI captures the count; baseline movement becomes measurable rather than binary.

**Approach:**
1. **Edit `scripts/lib/guard-utils.sh`.** Modify `emit_summary` so that the `[GATE]` line is emitted as the **last application-level line of the script's output**, with the human-readable `Summary:` line emitted before it (per ChatGPT review Round 2 — the `[GATE]` line MUST be the last application-emitted line so CI parsers can `tail -n 1` deterministically). Shape:
   ```bash
   echo ""
   echo "Summary: $files_scanned files scanned, $violations violations found"
   echo "[GATE] $GUARD_ID: violations=$violations"
   ```
   Pulls `$GUARD_ID` from the env var each script already sets (e.g. `GUARD_ID="principal-context-propagation"`). Any script-specific output that follows `emit_summary` (e.g. extra debug context) MUST be moved to before the `Summary:` line so the `[GATE]` line stays terminal at the application level.

   **Framework-log exception (per ChatGPT review Round 3).** No application-level logs (script-emitted `echo`, `printf`, `console.log`, or any output the script itself produces) may follow the `[GATE]` line. **Framework-level logs are exempt** — output emitted by the shell, the test runner, the CI runner, or other infrastructure layers (e.g. bash's `+x` trace, `tsx`'s warning output, Node's deprecation warnings, CI-injected timing/cleanup lines) is permitted to follow the `[GATE]` line and does NOT violate this contract. CI parsers handle this by either (a) using `grep -E '^\[GATE\] ' | tail -n 1` instead of `tail -n 1`, OR (b) running the gate with framework noise suppressed (e.g. `2>/dev/null` for stderr framework warnings) when a strict tail is required. The acceptance criterion below uses the grep form to be explicit about the application-vs-framework distinction.

   **Subscript output constraint (per ChatGPT review Round 4).** No subscript or nested-script invocation MAY emit application-level output AFTER its parent's `emit_summary` call. Specifically: if a gate script calls `emit_summary` and then invokes a helper script (e.g. `bash scripts/lib/<helper>.sh` or `node scripts/lib/<helper>.mjs`), that helper script's stdout/stderr counts as application-level output and violates the terminality contract. Two enforcement mechanisms:
   - **Author-time discipline (mandatory).** Any helper script invocation in a gate MUST run BEFORE the parent's `emit_summary` call — no post-summary subscripts, no pipeline that re-emits the gate's output through a transformer, no trailing cleanup script that prints anything. If a helper genuinely must run last (e.g. a temp-file cleanup), it MUST redirect its output to `/dev/null` so no application-level line lands after the `[GATE]` line.
   - **Gate-self-test fixture.** The `[GATE]` terminality test (per the existing acceptance criterion) is extended with one fixture that wires up a deliberately-misconfigured subscript that prints AFTER `emit_summary`; the test asserts the canonical `grep -E '^\[GATE\] ' | tail -n 1` parser still returns the correct violation count, AND a separate detection pass (`tail -n 1 | grep -qE '^\[GATE\] '` — strict-tail form) reports the violation as expected. This second test confirms the framework-vs-application distinction is genuinely working and that subscript noise gets caught at author time, not silently passed through.
2. **Audit non-sharing scripts.** Run `grep -L "guard-utils.sh" scripts/verify-*.sh scripts/verify-*.mjs` to identify scripts that don't use the shared helper. For each, append a dedicated `echo "[GATE] <id>: violations=<count>"` line as the **last** line. The `.mjs` scripts (`verify-help-hint-length.mjs`, `verify-integration-reference.mjs`) need an analogous `console.log` line emitted last (after any other output).
3. **CI capture (optional, ship in same PR if cheap).** `.github/workflows/<gates>.yml` (or wherever gates run) — pipe gate output to a file and parse out `[GATE]` lines into a JSON artefact. This is nice-to-have; the line itself is the deliverable.
4. **Documentation.** Add one paragraph to `architecture.md` § Architecture Rules: "Every gate script emits `[GATE] <id>: violations=<n>` as the LAST application-level line of its output. CI parsers extract the count via `grep -E '^\[GATE\] ' | tail -n 1` (the grep form is robust against framework-level output — bash trace, `tsx` warnings, Node deprecation warnings — that may appear after the `[GATE]` line and is exempt from the terminality contract). A gate that emits any application-level line (script-owned `echo`, `printf`, `console.log`) after the `[GATE]` line is in violation. Adding new gates: emit `[GATE]` last from the script's own output; framework noise is allowed."

**Acceptance criteria:**
- Every `scripts/verify-*` script (sh + mjs) emits one `[GATE] <guard_id>: violations=<count>` line.
- The line is the same shape across all scripts (parseable with one regex).
- The `[GATE]` line is the **last application-level line** of the script's output. `bash scripts/verify-<any>.sh 2>&1 | grep -E '^\[GATE\] ' | tail -n 1` matches `^\[GATE\] [a-z0-9-]+: violations=[0-9]+$`. The grep-then-tail form is the canonical CI parser shape (per the framework-log exception in step 1 above) — it is robust against framework-level lines (shell trace, `tsx` warnings, Node deprecation warnings) that may legitimately follow the `[GATE]` line.
- A test invocation captures the line: `bash scripts/verify-principal-context-propagation.sh 2>&1 | grep -E '^\[GATE\] [a-z0-9-]+: violations=[0-9]+$'` returns one match.
- No existing CI behaviour changes (additive).

**Tests required:** none in code. Manual verification: pick three scripts, run each, grep for the line.

**Dependencies:** none.

**Risk:** low — additive only.

**Definition of Done:**
- `emit_summary` updated; all one-off scripts patched.
- Manual smoke verification across 5 sampled gates passes.
- Spec status field for C1 in `§5 Tracking` is checked.

---

#### C2 — architect.md context-section drift guard

**Source:** chatgpt-pr-review Round 1 — Surgical A.

**Audit verdict (2026-04-25):** VALID. `.claude/agents/architect.md:44-54` carries a "Context files" section listing 6 required files. No drift guard exists — neither `.claude/hooks/architect-context-guard.js` nor `scripts/verify-architect-context.sh`. A future edit could empty the section silently.

**Files:**
- New: `scripts/verify-architect-context.sh` (preferred over a hook — it runs in CI and locally).
- Subject: `.claude/agents/architect.md` § "Context files".

**Goal:** assert the architect agent's context-loading instructions stay intact. A drift here silently degrades architecture-review quality.

**Approach:**
1. Create `scripts/verify-architect-context.sh`. Logic:
   - Read `.claude/agents/architect.md`.
   - Find the `## Context files` section. If missing → fail with `architect-context: section missing`.
   - Extract the numbered list under it. Compare the extracted entries to a reference fixture at `scripts/architect-context-expected.txt` — one path per line, in order. The gate fails if:
     - An entry from the fixture is missing from the architect.md section (deletion → emit "missing entry: `<path>`").
     - The architect.md section has an entry not in the fixture (addition → emit "unexpected entry: `<path>`; update `architect-context-expected.txt`").
     - The path order differs (renumbering → emit "order mismatch at line N").
   - For each entry that names a file path (`.md` extension or matching a known path pattern), assert the path resolves on disk. Skip lines like "the specific task..." that don't name a file.
   - Emit `[GATE] architect-context: violations=<count>` per the C1 standard.
   
   The fixture file holds the expected list of paths, NOT just the count, so the "naming the deleted entry" acceptance criterion is achievable. Legitimate edits to the architect.md context list update the fixture in the same commit, and the commit author has to think about it explicitly.
2. Wire into the gates suite (`package.json` script or CI workflow) so it runs on every commit that touches `.claude/agents/architect.md` or any listed context file (catches renames where the agent file isn't updated).
3. Self-test: a fixture variant under `scripts/__tests__/architect-context/` with a deleted entry — gate must fail with the specific entry named.

**Acceptance criteria:**
- `bash scripts/verify-architect-context.sh` exits 0 today.
- Deleting one path from the section without updating `architect-context-expected.txt` → gate fails with a specific error naming the deleted entry.
- Adding an entry to architect.md without updating the fixture → gate fails naming the unexpected entry.
- Renaming a referenced file without updating the section → gate fails (path-resolution check fires).
- Gate emits the standard `[GATE] architect-context: violations=<count>` line.

**Tests required:** fixture variants exercising the failure modes; verified manually or via a tiny shell-test harness.

**Dependencies:** C1 (parseable count line) — sequence after C1 so this gate emits the standard line from day 1.

**Risk:** low.

**Definition of Done:**
- Gate exists; CI/local runs include it.
- Fixture failure modes verified.
- Spec status field for C2 in `§5 Tracking` is checked.

---

#### C3 — Canonical registry drift validation tests

**Source:** chatgpt-pr-review Round 1 — Surgical D.

**Audit verdict (2026-04-25):** VALID. No test file `server/services/__tests__/canonicalRegistryDriftPure.test.ts` exists. `canonicalDictionaryRegistry.ts` lives at `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts`. Today, a new feature can add a `canonical_*` table without registering it; runtime first surfaces the gap on a query miss.

**Files:**
- New: `server/services/__tests__/canonicalRegistryDriftPure.test.ts`.
- Subjects (read-only inputs to the test):
  - Schema: every `server/db/schema/*.ts` file declaring tables with a `canonical_` prefix.
  - `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts`.
  - `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts`.

**Goal:** prove that the three sources of truth — schema, dictionary registry, query-planner registry — agree on the set of canonical tables. Drift between them surfaces in test, not at runtime.

**Approach:**
1. Pure test, no DB. Read schema files via `import` (Drizzle table objects expose `.[Symbol.for('drizzle:Name')]` or similar) OR via filesystem scan + regex on `pgTable('canonical_...'`. Either approach works; pick whichever is more stable.
2. Build two sets initially (the third set requires inspection of the planner registry's actual structure):
   - `schemaTables`: every Drizzle table whose name starts with `canonical_`.
   - `dictionaryTables`: keys exported from `canonicalDictionaryRegistry`.
3. **Inspect `canonicalQueryRegistry` first — forced decision (per ChatGPT review Round 2).** Its keys are semantic action identifiers like `contacts.inactive_over_days` — NOT canonical table names directly. To derive a `queryPlannerTables` set, the test needs metadata that maps each planner action to the canonical table it queries. The original draft left this as an "either path is fine" branch; ChatGPT review Round 2 flagged this as a spec hole that risks C3 shipping half-complete and never being upgraded. **Force the decision now:**
   - **At C3 implementation time, if `canonicalQueryRegistry`'s entries carry an explicit `canonicalTable` metadata field**, extract it and ship the three-set comparison (schema ⊆ dictionary, dictionary ⊆ schema, queryPlannerTables ⊆ dictionary). Document the field name in the test.
   - **If the metadata field does NOT exist on current `main`**, C3 ships as the two-set comparison (`schemaTables` vs `dictionaryTables`) AND the implementer MUST create a tracked follow-up backlog item that adds the `canonicalTable` metadata field and lands the third comparison **before Phase 5A** (the next major canonical-data-related work in this codebase). The follow-up entry goes into `tasks/todo.md` under "C3 follow-up: add canonicalTable metadata to canonicalQueryRegistry; upgrade C3 drift test to three-set comparison" with a back-link to this section. Do NOT defer indefinitely — the upgrade has a named deadline.
   - **Follow-up ownership and trigger condition (per ChatGPT review Round 3).** The two-set follow-up entry MUST include both an **owner** and an explicit **trigger condition for re-evaluation**, otherwise the entry exists but is never picked up. Required shape for the `tasks/todo.md` entry:
     ```
     - [ ] C3 follow-up: add canonicalTable metadata to canonicalQueryRegistry; upgrade C3 drift test to three-set comparison.
       - Owner: <name or role of the C3 implementer at ship time, OR the Phase-5A lead if assigned>
       - Trigger condition: re-evaluate at Phase 5A entry (when the next canonical-data-related build slug is created), OR sooner if any new canonical_* table is added to schema. Whichever fires first.
       - Back-link: docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md § C3.
     ```
     A follow-up without an owner or without a trigger condition fails C3's Definition of Done — silent backlog rot is the failure mode this rule prevents.
   - **Phase-5A spec coupling (per ChatGPT review Round 4).** A backlog entry alone — even with owner + trigger condition — depends on someone reading `tasks/todo.md` at Phase-5A kickoff. To force the coupling at the spec level (the failure mode this rule prevents: Phase 5A happens but no one links it back to C3), the C3 follow-up DoD adds one more requirement: the Phase-5A spec, when it is authored, MUST include a checklist item in its own §1 (or equivalent backlog/scope section) reading exactly:
     ```
     - [ ] C3 follow-up: upgrade canonicalRegistryDrift test from 2-set to 3-set comparison
       - Source: docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md § C3
       - Action: add `canonicalTable` metadata field to canonicalQueryRegistry entries; extend canonicalRegistryDriftPure.test.ts with `queryPlannerTables ⊆ dictionaryTables` assertion.
     ```
     This couples the upgrade to a spec the Phase-5A implementer is guaranteed to read (their own scope spec), not just a backlog file. The coupling is enforced at C3-implementation time by adding the same line to `tasks/todo.md` AND noting in the C3 PR description that "the Phase-5A spec, when authored, must carry the C3 upgrade as a checklist item per §C3 of the audit-remediation-followups spec". The C3 implementer MUST also verify (at C3 ship time, NOT at Phase-5A ship time) that no Phase-5A spec already exists; if one does, they add the checklist item directly to it in the same PR.
   - Do NOT regex over the planner-action strings — `contacts.inactive_over_days` is not a reliable signal of "table = `canonical_contacts`".

   The point of forcing this decision: the original branch ("if no metadata, narrow scope") provided no commitment to ever closing the gap. The Phase-5A deadline ties the upgrade to a real milestone in this codebase rather than letting it sit as an open optional.
4. Assert set containment (with a small allowlist within the test for deliberate exemptions):
   - `schemaTables ⊆ dictionaryTables` — every schema canonical table is registered in the dictionary.
   - `dictionaryTables ⊆ schemaTables` — no stale registry entries.
   - `queryPlannerTables ⊆ dictionaryTables` — every planner reference is dictionary-registered (only if step 3 yielded a reliable extraction).
5. On failure, emit a clear diff message naming the offending table and which set is missing it.

**Acceptance criteria:**
- The test exists and passes on current main.
- Adding a `canonical_*` table to schema without dictionary registration → test fails with the new table name in the failure message.
- Adding an entry to the dictionary for a non-existent schema table → test fails.
- (If step 3 preferred path applies) adding a planner action that references an unregistered canonical table → test fails.

**Tests required:** the test itself.

**Dependencies:** none.

**Risk:** low.

**Definition of Done:**
- Test passes; deliberate-gap fixtures fail correctly.
- Spec status field for C3 in `§5 Tracking` is checked.

---

#### C4 — actionRegistry.ts comment cleanup

**Source:** pr-reviewer N-3.

**Audit verdict (2026-04-25):** PARTIAL. The comment at `server/config/actionRegistry.ts:2-3` says "callers of canonicalDataService within this file should use fromOrgId() when the service migrates to PrincipalContext" — but `grep -n "canonicalDataService" server/config/actionRegistry.ts` returns zero matches. The comment misleads by implying callers exist when they do not.

**Files:**
- `server/config/actionRegistry.ts:2-3` (comment only).

**Goal:** rewrite the comment to match reality. Trivial doc fix; bundled with C2/C3 because it's adjacent.

**Approach:**

The right fix depends on whether A1b has shipped (A1b is the item that flips the gate to call-site granularity):

- **If A1b has NOT shipped (current main):** the existing import is dead and the comment is misleading. Replace lines 2-3 with:
  ```ts
  // fromOrgId imported here to satisfy verify-principal-context-propagation gate.
  // This registry does not invoke canonicalDataService directly today; future handler
  // additions that do should pass fromOrgId(organisationId, subaccountId) explicitly.
  ```
  This is a comment-only fix that accurately describes the current state.

- **If A1b HAS shipped:** A1b's hardened gate enforces call-site granularity, not file-level import presence, so the dead import is no longer load-bearing. Remove the `import { fromOrgId }` line entirely (and the misleading comment with it). No `@principal-context-import-only` annotation is needed because there are no `canonicalDataService` invocations in this file at all — the file simply drops out of the gate's scope.

Pick whichever path matches the A1b status at the moment C4 is implemented. The end state post-A1b is "no import, no comment"; the interim state pre-A1b is "import retained, comment corrected".

**Acceptance criteria:** the comment accurately describes the file's relationship to `canonicalDataService`.

**Tests required:** none.

**Dependencies:** none. Sequencing note above re: A1b.

**Risk:** zero.

**Definition of Done:**
- Comment updated.
- Spec status field for C4 in `§5 Tracking` is checked.

---

### Group D — Pre-existing pre-merge gates that crossed the line in this PR

#### D1 — verify-input-validation + verify-permission-scope baseline capture

**Source:** spec-conformance REQ #35.

**Audit verdict (2026-04-25):** VALID. Both scripts exist (`scripts/verify-input-validation.sh`, `scripts/verify-permission-scope.sh`). The audit spec §5.7 step 3 says new regressions introduced by Phase 2 work itself MUST be resolved before merge — but no `main`-state baseline was captured pre-Chunk-2, so we cannot prove Phase 2 didn't introduce any of the 44 + 13 warnings now present.

**Files:**
- Investigative — no code changes initially.
- If new regressions are found: targeted fixes within the files the gates name.
- Output artefact: append baseline counts to `tasks/builds/audit-remediation/progress.md` (preferred — that's the active build-slug log) and cross-link from this spec's §5 Tracking row. Do NOT amend the merged source spec `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md` post-merge; the merged spec is historical record.

**Goal:** prove (or refute) that PR #196 did not introduce any new violations of these two gates. Closes the audit-trail gap left when Chunk 2 didn't capture baselines.

**Approach:**
1. Stash any in-flight work. Check out the **first parent of merge commit `f824a03`** — i.e. `f824a03^1` (or equivalently `f824a03~1` in linear-history form). That is the pre-PR-196 `main` HEAD. The merge commit `f824a03` itself is the post-PR-196 state.
2. Run both gates on the pre-PR-196 commit:
   ```bash
   git checkout f824a03^1
   bash scripts/verify-input-validation.sh > /tmp/iv-pre.txt 2>&1
   bash scripts/verify-permission-scope.sh > /tmp/ps-pre.txt 2>&1
   ```
   Capture violation counts.
3. Check out current `main` (post-PR-196). Run both gates again. Capture counts.
4. Diff:
   - Counts unchanged → Phase 2 introduced nothing. Record baselines in `tasks/builds/audit-remediation/progress.md`; close the audit-trail item.
   - Counts higher → enumerate the new violations. For each, decide: fix on a follow-up PR, or document as pre-existing-but-newly-surfaced (with evidence the underlying file/pattern existed before).
   - Counts lower → great; record the delta and update baselines.
5. **No new code unless step 4 turns up real regressions.** This is investigative-first.

**Acceptance criteria:**
- Counts captured for both gates at both commits, recorded in a checked-in artefact (`tasks/builds/audit-remediation/progress.md`, with a one-line back-reference from this spec's §5 Tracking row).
- Any new regressions either fixed or explicitly documented.
- `tasks/builds/audit-remediation/progress.md` reflects the closure.

**Tests required:** none in code.

**Dependencies:** none.

**Risk:** low — investigative only.

**Definition of Done:**
- Baselines captured; audit-trail item closed.
- Spec status field for D1 in `§5 Tracking` is checked.

---

#### D2 — Server cycle count operator framing decision

**Source:** spec-conformance REQ #43, pr-reviewer S-4.

**Audit verdict (2026-04-25):** NOT VERIFIABLE (decision item, not a code claim). Audit spec `2026-04-25-codebase-audit-remediation-spec.md` §6.3 sets DoD target `madge --circular server/ ≤ 5`. Actual count after PR #196: 43. The schema-leaf cascade WAS broken (the headline 175→43 reduction landed); the residual 43 are pre-existing chains the audit didn't enumerate. No spec amendment has been made yet to capture the operator framing decision.

**Files:**
- `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md` § 6.3 / § 13.3 / § 13.5A.
- `tasks/builds/audit-remediation/plan.md`.

**Goal:** record an explicit operator decision so the source spec stops carrying an unsatisfied DoD target. **This is a decision item, not implementation work.**

**Approach:**

Operator chooses one of three framings — present this list verbatim during spec-reviewer or final architecture review:

(a) **Extend a follow-on Chunk** to drive the count down further.
- Pros: meets the original DoD target.
- Cons: schedule cost; the residual 43 chains span `skillExecutor↔tools`, `agentExecutionService↔middleware`, and `agentService↔llmService↔queueService` — non-trivial refactors.

(b) **Re-scope §6.3's DoD** to "schema-leaf root cycle resolved; absolute count moved to Phase 5A".
- Pros: zero schedule cost; honest about the achieved scope.
- Cons: weakens the DoD bar; future audits may relitigate.

(c) **Accept the 43 residual to Phase 5A** and update §14 with the triaged cluster breakdown.
- Pros: explicit handoff with named clusters; preserves DoD bar by deferring it to a later phase.
- Cons: requires writing the cluster breakdown; relies on Phase 5A actually addressing it.

**Recommended default:** (c) — explicit deferral with cluster names captures intent without weakening DoD or paying for refactor cost now.

**Approach (post-decision):**
1. Apply the chosen framing to the source spec. Commit message: `docs(audit-remediation): record §6.3 cycle-count framing decision — <a|b|c>`.
2. Update `tasks/builds/audit-remediation/plan.md` with the framing and (if c) the cluster breakdown.
3. Close the spec-conformance REQ #43 item.

**Acceptance criteria:**
- One of {a, b, c} chosen and documented.
- Spec amendment committed with traceable reasoning.
- For (a): a separate spec/build slug created for the follow-on work.
- For (c): cluster breakdown lists each chain group and a one-line rationale.

**Tests required:** none.

**Dependencies:** none — pure decision.

**Risk:** zero.

**Definition of Done:**
- Decision documented; source spec updated.
- Spec status field for D2 in `§5 Tracking` is checked.

---

#### D3 — verify-skill-read-paths.sh cleanup (P3-H8)

**Source:** spec-conformance REQ #32; already tracked in `tasks/todo.md:862`.

**Audit verdict (2026-04-26 refreshed):** VALID. `scripts/verify-skill-read-paths.sh` exists. Captured fresh on this iteration:
```
FAIL: -5 actions missing readPath tag
Literal action entries: 94, with readPath: 99
```
The gate already subtracts 2 for the interface definition + methodology template (lines 14-21 of the script) — so `readPath: 99` is the post-subtraction count. Net: there are 5 SURPLUS `readPath:` lines beyond what the subtract-2 calibration accounts for. The error message `-5 actions missing` is the gate's `(94 - 99)` arithmetic showing readPath > action by 5, not the other direction. Audit spec §5.5 deferred this as lowest-priority enumeration work.

**Files:**
- `scripts/verify-skill-read-paths.sh` (gate logic — may need a tweak to reporting).
- `server/config/actionRegistry.ts` (likely site of the 5 mismatches).
- `tasks/todo.md:862` — P3-H8 entry to close.

**Goal:** reconcile the 5-surplus-readPath mismatch. The gate report shows `99 readPath:` lines (post-subtract-2) vs `94 actionType:` lines — so there are 5 surplus `readPath:` occurrences that aren't paired with an `actionType` field. The patch is one of: (a) remove 5 stray `readPath:` lines that the calibration missed, (b) add 5 missing `actionType:` lines if the readPaths are real entries with malformed metadata, (c) update the calibration constant if the surplus is structural (e.g. a new template / type-definition block was added since the gate's `-2` was set).

**Approach:**

The current gate (`scripts/verify-skill-read-paths.sh`) is a coarse line-counter — it counts `actionType: '<name>'` entries vs `readPath:` lines (with a hardcoded subtraction of 2 for non-entry occurrences: the interface definition and the methodology template at gate lines 14-21). It has no per-entry parser, so per-entry annotations would be invisible to it. Approach in this order:

1. **Step 1 — locate the 5 surplus `readPath:` occurrences.** Two greps:
   ```bash
   grep -n "actionType:" server/config/actionRegistry.ts | wc -l   # → 94
   grep -n "readPath:"   server/config/actionRegistry.ts | wc -l   # → 101 (= 99 + 2 the gate subtracts)
   ```
   List both grep outputs side-by-side. The 5 `readPath:` lines that are NOT immediately preceded by an `actionType:` line in the same object literal are the surplus. Common explanations: a recently-added "default options" template, a forward-declared interface, a `readPath` parameter on a generator function, or duplicate `readPath` fields inside one entry.
2. **Step 2 — patch shape depends on what Step 1 found:**
   - If the surplus are non-entry uses (templates / generator params / type defs): update the gate's subtraction constant from 2 to 7. **Calibration-constant change discipline (per ChatGPT review Round 2, refined per Round 4):** changing the subtraction constant is dangerous because a wrong constant masks real mismatches silently. Therefore: any change to the constant MUST list **every excluded occurrence explicitly in a comment with a stable identifier — a grep pattern + short description, NOT an absolute line number**. Line numbers drift as the file evolves; the listing becomes stale and someone "fixes" the listing by re-numbering rather than re-checking what each entry actually covers. Use a grep pattern that uniquely identifies each excluded occurrence regardless of where it sits in the file. Shape:
     ```bash
     # readPath: occurrences excluded from the count (subtraction = 7).
     # Each entry uses a grep pattern that uniquely identifies the excluded
     # occurrence in the source file (line numbers drift; grep patterns survive).
     #   pattern: 'interface ActionDefinition'        — type declaration of ActionDefinition
     #   pattern: 'methodologyTemplate default'       — methodology template default block
     #   pattern: '<unique grep pattern N>'           — <one-line reason>
     #   pattern: '<unique grep pattern N+1>'         — <one-line reason>
     #   ...
     # When you change this constant, update the list above. Each pattern MUST be
     # specific enough that `grep -n "<pattern>" server/config/actionRegistry.ts`
     # returns exactly the occurrence the entry describes — verify by running the
     # grep at the time you author the entry. A pattern that returns 0 hits or >1
     # hits is invalid (the file evolved, or the pattern is ambiguous; rewrite it).
     # A constant without a grep-pattern listing of every excluded occurrence is a
     # regression — silent drift masks real mismatches.
     READPATH_NON_ENTRY_OCCURRENCES=7
     ```
     This is non-optional. A constant change without the grep-pattern listing fails review. Reviewers MUST run each pattern against the file in the PR's diff to confirm exactly-one-hit before approving.
   - If the surplus are duplicate `readPath:` fields inside an entry: remove the duplicates (only one `readPath` per entry).
   - If the surplus are entries with `readPath` but missing `actionType`: add the missing `actionType` fields, OR remove the orphan entries if they're dead code.
3. **Step 3 — fallback if a per-entry parser is needed:** rewrite the gate to parse each ActionDefinition entry individually (TypeScript object-literal parsing — non-trivial in pure shell; would justify converting the gate to `.mjs`). Treat this as a separate, bigger task — do not bundle into D3.
4. Re-run the gate; expect matching action and readPath counts and exit 0.
5. Cross-reference and close the P3-H8 entry in `tasks/todo.md`.

**Acceptance criteria:**
- Gate exits 0 with matching action and readPath counts (via either fix-the-source or fix-the-calibration, per Step 2).
- The cause from Step 1 is captured in a one-paragraph note in `tasks/builds/<slug>/progress.md` so the audit-trail explains the actual root cause.
- `tasks/todo.md` P3-H8 entry checked off.

**Tests required:** none in code; gate is the test.

**Dependencies:** C1 (count line) — sequence so this gate emits the standard line.

**Risk:** low.

**Definition of Done:**
- Gate clean; todo entry closed.
- Spec status field for D3 in `§5 Tracking` is checked.

---

### Group E — Pre-existing test/gate failures unmasked in this PR

#### E1 — Pre-existing unit test failures (4)

**Source:** test gate run during final-review.

**Audit verdict (2026-04-25):** VALID. All four files exist:
- `server/services/__tests__/referenceDocumentServicePure.test.ts`
- `server/services/__tests__/skillAnalyzerServicePureFallbackAndTables.test.ts`
- `server/services/__tests__/skillHandlerRegistryEquivalence.test.ts`
- `server/services/crmQueryPlanner/__tests__/crmQueryPlannerService.test.ts`

The final-review log notes all four fail identically on `main` HEAD `ee428901` and on the PR branch — pre-existing, NOT branch-introduced. PR #196 surfaced them.

**Files:**
- The four test files above.
- Possibly the services under test (if a fix is needed): `referenceDocumentService`, `skillAnalyzerService`, `skillHandlerRegistry`, `crmQueryPlannerService`.

**Goal:** triage each failing test. Either fix the underlying issue or convert to a documented permanent skip with a one-line rationale. Eliminates "unrelated noise" in future audit runs.

**Approach:**
1. Run each test file individually with `tsx`:
   ```bash
   npx tsx --test server/services/__tests__/referenceDocumentServicePure.test.ts
   npx tsx --test server/services/__tests__/skillAnalyzerServicePureFallbackAndTables.test.ts
   npx tsx --test server/services/__tests__/skillHandlerRegistryEquivalence.test.ts
   npx tsx --test server/services/crmQueryPlanner/__tests__/crmQueryPlannerService.test.ts
   ```
   (This repo runs `node:test`-based files through `tsx`. The aggregate runner is `npm run test:unit` (`bash scripts/run-all-unit-tests.sh`); there is no `npm test -- <pattern>` shortcut.)
2. Capture the exact failure for each.
3. **Per test, decide:**
   - **Logic regression in the service** → fix the service.
   - **Test-only bug** (assertion against stale fixture, drift in shape, mock that no longer matches) → fix the test.
   - **Test no longer relevant** (covers behaviour the service no longer has) → delete the file, OR convert to a skipped `node:test` case via the `skip` option: `test('covers removed-behaviour X — see <commit>', { skip: 'X removed in <commit>' }, () => { ... })`. (`node:test` does not have a Jest-style `it.skip`; the `skip` option is the equivalent.)
4. **Document the disposition.** For each test, add an entry to `KNOWLEDGE.md` under "Audit-remediation followups: pre-existing test triage" naming the file, the failure, and the disposition.

**Acceptance criteria:**
- All four test files either pass, or carry a documented `node:test` `skip` option with rationale, or are deleted.
- `npm test` no longer reports these four files as failing.
- `KNOWLEDGE.md` carries the triage entries.

**Tests required:** the existing tests are the deliverable.

**Dependencies:** none.

**Risk:** low — already broken, can only improve.

**Definition of Done:**
- All four files dispositioned.
- `npm test` clean for these files.
- Spec status field for E1 in `§5 Tracking` is checked.

---

#### E2 — Pre-existing gate failures (2)

**Source:** test gate run during final-review.

**Audit verdict (2026-04-25):** PARTIAL — both gate files exist:
- `scripts/verify-pure-helper-convention.sh` — 7 violations as of the final-review log.
- `scripts/verify-integration-reference.mjs` — the captured "1 blocking error in YAML parse" diagnosis is stale. `yaml` IS in `package.json` (`yaml: ^2.8.3`), and the source-spec iteration-5 review log (`tasks/review-logs/spec-review-log-codebase-audit-remediation-spec-5-2026-04-25T07-28-39Z.md`) already noted the earlier "yaml missing" diagnosis was wrong. The actual current failure mode must be re-captured by running the gate fresh — do not rely on the stale diagnosis below.

**Step 0 (must run BEFORE anything else):** re-run `node scripts/verify-integration-reference.mjs` on current main and capture the actual current error/warning state. Replace the stale diagnosis in this spec section with the new findings before scheduling the work. The numbers below ("26 warnings", "1 blocking error") are placeholders that need to be confirmed or replaced.

**Files:**
- `scripts/verify-pure-helper-convention.sh` (gate) + 7 offender `*Pure.test.ts` files.
- `scripts/verify-integration-reference.mjs` (gate) + the actual YAML / data source the gate parses (identify by running the gate; do not leave as "TBD").

**Goal:** drive both gates to clean state, or update baselines with documented rationale.

**Approach:**

**verify-pure-helper-convention.sh (7 violations):**
1. Run the gate; capture the 7 file paths.
2. For each `*Pure.test.ts` that doesn't import from a sibling:
   - **If misnamed** (test exercises an in-process pure helper but doesn't import a sibling because the helper is defined inline) → rename to `*.test.ts` (drop `Pure`).
   - **If genuinely pure-self-contained** (e.g. tests pure utility logic against fixtures) → carry an exception annotation `// @pure-helper-convention-exempt: <reason>` at the top of the file. Update the gate to recognise the annotation.

**verify-integration-reference.mjs (counts to be confirmed by Step 0 above):**
1. With Step 0's fresh diagnosis in hand, identify the actual failure mode (parse error / missing field / shape mismatch / nothing currently failing because the earlier blocker was fixed).
2. If a real blocking error remains: fix it at the source (the YAML or data file the gate parses).
3. If only advisory warnings remain: record their count in the existing centralized baseline store at `scripts/guard-baselines.json` keyed on this gate's `GUARD_ID` (the `.mjs` gate must adopt the same baseline pattern as the shell gates — `check_baseline()` in `scripts/lib/guard-utils.sh`; for the `.mjs` runner this means writing a small JS helper that reads/writes the same JSON file). Do NOT introduce a parallel `scripts/baselines/*.txt` format. Address remaining warnings case-by-case as time allows; do NOT block on this in E2.
4. If Step 0 reveals the gate already exits 0 on current main (i.e. the captured failure was historical): close E2's `verify-integration-reference.mjs` track and update §5 Tracking accordingly with a note "verified clean on <commit>".

**Acceptance criteria:**
- `bash scripts/verify-pure-helper-convention.sh` exits 0 (or all `<N>` (currently 7) violators carry annotations the gate recognises). The captured violator count must be confirmed against current main as part of the work — do not rely on the historical "7" count.
- `node scripts/verify-integration-reference.mjs` no longer reports the actual current blocking error (per Step 0's fresh capture).
- `<N>` advisory warnings (per Step 0's fresh capture): recorded in `scripts/guard-baselines.json` under the gate's `GUARD_ID`; gate emits parseable count line per C1.
- E2's PR description follows §0.7 — if E2 commits a baseline above zero (i.e. carries forward existing warnings rather than driving them to zero), the PR description includes the §0.7 baseline note explaining why the residual count is acceptable for ship.

**Tests required:** none in code; the gates are the verification.

**Dependencies:** C1 (parseable count line) — preferred sequencing so the warning baseline lands with the standard format.

**Risk:** low.

**Definition of Done:**
- Both gates pass (or baselines updated).
- Spec status field for E2 in `§5 Tracking` is checked.

---

### Group F — Performance / efficiency follow-ups

#### F1 — findAccountBySubaccountId targeted method

**Source:** pr-reviewer N-2.

**Audit verdict (2026-04-25):** VALID. `grep -n "findAccountBySubaccountId" server/services/canonicalDataService.ts` returns nothing. `server/jobs/measureInterventionOutcomeJob.ts:208-218` defines `resolveAccountIdForSubaccount` which calls `canonicalDataService.getAccountsByOrg(organisationId)` then `.find(a => a.subaccountId === subaccountId)` client-side. Functionally correct but fetches all accounts in an org to find one.

**Files:**
- `server/services/canonicalDataService.ts` (extend with new method).
- `server/jobs/measureInterventionOutcomeJob.ts:208-218` (rewrite to use new method).
- New test: `server/services/__tests__/canonicalDataService.findAccountBySubaccountId.test.ts` (or extend an existing canonicalDataService test).

**Goal:** add a single-query targeted lookup to replace the all-accounts-then-filter pattern. Closes a hot-path inefficiency for orgs with many subaccounts.

**Approach:**
1. Add `findAccountBySubaccountId(principal: PrincipalContext, subaccountId: string): Promise<CanonicalAccount | null>` to `canonicalDataService`. Implementation: single SELECT with both predicates:
   ```sql
   SELECT * FROM canonical_accounts
   WHERE organisation_id = :orgId AND subaccount_id = :subaccountId
   LIMIT 1
   ```
2. Update `resolveAccountIdForSubaccount` in `measureInterventionOutcomeJob.ts:208-218` to call the new method:
   ```ts
   async function resolveAccountIdForSubaccount(
     principal: PrincipalContext,
     subaccountId: string | null,
   ): Promise<string | null> {
     if (!subaccountId) return null;
     const account = await canonicalDataService.findAccountBySubaccountId(principal, subaccountId);
     return account?.id ?? null;
   }
   ```
3. **If A1a has shipped:** sign the new method with `PrincipalContext` directly (per A1a's signature standard).
   **If A1a has not shipped yet:** sign with `(orgId, subaccountId)` and migrate when A1a lands. Either ordering is fine; prefer A1a-first.
4. Search for other call sites of the all-accounts-then-filter pattern: `grep -rn "getAccountsByOrg" server/ | grep -v __tests__`. Any other site doing `.find(a => a.subaccountId === ...)` should also migrate.

**Acceptance criteria:**
- `findAccountBySubaccountId` exists on `canonicalDataService`.
- A unit test asserts the method emits a single-row SELECT with both predicates (verifiable via Drizzle's query inspection or by mocking the underlying `db.select` and asserting the WHERE clause).
- `measureInterventionOutcomeJob.ts:208-218` uses the new method.
- Any other discovered call sites are migrated (or explicitly noted as out-of-scope and tracked).

**Tests required:**
- New test in `server/services/__tests__/`: constructs a fixture, asserts the SELECT shape and result.
- Existing job tests should continue to pass.

**Dependencies:** A1a preferred but not blocking (see step 3 above).

**Risk:** low — additive method + one consumer migration.

**Definition of Done:**
- New method on `canonicalDataService`; consumer migrated; test passes.
- Spec status field for F1 in `§5 Tracking` is checked.

---

#### F2 — configDocuments parsedCache durability

**Source:** pr-reviewer N-5.

**Audit verdict (2026-04-25):** VALID. `server/routes/configDocuments.ts:33-36` and `:103-104`:
```ts
// Phase 3 in-memory cache — swapped for a table-backed cache in Phase 4.
// Each entry has a 10-min TTL to bound memory growth.
const CACHE_TTL_MS = 10 * 60 * 1000;
const parsedCache = new Map<string, ConfigDocumentSummary>();
// …
parsedCache.set(id, summary);
setTimeout(() => parsedCache.delete(id), CACHE_TTL_MS);
```
The route's own comment names Phase 4 as the migration point. Same defect class as Phase-5A §8.1 rate-limiter durability work — key-value with TTL, per-process state.

**Files:**
- `server/routes/configDocuments.ts:33-36, 103-104` (consumer migration).
- Existing primitive (Phase-5A planned): `server/services/rateLimitStoreService.ts`. Source spec `2026-04-25-codebase-audit-remediation-spec.md` §8.1 already names this as the shared sliding-window / bucket-with-TTL primitive for the same defect class (per-process Map state). F2 reuses this primitive rather than introducing a new one. **No new primitive file is created by F2.**
- Schema: F2 does not introduce a new schema; it relies on the table `rateLimitStoreService` will land (Phase-5A §8.1's migration). If Phase-5A's table is `rate_limit_buckets` and is shaped specifically for sliding-window rate limiting (not generic KV with TTL), F2's preferred consumer pattern is to call `rateLimitStoreService` only if its surface fits; otherwise fall back to the in-memory `Map` until a generic KV primitive is justified by a second use site (see step 3 below).

**Goal:** replace per-process in-memory cache with the planned shared durable primitive when it ships, OR document explicit deferral if the planned primitive's shape doesn't fit a generic KV-with-TTL use case. Avoid inventing a parallel primitive.

**Approach:**
1. **Check Phase-5A status before doing any code work.** Three sub-cases:
   - **Phase-5A merged with `rateLimitStoreService` AND its API is general-purpose KV-with-TTL** (`set(key, value, ttlMs)` / `get(key)`): consume it directly (step 2).
   - **Phase-5A merged but `rateLimitStoreService` is shape-specific to sliding-window rate limiting** (`incrementBucket` / `sumWindow` only — see source spec §8.1): the surface does not fit `configDocuments`'s "store a parsed-document summary blob keyed by uuid for 10 minutes" need. Stop F2, write a one-line note in `tasks/todo.md` under "F2 deferred: rateLimitStoreService surface doesn't generalise; defer until a second use site justifies a separate KV-TTL primitive", and leave the in-memory cache in place.
   - **Phase-5A not yet merged:** defer F2 until Phase-5A ships and the surface decision can be made.
2. **Migrate `configDocuments.ts` (consumer-only path, only if step 1 case (a) applies).**
   - Replace the `Map` with `rateLimitStoreService` calls using the existing API surface.
   - `parsedCache.set(id, summary)` → `await rateLimitStoreService.set(id, summary, CACHE_TTL_MS)` (or whatever the existing `set(...)` signature is — adapt to the actual API).
   - `parsedCache.get(id)` → `await rateLimitStoreService.get(id)`.
   - Remove the `setTimeout` deletion — TTL is enforced by the underlying store.
3. **No new primitive in this spec.** If Phase-5A's surface doesn't generalise, F2 stays deferred. The decision to introduce a generic `kvStoreWithTtl` primitive belongs in a future spec that has at least two concrete consumers and a "why not extend `rateLimitStoreService`" paragraph per `docs/spec-authoring-checklist.md` §1.
4. **Verify** via existing route tests; if step 1 case (a) applies, add one test that exercises the cache miss → re-parse path.

**Acceptance criteria (only applies when Phase-5A surface fits — case (a)):**
- `parsedCache` `Map` removed; `configDocuments.ts` calls `rateLimitStoreService` (or its successor) instead.
- Process restart: a value set with TTL > restart time remains readable after restart (manual smoke — start server, set value, restart server, read value).
- TTL expiry: a value past its expiry is not returned.

**Acceptance criteria (when Phase-5A surface does not fit — case (b)):**
- `tasks/todo.md` carries an entry "F2 deferred: rateLimitStoreService surface doesn't generalise; revisit when a second KV-TTL consumer surfaces". The entry MUST include explicit, measurable re-evaluation triggers (per ChatGPT review Round 4 — a deferral with no trigger becomes permanent silently). Required shape:
  ```
  - [ ] F2 deferred: rateLimitStoreService surface doesn't generalise; revisit when a second KV-TTL consumer surfaces.
    - Owner: <name or role of the F2 evaluator at deferral time, OR the next configDocuments-domain build-slug lead>
    - Re-evaluation triggers (whichever fires first):
      1. A SECOND in-codebase use case for "key + value + TTL" surfaces (e.g. another route adds a similar Map-with-setTimeout pattern) — at that point the two-consumer count justifies a generic `kvStoreWithTtl` primitive per `docs/spec-authoring-checklist.md` §1, OR
      2. The `configDocuments` route's median end-to-end latency exceeds 500ms over a rolling 24-hour window (the cache miss → re-parse path becomes a user-visible regression at that threshold) — measured via existing route-timing logs once the live-users phase begins per `docs/spec-context.md`, OR
      3. A `configDocuments`-domain build slug is opened for any reason (the implementer revisits F2 as part of that build's pre-implementation audit).
    - Back-link: docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md § F2.
  ```
- `parsedCache` `Map` left in place; no code change.
- F2 row in §5 Tracking marked `↗ migrated to deferred` with the todo link.

**Tests required:**
- New pure-function test for the cache-miss → re-parse path in `configDocuments` (case (a) only). No multi-process integration test in this spec — a multi-process test sits outside the carved-out integration-test envelope (RLS / idempotency / crash-resume) and would require new test infrastructure. Restart durability is verified via the manual smoke step in Acceptance criteria.

**Dependencies:**
- Phase-5A `rateLimitStoreService` (must ship first; F2 cannot proceed without it).
- A2 (RLS write-boundary) preferred so the underlying table is registered through the same path other tenant tables use.
- A1a / A1b not strictly required.

**Risk:** low. Single route surface; behaviour hidden behind a cache-miss → re-parse path so a degraded (slower) experience is the worst case if the primitive misbehaves. F2 will not introduce a new primitive — the higher-risk path is explicitly closed off in step 3 of the Approach.

**Definition of Done:**
- Either: `parsedCache` removed from `configDocuments.ts` and consumer migration verified (case (a)), OR: F2 explicitly deferred with a `tasks/todo.md` entry (case (b)).
- No new primitive file introduced by F2 itself.
- Spec status field for F2 in `§5 Tracking` is checked (or migrated, per case).

---

### Group G — Operational / pre-deploy gates

#### G1 — Migration sequencing verification (superseded — PR merged)

**Source:** chatgpt-pr-review Round 1 — Risk #2.

**Audit verdict (2026-04-25):** SUPERSEDED. PR #196 merged at `f824a03`. The pre-merge gate cannot be retroactively run as designed (its acceptance criterion was "before merging PR #196"). However, the underlying *intent* — verify migration ordering and per-table write success/failure under FORCE RLS — remains valuable as a re-runnable verification.

**Files (if executed as a post-deploy check):**
- New: `scripts/verify-migration-sequencing.sh` (script that runs the four checks below against any environment).
- No code change to schema or migrations (those were validated implicitly by passing CI when PR #196 merged).

**Goal:** convert the never-executed pre-merge gate into a re-runnable post-deploy verification script. Lets future migration-heavy PRs gain the same coverage.

**Approach:**

G1's reusable script is scoped to **current-order replay only** — it does NOT attempt to roll back to historical commits or compare against historical schema snapshots. That capability is explicitly out of scope for this version because (a) the pre-merge G1 form was never run and is now historical, and (b) cross-commit comparison requires `git show` shell-out for every migration file, plus a schema-introspection diff against an artefact this repo doesn't yet maintain. Both belong in a separate, larger spec if anyone ever needs them.

1. Write `scripts/verify-migration-sequencing.sh` parameterised on a database URL. Steps:
   1. Spin up a fresh disposable database (a one-shot Postgres container, or a local dev DB the operator is OK to drop). Run every migration in `migrations/` (current numerical order) end-to-end. Verify zero errors. Verify the resulting schema matches what Drizzle expects:
      - Run `npx drizzle-kit introspect` to dump the actual DB schema to a temp `.ts` file.
      - Diff the introspected output against `server/db/schema/*.ts` using `node:assert.deepStrictEqual` on the parsed AST or, simpler, use `diff -u` after running both through a `prettier --parser typescript` normaliser.
      - Any non-trivial diff is a finding. Trivial diffs (whitespace, comment-only, import-order) are ignored.
      - This step's load-bearing claim is "Drizzle schema is authoritative; migrations must produce that schema". The diff is the enforcement.
   2. With `app.organisation_id` SET to a fixture org: for each tenant table (`agents`, `automations`, `memory_review_queue`, `document_bundles`, `agent_run_snapshots`, plus any added since PR #196), exercise both a `SELECT` and an `INSERT` inside a `BEGIN…ROLLBACK` envelope. Both must succeed.
   3. With `app.organisation_id` UNSET: same operations, but split expected outcomes by operation type (matching the source remediation spec's RLS contract):
      - `SELECT` returns zero rows (RLS filters silently — no exception).
      - `INSERT` / `UPDATE` / `DELETE` is REJECTED with a Postgres error (FORCE RLS turns missing-org writes into hard failures, not silent zero-row no-ops).
      - The script asserts each behaviour explicitly. If a tenant table's write returns zero rows instead of erroring, that's a finding (the table's RLS policy is missing FORCE RLS).
2. Wire into a manual-trigger CI workflow (not blocking on every commit; runs on demand or pre-deploy when the operator chooses).
3. Treat the very first run as the post-deploy validation for PR #196 — execute against a local dev DB and capture results.

**Acceptance criteria:**
- Script exists and is executable.
- First run passes against a fresh disposable DB.
- Failure modes: a deliberately-broken migration (out-of-order, missing FORCE RLS) → script fails with the offending migration named.

**Tests required:** the script itself; first run is the test.

**Dependencies:** none.

**Risk:** low. The script performs deliberate test writes inside a `BEGIN…ROLLBACK` envelope on a disposable DB; it is verification-by-controlled-write, not strictly read-only. No staged-rollout posture is implied — the codebase explicitly does not run staging deploys (per `docs/spec-context.md` `staged_rollout: never_for_this_codebase_yet`); G1 runs against any disposable Postgres the operator can spin up.

**Definition of Done:**
- Script committed.
- First run executed; results captured in `tasks/builds/audit-remediation-followups/` or equivalent.
- Spec status field for G1 in `§5 Tracking` is checked.

---

#### G2 — Post-merge smoke test runbook

**Source:** chatgpt-pr-review Round 1 — post-merge checklist.

**Audit verdict:** ACTIONABLE. PR #196 has merged; this runbook is still pending unless it was completed off-record. Treat as todo.

**Files:**
- New: `tasks/runbooks/audit-remediation-post-merge-smoke.md` (the runbook itself).
- Output: capture the run as a `KNOWLEDGE.md` entry under "Post-merge observations: PR #196".

**Goal:** observational verification that PR #196's new surfaces (agent creation, automation runs, GHL webhook, four jobs, LLM router metrics, log volume) operate as expected in the merged-to-main state.

**Approach (run once, in this order):**
1. Create one agent via the admin UI; assert no errors in client/server logs.
2. Trigger one automation; assert the workflow run completes.
3. Trigger one webhook (GHL); assert the canonical-row write succeeds.
4. Trigger and observe each of the four jobs:
   - `bundleUtilizationJob` is **disabled until Phase 6** (per its file header `Schedule: disabled until Phase 6`); enqueue it manually via the queue admin tooling and confirm it runs without exception.
   - `measureInterventionOutcomeJob` runs hourly — wait for one scheduled cycle OR enqueue manually.
   - `ruleAutoDeprecateJob` runs nightly — enqueue manually; do NOT wait for the nightly slot.
   - `connectorPollingSync` runs continuously — observe the next natural cycle.
   Assert each runs without exception.
5. Tail logs for 10 min on current main; observe baseline WARN-level volume and any specific WARN lines that look new or unusual. (No pre-merge baseline log is checked in for comparison; this is current-state observation only — if a future PR wants pre/post deltas, it must capture its own pre-merge baseline.)
6. Tail LLM router metrics for 10 min: cost-per-request, retry rate; investigate any spike.
7. Capture any unexpected behaviour as a `KNOWLEDGE.md` entry under "Post-merge observations: PR #196".

**Acceptance criteria:**
- All seven steps complete without escalation.
- Outcomes recorded in `KNOWLEDGE.md`.
- If any escalation: a follow-up todo entry created in `tasks/todo.md` with the specific issue.

**Tests required:** the runbook completion is the test.

**Dependencies:** none. Should run as soon as feasible — defer reduces signal.

**Risk:** zero (observational).

**Definition of Done:**
- Runbook committed; first run completed; observations logged.
- Spec status field for G2 in `§5 Tracking` is checked.

---

### Group H — System-level invariants

#### H1 — Cross-service dependency null-safety contract

**Source:** chatgpt-pr-review Round 2.

**Audit verdict (2026-04-25):** VALID. `architecture.md` § Architecture Rules contains no rule about derived-data null-safety. No `scripts/verify-derived-data-null-safety.sh` exists. The codebase already does this correctly in many places (nullable enrichment patterns) but it's not enforced as a rule, so new services regress to "assume populated" by default.

**Files:**
- `architecture.md` § Architecture Rules (one rule added).
- New: `scripts/verify-derived-data-null-safety.sh` (gate).
- New: `scripts/derived-data-null-safety-fields.txt` (allowlist of async-produced field names; consumed by the gate).
- New: `server/lib/derivedDataMissingLog.ts` (shared WARN-line helper, sibling of `server/lib/logger.ts` — placed at the existing `server/lib/` level rather than a new `server/lib/logging/` subdirectory, since the only logging primitive in the repo today is `server/lib/logger.ts` and a single sibling does not justify a new subtree).
- New tests: per-service tests under `__tests__/<service>.derivedDataNullSafety.test.ts` for services that read async-produced state.

**Goal:** codify a single architecture-level rule so consumers of derived data (rollups, bundle outputs, intervention outcomes, async-enrichment fields) treat that data as nullable by default. Closes the silent-degradation failure mode where consumers throw or cascade-fail when an upstream job hasn't run yet.

**Approach:**

1. **Codify the rule in `architecture.md` § Architecture Rules.** Exact wording:
   > **Derived-data null-safety.** No service may assume the existence of data produced by a job, rollup, or async pipeline unless that existence is enforced by a DB constraint OR is synchronously produced inside the same transaction. For derived reads (rollups, bundle outputs, intervention-outcome state, pulse-derived metrics, async canonical enrichment): treat the value as nullable. On null, return `null` / empty list / sentinel — never throw. Emit one WARN log line `data_dependency_missing: <service>.<field> for <orgId>` (rate-limited to once per key per interval, OR first-occurrence WARN with subsequent occurrences downgraded to DEBUG — see `server/lib/derivedDataMissingLog.ts`) so operators can detect ramp-up gaps without log spam masking the signal.

   The architecture.md rule is the durable policy and applies to all derived reads named above. **H1 Phase 1's enforcement sweep is narrower** — it touches only the four job-output domains named in step 2 below. Broader enforcement (pulse-derived metrics, agent-run-snapshot enrichment, etc.) requires a separate follow-up backlog item; the rule itself stays broad.

2. **Identify the in-scope read sites — H1 Phase 1 scope lock (per ChatGPT review Round 2).** H1 Phase 1 applies ONLY to consumers of the four job output domains listed below. ANY additional domain — pulse-derived metrics, agent-run-snapshot enrichment, generic rollup tables, third-party-derived data, etc. — is OUT of Phase 1 scope. Adding those domains requires a separate backlog item with its own scope and dependency analysis; do NOT absorb them into H1 Phase 1 mid-implementation (this is the §0.3 no-cross-item-expansion rule applied specifically to H1).

   **Phase 1 in-scope domains (exhaustive):**
   - All consumers of `bundleUtilizationJob` outputs.
   - All consumers of `measureInterventionOutcomeJob` outputs.
   - All consumers of `ruleAutoDeprecateJob` outputs.
   - All consumers of `connectorPollingSync` outputs (canonical-row enrichment fields produced by this job).

   Build the list of read sites in `tasks/builds/<slug>/null-safety-call-sites.md`. Any consumer that crosses the four-domain boundary (e.g. a service that reads both `bundleUtilizationJob` outputs AND a pulse-derived metric) handles ONLY the four-domain reads in Phase 1; the pulse-derived read stays as-is and is logged for the future broader-scope item.

   **Why scope-lock matters here:** H1 is high-leverage but the "what counts as derived data" question is fuzzy. Without a scope lock, the gate's allowlist drifts (per ChatGPT review Round 1's H1 risk-pattern note: "excessive exemptions, dev friction, gate becomes meaningless"). Locking Phase 1 to the four named domains keeps the gate's signal strong and the work surgical.

3. **Refactor each in-scope site:**
   - Replace `data!` non-null assertions with `if (!data) { warn(...); return null; }` (or empty list / sentinel).
   - Replace `if (!data) throw …` with the WARN-and-return pattern above.
   - Add unit tests asserting the "upstream not populated yet" path returns null without throwing.

   **Additive-only output shapes during Phase 1 (per ChatGPT review Round 3).** Inconsistent output shapes across the four in-scope domains will silently break downstream consumers — a consumer that today reads `outcome.measuredAt` and gets `null` when the upstream hasn't run is fine; a consumer that today reads `outcome.measuredAt` and discovers in Phase 1 that the field has been *renamed* to `outcome.outcomeMeasuredAt` is broken in a way the null-safety rule does NOT catch. Constraint: **during Phase 1, the canonical output shapes of the four in-scope job domains MUST be additive only — no field removals and no field renames are permitted**. If a refactor surfaces a need to rename or remove a field, stop and write a follow-up backlog entry (per §0.3); do not absorb the rename into the H1 Phase 1 PR. The architecture.md rule (step 1) governs the *null-safety contract*; the additive-only constraint governs the *shape contract* and applies for the duration of Phase 1's rollout window. Phase 2 (gate promotion) does not lift this constraint by itself — a separate follow-up spec must opt-in to shape changes once the four-domain consumer set is stable.

4. **Audit gate (`scripts/verify-derived-data-null-safety.sh`) — ships ADVISORY on first release.** Per ChatGPT review Round 1, static detection of "derived data" is inherently fuzzy and field allowlists drift; shipping the gate as blocking on day 1 risks excessive exemptions and developers learning to ignore failures. Phasing:
   - **Phase 1 — advisory mode (first ship):** the gate runs in CI and emits violations, but exits 0 regardless. The architecture.md rule (step 1) and the `logDataDependencyMissing` helper (step 5) remain mandatory; the gate is the soft-enforcement layer only.
   - **Phase 2 — promote to blocking:** once the gate has run for **2-3 weeks** with no false positives flagged by developers AND the violation count has stabilised (no week-over-week drift in the allowlist), promote the gate to blocking. Promotion is a one-line change to the gate's exit logic; record the promotion date in the build-slug progress log.
   - This phasing matches the §0.1 Gate Quality Bar: a gate with non-zero FP rate ships advisory until FP rate falls below 5%.

   Static-analysis pattern (same in both phases):
   - Maintain a small allowlist file: `scripts/derived-data-null-safety-fields.txt` listing the field names that are async-produced (e.g. `utilizationRatio`, `outcomeMeasuredAt`, `ruleDeprecatedAt`).
   - Grep for `<field>!` non-null assertions or `if (!<value>) throw` patterns referencing those fields. Fail (advisory) on hits.
   - Allow exemption via comment annotation `// @null-safety-exempt: <reason>`.
   - Emit `[GATE] derived-data-null-safety: violations=<count>` per C1.

5. **Operator log signal.** Define a single shared helper `logDataDependencyMissing(service, field, orgId)` in `server/lib/derivedDataMissingLog.ts` (sibling of `server/lib/logger.ts`) so every WARN line is shaped identically and parseable for dashboards. Internally the helper delegates to the existing `server/lib/logger.ts` so no new logger framework is introduced.

   **Rate-limiting contract (per ChatGPT review Round 4).** A high-frequency read path that hits the same null condition repeatedly (e.g. a request loop reading `bundleUtilization.utilizationRatio` for an org whose nightly job hasn't run yet) WILL emit `data_dependency_missing` on every read. Without rate-limiting that becomes log spam — operators learn to filter the line, signal degrades, the rule loses its operational value. The helper MUST implement one of the two patterns below, picked at implementation time based on the call-site distribution found in step 2's `null-safety-call-sites.md`:
   - **Pattern A — once-per-key-per-interval rate limit (preferred for hot paths).** The helper holds an in-memory `Map<string, number>` keyed on `<service>.<field>:<orgId>` storing the last emit timestamp. On each call: if the previous emit for that key was within the rate-limit window (default: 60 seconds), skip the WARN emission entirely; otherwise emit and update the timestamp. Counter aggregation is deliberately NOT added — a counter that aggregates skipped emissions is more complexity than the operational signal needs. The first WARN per key per window is the signal; subsequent identical WARNs in the window are noise. Window value MAY be tuned via `process.env.DATA_DEPENDENCY_MISSING_RATE_LIMIT_MS` for ops emergencies; default lives in the helper.
   - **Pattern B — first-occurrence WARN, subsequent occurrences DEBUG (preferred for low-volume paths).** The helper emits the first occurrence of each `<service>.<field>:<orgId>` key as WARN; every subsequent occurrence drops to DEBUG (which is filtered out by default in production log aggregation). Reset key tracking on process restart — the in-memory `Set<string>` is good enough; a long-running pod that accumulates many keys is a separate scaling problem and out of scope for H1.

   The helper's interface is identical in both patterns (`logDataDependencyMissing(service, field, orgId)`); the choice is internal. Document the chosen pattern in the helper's JSDoc and in `architecture.md`'s H1 rule line so operators know which pattern is in force. Tests in step 3 cover both the first-occurrence emit AND the rate-limited-skip / debug-downgrade behaviour, so the contract is exercised.

   **Why this is mandatory, not advisory.** Round 1 already flagged H1 over-logging risk; Round 4 made it concrete. Without rate-limiting, the WARN line becomes a noise category operators tune out; the rule then exists in name only. The rate-limit / DEBUG-downgrade pattern preserves the first-instance signal (which is what operators actually need to detect ramp-up gaps) while suppressing the noise of repeat hits.

**Acceptance criteria (Phase 1 — first ship, gate is advisory):**
- Rule codified in `architecture.md` § Architecture Rules.
- All in-scope read sites — strictly the four job-output domains named in step 2 above — refactored to return-null-with-warn (no throw, no cascade). Sites outside the four-domain scope are NOT touched in Phase 1.
- `tasks/builds/<slug>/null-safety-call-sites.md` documents every site that was touched AND every adjacent site that was deliberately NOT touched (with a one-line reason — "pulse-derived metric, out of Phase 1 scope") so future broader-scope work has the inventory.
- Gate's allowlist (`scripts/derived-data-null-safety-fields.txt`) lists ONLY field names produced by the four in-scope jobs. Adding a field outside the four-domain scope to the allowlist is itself out-of-scope drift.
- Gate exists; runs in CI; deliberately re-introduce a `data!` assertion → gate REPORTS the violation but exits 0.
- Per-service unit tests cover the "upstream not yet populated" path.
- WARN log helper used uniformly.

**Acceptance criteria (Phase 2 — promote to blocking, ≥2-3 weeks after Phase 1):**
- No false-positive issues filed against the gate during Phase 1 observation window.
- Violation count week-over-week is stable (no allowlist drift).
- Gate exit logic updated to fail on non-zero violations; deliberate re-introduction now causes a hard CI failure.
- Promotion date recorded in `tasks/builds/<slug>/progress.md`.

**Tests required:**
- Per-service tests asserting null-input handling (no throw, returns sentinel, emits the WARN line — capture logs in test).
- Gate self-test: deliberate-violation fixture must fail.

**Dependencies:**
- C1 (parseable count line) — preferred so this gate emits the standard line.
- B2 (job idempotency) — NOT required. Per the §2 sequencing tweak (ChatGPT review Round 1), H1 now ships BEFORE B2 so the null-safety contract is in place when B2's per-job idempotency work begins. The earlier "B2 sequencing-friendly" note is stale and superseded.
- A1a (principal context: service surface change) — not strictly required, but the new tests should accept `PrincipalContext` if A1a has shipped.

**Risk:** low (additive defensive code). Highest leverage item in this spec — codifies a rule that prevents a recurring failure class.

**Definition of Done:**
- Phase 1: rule documented; all in-scope sites refactored; gate exists in advisory mode; tests pass.
- Phase 2: gate promoted to blocking after observation window; promotion date logged.
- Spec status field for H1 in `§5 Tracking` is checked when Phase 1 ships; promotion to Phase 2 is tracked separately in the build-slug progress log.

---

---

## §2 Sequencing

PR #196 is merged. Re-sequenced relative to the original draft (which assumed pre-merge work for G1), again per ChatGPT review Round 1 (front-load signal cleanup before heavy migrations), and again per ChatGPT review Round 4 (front-load **C1** so every subsequent item ships against the standard `[GATE]` output format from day 1).

**Sequencing principle (per ChatGPT review Round 1, refined per Round 4):** clean signal first (tests + gates), establish the gate output standard (C1) before any other gate work, then fix small leaks, codify system rules, then do heavy migrations. Reduces cognitive load during the high-blast-radius items (A1a/A1b/A2/B2) and ensures every gate this spec touches emits the `[GATE]` line from day 1 instead of needing a retrofit pass.

**Why C1 moves to position 2 (per ChatGPT review Round 4):** the original Round-1 sequencing put C1 at position 4 (inside the drift-guards group). The Round-4 observation: C1 is purely additive (changes the gate output format only — does not change behaviour) and is foundational for every subsequent gate's investigation, baseline capture, and CI parsing. Shipping C1 second means every gate cleanup in positions 3+ can rely on the standard format from the moment it lands, instead of catching up later. The cost of moving C1 earlier is half a day's effort (already estimated at half-day in the chunk-size column); the benefit is cleaner signal across the entire remaining spec.

| Order | Item | Why | Suggested chunk size |
|---|---|---|---|
| 1 | **G2** — post-merge smoke test | First; observational validation of merged state. Lowest cost, highest signal. | half-day |
| 2 | **C1** — parseable gate count line | Foundational for C2, D3, E2, H1, A1b, A2 — every subsequent gate ships against the C1 standard from day 1, no retrofit pass. **Moved earlier per ChatGPT review Round 4** (was position 4). | half-day |
| 3 | **G1** — migration sequencing verification (re-runnable script) | Convert the never-executed pre-merge gate into a re-runnable script so future migration-heavy PRs benefit. | 1 day |
| 4 | **D1, D2, D3** — pre-merge gate cleanups | Closes the audit-trail items left by Phase 2. D2 is decision-only (no code). D3 depends on C1 (now shipped at position 2). | 1 day total |
| 5 | **E1, E2** — pre-existing test/gate failures | Cleanup pass; unblocks signal in future audit-runner runs. E2 depends on C1 (now shipped at position 2). | 1–2 days |
| 6 | **B1, C4** — zero-risk additive | Trivial; ship anytime, possibly bundled into other PRs of opportunity. | < 1 hour each |
| 7 | **C2, C3** — drift / architect / canonical-registry guards | Bundle as a single "drift-guards" PR. C2 depends on C1 (now shipped at position 2). | 1 day |
| 8 | **A3, F1** — internal refactors | Independent small PRs. | 1 day each |
| 8b | **F2** — configDocuments cache durability | Blocked behind Phase-5A `rateLimitStoreService` (per source spec §8.1) — F2 cannot start until that primitive ships. Not part of the parallel-shippable batch. | 1 day after Phase-5A |
| 9 | **H1** — cross-service null-safety contract | High-leverage system rule. Codify before further service expansion. Gate ships ADVISORY on first release per §0.1; promote to blocking after 2-3 weeks of stable signal. | 2-3 days |
| 10 | **A1a** — principal-context propagation: service surface change | Migrate `canonicalDataService` signatures + callers; deprecated overload kept temporarily. | 2-3 days |
| 11 | **A1b** — principal-context propagation: gate hardening | Remove A1a's deprecated overloads; flip gate to call-site granularity. Depends on A1a. | 1-2 days |
| 12 | **B2 + B2-ext** — job idempotency + concurrency standard | After A1a/A1b (some jobs benefit from `PrincipalContext`-aware data access). Per-job ordering: connectorPollingSync -> bundleUtilizationJob -> measureInterventionOutcomeJob -> ruleAutoDeprecateJob (lowest-risk-first). | 3-4 days (each job is its own mini-PR) |
| 13 | **A2** — RLS write-boundary guard | Phased rollout per §A2 Phasing block: Phase 1 (schema-diff gate) -> Phase 2 (migration hook) -> Phase 3 (runtime guard). New architectural primitive — ship LAST in this spec to maximise observation time on the rest of the changes. **Independent of A1** — A2's mechanism is table-name + Proxy-based, not principal-flag-based. | 3-4 days, spread across phases |

**Critical-path summary:**
- **Wave 1 — signal foundation + cleanup (parallel-friendly except C1 first):** G2, **C1** (must land before any other gate work this spec touches), G1, D1/D2/D3, E1/E2, B1/C4 — ~1-1.5 weeks if pipelined. C1 (now at position 2) precedes everything else in the wave.
- **Wave 2 — drift guards + small refactors (parallel-friendly):** C2/C3, A3, F1, H1 — ~1 week. C2/H1 depend on C1 (already shipped in Wave 1).
- **Wave 3 — heavy migrations (sequential):** A1a -> A1b -> B2 (per-job sequence) -> A2 (phased) — ~2-2.5 weeks. F2 floats whenever Phase-5A's primitive becomes available.

**Total estimate:** 4-5 weeks of focused effort (one engineer), 3-3.5 weeks if multiple chunks ship in parallel within Waves 1+2. Wave 3 is intentionally serial. Treat this estimate as planning input only — re-estimate per chunk during build slug planning.

---

---

## §3 Out of scope (explicit rejects, do NOT re-litigate)

These were considered during the four-pass review of PR #196 and explicitly rejected. They are listed here so future audits don't relitigate them as "missed".

- **chatgpt-pr-review Round 1 watch-fors with no concrete claim** — "scope blast radius" / "cross-service coupling" / "LLM cost surface expansion". Auto-rejected as advisory; no actionable item exists. (Note: H1 in this spec captures the *concrete* version of cross-service coupling that emerged in Round 2 — that one is in scope.)
- **Codex's `anyBlocked` revert proposal** — rejected by dual-reviewer Claude-adjudication; would have triggered TS2367. Already handled with a clarifying comment in `server/services/skillExecutor.ts:2261-2265`.
- **PR splitting** — ChatGPT itself recommended NOT splitting at this stage. PR #196 shipped intact. Future PRs in this backlog should ship as small, focused units (per §2 sizing column) — but PR #196 itself is closed.
- **Adding more abstraction layers / additional logging systems** — explicit chatgpt-pr-review reject. Do not introduce new logger frameworks, new generic abstraction layers, or new internal event-bus primitives as part of this backlog. The primitives the spec calls for (`rlsBoundaryGuard` runtime helper, gate emit helpers, the `logDataDependencyMissing` shared helper in H1) are concrete and named — no broader scope. F2 explicitly does NOT introduce a new generic `kvStoreWithTtl` primitive; it reuses Phase-5A's `rateLimitStoreService` or stays deferred.
- **Retroactive G1 execution as a pre-merge gate.** PR #196 is merged at `f824a03`. The pre-merge form of G1 cannot be run. The re-runnable post-deploy form is in scope (see G1 above) — but not as a "block PR #196 retroactively".

---

---

## §4 Definition of Done

This spec is complete when every actionable item in §1 has shipped (or, for D2, the operator decision is recorded). The summary table below is the single dashboard view.

| Item | Risk | Class | Test signal | Ships in PR |
|---|---|---|---|---|
| A1a | medium | Significant | unit test on `canonicalDataService` (PrincipalContext surface) | dedicated PR |
| A1b | low | Standard | gate self-test (deliberate-regression fixtures) | dedicated PR (after A1a) |
| A2 | medium | Significant | guard unit tests + schema-diff gate self-test | three sequential PRs (Phase 1, 2, 3) |
| A3 | low | Standard | existing route tests pass | bundle-friendly |
| B1 | zero | Trivial | new pure test | bundle-friendly |
| B2 + B2-ext | medium | Significant | per-job double-invocation tests + concurrency tests | dedicated PR |
| C1 | low | Standard | manual smoke + grep on emit line | drift-guards PR |
| C2 | low | Standard | gate self-test on fixtures | drift-guards PR |
| C3 | low | Standard | drift test passes | drift-guards PR |
| C4 | zero | Trivial | n/a (comment fix) | bundle-friendly |
| D1 | low | Standard | baselines captured + diff documented | investigative |
| D2 | zero | Trivial | spec amendment committed | docs-only |
| D3 | low | Standard | gate exits 0 | bundle-friendly |
| E1 | low | Standard | `npm test` clean for the four files | dedicated PR |
| E2 | low | Standard | both gates pass | dedicated PR |
| F1 | low | Standard | new unit test asserts targeted SELECT | bundle-friendly |
| F2 | low | Standard | restart-durability manual smoke | dedicated PR (consumer-only; depends on Phase-5A `rateLimitStoreService`) |
| G1 | zero | Standard | first run captures results | dedicated PR |
| G2 | zero | Trivial | runbook completed; KNOWLEDGE.md entry | runbook |
| H1 | low | Significant | per-service tests + gate self-test | dedicated PR |

**Exit criteria for the entire spec:**
- All boxes in the §5 Tracking table checked.
- Every gate introduced by this spec emits the C1 standard count line.
- `architecture.md` § Architecture Rules carries the H1 derived-data null-safety rule and the B2 concurrency-model rule.
- Every new gate has a deliberate-violation fixture proving it fires.
- No items moved to "deferred" silently — anything not implemented is either explicitly rejected (move to §3) or rescheduled with a rationale.

### §4.1 Per-item integrity check (per ChatGPT review Round 3)

Before marking any individual item in §1 as complete (i.e. before flipping its §5 Tracking row from `⧖` to `✓`), the implementer MUST verify all four conditions below. This is a per-item discipline, not a one-off spec-level pass — a feature can be "technically done" in the sense of "the code merged" but actually incomplete in a way that surfaces only later. The checklist closes that gap.

1. **All Definition-of-Done conditions for the item pass in CI.** No "passes locally"; no "passes if you skip the flaky test"; no "the gate is advisory so we shipped it red". The item's per-item DoD block (or split DoD blocks, e.g. B2 / B2-ext / A2-Phase-1/2/3) sets the bar — every condition is independently checked in CI on the merge commit.
2. **No TODOs or placeholders remain in changed files.** Grep the diff for `TODO`, `FIXME`, `XXX`, `HACK`, `<placeholder>`, `<TBD>`, and any item-specific markers (e.g. the `// @deprecated — remove in A1b` tag is OK in A1a's PR but MUST NOT survive A1b's PR). A placeholder that survives merge becomes invisible technical debt.
3. **All new invariants are observable via logs or tests.** Every new contract this spec adds — the `[GATE]` line, `job_noop:` INFO log, `data_dependency_missing:` WARN log, regression-test assertions, gate self-test fixtures — must be exercised by something an operator or a future test run can read. An invariant that exists only in the spec text but has no test or log trace is not enforced.
4. **No silent fallbacks introduced.** If the item's code path catches and swallows an error, that path emits at least one log line naming what was caught and why it was OK to continue. Silent `try { … } catch { /* ignore */ }` blocks are explicit failures of this checklist — convert each to either (a) a logged-and-continued path with a clear reason, OR (b) a re-throw.

Each of the four checks is mechanical and inspectable; together they prevent the "technically merged but actually incomplete" failure mode. The §5 Tracking flip is gated on all four passing for the item being closed — a checklist failure on any item blocks its row from going to `✓` until resolved.

---

---

## §5 Tracking

When work begins on any item in §1, move it to a build slug under `tasks/builds/<slug>/`. Update the `Status` column below on each item completion. The spec is "complete" when every item is marked Done (or, for items moved into a separate spec, marked Migrated).

| ID | Item | Status | Build slug / PR | Notes |
|---|---|---|---|---|
| A1a | Principal-context propagation: service surface change | ☐ todo | — | precedes A1b; deprecated shim allowed temporarily |
| A1b | Principal-context propagation: gate hardening + caller enforcement | ☐ todo | — | depends on A1a; removes shims, flips gate to call-site granularity |
| A2 | RLS write-boundary guard | ☐ todo | — | new architectural primitive — ships in three phases (schema-diff gate, migration hook, runtime guard) |
| A3 | briefVisibilityService + onboardingStateService → getOrgScopedDb | ☐ todo | — | low-risk refactor |
| B1 | saveSkillVersion orgId-required throw test | ☐ todo | — | trivial |
| B2 | Job idempotency audit | ☐ todo | — | may bundle with B2-ext OR ship separately (split DoD allows partial completion) |
| B2-ext | Job concurrency standard | ☐ todo | — | may bundle with B2 OR ship separately (split DoD allows partial completion) |
| C1 | Gate baseline count line | ☐ todo | — | foundational for C2/D3/E2/H1 gates |
| C2 | architect.md context-section drift guard | ☐ todo | — | depends on C1 |
| C3 | Canonical registry drift test | ☐ todo | — | independent |
| C4 | actionRegistry.ts comment cleanup | ☐ todo | — | trivial |
| D1 | verify-input-validation + verify-permission-scope baselines | ☐ todo | — | investigative |
| D2 | Cycle count framing decision | ☐ todo | — | decision-only |
| D3 | verify-skill-read-paths.sh cleanup | ☐ todo | — | depends on C1 |
| E1 | 4 pre-existing unit test failures | ☐ todo | — | triage |
| E2 | 2 pre-existing gate failures | ☐ todo | — | triage; depends on C1 |
| F1 | findAccountBySubaccountId targeted method | ☐ todo | — | independent |
| F2 | configDocuments parsedCache durability | ☐ todo | — | strictly depends on Phase-5A `rateLimitStoreService`; defer or migrate to deferred if surface doesn't fit |
| G1 | Migration sequencing verification (re-runnable) | ☐ todo | — | superseded as pre-merge; run as post-deploy |
| G2 | Post-merge smoke test runbook | ☐ todo | — | run ASAP |
| H1 | Cross-service null-safety contract | ☐ todo | — | depends on C1; ships BEFORE B2 (per §2 re-sequencing); gate ships advisory on first release |

**Status legend:** ☐ todo · ⧖ in progress · ✓ done · ↗ migrated to other spec · ✗ rejected (move to §3 with rationale).

**Update protocol:**
- On starting an item: change `☐ todo` → `⧖ in progress`; record build slug or PR number in the same row.
- On completion: change `⧖` → `✓`; add a one-line note (commit hash / PR link) in Notes.
- On migration to another spec: change to `↗ migrated`; link the new spec in Notes.
- On rejection mid-flight: move the entry to §3 and remove this row, OR change to `✗` with rationale.

**Spec lifecycle:**
- This spec advances to `Status: in-progress` once the first item ships.
- Advances to `Status: complete` when all rows are `✓` or `↗`.
- After completion, the spec stays in `docs/superpowers/specs/` as historical record — do not delete.

