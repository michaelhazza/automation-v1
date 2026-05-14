# System Monitoring Agent — Phase A + Phase 1 + Phase 2 Implementation Plan

**Spec:** `tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md` (v1.3, sections 0–19, finalised).
**Branch:** `claude/add-system-monitoring-BgLlY` (single branch; one PR at the end).
**Predecessor (shipped, do not re-build):** `tasks/builds/system-monitoring-agent/phase-0-spec.md` + `tasks/builds/system-monitoring-agent/implementation-plan.md` (Phase 0 + 0.5, PR #188 — used here as a structural template only).
**Sessions:** 4 (one per slice A → B → C → D), each writes back to `tasks/builds/system-monitoring-agent/progress.md` before ending.

> **Post-implementation refactor note (2026-04-27).** During the Slice A
> migration the prompt template was deferred to a follow-on migration
> (originally 0234, then renumbered 0235 after a skill-seed file took
> 0234). After the build completed, all `system_monitor` seed data
> (system_agent row, system principal user, org-side agents row, 11
> system_skills, master_prompt, write_event enum widening) was relocated
> from migrations 0233/0234/0235/0236 into `scripts/seed.ts` Phase 4 +
> `scripts/lib/systemMonitorSeed.ts`. Migration 0233 retains the schema
> work only; 0234/0235/0236 no longer exist. References below to
> "Slice A migration includes seed rows" / "0234_system_monitor_*" /
> §10.3 read as the original plan; current state is seed.ts.

This plan is a build contract, not a re-review. Where the spec is concrete (schema columns, idempotency keys, heuristic firing conditions, env-var defaults, event-type registry), this plan references the spec section rather than restating. Where the spec hands off to architect (paths, sequencing, sub-decisions), this plan resolves the call.

The spec organises delivery as **four slices A → B → C → D** (§17). This plan preserves that cadence and refines commit-level sequencing within each slice. Slice boundaries are session boundaries; commit ordering inside a slice is graph-of-dependencies.

---

## Table of contents

0. [Concerns for user decision (read first)](#0-concerns-for-user-decision-read-first)
1. [Slice ordering, Phase 0 baseline, and gate timing](#1-slice-ordering-phase-0-baseline-and-gate-timing)
2. [Architect-deferred items resolved here](#2-architect-deferred-items-resolved-here)
3. [Slice A — Foundations (commit-level)](#3-slice-a--foundations-commit-level)
4. [Slice B — Phase 1 + protocol + registry + baselining (commit-level)](#4-slice-b--phase-1--protocol--registry--baselining-commit-level)
5. [Slice C — Phase 2 day-one (commit-level)](#5-slice-c--phase-2-day-one-commit-level)
6. [Slice D — Phase 2.5 expansion + finalisation (commit-level)](#6-slice-d--phase-25-expansion--finalisation-commit-level)
7. [Bug-risk heatmap](#7-bug-risk-heatmap)
8. [Test sequencing](#8-test-sequencing)
9. [What NOT to build on first pass (stub + TODO)](#9-what-not-to-build-on-first-pass-stub--todo)
10. [Open structural concerns](#10-open-structural-concerns)
11. [Programme-end verification and ready-to-build checklist](#11-programme-end-verification-and-ready-to-build-checklist)

---

<!-- Sections appended via Edit in chunked workflow. -->

## 0. Concerns for user decision (read first)

None of these are blocking. They are places where the spec's defaults are defensible but a small upstream choice would simplify the build. Flag them; proceed with spec defaults if no override.

1. **`agents.executionScope` enum widening.** Spec §9.1 names `scope='system'` for the new `system_monitor` agent row. The actual `system_agents.executionScope` column today is `'subaccount' | 'org'` (see `server/db/schema/systemAgents.ts:54`); `agents` itself has only `isSystemManaged` boolean and **no scope column**. Two options:
   - **(a, recommended)** Add `'system'` as a third value to `system_agents.executionScope` enum and seed the `system_monitor` row in `system_agents` with `executionScope='system'`, then create the org-side `agents` row pointing at it via `systemAgentId` — same pattern as Orchestrator and Portfolio Health. This is a one-line `$type` widening + one-line CHECK adjustment in the migration; no Drizzle column add.
   - **(b)** Add a new column `agents.scope text` matching the spec's prose. More invasive (new column, RLS implications, Drizzle re-export) for what is effectively a tag.
   - **Plan default:** option (a). Confirm if option (b) preferred.

2. **`actorRole` propagation in `assertSystemAdminContext` (spec §4.4 architect-deferred).** Spec gives two admission conditions: (A) `ctx.principal.type === 'system'` or (B) `actorRole === 'system_admin'`. Architect must resolve whether `actorRole` is an explicit parameter, an `AsyncLocalStorage` channel, or a route-bound wrapper. Three options:
   - **(a, recommended)** Explicit `actorRole?: string` parameter on the guard, plumbed from `req.user.role` at the route adapter. Already matches the existing `requireSystemAdmin` middleware contract — `req.user.role` is set in `server/middleware/auth.ts`. Requires every route handler that calls a `system_incidents` mutation service method to pass `{ actorRole: req.user.role }` through. Mechanical, type-safe, greppable, no AsyncLocalStorage gotchas (re-entrancy / leak risk).
   - **(b)** AsyncLocalStorage channel. The route middleware sets `als.run({ actorRole }, next)`; the guard reads from ALS. Less plumbing at call sites, more failure modes (any code path that escapes the ALS scope — promise chain that returns to a setTimeout, queued job spawned mid-request — sees no role).
   - **(c)** Thin per-route wrapper that pre-binds the role at the route boundary, e.g. `withSysadminRole(req, async () => systemIncidentService.resolveIncident(ctx, id))`. Verbose but unambiguous.
   - **Plan default:** option (a) — explicit parameter. Confirm.

3. **Heuristic registry path (spec §6.1 architect-deferred).** Spec names `server/services/systemMonitor/heuristics/` as illustrative, says "final path TBD by architect." Codebase convention for service-layer feature folders is `server/services/<featureName>/`. The plan adopts the spec's illustrative path verbatim. Confirm or override.

4. **Per-heuristic-module test placement (spec §14.1).** Spec lists positive + negative tests "per Heuristic module". Two placement options:
   - **(a, recommended)** Co-locate test next to module: `server/services/systemMonitor/heuristics/agentQuality/emptyOutputBaselineAware.ts` + `emptyOutputBaselineAwarePure.test.ts` in the same folder. Matches `*Pure.test.ts` convention enforced by `verify-pure-helper-convention.sh`.
   - **(b)** Centralised under `server/services/__tests__/heuristics.*.test.ts` per the spec's illustrative listing.
   - **Plan default:** option (a). Heuristics are pure functions of `(ctx, candidate)`; co-location makes "did anyone write a test for this heuristic?" greppable. Confirm.

5. **`system_monitor_baselines.entity_change_marker` column type (spec §4.5 + §7.6).** Spec lists it as `text` with examples `prompt_hash`, `model`, `version`. Plan uses `text` to match the spec; confirms operators should not depend on it being structured. Phase 3 may upgrade to `jsonb` for multi-attribute markers; not built now.

6. **System-managed agent skill binding mechanism (spec §9.4).** The codebase has `system_agents.defaultSystemSkillSlugs jsonb` (see `server/db/schema/systemAgents.ts:32`) — system skills the system agent always carries. Plan wires the 11 day-one skills via this column on the `system_monitor` system_agents seed row; the `agents`-side row inherits at runtime. The CI gate (Slice C) reads from `system_agents.defaultSystemSkillSlugs` for the `system_monitor` slug and asserts every slug is registered as `destructiveHint: false`. Confirm or specify alternate binding (e.g. a dedicated `agent_skill_bindings` table — not currently present).

7. **`incidentIngestor` wrapper sequencing (spec §4.1, §4.2).** Spec mandates throttle runs first, then idempotency, then DB write. Current `recordIncident` (`server/services/incidentIngestor.ts:85`) goes straight to `ingestInline` / `enqueueIngest`. Plan adds the two new layers as the first two checks inside `recordIncident` before `isAsyncMode()` branch. The async-worker path (`incidentIngestorAsyncWorker.ts`) does **not** re-apply throttle (per spec §4.2 — anything queued is processed); it does call into the same idempotency LRU on the worker-side write to catch the rare case where the queue replays a payload. Confirm.

8. **Whether to backfill existing Phase 0/0.5 `system_incidents` rows.** Per §11.1 "no backfill" — existing incidents from before this spec ships have NULL `agent_diagnosis` / `investigate_prompt` / `prompt_was_useful`. The plan respects this. The list-endpoint `?diagnosis=` filter query (§10.5) returns those rows under `awaiting` (severity ≥ medium) or `not-triaged` (low / self-check / rate-limited) according to the §10.5 mapping — so they appear normally, not orphaned. Confirm acceptable.

9. **Heuristic-purity CI gate scope (spec §17.3 deliverable 8).** Plan implements as a grep-based gate that scans `server/services/systemMonitor/heuristics/**/*.ts` for `.insert(` / `.update(` / `.delete(` Drizzle calls. Type imports (`import type { ... }`) and tests under `__tests__/` are excluded. The corresponding event-registry gate scans for `event_type:\s*['"]` outside the canonical TypeScript union file. Both follow §5 of `DEVELOPMENT_GUIDELINES.md` (CRLF stripping, `import type` skipping, calibration constant enumeration). Confirm gate locations under `scripts/verify-heuristic-purity.sh` and `scripts/verify-event-type-registry.sh`.

10. **Phase 2.5 baseline storage (spec §0.5 architect-deferred — "whether the Phase 2.5 baseline storage table merges with an existing analytics table or stands alone").** Plan keeps `system_monitor_baselines` standalone per §4.5 — no existing analytics table covers per-`(entity_kind, entity_id, metric_name)` rolling stats. Phase 3 may unify with whatever metrics surface ships then. Confirm.

11. **pg-boss queue concurrency settings (spec §0.5 architect-deferred — "Final pg-boss queue concurrency and rate-limit settings").** Plan sets:
    - `system-monitor-synthetic-checks`: `teamSize: 1, teamConcurrency: 1` (singleton tick, matches existing `system-monitor-self-check` precedent at `server/services/queueService.ts:1099`).
    - `system-monitor-baseline-refresh`: `teamSize: 1, teamConcurrency: 1`.
    - `system-monitor-sweep`: `teamSize: 1, teamConcurrency: 1`.
    - `system-monitor-triage`: `teamSize: 4, teamConcurrency: 4` — multiple incidents may triage in parallel; concurrency bounded by per-fingerprint rate limit and singleton key per `incidentId`.
    - All four use pg-boss's default retry policy (3 retries, exponential backoff) — inherited from `system-monitor-self-check` and the post-merge B2 standard.

    Confirm or override per-queue.

12. **React component hierarchy for triage drawer additions (spec §0.5 architect-deferred).** Plan keeps the four new components flat under `client/src/components/system-incidents/` (matching existing `IncidentDetailDrawer.tsx`, `ResolveModal.tsx`, etc. layout from PR #188), no new sub-folder. Each component is self-contained and consumes the existing `system_incident:updated` WebSocket channel — no new context provider. Confirm.

Proceed with plan defaults on all twelve unless overridden.

---

## 1. Slice ordering, Phase 0 baseline, and gate timing

### 1.1 Slice cadence (one session per slice)

Per spec §17 the build is staged across four sessions on a single branch, one PR at the end. The slice order is fixed (A → B → C → D); each slice ends with a `progress.md` handoff entry per §15.2.

| Slice | Estimated effort | Session content | Handoff trigger |
|---|---|---|---|
| **A — Foundations** | ~1 day | One commit set: schema migration + system principal + `assertSystemAdminContext` + idempotency LRU + per-fp throttle + agent row seed. | Verification gate row "A" passes (per spec §15.3). |
| **B — Phase 1 + protocol + registry + baselining** | ~3 days, possibly two sessions | Investigate-Fix Protocol doc + CLAUDE.md hook + heuristic registry skeleton (empty array) + baselining service + 7 day-one synthetic checks + new pg-boss tick handlers. | Gate row "B" passes. |
| **C — Phase 2 day-one** | ~5 days, almost certainly two sessions | 11 read+write skills + 14 day-one heuristics + triage handler + sweep handler + rate-limit logic + 4 UI components + feedback mutation + `?diagnosis=` filter + 2 new CI gates. | Gate row "C" passes. |
| **D — Phase 2.5 + finalisation** | ~2-3 days | 9 Phase 2.5 heuristic modules + additional baseline metrics + staging smoke checklist file + architecture.md / capabilities.md updates + final pre-PR pass. | Gate row "D" + pre-PR command set + smoke checklist. PR opened. |

If a session's context utilisation crosses ~50–60% (per CLAUDE.md §12) before the slice completes, the executor writes a partial-slice handoff and ends the session early. The slice is resumed in a fresh session — never compacted mid-slice.

### 1.2 Phase 0 baseline and pre-existing fixes

Per the architect playbook gate-timing rule, gates run **twice total** for this build: once at the start (Phase 0 baseline) and once at the end (programme-end verification). Anywhere in between is forbidden — chunk-level verification uses only `npm run build:server` plus targeted unit tests.

**Phase 0 baseline (must run before Slice A starts):**

```bash
npm run test:gates
```

Capture the current violation set. Three outcomes are possible:

1. **All gates green** (most likely given the recently-merged audit-remediation programme — branch tip is `645f0a72` which includes PR #211 + PR #202). Proceed directly to Slice A.

2. **Pre-existing violations that block planned work.** A violation in the touched surface area (e.g. an existing `system_incidents` mutation that fails `assertSystemAdminContext`-style guard once the new guard lands; an existing system-managed handler that fails `verify-principal-context-propagation.sh` once Slice A introduces `withSystemPrincipal`) must be fixed as **Slice A commit 0** — the first commit before Slice A's foundations work. Re-run only the affected gate after the fix; confirm green; then start Slice A proper.

3. **Pre-existing violations that do NOT block planned work.** Documented in §1.4 below as "known baseline violations" — the implementer ignores them for the rest of the build. They are not the implementer's burden.

**Pre-existing violations expected to be relevant to this build (predictions, confirm against baseline):**

| Violation candidate | Why this build might interact | Expected resolution |
|---|---|---|
| `verify-principal-context-propagation.sh` flagging the existing `systemMonitorSelfCheckJob` for not being wrapped in a principal context | Slice A introduces `withSystemPrincipal`; the gate may already (or soon) require system-managed handlers to wrap | If flagged, fix in Slice A commit 0 by wrapping the existing handler in `withSystemPrincipal` (same primitive Slice A introduces) |
| `verify-rls-protected-tables.sh` flagging `system_monitor_*` tables not yet in either `RLS_PROTECTED_TABLES` or `rls-not-applicable-allowlist.txt` | Slice A creates these two tables; the gate runs at programme-end against the final state | n/a — Slice A's migration adds them to the allowlist in the same commit. Not a baseline issue. |
| `verify-background-jobs-readiness.sh` flagging missing top-of-file Concurrency / Idempotency model declarations on existing `system-monitor-self-check` | Slice A does not modify this file; if pre-existing, fix in Slice A commit 0 | If flagged, add the B2-standard JSDoc block to `server/jobs/systemMonitorSelfCheckJob.ts` as part of commit 0 (one-file edit). |

The executor must capture the actual baseline output verbatim in `progress.md` after the Phase 0 run, listing every violation file + line + gate name + decision (fix-in-commit-0 vs ignored-for-this-build).

### 1.3 Per-chunk verification (during slices)

Per the architect playbook: forbidden mid-build are `scripts/verify-*.sh` of any kind, full `npm run test:gates`, full `npm test` runs, and any "regression sanity check" gate run. Permitted per-chunk verification is:

- `npm run build:server` (fast typecheck) — after every meaningful TypeScript change.
- `npm run build:client` — after every Slice C / Slice D client change.
- Targeted unit tests via `npx tsx <path-to-test-file>` for tests added in the chunk.
- `bash scripts/run-all-unit-tests.sh` if a chunk's correctness invariant is broad enough that a focused single-file run is insufficient.

If a chunk's correctness depends on a gate-level invariant, the chunk ships a targeted unit test for that invariant inside the chunk — not a gate run.

### 1.4 Known baseline violations (filled in after Phase 0 baseline run)

```text
[populate after Phase 0 baseline run; format:
  - <gate-name>: <file:line> — <one-line summary> — DECISION: ignored (not in build scope) | fixed-in-Slice-A-commit-0
]
```

This list is the permanent record of "violations that pre-existed this build". They are not the implementer's burden for Slices A–D.

### 1.5 Auto-commit posture

Per CLAUDE.md and `progress.md` §"Constraints carried forward": the auto-commit override during spec authoring was scoped to spec authoring only. **Implementation reverts to standard CLAUDE.md no-auto-commit rule** — the user commits explicitly after reviewing changes at end of each slice. Review agents (`spec-conformance`, `pr-reviewer`) run their own auto-commit logic when invoked; they are not affected.

The PR is opened only after Slice D completes and the user has reviewed the cumulative diff.

---

## 2. Architect-deferred items resolved here

The spec's §0.5 "decisions deferred to architect" list plus every inline `architect resolves` reference. Each row is the resolution this plan makes. Subsequent sections honour these as binding decisions.

| Spec ref | Question | Resolution in this plan | Slice |
|---|---|---|---|
| §0.5 | Exact file paths for new server modules | Adopt the spec's illustrative paths verbatim (`server/services/principal/systemPrincipal.ts`, `server/services/systemMonitor/heuristics/`, etc.) — see §0 concerns 3 + 4. Final `index.ts` collects under `server/services/systemMonitor/heuristics/`. | A, B, C, D |
| §0.5 | Migration sequencing | Single migration file per slice, numbered at write time via `ls migrations/ \| sort -n \| tail -1`. Currently the latest is `0232_gin_index_conversation_artefacts.sql`; Slice A claims `0233`. Slice C may need a second migration if it adds the `agent_diagnosis_run_id` FK to `agent_runs` (TBD inside Slice A — see §3.1 below; the plan currently lands the FK in the Slice A migration). Slices B and D are no-migration. | A (and possibly C) |
| §0.5 | Phase 2.5 baseline storage placement | Standalone `system_monitor_baselines` table per §4.5 — see §0 concern 10. | B |
| §0.5 | pg-boss queue concurrency / rate-limit | Per §0 concern 11 — singleton ticks for synthetic / sweep / baseline-refresh; `teamSize: 4` for triage. | B, C |
| §0.5 | React component hierarchy | Flat under `client/src/components/system-incidents/` per §0 concern 12. | C |
| §4.4 | `actorRole` propagation mechanism | Explicit parameter on the guard, plumbed from `req.user.role` at the route adapter. See §0 concern 2. | A |
| §6.1 | Heuristic registry path | `server/services/systemMonitor/heuristics/` per §0 concern 3. | B |
| §6.4 | Whether to unify synthetic-checks with heuristic registry | Two separate registries (per spec §6.4 ("default is two registries")). Synthetic check files stay under `server/services/systemMonitor/synthetic/`; heuristic files under `server/services/systemMonitor/heuristics/`. | B |
| §7.3 | Per-tick aggregate query strategy | Single multi-aggregate per source table (per spec §7.3 "optimisation is an architect decision"). The refresh job emits one query per `entity_kind`, returning rows for every `(entity_id, metric_name)` in a single round-trip. Drizzle's batch-fetch / raw `db.execute` covers this. | B |
| §9.1 | Skill binding mechanism for `system_monitor` | Via `system_agents.defaultSystemSkillSlugs` jsonb column (existing primitive at `server/db/schema/systemAgents.ts:32`) — see §0 concern 6. | C |
| §9.4 | Skill registration mechanism | Each skill is a TypeScript module under `server/services/systemMonitor/skills/`; registered in the existing system-skills registry (whatever `defaultSystemSkillSlugs` consumes — same pattern Orchestrator and Portfolio Health use). | C |
| §10.1 | Drawer subcomponent layout | Three new components inserted in vertical order (Diagnosis annotation, Investigate-prompt block, Feedback widget) into the existing `IncidentDetailDrawer.tsx` from PR #188. No new wrapper context. | C |
| §13 | Per-slice file inventory (refined) | Per §3 / §4 / §5 / §6 of this plan. | A, B, C, D |
| §17.3 | CI gates for Slice C (heuristic-purity + event-registry) | `scripts/verify-heuristic-purity.sh` + `scripts/verify-event-type-registry.sh`. Both grep-based, both honour the §5 DEVELOPMENT_GUIDELINES.md gate-authoring rules. Wired into `npm run test:gates` per the existing `scripts/run-all-gates.sh` pattern. | C |

---

## 3. Slice A — Foundations (commit-level)

**Goal.** Land the substrate Slices B, C, D depend on. No user-visible change. All artefacts are dead-code-by-design until later slices wire them up. Spec §17.1.

**Estimated effort.** ~1 day, single session.

### 3.1 Refined commit order within Slice A

| # | Commit | Files | Prerequisite |
|---|---|---|---|
| 0 | (Conditional) Pre-existing-violation fixes per §1.2 — only if Phase 0 baseline flagged blocking violations | TBD per baseline | none |
| 1 | Schema migration `0233_phase_a_foundations.sql` + Drizzle schema files for the two new tables + new columns on `system_incidents` + `rls-not-applicable-allowlist.txt` registration | per §3.2 | commit 0 |
| 2 | `SystemPrincipal` type + `getSystemPrincipal()` + `withSystemPrincipal()` AsyncLocalStorage wiring | per §3.3 | commit 1 |
| 3 | `assertSystemAdminContext` guard + `UnauthorizedSystemAccessError` typed error | per §3.4 | commit 2 |
| 4 | Wire `assertSystemAdminContext` into existing `systemIncidentService` mutations | per §3.5 | commit 3 |
| 5 | Idempotency LRU + per-fingerprint throttle + `recordIncident` wrapper sequencing | per §3.6 | commit 1 (parallel with 2-4) |
| 6 | `system_monitor` `system_agents` row seed + `agents` org-side row seed (in same migration as commit 1, or separate seed migration if Slice A grew too large — plan default: same migration) | folded into commit 1 | commit 1 |

**Why this order:** schema first (foundation), principal next (prereq for guard), guard wired into existing mutations (defence-in-depth lands as last step before its consumers exist), idempotency / throttle independent of principal work (parallelisable in a single-developer session by interleaving). Commit 5 can land in parallel with 2-4 because the wrapper sequencing on `recordIncident` does not depend on the principal context being available.

**Single-PR-on-end-of-build implication.** Each commit above is a stand-alone reviewable unit, but they all live on the same branch. The PR opened after Slice D contains all of them. Per spec §2.4, this is the accepted trade-off.

**Migration number reservation.** Latest migration on `main` at branch tip is `0232_gin_index_conversation_artefacts.sql`. Slice A claims `0233`. If a later migration lands on `main` before Slice D's PR opens, the executor renames `0233_*` to the next free slot at PR-open time per `DEVELOPMENT_GUIDELINES.md §6.2`.

### 3.2 Files to create / modify — schema + migration (commit 1)

| Path | Purpose | Notes |
|---|---|---|
| `migrations/0233_phase_a_foundations.sql` | Single migration covering all of §4.5 + system principal seed + agent row seed + event-type enum extension. Forward-only, with a `.down.sql` mate per `phase-0-spec.md §6.3`. | Contents listed in §3.2.1 below. |
| `migrations/0233_phase_a_foundations.down.sql` | Local revert mate. Drops the two new tables, drops the new columns on `system_incidents`. Leaves the system principal row + system_monitor agent row in place (per §4.6 rollback note). | |
| `server/db/schema/systemMonitorBaselines.ts` | Drizzle table definition for `system_monitor_baselines` — exports `systemMonitorBaselines` and types. Header comment: `BYPASSES RLS — every reader MUST be sysadmin-gated at the route/service layer`. | New file. |
| `server/db/schema/systemMonitorHeuristicFires.ts` | Drizzle table definition for `system_monitor_heuristic_fires`. Same header comment. | New file. |
| `server/db/schema/systemIncidents.ts` | Add new columns per §4.5 — `investigateProtocolPrompt` text, `agentDiagnosis` jsonb, `agentDiagnosisRunId` uuid (FK), `promptWasUseful` boolean, `promptFeedbackText` text, `triageAttemptCount` integer, `lastTriageAttemptAt` timestamp, `sweepEvidenceRunIds` uuid[]. | Edit. |
| `server/db/schema/index.ts` | Re-export the two new schema files. | 2-line edit. |
| `scripts/rls-not-applicable-allowlist.txt` | Add two entries: `system_monitor_baselines [ref: phase-A-1-2-spec.md §4.3]` and `system_monitor_heuristic_fires [ref: phase-A-1-2-spec.md §4.3]` per the entry-format rules. | Edit. |

#### 3.2.1 Migration contents (verbatim ordering)

1. `ALTER TABLE system_incidents ADD COLUMN investigate_prompt text;`
2. `ALTER TABLE system_incidents ADD COLUMN agent_diagnosis jsonb;`
3. `ALTER TABLE system_incidents ADD COLUMN agent_diagnosis_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL;`
4. `ALTER TABLE system_incidents ADD COLUMN prompt_was_useful boolean;`
5. `ALTER TABLE system_incidents ADD COLUMN prompt_feedback_text text;`
6. `ALTER TABLE system_incidents ADD COLUMN triage_attempt_count integer NOT NULL DEFAULT 0;`
7. `ALTER TABLE system_incidents ADD COLUMN last_triage_attempt_at timestamptz;`
8. `ALTER TABLE system_incidents ADD COLUMN sweep_evidence_run_ids uuid[] NOT NULL DEFAULT '{}';`
9. `CREATE TABLE system_monitor_baselines (...)` per §4.5 with unique index on `(entity_kind, entity_id, metric_name)` and `entity_change_marker text` per §7.6.
10. `CREATE TABLE system_monitor_heuristic_fires (...)` per §4.5.
11. New event-type enum values appended (per §12.1 — `agent_diagnosis_added`, `agent_triage_skipped`, `agent_triage_failed`, `agent_auto_escalated`, `agent_escalation_blocked`, `prompt_generated`, `investigate_prompt_outcome`, `synthetic_check_fired`). Implementation: the `system_incident_events.event_type` column is `text` today (not a Postgres ENUM — confirm from `0224_system_incidents.sql`) so the migration **adds nothing to a DB-level enum**; the TypeScript union in `shared/types/systemIncidentEvent.ts` (or whichever file Slice C creates per architect resolution §17.3) is the source of truth.
12. `INSERT INTO system_agents (slug, name, master_prompt, default_system_skill_slugs, execution_scope, status, ...) VALUES ('system_monitor', 'System Monitor', '<full §9.7 prompt template>', '[]'::jsonb, 'system', 'active', ...) ON CONFLICT (slug) DO NOTHING;` — per §0 concern 1, `executionScope` = `'system'` (new enum value, see commit 1 sub-task in §3.2.2 below).
13. `INSERT INTO agents (organisation_id, system_agent_id, is_system_managed, name, slug, master_prompt, ...) VALUES (SYSTEM_OPERATIONS_ORG_ID, '<system_monitor system_agents.id>', true, 'System Monitor', 'system_monitor', '', ...) ON CONFLICT DO NOTHING;` — the org-side row that subaccountAgents bind to.
14. `INSERT INTO users (id, organisation_id, email, password_hash, first_name, last_name, role, status) VALUES ('<SYSTEM_PRINCIPAL_USER_ID>', SYSTEM_OPERATIONS_ORG_ID, 'system@platform.local', '<random-non-functional-hash>', 'System', 'Principal', 'system_admin', 'active') ON CONFLICT (id) DO NOTHING;` — per §4.3, §4.6 step 6.

#### 3.2.2 `executionScope='system'` enum widening (sub-task within commit 1)

Per §0 concern 1 default (option a), the `system_agents.executionScope` `$type` widens from `'subaccount' | 'org'` to `'subaccount' | 'org' | 'system'`. Mechanically:

- `server/db/schema/systemAgents.ts:54` — change `$type<'subaccount' | 'org'>()` to `$type<'subaccount' | 'org' | 'system'>()`. One-line edit.
- The DB-side has no CHECK constraint on this column (verified — see migration 0157 / 0068 which use `text` without enum), so no `ALTER TABLE` needed. The migration's INSERT uses `'system'` as the literal value; the DB accepts.
- If a CHECK exists (re-verify at write time), the migration adds the new value via `ALTER TABLE system_agents DROP CONSTRAINT <check-name>; ALTER TABLE system_agents ADD CONSTRAINT <check-name> CHECK (execution_scope IN ('subaccount', 'org', 'system'));`.

#### 3.2.3 Sentinel UUIDs

`SYSTEM_PRINCIPAL_USER_ID` and `SYSTEM_OPERATIONS_ORG_ID` are sentinel UUIDs that must be deterministic across environments. Two options:

- **(a, recommended)** Hard-code them as constants in `server/services/principal/systemPrincipal.ts` as `const SYSTEM_PRINCIPAL_USER_ID = '00000000-0000-0000-0000-000000000001';` and `const SYSTEM_OPERATIONS_ORG_ID = (read at boot from organisations WHERE is_system_org = true)` — same pattern as `systemOperationsOrgResolver.ts`.
- **(b)** Generate at migration time and read back. Less deterministic; requires the principal module to query.

Plan default: option (a) for the user UUID (sentinel), option (b) for the org UUID (already cached by the existing `systemOperationsOrgResolver` per `server/services/systemOperationsOrgResolver.ts:14`). The system principal module imports the org resolver — no new query path.

### 3.3 Files to create — system principal (commit 2)

| Path | Purpose | Contract |
|---|---|---|
| `server/services/principal/types.ts` | **Edit** — extend the existing `PrincipalContext` discriminated union to add `SystemPrincipal`. | See §3.3.1 below. |
| `server/services/principal/systemPrincipal.ts` | New — `getSystemPrincipal()` returns a singleton; `withSystemPrincipal(fn)` sets AsyncLocalStorage scope. | See §3.3.2 below. |

#### 3.3.1 `SystemPrincipal` type contract (extends existing union at `server/services/principal/types.ts:30`)

```ts
export interface SystemPrincipal {
  type: 'system';
  id: string;                   // sentinel SYSTEM_PRINCIPAL_USER_ID
  organisationId: string;       // SYSTEM_OPERATIONS_ORG_ID, resolved at boot
  subaccountId: null;
  teamIds: [];                  // immutable empty
  isSystemPrincipal: true;
}

export type PrincipalContext =
  | UserPrincipal
  | ServicePrincipal
  | DelegatedPrincipal
  | SystemPrincipal;
```

#### 3.3.2 `systemPrincipal.ts` contract

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SystemPrincipal, PrincipalContext } from './types.js';
import { resolveSystemOpsContext } from '../systemOperationsOrgResolver.js';

const SYSTEM_PRINCIPAL_USER_ID = '00000000-0000-0000-0000-000000000001';

let cachedSystemPrincipal: SystemPrincipal | null = null;

/** Returns the immutable singleton system principal. Resolves SYSTEM_OPERATIONS_ORG_ID lazily. */
export async function getSystemPrincipal(): Promise<SystemPrincipal> {
  if (cachedSystemPrincipal) return cachedSystemPrincipal;
  const { organisationId } = await resolveSystemOpsContext();
  cachedSystemPrincipal = {
    type: 'system',
    id: SYSTEM_PRINCIPAL_USER_ID,
    organisationId,
    subaccountId: null,
    teamIds: [],
    isSystemPrincipal: true,
  };
  return cachedSystemPrincipal;
}

const als = new AsyncLocalStorage<{ principal: PrincipalContext }>();

/** Wraps a function so principal context is available via getCurrentPrincipal(). */
export async function withSystemPrincipal<T>(fn: (ctx: { principal: SystemPrincipal }) => Promise<T>): Promise<T> {
  const principal = await getSystemPrincipal();
  return als.run({ principal }, () => fn({ principal }));
}

/** Reads the current principal from ALS. Returns null if outside any scope. */
export function getCurrentPrincipal(): PrincipalContext | null {
  return als.getStore()?.principal ?? null;
}

/** Test-only: reset the cache. Production no-op. */
export function __resetForTest(): void {
  if (process.env.NODE_ENV !== 'test') return;
  cachedSystemPrincipal = null;
}
```

**Cross-tenant access pattern (per spec §4.3 — invariant).** The `system_monitor` sweep handler uses `withAdminConnectionGuarded({ allowRlsBypass: true, source: 'system_monitor_sweep', reason: '<one-sentence>' }, fn)` for cross-tenant reads. The system principal is the **identity** signal (audit, logs, service-guard); the admin-bypass is the **authorization** signal (DB access). They are **not** interchangeable — see §4.3 invariant. The plan does NOT introduce any `'system'` branch in `rlsPredicateSqlBuilderPure.ts` (per spec §4.3 line 397).

**Error handling.** `getSystemPrincipal()` propagates the underlying `system_ops_org_missing` error from `resolveSystemOpsContext` if the seed migration has not run. Acceptable — fail-loud at boot if misconfigured. `withSystemPrincipal` does not catch.

### 3.4 Files to create — `assertSystemAdminContext` (commit 3)

| Path | Purpose | Contract |
|---|---|---|
| `server/services/principal/assertSystemAdminContext.ts` | New — guard + typed error. | See §3.4.1. |
| `shared/errorCodes.ts` (or wherever the error-code union lives — verify at write time) | Add `'unauthorized_system_access'` to the union | 1-line edit. |

#### 3.4.1 Guard contract

```ts
import type { PrincipalContext } from './types.js';

export class UnauthorizedSystemAccessError extends Error {
  readonly statusCode = 403;
  readonly code = 'unauthorized_system_access' as const;
  readonly errorCode = 'unauthorized_system_access' as const;  // both shapes for shared/errorCode.ts compat
  constructor(message = 'System administrator access required') {
    super(message);
    this.name = 'UnauthorizedSystemAccessError';
  }
}

interface AssertOpts {
  /** Pulled from req.user.role at the route adapter when a sysadmin user calls a system_incidents mutation. */
  actorRole?: string;
}

/** Asserts the calling principal is admitted as a system admin. Throws on failure. */
export function assertSystemAdminContext(
  ctx: { principal: PrincipalContext } | { principal: null | undefined },
  opts: AssertOpts = {},
): asserts ctx is { principal: PrincipalContext } {
  // Condition A — system principal
  if (ctx.principal?.type === 'system') return;

  // Condition B — sysadmin user
  if (opts.actorRole === 'system_admin') return;

  throw new UnauthorizedSystemAccessError();
}
```

**Why a class with both `code` and `errorCode`.** Per `shared/errorCode.ts` Branch A contract (DEVELOPMENT_GUIDELINES.md §8.19), `getErrorCode` checks both shapes; supporting both keeps the error usable from any consumer. Static literal types let TypeScript narrow consumers.

### 3.5 Files to modify — wire the guard into existing mutations (commit 4)

Per spec §4.4 list, every mutation method on `systemIncidentService.ts` gets the guard as its first executable line. Methods affected (verify against the actual export — `server/services/systemIncidentService.ts:60`):

- `acknowledgeIncident`
- `resolveIncident`
- `suppressFingerprint`
- `unsuppressFingerprint`
- `escalateIncidentToAgent`
- `triggerTestIncident`
- (new in Slice C — `recordPromptFeedback`, `annotateDiagnosis` if added)

Each method gains:
- A leading `actorRole?: string` opt parameter (or principal-context parameter — per §0 concern 2 default).
- A first-line call: `assertSystemAdminContext({ principal: getCurrentPrincipal() }, { actorRole: opts?.actorRole });`.

Read methods (`listIncidents`, `getIncident`) are **not** wired — defence-in-depth is for mutations only per spec §4.4.

**Route layer adapters.** Every existing route in `server/routes/systemIncidents.ts` (Phase 0/0.5) that calls a mutation method passes `{ actorRole: req.user.role }` through. The route's existing `requireSystemAdmin` middleware (Phase 0/0.5) is unchanged — the guard is the second wall.

**Backwards compat.** No existing call site outside `server/routes/systemIncidents.ts` calls these mutation methods today (verified via grep). Once Slice C adds the `recordPromptFeedback` mutation, the same wiring applies.

### 3.6 Files to create / modify — idempotency + throttle (commit 5)

| Path | Purpose | Contract |
|---|---|---|
| `server/services/incidentIngestorIdempotency.ts` | New — process-local LRU + TTL helpers. | See §3.6.1. |
| `server/services/incidentIngestorThrottle.ts` | New — per-fingerprint throttle map. | See §3.6.2. |
| `server/services/incidentIngestor.ts` | **Edit** — wire throttle + idempotency before existing `ingestInline` / `enqueueIngest` branch. Accept new `idempotencyKey?: string` field on `IncidentInput`. | See §3.6.3. |
| `server/services/incidentIngestorPure.ts` | **Edit** — extend `IncidentInput` interface to include `idempotencyKey?: string`. | 1-line edit. |

#### 3.6.1 Idempotency LRU contract

```ts
const TTL_MS = (Number(process.env.SYSTEM_INCIDENT_IDEMPOTENCY_TTL_SECONDS) || 60) * 1000;
const MAX_ENTRIES = 10_000;

interface LRUEntry { addedAt: number; }
const lru = new Map<string, LRUEntry>();

let idempotentHitCount = 0;
let idempotentEvictionCount = 0;

/** Key format: `${fingerprint}:${idempotencyKey}`. Returns true if hit (caller skips DB write). */
export function checkAndRecord(key: string): boolean {
  const now = Date.now();
  // Evict expired entries via age-on-access
  const existing = lru.get(key);
  if (existing) {
    if (now - existing.addedAt < TTL_MS) {
      idempotentHitCount++;
      return true;  // hit
    }
    lru.delete(key);
  }
  // Cap-based eviction: drop the oldest entry if we're at the cap
  if (lru.size >= MAX_ENTRIES) {
    const oldest = lru.keys().next().value;
    if (oldest !== undefined) {
      lru.delete(oldest);
      idempotentEvictionCount++;
    }
  }
  lru.set(key, { addedAt: now });
  return false;
}

export function getIdempotentHitCount(): number { return idempotentHitCount; }
export function getIdempotentEvictionCount(): number { return idempotentEvictionCount; }

export function __resetForTest(): void {
  if (process.env.NODE_ENV !== 'test') return;
  lru.clear();
  idempotentHitCount = 0;
  idempotentEvictionCount = 0;
}
```

#### 3.6.2 Throttle map contract

```ts
const THROTTLE_MS = Number(process.env.SYSTEM_INCIDENT_THROTTLE_MS) || 1000;
const MAX_FINGERPRINTS = 50_000;

const lastSeenByFingerprint = new Map<string, number>();
let throttledCount = 0;
let mapEvictionCount = 0;

/** Returns true if the call is throttled (caller drops). */
export function checkThrottle(fingerprint: string): boolean {
  const now = Date.now();
  const last = lastSeenByFingerprint.get(fingerprint);
  if (last !== undefined && now - last < THROTTLE_MS) {
    throttledCount++;
    return true;  // throttled
  }
  if (lastSeenByFingerprint.size >= MAX_FINGERPRINTS) {
    const oldest = lastSeenByFingerprint.keys().next().value;
    if (oldest !== undefined) {
      lastSeenByFingerprint.delete(oldest);
      mapEvictionCount++;
    }
  }
  lastSeenByFingerprint.set(fingerprint, now);
  return false;
}

export function getThrottledCount(): number { return throttledCount; }
export function getMapEvictionCount(): number { return mapEvictionCount; }

export function __resetForTest(): void {
  if (process.env.NODE_ENV !== 'test') return;
  lastSeenByFingerprint.clear();
  throttledCount = 0;
  mapEvictionCount = 0;
}
```

#### 3.6.3 `incidentIngestor.ts` wrapper sequencing

The new `recordIncident` flow:

```text
recordIncident(input)
  if !isIngestEnabled() → return
  fingerprint = computeFingerprint(input)
  if checkThrottle(fingerprint) → log + return
  if input.idempotencyKey && checkAndRecord(`${fingerprint}:${input.idempotencyKey}`) → log + return
  if isAsyncMode() → enqueueIngest({...input, idempotencyKey})  // worker re-checks LRU
  else → ingestInline(input)
```

Async-worker side (`server/services/incidentIngestorAsyncWorker.ts`) calls `checkAndRecord` again with the same key on the worker side; the LRU is shared within the same process. The throttle is **not** re-applied on the worker per spec §4.2.

### 3.7 Error handling — Slice A

| Failure | Detection | Behaviour |
|---|---|---|
| `getSystemPrincipal()` called before the seed migration ran | `resolveSystemOpsContext` throws `system_ops_org_missing` | Fail-loud at boot. Never silently use a stale principal. |
| `assertSystemAdminContext` thrown from a route handler | Existing global error handler renders 403 with code | Per route convention; no new path needed. `asyncHandler` already catches. |
| `assertSystemAdminContext` thrown from a job handler | Per `system_*` mutation contract | Job rolls back; pg-boss retries up to 3; lands in DLQ on exhaustion; existing DLQ ingest hook fires (incident with `source='job'`). |
| LRU full inside the 60s window | `idempotentEvictionCount` increments | Soft fail per spec §4.7.2. Acceptable degradation. Surfaced via tagged-log-as-metric. |
| Throttle map full (50k unique fps) | `mapEvictionCount` increments | Same posture — soft fail, metric surfaces. |
| `recordIncident` called before `withSystemPrincipal` | n/a — `recordIncident` is fire-and-forget; principal is not required | No behavioural change from Phase 0/0.5. |

### 3.8 Test considerations — Slice A

**Pure unit tests (run via `npx tsx <path>`):**

| Test target | Path | Invariants asserted |
|---|---|---|
| `incidentIngestorIdempotencyPure.test.ts` | `server/services/__tests__/incidentIngestorIdempotencyPure.test.ts` | 100 calls in 1s with same key → 1 record, 99 hits. 2 calls 61s apart → 2 records (TTL respected — use `vi.useFakeTimers()` or `__resetForTest`). LRU eviction at 10,001st key drops oldest, eviction counter increments. Different fingerprints with same key → independent (key is `${fp}:${key}`). |
| `incidentIngestorThrottlePure.test.ts` | `server/services/__tests__/incidentIngestorThrottlePure.test.ts` | 100 calls in 1s with same fp → 1 ingest, 99 throttled. 2 calls 1.1s apart with same fp → 2 ingests. Map eviction at 50,001st unique fp. Cross-fp non-interference. |
| `systemPrincipalPure.test.ts` | `server/services/__tests__/systemPrincipalPure.test.ts` | `getSystemPrincipal()` returns reference-equal singleton. Principal carries `type='system'`, `isSystemPrincipal=true`, no PII. (Mock `resolveSystemOpsContext` to a deterministic UUID.) |
| `assertSystemAdminContextPure.test.ts` | `server/services/__tests__/assertSystemAdminContextPure.test.ts` | Throws for: unauthenticated, regular `role='user'`, `role='manager'`, `role='client_user'`, `role='org_admin'` without opt. Passes for: `type='system'` principal (Condition A); any principal with `actorRole: 'system_admin'` (Condition B). Error has `code='unauthorized_system_access'` and `statusCode=403`. |

**Integration tests (DB-backed, txn-rolled-back at end):**

| Test | Path | What it proves |
|---|---|---|
| `systemPrincipal.integration.test.ts` | `server/services/__tests__/systemPrincipal.integration.test.ts` | `withSystemPrincipal` produces `ctx.principal.type === 'system'` at every downstream call. Cross-tenant SELECT against `agent_runs` returns rows when wrapped in `withAdminConnectionGuarded({ allowRlsBypass: true, source, reason })`, and returns zero rows when attempted without the guard (tenant RLS dispatches on `service\|user\|delegated`). Cross-tenant WRITE without `allowRlsBypass: true` is blocked by `rlsBoundaryGuard`. |
| `idempotencyEndToEnd.integration.test.ts` | `server/services/__tests__/idempotencyEndToEnd.integration.test.ts` | Two `recordIncident` calls with same key + fp → exactly 1 row, 1 event, occurrence count = 1. Same key + different fp → 2 rows. Different key + same fp → 2 occurrences (correct — distinct ops). |
| `throttleEndToEnd.integration.test.ts` | `server/services/__tests__/throttleEndToEnd.integration.test.ts` | 100 fast calls with same fp → 1 row, 99 throttled metric increments. |

**Per-chunk verification commands (NOT gates):**

- `npm run build:server` — must pass after each commit. Catches type errors in the union extension and the wrapper sequencing.
- `npx tsx server/services/__tests__/<the file just added>` — for each test added in this slice.
- No `scripts/verify-*.sh` invocations in this slice. Phase 0 baseline already captured the gate state; programme-end will re-run.

### 3.9 Slice A acceptance criteria (must pass before handoff)

1. Migration `0233_phase_a_foundations.sql` applies cleanly to a fresh dev DB.
2. `users WHERE id = '<SYSTEM_PRINCIPAL_USER_ID>'` returns one row with `role='system_admin'` and the system org's id.
3. `system_agents WHERE slug = 'system_monitor'` returns one row with `executionScope='system'`.
4. `agents WHERE slug = 'system_monitor'` returns one row pointing at the `system_agents` row via `system_agent_id`.
5. `system_monitor_baselines` and `system_monitor_heuristic_fires` exist with their indexes.
6. Both new tables appear in `scripts/rls-not-applicable-allowlist.txt` with `[ref: phase-A-1-2-spec.md §4.3]`.
7. `getSystemPrincipal()` returns a stable singleton across calls; `withSystemPrincipal` AsyncLocalStorage propagates correctly.
8. `assertSystemAdminContext` is the first executable line of every existing `system_incidents` mutation method.
9. `recordIncident` honours throttle → idempotency → DB-write ordering.
10. All pure unit tests + integration tests added in Slice A pass.
11. `npm run build:server` exits 0.
12. Phase 0/0.5 regression: existing `server/services/__tests__/incidentIngestor*.test.ts` tests still pass.

Handoff entry per §15.2 of the spec captures: confirmed migration number, confirmed seed rows landed, confirmed system principal admits via `assertSystemAdminContext` Condition A, the verification command results.

---

## 4. Slice B — Phase 1 + protocol + registry + baselining (commit-level)

**Goal.** Stand up the proactive sink (Phase 1) plus the substrate Slice C consumes — the Investigate-Fix Protocol contract, the heuristic registry skeleton, the baselining read/write API. Spec §17.2.

**Estimated effort.** ~3 days, possibly two sessions if context pressure rises (split mid-slice with a partial handoff per spec §15.2).

### 4.1 Refined commit order within Slice B

| # | Commit | Files | Prerequisite |
|---|---|---|---|
| 1 | Investigate-Fix Protocol doc + CLAUDE.md hook | per §4.2 | Slice A complete |
| 2 | Heuristic registry skeleton (types + empty registry array + phase-filter helper) | per §4.3 | commit 1 |
| 3 | Baselining service — schema-side (Slice A) is already in; this commit adds `baselineReader.ts` + the `system-monitor-baseline-refresh` job + per-source-table aggregate helpers | per §4.4 | commit 2 (registry types reused) |
| 4 | Synthetic-checks engine — `SyntheticCheck` type + tick handler + 7 day-one check modules | per §4.5 | commit 3 (some checks consume baseline) |
| 5 | Wire pg-boss queues — `system-monitor-baseline-refresh` and `system-monitor-synthetic-checks` registered in `queueService.ts` per the existing `system-monitor-self-check` precedent | per §4.6 | commits 3, 4 |

**Why this order.** Doc + hook is independent and safe to land first (zero code dependencies). Registry types underpin both baselining and heuristics; baselining is built next because synthetic checks (commit 4) consume the `BaselineReader`. The pg-boss wiring is last so a half-built tick handler cannot run live.

**No commit 0 in Slice B.** Phase 0 baseline was captured before Slice A; no further gate runs occur until programme-end.

### 4.2 Files to create — Investigate-Fix Protocol doc (commit 1)

| Path | Purpose | Notes |
|---|---|---|
| `docs/investigate-fix-protocol.md` | The protocol contract per spec §5.1, §5.2. Required sections, forbidden content, worked example, iteration-loop note. Long-doc-guard chunked-write protocol applies (file likely >10 KB). | Per §0 of spec, this is the "shared contract" both ends consume. Header carries `# Investigate-Fix Protocol\n\n**Version:** v1`. |
| `CLAUDE.md` | **Edit** — append §5.3 hook section per spec §5.3 verbatim. | Single section addition under a clearly identifiable heading. |

**Long-doc-guard handling for `investigate-fix-protocol.md`.** The protocol doc is likely >10 KB. The chunked-write workflow per CLAUDE.md applies:

1. TodoWrite with one item per major section (Header / Required sections / Forbidden / Worked example / Iteration loop).
2. Single `Write` for the skeleton (header + ToC + headings).
3. `Edit` to append each section, marking todos `in_progress` → `completed`.

The doc is under `docs/` (a human-facing directory), so per CLAUDE.md §13 it is human-facing and uses readable prose, full sentences. No marketing claims.

### 4.3 Files to create — heuristic registry skeleton (commit 2)

| Path | Purpose | Notes |
|---|---|---|
| `server/services/systemMonitor/heuristics/types.ts` | The `Heuristic`, `HeuristicResult`, `HeuristicContext`, `Candidate`, `Evidence`, `BaselineRequirement`, `SuppressionRule`, `EntityKind`, `Severity` types per spec §6.2. | Pure types module — schema files convention does not apply here (this is a service-layer types file, not a Drizzle schema). |
| `server/services/systemMonitor/heuristics/index.ts` | Exports `HEURISTICS: Heuristic[] = []` (empty in Slice B). Exports a `getActiveHeuristics(): Heuristic[]` that filters by `SYSTEM_MONITOR_HEURISTIC_PHASES` env (default `'2.0,2.5'`). | Empty array is intentional — Slice C populates. |
| `server/services/systemMonitor/heuristics/phaseFilter.ts` | Pure helper: `parseHeuristicPhases(env: string \| undefined): Set<'2.0' \| '2.5'>` and `matchesPhase(heuristic: Heuristic, phases: Set<...>)`. | Pure-function shape; testable without DB. |

**Boundary contract enforcement.** Per spec §6.2 "heuristic boundary contract (normative)": heuristics must not mutate DB state, enqueue jobs, or call out to external services. The grep-based CI gate `verify-heuristic-purity.sh` is added in **Slice C** (alongside the heuristics that need enforcement) — not Slice B, because Slice B has zero heuristic modules to scan.

### 4.4 Files to create — baselining service (commit 3)

| Path | Purpose | Notes |
|---|---|---|
| `server/services/systemMonitor/baselines/baselineReader.ts` | Read API per spec §7.5. Read-only; queries `system_monitor_baselines`. Implements `get(...)` and `getOrNull(..., minSampleCount)`. | Hot-path, no caching beyond DB connection-pool query cache. |
| `server/services/systemMonitor/baselines/refreshJobPure.ts` | Pure aggregate helpers: `computeStats(samples: number[]): { count, p50, p95, p99, mean, stddev, min, max }`. | Pure; testable with a known input set. |
| `server/services/systemMonitor/baselines/refreshJob.ts` | The pg-boss handler. Wraps in `withSystemPrincipal`. Per-source-table aggregate query (single multi-aggregate per table per architect resolution §2). UPSERT into `system_monitor_baselines`. Per-entity reset on `entity_change_marker` mismatch per spec §7.6. | Calls `withAdminConnectionGuarded({ allowRlsBypass: true, source: 'system_monitor_baseline_refresh', reason: 'cross-tenant aggregate for system-scoped baseline' })` for the cross-tenant reads against `agent_runs`, `skill_executions`, `connector_polls`, `llm_router_calls` (or post-merge equivalent — confirm at write time). |
| `server/services/systemMonitor/baselines/sourceTableQueries.ts` | One exported function per source table — e.g. `aggregateAgentRuns(adminDb, windowDays)`, `aggregateSkillExecutions(adminDb, windowDays)`, etc. Each returns `Array<{ entity_kind, entity_id, metric_name, samples: number[] }>` (or pre-aggregated stats — per architect resolution). | Read-only against tenant tables; writes only happen in `refreshJob.ts`. |
| `server/jobs/systemMonitorBaselineRefreshJob.ts` | pg-boss handler entry point. Imports `runBaselineRefresh` from the service module. | Same pattern as `systemMonitorSelfCheckJob.ts`. |

**Top-of-file declarations on `systemMonitorBaselineRefreshJob.ts` (B2 standard, per spec §4.8):**

```ts
/**
 * systemMonitorBaselineRefreshJob (queue: system-monitor-baseline-refresh)
 *
 * Concurrency model: pg-boss singletonKey='baseline-refresh' (single-tick-at-a-time)
 *                    + pg_advisory_xact_lock(hashtext('baseline-refresh')::bigint) inside
 *                    the admin transaction. The next tick blocks until the prior commits.
 *   Key/lock space:  global per-process — only one refresh tick runs at a time. Two
 *                    runners with the singleton key collapse at the queue layer; the
 *                    advisory lock is the second wall against same-process race.
 *
 * Idempotency model: replay-safe deterministic recompute — the aggregate query against
 *                    append-only source tables is deterministic at any point in time.
 *                    UPSERT into system_monitor_baselines on the (entity_kind, entity_id,
 *                    metric_name) unique constraint replaces the prior row's stats with
 *                    the recomputed values. Last-write-wins is acceptable because both
 *                    writers compute against the same window per spec §4.9.2.
 *   Failure mode:    a mid-execution crash inside the admin transaction rolls back via
 *                    Drizzle's transaction wrapper — no partial row updates persist.
 *                    pg-boss retries (default 3) per the standard retry policy; after
 *                    exhaustion the job lands in DLQ and the dlq-not-drained synthetic
 *                    check fires.
 */
```

### 4.5 Files to create — synthetic checks (commit 4)

| Path | Purpose |
|---|---|
| `server/services/systemMonitor/synthetic/types.ts` | `SyntheticCheck`, `SyntheticResult` types per spec §8.2. |
| `server/services/systemMonitor/synthetic/index.ts` | Registry array `SYNTHETIC_CHECKS: SyntheticCheck[] = [...]` of all 8 day-one checks. |
| `server/services/systemMonitor/synthetic/pgBossQueueStalled.ts` | Spec §8.2 row 1. |
| `server/services/systemMonitor/synthetic/noAgentRunsInWindow.ts` | Spec §8.2 row 2. |
| `server/services/systemMonitor/synthetic/connectorPollStale.ts` | Spec §8.2 row 3. |
| `server/services/systemMonitor/synthetic/dlqNotDrained.ts` | Spec §8.2 row 4. |
| `server/services/systemMonitor/synthetic/heartbeatSelf.ts` | Spec §8.2 row 5. Two-tick design: writes/reads `last_heartbeat` to/from `system_kv` (existing primitive — verify at write time; if absent, use a process-local `Map` per Phase 0/0.5 precedent in `incidentIngestor.ts`). |
| `server/services/systemMonitor/synthetic/connectorErrorRateElevated.ts` | Spec §8.2 row 6. |
| `server/services/systemMonitor/synthetic/agentRunSuccessRateLow.ts` | Spec §8.2 row 7. Requires baseline; degrades to `fired: false` on `insufficient_data`. |
| `server/services/systemMonitor/synthetic/sweepCoverageDegraded.ts` | Spec §8.2 row 8. Reads `sweep_completed` event series from `system_incident_events` (event-name lives in metadata, not as a column — verify at write time; the spec writes it as a structured log row, not a `system_incident_events` row, per spec §12.1 row "sweep_completed"). The check therefore reads from the appropriate source — TBD inside Slice B based on what Slice B's sweep handler writes. **Slice B does not yet have a sweep handler.** Decision: this check ships as a stub that returns `fired: false` with `reason: 'sweep_handler_not_yet_present'` and is fully wired only after Slice C lands the sweep handler. Acceptable because the threshold is calibrated post-deploy. |
| `server/services/systemMonitor/synthetic/syntheticChecksTickHandler.ts` | The pg-boss handler per spec §8.1 — wraps in `withSystemPrincipal`, iterates `SYNTHETIC_CHECKS`, per-check `try/catch` so one bad check does not break the tick. |
| `server/jobs/systemMonitorSyntheticChecksJob.ts` | pg-boss handler entry point. Imports `runSyntheticChecks` from the service module. Top-of-file B2 declaration block per the pattern above. |

**Note on `sweep-coverage-degraded`.** Spec §8.2 lists this check in the day-one set, but it depends on the sweep handler producing `sweep_completed` events — and the sweep handler is Slice C work. The spec's assumption is that the check ships in Slice B and "wakes up" in Slice C. The plan's resolution: the check ships in Slice B with a guard at the top — `if (no sweep_completed events in the lookback window) { return { fired: false, reason: 'no_sweep_data_yet' }; logger.info(...) }`. Once Slice C lands, the check naturally activates. This avoids a Slice-D-only addition for a check the spec lists in the day-one set.

### 4.6 Files to modify — pg-boss queue registration (commit 5)

| Path | Change |
|---|---|
| `server/services/queueService.ts` | Add three new schedule + work blocks following the `system-monitor-self-check` precedent (`server/services/queueService.ts:1098`) — one for `system-monitor-synthetic-checks` (`* * * * *` every minute), one for `system-monitor-baseline-refresh` (`*/15 * * * *`). The third (sweep + triage) lands in Slice C. |
| `server/services/queueService.ts` | Set `singletonKey` per the §4.8 spec table for both new queues. |

### 4.7 Contracts — Slice B

#### 4.7.1 `Heuristic` interface (per spec §6.2 — verbatim, condensed for the plan)

```ts
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type EntityKind = 'agent_run' | 'job' | 'skill_execution' | 'connector_poll' | 'llm_call';

export interface BaselineRequirement {
  entityKind: EntityKind;
  metric: string;
  minSampleCount: number;       // default 10
}

export interface Evidence {
  // shape per heuristic; opaque to the registry
  [key: string]: unknown;
}

export interface SuppressionRule {
  id: string;
  description: string;
  predicate: (ctx: HeuristicContext, evidence: Evidence) => boolean;
}

export interface Heuristic {
  id: string;
  category: 'agent_quality' | 'skill_execution' | 'infrastructure' | 'systemic';
  phase: '2.0' | '2.5';
  severity: Severity;
  confidence: number;
  expectedFpRate: number;
  requiresBaseline: BaselineRequirement[];
  suppressions: SuppressionRule[];
  firesPerEntityPerHour?: number;
  evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult>;
  describe(evidence: Evidence): string;
}

export interface Candidate {
  entityKind: EntityKind;
  entity: unknown;
}

export type HeuristicResult =
  | { fired: false }
  | { fired: false; reason: 'insufficient_data' | 'suppressed'; suppressionId?: string }
  | { fired: true; evidence: Evidence; confidence: number };

export interface HeuristicContext {
  baselines: BaselineReader;
  db: ReadOnlyDatabase;          // typed to the read-only subset; enforce via lint not types
  logger: Logger;
  now: Date;
}
```

#### 4.7.2 `BaselineReader` interface (per spec §7.5)

```ts
export interface Baseline {
  entityKind: EntityKind;
  entityId: string;
  metric: string;
  windowStart: Date;
  windowEnd: Date;
  sampleCount: number;
  p50: number; p95: number; p99: number;
  mean: number; stddev: number; min: number; max: number;
  entityChangeMarker: string | null;
}

export interface BaselineReader {
  get(entityKind: EntityKind, entityId: string, metric: string): Promise<Baseline | null>;
  getOrNull(entityKind: EntityKind, entityId: string, metric: string, minSampleCount: number): Promise<Baseline | null>;
}
```

#### 4.7.3 Synthetic check types (per spec §8.2)

```ts
export interface SyntheticCheck {
  id: string;
  description: string;
  defaultSeverity: Severity;
  run(ctx: HeuristicContext): Promise<SyntheticResult>;
}

export type SyntheticResult =
  | { fired: false }
  | {
      fired: true;
      severity: Severity;
      resourceKind: string;
      resourceId: string;
      summary: string;
      bucketKey: string;
      metadata: Record<string, unknown>;
    };
```

### 4.8 Error handling — Slice B

| Failure | Detection | Behaviour |
|---|---|---|
| One synthetic check throws inside `run` | Per-check `try/catch` in tick handler | Handler logs `error('synthetic-check-failed', { checkId, err })`; tick continues. Other checks still run. |
| Synthetic-check tick exceeds 30s | pg-boss runtime tracking | Logger warns; next tick is independent. Persistent breach is a signal worth investigating. |
| Baseline refresh aggregate query fails for one entity | Per-entity `try/catch` in the per-source-table loop | `baseline_refresh_failed` event written; other entities continue. The failed entity's existing baseline row stays in place (UPSERT failure leaves prior row intact). |
| Baseline refresh whole-tick failure | pg-boss retry (default 3) | After exhaustion → DLQ → existing DLQ ingest hook fires. Existing baselines unchanged; heuristics keep using stale-but-valid data. |
| `BaselineReader.get` returns null (no row exists yet) | Caller (heuristic) checks | Heuristic returns `{ fired: false, reason: 'insufficient_data' }`. |
| `withSystemPrincipal` not called at handler entry | `assertSystemAdminContext` would throw on first mutation; in Slice B, the synthetic-check tick writes `system_incidents` rows via `recordIncident` — no service-layer guard between handler and `recordIncident` (it is fire-and-forget) — so the guard is the wrapper sequencing inside `recordIncident` (Slice A). | The `verify-principal-context-propagation.sh` gate (run at programme-end) catches the missing wrap statically. |

### 4.9 Test considerations — Slice B

**Pure unit tests:**

| Test target | Path | Invariants asserted |
|---|---|---|
| `phaseFilterPure.test.ts` | `server/services/systemMonitor/heuristics/__tests__/phaseFilterPure.test.ts` | `parseHeuristicPhases('2.0')` → `Set(['2.0'])`. `'2.0,2.5'` → both. Empty / undefined → `Set(['2.0', '2.5'])` (default both). `matchesPhase` returns true/false correctly. |
| `refreshJobPure.test.ts` | `server/services/systemMonitor/baselines/__tests__/refreshJobPure.test.ts` | `computeStats([])` returns `{count: 0, ...}` with NaN/0 fallbacks. Known fixture inputs produce expected p50/p95/p99/mean/stddev/min/max. |
| Each synthetic check (8 modules) | `server/services/systemMonitor/synthetic/__tests__/<checkId>Pure.test.ts` | Positive (condition met → fires with expected severity, fingerprint override format `synthetic:<id>:<kind>:<resourceId>`). Negative (condition not met → `fired: false`). Cold-start (insufficient baseline → `fired: false` + skip log line — no false positive). |

**Integration tests:**

| Test | Path | What it proves |
|---|---|---|
| `syntheticChecks.queueStalled.integration.test.ts` | `server/services/systemMonitor/synthetic/__tests__/syntheticChecks.queueStalled.integration.test.ts` | Pause pg-boss processing for the threshold; tick produces an incident with `source='synthetic'`, fingerprint override per §8.3. Subsequent ticks within the 15-min bucket do not duplicate (idempotency key). |
| `syntheticChecks.coldStart.integration.test.ts` | `server/services/systemMonitor/synthetic/__tests__/syntheticChecks.coldStart.integration.test.ts` | Fresh test DB with no agents / connectors → ticks for 60 minutes (or simulated ticks via injected `now`), zero false-positive incidents written. |
| `syntheticChecks.heartbeat.integration.test.ts` | `server/services/systemMonitor/synthetic/__tests__/syntheticChecks.heartbeat.integration.test.ts` | Tick 1 writes heartbeat. Manually advance clock 3× tick interval. Tick 2 reads stale heartbeat → fires critical incident. `metadata.isSelfCheck = true` set; Slice C's incident-driven trigger excludes it. |
| `baselineRefresh.integration.test.ts` | `server/services/systemMonitor/baselines/__tests__/baselineRefresh.integration.test.ts` | Seed 100 agent_run rows; run refresh; verify `system_monitor_baselines` row created with correct stats. Re-run; row updated, not duplicated. Window cutoff: rows older than 7 days excluded. Entity-change-marker mismatch on `agents.prompt_hash` changing → reset to `sample_count: 0`. |

**Per-chunk verification commands:**

- `npm run build:server` after each commit.
- Targeted `npx tsx <test-file>` for new tests.
- No `scripts/verify-*.sh` runs.

### 4.10 Slice B acceptance criteria

1. `docs/investigate-fix-protocol.md` exists, parses cleanly as markdown, has all required sections from spec §5.2.
2. `CLAUDE.md` has the §5.3 Investigate-Fix Protocol section.
3. `server/services/systemMonitor/heuristics/types.ts` compiles with zero errors; `index.ts` exports an empty `HEURISTICS` array.
4. `BaselineReader` returns `null` for missing rows; `getOrNull` returns `null` when `sample_count < min`.
5. Baseline refresh tick runs end-to-end against dev DB; `system_monitor_baselines` rows populated with correct stats.
6. Synthetic-check tick runs end-to-end; queue-stalled test fires correctly; cold-start produces zero false positives.
7. pg-boss queues `system-monitor-synthetic-checks` and `system-monitor-baseline-refresh` are registered with correct singleton keys.
8. All Slice B pure + integration tests pass.
9. `npm run build:server` exits 0.
10. Phase 0/0.5 + Slice A regression: prior tests still pass.

Handoff entry per §15.2: confirmed protocol doc + hook landed, registry types compile, baseline refresh successful, synthetic checks fire correctly, pg-boss wiring verified.

---

## 5. Slice C — Phase 2 day-one (commit-level)

**Goal.** The actual deliverable. The agent runs end-to-end: triggers, sweep, day-one heuristics, prompt template, validation, rate limiting, UI. Most of the user-visible value lands here. Spec §17.3.

**Estimated effort.** ~5 days, almost certainly two sessions. Split point is described in §5.2 below.

### 5.1 Refined commit order within Slice C

| # | Commit | Files | Prerequisite |
|---|---|---|---|
| 1 | Day-one heuristic modules — all 14 per spec §9.5, each with positive + negative + (where applicable) `requiresBaseline` test | per §5.3 | Slice B complete |
| 2 | Agent skill modules — all 11 read+write skills per spec §9.4 | per §5.4 | commit 1 (skills consume the baseline reader and heuristic-fires audit) |
| 3 | Prompt validation + the agent system-prompt template + the `write_diagnosis` skill's retry-up-to-2 loop | per §5.5 | commit 2 |
| 4 | Triage handler (incident-driven) + the triage enqueue path inside the existing `system_incident_events` `incident_opened` write | per §5.6 | commit 3 |
| 5 | Sweep handler + clustering + the two-pass design + cap handling | per §5.7 | commits 1, 2 (consumes heuristics + skills via the agent it invokes) |
| 6 | Rate-limit logic + auto-escalation past the rate limit | per §5.8 | commit 4 |
| 7 | Wire pg-boss queues `system-monitor-triage` and `system-monitor-sweep` in `queueService.ts`. The `sweep-coverage-degraded` synthetic check (Slice B stub) is now live. | per §5.9 | commits 4, 5 |
| 8 | UI components — `DiagnosisAnnotation`, `InvestigatePromptBlock`, `FeedbackWidget`, `DiagnosisFilterPill` | per §5.10 | commits 6, 7 (so the UI has live data to render) |
| 9 | `recordPromptFeedback` mutation route + the `?diagnosis=...` query param on the list endpoint | per §5.11 | commit 8 (UI consumes both) |
| 10 | Two CI gates land — `verify-heuristic-purity.sh` + `verify-event-type-registry.sh`. Wired into `npm run test:gates` per existing `scripts/run-all-gates.sh` pattern. | per §5.12 | commits 1-9 (gates enforce invariants on completed surface) |

**Why this order.** Heuristics first (foundation); skills second (the agent's hands); prompt template + validation third (the agent's brain); triage handler fourth (lights up incident-driven path); sweep handler fifth (lights up sweep path); rate-limit sixth (the cost guard); pg-boss wiring seventh (queue layer goes live); UI eighth (operator surface depends on live data); mutation route ninth (UI's submit endpoint); CI gates last (enforce the invariants on the completed surface).

### 5.2 Recommended session split

If Slice C runs across two sessions (likely given ~5d effort), split after commit 5 (sweep handler) and before commit 6 (rate-limit). Reasons:

- Commits 1-5 can be smoke-tested in dev with an existing high-severity incident — run end-to-end without rate limiting, verify the agent produces a diagnosis.
- Commits 6-10 are user-facing surface (rate limit, queue wiring, UI, mutation, gates) that benefit from a fresh-context session.
- The split point is a natural progress.md handoff.

If a single session can hold the whole slice without crossing ~50% context utilisation, no split. The executor decides at the time.

### 5.3 Files to create — day-one heuristic modules (commit 1)

14 modules per spec §9.5, distributed across the four category folders. Each module has a co-located `Pure.test.ts` per architect resolution §2 (#4).

**Agent quality (9 modules under `server/services/systemMonitor/heuristics/agentQuality/`):**

| Module | Test invariants |
|---|---|
| `emptyOutputBaselineAware.ts` | Positive: empty output + baseline.p50 > 200 → fires medium. Negative: empty output but baseline.p50 ≤ 200 → no fire. Cold-start: no baseline → `insufficient_data`. |
| `maxTurnsHit.ts` | Positive: `terminated_reason='max_turns'` → fires medium. Negative: `terminated_reason='success'` → no fire. No baseline required. |
| `toolSuccessButFailureLanguage.ts` | Positive: assistant message regex match for "I couldn't" / "I'm unable" / "failed to" / "I don't have access" + run.success → fires medium. Negative: success language → no fire. |
| `runtimeAnomaly.ts` | Positive: `runtime_ms > baseline.p95 * 5 AND runtime_ms > 1000` → fires low. Negative: tiny baseline → no fire (absolute floor). Cold-start: insufficient_data. |
| `tokenAnomaly.ts` | Positive: `(token_input + token_output) > baseline.p95 * 3 AND total > 5000` → fires low. |
| `repeatedSkillInvocation.ts` | Positive: same skill called > 5× in one run AND baseline ≤ 2 → fires low. |
| `finalMessageNotAssistant.ts` | Positive: last message is `tool` or `system` → fires medium. Negative: last is `assistant` → no fire. |
| `outputTruncation.ts` | Positive: final message ends abruptly + length within 10% of model max → fires low. |
| `identicalOutputDifferentInputs.ts` | Positive: two runs of same agent in last hour with identical output bytes despite different inputs → fires medium. |

**Skill execution (3 modules under `server/services/systemMonitor/heuristics/skillExecution/`):**

| Module | Test invariants |
|---|---|
| `toolOutputSchemaMismatch.ts` | Positive: skill output fails its declared schema → fires medium. |
| `skillLatencyAnomaly.ts` | Positive: `runtime_ms > baseline.p95 * 5 AND > 500ms` → fires low. |
| `toolFailedButAgentClaimedSuccess.ts` | Positive: skill returned error + assistant message claims success → fires high. |

**Infrastructure (2 modules under `server/services/systemMonitor/heuristics/infrastructure/`):**

| Module | Test invariants |
|---|---|
| `jobCompletedNoSideEffect.ts` | Positive: pg-boss job completed but expected side effect (per per-job manifest) absent → fires critical. |
| `connectorEmptyResponseRepeated.ts` | Positive: connector empty result ≥ 3× in 1h with baseline median ≥ 1 → fires medium. |

**Registry update.** `server/services/systemMonitor/heuristics/index.ts` now imports each module and includes it in the `HEURISTICS` array.

**Suppression rule examples** (per spec §9.5 examples — each heuristic carries 0-2 suppression rules):

- `emptyOutputBaselineAware` → suppress if `agent.expected_outputs` schema declares an optional output.
- `maxTurnsHit` → suppress if `run.input.metadata.max_turns_acceptable === true`.
- `runtimeAnomaly` → suppress if the run is the first run for a newly-deployed agent version (cold-start — detected via `agents.prompt_hash` having changed in the last hour).

### 5.4 Files to create — agent skill modules (commit 2)

11 skills per spec §9.4 under `server/services/systemMonitor/skills/`. Each skill is a TypeScript module with input/output Zod schemas + handler. Each registers itself with the existing system-skill registry (whatever consumes `system_agents.defaultSystemSkillSlugs` — verify pattern at write time against Orchestrator's skills).

| Skill ID | File | Notes |
|---|---|---|
| `read_incident` | `readIncident.ts` | Reads `system_incidents` row + recent events. |
| `read_agent_run` | `readAgentRun.ts` | Reads via `withAdminConnectionGuarded({ allowRlsBypass: true, source: 'system_monitor_skill_read_agent_run', reason: 'cross-tenant read for system-monitor diagnosis' })`. Caps at 50 messages or 100 KB. |
| `read_skill_execution` | `readSkillExecution.ts` | Same admin-bypass pattern. Caps. |
| `read_recent_runs_for_agent` | `readRecentRunsForAgent.ts` | Same admin-bypass; caps at 20 runs (summary). |
| `read_baseline` | `readBaseline.ts` | Reads `system_monitor_baselines` (no admin-bypass needed — system table). |
| `read_heuristic_fires` | `readHeuristicFires.ts` | Reads `system_monitor_heuristic_fires`; caps at 20. |
| `read_connector_state` | `readConnectorState.ts` | Cross-tenant read via admin-bypass. |
| `read_dlq_recent` | `readDlqRecent.ts` | Reads `pgboss.archive`; caps at 20. |
| `read_logs_for_correlation_id` | `readLogsForCorrelationId.ts` | Caveat: see spec §9.4 — depends on log source. Slice C ships the process-local rolling buffer per Phase 0/0.5 precedent (`incidentIngestor.ts:40`). Caps at 200 lines or 100 KB. |
| `write_diagnosis` | `writeDiagnosis.ts` | Writes `agent_diagnosis`, `agent_diagnosis_run_id`, `investigate_prompt` on the locked-to-incident row. Idempotent on `(incidentId, agentRunId)` per spec §9.8 / §4.8. Includes the prompt-validation retry-up-to-2 loop. |
| `write_event` | `writeEvent.ts` | Appends `system_incident_events` row of allowed types only (`agent_diagnosis_added`, `agent_triage_skipped`, `prompt_generated`). Idempotent on `(incidentId, event_type, agentRunId)`. |

**`destructiveHint: false` on every skill.** The CI gate (commit 10) enforces this by reading the `system_agents.defaultSystemSkillSlugs` for `system_monitor` and verifying every slug resolves to a skill registered with `destructiveHint: false`.

**Tool result size cap.** Each read skill enforces a per-call response cap. The agent's system prompt instructs it to summarise / re-fetch when truncated. Truncation is logged as `skill-result-truncated` per §12.3 logging conventions.

### 5.5 Files to create — prompt validation + system prompt + write_diagnosis retry loop (commit 3)

| Path | Purpose |
|---|---|
| `server/services/systemMonitor/triage/promptValidation.ts` | Validates `investigate_prompt` text per spec §9.8 — required sections present (regex over headings in order), length 200–6,000 chars, no forbidden patterns (`git push`, `merge to main`, `auto-deploy`). Pure helper; testable. |
| `server/services/systemMonitor/triage/agentSystemPrompt.ts` | The agent's stored prompt template per spec §9.7 (verbatim). Lives in code so the migration's INSERT can read it via `import` — avoids embedding a multi-thousand-character literal in SQL. |
| `server/services/systemMonitor/skills/writeDiagnosis.ts` | Implements the retry-up-to-2 loop. On validation failure, throws a typed retry error; the agent's run loop retries up to 2× per spec §9.8. After exhaustion: emit `agent_triage_failed` event with `reason='prompt_validation'`. |

**Migration update needed.** The Slice A migration's INSERT for `system_agents.master_prompt` expects the prompt text. Plan default: Slice A's migration includes a placeholder (`'<TBD by Slice C>'`) and Slice C lands a follow-on migration `0234_system_monitor_prompt_template.sql` that does `UPDATE system_agents SET master_prompt = '<full text>' WHERE slug = 'system_monitor'`. This avoids forcing Slice A to land the long prompt before the protocol doc exists.

Alternative: Slice A's migration directly embeds the prompt. Decision deferred to the executor — both work; the second-migration option keeps Slice A's migration smaller and makes prompt iteration via migration explicit.

### 5.6 Files to create — triage handler (commit 4)

| Path | Purpose |
|---|---|
| `server/services/systemMonitor/triage/triageHandler.ts` | The incident-driven triage handler — admit checks (severity ≥ medium, not self-check, not rate-limited, not disabled), agent-run dispatch, prompt validation, success/failure events. Wraps in `withSystemPrincipal`. |
| `server/jobs/systemMonitorTriageJob.ts` | pg-boss handler entry point. Top-of-file B2 declaration block. |

**Top-of-file declarations on `systemMonitorTriageJob.ts`:**

```ts
/**
 * systemMonitorTriageJob (queue: system-monitor-triage)
 *
 * Concurrency model: pg-boss singletonKey=`triage:${incidentId}` (one triage in flight
 *                    per incident at a time) + pg_advisory_xact_lock(hashtext('triage:'
 *                    + incidentId)::bigint) inside the work transaction.
 *   Key/lock space:  per-incidentId. Two enqueues for the same incident (e.g. sweep +
 *                    incident-driven race) collapse at the queue layer; the advisory
 *                    lock catches same-process race.
 *
 * Idempotency model: composite-key idempotent INSERT inside write_diagnosis: unique on
 *                    (system_incidents.id, agent_diagnosis_run_id). Second call with
 *                    same (incidentId, agentRunId) is a no-op.
 *   Failure mode:    pg-boss retry-up-to-3 on handler throw. Agent-side retry-up-to-2
 *                    on prompt-validation failure inside the handler. After exhaustion,
 *                    agent_triage_failed event is written; the rate-limit counter
 *                    increments to bound future retries. DLQ ingest hook on hard fail.
 */
```

**Outbox-pattern enqueue.** Per spec §9.2 — the `system-monitor-triage(incidentId)` job is enqueued **inside the same transaction** that wrote the `incident_opened` `system_incident_events` row. This requires modifying `server/services/incidentIngestor.ts` (where the event row is written today) to add a transactional `pgboss.send` after the event row insert. Or, more cleanly, modifying the existing `systemIncidentNotifyJob` enqueue path which already runs in the same txn — see `server/services/incidentIngestor.ts:179` (the existing `notifyMilestones` block) for the pattern.

**Plan default:** add a sibling `enqueueTriageIfEligible(tx, incident)` call after the `notify` enqueue in the existing transaction. Conditional gate per spec §9.2: severity ≥ medium AND `source != 'self_check'` AND `metadata.isSelfCheck != true` AND `metadata.isMonitorSelfStuck != true` AND `triage_attempt_count < cap` AND `SYSTEM_MONITOR_ENABLED == true`.

### 5.7 Files to create — sweep handler (commit 5)

| Path | Purpose |
|---|---|
| `server/services/systemMonitor/triage/sweepHandler.ts` | The sweep tick handler — two-pass design, candidate cap, payload cap, clustering, `sweep_capped` event. Wraps in `withSystemPrincipal`. Returns `SweepResult` per spec §9.3. |
| `server/services/systemMonitor/triage/loadCandidates.ts` | Pure-ish helper that loads sweep candidates (agent runs, jobs, skill executions, llm calls) in the rolling 15-min window via `withAdminConnectionGuarded`. Returns summary fields only — no full payloads. |
| `server/services/systemMonitor/triage/clusterFires.ts` | Pure helper: takes `HeuristicFire[]`, groups by `(entityKind, entityId)` per spec §9.3 clustering. Returns `Cluster[]`. |
| `server/services/systemMonitor/triage/selectTopForTriage.ts` | Pure helper: from a list of clusters, returns top-50 by per-fire confidence + payload accumulator that hard-caps at 200 KB. Spec §9.3 cap logic. |
| `server/services/systemMonitor/triage/writeHeuristicFire.ts` | Writes one `system_monitor_heuristic_fires` row. Always called for every evaluation outcome (fired, suppressed, insufficient_data, errored — for audit). |
| `server/jobs/systemMonitorSweepJob.ts` | pg-boss handler entry point. Top-of-file B2 declaration block per spec §4.8. |

**Top-of-file declarations on `systemMonitorSweepJob.ts`:**

```ts
/**
 * systemMonitorSweepJob (queue: system-monitor-sweep)
 *
 * Concurrency model: pg-boss singletonKey=`sweep-tick:${bucketKey}` (15-min bucket) +
 *                    pg_advisory_xact_lock(hashtext('sweep-tick:' + bucketKey)::bigint).
 *                    Slow ticks block the next; the 15-min window overlaps adjacent
 *                    ticks by 10 min so missed candidates re-evaluate.
 *   Key/lock space:  per-15-min-bucket. Heuristic evaluations are read-only against
 *                    candidate rows; no row-level locking needed.
 *
 * Idempotency model: claim+verify per candidate via pg-boss singletonKey on the triage
 *                    enqueue: `sweep:${candidateKind}:${candidateId}:${bucketKey}`. The
 *                    triage job itself is idempotent on (incidentId, agentRunId).
 *   Failure mode:    Per-heuristic try/catch isolates evaluation throws; sweep continues.
 *                    Cap hits (50 candidates / 200 KB) emit `sweep_capped` event; excess
 *                    re-evaluates next tick. Hard handler throw → pg-boss retry; DLQ on
 *                    exhaustion → dlq-not-drained synthetic check fires.
 */
```

### 5.8 Files to create — rate-limit + auto-escalation (commit 6)

| Path | Purpose |
|---|---|
| `server/services/systemMonitor/triage/rateLimit.ts` | `checkRateLimit(incidentId)` reads `triage_attempt_count` + `last_triage_attempt_at` on the incident row, returns `{ allowed: boolean, reason?: 'rate_limited' }`. `incrementAttempt(tx, incidentId)` increments counter + sets `last_triage_attempt_at` inside the existing transaction. Auto-escalation when severity ≥ high AND past rate limit AND incident still open after window expiry — invokes existing `escalateIncidentToAgent` (Phase 0/0.5) with the system-ops sentinel target. |
| `server/services/systemMonitor/triage/autoEscalate.ts` | Pure helper: `shouldAutoEscalate(incident, now): { yes: boolean, reason?: 'guardrail_cap' \| 'cooldown' \| 'subaccount_disabled' }`. Wraps the existing Phase 0/0.5 guardrail logic — does not duplicate; returns the decision shape only. |

### 5.9 Files to modify — pg-boss queue registration (commit 7)

| Path | Change |
|---|---|
| `server/services/queueService.ts` | Add `system-monitor-triage` (no schedule — enqueued by ingestor + sweep handler; `teamSize: 4, teamConcurrency: 4`) and `system-monitor-sweep` (`*/5 * * * *`, `singletonKey: per-bucket`, `teamSize: 1, teamConcurrency: 1`). |

The `sweep-coverage-degraded` synthetic check (Slice B stub) becomes live now because `sweep_completed` events start being written.

### 5.10 Files to create — UI components (commit 8)

| Path | Purpose |
|---|---|
| `client/src/components/system-incidents/DiagnosisAnnotation.tsx` | Renders `agent_diagnosis` JSON per spec §10.3. Empty / not-yet-triaged states per the 5-row mapping. Failure-mode visibility line (red text) when `prompt_validation` failed. |
| `client/src/components/system-incidents/InvestigatePromptBlock.tsx` | Markdown-rendered prompt + copy button per spec §10.2. Reuses existing markdown renderer. No edit-in-place. |
| `client/src/components/system-incidents/FeedbackWidget.tsx` | "Was this useful?" card per spec §10.4. Three radios (`yes` / `no` / `partial`) + optional 2,000-char textarea + Submit / Skip. State machine per spec §10.4. |
| `client/src/components/system-incidents/DiagnosisFilterPill.tsx` | Filter pill per spec §10.5. Four values (`all` / `diagnosed` / `awaiting` / `not-triaged`). ANDs with existing filters. |
| `client/src/components/system-incidents/__tests__/<component>.test.tsx` | One test file per component covering invariants from spec §14.1 client section. |

**Wiring into `IncidentDetailDrawer.tsx` (existing from PR #188):** insert the three drawer-additions in vertical order at the top of the drawer body, above existing metadata. Order: Diagnosis annotation → Investigate-prompt block → (existing metadata) → (existing actions) → Feedback widget (only after resolve).

**Wiring into `SystemIncidentsPage.tsx`:** add the `DiagnosisFilterPill` to the existing filter bar; add `?diagnosis=` to the existing `useQuery` filter set so the URL state survives navigation.

### 5.11 Files to create — feedback mutation + list filter (commit 9)

| Path | Purpose |
|---|---|
| `server/routes/systemIncidentFeedback.ts` | New route file. `POST /api/system/incidents/:id/feedback` with body `{ wasSuccessful: 'yes' \| 'no' \| 'partial', text?: string }`. `requireSystemAdmin` middleware. `asyncHandler`. Calls `systemIncidentService.recordPromptFeedback(ctx, id, body, { actorRole: req.user.role })`. |
| `server/services/systemIncidentService.ts` | **Edit** — add `recordPromptFeedback(ctx, id, body, opts)` method. First line: `assertSystemAdminContext(ctx, opts)`. Validates body. Writes `prompt_was_useful` + `prompt_feedback_text` on the incident row. Appends `investigate_prompt_outcome` event with the metadata shape from spec §11.2. Idempotent on `(incident_id, actor_user_id)` first-wins per spec §10.4 — second submission returns 409. |
| `server/services/systemIncidentService.ts` | **Edit** — `listIncidents` accepts new `diagnosis?: 'all' \| 'diagnosed' \| 'awaiting' \| 'not-triaged'` filter. Maps to SQL conditions per spec §10.5 mapping table. |
| `server/routes/systemIncidents.ts` | **Edit** — extend the list endpoint's Zod schema to accept `?diagnosis=` query param. Pipe through to service. |
| `server/schemas/systemIncidents.ts` | **Edit** — add Zod schema for `recordPromptFeedback` body. |
| `server/routes/__tests__/systemIncidentFeedback.integration.test.ts` | Integration: 200 on first submission with all metadata written; 409 on second submission; 403 for non-sysadmin. |

### 5.12 Files to create — CI gates (commit 10)

| Path | Purpose |
|---|---|
| `scripts/verify-heuristic-purity.sh` | Greps `server/services/systemMonitor/heuristics/**/*.ts` for `.insert(` / `.update(` / `.delete(` Drizzle calls. Excludes `import type` lines and `__tests__/`. Per `DEVELOPMENT_GUIDELINES.md §5`. Self-test fixture under `scripts/__tests__/heuristic-purity/` with one positive (mutation-shaped call → caught) and one negative (read-only `.select(` → not caught). |
| `scripts/verify-event-type-registry.sh` | Greps for `event_type:\s*['"]` outside the canonical TypeScript union file (final path: `shared/types/systemIncidentEvent.ts` per architect resolution §17.3). Honours `import type` skipping per §5. Self-test fixture. |
| `shared/types/systemIncidentEvent.ts` | New file — the single canonical TypeScript union of every `event_type` literal. Imported by every emitter; the gate fails on any other declaration. The file lives under `shared/` per `DEVELOPMENT_GUIDELINES.md §3` (types crossing schema/service boundary). |
| `scripts/run-all-gates.sh` | **Edit** — add the two new gate invocations. |

**Why these gates land in Slice C, not Slice B.** Both gates depend on completed surface — heuristic-purity depends on heuristic modules existing (Slice C commit 1); event-registry depends on every emitter being in place (commits 4-9). Landing them earlier would make them vacuous (nothing to scan) or blocking (incomplete surface).

### 5.13 Contracts — Slice C

#### 5.13.1 `recordPromptFeedback` body schema (Zod)

```ts
import { z } from 'zod';

export const recordPromptFeedbackBody = z.object({
  wasSuccessful: z.enum(['yes', 'no', 'partial']),
  text: z.string().max(2000).optional(),
});

export type RecordPromptFeedbackBody = z.infer<typeof recordPromptFeedbackBody>;
```

#### 5.13.2 `agent_diagnosis` JSON shape (per spec §9.7, §9.8)

```ts
export interface AgentDiagnosisV1 {
  schema_version: 'v1';
  hypothesis: string;             // one paragraph plain English
  evidence: Array<{ type: string; ref: string; summary: string }>;
  confidence: 'low' | 'medium' | 'high';
  generatedAt: string;            // ISO 8601 UTC
  agentRunId: string;             // uuid
}
```

#### 5.13.3 `investigate_prompt_outcome` event metadata (per spec §11.2)

```ts
export interface InvestigatePromptOutcomeMetadata {
  schema_version: 'v1';
  was_successful: 'yes' | 'no' | 'partial';
  text: string | null;
  linked_pr_url: string | null;
  resolved_at: string;            // ISO 8601
  diagnosis_run_id: string;       // uuid
  heuristic_fires: string[];
}
```

#### 5.13.4 `SweepResult` shape (per spec §9.3)

```ts
export interface SweepResult {
  status: 'success' | 'partial_success' | 'failure';
  window: { start: Date; end: Date };
  candidates_evaluated: number;
  heuristics_evaluated: number;
  fired: HeuristicFire[];
  suppressed: HeuristicFire[];
  insufficient_data: HeuristicFire[];
  errored: Array<{ heuristic_id: string; candidate_id: string; err: string }>;
  triages_enqueued: number;
  capped: { excess_count: number; cap_kind: 'candidate' | 'payload' } | null;
  duration_ms: number;
}
```

### 5.14 Error handling — Slice C

| Failure | Detection | Behaviour |
|---|---|---|
| Heuristic `evaluate` throws | Per-heuristic `try/catch` in sweep handler | Sweep continues; `errored` array populated. Logger error with `heuristic_id`. |
| Sweep `loadCandidates` query fails | Handler-level `try/catch` | `SweepResult.status = 'failure'`; pg-boss retries (3); DLQ on exhaustion. |
| Triage agent run hits max-turns | `agent_runs.terminated_reason='max_turns'` post-run check | `agent_triage_failed` event with `reason='agent_run_failed'`; rate-limit counter increments. |
| `write_diagnosis` validation fails | `promptValidation` returns false | Agent retries up to 2; after exhaustion → `agent_triage_failed` event with `reason='prompt_validation'`; UI shows red-text inline failure. |
| Triage timeout > 5 min | Job runtime tracking | `agent_triage_failed` with `reason='timeout'`. Manual-escalate available. |
| Concurrent triage on same incident (sweep + incident race) | pg-boss `singletonKey: incidentId` | Second enqueue collapses; `triage_enqueue_deduplicated` audit. One triage runs. |
| Self-stuck monitor agent (any §9.11 criterion) | Inside triage handler post-run check | `agent_triage_failed` with `reason='self_stuck'`. UI badge. Manual-escalate available. |
| `recordPromptFeedback` second submission | DB unique constraint on `(incident_id, actor_user_id)` | 409 with `{ error: 'feedback-already-submitted' }`. |
| Non-sysadmin caller hits any new mutation | `assertSystemAdminContext` throws | 403 via `asyncHandler`. |

### 5.15 Test considerations — Slice C

**Pure unit tests:**

| Target | Path | Invariants |
|---|---|---|
| Each heuristic (14 modules) | `server/services/systemMonitor/heuristics/<category>/__tests__/<id>Pure.test.ts` | Per spec §14.1 — positive, negative, requiresBaseline cases. |
| `promptValidation` | `server/services/systemMonitor/triage/__tests__/promptValidationPure.test.ts` | Per spec §14.1: rejects missing-section, length-out-of-range, forbidden patterns. Accepts well-formed. |
| `clusterFires` | `server/services/systemMonitor/triage/__tests__/clusterFiresPure.test.ts` | N fires same candidate → 1 cluster; N candidates → N clusters. |
| `selectTopForTriage` | `server/services/systemMonitor/triage/__tests__/selectTopForTriagePure.test.ts` | 100 candidates → top-50 by confidence; payload-cap stop at 200KB; cap_kind correctness. |
| `rateLimit` | `server/services/systemMonitor/triage/__tests__/rateLimitPure.test.ts` | First two attempts allowed, third blocked. Window-expiry resets. Auto-escalation guardrail mapping. |

**Integration tests (per spec §14.2):**

| Test | What it proves |
|---|---|
| `triageJob.incidentDriven.integration.test.ts` | High-severity incident → triage dispatched in same tx as `incident_opened`. Agent run starts. `agent_diagnosis_added` event within 60s. Diagnosis fields populated on `system_incidents` row. |
| `triageJob.sweepDriven.integration.test.ts` | Stage empty-output agent run; sweep tick → `empty-output-baseline-aware` fires; triage dispatched; new incident with `source='sweep'`; diagnosis written. |
| `triageJob.rateLimit.integration.test.ts` | Same fingerprint 3× in 1h → first two triage, third skipped with `agent_triage_skipped` event. After 24h: counter resets. |
| `triageJob.autoEscalate.integration.test.ts` | Critical rate-limited incident after window → auto-escalation event + manual-escalate path invoked + guardrails respected. |
| `triageJob.killSwitch.integration.test.ts` | `SYSTEM_MONITOR_ENABLED=false` → no triage dispatched; pre-dispatched jobs short-circuit with `agent_triage_skipped reason='disabled'`. |
| `sweepJob.cap.integration.test.ts` | Stage 100 candidates → top-50 selected; `sweep_capped` with `excess_count=50`. |
| `incidentFeedback.integration.test.ts` | Resolve agent-diagnosed incident → mutation writes columns + `investigate_prompt_outcome` event. Second submission → 409. Non-sysadmin → 403. |
| `promptValidation.integration.test.ts` | Invalid prompt → write rejected, agent retries, second invalid → `agent_triage_failed` event + drawer shows failure state. |
| `agentSkillSet.integration.test.ts` | The `system_monitor` agent's bound skill set has zero `destructiveHint: true` skills. (CI gate; this is the runtime cross-check.) |
| `rls.systemMonitor.integration.test.ts` | Non-sysadmin (regular, org-admin, subaccount-admin) cannot SELECT `system_monitor_baselines` or `system_monitor_heuristic_fires`; cannot call new mutation routes. |

**Per-chunk verification commands:**

- `npm run build:server` after each commit.
- `npm run build:client` after commit 8 (UI components).
- Targeted `npx tsx <test>` for new tests.
- No `scripts/verify-*.sh` runs in this slice. The two new gates added in commit 10 are wired into `npm run test:gates`; they run at programme-end only.

### 5.16 Slice C acceptance criteria

1. All 14 day-one heuristics fire correctly in dev — positive tests pass, negative tests pass, baseline-gated heuristics return `insufficient_data` cleanly.
2. End-to-end triage from incident-open → triage handler → agent run → `write_diagnosis` → `agent_diagnosis_added` event in DB.
3. End-to-end sweep from cron tick → `loadCandidates` → heuristic eval → cluster → triage enqueue → diagnosis written.
4. Rate limit blocks 3rd attempt; auto-escalation fires for high/critical past rate limit.
5. Kill switch disables both triggers cleanly.
6. UI: drawer renders all five empty/awaiting states; copy button writes to clipboard mock; feedback widget posts and persists.
7. Mutation route returns 200 / 409 / 403 correctly.
8. List filter `?diagnosis=` returns expected subset for each value.
9. Two new CI gates wired into `npm run test:gates`; both pass against the completed surface.
10. All Slice C pure + integration tests pass.
11. `npm run build:server && npm run build:client` exit 0.
12. Phase 0/0.5 + Slice A + Slice B regression: prior tests still pass.

Handoff entry: confirmed each heuristic fires, end-to-end triage works, feedback mutation writes both schema and event, kill switch confirmed, UI smoke ran in dev.

---

## 6. Slice D — Phase 2.5 expansion + finalisation (commit-level)

**Goal.** Layer Phase 2.5 cross-run / systemic heuristics onto the registry. Add the additional baseline metrics they need. Land rollout-readiness work — staging smoke checklist, doc updates, pre-PR pass, PR open. Spec §17.4.

**Estimated effort.** ~2-3 days, typically one session.

### 6.1 Refined commit order within Slice D

| # | Commit | Files | Prerequisite |
|---|---|---|---|
| 1 | Additional baseline metrics — extends the refresh job's per-source-table aggregate to compute the new metrics Phase 2.5 heuristics need | per §6.2 | Slice C complete |
| 2 | Phase 2.5 heuristic modules — all 9 per spec §9.6, each in its own module with metadata + tests, added to `HEURISTICS` array | per §6.3 | commit 1 |
| 3 | Staging smoke checklist file | per §6.4 | commits 1-2 |
| 4 | `architecture.md` System Monitor Active Layer section | per §6.5 | commits 1-2 |
| 5 | `docs/capabilities.md` updated entry | per §6.6 | commit 4 |
| 6 | Pre-PR pass — final commands, smoke checklist tick-off in staging, PR opened. **No new code in this commit.** | per §6.7 + §11 | commits 1-5 |

**Why this order.** Metrics first (heuristics depend on them); heuristics second; docs after (description follows reality); pre-PR last.

### 6.2 Files to modify — additional baseline metrics (commit 1)

The Phase 2.5 heuristics (§9.6) need metrics not produced by Slice B's refresh job:

| Metric | Required by | Source |
|---|---|---|
| `cache_hit_rate` (llm_router) | `cache-hit-rate-degradation` | `llm_router_calls.cache_hit boolean` (verify column name at write time) |
| `success_rate` (agent, skill, connector, job_queue) | `success-rate-degradation-trend` | Computed from terminal-status counts |
| `retry_count` (agent, skill, job_queue) | `retry-rate-increase` | `agent_runs.retry_count` (or summed from event log) |
| `auth_refresh_rate` (connector) | `auth-refresh-spike` | `connector_polls.auth_refreshed_at` series |
| `llm_fallback_count` (llm_router) | `llm-fallback-unexpected` | `llm_router_calls.fallback_invoked` (verify) |
| `output_entropy` (agent, skill) | `output-entropy-collapse` | Computed from `agent_run_messages` token-level Shannon entropy on a sampled subset |
| `tool_selection_distribution` (agent) | `tool-selection-drift` | KL divergence vs baseline distribution; baseline stores the distribution shape |
| `cost_per_outcome` (agent) | `cost-per-outcome-increasing` | `tokens_per_successful_run` derived from `agent_runs` |

| Path | Change |
|---|---|
| `server/services/systemMonitor/baselines/sourceTableQueries.ts` | Extend each `aggregate*` function to return the new metrics. Some metrics are derived (success_rate from terminal-status counts) — landed as helper queries. |
| `server/services/systemMonitor/baselines/refreshJob.ts` | No structural change — the refresh loop iterates whatever metrics `aggregate*` returns. |
| `server/services/systemMonitor/baselines/computeOutputEntropyPure.ts` | New — pure helper for token-level Shannon entropy on a string sample. Tested. |
| `server/services/systemMonitor/baselines/computeKLDivergencePure.ts` | New — pure helper for tool-selection drift. Tested. |
| `server/services/systemMonitor/baselines/__tests__/<helper>Pure.test.ts` | One test file per new pure helper. |

**Sampling note.** Output entropy and tool-selection distribution are expensive on the full `agent_run_messages` table. The refresh job samples up to N=200 runs per agent per refresh tick; entropy is computed on a 1-KB substring per run. This keeps the per-tick cost bounded.

### 6.3 Files to create — Phase 2.5 heuristic modules (commit 2)

9 modules per spec §9.6. Distributed across `infrastructure/` and `systemic/`:

**Infrastructure (5):**

| Module | Path | Test invariants |
|---|---|---|
| `cacheHitRateDegradation.ts` | `server/services/systemMonitor/heuristics/infrastructure/` | Positive: hit rate < `baseline.p50 - 0.20` (absolute drop) → fires low. Cold-start: insufficient_data. |
| `latencyCreep.ts` | same | Positive: 1h p95 > baseline p95 * 1.5 AND > baseline p95 + 500ms → fires low. |
| `retryRateIncrease.ts` | same | Positive: 1h retry rate > baseline.p50 * 2 AND > 10/h → fires medium. |
| `authRefreshSpike.ts` | same | Positive: 1h auth-refresh rate > baseline.p95 * 3 → fires medium. |
| `llmFallbackUnexpected.ts` | same | Positive: 1h fallback count > 10 AND primary baseline 5xx < 0.5% → fires medium. |

**Systemic (4):**

| Module | Path | Test invariants |
|---|---|---|
| `successRateDegradationTrend.ts` | `server/services/systemMonitor/heuristics/systemic/` | Positive: 4h linear-regression slope < -0.05/hour AND last-hour rate < baseline.p50 - 0.10 → fires high. |
| `outputEntropyCollapse.ts` | same | Positive: 1h entropy < baseline.p50 * 0.5 → fires medium. |
| `toolSelectionDrift.ts` | same | Positive: 1h KL divergence > threshold → fires medium. Threshold env-configurable. |
| `costPerOutcomeIncreasing.ts` | same | Positive: 4h tokens-per-successful-run > baseline.p95 * 1.5 → fires low. |

**Each ships with positive + negative + `requiresBaseline` tests.** Co-located `Pure.test.ts` per architect resolution.

**Registry update.** `server/services/systemMonitor/heuristics/index.ts` imports each new module and adds to `HEURISTICS`. Total count after Slice D: 23 (14 day-one + 9 Phase 2.5).

### 6.4 Files to create — staging smoke checklist (commit 3)

| Path | Purpose |
|---|---|
| `tasks/builds/system-monitoring-agent/staging-smoke-checklist.md` | The 10-step manual smoke checklist per spec §14.3, with pass/fail tickboxes and notes column. The executor runs it in staging before opening the PR. |

The 10 steps verbatim from spec §14.3:

1. Phase A smoke — fast retry loop → 1 row, throttle metric
2. Synthetic queue stall → `pg-boss-queue-stalled` fires
3. Synthetic heartbeat → fires after restart; recursion guard prevents auto-triage
4. Phase 2 incident-driven → drawer shows diagnosis + prompt within 60s
5. Phase 2 sweep → soft-fail signal triages within 5 min
6. **Prompt copy-paste — load-bearing manual test** — copy 5 generated prompts to local Claude Code; verify each is actionable without follow-up clarification
7. Feedback widget → outcome event written
8. Rate-limit → first two triage, third skipped
9. Kill switch → no triage; reset → triage resumes
10. Cold-start → 60-min idle staging → zero false positives

### 6.5 Files to modify — `architecture.md` (commit 4)

| Path | Change |
|---|---|
| `architecture.md` | New section: "System Monitor Active Layer" covering: Phase A foundations (system principal + `assertSystemAdminContext` + idempotency LRU + throttle), Phase 1 synthetic checks, Phase 2 monitor agent (triggers, sweep, day-one + 2.5 heuristics, prompt template, validation, rate limiting), Investigate-Fix Protocol cross-reference, baselining primitive cross-reference, kill-switch hierarchy. Add entry to "Key files per domain" table. Add the four new pg-boss queues to the queue inventory. |

Per CLAUDE.md §11 — doc-sync rule. The section lands in the same commit window as the code, not later.

### 6.6 Files to modify — `docs/capabilities.md` (commit 5)

| Path | Change |
|---|---|
| `docs/capabilities.md` | New "Active System Monitoring + Auto-Triage" entry under Support-facing section. Editorial Rules apply per `docs/capabilities.md § Editorial Rules` (vendor-neutral, marketing-ready, model-agnostic). No named LLM providers in customer-facing copy. |

The capability entry describes:
- The system watches every agent run, job, and skill execution.
- Synthetic checks detect silent failures (queue stalls, stale connectors, no-runs windows).
- The system_monitor agent diagnoses incidents and produces investigation prompts the operator pastes into a development environment.
- Operators submit feedback that tunes the diagnostic quality over time.

### 6.7 Pre-PR pass (commit 6 — no new code)

Per §11 below. Run the full pre-PR command set, tick the smoke checklist in staging, open the PR.

### 6.8 Test considerations — Slice D

**Pure unit tests:**

| Target | Path | Invariants |
|---|---|---|
| Each Phase 2.5 heuristic (9 modules) | Co-located `<id>Pure.test.ts` | Positive, negative, requiresBaseline cases. |
| `computeOutputEntropyPure` | `server/services/systemMonitor/baselines/__tests__/computeOutputEntropyPure.test.ts` | Known input strings produce expected entropy values. Empty / single-token inputs handled. |
| `computeKLDivergencePure` | same dir | Two identical distributions → 0. Disjoint distributions → high. Edge-cases handled. |

**Integration tests:**

| Test | What it proves |
|---|---|
| `phase25Heuristics.integration.test.ts` | At least one Phase 2.5 heuristic fires correctly end-to-end against seeded baseline data. |
| `baselineRefresh.phase25Metrics.integration.test.ts` | The new metrics (cache_hit_rate, success_rate, etc.) are produced by the refresh job and stored in `system_monitor_baselines`. |

**Regression:** all Slices A, B, C tests still pass.

**Staging smoke checklist:** all 10 steps tick before PR opens.

### 6.9 Slice D acceptance criteria

1. All 9 Phase 2.5 heuristics fire correctly against seeded baseline data.
2. Additional baseline metrics produced by refresh job; readable via `BaselineReader`.
3. Staging smoke checklist file exists and ticks all 10 steps green in staging.
4. `architecture.md` System Monitor Active Layer section is present, accurate, internally consistent.
5. `docs/capabilities.md` includes the new capability entry; passes Editorial Rules.
6. Pre-PR command set (per §11) all green.
7. PR opened with description summarising the four-slice landing, commit ranges, verification results, smoke checklist results.

Handoff: progress.md final entry switches from "slice handoff" to "spec complete, awaiting user review of PR." Final commit includes the doc updates and the progress.md close-out per the user's instructions.

---

## 7. Bug-risk heatmap

The risks below are the ones a local-correctness implementation will mishandle. Each entry names the failure mode, the test or invariant that catches it, and the mitigation already designed into the spec / plan.

### 7.1 Cross-tenant read leak via system principal (Slices A, B, C)

**Risk.** The `system_monitor` agent's read skills (`read_agent_run`, `read_skill_execution`, etc.) read from tenant tables. If the implementer adds `'system'` to the RLS predicate union in `rlsPredicateSqlBuilderPure.ts` to satisfy the read (the easiest local fix), tenant policies become permissive for system principal — a soft permission expansion that's invisible to operators.

**What could go wrong:** any future code path that constructs a `SystemPrincipal` (e.g. a misrouted handler, a test fixture leaking into production via some mistake) reads tenant data without an explicit admin-bypass declaration. The audit log does not record cross-tenant access because no `withAdminConnectionGuarded` wrapper was used.

**Test shape:**
- Integration test (`systemPrincipal.integration.test.ts`): cross-tenant SELECT against `agent_runs` from inside `withSystemPrincipal` returns zero rows when attempted via `getOrgScopedDb` (no admin-bypass) — the tenant RLS predicate has no `'system'` branch.
- Integration test: cross-tenant WRITE against any tenant table without `allowRlsBypass: true` is blocked by `rlsBoundaryGuard`.
- Programme-end gate: `verify-rls-protected-tables.sh` reads the manifest and the `rls-not-applicable-allowlist.txt`; the two new system tables are correctly classified as bypass.

**Mitigation:** spec §4.3 invariant — "A system principal MUST NEVER be relied on to satisfy a tenant RLS policy." Plan §3.3 contract repeats this. The plan does NOT modify `rlsPredicateSqlBuilderPure.ts`. Every cross-tenant read goes through `withAdminConnectionGuarded({ allowRlsBypass: true, source, reason })`.

### 7.2 Triage-job double-enqueue race (sweep + incident-driven, Slice C)

**Risk.** Both the incident-driven trigger (commit 4) and the sweep handler (commit 5) can enqueue `system-monitor-triage` for the same incident. Without `singletonKey: 'triage:${incidentId}'`, two agent runs execute, double-charging tokens, double-incrementing `triage_attempt_count`, racing on `write_diagnosis`.

**What could go wrong:** Cost spike under load. Audit log shows two diagnoses where one would do. `write_diagnosis` idempotency on `(incidentId, agentRunId)` saves the row state but does not save the LLM cost.

**Test shape:**
- Integration test (`triageJob.incidentDriven.integration.test.ts`): probe fires both triggers within 1 second; assert exactly one agent run started; the second enqueue logs `triage_enqueue_deduplicated`.

**Mitigation:** spec §4.9.1 + §9.2 — pg-boss `singletonKey` per `incidentId`. Plan §5.6 + §5.7 declare both job files with this key. Programme-end `verify-background-jobs-readiness.sh` checks the declaration block.

### 7.3 Outbox-pattern transactional enqueue (Slice C commit 4)

**Risk.** Spec §9.2 mandates the triage enqueue happens **inside the same transaction** that wrote the `incident_opened` event. If the implementer calls `pgboss.send` *after* `db.transaction`, a tx rollback can leave a phantom triage job pointing at an incident that never existed. If they call `pgboss.send` inside `db.transaction` but use a different connection, the send happens regardless of rollback.

**What could go wrong:** Phantom triage jobs land in pg-boss; the worker fetches an incident that 404s; `agent_triage_failed reason='agent_run_failed'` events accumulate.

**Test shape:**
- Integration test: simulate a tx rollback after the event row write but before commit; assert no triage job was enqueued.
- Code review: grep for `pgboss.send` in the ingestor — every site must be either (a) inside a `db.transaction(async tx => ...)` block using the same pool, or (b) explicitly after the txn commits with the documented "phantom OK" rationale.

**Mitigation:** Existing `incidentIngestor.ts:179` already uses the post-commit pattern for the existing `notify` enqueue. Plan §5.6 follows the same pattern for the new triage enqueue, adding it as a sibling call with the same explicit-after-commit comment. The phantom-OK rationale: a triage enqueue without an incident is caught by the worker's `read_incident` returning 404 → `agent_triage_failed`. Acceptable.

### 7.4 Heuristic-purity gate false negatives (Slice C commit 10)

**Risk.** The `verify-heuristic-purity.sh` gate greps for `.insert(` / `.update(` / `.delete(`. A creative implementer who needs to write from a heuristic could route through `db.execute(sql\`INSERT INTO ...\`)` (raw SQL) and bypass the gate. The §6.2 invariant fails silently.

**Test shape:**
- Self-test fixture under `scripts/__tests__/heuristic-purity/` includes a deliberately-violating fixture using `db.execute(sql\`INSERT...\`)` — the gate must catch it (extends the regex or adds a second pattern).
- Code review: any heuristic that imports `db` directly is suspect; the `HeuristicContext.db` field is typed to a read-only subset and the convention discourages.

**Mitigation:** Plan §5.12 — the gate's regex is extended to include `db.execute.*INSERT|UPDATE|DELETE` as a second pattern (case-insensitive, `tr -d '\r'` for Windows). Documented in the gate header.

### 7.5 Prompt validation regex drift (Slice C commit 3)

**Risk.** The `promptValidation` module enforces required sections present "in order". A regex that allows extra content between sections or a different section ordering than the spec may admit malformed prompts that fail downstream when the operator pastes.

**What could go wrong:** Operator pastes a structurally-invalid prompt; Claude Code can't follow it; the entire feedback loop is poisoned.

**Test shape:**
- Pure test cases: malformed prompts (missing section, sections out of order, sections with extra YAML) — all reject. Well-formed prompts (per spec §5.2 worked example) — accept.
- Manual smoke step 6 (load-bearing) — copy 5 generated prompts to local Claude Code; if any fails to parse, the regex needs hardening.

**Mitigation:** spec §9.8 lists the validation invariants. Plan §5.5 implements them as pure helpers. The validation runs at `write_diagnosis` time; failure triggers the retry-up-to-2 loop; second failure → `agent_triage_failed reason='prompt_validation'` and UI badge.

### 7.6 Schema-version evolution on agent-emitted JSON (Slice C, ongoing)

**Risk.** Per spec §4.8 + §9.8 — every agent-emitted JSON payload carries `schema_version: 'v1'`. A future Phase 3 enhancement bumps to `v2`; readers must tolerate both. If the implementer hard-codes the `v1` schema in the read path, old rows break.

**What could go wrong:** A `v2` evolution attempt breaks the UI for incidents diagnosed under `v1`.

**Test shape:**
- Pure test: read a `v1` payload via the read path, verify it parses. Read a hypothetical `v2` payload (with one new optional field), verify it also parses without throwing on the unknown field.

**Mitigation:** spec §4.8 evolution rules. Plan implementation uses Zod schemas with `.passthrough()` on top-level objects (or equivalent) so unknown fields are tolerated. UI consumers branch on `schema_version` only when behaviour differs; otherwise treat as additive.

### 7.7 Sweep cap accidentally bypassed (Slice C commit 5)

**Risk.** `selectTopForTriage` sorts by per-fire confidence and caps at 50 candidates / 200 KB. If the implementer accumulates payload after sort but skips the running-total check, the cap silently fails and the agent burns tokens on every fire.

**What could go wrong:** A high-volume tick (100+ candidates with multiple fires each) bypasses the cap, agent triages all of them, cost spike.

**Test shape:**
- Pure test (`selectTopForTriagePure.test.ts`): 100 candidates of 50 KB each → top-N selected up to 200 KB total payload (top-4 only); `cap_kind: 'payload'` set; `excess_count: 96`.
- Integration test (`sweepJob.cap.integration.test.ts`): 100 staged candidates → `sweep_capped` event with correct excess_count.

**Mitigation:** Pure helper makes the cap logic testable in isolation. Plan §5.7 includes the cap test as part of the per-slice gate.

### 7.8 Auto-escalation loop (Slice C commit 6)

**Risk.** A high-severity rate-limited incident auto-escalates; the resulting task on the system-ops sentinel subaccount fails; the failure produces a new incident on the same fingerprint; the new incident hits the rate limit; auto-escalation fires again. Cascade.

**What could go wrong:** System-ops queue floods with auto-escalated tasks, each tied to a failure that was itself auto-escalated.

**Test shape:**
- Integration test (`triageJob.autoEscalate.integration.test.ts`): the existing Phase 0/0.5 escalation guardrails (`escalation_count <= 3`, 5-min cooldown — see `phase-0-spec.md §10.2.5`) cap the loop. Test exercises the third escalation attempt → `agent_escalation_blocked` event.

**Mitigation:** spec §9.9 — auto-escalation reuses the existing manual-escalate path, inheriting its guardrails. Plan §5.8 does NOT duplicate the guardrail logic; it calls into the existing path.

### 7.9 Heartbeat self-recursion (Slice B + C)

**Risk.** The `heartbeat-self` synthetic check fires when its own job's heartbeat is stale. If the resulting incident is auto-triaged (Slice C), the agent reads logs, fails to find anything (because the synthetic-check job is itself broken), and produces a diagnosis that recommends "investigate the synthetic-check job" — which the operator may interpret as actionable. Worse, the agent run itself may hit the same broken job.

**What could go wrong:** Recursion loop where the monitor diagnoses its own dead heartbeat.

**Test shape:**
- Integration test (`syntheticChecks.heartbeat.integration.test.ts`): heartbeat-self fires; `metadata.isSelfCheck = true` set on the incident; the incident-driven trigger (Slice C) excludes it; no auto-triage runs.

**Mitigation:** spec §9.2 + §8.3 — the `isSelfCheck` flag is the recursion guard. Plan §5.6 implements the guard in `enqueueTriageIfEligible`. Same pattern for `metadata.isMonitorSelfStuck` (§9.11).

### 7.10 Single-PR review surface (Slice D)

**Risk.** One PR covers ~11-13 days of work across four slices. Reviewer fatigue → either rubber-stamp or extended review cycle.

**Mitigation:** spec §2.4 — the trade-off is explicitly accepted. Plan adds:
- Per-slice verification gates (§3.9, §4.10, §5.16, §6.9) — each slice is internally reviewable.
- Commit-by-commit history structured by slice — reviewer can review slice-at-a-time.
- `progress.md` handoff entries make slice intent traceable.
- The PR description (Slice D commit 6) summarises the four-slice landing, lists the verification command results inline, attaches the smoke checklist.

### 7.11 Migration sequencing collision (Slice A or D)

**Risk.** The branch sat un-merged for ~13 days while implementation runs. If `main` lands new migrations during that window, Slice A's `0233_*` collides at PR-open time.

**Test shape:** `verify-migration-sequencing.sh` (existing gate) catches at programme-end.

**Mitigation:** `DEVELOPMENT_GUIDELINES.md §6.2` — migration numbers are assigned at merge time. The executor renames `0233_*` to the next free slot at PR-open time. Plan §3.1 reserves `0233` as a placeholder; final number assigned in Slice D commit 6.

### 7.12 KNOWLEDGE.md inheritance — gate-authoring traps

The plan inherits the §5 DEVELOPMENT_GUIDELINES.md gate-authoring rules. Specific traps to avoid in Slices C + D:

- **CRLF stripping** — both new gates `tr -d '\r'` before pattern match (Windows-authored files).
- **`import type` skipping** — both gates `grep -v "import type"` before applying the pattern.
- **Self-test fixtures** — neither fixture file carries gate-recognised suppression annotations (per §5).
- **Calibration constants** — if either gate subtracts a hard-coded count, every excluded occurrence is enumerated in an inline comment with a unique grep pattern.
- **Advisory `|| true`** — neither new gate is advisory; both are blocking. Not applicable.

---

## 8. Test sequencing

The pre-production posture is `static_gates_primary` per `docs/spec-context.md`. New runtime tests are added only for **pure functions**. Integration tests use the existing pattern (`*.integration.test.ts`, runs against a real test DB, txn-rolled-back). All tests run via `bash scripts/run-all-unit-tests.sh` or targeted `npx tsx`.

### 8.1 Test landing per slice

| Slice | Pure unit tests landed | Integration tests landed | Smoke (manual) |
|---|---|---|---|
| A | 4 (idempotency, throttle, systemPrincipal, assertSystemAdminContext) | 3 (systemPrincipal, idempotencyEndToEnd, throttleEndToEnd) | none — Phase A is dead-code-by-design |
| B | 8+ (phaseFilter, refreshJob aggregate, 8 synthetic checks) | 4 (queueStalled, coldStart, heartbeat, baselineRefresh) | none — synthetic incidents observable in dev DB |
| C | 14 (one per heuristic) + 5 (promptValidation, clusterFires, selectTopForTriage, rateLimit, autoEscalate) + 4 client (DiagnosisAnnotation, InvestigatePromptBlock, FeedbackWidget, DiagnosisFilterPill) | 10 (triage incident-driven, sweep-driven, rateLimit, autoEscalate, killSwitch, sweepCap, feedback, promptValidation, agentSkillSet, rls.systemMonitor) | smoke steps 4-9 |
| D | 9 Phase 2.5 heuristic tests + 2 baseline pure helpers (entropy, KL divergence) | 2 (phase25Heuristics, baselineRefresh.phase25Metrics) | full 10-step staging smoke |

### 8.2 Pure-test naming and convention

Per `DEVELOPMENT_GUIDELINES.md §7`:
- File suffix `Pure.test.ts` for any test under `__tests__/` that has zero transitive DB / network / fs imports. The `verify-pure-helper-convention.sh` gate enforces.
- Co-located with the module under test where possible.
- Run individually via `npx tsx <path>`.

Heuristic tests are pure because heuristics conform to the §6.2 boundary contract — they do not write, do not enqueue, do not call out. The `db` field on `HeuristicContext` is mocked in tests with a stub that fails on any write-shaped call.

### 8.3 Integration-test convention

Per spec §14.2:
- File suffix `.integration.test.ts`.
- Runs against a real test DB (provisioned by the existing test infrastructure — verify pattern at write time against `server/services/__tests__/incidentIngestorIntegration.test.ts`).
- Each test in its own transaction; rolled back at end.
- Some tests need pg-boss in test mode (synthetic-checks integration tests, triage integration tests).

### 8.4 What NOT to test (intentional gaps)

- **No load tests for sweep / synthetic / triage.** Per spec §14.3 — the load test for the ingest path was Phase 0/0.5 work. New layers are bounded by their own caps (input cap on sweep, rate limit on triage, tick interval on synthetic). Phase 3 readiness exercise.
- **No E2E browser tests.** Per `docs/spec-context.md` posture (`static_gates_primary`). UI components ship with React unit tests only.
- **No multi-instance correctness tests.** Process-local LRU and throttle map are explicitly accepted as multi-instance-undercount per spec §4.7.2 — Phase 3 may upgrade. No test exercises the multi-instance race.
- **No prompt-quality LLM tests.** The Investigate-Fix Protocol's only end-to-end validation is the manual copy-paste smoke step 6 (spec §14.3).
- **No tests for the heuristic registry phase-filter env override beyond the pure phaseFilter test.** End-to-end (set env → registry filters) is covered by integration tests of consumers (sweep handler), not by a dedicated test.

### 8.5 Regression guarantees

Every slice's verification gate includes "Phase 0/0.5 + previous slices' tests still pass." Specifically:

- Slice A: `server/services/__tests__/incidentIngestor*.test.ts` (Phase 0/0.5) regression.
- Slice B: Slice A tests still pass; Phase 0/0.5 regression maintained.
- Slice C: Slices A + B tests still pass.
- Slice D: Slices A + B + C tests still pass.

Programme-end runs the full `npm test` (or equivalent) against the final state.

---

## 9. What NOT to build on first pass (stub + TODO)

Items the spec lists in scope but whose first-pass implementation is intentionally minimal. The full implementation is named in the section reference; the stub is what lands in this build.

### 9.1 `read_logs_for_correlation_id` skill durable storage (Slice C)

**What spec wants:** structured-log query by `correlationId`, returning matched lines (capped 200 / 100 KB).

**First-pass stub:** consult the existing process-local rolling buffer in `server/services/incidentIngestor.ts` (extended via `getLogsForCorrelationId(correlationId, limit)` exported helper). Multi-instance deploy undercounts. Documented as known limitation per `phase-0-spec.md §2.8`.

**Reason:** durable log store is a deferred Phase 3 decision. Building it now expands scope past the four-slice budget.

**Tracker:** `tasks/todo.md` entry under "Phase 3 — durable log store for `read_logs_for_correlation_id`".

### 9.2 Phase 2.5 baseline drift detection over time (Slice B + D)

**What spec mentions:** §7.2 — "Drift-over-time detection (output entropy collapse, cost per outcome increasing) reads agent-run rows directly via a time-bucketed query, not from baseline history."

**First-pass:** Phase 2.5 systemic heuristics (§9.6) read agent-run / skill-execution rows directly via the candidate's natural source table. No `system_monitor_baselines_history` table is built. Drift detection is per-tick comparison of current snapshot vs baseline; no cross-tick history.

**Reason:** Phase 3 deliverable per spec §7.2.

### 9.3 Auto-remediation skills (Slice C)

**What spec NG2:** explicitly out of scope. The agent reads, diagnoses, annotates. No `destructiveHint: true` skills.

**First-pass:** zero such skills. The CI gate enforces.

**Reason:** Phase 3 — the architectural hard line that separates Phase 2 from Phase 3.

### 9.4 Sysadmin dashboard for feedback rollups (Slice C + D)

**What spec mentions:** §11.3 — "A sysadmin-only dashboard that visualises feedback rollups (per-heuristic FP rate over time, prompt-effectiveness trend) is **out of scope** for this spec. The data is captured; the visualisation is a Phase 3 deliverable."

**First-pass:** data is captured in `system_incident_events` rows (`investigate_prompt_outcome` event); queryable via direct SQL. No UI surface beyond the inline drawer.

**Reason:** Phase 3.

### 9.5 Tenant-scoped monitoring (any slice)

**What spec NG6:** explicitly out of scope.

**First-pass:** zero per-tenant monitoring. The `system_monitor` agent operates only on system-scoped tables and reads tenant tables read-only.

**Reason:** Phase 5+. Spec §19.4 names the architectural lever.

### 9.6 Push notification channels (any slice)

**What spec NG1:** explicitly deferred indefinitely.

**First-pass:** existing `SystemIncidentFatigueGuard` from Phase 0/0.5 sits dormant. No invocation from this spec's surface.

**Reason:** Phase 0.75 (deferred indefinitely per §0.2 Q1).

### 9.7 Real-time WebSocket push of agent diagnoses (Slice C)

**What spec NG7:** existing `system_incident:updated` channel piggybacks; no new WS event type.

**First-pass:** drawer re-renders on the existing channel; UI consumers see new diagnosis fields when the same `updated` event fires after `write_diagnosis` writes.

**Reason:** unnecessary new surface.

### 9.8 Edit-in-place on `investigate_prompt` (Slice C)

**What spec §10.2:** "No edit-in-place. The prompt is rendered read-only."

**First-pass:** no edit affordance in the UI. Operator copies the original and edits in their pasting destination.

**Reason:** preserves the audit record; editing the stored prompt would mutate "what the agent generated" which is the work product.

### 9.9 Counts on the diagnosis filter pill (Slice C)

**What spec §10.5:** "No counts on the pill. Inline count badges on filter pills are explicitly out of scope per CLAUDE.md frontend principles."

**First-pass:** no count badges. List shows count after filter applies.

**Reason:** CLAUDE.md frontend principles, "default to hidden."

### 9.10 Mobile-optimised drawer (Slice C)

**What spec §10.1:** "Mobile layout is not optimised in this spec. The existing drawer falls back to a stacked view, and the new blocks inherit it. No mobile-specific design."

**First-pass:** stacked-view inherited. No CSS additions for mobile.

**Reason:** sysadmin workflow is desktop.

### 9.11 New audit dashboard for sweep coverage (Slice C + D)

**What spec §12.5 mentions:** "Until Phase 3 builds the dashboard, these signals are queryable directly. Worth surfacing on day one in the existing system-incidents admin page is at least the 'Auto-triage rate' tile and the 'Triage skip rate by reason' tile."

**First-pass:** no inline tiles. The signals are computable from `system_incident_events`. The `sweep-coverage-degraded` synthetic check (Slice B) IS the active health invariant — operators see the fired incident, not a tile.

**Reason:** CLAUDE.md frontend principles. Inline state beats dashboards.

---

## 10. Open structural concerns

These concerns surfaced during plan review. None are blocking — they are noted here so the executor and the reviewer see them inline rather than re-discovering during build.

### 10.1 Schema-version branching on the agent-side prompt template

The system prompt template (Slice C commit 3) is stored on `system_agents.master_prompt`. When the Investigate-Fix Protocol bumps to `v2` (some future PR), spec §5.5 mandates the agent's stored prompt update in the same commit. **The plan does not currently include a CI gate that asserts "if `docs/investigate-fix-protocol.md` git history shows a version bump, the most recent migration touching `system_agents.master_prompt WHERE slug='system_monitor'` must be in the same commit window."** A drift surface exists.

**Current mitigation:** the iteration cadence is weekly (per spec §5.5); reviewers catch drift on the next iteration. PR template asks "did the protocol doc and the agent prompt update together?"

**Future enhancement (not in this build):** a gate that diffs the prompt body's `## Protocol\nv<n>` line against `docs/investigate-fix-protocol.md`'s version header.

### 10.2 Heuristic registry phase filter at runtime vs compile time

Spec §6.4 — `SYSTEM_MONITOR_HEURISTIC_PHASES` env filters which phase's heuristics are active. **The filter runs at registry load time (process start), not at evaluate time.** If an operator flips the env mid-run, the change takes effect on next process start.

This is acceptable per the spec's design (config-as-code, deploy cadence governs heuristic churn) but worth noting for ops: there is no live "disable heuristic X" surface. To kill a misbehaving heuristic, ship a code change that removes it from the array, or set the entire phase off.

**Current mitigation:** kill switch hierarchy (spec §12.2) — `SYSTEM_MONITOR_ENABLED=false` disables everything; `SYSTEM_MONITOR_HEURISTIC_PHASES='2.0'` disables Phase 2.5 heuristics; per-heuristic suppression is via PR.

**Future enhancement:** Phase 3 may add a runtime override table for emergency suppression (per spec §6.5).

### 10.3 The 0233 → 0234 migration question (Slice A vs Slice C)

Per §5.5, the system prompt template is long enough that embedding it in Slice A's migration creates a large SQL string. Plan default is **two migrations**:

- `0233_phase_a_foundations.sql` (Slice A) — schema + seed rows with `master_prompt='<TBD by Slice C>'` placeholder.
- `0234_system_monitor_prompt_template.sql` (Slice C commit 3) — `UPDATE system_agents SET master_prompt = '<full text>' WHERE slug = 'system_monitor'`.

This means Slice A's seed leaves `master_prompt` non-functional. Slice C completes it. **Risk:** if Slice A → C is interrupted (e.g. user changes scope mid-build, branch is closed), the database is in a partially-seeded state. The agent row exists but cannot triage.

**Current mitigation:** `system_monitor_enabled=true` at Slice A migration time but the `enqueueTriageIfEligible` function (Slice C commit 4) does not yet exist — so no triage attempts happen until Slice C lands.

**Alternative:** embed the full prompt in Slice A migration. Avoids the partial-seed risk but lengthens Slice A's migration and forces the prompt template to be authored before the protocol doc. Not recommended.

### 10.4 `system_monitor` agent prompt iteration via migration

Each tuning iteration on the prompt template requires a new migration (UPDATE statement). For a frequently-tuned prompt this is heavy. **Spec §9.7:** "future updates land via additional migrations or a sysadmin-only mutation." Plan default: migrations per iteration. Phase 3 can add a sysadmin route for live editing.

**Current mitigation:** the protocol doc is git-versioned; the agent prompt is a downstream consumer. Iteration cadence is weekly (manageable migration churn).

### 10.5 Test-time pg-boss dependency

Slice C integration tests need pg-boss in test mode for the triage / sweep / synthetic-checks tests. Verify the existing test infrastructure supports this — `phase-0-spec.md` and PR #188 introduced pg-boss test-mode patterns; Slice C inherits.

**Risk if missing:** integration tests for triage / sweep can't run in CI; the executor must run them locally only. Documented as a known limitation if encountered.

**Current mitigation:** verify at write time before Slice C commit 4. If the existing test infrastructure does not support pg-boss in test mode, escalate via `tasks/todo.md` blocker — do not attempt to add a new test-mode harness in this build.

### 10.6 Cross-slice mutation contention on `systemIncidentService.ts`

The plan modifies `server/services/systemIncidentService.ts` in three slices:
- Slice A commit 4 — wire `assertSystemAdminContext` into existing mutation methods.
- Slice C commit 4 — possibly add `annotateDiagnosis` mutation (TBD — the agent's `write_diagnosis` skill may bypass the service layer per §3.5; verify at write time).
- Slice C commit 9 — add `recordPromptFeedback` mutation. Add `?diagnosis=` filter to `listIncidents`.

Three separate edits to the same file across three commits in three sessions = merge-friction risk only if a parallel branch lands. The branch is exclusive to this build per the constraints; risk is low.

**Current mitigation:** none needed; build is single-threaded.

### 10.7 The `sweep-coverage-degraded` Slice B → C dependency

Spec §8.2 lists `sweep-coverage-degraded` as a day-one synthetic check. Plan ships it in Slice B as a stub returning `fired: false` (no sweep data yet); it activates in Slice C once `sweep_completed` events start being written. **Risk:** the `system_monitor_coverage_threshold` env (default 0.95) calibration is "best guess" until Slice C runs in dev for some duration. The check may fire false positives the first hour of Slice C testing.

**Current mitigation:** the threshold is env-configurable (`SYSTEM_MONITOR_COVERAGE_THRESHOLD`); the executor can lower it temporarily during Slice C dev smoke. Per spec §8.4, defaults are "starting values, not invariants."

### 10.8 Outbox-pattern transactional discipline

Spec §9.2 mandates the triage enqueue happens in the same transaction as the `incident_opened` event row write. The existing `incidentIngestor.ts` uses a post-commit pattern (see `notifyMilestones` block at line 179). Plan §5.6 default: follow the existing post-commit pattern, accepting "phantom triage on a never-existed incident is OK because the worker's `read_incident` 404s and emits `agent_triage_failed`."

**Risk:** spec §9.2 describes a stricter pattern ("the enqueue rolls back with the txn"). The plan deviates from the spec here by following the existing codebase pattern. **Decision required:** does the user want strict-in-tx (requiring a Drizzle-aware pg-boss send wrapper, which doesn't currently exist) or post-commit (matching the existing notify pattern)?

**Plan default:** post-commit, with the phantom-OK rationale. Confirm or override.

### 10.9 Programme-end vs. mid-build gate timing — the §1.3 invariant

Per the architect playbook gate-timing rule (and the plan's §1.3): mid-build gate runs are forbidden. The 6 slices' verification gates use `npm run build:server` + targeted unit tests only. **Risk:** if a gate-level invariant breaks during mid-build (e.g. someone accidentally adds a write to a heuristic and the heuristic-purity gate would catch it but is not run), the breakage surfaces only at programme-end — late.

**Current mitigation:** targeted unit tests inside the chunk that depend on the invariant (per the architect playbook). Slice C's heuristic boundary contract is enforced by per-heuristic tests — a heuristic that writes to the DB fails its own positive/negative test by definition (the test's mocked `db` stub fails on any write-shaped call, per §8.2). The CI gate is a backstop, not the only line.

---

## 11. Programme-end verification and ready-to-build checklist

### 11.1 Programme-end verification (run after Slice D, after spec-conformance, before opening the PR)

The full gate set runs **once** here. This is the only post-baseline gate run. Any violation discovered here that is in the build's surface area is a fix-before-PR-open.

```bash
# 1. Spec-conformance pass (caller runs this — not the executor mid-build)
#    Detects any directional or mechanical drift between the spec and the implemented code.
#    Routes mechanical fixes auto-applied; directional findings to tasks/todo.md.
#    The executor waits for the spec-conformance log before proceeding.

# 2. Full gate set
npm run test:gates
#    Includes (current as of branch tip 645f0a72):
#      - verify-rls-session-var-canon
#      - verify-org-scoped-writes
#      - verify-subaccount-resolution
#      - verify-rls-contract-compliance
#      - verify-no-direct-adapter-calls
#      - verify-canonical-read-interface
#      - verify-principal-context-propagation       ← Slice A introduces consumers
#      - verify-rls-protected-tables                ← Slice A registers two new tables
#      - verify-rls-coverage
#      - verify-migration-sequencing                ← Slice A's 0233 must be next-in-sequence
#      - verify-architect-context
#      - verify-background-jobs-readiness           ← four new jobs declared per B2
#      - verify-idempotency-strategy-declared
#      - verify-pure-helper-convention
#      - verify-skill-read-paths
#      - verify-heuristic-purity                    ← NEW (Slice C commit 10)
#      - verify-event-type-registry                 ← NEW (Slice C commit 10)
#      - (any other gate that lives in scripts/run-all-gates.sh at the time)

# 3. Full local pass
npm run lint
npm run typecheck
npm test
npm run build

# 4. PR-readiness review
git log main..HEAD --oneline       # commit history readable, slice-aligned
git diff main...HEAD --stat        # file-by-file diff size sanity
# Architecture / capabilities doc check — manual verification per §6.5, §6.6.

# 5. Manual smoke checklist
# Execute all 10 steps in tasks/builds/system-monitoring-agent/staging-smoke-checklist.md.
# Tick each step in staging. Step 6 is load-bearing — copy 5 generated prompts to local
# Claude Code; verify each is actionable without follow-up clarification.

# 6. pr-reviewer agent (caller invokes after spec-conformance + gates green)
```

**Spec-conformance triage rule.** If `spec-conformance` returns `NON_CONFORMANT` (directional findings only — auto-applied mechanical fixes have already landed), the executor stops, reads the deferred-items list at `tasks/todo.md`, decides which findings are in-scope vs Phase 3 follow-ups, applies any in-scope fixes, then re-runs spec-conformance. The PR opens only after `spec-conformance` returns `CONFORMANT` or `CONFORMANT_AFTER_FIXES`. After spec-conformance auto-applies fixes, `pr-reviewer` re-runs over the expanded changed-code set per the standard review pipeline.

### 11.2 Executor notes

**Gate scripts run TWICE TOTAL per this plan: once during Phase 0 baseline (and any pre-existing-violation fixes) and once during Programme-end verification after all chunks AND spec-conformance. Running them between chunks, after individual fixes, or as 'regression sanity checks' is forbidden — it adds wall-clock cost without adding signal.**

Per-chunk verification is exactly two commands plus targeted unit tests:
- `npm run build:server` — fast typecheck after every meaningful TypeScript change.
- `npm run build:client` — only when a chunk touches client code.
- `npx tsx <test-file>` for unit tests added in the chunk.
- `bash scripts/run-all-unit-tests.sh` only when a chunk's invariant is broad enough that single-file runs are insufficient.

No `scripts/verify-*.sh` invocations. No `npm run test:gates`. No "regression sanity check" gate runs. No "let me just confirm nothing broke" gate runs.

### 11.3 Ready-to-build checklist

Before Slice A starts, confirm:

- [ ] User has reviewed the spec at `tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md` and the plan at `tasks/builds/system-monitoring-agent/phase-A-1-2-implementation-plan.md`.
- [ ] User has resolved or accepted the 12 concerns in §0 of this plan.
- [ ] User has switched the Claude Code session to Sonnet per CLAUDE.md model-guidance §"Plan gate".
- [ ] User has invoked `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) against this plan as the build contract.
- [ ] Branch `claude/add-system-monitoring-BgLlY` is clean and up-to-date with `main`.
- [ ] Phase 0 baseline `npm run test:gates` has run; output captured in `progress.md`; any pre-existing-violation fixes scoped per §1.2.
- [ ] No mid-build `/compact` is planned. Each session writes back to `progress.md` before ending.
- [ ] Auto-commit override is OFF — implementation reverts to standard CLAUDE.md no-auto-commit rule (review agents excepted).
- [ ] One PR will be opened at the end of Slice D, not per slice.

When all boxes tick: the executor opens Slice A and follows §3.

### 11.4 Slice-end checklist (each slice repeats this)

- [ ] All slice acceptance criteria pass (§3.9, §4.10, §5.16, §6.9 respectively).
- [ ] `npm run build:server` (and `npm run build:client` for Slices C, D) exit 0.
- [ ] All targeted unit + integration tests added in the slice pass.
- [ ] Slice handoff entry written to `progress.md` per spec §15.2.
- [ ] No outstanding `in_progress` TodoWrite items in the slice's local list.
- [ ] No `.skip` / `.only` / silenced lints introduced.
- [ ] No mid-build `scripts/verify-*.sh` runs occurred during the slice.
- [ ] Session ends; user reviews `progress.md` before next session opens.

### 11.5 Final-PR checklist (Slice D commit 6 only)

- [ ] Programme-end verification (§11.1) all green.
- [ ] Spec-conformance pass returned `CONFORMANT` or `CONFORMANT_AFTER_FIXES`.
- [ ] `pr-reviewer` agent has run (post-spec-conformance) and returned `APPROVE` or `APPROVE_WITH_NITS`.
- [ ] Staging smoke checklist 10/10 ticked.
- [ ] PR description summarises the four-slice landing, lists commit ranges, captures verification command outputs inline, links the smoke checklist results.
- [ ] Migration number renamed from `0233_*` to the actual next-free slot at PR-open time per `DEVELOPMENT_GUIDELINES.md §6.2`.
- [ ] `tasks/todo.md` updated with any Phase 3 follow-ups the build surfaced.
- [ ] `progress.md` final entry switches from "slice handoff" to "spec complete, awaiting user review of PR."

When all boxes tick: PR is opened to `main`.

---

End of plan.












