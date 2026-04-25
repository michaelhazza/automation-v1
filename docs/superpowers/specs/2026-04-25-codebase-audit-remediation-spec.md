# Codebase Audit Remediation — Implementation Spec

**Status:** Draft — author-finalised, ready for human spec-reviewer pass
**Date:** 2026-04-25
**Branch target:** off `main`
**Source audit:** `tasks/review-logs/codebase-audit-log-full-codebase-2026-04-25T00-00-00Z.md` (47 findings, all routed to pass-3)
**Source backlog:** `tasks/todo.md § Deferred from codebase audit — 2026-04-25`
**Source remediation outline:** the 5-phase plan supplied by the operator on 2026-04-25 (referenced inline)
**Ground-truth gate state:** captured 2026-04-25 against `main` at SHA `f8c8396` — see §3.5

---

## Contents

- [§0. Purpose and scope](#0-purpose-and-scope)
- [§1. Framing and non-negotiables](#1-framing-and-non-negotiables)
- [§2. Execution rules](#2-execution-rules)
- [§3. Phase overview](#3-phase-overview)
  - [§3.6 Phase ownership and delivery estimates](#36-phase-ownership-and-delivery-estimates)
- [§4. Phase 1 — Multi-tenancy and RLS hardening (CRITICAL)](#4-phase-1--multi-tenancy-and-rls-hardening-critical)
  - [§4.1 Phase 1A — Corrective migration for un-protected tables](#41-phase-1a--corrective-migration-for-un-protected-tables)
  - [§4.2 Phase 1B — Direct-DB-access removal](#42-phase-1b--direct-db-access-removal)
  - [§4.3 Phase 1C — Cross-org write guards](#43-phase-1c--cross-org-write-guards)
  - [§4.4 Phase 1D — Subaccount resolution enforcement](#44-phase-1d--subaccount-resolution-enforcement)
  - [§4.5 Phase 1E — Phantom session var gate baseline](#45-phase-1e--phantom-session-var-gate-baseline)
  - [§4.6 Phase 1 verification](#46-phase-1-verification)
- [§5. Phase 2 — Gate compliance (HIGH)](#5-phase-2--gate-compliance-high)
  - [§5.1 Action-call allowlist file](#51-action-call-allowlist-file)
  - [§5.2 Canonical-read interface enforcement](#52-canonical-read-interface-enforcement)
  - [§5.3 Direct-adapter call removal — `referenceDocumentService`](#53-direct-adapter-call-removal--referencedocumentservice)
  - [§5.4 Principal-context propagation](#54-principal-context-propagation)
  - [§5.5 Skill read-path completeness](#55-skill-read-path-completeness)
  - [§5.6 Canonical dictionary additions](#56-canonical-dictionary-additions)
  - [§5.7 Input validation and permission scope warnings](#57-input-validation-and-permission-scope-warnings)
  - [§5.8 Phase 2 verification](#58-phase-2-verification)
- [§6. Phase 3 — Architectural integrity (HIGH)](#6-phase-3--architectural-integrity-high)
  - [§6.1 Server circular-dependency root fix](#61-server-circular-dependency-root-fix)
  - [§6.2 Client circular-dependency cleanups](#62-client-circular-dependency-cleanups)
  - [§6.3 Phase 3 verification](#63-phase-3-verification)
- [§7. Phase 4 — System consistency (MEDIUM)](#7-phase-4--system-consistency-medium)
  - [§7.1 Skill registry and visibility coherence](#71-skill-registry-and-visibility-coherence)
  - [§7.2 Missing dependency declarations and yaml gate fix](#72-missing-dependency-declarations-and-yaml-gate-fix)
  - [§7.3 Capabilities editorial fix](#73-capabilities-editorial-fix)
  - [§7.4 Phase 4 verification](#74-phase-4-verification)
- [§8. Phase 5 — Controlled improvements (LOW–MEDIUM)](#8-phase-5--controlled-improvements-lowmedium)
  - [§8.1 Rate limiter durability](#81-rate-limiter-durability)
  - [§8.2 Silent-failure path closure](#82-silent-failure-path-closure)
  - [§8.3 Targeted type strengthening](#83-targeted-type-strengthening)
  - [§8.4 Tail items (low-severity)](#84-tail-items-low-severity)
  - [§8.5 Phase 5 verification](#85-phase-5-verification)
- [§9. Contracts](#9-contracts)
- [§10. Testing posture](#10-testing-posture)
- [§11. Observability and runbook](#11-observability-and-runbook)
- [§12. File inventory](#12-file-inventory)
- [§13. Definition of done (per phase)](#13-definition-of-done-per-phase)
- [§14. Deferred items](#14-deferred-items)
- [§15. Ongoing rules](#15-ongoing-rules)

---

## §0. Purpose and scope

The 2026-04-25 full-codebase audit identified 47 findings spanning RLS multi-tenancy, architectural boundaries, schema layering, gate compliance, skill registry coherence, and editorial law. All 47 were routed to pass-3 — none could be auto-applied because every fix either (a) required a new corrective migration (append-only constraint), (b) touched RLS-protected files (auto-downgraded confidence per audit framework Universal Rule 8), (c) touched architectural boundaries (cross-cutting impact), or (d) was governed by editorial law on `docs/capabilities.md` (never auto-rewritten).

This spec is the consolidated remediation contract for the audit's 47 findings plus 16 additional items surfaced by the ground-truth gate run, minus 2 items the audit double-counted — **63 total** in scope (`47 + 8 routes + 2 migration gaps + 6 historical-noise entries − 2 dedupe + 2 §4.5 gate-baseline deliverables`). The full reconciliation lives in §3.1 ("Total findings addressed") and the per-gate breakdown in §3.5. Migrations `0202` and `0203` are first-creation migrations whose original RLS text is correct and are explicitly NOT part of the historical-noise set (see §4.5). The spec exists for one reason: to lock the system invariants — multi-tenancy, RLS, routing, orchestration — before the codebase ships its first agency client. Once these invariants are locked, future feature development inherits the protections without re-litigating them per PR.

**In scope:**
- New corrective migration restoring `FORCE ROW LEVEL SECURITY`, `CREATE POLICY`, and the canonical `app.organisation_id` session var on every protected table currently missing them
- Refactor of every direct-`db` import in `server/routes/**` and `server/lib/**` to route through services or `withAdminConnection()`
- Addition of missing `resolveSubaccount` calls and `organisationId` filters
- Enforcement of canonical-data-service, llmRouter, and principal-context boundaries
- Architectural fix to the schema-imports-services circular dependency root
- Skill registry coherence fixes (`readPath`, visibility drift, YAML frontmatter)
- Explicit `package.json` dependency declarations and `yaml` gate-tooling fix
- Operator-led editorial fix on `docs/capabilities.md`
- Multi-process-safe rate limiter replacement and silent-failure path closure
- All targeted type-strengthening and tail items from Phases 4–5

**Out of scope:**
- Any new product feature. Feature development is paused until Phase 1 ship-gate is green (see §13).
- Any change to the agent execution pipeline beyond what is required to remove direct-DB access from agent-execution-adjacent files.
- Editing or rewriting historical migrations. Postgres migrations are append-only; every fix that needs schema state correction ships as a new migration.
- The `KNOWLEDGE.md` patterns from this audit (already merged in PR #195) are referenced inline but not modified by this spec.

**Source-of-truth references:**
- Audit log: `tasks/review-logs/codebase-audit-log-full-codebase-2026-04-25T00-00-00Z.md`
- Backlog section: `tasks/todo.md § Deferred from codebase audit — 2026-04-25`
- Architecture canon: `architecture.md` "Row-Level Security — Three-Layer Fail-Closed Data Isolation" subsection and "Canonical RLS session variables (hard rule)" subsection
- Framing canon: `docs/spec-context.md` (testing posture, accepted primitives, convention rejections)
- Editorial law: `CLAUDE.md` Editorial rules for `docs/capabilities.md` (rules 1–5)
- Canonical RLS-repair migration reference: `migrations/0213_fix_cached_context_rls.sql` is the most-cited precedent in this spec (it both repairs broken RLS at runtime and demonstrates the per-table historical-policy-DROP discipline). `migrations/0200_fix_universal_brief_rls.sql` is the original canonical-pattern source for the policy text (verbatim shape used in §4.1 / §9.1). The two migrations use the same canonical pattern; 0213 is the operationally relevant precedent.

---

## §1. Framing and non-negotiables

This spec is governed by the framing established in `docs/spec-context.md`. Three statements from that file shape every remediation decision below:

**`pre_production: yes` / `live_users: no`** — there are no users to protect from breaking changes. Migrations land in a single environment; we cut the corrective migration, run it, verify the gates, and move on. There is no staged rollout, no canary, no feature flag for the migration. The `rollout_model: commit_and_revert` posture applies.

**`testing_posture: static_gates_primary` / `runtime_tests: pure_function_only`** — gates are the source of truth, not unit/integration tests of the live stack. Every phase's "definition of done" terminates in a named gate (or set of gates) returning a clean run. New runtime tests are written only for pure functions extracted by this spec; no vitest/jest/playwright/supertest expansions are introduced. This matches the `convention_rejections` block of `docs/spec-context.md` verbatim.

**`prefer_existing_primitives_over_new_ones: yes`** — every Phase 1B refactor reuses `withOrgTx` / `getOrgScopedDb` from `server/instrumentation.ts` and `server/lib/orgScopedDb.ts` (org-scoped helpers), plus `withAdminConnection` from `server/lib/adminDbConnection.ts` (admin / system-scoped helper). The corrective migration in §4.1 mirrors the pattern of migration `0213_fix_cached_context_rls.sql` (the canonical reference for repairing already-broken RLS). The principal-context propagation work in §5.4 reuses `withPrincipalContext` and the `fromOrgId()` shim that already exists. **The new files this spec introduces are mechanical service-tier homes for code being relocated out of routes/lib (§4.2) plus one narrow new shared primitive in Phase 5 §8.1 (`server/services/rateLimitStoreService.ts`) — no new architectural primitives or service layers.** The Phase 5 §8.1 primitive has an explicit "why not reuse" paragraph in §8.1; the §4.2 service files are pure relocations (no new abstractions, no new public API surface). Where a fix appears to need a primitive that does not yet exist, the spec must document why reuse and extension were both insufficient — and the reviewer treats absence of that justification as directional.

**Non-negotiable boundaries derived from the canon:**

1. **The canonical org session var is `app.organisation_id`** — set by `server/middleware/auth.ts` (HTTP path) and `server/lib/createWorker.ts` (worker path). The phantom var `app.current_organisation_id` is **never set anywhere**; using it in policy text causes `current_setting(..., true)` to return `NULL`, which fails-closed in some contexts and fails-open in others depending on the cast. We never ship policies that reference the phantom var. This is enforced by `scripts/verify-rls-session-var-canon.sh` and is a banned pattern at file-scan time.
2. **Routes never own DB access.** `server/routes/**` calls `server/services/**`. Lib code (`server/lib/**`) calls services or wraps the DB through `withAdminConnection()` — it does not import `db` directly. This is enforced by `scripts/verify-rls-contract-compliance.sh`.
3. **Schema is a leaf.** `server/db/schema/**` files import only from `drizzle-orm`, `shared/types/**`, or other schema files — **never** from `server/services/**`, `server/lib/**`, or `server/routes/**`. This is the architectural rule that the circular-dependency fix in §6 enforces.
4. **`docs/capabilities.md` is governed by editorial law.** Customer-facing sections (Core Value Proposition, Positioning, Product Capabilities, Agency Capabilities, Replaces / Consolidates, Non-goals) **never** name a specific LLM/AI provider or product. Use generic category language only. Editorial fixes are always operator-led — never auto-rewritten by an agent. See `CLAUDE.md` rules 1–5.

If a remediation in this spec appears to violate any of points 1–4, it is wrong. Stop and re-read the canon.

---

## §2. Execution rules

These rules govern *how* the work in this spec is shipped. They override session-local enthusiasm.

### §2.1 Strict phase ordering

Phases 1 → 2 → 3 → 4 → 5 ship in order. **Phase N+1 does not begin until Phase N's ship gate is green** (see §13). Within Phase 1, sub-phases 1A → 1B → 1C → 1D → 1E ship in the same PR with the corrective migration applied locally and in CI ahead of the route-refactor commits inside that PR — the refactors must exercise the corrected policies (see §4 header for the in-PR ordering rule). Reasons for the strictness:

- Phase 1 closes the largest blast-radius bugs (cross-tenant data leakage). Until those are closed, no other work is safer than this.
- Phase 1A's migration is a prerequisite for Phase 1B/C — refactoring routes to call services that hit RLS-protected tables requires the policies to exist.
- Phase 3's circular-dep fix touches `server/db/schema/**` which Phase 1B/C will already have refactored against. Inverting the order would force re-touch.

### §2.2 No partial fixes within a category

A "category" is a single `## §X.Y` subsection. When a category is opened, every finding listed under it ships in the same PR. We do not ship "memoryReviewQueue refactor today, conversations.ts refactor next week" — both are direct-DB violations on routes, both are Phase 1B, both ship together. Partial fixes leave the gate red and the system in a state where the remaining violations are easy to forget.

### §2.3 No new features

From the moment Phase 1 starts until Phase 4 ship gate is green, no new product features ship on `main`. New feature branches may exist, but they wait. This is a one-time reset; it is non-negotiable.

### §2.4 Gates are the source of truth

Every category's "definition of done" is `<gate-name> returns clean exit`. **Blocking gates** are not bypassed: we do not add `# baseline-allow` comments, `--ignore` flags, or delete the gate. If a blocking gate cannot pass for a legitimate architectural reason (e.g. the `verify-rls-session-var-canon` historical-baseline noise in §4.5), the spec documents the reason inline and updates the gate's baseline mechanism — not the gate's hard rule.

**Warning-level gates** (those whose intent is "look at this, decide if it's OK" rather than "this is forbidden") are different: a `# baseline-allow` directive at a specific match point with an explanatory comment is the canonical way to acknowledge a reviewed, intentionally-permitted pattern. The Phase 2 §5.7 (`verify-input-validation`, `verify-permission-scope`) and Phase 5 §8.2 (`verify-no-silent-failures`) approaches use this pattern for reviewed false-positives or genuinely intentional patterns. The carve-out is narrow: warning-level gates only, with one-line rationale per directive — never a blanket suppression and never on a blocking gate.

### §2.5 Migration discipline

Every schema-state correction ships as a NEW migration with the next available number. We **never** edit historical migrations. Migration filenames follow the existing pattern: `migrations/<NNNN>_<descriptive_name>.sql`. The new migration drops broken policies (`DROP POLICY IF EXISTS …`) and recreates them with the canonical pattern from `migrations/0213_fix_cached_context_rls.sql`.

**Migration-number assignment rule (concurrent-PR safety).** When a PR is opened with a placeholder filename (e.g. `migrations/<NNNN>_rate_limit_buckets.sql`), the actual number is **assigned at merge time, not at PR-open time** — specifically: the implementer rebases the PR onto the latest `main` immediately before merge and renames the migration file to claim the next available number against `main` as it stands at that moment. Two concurrent Phase 5 PRs cannot collide on the same number because only one can be at the front of the merge queue at a time; the second rebases and renames before its own merge. Add this renumber-and-rebase step to the PR checklist for every Phase 5 PR that introduces a migration.

### §2.6 Smallest viable PR per phase

Phase 1 is one PR. Phase 2 is one PR. Phase 3 is one PR. Phase 4 is one PR (with §7.3's `docs/capabilities.md` editorial fix optionally split out as a separate small operator-led PR). Phase 5 is **multiple PRs** — Phase 5A ships §8.1 and §8.2 as two independent PRs (each is a self-contained category with its own gate); Phase 5B ships §8.3 and each §8.4 tail item as additional small PRs in any order. This gives roughly four canonical PRs (Phases 1–4) plus two mandatory Phase 5A PRs and a stream of optional Phase 5B PRs; each is reviewable in one sitting; each is revertible without losing work in adjacent phases.

### §2.7 Auto-rewrite prohibition on `docs/capabilities.md`

The Phase 4 editorial fix in §7.3 is operator-led. The agent provides the diff; the operator reviews and applies. The agent does not commit `docs/capabilities.md` changes without the operator's explicit go-ahead in the same session.

### §2.8 Service-layer expansion constraint

New service files created by Phase 1B (§4.2) are mechanical relocations, not new abstractions. A new service file is justified only when:

1. The route has **more than one DB interaction**, meaning a thin one-liner in the route handler cannot express the query; OR
2. The service logic is **reused by more than one route** (shared DB query path).

If neither condition holds, the handler's single DB call stays inline in the route and the direct `db` import is replaced with `withOrgTx(req.orgId, …)` directly in the route. Do not create a service file as a formatting exercise.

**Max one service per domain.** Two service files covering the same business domain in the same PR is a signal the split is wrong — merge them. A "domain" is a Postgres table or a closely coupled pair (e.g. `memoryReviewQueue` and `memoryBlock` form one domain). The §4.2 table explicitly marks each file as "extend" (existing service) or "new" (no service exists today); both create-vs-extend decisions are locked at spec authoring time. Any deviation from the table during implementation requires an explicit explanation in the PR description — not a unilateral new file.

---

## §3. Phase overview

### §3.1 Phase summary table

| Phase | Theme | Severity floor | Findings count | Primary gate(s) | Goal |
|---|---|---|---|---|---|
| 1 | Multi-tenancy and RLS hardening | Critical | 26 | `verify-rls-coverage`, `verify-rls-contract-compliance`, `verify-rls-session-var-canon`, `verify-org-scoped-writes`, `verify-subaccount-resolution` | Eliminate every cross-tenant fail-open. Lock the three-layer isolation contract. |
| 2 | Gate compliance | High | 11 | `verify-action-call-allowlist`, `verify-canonical-read-interface`, `verify-no-direct-adapter-calls`, `verify-principal-context-propagation`, `verify-skill-read-paths`, `verify-canonical-dictionary` | Bring every architectural-contract gate to green. |
| 3 | Architectural integrity | High | 3 | `madge --circular` (server + client) | Remove the schema-imports-services circular root and the two largest client cycle clusters. |
| 4 | System consistency | Medium | 5 | `npm run skills:verify-visibility`, `scripts/verify-integration-reference.mjs`, `npm install` | Skill registry coherence; explicit deps; YAML gate tooling; operator-led capabilities edit. |
| 5A | Controlled improvements (mandatory) | Low–Medium | 2 | `verify-no-silent-failures` (must drop from WARN to PASS); madge cycle count = 0 | Multi-process-safe rate limiter; silent-failure closure. Programme blocker. |
| 5B | Controlled improvements (optional) | Low | 16 | type-check still passes | Targeted type strengthening; tail items. Not a programme blocker — items may be formally deferred. |

**Total findings addressed:** 26 (Phase 1) + 11 (Phase 2) + 3 (Phase 3) + 5 (Phase 4) + 18 (Phase 5) = **63**, vs 47 in the original audit. The +16 delta is:

- +8 additional direct-DB-import violations in routes (`configDocuments`, `portfolioRollup`, `conversations`, `automationConnectionMappings`, `webLoginConnections`, `systemPnl`, `automations`, plus `clarifications` which the audit listed only for missing `resolveSubaccount`).
- +2 additional `verify-rls-coverage` migration gaps (`0153_agent_test_fixtures`, `0192_agent_execution_log`).
- +6 `verify-rls-coverage` historical-noise entries that need `verify-rls-coverage` baselining (`0204`, `0205`, `0206`, `0207`, `0208`, `0212`) — see §4.5. Migrations `0202` and `0203` are first-creation migrations for `reference_documents` / `reference_document_versions` whose original RLS text is correct; they do **not** need baselining and are not part of this set.
- −2 deduplication where the audit double-counted.

Math: `47 + 8 + 2 + 6 − 2 = 61`. The remaining 2 findings reaching 63 are: +1 the Phase 1E gate-baseline mechanism update (counted as a Phase 1 finding even though it's gate-tooling work, since it is required for Phase 1 ship-gate green), and +1 the `verify-rls-session-var-canon` baseline parallel update (also Phase 1 work). Both are §4.5 deliverables.

### §3.2 Phase dependency graph

```
Phase 1A (corrective migration)
   │
   ├──> Phase 1B (direct-db routes refactor) — exercises the policies
   ├──> Phase 1C (org filter writes) — exercises org-scoped-writes
   ├──> Phase 1D (resolveSubaccount) — exercises subaccount-resolution
   └──> Phase 1E (gate baseline) — independent of 1B/C/D, ships in same Phase 1 PR
        │
        ▼
Phase 2 (gate compliance)
   │
   ├──> §5.1 actionCallAllowlist file — independent
   ├──> §5.2 canonical-read interface — independent
   ├──> §5.3 referenceDocumentService llmRouter — independent
   ├──> §5.4 principal-context propagation — depends on §5.2 (same canonical files)
   ├──> §5.5 skill readPath — independent
   └──> §5.6 canonical dictionary — independent
        │
        ▼
Phase 3 (circular-dep root)
   │
   ▼
Phase 4 (system consistency)
   │
   ├──> §7.1 skill registry — independent
   ├──> §7.2 deps + yaml — independent
   └──> §7.3 capabilities editorial — operator-led, independent
        │
        ▼
Phase 5 (controlled improvements)
   │
   └──> §8.1–§8.4 — each independent, each its own PR
```

There are no backward dependencies. Phase 3 happens after Phase 2 because the principal-context propagation in §5.4 touches the same canonical-data-service-importing files; doing the cycle fix first would force re-touch of the type extraction.

### §3.3 What changes vs the operator's 2026-04-25 outline

The operator's outline organised remediation into the same five phases this spec uses, with the following refinements after the ground-truth gate run:

- **Phase 1's scope expanded** — eight additional direct-DB routes and two additional `verify-rls-coverage` migration gaps (0153, 0192) were uncovered. These were undercounted in the audit summary.
- **Phase 1E added** — the phantom-session-var gate's "10 historical matches baselined" assertion does not in fact match the gate's current behaviour (it reports 8 violations). The gate baseline mechanism needs an update; this is mechanical and ships in the same Phase 1 PR.
- **Phase 1A migration coverage expanded** — the corrective migration also addresses tables in `0192_agent_execution_log.sql` (three tables) and `0153_agent_test_fixtures.sql` (one table), which `verify-rls-coverage` flags but the audit did not surface.
- **Phase 2's principal-context list reflects 5 files, not 5+** — the audit said "5+ files"; the gate names exactly five.
- **Phase 5 explicitly lists the 18 individual tail items** — the operator's outline grouped them under "controlled improvements"; the spec enumerates each so no item is implicitly deferred.

### §3.4 What changes vs the audit log's pass-3 list

The pass-3 list in the audit log (47 items) is correct as a record of what the audit observed. The spec is correct as the work that ships. The delta:

| Audit ID | Spec section | Status |
|---|---|---|
| All P3-C1 … P3-C11 | §4 (Phase 1) | Carried; scope expanded with §3.5 ground-truth gate state |
| P3-H1 | §6.1 | Carried |
| P3-H2, P3-H3 | §4.2 | Carried; merged with §4.2's expanded list |
| P3-H4 | §5.1 | Carried |
| P3-H5 | §5.2 | Carried |
| P3-H6 | §5.3 | Carried |
| P3-H7 | §5.4 | Carried; file count locked at 5 (gate-confirmed) |
| P3-H8 | §5.5 | Carried |
| P3-M13, P3-M14 | §5.7 | Carried as warning-level Phase 2 work — best-effort triage, not a Phase 2 ship-gate blocker |
| P3-M15 | §5.6 | Carried |
| P3-M16 | §7.3 | Carried (operator-led editorial fix) |
| P3-M1 … P3-M12, P3-L1 … P3-L10 | §7 (skill registry, deps, capabilities) and §8 (Phase 5) | Carried with tail enumeration in §8.4 |

### §3.5 Ground-truth gate state (captured 2026-04-25 against `main` SHA `f8c8396`)

Every reference to "the gate reports X" in this spec corresponds to the gate state captured on 2026-04-25. Before each phase begins, the implementer **MUST** re-run the relevant gates (commands listed in each phase's verification subsection) to confirm the violation set has not drifted. If the violation set has changed (new violations introduced by parallel work, existing violations resolved), re-scope the phase to match the live state — do not blindly apply the fix list below if it no longer reflects reality.

| Gate | Captured violations | Spec section |
|---|---|---|
| `verify-rls-coverage` | 19 raw matches (the gate's static scan flags entries across 14 migrations: 0139, 0141, 0142, 0147, 0153, 0192, 0202, 0203, 0204, 0205, 0206, 0207, 0208, 0212). Of these, 0202 and 0203 are first-creation migrations with correct RLS text — the gate's flags on those two are noise unrelated to this remediation and are not counted. The remaining 12 distinct issues split into: 4 missing FORCE/POLICY at runtime (0139, 0141, 0142, 0147 — fixed by `0227`), 2 FORCE re-assertion (`0153`, `0192` — also fixed by `0227`), 6 historical-noise allowlist entries needed (`0204`–`0208` + `0212` — fixed by §4.5 baseline). | §4.1, §4.5 |
| `verify-rls-contract-compliance` | 13 (2 lib, 11 route) | §4.2 |
| `verify-rls-session-var-canon` | 8 (all in 0204, 0205, 0206, 0207, 0208, 0212) | §4.5 |
| `verify-org-scoped-writes` | 4 (`documentBundleService` 2, `skillStudioService` 2) | §4.3 |
| `verify-subaccount-resolution` | 2 (`memoryReviewQueue`, `clarifications`) | §4.4 |
| `verify-no-direct-adapter-calls` | 1 (`referenceDocumentService:7`) | §5.3 |
| `verify-canonical-read-interface` | 1 (`measureInterventionOutcomeJob:213-218`) | §5.2 |
| `verify-action-call-allowlist` | 1 (file missing) | §5.1 |
| `verify-skill-read-paths` | 1 summary line: count mismatch of 5 between literal action entries (94) and entries with `readPath` (99). The direction-of-mismatch ambiguity is documented in §5.5; the captured-state row reports the raw mismatch only — the diagnosis (which entries are wrong, in which direction) is enumerated at execution time. | §5.5 |
| `verify-principal-context-propagation` | 5 (`actionRegistry:112`, `intelligenceSkillExecutor:1`, `connectorPollingService:7`, `crmQueryPlanner/executors/canonicalQueryRegistry:4`, `webhooks/ghlWebhook:7`) | §5.4 |
| `verify-canonical-dictionary` | TBD — re-run before Phase 2 begins | §5.6 |
| `verify-input-validation` | WARNING (no specific files printed) | §5.7 |
| `verify-permission-scope` | WARNING (no specific files printed) | §5.7 |
| `verify-no-silent-failures` | WARNING (no specific files printed) | §8.2 |
| `madge --circular` (server) | 175 | §6.1 |
| `madge --circular` (client) | 10 (`ProposeInterventionModal` cluster) + 4 (`SkillAnalyzerWizard` cluster) | §6.2 |

### §3.6 Phase ownership and delivery estimates

This table is a planning aid, not a commitment. Durations are expressed in implementation-days (single developer, focused session). Each phase is blocked by the one above it per §2.1; parallel work is only possible within Phase 5 (5A/5B are both independent of each other once Phase 4 ships).

| Phase | Owner | Estimated duration | Blocking dependency |
|---|---|---|---|
| 1 (RLS hardening) | Platform/backend lead | 3–4 days | None — start here |
| 2 (Gate compliance) | Platform/backend lead | 2–3 days | Phase 1 ship gate green |
| 3 (Architectural integrity) | Platform/backend lead | 1–2 days | Phase 2 ship gate green |
| 4 (System consistency) | Backend lead + operator (§7.3) | 1 day | Phase 3 ship gate green |
| 5A (Mandatory improvements) | Platform/backend lead | 2–3 days | Phase 4 ship gate green |
| 5B (Optional backlog) | Any dev, any sprint | Ongoing | Phase 4 ship gate green (can begin after Phase 4 ships independently of 5A) |

**Duration assumptions:** each "day" assumes the developer has the repo open, gates running, and is not context-switching to feature work. Phase 1 is the longest because it involves 13 route refactors + the corrective migration + the gate baseline update — all in one PR. Phase 3 is the shortest because it is a single type extraction plus 14 file import updates.

**Owner note.** "Operator" in Phase 4 refers to the capabilities editorial fix (§7.3), which is not a code change and can be done asynchronously. The §7.3 edit does not block the §7.1/§7.2 code PRs.

---

## §4. Phase 1 — Multi-tenancy and RLS hardening (CRITICAL)

**Goal:** every protected table enforces `FORCE ROW LEVEL SECURITY` with a canonical-pattern policy keyed on `app.organisation_id`; every route and lib file goes through the service layer or `withAdminConnection()`; every cross-tenant write is org-scoped; every subaccount-bearing route resolves the subaccount.

**Ship gate:** all five RLS gates return clean exit. See §4.6.

**One PR.** Sub-phases 1A → 1E ship together. The migration must be applied (locally + CI) before the route refactors are merged so the route-level integration paths actually exercise the corrected policies.

### §4.1 Phase 1A — Corrective migration for un-protected tables

**Finding origin:** P3-C1, P3-C2, P3-C3, P3-C4 (audit), plus the two `verify-rls-coverage` gaps the audit missed: `0153_agent_test_fixtures` and `0192_agent_execution_log` (3 tables).

**Pre-step: write-path audit (mandatory before the migration is drafted).** Before 0227 is written, enumerate every write site (`INSERT`, `UPDATE`, `DELETE`) against the eight tables in scope and confirm each passes `organisationId` explicitly in the payload or WHERE clause. The migration adds `WITH CHECK` enforcement that will reject any write whose session var is unset; unchecked write sites will fail at runtime after the migration lands and before Phase 1B's service-layer work closes them. Running the audit first bounds the blast radius and lets Phase 1B's PR description enumerate every affected write site with confidence.

```bash
# Run from the repo root. Inspect every match for an explicit organisationId arg.
grep -rn "\.insert\(\|\.update\(\|\.delete\(" server/ \
  | grep -E "memory_review_queue|drop_zone_upload_audit|onboarding_bundle_configs|trust_calibration_state|agent_test_fixtures|agent_execution_events|agent_run_prompts|agent_run_llm_payloads"
```

For each match, confirm the query either (a) runs inside `withOrgTx(organisationId, …)` (which sets the session var so RLS accepts the write) OR (b) runs via `withAdminConnection()` (which bypasses RLS by design). Any match that does neither is a defect that Phase 1C or Phase 1B must fix before the migration merges — not after.

**Migration filename:** `migrations/0227_rls_hardening_corrective.sql` (next available number after `0226_fix_suppression_unique_nulls.sql`).

**Why a new migration, not edits to 0139/0141/0142/0147/0153/0192:** Postgres migrations are append-only. The historical files retain the original (incorrect or incomplete) policy text for audit-trail integrity. The new migration `DROP POLICY IF EXISTS` on the existing policy and `CREATE POLICY` with the canonical pattern. This mirrors `migrations/0213_fix_cached_context_rls.sql` — the established precedent for repairing already-broken RLS in this codebase.

**Tables in scope and required actions:**

| Table | Origin migration | Historical policy names to DROP in 0227 | Action in 0227 | Why |
|---|---|---|---|---|
| `memory_review_queue` | 0139 | `memory_review_queue_org_isolation` | DROP listed policies; ADD `FORCE ROW LEVEL SECURITY`; CREATE canonical-pattern policy (USING + WITH CHECK + IS-NOT-NULL/non-empty guards) | Existing policy lacks `WITH CHECK` and `IS NOT NULL` guards; without `FORCE`, table owner bypasses RLS. |
| `drop_zone_upload_audit` | 0141 | `drop_zone_upload_audit_tenant_isolation` | ADD `FORCE ROW LEVEL SECURITY`; DROP listed policies; CREATE canonical-pattern policy | Existing policy is `USING`-only (no `WITH CHECK`); FORCE missing. The historical policy is named `*_tenant_isolation`, not `*_org_isolation` — DROP must use the actual name or both policies coexist as a conjunction. |
| `onboarding_bundle_configs` | 0142 | `onboarding_bundle_configs_tenant_isolation` | ADD `FORCE ROW LEVEL SECURITY`; DROP listed policies; CREATE canonical-pattern policy | Same as above. |
| `trust_calibration_state` | 0147 | `trust_calibration_state_tenant_isolation` | ADD `FORCE ROW LEVEL SECURITY`; DROP listed policies; CREATE canonical-pattern policy | Same as above. |
| `agent_test_fixtures` | 0153 | `agent_test_fixtures_org_isolation` | ADD `FORCE ROW LEVEL SECURITY`; DROP listed policies; CREATE canonical-pattern policy | FORCE missing; existing policy uses uuid cast pattern but lacks `WITH CHECK`. |
| `agent_execution_events` | 0192 | `agent_execution_events_org_isolation` | RE-ASSERT `FORCE ROW LEVEL SECURITY` (single-space syntax); DROP + CREATE the canonical policy (idempotent against the existing canonical-named policy) | Source file uses `FORCE  ROW LEVEL SECURITY` (double space) which `verify-rls-coverage`'s regex misses. Re-asserting in 0227 with single-space syntax satisfies the static check; the runtime ALTER is idempotent. |
| `agent_run_prompts` | 0192 | `agent_run_prompts_org_isolation` | Same as above | Same |
| `agent_run_llm_payloads` | 0192 | `agent_run_llm_payloads_org_isolation` | Same as above | Same |

**Policy-name discipline.** The "Historical policy names to DROP in 0227" column is exhaustive — verified by `grep -nE "CREATE POLICY" migrations/<NNNN>_*.sql` against each origin migration during spec authoring. If the actual migration text introduces policies under additional names (e.g. a future repair migration creating a `*_subaccount_isolation` policy on one of these tables), 0227 must be updated to drop those names too before merge. Mirroring 0213's precedent — which explicitly drops `*_subaccount_isolation`, `*_read`, and `*_write` policies per affected table — is the canonical posture: enumerate every historical name; never assume the canonical-shape policy is the only one present.

**Canonical policy pattern (verbatim from `migrations/0200_fix_universal_brief_rls.sql`; same shape used by `migrations/0213_fix_cached_context_rls.sql` — see §0 for the canonical-reference convention):**

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

-- Drop EVERY historical policy name on the table — see the per-table inventory above.
-- Failing to drop a historical policy leaves it coexisting with the canonical one;
-- Postgres applies them as a conjunction, which fails closed when any guard returns
-- NULL but obscures the intended-vs-coexisting semantics. Mirror 0213's precedent.
DROP POLICY IF EXISTS <historical_policy_name_1> ON <table>;
DROP POLICY IF EXISTS <historical_policy_name_2> ON <table>;     -- if applicable
DROP POLICY IF EXISTS <table>_org_isolation ON <table>;          -- canonical name (idempotent)

CREATE POLICY <table>_org_isolation ON <table>
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
```

The `IS NOT NULL` and non-empty guards matter: when the session var is unset, `current_setting('app.organisation_id', true)` returns `NULL`. Casting `NULL::uuid` returns `NULL`, and `organisation_id = NULL` is `NULL` (not `false`), which Postgres treats as fail-closed for `USING` and `WITH CHECK` (rows whose policy expression evaluates to anything other than `true` are excluded). The explicit guards avoid relying on `NULL`-comparison semantics — both reads and writes are blocked unambiguously when the session var is unset.

**Subaccount scoping clarification.** Migration 0213 (the precedent) explicitly drops the original `*_subaccount_isolation` policies because the canonical request paths (`server/middleware/auth.ts`, `server/lib/createWorker.ts`) do not set `app.current_subaccount_id` — only `withPrincipalContext` does. Forcing a subaccount policy without setting the var would block every read of subaccount-scoped rows. Migration 0227 follows the same posture: **no subaccount-isolation policies are created** for these tables. Subaccount filtering remains at the service layer (e.g. `documentBundleService.listByOrg`-style explicit `subaccount_id` filter, which is the same posture used by `memory_blocks`, `workspace_memories`, and the cached-context tables after 0213).

**Manifest changes:** None. All eight tables are already entries in `server/config/rlsProtectedTables.ts` (verified 2026-04-25).

**Migration body shape (skeleton — full text written during implementation):**

```sql
-- 0227_rls_hardening_corrective.sql
--
-- Repairs RLS on eight tables flagged by verify-rls-coverage on 2026-04-25:
--   - memory_review_queue (0139)        — missing FORCE; policy lacks WITH CHECK / guards
--   - drop_zone_upload_audit (0141)     — missing FORCE; policy lacks WITH CHECK / guards
--   - onboarding_bundle_configs (0142)  — missing FORCE; policy lacks WITH CHECK / guards
--   - trust_calibration_state (0147)    — missing FORCE; policy lacks WITH CHECK / guards
--   - agent_test_fixtures (0153)        — missing FORCE; policy lacks WITH CHECK / guards
--   - agent_execution_events (0192)     — FORCE re-assertion (gate regex)
--   - agent_run_prompts (0192)          — FORCE re-assertion (gate regex)
--   - agent_run_llm_payloads (0192)     — FORCE re-assertion (gate regex)
--
-- Pattern: identical to 0200 / 0213 canonical reference.
-- All ALTER TABLE FORCE statements are idempotent at the Postgres level.
-- DROP POLICY IF EXISTS / CREATE POLICY pairs replace any pre-existing
-- policies with the canonical-guard form.

-- ---------------------------------------------------------------------------
-- memory_review_queue (origin: 0139)
-- Historical policies: memory_review_queue_org_isolation
-- ---------------------------------------------------------------------------
ALTER TABLE memory_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_review_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_review_queue_org_isolation ON memory_review_queue;
CREATE POLICY memory_review_queue_org_isolation ON memory_review_queue
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- drop_zone_upload_audit (origin: 0141)
-- Historical policies: drop_zone_upload_audit_tenant_isolation
-- ---------------------------------------------------------------------------
ALTER TABLE drop_zone_upload_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE drop_zone_upload_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drop_zone_upload_audit_tenant_isolation ON drop_zone_upload_audit;
DROP POLICY IF EXISTS drop_zone_upload_audit_org_isolation ON drop_zone_upload_audit;
CREATE POLICY drop_zone_upload_audit_org_isolation ON drop_zone_upload_audit
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- onboarding_bundle_configs (origin: 0142)
-- Historical policies: onboarding_bundle_configs_tenant_isolation
-- ---------------------------------------------------------------------------
ALTER TABLE onboarding_bundle_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_bundle_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS onboarding_bundle_configs_tenant_isolation ON onboarding_bundle_configs;
DROP POLICY IF EXISTS onboarding_bundle_configs_org_isolation ON onboarding_bundle_configs;
CREATE POLICY onboarding_bundle_configs_org_isolation ON onboarding_bundle_configs
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- trust_calibration_state (origin: 0147)
-- Historical policies: trust_calibration_state_tenant_isolation
-- ---------------------------------------------------------------------------
ALTER TABLE trust_calibration_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_calibration_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trust_calibration_state_tenant_isolation ON trust_calibration_state;
DROP POLICY IF EXISTS trust_calibration_state_org_isolation ON trust_calibration_state;
CREATE POLICY trust_calibration_state_org_isolation ON trust_calibration_state
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- agent_test_fixtures (origin: 0153)
-- Historical policies: agent_test_fixtures_org_isolation
-- ---------------------------------------------------------------------------
ALTER TABLE agent_test_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_test_fixtures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_test_fixtures_org_isolation ON agent_test_fixtures;
CREATE POLICY agent_test_fixtures_org_isolation ON agent_test_fixtures
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- agent_execution_events (origin: 0192) — FORCE re-assertion + canonical-policy refresh
-- Historical policies: agent_execution_events_org_isolation
-- ---------------------------------------------------------------------------
ALTER TABLE agent_execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_execution_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_execution_events_org_isolation ON agent_execution_events;
CREATE POLICY agent_execution_events_org_isolation ON agent_execution_events
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- agent_run_prompts (origin: 0192) — FORCE re-assertion + canonical-policy refresh
-- Historical policies: agent_run_prompts_org_isolation
-- ---------------------------------------------------------------------------
ALTER TABLE agent_run_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_prompts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_run_prompts_org_isolation ON agent_run_prompts;
CREATE POLICY agent_run_prompts_org_isolation ON agent_run_prompts
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- agent_run_llm_payloads (origin: 0192) — FORCE re-assertion + canonical-policy refresh
-- Historical policies: agent_run_llm_payloads_org_isolation
-- ---------------------------------------------------------------------------
ALTER TABLE agent_run_llm_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_llm_payloads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_run_llm_payloads_org_isolation ON agent_run_llm_payloads;
CREATE POLICY agent_run_llm_payloads_org_isolation ON agent_run_llm_payloads
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
```

**Drizzle schema changes:** None. The migration only touches policies; no column additions, removals, or type changes. No corresponding `server/db/schema/**` edits are required.

**Verification (run after migration applies):**

```bash
bash scripts/verify-rls-coverage.sh
# Expected: PASS, 0 violations on memory_review_queue, drop_zone_upload_audit,
# onboarding_bundle_configs, trust_calibration_state, agent_test_fixtures,
# agent_execution_events, agent_run_prompts, agent_run_llm_payloads.
# (Historical noise on 0204–0208 + 0212 still present in source files — see §4.5
#  for the gate-baseline mechanism that suppresses it. Migrations 0202 and 0203
#  are NOT part of the noise set and have correct original policies.)
```

**Risk note.** `WITH CHECK` enforcement on `memory_review_queue`, `drop_zone_upload_audit`, `onboarding_bundle_configs`, `trust_calibration_state`, and `agent_test_fixtures` is *new* — these tables previously had `USING`-only policies. After 0227 ships, any caller that writes to these tables without a valid `app.organisation_id` session var will fail. This RLS-rejection is a *temporary fail-closed backstop* during the in-PR window between the migration applying and the route refactors landing; it is **not** the long-term posture. The §15.1 invariant (`never rely on RLS alone`) still applies — Phase 1B must complete its application-level org-scoping pass on every write site before the Phase 1 PR merges, and the §15.1 multi-tenant safety checklist applies to all future write paths regardless. If a write path is uncovered during the in-PR window, the failure mode is a runtime error (write rejected) rather than silent cross-tenant leakage — failing-closed is the desired default for that brief window only.

### §4.2 Phase 1B — Direct-DB-access removal

**Finding origin:** P3-C6, P3-C7, P3-C8, P3-H2, P3-H3 (audit), plus eight additional files surfaced by the ground-truth gate run:

| # | File | Line | Tier | Refactor target |
|---|---|---|---|---|
| 1 | `server/lib/briefVisibility.ts` | 1 | lib | Promote to `server/services/briefVisibilityService.ts` (new) |
| 2 | `server/lib/workflow/onboardingStateHelpers.ts` | 12 | lib | Move queries into `server/services/onboardingStateService.ts` (new); helpers retain pure-function role |
| 3 | `server/routes/memoryReviewQueue.ts` | 16 | route | Existing `server/services/memoryReviewQueueService.ts` (extend) |
| 4 | `server/routes/systemAutomations.ts` | 9 | route (admin) | `server/services/systemAutomationService.ts` (new) — uses `withAdminConnection()` because system routes operate without an org context |
| 5 | `server/routes/subaccountAgents.ts` | 14 | route | Existing `server/services/subaccountAgentService.ts` (extend) |
| 6 | `server/routes/configDocuments.ts` | 21 | route | `server/services/configDocumentService.ts` (new) |
| 7 | `server/routes/portfolioRollup.ts` | 16 | route | `server/services/portfolioRollupService.ts` (new) |
| 8 | `server/routes/clarifications.ts` | 17 | route | Existing `server/services/clarificationService.ts` (extend); also addressed in §4.4 for subaccount resolution |
| 9 | `server/routes/conversations.ts` | 11 | route | Existing `server/services/conversationService.ts` (extend) |
| 10 | `server/routes/automationConnectionMappings.ts` | 8 | route | `server/services/automationConnectionMappingService.ts` (new) |
| 11 | `server/routes/webLoginConnections.ts` | 32 | route | Existing `server/services/webLoginConnectionService.ts` (extend) |
| 12 | `server/routes/systemPnl.ts` | 9 | route (admin) | Existing `server/services/systemPnlService.ts` (extend) — uses `withAdminConnection()` |
| 13 | `server/routes/automations.ts` | 3 | route | Existing `server/services/automationService.ts` (extend) |

**Naming convention.** New service filenames mirror the existing repo convention — singular-noun service suffix (e.g. `automationService.ts`, not `automationsService.ts`). The §12 file inventory uses these exact names; deviation between prose and inventory is treated as inventory drift (§docs/spec-authoring-checklist.md §2).

**Service creation rule (§2.8 applies here).** A new service file is permitted only when the route has more than one DB interaction OR the logic is shared. See §2.8 for the full constraint. Every file in the §4.2 table is pre-adjudicated — "extend" means an existing service file absorbs the DB query; "new" means no service file exists today and one is justified. Neither column changes without an explicit rationale in the PR description.

Where a service file already exists for the route, **extend it** rather than create a parallel service. Where a service does not exist, create one whose name matches the route file. Keep service files thin — accept the parameters the route currently passes, return what the route currently returns, no new abstractions. The goal is mechanical relocation, not redesign.

**Refactor pattern (template):**

Before (route):
```ts
// server/routes/<feature>.ts
import { db } from '../db/index.js';
// ...
router.get('/items/:id', async (req, res) => {
  const row = await db.select().from(items).where(eq(items.id, req.params.id));
  res.json(row);
});
```

After (route):
```ts
// server/routes/<feature>.ts
import { <feature>Service } from '../services/<feature>Service.js';
// ...
router.get('/items/:id', asyncHandler(async (req, res) => {
  const row = await <feature>Service.getItem(req.params.id, req.orgId!);
  res.json(row);
}));
```

After (service — new):
```ts
// server/services/<feature>Service.ts
import { eq, and } from 'drizzle-orm';
import { withOrgTx } from '../instrumentation.js';
import { items } from '../db/schema/index.js';

export const <feature>Service = {
  async getItem(id: string, organisationId: string) {
    return withOrgTx(organisationId, async (tx) => {
      return tx.select().from(items)
        .where(and(eq(items.id, id), eq(items.organisationId, organisationId)))
        .limit(1)
        .then((r) => r[0] ?? null);
    });
  },
};
```

**Three patterns chosen by route type:**

1. **Org-scoped HTTP routes** (rows 3, 5, 6, 7, 8, 9, 10, 11, 13 in the table). Service uses `withOrgTx(req.orgId, …)` from `server/instrumentation.ts`. The `req.orgId` is set by the existing auth middleware. Every query inside `withOrgTx` runs with `app.organisation_id` set, and the RLS policies enforce isolation. The service should still pass `organisationId` explicitly to every `where` clause (defence-in-depth — the gate `verify-org-scoped-writes` enforces this at write sites and the principle generalises).
2. **System-admin HTTP routes** (rows 4, 12 — `systemAutomations`, `systemPnl`). These already require `requireSystemAdmin` middleware and operate without an org scope (admin views span all orgs). Wrap DB access in `withAdminConnection()` from `server/lib/adminDbConnection.ts`. This bypasses RLS by design — admins are explicitly trusted.
3. **Lib-tier files** (rows 1, 2 — `briefVisibility`, `onboardingStateHelpers`). The lib tier is for pure helpers and small utilities. When a "lib" file is doing DB access, it has outgrown the tier. Move the DB-touching code into a peer service and leave the pure-function helpers in lib.

**`server/lib/briefVisibility.ts` → `server/services/briefVisibilityService.ts`.** Per the gate output, line 1 imports `db`. The fix is wholesale: any non-pure logic moves to the new service file; pure helpers (e.g. visibility-rule calculators) stay in `lib`. The new service exports the same callable surface — every caller updates its import path. The scope of caller-updates must be enumerated in the PR description (find with `grep -rn "from.*briefVisibility" server/`).

**`server/lib/workflow/onboardingStateHelpers.ts` → split.** Pure-state-transition helpers stay in `lib`. The DB-touching parts move to a new `server/services/onboardingStateService.ts`. The gate target is `lib/` having no `db` import; the existing pure-state work can stay in place.

**Caller updates.** For each new service file, run `grep -rn "from.*<oldImport>" server/ client/ shared/` and update every importer to the new module path. Update tests (`server/services/__tests__/**`) likewise. No public API changes — the moved functions retain their export names where possible.

**Tests:** This phase introduces no new tests (testing posture is gates-primary; framework-level isolation is already covered by `rls.context-propagation.test.ts`). Existing tests must continue to pass — re-run `npm test` against any `__tests__` colocated with the moved code.

### §4.3 Phase 1C — Cross-org write guards

**Finding origin:** P3-C10, P3-C11.

**Files and exact line edits:**

| File | Line | Current (defective) | Required (canonical) |
|---|---|---|---|
| `server/services/documentBundleService.ts` | 679 | `.where(eq(agents.id, subjectId))` | `.where(and(eq(agents.id, subjectId), eq(agents.organisationId, organisationId)))` |
| `server/services/documentBundleService.ts` | 685 | `.where(eq(tasks.id, subjectId))` | `.where(and(eq(tasks.id, subjectId), eq(tasks.organisationId, organisationId)))` |
| `server/services/skillStudioService.ts` | 168 | `.where(eq(skills.id, skillId))` | `.where(and(eq(skills.id, skillId), eq(skills.organisationId, organisationId)))` |
| `server/services/skillStudioService.ts` | 309 | `.where(eq(skills.id, skillId))` (inside `tx.update`) | `.where(and(eq(skills.id, skillId), eq(skills.organisationId, organisationId)))` |

The `organisationId` parameter is already in scope at each call-site (verified during ground-truth gate run); the fix is mechanical. Where `and(...)` is not yet imported from `drizzle-orm`, add the import.

**`scheduledTasks` branch in `documentBundleService.verifySubjectExists`:** the function has a `subjectType === 'scheduled_task'` branch on line 686+ which is currently *not* flagged by the gate. Inspect this branch during the fix; if it has the same `eq(scheduledTasks.id, subjectId)`-only pattern, apply the same `eq(scheduledTasks.organisationId, organisationId)` filter even though the gate does not currently flag it. The gate's coverage of this surface is line-by-line; the principle generalises across branches.

**Why services not RLS:** RLS already provides the bottom-floor protection (Phase 1A migration). The org-scoped-writes gate enforces a *defence-in-depth* layer — the application code says "I only want my org's data" explicitly. If RLS were ever silently disabled (e.g. by a future migration regression), the explicit `organisationId` filter still protects the caller. This belt-and-suspenders posture is the codebase convention; do not weaken it on the grounds that "RLS already covers it".

### §4.4 Phase 1D — Subaccount resolution enforcement

**Finding origin:** P3-C9 plus the related half of P3-C6.

**Rule.** Every route with a `:subaccountId` URL parameter must call `resolveSubaccount(req.params.subaccountId, req.orgId!)` *before* using the subaccount ID downstream. `resolveSubaccount` (in `server/lib/resolveSubaccount.ts`) verifies that the subaccount belongs to the requesting org and returns the canonical row; failing to call it allows a request scoped to org A to reference subaccount IDs belonging to org B (a horizontal-privilege-escalation primitive even with RLS in place, because a query that joins on subaccount-keyed rows would silently traverse).

**Already-compliant Phase 1B routes (no edit required for §4.4 — verified at spec authoring time).** Several Phase 1B routes carry `:subaccountId` and already call `resolveSubaccount(...)` correctly; they appear in §4.2 only for the direct-DB-import refactor, not for subaccount-resolution. Those routes are: `subaccountAgents.ts`, `configDocuments.ts`, `automationConnectionMappings.ts`, `webLoginConnections.ts`. The §4.2 refactor must preserve their existing `resolveSubaccount` calls verbatim — do not regress compliant routes while extracting handlers into services.

**Files and required edits (the two routes that fail `verify-subaccount-resolution`):**

| File | Current | Required |
|---|---|---|
| `server/routes/memoryReviewQueue.ts` | Has `:subaccountId` parameter; performs an inline `eq(subaccounts.id, ...)` check but does not call the canonical `resolveSubaccount` helper | Add `const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);` at the top of every handler that consumes `req.params.subaccountId`; pass `subaccount.id` (not the raw param) to service calls; remove the inline check |
| `server/routes/clarifications.ts` | Same | Same |

The fix lands inside the §4.2 service-extraction PR for these two files (handler logic is being touched anyway). Co-locate the change.

**Verification:** `bash scripts/verify-subaccount-resolution.sh` returns 0 violations.

### §4.5 Phase 1E — Phantom session var gate baseline

**Finding origin:** P3-C5 (audit) — refined by ground-truth gate state.

**The audit was directionally right but the framing was wrong.** The phantom session var `app.current_organisation_id` *is* present in migrations 0204–0208 and 0212. However, those policies were *replaced at runtime* by `migrations/0213_fix_cached_context_rls.sql` — the live DB state is correct. The gate `verify-rls-session-var-canon.sh` does a static scan of `.sql` files and flags the historical text in 0204–0208/0212 as if it were a live policy. The gate's header comment explicitly says the 0202–0208/0212 occurrences are "baselined", but the gate code does not actually implement the baseline — the baseline statement is aspirational, not enforced.

**The fix has two halves.**

**Half 1 — DB state.** No DB-state fix is required for the historical migrations 0204–0208 and 0212; migration 0213 already corrected them. The corrective work for tables that 0213 *did not* cover lands in §4.1's migration 0227. After 0227 ships, the live DB state for every protected table is canonical.

**Half 2 — Gate baseline.** Update `scripts/verify-rls-session-var-canon.sh` to implement the historical baseline its header advertises. Three options ranked by simplicity:

1. **Hard-coded file allowlist (recommended).** Add a constant array `HISTORICAL_BASELINE_FILES=("0204_document_bundles.sql" "0205_document_bundle_members.sql" "0206_document_bundle_attachments.sql" "0207_bundle_resolution_snapshots.sql" "0208_model_tier_budget_policies.sql" "0212_bundle_suggestion_dismissals.sql")` and skip violations whose file basename matches the allowlist. Document the rationale inline (file-level comment): "These files are immutable migrations; their phantom-var occurrences were repaired at runtime by `0213_fix_cached_context_rls.sql`. New occurrences in any other file remain blocking."
2. **`# baseline:rls-session-var-canon` directive.** Add support for a magic comment in the .sql file and ignore violations on lines beneath such a comment. More flexible, but invites abuse.
3. **Runtime-state check.** Have the gate query the live DB for current policy text instead of grepping files. Most accurate but requires DB connectivity in CI; rejects the static-gates-primary posture.

**Decision:** ship option 1 with an additional inline-comment requirement described below. The filename allowlist is the minimum gate change; the inline comment is the human-readable audit trail that makes it safe to grow the list without revisiting a separate document.

**Inline comment requirement (mandatory).** Each of the six historically-baselined migration files MUST contain the following comment on the line immediately before (or on the same line as) the phantom-var policy text:

```sql
-- @rls-baseline: phantom-var policy replaced at runtime by migration 0213_fix_cached_context_rls.sql
```

This comment serves two purposes: (a) it explains to a reader why the file contains the phantom var without triggering a code-review alarm, and (b) the gate's baseline check is doubly verified — the filename must be in the allowlist AND the relevant line must have this annotation. If either condition is absent, the gate still reports a violation.

Adding these comments is part of Phase 1E's deliverable. It is a six-file, one-line-each edit; the migration files are read-only at the Postgres level (they have already run) but their `.sql` source files on disk are editable.

**Implementation sketch (gate + inline comment):**

```bash
# scripts/verify-rls-session-var-canon.sh

HISTORICAL_BASELINE_FILES=(
  "0204_document_bundles.sql"
  "0205_document_bundle_members.sql"
  "0206_document_bundle_attachments.sql"
  "0207_bundle_resolution_snapshots.sql"
  "0208_model_tier_budget_policies.sql"
  "0212_bundle_suggestion_dismissals.sql"
)

BASELINE_ANNOTATION="@rls-baseline:"

is_baselined() {
  local filepath="$1"
  local basename
  basename=$(basename "$filepath")
  for entry in "${HISTORICAL_BASELINE_FILES[@]}"; do
    if [[ "$basename" == "$entry" ]]; then
      # Filename matches allowlist — also require the annotation comment
      if grep -q "$BASELINE_ANNOTATION" "$filepath"; then
        return 0  # baselined + annotated — skip
      else
        echo "ERROR: $basename is in the baseline allowlist but missing the @rls-baseline: comment" >&2
        return 1  # annotation missing — emit violation
      fi
    fi
  done
  return 1  # not in allowlist — fall through to emit_violation
}

# In the violation-emitting loop:
if is_baselined "$file"; then
  continue
fi
emit_violation ...
```

**`verify-rls-coverage.sh` parallel baseline.** The same gate-noise problem affects `verify-rls-coverage.sh` for the same six historical files (`0204`, `0205`, `0206`, `0207`, `0208`, `0212` — the files that 0213 repaired at runtime but whose source `.sql` text remains as originally written). Apply the same hard-coded-allowlist + annotation check to `verify-rls-coverage.sh` for those six files. The four files genuinely missing FORCE/POLICY at runtime (`0139`, `0141`, `0142`, `0147`) and the two re-assertion candidates (`0153`, `0192`) are addressed by the §4.1 migration and are NOT baselined. (Migrations `0202` and `0203` introduce the `reference_documents` and `reference_document_versions` tables; their original RLS text is correct and does not need a baseline entry — they are not part of this set.)

**Verification (after both gate updates):**

```bash
bash scripts/verify-rls-session-var-canon.sh   # PASS, 0 violations
bash scripts/verify-rls-coverage.sh            # PASS, 0 violations (after 0227 lands)
```

### §4.6 Phase 1 verification

The Phase 1 PR is mergeable when all five RLS gates return 0 violations against the working tree:

```bash
bash scripts/verify-rls-coverage.sh
bash scripts/verify-rls-contract-compliance.sh
bash scripts/verify-rls-session-var-canon.sh
bash scripts/verify-org-scoped-writes.sh
bash scripts/verify-subaccount-resolution.sh
```

Plus:

```bash
npm run build:server                                      # typecheck still passes
npm run test:gates                                        # wraps the gates above + adjacent gates
npx tsx server/services/__tests__/<relocated-test>.test.ts # any service-relocated test still green (per repo convention; scripts/run-all-unit-tests.sh ignores `--` filters)
npx tsx scripts/migrate.ts                                # 0227 applies cleanly against a fresh DB
```

If any of the above fails, the Phase 1 PR does not merge. There is no "ship Phase 1A and defer Phase 1E" — the phase is a unit.

---

## §5. Phase 2 — Gate compliance (HIGH)

**Goal:** every architectural-contract gate that currently *fails* (blocking) returns clean exit; warning-level gates (`verify-input-validation`, `verify-permission-scope`) do not regress and have any newly introduced regressions resolved (see §5.7). After Phase 2, the codebase honours every blocking architectural rule it claims to enforce; warning-level signals remain as observability for operator-led cleanup, not as ship-blockers.

**Ship gate:** the six gates in §3.1's Phase-2 row return clean exit. See §5.8.

**One PR.** Each subsection below is a self-contained file-or-two change; bundling them keeps review cost low and the gate-state delta atomic.

### §5.1 Action-call allowlist gate path correction

**Finding origin:** P3-H4.

**The gate.** `scripts/verify-action-call-allowlist.sh` checks that every slug listed in `ACTION_CALL_ALLOWED_SLUGS` resolves to a registered handler in `server/config/actionRegistry.ts` or `server/services/skillExecutor.ts`.

**The actual situation (verified at spec authoring time).** A populated, live allowlist already exists at `server/lib/workflow/actionCallAllowlist.ts` — it exports `ACTION_CALL_ALLOWED_SLUGS` as a `ReadonlySet<string>` containing 32 slugs, with a colocated pure unit test at `server/lib/workflow/__tests__/actionCallAllowlistPure.test.ts`. The runtime validator at `server/lib/workflow/validator.ts:34` already imports from this file. The gate, however, was hand-coded to look at `server/lib/playbook/actionCallAllowlist.ts` (a path that does not exist) — `scripts/verify-action-call-allowlist.sh:29` hard-codes the wrong directory.

**Decision.** The fix is to point the gate at the existing canonical file — **not** to create a new empty file at the wrong path. The existing populated allowlist is the source of truth; forking it would leave the validator, the test, and the gate disagreeing on which file matters.

**Required edits:**

1. **`scripts/verify-action-call-allowlist.sh:29`** — change `ALLOWLIST_FILE="$ROOT_DIR/server/lib/playbook/actionCallAllowlist.ts"` to `ALLOWLIST_FILE="$ROOT_DIR/server/lib/workflow/actionCallAllowlist.ts"`. No other changes to the gate are needed — the slug-extraction regex already matches the `Set([ … ])` literal shape.
2. **No code changes** — `server/lib/workflow/actionCallAllowlist.ts` is already correctly populated and imported by `server/lib/workflow/validator.ts`. Do not create `server/lib/playbook/actionCallAllowlist.ts`. Do not move the existing file.
3. **`docs/onboarding-playbooks-spec.md`** — if the originating spec still references the `playbook/` path, update that reference too as a docs-cleanup pass (not strictly required for the gate to pass; do it opportunistically).

**Verification:** `bash scripts/verify-action-call-allowlist.sh` returns clean exit with `0 violations` after the gate's path is corrected. The 32 existing slugs all resolve to registered handlers in `actionRegistry.ts` or `skillExecutor.ts` — verified by the colocated pure unit test.

### §5.2 Canonical-read interface enforcement

**Finding origin:** P3-H5.

**The violation.** `server/jobs/measureInterventionOutcomeJob.ts:213-218` executes a direct Drizzle SELECT against `canonicalAccounts` outside `canonicalDataService`. The architectural rule is: every read of a `canonical_*` table must go through `canonicalDataService`. The gate `verify-canonical-read-interface.sh` enforces this.

**Why the rule exists.** Canonical tables have a unified read interface that handles cross-tenant isolation, principal-aware row scoping, and integration-source attribution. Direct queries bypass that interface and re-implement the wrappers ad-hoc, which silently diverges over time.

**`canonicalDataService` is a read-only abstraction layer — no side effects.** Any method added to the service in Phase 2 (or after) must be a read-only query with no side effects. The service's contract is: "given a principal and a query predicate, return canonical rows". It never writes, never triggers background work, and never caches with mutation. If a caller needs to write to a canonical table, it does so through the table's owning service (e.g. the CRM ingestion service), not through `canonicalDataService`. This constraint is enforced at code-review time (no automated gate exists yet); see §15.2 for the corresponding durable invariant.

**Fix.** The job is checking whether a `canonicalAccount` exists for a given `(organisationId, subaccountId, accountId)`. `canonicalDataService` should expose that check. Two concrete patterns:

1. **Reuse an existing method.** If `canonicalDataService.findAccountById(...)` or `canonicalDataService.assertAccountExists(...)` already exists with the right signature, call it. Read the service's exports first.
2. **Add a thin method.** If no existing method fits, add a single boolean-returning helper: `canonicalDataService.accountExistsInScope(principal, accountId): Promise<boolean>`. The method body is the same query, lifted into the service, with the principal-context wrapping `withPrincipalContext` requires.

**Caller side (`measureInterventionOutcomeJob.ts:213-218`):** replace the direct SELECT with the canonical-service call. Pass the `PrincipalContext` the job already has (or build one via `fromOrgId(organisationId, subaccountId)` if the job is org-only).

**Verification:** `bash scripts/verify-canonical-read-interface.sh` returns clean exit with `0 violations`.

### §5.3 Direct-adapter call removal — `referenceDocumentService`

**Finding origin:** P3-H6.

**The violation.** `server/services/referenceDocumentService.ts:7` imports `countTokens` and `SUPPORTED_MODEL_FAMILIES` directly from `./providers/anthropicAdapter.js`. The gate `verify-no-direct-adapter-calls.sh` blocks any production code from importing adapter symbols outside `llmRouter`. The rule exists because every LLM call must land in `llm_requests` for cost attribution and replay.

**Why the import is genuinely an LLM call.** `countTokens` calls Anthropic's token-counting endpoint via `ANTHROPIC_API_KEY` — it is a billable API request, even if the result is a single integer. Every other token-counting site in this codebase routes through `llmRouter`, and the cost accounting depends on it.

**Fix.** Add a `countTokens` method to `llmRouter` and a corresponding `SUPPORTED_MODEL_FAMILIES` re-export. The method delegates to the appropriate adapter based on `modelFamily`.

**`server/services/llmRouter.ts` additions (sketch):**

```ts
// Public re-export — keeps the type ergonomics without leaking the adapter path.
export { SUPPORTED_MODEL_FAMILIES } from './providers/anthropicAdapter.js';
export type { SupportedModelFamily } from './providers/anthropicAdapter.js';

export const llmRouter = {
  // existing routeCall, etc.

  /**
   * Counts tokens for the given content under the named model family.
   * Records the call in llm_requests for cost attribution.
   */
  async countTokens(args: {
    modelFamily: SupportedModelFamily;
    content: string;
    context: { organisationId: string; sourceType: SourceType; sourceId?: string; featureTag?: string };
  }): Promise<number> {
    // 1. Adapter dispatch (currently only Anthropic supports server-side counting)
    // 2. Wrap in the same provisional-row + finaliser pattern routeCall uses
    // 3. Return the integer
  },
};
```

**Caller side (`referenceDocumentService.ts:7`):** replace
```ts
import { countTokens, SUPPORTED_MODEL_FAMILIES } from './providers/anthropicAdapter.js';
```
with
```ts
import { llmRouter, SUPPORTED_MODEL_FAMILIES, type SupportedModelFamily } from './llmRouter.js';
```

Update the call-site to pass the `context` object (orgId, sourceType, etc.) that `referenceDocumentService` already has on hand.

**Why not just exempt the gate.** Token counting is not free; it is observed in production cost data. Routing through `llmRouter` makes those costs auditable and prevents future drift where a different adapter is wired up that *does* charge per call.

**Verification:** `bash scripts/verify-no-direct-adapter-calls.sh` returns clean exit with `0 violations`.

### §5.4 Principal-context propagation

**Finding origin:** P3-H7.

**The violation.** Five files import `canonicalDataService` without also importing any of `withPrincipalContext`, `PrincipalContext`, `fromOrgId`, or `principal/types`:

| File | Line | Caller context |
|---|---|---|
| `server/config/actionRegistry.ts` | 112 | Action-handler dispatch table; consumed by both org-scoped and admin paths. |
| `server/services/intelligenceSkillExecutor.ts` | 1 | Skill executor — runs inside agent runs which already have `PrincipalContext`. |
| `server/services/connectorPollingService.ts` | 7 | Worker-side polling; runs in `createWorker` jobs. |
| `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts` | 4 | Query planner executor; receives `PrincipalContext` at the entry point already. |
| `server/routes/webhooks/ghlWebhook.ts` | 7 | Webhook handler; **unauthenticated** (HMAC signature only — no JWT, no `req.orgId`). The org and subaccount are resolved by looking up `connectorConfigs` + `canonicalAccounts` via `locationId` from the webhook payload before any `canonicalDataService` activity. |

**The rule.** Per `architecture.md` "P3B — Principal-scoped RLS", every caller of `canonicalDataService` must pass a `PrincipalContext` so the service can apply principal-aware row scoping (used for cross-subaccount visibility decisions, agent-vs-user attribution, and team filtering). The migration shim `fromOrgId(orgId, subaccountId?)` synthesises a basic `PrincipalContext` from the legacy org-scoped call signature; it is acceptable during the P3A→P3B migration window.

**Fix per file:**

| File | Strategy |
|---|---|
| `server/config/actionRegistry.ts` | Add `import { fromOrgId } from '../services/principal/fromOrgId.js';` at the top. The action-registry dispatch already has `organisationId` (and sometimes `subaccountId`) in scope at call-sites; wrap with `fromOrgId(organisationId, subaccountId)` when invoking `canonicalDataService` methods. |
| `server/services/intelligenceSkillExecutor.ts` | Threads `PrincipalContext` through from agent-run context. The executor receives the run's principal already; pass it through. Add `import type { PrincipalContext } from './principal/types.js';` to satisfy the gate's import-presence check. |
| `server/services/connectorPollingService.ts` | The worker iterates over connectors and resolves a per-record `dbAccount` lookup; `organisationId` is in scope at every call site, and `dbAccount.subaccountId` is available only at the canonical-record-level call sites (not at the broader connector-iteration scope). Use `fromOrgId(organisationId)` at org-level call sites and `fromOrgId(organisationId, dbAccount.subaccountId ?? undefined)` at the per-record sites — call out which calls fall into each bucket in the PR description. |
| `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts` | The planner already receives a `PrincipalContext` at the entry point; thread it down to the canonical-service calls. Update the import to include `PrincipalContext` type for clarity. |
| `server/routes/webhooks/ghlWebhook.ts` | The handler is unauthenticated (HMAC signature only — no JWT, no `req.orgId`); the org and subaccount are resolved by looking up `connectorConfigs` + `canonicalAccounts` via `locationId`. Construct the principal context AFTER that lookup with `fromOrgId(config.organisationId, dbAccount.subaccountId ?? undefined)` and pass it to every `canonicalDataService` call downstream. |

**Why `fromOrgId` is acceptable.** The shim is explicitly documented as a migration step. Its existence acknowledges that not every call-site has the principal threaded through yet. Using it now bounds the scope of Phase 2 — full principal threading in five callsites is a separate refactor the codebase has not yet finished. Per `convention_rejections` in `docs/spec-context.md`, "do not introduce new service layers when existing primitives fit" — and `fromOrgId` is the existing primitive for this case.

**Verification:** `bash scripts/verify-principal-context-propagation.sh` returns clean exit with `0 violations`.

### §5.5 Skill read-path completeness

**Finding origin:** P3-H8.

**The violation.** `verify-skill-read-paths.sh` reports `Literal action entries: 94, with readPath: 99` — a count mismatch of 5. The direction of the mismatch (`readPath` count exceeds literal-action count) is ambiguous from the summary line alone — it could indicate (a) duplicate `readPath` entries, (b) `readPath` pointing at handler references that don't have a corresponding literal-action row, (c) an off-by-five in the gate's own counting logic, or (d) the inverse situation (literal-actions missing `readPath` — but that would produce the opposite direction). Do not act on the summary's surface-level diagnosis.

**Investigation step (required before the fix).** Enumerate the offending entries first:

```bash
bash scripts/verify-skill-read-paths.sh --verbose 2>&1 | tail -40
```

If `--verbose` is not supported, modify the gate temporarily (revert before merge) to print BOTH the literal-action slugs and the `readPath` slugs, then diff the two lists to enumerate the actual five entries on each side. Write the enumerated list inline into the PR description.

**Fix (after enumeration).** Once the five entries are named, classify each:
- If the action genuinely lacks a `readPath`: add it. Valid values are documented in the registry header comment (typically a path like `internal:skills/<category>/<slug>.md` or a registered handler reference).
- If the action has a duplicate or stale `readPath`: remove the duplicate; ensure each `readPath` resolves to exactly one literal-action.
- If the action has no read surface and is misclassified: escalate to the operator before adding a placeholder value.

The Phase 2 ship gate is "the gate returns clean exit" — whatever the actual five entries turn out to be, the action is to reconcile the counts via direct edits to `actionRegistry.ts`. The `readPath` count direction is a diagnostic tool, not the diagnosis itself.

**Verification:** `bash scripts/verify-skill-read-paths.sh` returns clean exit with `Literal action entries: N, with readPath: N` (matched counts).

### §5.6 Canonical dictionary additions

**Finding origin:** P3-M15 (audit) — re-verify against the gate at execution time.

**The violation (per audit).** `verify-canonical-dictionary.sh` flags `canonical_flow_definitions` and `canonical_row_subaccount_scopes` as missing from the canonical-dictionary registry. These tables exist (added in earlier migrations) but are not declared in the registry that `verify-canonical-dictionary` enforces.

**Re-verify before fix.** The audit captured this finding on 2026-04-25 against `main` SHA `b8f4aac`. By the time Phase 2 ships, `main` will have moved. Re-run the gate first:

```bash
bash scripts/verify-canonical-dictionary.sh
```

If the violation set has changed (table renamed, table dropped, table added to dictionary by another PR), reconcile against the live output.

**Fix template.** Each missing table needs a registry entry. The dictionary lives in `server/services/canonicalDataService.ts` (or an adjacent registry file — confirm location during execution). Add an entry per table specifying:
- `tableName`: the literal Postgres table name
- `pkColumn`: the primary key column (typically `id`)
- `orgScopeColumn`: typically `organisation_id`
- `subaccountScopeColumn`: typically `subaccount_id` if applicable
- Read-side metadata as required by the dictionary's existing schema (mirror neighbouring entries verbatim — reuse, do not invent)

**Verification:** `bash scripts/verify-canonical-dictionary.sh` returns clean exit.

### §5.7 Input validation and permission scope warnings

**Finding origin:** P3-M13, P3-M14.

**Status.** Both gates emit `WARNING` (not `BLOCKING FAIL`) and do not name specific files in the captured output. They are *signals* that some routes may lack Zod validation or have incomplete permission checks, but the gate's resolution is too coarse to drive a single PR.

**Action in Phase 2.** The fix is not "make the gates green" — they are warnings, not blockers. Phase 2 instead:

1. Re-runs both gates with whatever verbose mode is available to enumerate the suspect routes.
2. For each named route, confirms whether the suspect file is genuinely missing the check or is a false positive (e.g. the gate's regex is overly broad).
3. For each genuine miss, adds the missing Zod schema or `requirePermission` call inline. These are mechanical edits of the same shape as Phase 1B's service-layer extraction; they do not require new architectural primitives.
4. For each false positive, adds a one-line `# baseline-allow` or equivalent suppression at the gate's specific match point with a comment explaining why.

If the gate output is too coarse to action mechanically (>15 minutes of triage per warning), defer the specific finding to Phase 5 and document inline in the PR description. The Phase 2 ship gate does not require these warnings to clear — the WARNING level is correct for "look at this when convenient".

**Verification:** Both gates run; any new violations introduced by Phase 2 work itself are resolved before merge.

### §5.8 Phase 2 verification

The Phase 2 PR is mergeable when all six core gates return 0 violations:

```bash
bash scripts/verify-action-call-allowlist.sh
bash scripts/verify-canonical-read-interface.sh
bash scripts/verify-no-direct-adapter-calls.sh
bash scripts/verify-principal-context-propagation.sh
bash scripts/verify-skill-read-paths.sh
bash scripts/verify-canonical-dictionary.sh
```

Plus:

```bash
npm run build:server               # typecheck still passes
npm run test:gates                 # static gates regression-check
```

The two warning gates (`verify-input-validation`, `verify-permission-scope`) are not blockers but should not regress: a `WARNING` count that grows during Phase 2 is treated the same as a violation.

---

## §6. Phase 3 — Architectural integrity (HIGH)

**Goal:** the schema layer is a leaf — no `server/db/schema/**` file imports from `server/services/**`, `server/lib/**`, or `server/routes/**`. Eliminate the largest two client cycle clusters.

**Ship gate:** server cycle count drops from 175 to ≤ 5 (the audit identifies a single root cycle driving 170+ derived cycles; resolving the root resolves the cascade). Client cycle count drops from at least 14 (`ProposeInterventionModal` cluster of 10 + `SkillAnalyzerWizard` cluster of 4) to ≤ 1.

**One PR.** The cycles are causally connected — server fix is a type extraction, client fixes are interface extractions. Bundling them gives a single architectural-integrity review.

### §6.1 Server circular-dependency root fix

**Finding origin:** P3-H1.

**The root violation.** `server/db/schema/agentRunSnapshots.ts:3` contains:

```ts
import type { AgentRunCheckpoint } from '../../services/middleware/types.js';
```

A schema file imports from a services file. The import is `type`-only, but `madge` resolves it as a graph edge regardless. This single violation creates the root cycle:

```
db/schema/index.ts
  → db/schema/agentRunSnapshots.ts
    → services/middleware/types.ts
      → services/agentExecutionService.ts (which re-imports schema/index for table refs)
        → … 170+ derived cycles
```

Fixing the root resolves the cascade.

**The architectural rule.** `server/db/schema/**` files import only from:
- `drizzle-orm` and `drizzle-orm/pg-core` (the ORM)
- `shared/**` (cross-runtime serialisable types)
- Other `server/db/schema/**` files (intra-schema relationships)

They do NOT import from `server/services/**`, `server/lib/**`, `server/middleware/**`, `server/routes/**`, or `server/jobs/**`. The schema is a leaf; the service tier reads schema, never the other way.

**Phase 3 scope vs the leaf rule.** Phase 3 fixes the **largest** violation of the leaf rule — the `agentRunSnapshots.ts` import that drives the 175-cycle cascade. Verified at spec authoring time, two other schema files also violate the leaf rule today: `server/db/schema/agentRuns.ts:3` imports `AgentRunHandoffV1` from `server/services/agentRunHandoffServicePure.ts`, and `server/db/schema/skillAnalyzerJobs.ts:15` imports `SkillAnalyzerJobStatus` from `server/services/skillAnalyzerServicePure.ts`. These are smaller cycles that did not surface in the audit's headline finding. Phase 3 does **not** include those two — they are tail items routed to §8.4 with the same "extract type to `shared/types/`" pattern. The Phase 3 DoD reflects this: the goal is the 175→≤5 cycle reduction, not an absolute leaf-rule guarantee for every schema file.

**Fix.** Extract `AgentRunCheckpoint` and its type dependencies to a new file in `shared/types/`. The dependencies form a small closed graph already (verified during spec authoring):

| Type | Currently in | Move to |
|---|---|---|
| `AgentRunCheckpoint` | `server/services/middleware/types.ts:245` | `shared/types/agentExecutionCheckpoint.ts` |
| `SerialisableMiddlewareContext` | `server/services/middleware/types.ts` | Same new file |
| `SerialisablePreToolDecision` | `server/services/middleware/types.ts` (alias for `PreToolDecision`) | Same new file |
| `PreToolDecision` | `server/services/middleware/types.ts` | Same new file (this is the underlying discriminated union) |

**Why all four move together.** `AgentRunCheckpoint` references `SerialisableMiddlewareContext`, which references `SerialisablePreToolDecision`, which is an alias for `PreToolDecision`. Extracting only `AgentRunCheckpoint` would leave the schema file transitively importing from services. The four types form a serialisable-payload-shape cluster — they are exactly the right group to live in `shared/types/`.

**Why `shared/types/` and not `server/db/schema/types.ts`.** `shared/types/` is the codebase's existing pattern for types that cross runtime boundaries. The checkpoint payload is persisted as JSONB and read by both the server (during resume) and any debug surfaces; the client may also display it on `AgentRunLivePage`. Putting it in `shared/types/` keeps the import surface consistent with neighbouring types like `agentExecutionLog.ts` (already in `shared/types/`).

**Implementation steps:**

1. **Create `shared/types/agentExecutionCheckpoint.ts`.** Move the four type definitions verbatim (preserving JSDoc). Add a header comment: `// Persisted in agent_run_snapshots.checkpoint JSONB. Read by server resume path and AgentRunLivePage debug surface. Schema files import this directly; services may import from here OR from server/services/middleware/types (which re-exports).`
2. **Update `server/services/middleware/types.ts` to re-export.** Replace the four definitions with `export type { AgentRunCheckpoint, SerialisableMiddlewareContext, SerialisablePreToolDecision, PreToolDecision } from '../../../shared/types/agentExecutionCheckpoint.js';`. Existing service-layer call-sites continue to import from `middleware/types` and work unchanged.
3. **Update `server/db/schema/agentRunSnapshots.ts:3`** to import from `shared/types/agentExecutionCheckpoint.js` instead. The schema file's only outbound import is now to `shared/`, satisfying the leaf rule.
4. **Run `madge --circular --extensions ts server/`.** Confirm cycle count drops to ≤ 5. If non-trivial cycles remain, they are pre-existing and not caused by this fix; document them inline in the PR description and route to Phase 5.
5. **Run `npm run build:server` and `npm run build:client`.** Both must pass.
6. **Run `npm test` against `server/services/__tests__/agentExecutionServicePure.checkpoint.test.ts`.** This is the named test that exercises checkpoint serialisation; it must continue to pass.

**Why not delete `toolCallsLog`.** The same schema file (`agentRunSnapshots.ts`) has a `toolCallsLog` column flagged DEPRECATED with a Sprint 3B removal note. That removal is independent of this fix — the cycle root is a single import line, and removing the column is a separate migration that ships in Phase 5 (§8.4).

### §6.2 Client circular-dependency cleanups

**Finding origin:** P3-M7, P3-L8.

#### §6.2.1 `ProposeInterventionModal` cluster (10 cycles)

**The cluster.** `client/src/components/clientpulse/ProposeInterventionModal.tsx` imports five sub-editor components:

- `CreateTaskEditor`
- `EmailAuthoringEditor`
- `FireAutomationEditor`
- `OperatorAlertEditor`
- `SendSmsEditor`

Each sub-editor re-exports props or interface types that the parent modal needs. The cycle pattern is: parent imports child component, child imports parent's interface, parent imports child's interface. Multiplied across five sub-editors, this produces 10 detected cycles.

**Fix.** Extract the shared interfaces to a sibling `types.ts` file:

- New file: `client/src/components/clientpulse/types.ts` (canonical name — referenced by §12.1).
- Move every interface that *both* the parent modal and the sub-editors import to this file.
- Update both sides to import from the new file.

The component implementations stay in their current files; only the type definitions migrate. This is a mechanical relocation — no behaviour changes.

#### §6.2.2 `SkillAnalyzerWizard` cluster (4 cycles)

**The cluster.** `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx` ↔ four step components in the same directory: `SkillAnalyzerImportStep.tsx`, `SkillAnalyzerExecuteStep.tsx`, `SkillAnalyzerProcessingStep.tsx`, `SkillAnalyzerResultsStep.tsx`. Same pattern as §6.2.1. (Directory name is `skill-analyzer`, kebab-case — verified at spec authoring time.)

**Fix.** Extract step-level interfaces (`StepProps`, `WizardState`, etc.) to `client/src/components/skill-analyzer/types.ts`. Update both `SkillAnalyzerWizard.tsx` and the four step components to import from the new file.

#### §6.2.3 Remaining client cycles

After §6.2.1 and §6.2.2, run `madge --circular --extensions ts,tsx client/src/`. Any remaining cycles are out of scope for this phase; document them inline and route to Phase 5.

### §6.3 Phase 3 verification

The Phase 3 PR is mergeable when:

```bash
npx madge --circular --extensions ts server/ | wc -l                          # ≤ 5
npx madge --circular --extensions ts,tsx client/src/ | wc -l                  # ≤ 1
npm run build:server                                                          # typecheck passes
npm run build:client                                                          # build passes
npx tsx server/services/__tests__/agentExecutionServicePure.checkpoint.test.ts # named test passes (run by direct path; scripts/run-all-unit-tests.sh ignores `--` filters)
```

**Cycle-count discipline — two-stage target.** Phase 3 sets a target of ≤ 5, not 0. The root fix drives the 175→≤5 reduction; the last few cycles (the two schema-leaf tail items: `agentRuns.ts:3` and `skillAnalyzerJobs.ts:15`) are surgical and route to Phase 5A (§8.4). **Phase 5A is where the count must reach 0** — the programme is not declared complete while any server-side cycles remain. The Phase 3 PR ships once the count drops sharply; the Phase 5A tail items close the final gap. This two-stage sequencing is intentional: the Phase 3 type-extraction is the architecturally significant change; the Phase 5A tail items are one-file extractions with trivial review cost. Inverting the order would delay Phase 3 on minor mechanical work.

---

## §7. Phase 4 — System consistency (MEDIUM)

**Goal:** the skill registry is internally coherent; every dependency the codebase uses is declared explicitly; the YAML gate runs; the customer-facing copy in `docs/capabilities.md` honours editorial law.

**Ship gate:** `npm run skills:verify-visibility` passes with 0 violations; `node scripts/verify-integration-reference.mjs` runs without crashing; `npm install` returns clean (no missing-dep warnings); the operator confirms the capabilities.md edit.

**One PR.** Subsections §7.1 and §7.2 are mechanical and ship together. §7.3 is operator-led and may ship in a separate small PR if the operator prefers, but does not block §7.1/§7.2.

### §7.1 Skill registry and visibility coherence

**Finding origin:** P3-M10, P3-M11.

#### §7.1.1 Skill visibility drift

**The violation.** `npm run skills:verify-visibility` reports two skills with visibility set to `internal` where the classification table expects `basic`:
- `smart_skip_from_website`
- `weekly_digest_gather`

**Fix.** Run the existing apply script:

```bash
npx tsx scripts/apply-skill-visibility.ts
```

The script is idempotent — it walks `server/skills/**/*.md`, computes the desired visibility from `scripts/lib/skillClassification.ts`, and rewrites only the out-of-sync files. The two named skills will be updated; nothing else should change. Re-run the verify script to confirm:

```bash
npm run skills:verify-visibility
```

If the apply script produces changes outside the two named skills, stop and investigate before committing — that would indicate a classification-table change that this spec did not intend to ship.

#### §7.1.2 Workflow skills missing YAML frontmatter

**The violation.** Five workflow skill files lack the YAML frontmatter block that every other skill markdown carries:

- `server/skills/workflow_estimate_cost.md`
- `server/skills/workflow_propose_save.md`
- `server/skills/workflow_read_existing.md`
- `server/skills/workflow_simulate.md`
- `server/skills/workflow_validate.md`

**Why frontmatter matters.** The skill registry (see `scripts/verify-skill-visibility.ts` and `scripts/apply-skill-visibility.ts`) parses the frontmatter to extract `visibility`, `category`, and other metadata. A skill file without frontmatter is invisible to the registry; the gate's "missing frontmatter" report tells us those five workflow skills are not yet registered.

**Fix.** Add a frontmatter block to each of the five files. The minimum required fields (mirror an existing workflow skill — pick one of the `workflow_*` files that already has frontmatter) are:

```yaml
---
slug: workflow_estimate_cost
category: workflow
visibility: internal      # or basic — confirm against scripts/lib/skillClassification.ts
description: |
  <one-line description>
---
```

For each file, look up the desired `visibility` value in `scripts/lib/skillClassification.ts` (the same source of truth as §7.1.1). The `description` line copies from the file's existing first paragraph. Add the frontmatter at the very top of each markdown file, before any heading.

**Verification.** Re-run `npm run skills:verify-visibility` — count of "missing YAML frontmatter" drops to 0.

### §7.2 Missing dependency declarations and yaml gate fix

**Finding origin:** P3-L1, P3-M12.

#### §7.2.1 Explicit `package.json` dependency declarations

**The violation.** Four production deps are imported from server code but absent from `package.json` as direct dependencies:

- `express-rate-limit` — used by HTTP rate limiters
- `zod-to-json-schema` — used by tool-schema generation
- `docx` — used by document-export paths
- `mammoth` — used by document-import paths

These are currently hoisted from transitive deps (some other dep installs them indirectly). Hoisted-only deps are a supply-chain risk: a transitive-dep update can silently remove the hoist and break the codebase at runtime.

**Fix.** Run:

```bash
npm install --save express-rate-limit zod-to-json-schema docx mammoth
```

Verify `package.json` lists the four packages under `dependencies` (not `devDependencies`). Verify `package-lock.json` is updated and committed. Verify `npm run build:server` and `npm run build:client` still pass.

**Version pinning.** Use the version `npm install` resolves at the time of execution; pin exactly (no `^`/`~` if the rest of `package.json` does not use range pins). Match the existing pin convention in the file.

#### §7.2.2 `verify-integration-reference` gate triage

**The audit-time violation.** When the audit ran, `node scripts/verify-integration-reference.mjs` was reported as crashing with `ERR_MODULE_NOT_FOUND: 'yaml'`. Re-verified at spec authoring time: `yaml ^2.8.3` is already declared in `package.json` devDependencies, and the gate now runs to completion. The original "missing dep" remediation is stale.

**Current state.** The gate runs and emits warnings (capability-naming convention drift, MCP preset / integration-reference.md mismatches). These are real but minor system-consistency findings.

**Fix.** Re-run the gate at the start of Phase 4 to capture the current warning set:

```bash
node scripts/verify-integration-reference.mjs 2>&1 | tee /tmp/verify-integration-reference.log
```

Triage each warning:
- **Capability-naming convention drift** (e.g. `organisation.config.read` not matching `<resource>_read`): if the capability's name is load-bearing in stored data (permission keys), do NOT rename — instead, `# baseline-allow` the warning per §2.4 with a one-line rationale. If the capability is purely internal, rename it.
- **MCP preset wired but no integration block** (e.g. `discord`, `twilio`, `sendgrid`, `github`): add the missing block to `docs/integration-reference.md` (operator-led, but mechanical — copy the shape of an existing block).

Phase 4 ships these triaged edits. The "ship gate" criterion is unchanged — `npm run skills:verify-visibility`, `node scripts/verify-integration-reference.mjs runs cleanly` (no crash), and `npm install` returns no missing-dep warnings — but with the understanding that "runs cleanly" means "no crash"; the warning content is reviewed and either fixed or baselined.

### §7.3 Capabilities editorial fix

**Finding origin:** P3-M16.

**The violation.** `docs/capabilities.md:1001` reads:

> *Not a public skill or playbook marketplace. **Anthropic**-scale distribution isn't the agency play.*

The line is inside the customer-facing **Non-goals** section. Editorial rule 1 in `CLAUDE.md` prohibits naming any specific LLM/AI provider (including Anthropic) in customer-facing sections. The remediation is a copy edit — replace the provider name with generic category language.

**Why the rule matters.** The market positioning is "model-agnostic across every frontier and open-source LLM — we route to the best one per task." Naming a specific provider in collateral implies a default/preferred relationship and undermines the model-agnostic narrative even when the named provider is supportive of the framing.

**Suggested replacement language (for the operator to choose between):**

| Option | Replacement | Rationale |
|---|---|---|
| A | "Hyperscaler-scale distribution isn't the agency play." | Industry-standard term; matches the abstraction level of "LLM providers" used elsewhere on the page. |
| B | "Provider-marketplace-scale distribution isn't the agency play." | More specific to the marketplace context; slightly less marketing-ready. |
| C | "Foundation-model-platform distribution isn't the agency play." | Most neutral; possibly too technical for a Non-goals bullet that is otherwise punchy. |

**Author recommendation:** Option A. Same syllable count as the original, same punch, no provider name.

**Process.** Per `CLAUDE.md` § Editorial rules: editorial fixes on `docs/capabilities.md` are operator-led — never auto-rewritten by an agent. The agent provides the diff (this spec section); the operator reviews, picks the option, applies the edit, and commits. The agent does not commit `docs/capabilities.md` changes without explicit operator approval in the same session.

**Same-pass scan.** While editing line 1001, scan for any other provider names in customer-facing sections that the audit may have missed. The audit confirmed lines 778, 893, 912–913 are in support-facing sections (Skills Reference, Integrations Reference) and are *permitted* by editorial rule 2. If the operator finds additional violations elsewhere in customer-facing sections, fix them in the same edit.

**Verification:** there is no automated gate for editorial rules; verification is operator review. The verification checklist:

1. Line 1001 no longer contains "Anthropic" (or any specific provider name).
2. Customer-facing sections (Core Value Proposition, Positioning, Product Capabilities, Agency Capabilities, Replaces / Consolidates, Non-goals) contain no provider names anywhere.
3. Support-facing sections (Skills Reference, Integrations Reference) are unchanged.

### §7.4 Phase 4 verification

The Phase 4 PR(s) are mergeable when:

```bash
npm run skills:verify-visibility               # 0 violations
node scripts/verify-integration-reference.mjs  # runs cleanly
npm install                                    # no missing-dep warnings
npm run build:server && npm run build:client   # both pass
```

For §7.3 (capabilities edit), verification is operator-led — the operator confirms the diff applies cleanly and the file no longer references Anthropic in customer-facing sections.

---

## §8. Phase 5 — Controlled improvements (LOW–MEDIUM)

**Goal:** the codebase is multi-process-safe at every rate-limit boundary; silent-failure paths are closed; tail items from the audit are either resolved or formally deferred.

**Phase 5 is split into two sub-phases:**

- **Phase 5A — Mandatory.** Rate limiter durability (§8.1) and silent-failure path closure (§8.2). These are *blocking* items: the programme is not declared complete until both ship. They carry a concrete ship gate (see §8.5A below).
- **Phase 5B — Optional / backlog.** Targeted type strengthening (§8.3) and tail items (§8.4). These are improvements that *can* ship in any order and any sprint; they are formally tracked (each has a DoD checkbox in §13.5B) but do not block programme completion. If the operator decides to defer all of §8.3/§8.4 to future feature sprints, Phase 5 is still "complete" as long as every §8.3/§8.4 item appears in §14 Deferred Items with an operator note.

**Multiple PRs.** Unlike Phases 1–4, Phase 5 is not a single PR. Each subsection below is independent of the others. Ship them in any order within their sub-phase; review cost stays low because each PR is small and targeted.

### §8.1 Rate limiter durability

**Finding origin:** P3-M1.

**The violation — two distinct in-memory rate limiters.** Verified at spec authoring time: there are TWO independent in-memory rate-limit implementations in the codebase, not one:

1. **`server/lib/testRunRateLimit.ts`** — guards user-initiated *test* agent runs (`is_test_run = true`). Used by `server/routes/agents.ts`, `server/routes/skills.ts`, `server/routes/subaccountAgents.ts`, `server/routes/subaccountSkills.ts` (4 callers). Carries an explicit `TODO(PROD-RATE-LIMIT)` comment.
2. **Inline `Map<string, number[]>` rate limiters** in `server/routes/public/formSubmission.ts` (functions `checkRateLimit` + `rateLimitMiddleware`) and `server/routes/public/pageTracking.ts` (function `checkTrackRateLimit`). These limit public form submissions and tracking pixel hits per-IP and per-page; they are not test-run-scoped. They have no shared store and no TODO comment.

Both share the same multi-process bug: in-memory state is per-process, so under N Node workers the effective limit is N-multiplied; under restarts the counter resets to zero. P3-M1 originally referenced the test-run limiter (the one with the TODO), but the same defect applies to the public-route limiters with the same operator-led pre-production-flip risk.

**Phase 5 §8.1 scope (decision).** Rewrite **both** limiters in the same Phase 5 PR — they share the same table, the same sliding-window algorithm, the same cleanup job, and the same multi-process correctness argument. Splitting them would force two migrations and two reviews of the same conceptual change. The new shared primitive is `server/services/rateLimitStoreService.ts` (new file — see step 2 below); `testRunRateLimit.ts` and the public-route inline limiters both delegate to it.

**Why a new primitive (`server/services/rateLimitStoreService.ts`) rather than reuse / extension.** Per `docs/spec-authoring-checklist.md` §1, every new primitive needs a "why not reuse, why not extend" paragraph:
- **Why not reuse `webhookDedupe.ts`** — webhookDedupe is a single-bucket idempotency check (one row per dedupe key). Rate limiting needs sliding-window math (multiple rows per bucket key, summed over a time range). The shapes are different.
- **Why not extend `testRunIdempotency.ts`** — testRunIdempotency holds singleton run-level state. Rate-limit-buckets need millions of small rows over time and a cleanup job. Cohabiting two shapes in one file would obscure both.
- **Why not Redis** — the codebase has no Redis primitive today; introducing one is a new infrastructure dependency. Postgres handles a few hundred requests per minute per limit-key well within its comfort zone.
- **Why a separate `rateLimitStoreService.ts` rather than putting the logic inside `testRunRateLimit.ts` or each public-route file** — the same algorithm (bucket increment + window sum + cleanup) services both surfaces; duplicating it across files (with subtle drift) is the failure mode this primitive prevents.
- **Why the service tier and not `server/lib/**`** — `server/lib/**` files MUST NOT import `db` directly (per §1 boundary 2 and §15.2's invariant). DB-touching primitives belong in `server/services/**` per the codebase's three-layer fail-closed pattern. The existing DB-backed pattern in `server/services/testRunIdempotency.ts` is the precedent (a service, not a lib helper). `webhookDedupe.ts` is also in `server/lib/**` but is in-memory only — it does not import `db`.

The new primitive's surface is narrow: two pure-friendly functions (`incrementBucket`, `sumWindow`) plus the shared bucket table contract. It runs through `withAdminConnection()` (system-scoped table; no org context) — matching how `testRunIdempotency` accesses its DB-backed table.

**Implementation outline:**

1. **New table.** `migrations/<NNNN>_rate_limit_buckets.sql` — the migration number is assigned at merge time per §2.5's concurrent-PR rule (rebase against latest `main` immediately before merge, then rename the file to claim the next available number). Phase 5 PRs land in any order (§2.6, §8.5); other Phase 5 migrations (e.g. §8.4 P3-M6's `<NNNN>_drop_tool_calls_log.sql`) follow the same rule. **Do not pre-allocate migration numbers across Phase 5 PRs** — the rebase-and-rename happens at the head of the merge queue.
   ```sql
   CREATE TABLE rate_limit_buckets (
     bucket_key text NOT NULL,
     window_start timestamptz NOT NULL,
     count integer NOT NULL DEFAULT 0,
     PRIMARY KEY (bucket_key, window_start)
   );
   CREATE INDEX rate_limit_buckets_window_idx ON rate_limit_buckets (window_start);
   ```
   System-scoped table (no `organisation_id`) — rate limits are per-public-key / per-user, not per-tenant. Add to `RLS_PROTECTED_TABLES` only if it ever takes an `organisation_id` column; until then, document inline as "intentionally not tenant-scoped — system rate-limit infrastructure".
2. **New shared primitive.** `server/services/rateLimitStoreService.ts` (new file in the service tier — see "Why the service tier and not `server/lib/**`" above). Exports `incrementBucket(key, windowStart)` and `sumWindow(keyPrefix, since)` (or equivalent) implementing the sliding-window algorithm: bucket the current minute, atomically increment with `INSERT … ON CONFLICT DO UPDATE`, sum the last N minutes' rows for the limit check. DB access goes through `withAdminConnection()` from `server/lib/adminDbConnection.ts` (the table is system-scoped; no org context). Pure-function-friendly contract — accepts an injectable DB handle for testing.
3. **Rewrite `server/lib/testRunRateLimit.ts`** to delegate to `rateLimitStoreService`. Preserve the existing exported function signatures (`checkTestRunRateLimit(userId)` and the helper) so the four callers (`agents.ts`, `skills.ts`, `subaccountAgents.ts`, `subaccountSkills.ts`) need only an `await` change. Note: `testRunRateLimit.ts` itself stays in `server/lib/**` because it is a thin facade that does not touch `db` directly — it imports the service.
4. **Refactor the public-route inline limiters.** `formSubmission.ts:31` (`checkRateLimit`) and `pageTracking.ts:29` (`checkTrackRateLimit`) — replace each with a call into `rateLimitStoreService`. Bucket-key prefixes distinguish the two surfaces (e.g. `form-ip:`, `form-page:`, `track-ip:`); the existing limit thresholds (`IP_LIMIT`, `PAGE_LIMIT`, etc.) move from inline constants to the call site. The new code paths are async — update the surrounding handlers to `await` accordingly.
5. **Add a cleanup job.** `server/jobs/rateLimitBucketCleanupJob.ts` — pg-boss cron that deletes rows where `window_start < now() - interval '1 hour'`. Hourly cadence; cheap. Register the job in `server/jobs/index.ts` (the canonical job-export aggregator) and register the worker + cron schedule in `server/services/queueService.ts` (the actual worker / pg-boss schedule registration site — verified at spec authoring time).

**Env-flag rollback shim (mandatory, ships alongside DB implementation).** `server/services/rateLimitStoreService.ts` checks `process.env.USE_DB_RATE_LIMITER` at module load. When the flag is `false` (or unset in a legacy env), the service exports a no-op in-memory shim with identical function signatures. The shim reverts to the pre-Phase-5A in-process Map behaviour. This allows the rollback described in §11.2 without reverting code. See §11.2 for the rollback procedure.

**Verification.** Add unit tests (pure-function-only per `runtime_tests: pure_function_only`):
- `server/services/__tests__/rateLimitStoreService.test.ts` — sliding-window math (bucket increment, window-sum read, expiry cutoff). Inject an in-memory mock for the DB handle. Also test the env-flag shim path: when `USE_DB_RATE_LIMITER=false`, the service returns without touching the DB.
- `server/lib/__tests__/testRunRateLimit.test.ts` — preserves existing test-run rate-limit semantics on top of the shared store.

Manual verification: spin up two processes locally, hammer (a) a public form and (b) the test-run path, observe the per-process behaviour matches a single shared bucket in both cases.

### §8.2 Silent-failure path closure

**Finding origin:** P3-M2.

**The violation.** `bash scripts/verify-no-silent-failures.sh` returns `WARNING` — at least one silent-failure path detected, but the captured output does not name the offending file(s). A silent failure is a `try { … } catch { /* nothing */ }` or `.catch(() => undefined)` site where an error is swallowed without logging or rethrowing; the system continues silently in a degraded state.

**Why warnings, not blockers.** The gate is permissive on intentional patterns (e.g. `softBreakerPure.ts`'s fire-and-forget `.catch()` where the soft breaker pattern explicitly accepts dropped failures). The WARNING level lets the gate report sites without blocking CI; the operator decides when to clean them up.

**Fix process.**

1. **Re-run the gate with verbose output:**
   ```bash
   bash scripts/verify-no-silent-failures.sh --verbose 2>&1 | tee /tmp/silent-failures.log
   ```
   If `--verbose` is not supported, modify the gate script in-place to print each match (revert before merge, or land the verbose flag as a tiny separate PR).
2. **For each named site, classify:**
   - **Genuinely silent** — no log, no rethrow, no metric. Fix: add `console.warn(JSON.stringify({event: 'silent_failure_caught', file: __filename, error: err.message}))` or rethrow as `FailureError` (per `shared/iee/failure.ts`, the canonical primitive).
   - **Intentional fire-and-forget** (e.g. soft-breaker, telemetry pings). Fix: add a `# baseline-allow` directive at the line with a comment explaining why dropping is correct.
   - **False positive** (gate regex misclassifies a non-empty catch). Fix: add the `# baseline-allow` directive with a comment.
3. **Land in one PR.** The number of sites is bounded (the gate already runs in O(seconds)); enumerate every match, classify each, fix mechanically.

**Verification:** `bash scripts/verify-no-silent-failures.sh` returns clean (no `WARNING` line). If the gate's exit code is the source of truth, prefer that; if the WARNING text is informational only, agree with the operator on a clean-pass criterion before merge.

### §8.3 Targeted type strengthening

**Finding origin:** P3-M3, P3-M4, P3-M5, P3-L7.

**Posture.** Per `convention_rejections` and the surgical-changes principle, mass-removal of `as any` is *not* an objective. We strengthen types when we touch the file for another reason. Phase 5 ships the four type-strengthening fixes that are isolated enough to ship as their own small PR each — collectively under 100 LOC delta.

**Per-file work:**

| ID | File | Action |
|---|---|---|
| P3-M4 | `server/services/executionBudgetResolver.ts:71-72` | Replace `platformRow as any`, `orgRow as any` with `InferSelectModel<typeof platformBudgets>` and `InferSelectModel<typeof orgBudgets>` (or whatever the actual table names are — confirm with the file). Standard Drizzle narrowing. |
| P3-M5 | `server/services/dlqMonitorService.ts:28` | Replace `(boss as any).work(` with a typed wrapper. If `boss.work` is missing from `pg-boss` type stubs, file an upstream issue and add a one-line type assertion via a narrowly-scoped helper (`typedBossWork(boss, …)`) with a comment naming the upstream issue. |
| P3-L7 | `server/jobs/bundleUtilizationJob.ts:125` | Derive correct type for `utilizationByModelFamily`. Likely `Record<SupportedModelFamily, UtilizationStat>` — confirm against the producer site. Remove `as any`. |
| P3-M3 | `server/services/cachedContextOrchestrator.ts` (7 sites) | More involved — touches the cached-context discriminated union. Ship only when next touching this file for an unrelated reason. **Defer** to §14 Deferred Items unless the operator explicitly elects to pre-commit it. |

**Why not P3-M3 now.** The cached-context infrastructure shipped on PR #183 with a complex internal discriminated union (`resolveResult.assemblyResult`, `bundleSnapshotIds`, `knownBundleSnapshotIds`). Strengthening these types correctly requires understanding the full union shape, which is the kind of context-load cost that makes "fix when you next touch the file" a better policy than pre-committing under a Phase 5 banner.

### §8.4 Tail items

Each of the items below is small enough to ship as its own one-or-two-file PR. They are listed here so the audit's full pass-3 backlog is closed out — every audit finding either lands in this spec or appears in §14 with a documented rationale.

**P3-M6 — Remove deprecated `toolCallsLog` column.** `server/db/schema/agentRunSnapshots.ts:52` declares `toolCallsLog` as DEPRECATED with a Sprint 3B removal note. Sprint 3B has not yet shipped. This finding requires:
- Confirm Sprint 3B's status with the operator (check `tasks/current-focus.md` and `tasks/todo.md`).
- If 3B is no-longer-in-flight or is rolled into a separate workstream, write `migrations/<NNNN>_drop_tool_calls_log.sql` (number assigned at merge time per §2.5; do not pre-allocate) that drops the column.
- Update the schema file to remove the column declaration.
- Remove any code that reads from or writes to `toolCallsLog` — should be none after 3B's `toolCallsLogProjectionService` deprecation, but verify.

If Sprint 3B is still active and owns the removal, this item moves to §14 Deferred Items as "owned by Sprint 3B".

**P3-M7 follow-on — Extract remaining client `clientpulse/` interfaces.** §6.2.1 covers the `ProposeInterventionModal` cluster. After extraction, run `npx madge --circular --extensions ts,tsx client/src/components/clientpulse/` to find any tail cycles in the same directory; ship them in the same Phase 5 PR if any remain.

**P3-M8 — Verify agent handoff depth ≤ 5 by code or named test.** The invariant is documented in `architecture.md` but not exercised by a static gate or a named test. Add a unit test in `server/services/__tests__/agentRunHandoffService.handoffDepth.test.ts` (pure-function-only — exercise the depth check directly without DB).

**P3-M9 — Verify degraded fallback path (missing active lead).** Add a unit test in the same file or a sibling test file. Pure-function exercise — feed the resolver a "no active lead" state, assert the fallback is taken.

**P3-L2 — `server/routes/ghl.ts` Module C OAuth stubs.** Three handler stubs returning hardcoded responses with `TODO: Module C implementation` comments. Defer to §14 unless the operator wants to track them as a near-term feature item — they are not cleanup, they are missing implementation.

**P3-L3 — `server/services/staleRunCleanupService.ts:21` legacy threshold.** Confirm whether `agent_runs` rows with `lastActivityAt IS NULL` exist in production. If yes, keep `LEGACY_STALE_THRESHOLD_MS` until those rows are gone. If no, remove the legacy branch and the constant. Requires a one-off DB count query against production data — defer to §14 if production access is unavailable.

**P3-L4 — `actionRegistry.ts` "stub" comments at lines 1342, 1428, 1577.** Three comments labelling Support Agent, Ads Management Agent, and Email Outreach Agent action sections as "auto-gated stubs". Either:
- Convert each comment block into a `tasks/todo.md` entry under "agent stub implementation" and remove the inline comment; OR
- Verify that the actions in question have correct gating and remove the "stub" label without changing behaviour.

**P3-L5 — `client/src/components/agentRunLog/EventRow.tsx` exports `SetupConnectionRequest`.** Trace consumers; if used outside the component, move to `shared/types/`. If unused, delete.

**P3-L6 — `client/src/components/ScheduleCalendar.tsx` exports `ScheduleCalendarResponse`.** Same pattern as P3-L5.

**P3-L8 follow-on — Extract remaining `skill-analyzer/` interfaces.** §6.2.2 covers the `SkillAnalyzerWizard` cluster. Same residual-cycle scan as P3-M7 follow-on.

**P3-L9 — Add named test asserting `is_test_run=true` runs are excluded from cost ledger.** Pure-function test in `server/lib/__tests__/runCostBreaker.testRunExclusion.test.ts`.

**P3-L10 — Verify prompt prefix caching (`stablePrefix`) coverage across all run types.** Add to the observability backlog (§14) — requires a live Langfuse trace to confirm, which is out of scope for the static-gates posture.

**Phase 3 schema-leaf-rule tail items.** Two additional schema files violate the leaf rule today and were intentionally NOT scoped into Phase 3 (which fixes only the cascade-driver). Each is a small type-extraction PR following the `shared/types/` pattern from §6.1:

- **`server/db/schema/agentRuns.ts:3`** — imports `AgentRunHandoffV1` from `server/services/agentRunHandoffServicePure.ts`. Extract `AgentRunHandoffV1` to `shared/types/agentRunHandoff.ts`; update the schema file's import; update the service to re-export from the new location (mirror the §6.1 pattern). Run `madge --circular` to confirm no new cycles.
- **`server/db/schema/skillAnalyzerJobs.ts:15`** — imports `SkillAnalyzerJobStatus` from `server/services/skillAnalyzerServicePure.ts`. Extract `SkillAnalyzerJobStatus` to `shared/types/skillAnalyzerJob.ts`; same pattern.

Each ships as its own small Phase 5 PR (§2.6 — one PR per §8.4 tail item). Together they close the residual leaf-rule gap that §6.1 deliberately scoped out.

### §8.5A Phase 5A verification (mandatory — programme blocker)

Phase 5A is the mandatory half of Phase 5. The programme is not declared complete until both of these PRs land:

| Subsection | Ship gate |
|---|---|
| §8.1 Rate limiter durability | `server/lib/testRunRateLimit.ts` is DB-backed; `rateLimitBucketCleanupJob` registered; both pure-function test files pass; `npm run build:server` passes. |
| §8.2 Silent-failure path closure | `bash scripts/verify-no-silent-failures.sh` returns clean (no `WARNING` line); `npm run build:server` passes. |

**Server circular-dependency gate (carried from Phase 3).** Phase 5A is also where the server cycle count target drops from "≤ 5" (Phase 3 target) to **0**. See §6.3 and §13.5A — the two schema-leaf tail items (§8.4) are the remaining cycles; they land in Phase 5A if operator elects to close them here, or they are escalated to §14 Deferred Items with the remaining count documented.

### §8.5B Phase 5B verification (optional — backlog)

Phase 5B has no single ship gate. Each subsection's verification is local to its PR. A §8.3 or §8.4 item is "done" when it has either:
- Landed on `main` with passing typecheck, OR
- Appeared in §14 Deferred Items with operator-documented rationale.

The audit-remediation programme as a whole is "complete" when Phase 5A is satisfied and every §8.3/§8.4 item is either landed or formally deferred. See §13 Definition of Done.

---

## §9. Contracts

This spec is mostly mechanical — most fixes invoke or extend existing primitives rather than introduce new data shapes. Two contracts cross boundaries and warrant explicit pinning: the corrective migration's policy shape, and the rate-limit-bucket table.

### §9.1 Canonical RLS policy shape (`migrations/0227`)

**Name:** `canonical_org_isolation_policy_v1`
**Type:** Postgres SQL `CREATE POLICY` statement
**Producer:** `migrations/0227_rls_hardening_corrective.sql` (and any future repair migration)
**Consumer:** Postgres planner; `verify-rls-coverage.sh`; `verify-rls-session-var-canon.sh`
**Required form (verbatim):**

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS <table>_org_isolation ON <table>;

CREATE POLICY <table>_org_isolation ON <table>
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
```

**Rules:**
- Policy name pattern is `<table>_org_isolation`. The gate's reverse check (manifest ↔ policy) matches on the table name part of the `ON <table>` clause; the policy name is conventional.
- `IS NOT NULL` and non-empty guards are present in *both* `USING` and `WITH CHECK`. Omitting them forces the policy expression to rely on `NULL`-comparison semantics — Postgres treats a `NULL` policy result as fail-closed, but the explicit guards avoid that dependency entirely so the policy reads "true OR exclude" rather than "true OR NULL or false".
- Every historical policy name on the table must be DROPped before the canonical `CREATE POLICY` — see the per-table inventory in §4.1. Failing to drop a historical policy leaves it coexisting with the canonical one as a conjunction; the conjunction fails closed when any guard returns NULL but obscures intent.
- Existing-policy `DROP IF EXISTS` precedes `CREATE POLICY` so the migration is idempotent against partially-repaired tables.
- No subaccount-isolation policy is added. Subaccount filtering is a service-layer concern (see §4.1 risk note).
- The migration body has one block per affected table. Blocks are self-contained — no implicit ordering between blocks.

**Nullability and defaults:**
- `current_setting('app.organisation_id', true)` returns `NULL` if unset (the `true` arg is the "missing-OK" flag). The guards explicitly reject that case.
- Empty-string is rejected separately because some adapters serialise unset session vars as `''` rather than `NULL`.

**Worked example (single-table, copy-paste–ready):**

```sql
ALTER TABLE memory_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_review_queue FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_review_queue_org_isolation ON memory_review_queue;

CREATE POLICY memory_review_queue_org_isolation ON memory_review_queue
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
```

### §9.2 `rate_limit_buckets` table (Phase 5 §8.1 migration)

**Name:** `rate_limit_buckets`
**Type:** Postgres table; system-scoped (no `organisation_id`)
**Producer:** `server/services/rateLimitStoreService.ts` (Phase 5 §8.1 — the new shared sliding-window primitive). The store's `incrementBucket(key, windowStart)` function is the single write surface; no other caller writes directly.
**Consumers (callers of the store):**
- `server/lib/testRunRateLimit.ts` — wraps `rateLimitStoreService` for `is_test_run` test agent runs (callers: `agents.ts`, `skills.ts`, `subaccountAgents.ts`, `subaccountSkills.ts`).
- `server/routes/public/formSubmission.ts` — replaces inline `Map`-based `checkRateLimit` / `rateLimitMiddleware`.
- `server/routes/public/pageTracking.ts` — replaces inline `Map`-based `checkTrackRateLimit`.
- `server/jobs/rateLimitBucketCleanupJob.ts` — hourly cleanup; performs `DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '1 hour'` and does not read or update other rows.

**Schema:**

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `bucket_key` | `text` | NOT NULL, PK part 1 | Composite of (route, identifier, limit-window-name). Producer normalises; consumer reads opaque. |
| `window_start` | `timestamptz` | NOT NULL, PK part 2 | Bucket boundary, truncated to the minute. |
| `count` | `integer` | NOT NULL DEFAULT 0 | Accumulated request count for this bucket. |

**Indexes:** `(bucket_key, window_start)` (PK); `(window_start)` for cleanup.

**RLS posture:** intentionally not tenant-scoped. The rate limiter operates on public-form keys before authentication is established; tenancy is not yet known. Documented inline in the migration. NOT added to `RLS_PROTECTED_TABLES` (see §4.1 manifest rule); failure to add is intentional and the rationale is in the migration header.

**Example row:**

```
bucket_key       | window_start              | count
form-A:1.2.3.4   | 2026-04-25T10:23:00.000Z  | 14
```

**Cleanup posture:** rows with `window_start < now() - interval '1 hour'` are deleted by `rateLimitBucketCleanupJob` on an hourly cron. The retention is generous to allow for replay-style debugging; tighten only if the table grows beyond comfort.

### §9.3 Action-call allowlist (existing — `server/lib/workflow/actionCallAllowlist.ts`)

**Name:** `ACTION_CALL_ALLOWED_SLUGS`
**Type:** TypeScript `ReadonlySet<string>` (the existing populated form)
**Producer:** Manual edits to `server/lib/workflow/actionCallAllowlist.ts`. Currently 32 slugs as of spec authoring time.
**Consumers:**
- `server/lib/workflow/validator.ts` — imports the set; rejects `action_call` workflow steps whose `actionSlug` is not in the set.
- `scripts/verify-action-call-allowlist.sh` — verifies every slug in the set resolves to a registered handler in `server/config/actionRegistry.ts` or `server/services/skillExecutor.ts`. Phase 2 §5.1 corrects the gate's hard-coded path so it reads the canonical file.
- `server/lib/workflow/__tests__/actionCallAllowlistPure.test.ts` — pure unit test covering set size + resolvability.

**Existing shape (do NOT change in this spec — Phase 2 §5.1 only updates the gate's path):**

```ts
export const ACTION_CALL_ALLOWED_SLUGS: ReadonlySet<string> = new Set([
  'slug_1',
  'slug_2',
  // … 30 more
]);

export function isActionCallAllowed(slug: string): boolean {
  return ACTION_CALL_ALLOWED_SLUGS.has(slug);
}
```

Every entry in the set must resolve to a registered handler in `server/config/actionRegistry.ts` or `server/services/skillExecutor.ts`. Adding a slug requires bumping the size assertion in `actionCallAllowlistPure.test.ts` — the test is a guard against accidental drift.

The gate checks the exported binding's identifier (`ACTION_CALL_ALLOWED_SLUGS`) — renaming the export, or restructuring it back to a `readonly string[]`, requires updating the gate's slug-extraction regex.

---

## §10. Testing posture

This spec ships against the framing in `docs/spec-context.md`:

```yaml
testing_posture: static_gates_primary
runtime_tests: pure_function_only
frontend_tests: none_for_now
api_contract_tests: none_for_now
e2e_tests_of_own_app: none_for_now
```

Every phase's verification terminates in a named gate. New runtime tests are added only for pure functions exposed by this spec's refactors (e.g. agent-handoff-depth check in §8.4, run-cost-test-run-exclusion in §8.4, sliding-window math in §8.1). No vitest/jest/playwright/supertest expansion is introduced.

### §10.1 Tests that ARE added

| Spec section | Test file | Type | What it asserts |
|---|---|---|---|
| §8.1 | `server/services/__tests__/rateLimitStoreService.test.ts` | Pure-function | Sliding-window math on the shared primitive: bucket increment, window-sum read, expiry cutoff. Inject an in-memory mock for the DB handle. |
| §8.1 | `server/lib/__tests__/testRunRateLimit.test.ts` | Pure-function | Wrapper-semantics: `testRunRateLimit` correctly delegates to `rateLimitStoreService` for the `is_test_run` use case (key shape, threshold, behavior on limit). |
| §8.4 (P3-M8) | `server/services/__tests__/agentRunHandoffService.handoffDepth.test.ts` | Pure-function | Depth check rejects > 5; accepts ≤ 5; produces correct error shape. |
| §8.4 (P3-M9) | Same file (additional `describe` block) | Pure-function | Degraded fallback: when active-lead resolution returns no row, the resolver picks the documented fallback path. |
| §8.4 (P3-L9) | `server/lib/__tests__/runCostBreaker.testRunExclusion.test.ts` | Pure-function | `is_test_run = true` rows are excluded from the cost-ledger sum. |

### §10.2 Tests that are NOT added

The following test categories are explicitly *not* added by this spec, per `docs/spec-context.md`:

- No new `vitest`/`jest` integration tests of HTTP routes.
- No new `supertest` API contract tests.
- No new frontend (React) component tests.
- No new Playwright/E2E flows.
- No DB-against-live-Postgres integration tests beyond what already exists in `server/services/__tests__/rls.context-propagation.test.ts` (which the framework already runs as the canonical Layer-B integration harness).

If the implementer believes a finding *requires* a test category from the not-added list, escalate to the operator before proceeding — that would be a framing deviation per `docs/spec-authoring-checklist.md` §9.

### §10.3 Existing tests that MUST continue to pass

Any code touched by this spec re-runs its co-located test file. The minimum set:

```bash
npx tsx server/services/__tests__/agentExecutionServicePure.checkpoint.test.ts  # §6.1 — type extraction
npx tsx server/services/__tests__/rls.context-propagation.test.ts               # §4 — RLS isolation
# §4.2 — any test colocated with the agentRunVisibility / agentRunEditPermissionMask logic must continue to pass.
# Find the exact paths at implementation time, then run each directly with `npx tsx <path>`:
#   find server/ -name 'agentRunVisibility*.test.ts'
```

**Test-runner convention.** Per the repo's pure-function-test posture, individual tests are run directly with `npx tsx <test-file-path>` — `scripts/run-all-unit-tests.sh` ignores `--` filter arguments and runs every discovered test. Use direct paths in spec verification steps so the documented commands are executable as written.

Any failure in the above set blocks the corresponding phase's PR. There is no "test was already flaky" defence — flakiness is a separate finding that should already be in the backlog or surfaced as one.

---

## §11. Observability and runbook

### §11.1 What changes in observability

This spec's primary goal is not to add observability — it is to lock invariants. However, three subsections add or affect observable signals:

| Section | Signal | Where it shows up |
|---|---|---|
| §4.1 (corrective migration) | Postgres logs may show "permission denied for relation" if a write path lacks `withOrgTx` after the new `WITH CHECK` enforcement lands. | Postgres server log + structured-log rethrow at the calling service. |
| §5.3 (`llmRouter.countTokens`) | New `llm_requests` rows for token-counting calls. Cost dashboard will show a small line item under `featureTag: 'reference_document_token_count'` (or whatever tag the implementer chooses). | `SystemPnlPage` (existing). |
| §8.1 (rate-limit-buckets) | DB rows under `rate_limit_buckets`; cleanup job runs hourly. | pg-boss admin (existing). |

No new alerts, dashboards, or metrics are introduced. The framing is `static_gates_primary` — observability for the Phase 1 invariants is the gate set, not a runtime monitoring surface.

### §11.2 Runbook — what to do if a phase's ship gate stays red

**Phase 1:**
- If `verify-rls-coverage` is red after migration 0227 applies, check that the migration ran (look for the entry in `_migrations` system table). Re-run the migration locally and re-check.
- If `verify-rls-contract-compliance` is red after the route refactors, the most likely cause is a `db` import that was missed by the grep — search `import.*from.*db/index.js` across `server/routes/` and `server/lib/` to enumerate.
- If `verify-rls-session-var-canon` is still red after Phase 1E's baseline update, the baseline file list is missing an entry. Compare the violation set to the baseline allowlist; add any historical-baselined-but-uncovered files.

**Phase 2:**
- If `verify-no-direct-adapter-calls` reports a *new* violation that wasn't in the audit (i.e. some other code added an adapter import while Phase 2 was in flight), fix the new violation in the same PR — drift is the normal state of pre-production codebases and the gate's job is to catch it.
- If `verify-skill-read-paths` shows the count moved but is still off, the count diff names the missing entries; mirror the suggested fix per entry.

**Phase 3:**
- If `madge --circular` count rises after the type extraction, the most likely cause is a service file that was importing through `middleware/types` but not via the re-export path — check `server/services/middleware/types.ts` re-exports the four types, and that no service file imports directly from the new `shared/types/` location *and* from `middleware/types` (would create a phantom re-import).

**Phase 4:**
- If `npm install` fails with a peer-dep warning after adding the four production deps, run `npm ls <dep>` for each new dep and resolve any peer-dep mismatches. The pre-existing `@tiptap/pm` situation (depcheck false positive) is unrelated and should not be touched.

**Phase 5A:**
- If `verify-no-silent-failures` stays `WARNING` after the fix pass, re-run the gate with `--verbose` (or the modified-gate approach in §8.2) to surface the exact file. A WARNING that the fix pass introduced means a `catch` block added during the fix itself swallows the error — rethrow or add a log line.
- **Rate limiter rollback.** If the DB-backed rate limiter (§8.1) causes a production regression after merging (e.g. DB connection exhaustion from bucket writes, or degraded form-submission latency), revert to the in-memory fallback via an environment-variable toggle without reverting the PR:
  1. Set `USE_DB_RATE_LIMITER=false` in the production environment (or `.env`).
  2. `server/services/rateLimitStoreService.ts` MUST check this env flag at startup and return a no-op in-memory shim when it is `false`. The shim preserves the same function signatures so callers need no change.
  3. Restart the workers. The in-memory limiter resumes immediately; the DB table accumulates no new rows but is not dropped (flip the flag back to re-enable without a migration).
  4. Document the toggle in the migration header comment so operators can find it under incident pressure.
  The env-flag shim is part of the §8.1 deliverable — it ships alongside the DB implementation, not as a separate follow-up.

**Phase 5B:**
- Each subsection's PR carries its own failure mode; treat them in isolation.

### §11.3 Rollback

Per `rollout_model: commit_and_revert`, every PR is independently revertible. If a phase ships and produces a runtime regression that cannot be hot-fixed inside an hour, revert the merge commit. Migration `0227` (Phase 1) and the Phase 5 §8.1 rate-limit-buckets migration are the only changes that need extra care:

- **Reverting `0227`** requires either (a) a new migration that re-adds the broken state (defeats the purpose), or (b) a manual `psql` session that re-`DROP` the canonical policies and re-`CREATE` the original ones from the source files. Option (b) is what the operator should do if `0227` needs to be rolled back; document the steps in the rollback runbook before merging Phase 1.
- **Reverting the Phase 5 rate-limit-buckets migration** is straightforward: drop the new table; revert the file changes that consumed it. The rate-limit data is best-effort by nature, so loss of the table's contents has no durable impact.

---

## §12. File inventory

This is the single source of truth for every file the spec touches. Any file referenced in prose above must appear in one of the tables below; if a future edit adds a file to prose, it must be cascaded here in the same edit (per `docs/spec-authoring-checklist.md` §2).

### §12.1 Files to create

| File | Phase | Purpose |
|---|---|---|
| `migrations/0227_rls_hardening_corrective.sql` | 1A | FORCE RLS + canonical policy on 8 tables across 6 historical migrations. Phase 1 ships first, so `0227` is the only pre-allocated migration number in this spec. |
| `migrations/<NNNN>_rate_limit_buckets.sql` | 5 (§8.1) | New `rate_limit_buckets` table for multi-process-safe sliding window. Number assigned at merge time per §2.5. |
| `migrations/<NNNN>_drop_tool_calls_log.sql` (conditional) | 5 (§8.4 — P3-M6) | Drop deprecated `agent_run_snapshots.toolCallsLog` column. Skipped if Sprint 3B owns the removal. Number assigned at merge time per §2.5. |
| `server/services/briefVisibilityService.ts` | 1B (§4.2) | Service-tier home for DB-touching logic moved out of `server/lib/briefVisibility.ts` |
| `server/services/onboardingStateService.ts` | 1B (§4.2) | Service-tier home for DB-touching logic moved out of `server/lib/workflow/onboardingStateHelpers.ts` |
| `server/services/systemAutomationService.ts` | 1B (§4.2) | Service for `systemAutomations` route (admin tier — uses `withAdminConnection`) |
| `server/services/configDocumentService.ts` | 1B (§4.2) | Service for `configDocuments` route handlers (singular-noun naming per repo convention) |
| `server/services/portfolioRollupService.ts` | 1B (§4.2) | Service for `portfolioRollup` route handlers |
| `server/services/automationConnectionMappingService.ts` | 1B (§4.2) | Service for `automationConnectionMappings` route handlers (singular-noun naming) |
| `shared/types/agentExecutionCheckpoint.ts` | 3 (§6.1) | New home for `AgentRunCheckpoint`, `SerialisableMiddlewareContext`, `SerialisablePreToolDecision`, `PreToolDecision` |
| `shared/types/agentRunHandoff.ts` | 5 (§8.4 — schema-leaf tail) | New home for `AgentRunHandoffV1`; extracted from `server/services/agentRunHandoffServicePure.ts` so `server/db/schema/agentRuns.ts` can import from `shared/**` instead. |
| `shared/types/skillAnalyzerJob.ts` | 5 (§8.4 — schema-leaf tail) | New home for `SkillAnalyzerJobStatus`; extracted from `server/services/skillAnalyzerServicePure.ts` so `server/db/schema/skillAnalyzerJobs.ts` can import from `shared/**` instead. |
| `client/src/components/clientpulse/types.ts` | 3 (§6.2.1) | Extracted shared interfaces for `ProposeInterventionModal` ↔ sub-editors |
| `client/src/components/skill-analyzer/types.ts` | 3 (§6.2.2) | Extracted shared interfaces for `SkillAnalyzerWizard` ↔ four step components (kebab-case directory matches the repo) |
| `server/services/rateLimitStoreService.ts` | 5 (§8.1) | New shared sliding-window primitive backing both `testRunRateLimit.ts` and the public-route limiters |
| `server/jobs/rateLimitBucketCleanupJob.ts` | 5 (§8.1) | Hourly cleanup of expired rate-limit-bucket rows |
| `server/services/__tests__/rateLimitStoreService.test.ts` | 5 (§8.1) | Pure-function tests for sliding-window math (mock DB handle) |
| `server/lib/__tests__/testRunRateLimit.test.ts` | 5 (§8.1) | Pure-function tests preserving test-run rate-limit semantics on top of the shared store |
| `server/services/__tests__/agentRunHandoffService.handoffDepth.test.ts` | 5 (§8.4) | Pure-function tests for depth ≤ 5 invariant + degraded-fallback |
| `server/lib/__tests__/runCostBreaker.testRunExclusion.test.ts` | 5 (§8.4) | Pure-function test for `is_test_run = true` cost-ledger exclusion |

### §12.2 Files to modify

| File | Phase | Change |
|---|---|---|
| `server/services/middleware/types.ts` | 3 (§6.1) | Replace `AgentRunCheckpoint`/`SerialisableMiddlewareContext`/`SerialisablePreToolDecision`/`PreToolDecision` definitions with `export type { … } from '../../../shared/types/agentExecutionCheckpoint.js'` re-exports. |
| `server/db/schema/agentRunSnapshots.ts` | 3 (§6.1) | Update import on line 3 from `../../services/middleware/types.js` to `../../../shared/types/agentExecutionCheckpoint.js`. (Phase 5 §8.4 P3-M6 also drops the `toolCallsLog` column declaration here — conditional on Sprint 3B status.) |
| `server/db/schema/agentRuns.ts` | 5 (§8.4 — schema-leaf tail) | Update import on line 3 from `../../services/agentRunHandoffServicePure` to `../../../shared/types/agentRunHandoff.js`. |
| `server/db/schema/skillAnalyzerJobs.ts` | 5 (§8.4 — schema-leaf tail) | Update import on line 15 from `../../services/skillAnalyzerServicePure.js` to `../../../shared/types/skillAnalyzerJob.js`. |
| `server/services/agentRunHandoffServicePure.ts` | 5 (§8.4 — schema-leaf tail) | Replace `AgentRunHandoffV1` definition with `export type { AgentRunHandoffV1 } from '../../shared/types/agentRunHandoff.js'` re-export. |
| `server/services/skillAnalyzerServicePure.ts` | 5 (§8.4 — schema-leaf tail) | Replace `SkillAnalyzerJobStatus` definition with `export type { SkillAnalyzerJobStatus } from '../../shared/types/skillAnalyzerJob.js'` re-export. |
| `server/lib/briefVisibility.ts` | 1B (§4.2) | Strip DB-touching code; retain pure helpers only. |
| `server/lib/workflow/onboardingStateHelpers.ts` | 1B (§4.2) | Strip DB-touching code; retain pure helpers only. |
| `server/routes/memoryReviewQueue.ts` | 1B + 1D (§4.2 + §4.4) | Remove direct `db` import; extend existing `memoryReviewQueueService`. Add `resolveSubaccount(req.params.subaccountId, req.orgId!)` at every handler with the `:subaccountId` param (replaces the inline subaccount check). |
| `server/routes/systemAutomations.ts` | 1B (§4.2) | Remove direct `db` import; call new `systemAutomationService`. |
| `server/routes/subaccountAgents.ts` | 1B (§4.2) | Remove direct `db` import; extend existing `subaccountAgentService` (singular). The existing `resolveSubaccount(...)` calls must be preserved verbatim during the extraction. |
| `server/routes/configDocuments.ts` | 1B (§4.2) | Remove direct `db` import; call new `configDocumentService` (singular). The existing `resolveSubaccount(...)` calls must be preserved. |
| `server/routes/portfolioRollup.ts` | 1B (§4.2) | Remove direct `db` import; call new `portfolioRollupService`. |
| `server/routes/clarifications.ts` | 1B + 1D (§4.2 + §4.4) | Remove direct `db` import; extend existing `clarificationService` (singular). Add `resolveSubaccount(...)` at every handler with the `:subaccountId` param (replaces the inline subaccount check). |
| `server/routes/conversations.ts` | 1B (§4.2) | Remove direct `db` import; extend existing `conversationService` (singular). |
| `server/routes/automationConnectionMappings.ts` | 1B (§4.2) | Remove direct `db` import; call new `automationConnectionMappingService` (singular). The existing `resolveSubaccount(...)` calls must be preserved. |
| `server/routes/webLoginConnections.ts` | 1B (§4.2) | Remove direct `db` import; extend existing `webLoginConnectionService` (singular). The existing `resolveSubaccount(...)` calls must be preserved. |
| `server/routes/systemPnl.ts` | 1B (§4.2) | Remove direct `db` import; extend existing `systemPnlService` (admin tier — uses `withAdminConnection`). |
| `server/routes/automations.ts` | 1B (§4.2) | Remove direct `db` import; extend existing `automationService` (singular). |
| `server/services/documentBundleService.ts` | 1C (§4.3) | Add `eq(table.organisationId, organisationId)` to WHERE clauses on lines 679 and 685 (and the `scheduledTasks` branch immediately after). |
| `server/services/skillStudioService.ts` | 1C (§4.3) | Add `eq(skills.organisationId, organisationId)` to WHERE clauses on lines 168 and 309. |
| `scripts/verify-rls-session-var-canon.sh` | 1E (§4.5) | Implement hard-coded historical-baseline allowlist for 0204–0208 + 0212. |
| `scripts/verify-rls-coverage.sh` | 1E (§4.5) | Implement parallel hard-coded historical-baseline allowlist for the same six files. |
| `scripts/verify-action-call-allowlist.sh` | 2 (§5.1) | Update line 29 `ALLOWLIST_FILE` from `server/lib/playbook/actionCallAllowlist.ts` to `server/lib/workflow/actionCallAllowlist.ts` (the existing canonical file). |
| `server/jobs/measureInterventionOutcomeJob.ts` | 2 (§5.2) | Replace direct `canonicalAccounts` SELECT (lines 213–218) with `canonicalDataService.accountExistsInScope(principal, accountId)` (or existing equivalent). |
| `server/services/llmRouter.ts` | 2 (§5.3) | Add `countTokens` method + re-export `SUPPORTED_MODEL_FAMILIES`/`SupportedModelFamily`. |
| `server/services/referenceDocumentService.ts` | 2 (§5.3) | Replace import from `./providers/anthropicAdapter.js` (line 7) with import from `./llmRouter.js`. Update call-site to pass `context` object. |
| `server/config/actionRegistry.ts` | 2 (§5.4) | Add `import { fromOrgId } from '../services/principal/fromOrgId.js'` and wrap `canonicalDataService` call-sites. (Also Phase 2 §5.5 — add `readPath` to 5 missing action entries.) (Also Phase 5 §8.4 P3-L4 — convert/remove three "auto-gated stubs" comments at lines 1342, 1428, 1577.) |
| `server/services/intelligenceSkillExecutor.ts` | 2 (§5.4) | Add `import type { PrincipalContext }`; thread principal through to `canonicalDataService` calls. |
| `server/services/connectorPollingService.ts` | 2 (§5.4) | Use `fromOrgId(organisationId, subaccountId)` at `canonicalDataService` call-sites. |
| `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts` | 2 (§5.4) | Thread incoming `PrincipalContext` down to `canonicalDataService` calls. |
| `server/routes/webhooks/ghlWebhook.ts` | 2 (§5.4) | Unauthenticated route. After the existing `connectorConfigs` + `canonicalAccounts` lookup resolves `config` and `dbAccount`, call `fromOrgId(config.organisationId, dbAccount.subaccountId ?? undefined)` and thread the resulting principal through every `canonicalDataService` call downstream. Do not reference `req.orgId` — it is not set on this route. |
| `server/services/canonicalDataService.ts` (or adjacent registry) | 2 (§5.6) | Add registry entries for `canonical_flow_definitions` and `canonical_row_subaccount_scopes`. (Re-verify gate before fix.) |
| `client/src/components/clientpulse/ProposeInterventionModal.tsx` | 3 (§6.2.1) | Update interface imports to point at new `types.ts`. |
| `client/src/components/clientpulse/CreateTaskEditor.tsx` | 3 (§6.2.1) | Same. |
| `client/src/components/clientpulse/EmailAuthoringEditor.tsx` | 3 (§6.2.1) | Same. |
| `client/src/components/clientpulse/FireAutomationEditor.tsx` | 3 (§6.2.1) | Same. |
| `client/src/components/clientpulse/OperatorAlertEditor.tsx` | 3 (§6.2.1) | Same. |
| `client/src/components/clientpulse/SendSmsEditor.tsx` | 3 (§6.2.1) | Same. |
| `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx` | 3 (§6.2.2) | Update interface imports to point at new `types.ts`. |
| `client/src/components/skill-analyzer/SkillAnalyzerImportStep.tsx` | 3 (§6.2.2) | Same. |
| `client/src/components/skill-analyzer/SkillAnalyzerExecuteStep.tsx` | 3 (§6.2.2) | Same. |
| `client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx` | 3 (§6.2.2) | Same. |
| `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` | 3 (§6.2.2) | Same. |
| `server/skills/smart_skip_from_website.md` | 4 (§7.1.1) | Visibility flip from `internal` to `basic` (via `apply-skill-visibility.ts`). |
| `server/skills/weekly_digest_gather.md` | 4 (§7.1.1) | Same. |
| `server/skills/workflow_estimate_cost.md` | 4 (§7.1.2) | Add YAML frontmatter block. |
| `server/skills/workflow_propose_save.md` | 4 (§7.1.2) | Same. |
| `server/skills/workflow_read_existing.md` | 4 (§7.1.2) | Same. |
| `server/skills/workflow_simulate.md` | 4 (§7.1.2) | Same. |
| `server/skills/workflow_validate.md` | 4 (§7.1.2) | Same. |
| `package.json` | 4 (§7.2.1) | Add `express-rate-limit`, `zod-to-json-schema`, `docx`, `mammoth` as direct deps. (`yaml` is already declared as a devDependency — no edit needed for §7.2.2.) |
| `docs/integration-reference.md` | 4 (§7.2.2) | Add the integration-block entries for any MCP presets the gate flags as missing (Discord, Twilio, SendGrid, GitHub at spec-authoring time). |
| `package-lock.json` | 4 (§7.2) | Updated by `npm install`; committed alongside `package.json`. |
| `docs/capabilities.md` | 4 (§7.3) | Edit line 1001 — replace "Anthropic-scale distribution" with operator-chosen replacement. **Operator-led only.** |
| `server/lib/testRunRateLimit.ts` | 5 (§8.1) | Rewrite from in-memory to delegate to `rateLimitStoreService`. Preserve exported function signatures. The lib file itself does not import `db` — it imports the service. |
| `server/routes/agents.ts` | 5 (§8.1) | `await` the now-async `checkTestRunRateLimit` call. |
| `server/routes/skills.ts` | 5 (§8.1) | Same. |
| `server/routes/subaccountAgents.ts` | 5 (§8.1) | Same. |
| `server/routes/subaccountSkills.ts` | 5 (§8.1) | Same. |
| `server/routes/public/formSubmission.ts` | 5 (§8.1) | Replace inline `checkRateLimit` + `rateLimitMiddleware` (lines 31, 54) with calls into `rateLimitStoreService`; await the async path. |
| `server/routes/public/pageTracking.ts` | 5 (§8.1) | Replace inline `checkTrackRateLimit` (line 29) with calls into `rateLimitStoreService`; await the async path. |
| `server/jobs/index.ts` | 5 (§8.1) | Register `rateLimitBucketCleanupJob` in the canonical job-export aggregator. |
| `server/services/queueService.ts` | 5 (§8.1) | Register the `rateLimitBucketCleanupJob` worker and its hourly pg-boss cron schedule alongside the existing scheduled jobs. |
| `server/services/executionBudgetResolver.ts` | 5 (§8.3) | Replace `as any` on lines 71–72 with `InferSelectModel<...>` types. |
| `server/services/dlqMonitorService.ts` | 5 (§8.3) | Replace `(boss as any).work(` on line 28 with typed wrapper. |
| `server/jobs/bundleUtilizationJob.ts` | 5 (§8.3) | Replace `as any` on line 125 with derived correct type. |
| `server/services/staleRunCleanupService.ts` | 5 (§8.4 — P3-L3, conditional) | Remove `LEGACY_STALE_THRESHOLD_MS` legacy branch if no production rows have `lastActivityAt IS NULL`. Conditional on operator-confirmed prod query. |
| `client/src/components/agentRunLog/EventRow.tsx` | 5 (§8.4 — P3-L5) | If `SetupConnectionRequest` is consumed externally, move to `shared/types/`; otherwise delete the export. |
| `client/src/components/ScheduleCalendar.tsx` | 5 (§8.4 — P3-L6) | Same disposition for `ScheduleCalendarResponse`. |

### §12.3 Files to delete or retire

None. This spec is additive (new migrations, new services) and surgical (line-edits in routes, services, lib). The only "delete" candidate is the local-export of `SetupConnectionRequest` / `ScheduleCalendarResponse` if the disposition in §8.4 P3-L5/L6 lands on "delete"; that happens inside the same file edit and does not delete a whole file.

### §12.4 Caller-side cascades (no new files; included so the search effort is bounded)

For each new service file in §12.1, run `grep -rn "from.*<oldImport>" server/ client/ shared/` and update every importer. Specifically:

| Old import | New import | Search command |
|---|---|---|
| `from '../../lib/briefVisibility.js'` | `from '../../services/briefVisibilityService.js'` | `grep -rn "briefVisibility" server/ shared/` |
| `from '../lib/workflow/onboardingStateHelpers.js'` | `from '../services/onboardingStateService.js'` (DB parts only) | `grep -rn "onboardingStateHelpers" server/ shared/` |
| `from '../../services/middleware/types.js'` (for `AgentRunCheckpoint` etc.) | Unchanged — middleware/types still re-exports. | n/a |
| `from './providers/anthropicAdapter.js'` (for `countTokens`/`SUPPORTED_MODEL_FAMILIES`) | `from './llmRouter.js'` | `grep -rn "anthropicAdapter" server/services/` |

The PR description for each phase enumerates the resolved cascade so reviewers can confirm the scope was complete.

---

## §13. Definition of done (per phase)

Each phase has a per-phase definition of done. The audit-remediation programme as a whole is "done" when every phase satisfies its DoD or has explicit operator sign-off on a deferred item.

### §13.1 Phase 1 DoD

- [ ] `migrations/0227_rls_hardening_corrective.sql` exists and applies cleanly against a fresh DB.
- [ ] `bash scripts/verify-rls-coverage.sh` returns 0 violations.
- [ ] `bash scripts/verify-rls-contract-compliance.sh` returns 0 violations.
- [ ] `bash scripts/verify-rls-session-var-canon.sh` returns 0 violations (with the historical baseline implemented).
- [ ] `bash scripts/verify-org-scoped-writes.sh` returns 0 violations.
- [ ] `bash scripts/verify-subaccount-resolution.sh` returns 0 violations.
- [ ] `npm run build:server` passes.
- [ ] `npm run test:gates` passes (catches regressions from adjacent gates).
- [ ] `npm test -- rls.context-propagation` passes — RLS three-layer integration test still green.
- [ ] No `db` import in any file under `server/routes/**` or `server/lib/**` (verified by `grep -rn "from.*db/index" server/routes/ server/lib/` returning either zero matches or only matches inside `withAdminConnection()` wrappers).
- [ ] All eight tables in §4.1's table — `memory_review_queue`, `drop_zone_upload_audit`, `onboarding_bundle_configs`, `trust_calibration_state`, `agent_test_fixtures`, `agent_execution_events`, `agent_run_prompts`, `agent_run_llm_payloads` — have `FORCE ROW LEVEL SECURITY` set (verified via `psql` or by re-running the gate).

### §13.2 Phase 2 DoD

- [ ] `bash scripts/verify-action-call-allowlist.sh` returns 0 violations.
- [ ] `bash scripts/verify-canonical-read-interface.sh` returns 0 violations.
- [ ] `bash scripts/verify-no-direct-adapter-calls.sh` returns 0 violations.
- [ ] `bash scripts/verify-principal-context-propagation.sh` returns 0 violations.
- [ ] `bash scripts/verify-skill-read-paths.sh` returns 0 violations (literal-action-entries count matches readPath count).
- [ ] `bash scripts/verify-canonical-dictionary.sh` returns 0 violations.
- [ ] `npm run build:server` passes.
- [ ] `npm run test:gates` passes.
- [ ] No regression in `verify-input-validation` or `verify-permission-scope` warning counts (warning-level is not a blocker but new warnings introduced by this phase must be resolved).
- [ ] `llm_requests` shows new rows for `referenceDocumentService` token-counting calls (manual verification — call the path once and check the table).

### §13.3 Phase 3 DoD

- [ ] `npx madge --circular --extensions ts server/ | wc -l` ≤ 5.
- [ ] `npx madge --circular --extensions ts,tsx client/src/ | wc -l` ≤ 1.
- [ ] `shared/types/agentExecutionCheckpoint.ts` exists and exports `AgentRunCheckpoint`, `SerialisableMiddlewareContext`, `SerialisablePreToolDecision`, `PreToolDecision`.
- [ ] `server/db/schema/agentRunSnapshots.ts` imports only from `drizzle-orm`, `drizzle-orm/pg-core`, sibling schema files, or `shared/**`. No `server/services/**`, `server/lib/**`, or `server/middleware/**` imports. (Note: the broader leaf-rule guarantee for every schema file is NOT in Phase 3 scope — `agentRuns.ts` and `skillAnalyzerJobs.ts` also violate it today; those are tail items in §8.4. The Phase 3 fix is the cascade-driver only.)
- [ ] `npm run build:server` passes.
- [ ] `npm run build:client` passes.
- [ ] `npm test -- agentExecutionServicePure.checkpoint` passes.

### §13.4 Phase 4 DoD

- [ ] `npm run skills:verify-visibility` returns 0 violations.
- [ ] `node scripts/verify-integration-reference.mjs` runs without crashing — the dependency fix unblocks the gate's execution. Any genuine findings the gate then surfaces (i.e. real violations that were hidden by the pre-fix crash) are out of scope for the dependency fix and are triaged in a separate PR per §7.2.2.
- [ ] `npm install` runs cleanly (no missing-dep warnings; no peer-dep warnings introduced by this phase).
- [ ] `package.json` lists `express-rate-limit`, `zod-to-json-schema`, `docx`, `mammoth` under `dependencies` and `yaml` under `devDependencies`.
- [ ] All five `workflow_*` skill files have YAML frontmatter blocks.
- [ ] `docs/capabilities.md:1001` no longer contains "Anthropic" (or any other specific provider name); operator has applied and committed the edit.
- [ ] `npm run build:server && npm run build:client` both pass.

### §13.5 Phase 5 DoD

#### §13.5A Phase 5A DoD (mandatory — programme blocker)

- [ ] `bash scripts/verify-no-silent-failures.sh` returns clean (no `WARNING` line).
- [ ] The Phase 5 §8.1 `rate_limit_buckets` migration (`migrations/<NNNN>_rate_limit_buckets.sql` — number assigned at merge time per §2.5) exists and applies cleanly.
- [ ] `server/lib/testRunRateLimit.ts` is DB-backed; `server/jobs/rateLimitBucketCleanupJob.ts` exists and is registered in pg-boss schedule.
- [ ] `server/services/__tests__/rateLimitStoreService.test.ts` and `server/lib/__tests__/testRunRateLimit.test.ts` exist and pass.
- [ ] `npm run build:server` passes.
- [ ] `npx madge --circular --extensions ts server/` cycle count = **0**. The two schema-leaf tail items (§8.4 — `agentRuns.ts`, `skillAnalyzerJobs.ts`) must either have landed in Phase 5A PRs or appear in §14 Deferred Items with the residual cycle count documented. No new cycles introduced.

#### §13.5B Phase 5B DoD (optional — backlog)

- [ ] All §8.3 type-strengthening edits (M4, M5, L7) have landed — `as any` removed from the named call-sites; OR each appears in §14 Deferred Items with operator sign-off.
- [ ] All §8.4 tail items are either resolved or appear in §14 Deferred Items with operator sign-off.
- [ ] Three remaining pure-function tests from §10.1 exist and pass (`agentRunHandoffService.handoffDepth` — depth-check + degraded-fallback in the same file, `runCostBreaker.testRunExclusion`); OR deferred with operator sign-off.
- [ ] `npm run build:server` passes for any Phase 5B PRs that land.

### §13.6 Programme DoD

The audit-remediation programme as a whole is "done" when:

- All five phase DoDs are satisfied.
- Every audit finding (P3-C1 … P3-L10) is either resolved or appears in §14 Deferred Items.
- A retro entry is added to `KNOWLEDGE.md` summarising what shipped, what deferred, and what changed in the gate baselines.
- `tasks/current-focus.md` is updated to reflect the programme's completion and unblocks feature development.

The operator owns the decision to declare the programme complete.

---

## §14. Deferred items

Items the spec mentions but does NOT ship in this programme. An item is in scope if and only if it is NOT in this list.

- **P3-M3 — `cachedContextOrchestrator.ts` discriminated-union type strengthening.** Seven `as any` sites on `resolveResult.assemblyResult`, `bundleSnapshotIds`, `knownBundleSnapshotIds`. Strengthening requires understanding the full union shape from PR #183. Defer until the next time this file is touched for an unrelated reason; ship the type fix in the same edit. Rationale: the context-load cost of "do it right" outweighs the value of "do it now" in the absence of an active bug.
- **P3-L2 — `server/routes/ghl.ts` Module C OAuth stubs.** Three handler stubs returning hardcoded responses with `TODO: Module C implementation`. These are missing implementation, not cleanup. Defer to whichever sprint owns the GHL OAuth feature. Captured in `tasks/todo.md` under the existing GHL backlog.
- **P3-L3 — `staleRunCleanupService` legacy threshold (CONDITIONAL).** If operator confirms no production `agent_runs` rows have `lastActivityAt IS NULL`, this lands in Phase 5 §8.4. If operator cannot confirm (no prod access during this programme), defer to the next sprint that has prod-data access and re-evaluate.
- **P3-L10 — Prompt prefix caching (`stablePrefix`) coverage verification.** Requires a live Langfuse trace. Out of scope for static-gates posture. Add to the observability backlog as a "verify when next investigating LLM cost".
- **P3-L4 (partial) — `actionRegistry.ts` "auto-gated stubs" comment cleanup.** The comments themselves are removed in Phase 5 §8.4 (line edits). The underlying agents (Support Agent, Ads Management Agent, Email Outreach Agent) are tracked as feature work in `tasks/todo.md` and are NOT shipped by this programme.
- **`verify-input-validation.sh` and `verify-permission-scope.sh` warnings.** Both gates return WARNING but do not name files. Phase 2 §5.7 makes a best-effort pass on whatever the gate's verbose mode names; any remaining warnings remain warnings. Do not treat WARNING as a blocker.
- **Mass `as any` removal across the codebase.** Per `convention_rejections` and surgical-changes principle. Phase 5 §8.3 ships only the four sites explicitly listed; the other ~60 `: any` sites in the audit summary are *not* in scope.
- **New tests in non-pure categories.** `vitest`/`jest`/`playwright`/`supertest` expansion is rejected by framing. Re-evaluate when `docs/spec-context.md` flips `testing_posture`.
- **0192 source-file regex cleanup.** The audit notes that `0192_agent_execution_log.sql` uses `FORCE  ROW LEVEL SECURITY` (double space). The corrective migration §4.1 re-asserts FORCE with single space, satisfying the gate. The historical 0192 source file remains as written — migrations are append-only.
- **Subaccount-isolation policies on the §4.1 tables.** The repaired tables (`memory_review_queue` etc.) get only org-isolation policies, not subaccount-isolation policies. Subaccount filtering remains at the service layer, mirroring the 0213 precedent. If a future programme needs DB-layer subaccount isolation, that work also needs to ensure `app.current_subaccount_id` is set on all relevant request paths first.
- **DB-layer principal-aware scoping for the canonical_* tables.** `architecture.md` notes the P3B target. Phase 2 §5.4's principal-context propagation is the *file-level* gate fix; the underlying DB-layer principal scoping is a separate body of work tracked in the canonical-data-platform roadmap and is NOT in this programme.
- **Sprint 3B `toolCallsLog` removal (CONDITIONAL).** Phase 5 §8.4 ships the column drop only if Sprint 3B is no-longer-active. If 3B is in flight, the removal stays with that sprint. Do not double-ship.

If a finding from `tasks/todo.md § Deferred from codebase audit — 2026-04-25` does not appear above and does not appear in any of §4–§8, that is a spec error — surface it before merging the spec.

---

## §15. Ongoing rules

These rules outlive the programme. They are the durable invariants the programme is locking; future feature work inherits them.

### §15.1 Multi-tenant safety checklist (every new feature)

For every new feature touching tenant data, the implementer answers yes to all five before merge:

- [ ] **Org-scoped at the table level.** Every new table with tenant data has `organisation_id NOT NULL`, an entry in `RLS_PROTECTED_TABLES`, and a canonical org-isolation policy (per §9.1) in the same migration that creates the table.
- [ ] **Org-scoped at the query level.** Every read/write that takes a row by `id` also filters by `organisationId`. Defence-in-depth — never rely on RLS alone.
- [ ] **Service-layer mediated.** No `server/routes/**` or `server/lib/**` file imports `db` directly. Routes call services; services call `withOrgTx` / `withAdminConnection`.
- [ ] **Subaccount-resolved.** Every route with a `:subaccountId` URL parameter calls `resolveSubaccount(req.params.subaccountId, req.orgId!)` before using the ID downstream.
- [ ] **Gates green.** All five RLS gates plus the architectural-contract gates pass for the feature branch before review.

### §15.2 Architectural invariants (never violate)

| Invariant | Enforced by | Violation symptom |
|---|---|---|
| Schema files are leaves — no upward imports | `madge --circular`; this spec's §6.1 root fix | Hundreds of cascade cycles |
| Routes never own DB access | `verify-rls-contract-compliance.sh` | Cross-tenant fail-open under any auth-middleware bug |
| LLM calls go through `llmRouter.routeCall()` | `verify-no-direct-adapter-calls.sh` | Untracked LLM cost; cost-attribution drift |
| Canonical-table reads go through `canonicalDataService` | `verify-canonical-read-interface.sh` | Principal-aware scoping bypassed silently |
| Migrations are append-only | (file-level discipline) | Audit-trail loss; gate-baseline drift |
| `app.organisation_id` is the only canonical org session var | `verify-rls-session-var-canon.sh` | RLS silently fails open |
| `canonicalDataService` is a read-only abstraction — no side effects | (code-review discipline) | Business logic bleeds into the read-interface layer; canonical tables acquire unexpected write paths |
| Editorial law on `docs/capabilities.md` is operator-led | (process discipline) | Marketing-collateral drift; provider-name leakage |

### §15.3 Development discipline

- **Fix root causes, not symptoms.** Phase 1's largest finding (the circular dep) is one import line; the right fix is to extract the type, not to suppress 175 cycles individually. Apply the same posture to future findings.
- **Prefer existing primitives over new abstractions.** Every Phase 1–4 fix invokes existing primitives — `withOrgTx`, `withAdminConnection`, `withPrincipalContext`, `fromOrgId`, `llmRouter`, `canonicalDataService`, `resolveSubaccount`. The §4.2 new service files are pure relocations (DB access moves from routes/lib into the service tier; no new public API). The single new architectural primitive this spec introduces is Phase 5 §8.1's `server/services/rateLimitStoreService.ts` — justified inline in §8.1 against the alternatives (Redis would be a new infrastructure dependency; the existing in-memory `Map<>`-based limiters do not meet the multi-process correctness requirement). New primitives have a high evidentiary bar (per `prefer_existing_primitives_over_new_ones: yes`); every other section of this spec satisfies that bar by extending or reusing the listed primitives.
- **Smallest viable PR per category.** Phase 1 is one PR because the work is causally tied. Phase 5 is multiple PRs because each subsection is independent. The default unit is "smallest reviewable change that closes a single category".
- **Gates are the source of truth.** When in doubt about whether a fix is correct, run the gate. The gate is more accurate than the implementer's mental model — if the gate disagrees with what you're sure is right, the gate is right.
- **No drive-by cleanup.** This spec deliberately separates each finding from adjacent unrelated work. Do not bundle "while I'm in this file, let me also fix X" — that bloats review and introduces blast-radius.

### §15.4 When this spec gets re-opened

Re-open this spec if any of the following happens after the programme ships:

- A new RLS gate is introduced and reports historical-noise the existing baselines do not cover. Treat as a §4.5-style baseline addition.
- A new direct-DB-import slips into `server/routes/**` or `server/lib/**`. Treat as a §4.2-style refactor on the new file.
- A new circular dep root emerges (typically: another schema file imports from `services/`). Treat as a §6.1-style type extraction.
- The framing in `docs/spec-context.md` flips `pre_production: yes` → `no`. Re-evaluate every "deferred" item in §14 — some categories that were "fine to defer pre-prod" may no longer be acceptable.

The programme is a *one-time reset of structural integrity*, not a recurring cycle. After it ships, the durable rule is in §15.1 — every new feature passes the multi-tenant safety checklist before merge, and the gates catch regressions automatically.
