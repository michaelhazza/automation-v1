# Spec Reviewer Log — riley-observations-dev-spec

**Spec:** `docs/riley-observations-dev-spec.md`
**Spec commit at start:** `0d5978062347ac9e50dae7acfa7e5e361586d9fe`
**Spec-context commit:** `1eb4ad72f73deb0bd79ad333b3f8caef23418392`
**HEAD at start:** `db8590cdadb79bb81de60327e456772f58984d21`
**MAX_ITERATIONS:** 5
**Started:** 2026-04-22T21:45:51Z

---

## Context-freshness check

Spec last modified 2026-04-22; spec-context last modified 2026-04-21. Both fresh. No framing mismatch — spec aligns with `pre_production: yes`, `feature_flags: only_for_behaviour_modes` (the spec's two toggles are behaviour modes, not rollout flags), and `rollout_model: commit_and_revert` (§10.5 uses `git revert`).

Proceed with iteration 1.

---

## Iteration 1

**Started:** 2026-04-22T21-45-51Z
**Codex output:** `tasks/review-logs/_spec-review-riley-observations-iter1-codex-output.txt`
**Codex findings (distinct, de-duplicated):** 26 (Codex output duplicated itself at EOF; distinct set below)
**Rubric findings:** 2 additional (R1–R2)

### Finding classifications

**F1 — Migration numbers 0172-0176 collide with existing migrations.**
- Classification: MECHANICAL (consistency fix, no scope change)
- Verified: migrations 0172-0201 are already in `migrations/`. Next free slot: 0202+.
- Disposition: AUTO-APPLY — renumber to 0202–0206.

**F2 — Step 2 (§4.6) blast radius understated: missing `/processes` call sites + missing permission keys (`PROCESSES_ACTIVATE`, `PROCESSES_VIEW_SYSTEM`, `PROCESSES_CLONE`, `SUBACCOUNT_PERMISSIONS.PROCESSES_*`).**
- Classification: MECHANICAL (file inventory drift — checklist §2)
- Verified: grep confirms all.
- Disposition: AUTO-APPLY — extend permission and file-inventory enumerations.

**F3 — Step 3 (§4.8) file list incomplete: missing 8+ playbook services/routes.**
- Classification: MECHANICAL (file inventory drift)
- Verified: grep confirms.
- Disposition: AUTO-APPLY.

**F4 — Cross-table `playbook_*` column renames incomplete (`playbook_slug`, `last_written_by_playbook_slug`, `created_by_playbook_slug`, `playbook_step_run_id`).**
- Classification: MECHANICAL (checklist §2 enumeration requirement)
- Disposition: AUTO-APPLY — enumerate in §4.8 prose.

**F5 — Migration 0175 ADDs `run_mode` to `workflow_runs` but column already exists (via 0086). Must be ALTER not ADD.**
- Classification: MECHANICAL (schema contradiction)
- Verified: `0086_playbook_run_mode.sql` adds `run_mode text DEFAULT 'auto' CHECK ('auto','supervised','background','bulk')`.
- Disposition: AUTO-APPLY — change from ADD to ALTER with transform strategy (coupled with F6 resolution).

**F6 — `run_mode` overloaded: existing `auto|supervised|background|bulk` vs new `explore|execute`.**
- Classification: DIRECTIONAL (architecture decision)
- Disposition: AUTO-DECIDED → route to `tasks/todo.md` with recommendation: rename the NEW column (e.g. `safety_mode`) rather than overloading `run_mode`, because `background` and `bulk` are orthogonal execution-style values that cannot be folded into an `explore|execute` dimension.

**F7 — §6.8 "Supervised checkbox removed" contradicts §12.14 "Supervised removal safety as open question".**
- Classification: MECHANICAL (contradiction)
- Disposition: AUTO-APPLY — align §12.14 wording to "decided; architect confirms call sites migrated".

**F8 — `PRIMARY KEY (user_id, agent_id, subaccount_id)` with nullable `subaccount_id` is invalid Postgres DDL.**
- Classification: MECHANICAL (schema correctness)
- Disposition: AUTO-APPLY — replace with surrogate `id uuid` PK + compound unique constraint that works with a NULL-safe partial unique index pattern.

**F9 — `user_run_mode_preferences` tenant-scoped but missing `organisation_id`, RLS policy, `rlsProtectedTables.ts` entry, route guard (checklist §4).**
- Classification: MECHANICAL (the spec already designates this as tenant-scoped; adding RLS is implementing that decision per the repo's mandatory pattern)
- Disposition: AUTO-APPLY — add `organisation_id`, RLS policy clause, manifest entry, and principal-scoped read mention.

**F10 — §6.8 / §12.13 Portal mode field unnamed.**
- Classification: DIRECTIONAL (load-bearing claim deferred to architect)
- Disposition: AUTO-DECIDED → route to `tasks/todo.md` recommending architect resolve before Part 3 migration.

**F11 — `side_effects` lives in markdown frontmatter but runtime skills are DB-backed (`system_skills`).**
- Classification: DIRECTIONAL (schema placement decision)
- Disposition: AUTO-DECIDED → route to `tasks/todo.md` recommending `system_skills.side_effects boolean NOT NULL DEFAULT true` + backfill from markdown seed. Best-judgment on Priority 3.

**F12 — `side_effects` "required" but only mechanism is silent runtime default — no static gate.**
- Classification: MECHANICAL (the codebase convention is static gates; naming the gate is implementing a decided requirement)
- Disposition: AUTO-APPLY — name `scripts/gates/verify-skill-side-effects.sh` as the enforcement mechanism, with fallback to DB-column check if F11 resolves to DB storage.

**F13 — Explore/Execute enforcement sited in `agentExecutionService.ts` but Workflow steps execute via `playbookEngineService.ts` — no named enforcement site for `invoke_automation`.**
- Classification: MECHANICAL (missing named mechanism for a load-bearing claim)
- Disposition: AUTO-APPLY — name the gate helper (extract shared `resolveEffectiveGate` to `server/lib/gateResolution.ts` or equivalent) and cite the workflow-engine call site.

**F14 — `JsonPathExpression` ($.X.Y) contradicts existing DSL ({{ steps.X.output.Y }}).**
- Classification: MECHANICAL (contract boundary mismatch with existing primitive)
- Verified: `server/lib/playbook/types.ts:163` + playbook tests use `{{ steps.X.output.Y }}`.
- Disposition: AUTO-APPLY — rewrite §5.3–§5.5 using the existing template syntax.

**F15 — Runtime validation against `input_schema`/`output_schema` with no named validator/format (columns are `text`).**
- Classification: MECHANICAL (soften load-bearing claim; defer validator choice to architect)
- Disposition: AUTO-APPLY — change §5.4/§5.5 to state v1 treats schema strings as best-effort; validator implementation is §12 open question.

**F16 — `automation.timeout_seconds` column does not exist.**
- Classification: MECHANICAL (unnamed new column / wrong reference)
- Verified: `processService.ts:7` has `DEFAULT_TIMEOUT_SECONDS = 300`.
- Disposition: AUTO-APPLY — change default to reference `DEFAULT_TIMEOUT_SECONDS` constant in `server/services/automationService.ts` (post-rename).

**F17 — Scope matching doesn't require same-subaccount equality.**
- Classification: MECHANICAL (clarification)
- Disposition: AUTO-APPLY — add explicit equality statement in §5.3 and §5.8.

**F18 — §5.9 says response bodies stored in `workflow-step-output table` (internal flow stack) but should be `workflow_step_runs.output_json`.**
- Classification: MECHANICAL (namespace ambiguity caused by rename)
- Disposition: AUTO-APPLY — clarify to `workflow_step_runs.output_json` (post-Part-1-rename).

**F19 — §7.7 queries use `last_tick_at` but schema only has `last_meaningful_tick_at`.**
- Classification: MECHANICAL (symbol mismatch)
- Disposition: AUTO-APPLY — add `last_tick_at timestamptz NULL` column to §7.3 schema AND clarify its update site.

**F20 — `HeartbeatGateDecision.reason` omits `gate_error` but it's used in prose + telemetry.**
- Classification: MECHANICAL (type/contract omission)
- Disposition: AUTO-APPLY.

**F21 — Rule 3 "Check now" trigger undefined.**
- Classification: DIRECTIONAL (new feature surface not in scope)
- Verified: no existing "Check now" button/API in the codebase.
- Disposition: AUTO-DECIDED → route to `tasks/todo.md` recommending Rule 3 be deferred from v1 OR the "Check now" surface be explicitly added to Part 4's Files-to-change list with a specific mechanism (e.g. `subaccount_agents.check_now_requested_at` column + route + UI button).

**F22 — "Meaningful" output undefined (§12.17 open question).**
- Classification: AMBIGUOUS → treated as DIRECTIONAL
- Disposition: AUTO-DECIDED → route to `tasks/todo.md` recommending inline definition: "an agent run that reached status='completed' AND either produced an `agent_run_memory_writes` row OR proposed at least one action."

**F23 — `gapFlags` strict enum missing `context_pressure_unknown` and `workspace_memory_truncated`.**
- Classification: MECHANICAL (enum definition gap)
- Disposition: AUTO-APPLY — add the two flags to §8.4.

**F24 — Missing consolidated Contracts section per checklist §3.**
- Classification: MECHANICAL (checklist requirement)
- Disposition: AUTO-APPLY — add light Contracts section that aggregates the 4–5 boundary shapes with Producer/Consumer/Nullability/Example.

**F25 — Missing `## Deferred Items` section per checklist §7.**
- Classification: MECHANICAL (checklist requirement)
- Verified: no such heading in the spec.
- Disposition: AUTO-APPLY — add `## Deferred Items` section consolidating prose-scattered deferrals.

**F26 — §11.2 Part 2 test plan proposes MSW for a server-side integration test (frontend HTTP mock used out-of-context, and api_contract_tests are outside the framing posture).**
- Classification: MECHANICAL (spec alignment with project framing — Codex's fix brings the spec INTO framing)
- Disposition: AUTO-APPLY — replace "MSW or similar" with pure-function unit coverage + service-boundary mocking; remove end-to-end framing.

**F27 — §10.4 rebase/codemod scripts not in file inventory.**
- Classification: MECHANICAL (file inventory drift)
- Disposition: AUTO-APPLY — add explicit note that `scripts/rebase-post-riley-rename.sh` and `scripts/codemod-riley-rename.ts` are PR-scoped tooling, listed alongside §4 files.

**F28 — Migrations marked "reversible" but no down-migration files specified.**
- Classification: MECHANICAL (load-bearing claim without mechanism)
- Verified: project uses `migrations/_down/` pattern.
- Disposition: AUTO-APPLY — add bullet clarifying down-migration files under `migrations/_down/` are required for each migration, and extend §10.1 table with the down-migration file names.

**F29 — §11.1 W0 says "Rec 5" but agent-decomposition rule is Part 6.**
- Classification: MECHANICAL (naming drift)
- Disposition: AUTO-APPLY — replace "Rec 5" with "Part 6".

**R1 (rubric) — §1.3 SC5 "100% of agent-loop runs" contradicts §8.7 edge 1 "simple_reply path emits no event".**
- Classification: MECHANICAL (contradiction)
- Disposition: AUTO-APPLY — add "excluding Universal Brief simple_reply path" exclusion to §1.3 SC5.

**R2 (rubric) — §6.6 scheduled-always-execute vs §6.7 orchestrator-delegated-inherits-parent: unresolved when a run in Explore Mode spawns a scheduled sub-run.**
- Classification: MECHANICAL (one-sentence clarification)
- Disposition: AUTO-APPLY — add resolution note in §6.7.

### Counts

- Mechanical: 22 (F1–F5, F7–F9, F12–F20, F23–F29, R1, R2)
- Directional / Ambiguous (auto-decided to `tasks/todo.md`): 6 (F6, F10, F11, F21, F22 + one more if F15 reclassifies)
- Reclassified: 0
- Rejected: 0
- Total distinct findings: 28

### Mechanical fixes applied (iter 1)

- F1 — migrations renumbered 0172/0173/0174/0175/0176 → 0202/0203/0204/0205/0206 across §4.3, §4.6, §4.8, §6.3, §7.3, §10.1
- F2 — §4.6 permission table expanded with `PROCESSES_ACTIVATE`, `PROCESSES_VIEW_SYSTEM`, `PROCESSES_CLONE`, full `SUBACCOUNT_PERMISSIONS.PROCESSES_*` set, group-name strings
- F2 — §4.6 UI/route inventory expanded with `CommandPalette.tsx`, `AdminSubaccountDetailPage.tsx`, `PortalExecutionPage.tsx`, `PortalExecutionHistoryPage.tsx`, `OrgSettingsPage.tsx`, `server/routes/subaccounts.ts`, `server/routes/portal.ts`
- F3 — §4.8 service list expanded (all 9 playbook service files named) + route list expanded (3 additional routes)
- F4 — §4.8 cross-table column enumeration: explicit names for `playbook_slug`, `last_written_by_playbook_slug`, `created_by_playbook_slug`, `playbook_step_run_id`, slug-array columns
- F5 — §6.3 migration changed from ADD to explicit-new-column (`safety_mode` instead of `run_mode`, acknowledging the pre-existing `run_mode` from migration 0086)
- F7 — §12.14 re-framed from "open question" to "audit step; removal decided in §6.8"
- F8 — `user_run_mode_preferences` PK fixed (surrogate `id uuid` + two partial unique indexes for nullable `subaccount_id`)
- F9 — `user_run_mode_preferences` RLS contract added as §6.3a: `organisation_id` column, policy, manifest entry, route guard, principal-scoped read
- F12 — Static gate named: `scripts/gates/verify-skill-side-effects.sh` added to §6.4 as the enforcement mechanism
- F13 — Shared gate resolver extracted to `server/services/gateResolutionServicePure.ts` with explicit `invoke_automation` branch in the pseudocode
- F14 — `JsonPathExpression` → `TemplateExpression` using existing `{{ steps.X.output.Y }}` DSL; all §5.3–§5.5 references updated
- F15 — Runtime validation claim softened: best-effort in v1, validator/format is §12.23 open question
- F16 — `timeoutSeconds` default documented to reference existing `DEFAULT_TIMEOUT_SECONDS = 300` constant (not a nonexistent column)
- F17 — Same-subaccount equality rule made explicit in §5.3 and §5.8 with `automation_scope_mismatch` error code
- F18 — §5.9 step-output storage clarified: `workflow_step_runs.output_json` (post-Part-1-rename), not `workflow_step_outputs` (internal flow stack)
- F19 — §7.3 schema adds `last_tick_evaluated_at` column; §7.7 queries updated
- F20 — `HeartbeatGateReason` type extracted as a union including `gate_error`; `HeartbeatGateDecision.reason` uses the union
- F23 — §8.4 `gapFlags` enum extended with `context_pressure_unknown` and `workspace_memory_truncated`
- F24 — New §9a Contracts section consolidating 8 boundary shapes with Name/Type/Producer/Consumer/Nullability/Example
- F25 — New §9b Deferred Items section consolidating prose-scattered deferrals across Parts 1–6 and cross-cutting
- F26 — §11.2 Part 2 test plan rewritten: pure-function unit coverage with service-boundary mocking; removed MSW reference and "end-to-end" framing
- F27 — §10.4 rebase/codemod scripts now explicitly scoped as new files (tooling artefacts) + inventory-note bullet
- F28 — §10.1 migration table expanded with Down-file column; §10.5 clarifies that `git revert` alone is not sufficient, `_down/` files must run
- F29 — §11.1 W0 "Rec 5" → "Part 6 (§9)"
- R1 — §1.3 SC5 expanded with "excluding Universal Brief simple_reply paths" exclusion to match §8.7 edge 1
- R2 — §6.7 edge 7 clarified: delegation inheritance wins over scheduled-always-execute when a parent Explore-mode run enqueues a scheduled sub-run
- TOC updated with §9a and §9b

### Routed to `tasks/todo.md`

- F6 — `safety_mode` vs pre-existing `run_mode` reconciliation (architect decision)
- F10 — Portal run-mode field naming
- F11 — `side_effects` runtime storage schema
- F15 — Validator / schema format (also addressed mechanically by softening)
- F21 — Rule 3 "Check now" trigger OR removal from v1
- F22 — Definition of "meaningful" output (also given a recommendation in §7.6)
- Supervised-mode removal call-site audit (verification step, not decision)

### Iteration 1 counts (final)

- Mechanical accepted: 22
- Mechanical rejected: 0
- Directional: 5 (F6, F10, F11, F21, F22)
- Ambiguous → Directional: 1 (Supervised-mode audit / F15)
- Reclassified: 0
- Autonomous decisions routed to tasks/todo.md: 7

---

## Iteration 2

**Started:** 2026-04-22T22-13-43Z
**Codex output:** `tasks/review-logs/_spec-review-riley-observations-iter2-codex-output.txt`
**Distinct findings:** 11 (all mechanical residuals from iter-1 edits)

### Finding classifications

- **I2-F1 (§3.1, §4.8, §13.2)** — §3.1 lists a nonexistent `playbooks` top-level table. MECHANICAL. Fix: remove from §3.1 list, add explanatory clarification (primary identity is `playbook_templates` / `playbook_runs`), and enumerate additional playbook services.
- **I2-F2 (§5.3, §5.6, §6.5)** — `invoke_automation` said block-unsupported but type and gate algorithm still permit it. MECHANICAL. Fix: narrow `gateLevel?: 'auto' | 'review'` on InvokeAutomationStep; add validator-rejects-'block' comment; restructure gate algorithm so block branch applies only to skills.
- **I2-F3 (§5.9, §5.10)** — Telemetry contract claimed two-events-per-step always; pre-dispatch failures violate that. Completed-event status enum missing several failure codes. MECHANICAL. Fix: dispatched event conditional on successful resolution; completion-event status enum extended with `automation_not_found`, `automation_scope_mismatch`; invariant documented.
- **I2-F4 (§5.11, §12.2)** — Stale "JSON-path" wording after iter-1 switched to template syntax. MECHANICAL. Fix: rewrite both references.
- **I2-F5 (§6.5, §6.6, §6.12)** — Stale `default_run_mode` / `runMode` / `context.runMode` references after iter-1 introduced `safety_mode`. MECHANICAL. Fix: rename to `defaultSafetyMode` / `safetyMode`; update §6.5 pseudocode, §6.6 resolver, §6.12 edges, §6.7 edge 7.
- **I2-F6 (§13.1)** — Glossary row collapsed Explore/Execute back into legacy "Supervised / Dry Run" framing. MECHANICAL. Fix: rewrite glossary row to describe the NEW safety dimension distinct from legacy `run_mode`.
- **I2-F7 (§7.4, §7.10)** — Rule 2 with initial counter 0 doesn't evaluate true on first tick, contradicting §7.10 edge 1. MECHANICAL. Fix: add first-tick branch to Rule 2 (`last_meaningful_tick_at IS NULL OR ticks_since_last_meaningful_run >= threshold`).
- **I2-F8 (§7.5, §7.8, §9a)** — Field name `ticksSinceLastRun` is ambiguous; §9a example has contradictory `shouldRun: true, reason: 'no_signal'`. MECHANICAL. Fix: rename field to `ticksSinceLastMeaningfulRun` everywhere; correct example to `shouldRun: false, reason: 'no_signal'` with invariant note.
- **I2-F9 (§7.6)** — Execution hook doesn't explicitly load state from `subaccount_agents` or thread it into `HeartbeatGateInput`. MECHANICAL. Fix: expand flow with explicit state-load step and HeartbeatGateInput construction.
- **I2-F10 (§7.6)** — Run-completion hook file/service unnamed. MECHANICAL. Fix: name `agentRunFinalizationService.ts` as the candidate, cite its docblock, architect confirms via §12.17.
- **I2-F11 (§9a)** — Part 3 shared contracts (`run.mode.selected` telemetry, `resolveEffectiveGate` service signature) missing from Contracts section. MECHANICAL. Fix: add rows for both, rename `run.mode.selected` to `run.safety_mode.selected` for consistency.
- **I2-F12 (§1.3 SC3, §10.3)** — Stale "after all three migrations" wording. MECHANICAL. Fix: update to "all five migrations". (Codex also flagged §11.2 integration tests — rejected: they're explicitly carved-out tests the spec named, which the framing allows.)

### Iteration 2 counts

- Mechanical accepted: 11
- Mechanical rejected: 1 (Codex §11.2 integration-test framing — rejected per framing rule "small carved-out integration tests are OK if named")
- Directional: 0
- Ambiguous → Directional: 0
- Autonomous decisions routed to tasks/todo.md: 0

---

## Iteration 3

**Started:** 2026-04-22T22-23-52Z
**Codex output:** `tasks/review-logs/_spec-review-riley-observations-iter3-codex-output.txt`
**Distinct findings:** 6 (all mechanical residuals)

### Finding classifications

- **I3-F1 (§6.3, §6.8, §6.9, §9a)** — `user_run_mode_preferences` table name, `UserRunModePreference` TS type, `userRunModePreferencesService` service, UI copy "Default run mode" all leak the `run_mode` naming that was reserved for the legacy enum. MECHANICAL. Fix: rename table to `user_agent_safety_mode_preferences`, type to `UserAgentSafetyModePreference`, service to `userAgentSafetyModePreferencesService`, UI copy to "Default safety mode for this agent". Migration 0205 updated.
- **I3-F2 (§6.6, §6.7)** — `resolveSafetyMode()` signature had no parent-run input, so §6.7 edge 7 ("delegation wins over scheduling") couldn't mechanically derive from the resolver. MECHANICAL. Fix: added `parentRun?: { safetyMode }` field to `RunCreationRequest`, added `triggerType` field, reordered algorithm so delegation inheritance is step 1 (highest priority), scheduled is step 3 (top-level only). §6.9 resolution order list updated to match.
- **I3-F3 (§12)** — Numbering gap (items 23 → 25, no 24). MECHANICAL. Fix: renumber item 25 → 24; update all back-references (§6.3 naming note, §10.1 row 4 cited §12.25).
- **I3-F4 (§11.2 Part 3)** — Test strategy cites `resolveEffectiveGate` test matrix but doesn't name the extracted pure module (§6.5). MECHANICAL. Fix: cite `server/services/gateResolutionServicePure.test.ts` and `server/services/resolveSafetyModeServicePure.test.ts` explicitly.
- **I3-F5 (§1.3 SC1)** — Measurement scope vs expected-hits inconsistency. SC1 lists grep scope as `client/src/` + portal + server templates, but expected hits are "historical migration file comments" which are outside that scope. MECHANICAL. Fix: narrow the scope to exactly what's grep'd and explicitly declare migration files + review logs out-of-scope.
- **I3-F6 (§8.2, §8.7)** — `contextPressure` undefined when `contextBudget = 0`. MECHANICAL. Fix: declare `contextPressure = 0` in that case, cross-reference §8.7 edge 3, note consumer-level implication (filters on >0.9 never fire).

### Iteration 3 counts

- Mechanical accepted: 6
- Mechanical rejected: 0
- Directional: 0
- Ambiguous → Directional: 0
- Autonomous decisions routed to tasks/todo.md: 0

---

## Stopping heuristic

- Iteration 2: mechanical-only (directional = 0, ambiguous = 0, reclassified = 0)
- Iteration 3: mechanical-only (directional = 0, ambiguous = 0, reclassified = 0)

**Two consecutive mechanical-only iterations → EXIT LOOP per stopping heuristic (preferred exit before reaching MAX_ITERATIONS = 5).**

---

