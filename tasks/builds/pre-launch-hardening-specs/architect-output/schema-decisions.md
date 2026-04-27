# Chunk 2 — Schema Decisions + Renames — Architect Resolution

**Authored:** 2026-04-26 (architect output)
**Source:** `docs/pre-launch-hardening-mini-spec.md` § Chunk 2 — Schema Decisions + Renames
**Invariants pinned by:** `cf2ecbd0` (`docs/pre-launch-hardening-invariants.md`)
**Consumed by:** Chunk 2 spec at `docs/pre-launch-schema-decisions-spec.md`
**Framing references:** `docs/spec-context.md` (pre-production / rapid_evolution / commit_and_revert / no feature flags / prefer_existing_primitives), `docs/spec-authoring-checklist.md` § Section 1 (every new primitive needs a "why not reuse" paragraph).

This document captures the architect's resolution for the twelve decisions in Chunk 2. The Chunk 2 spec embeds these decisions and pins this file's commit SHA in its front-matter. The spec author writes the spec — this document is the input, not the spec.

---

## Table of contents

1. F6 (todo.md:503) — `safety_mode` vs existing `run_mode` collision
2. F10 (todo.md:504) — Portal run-mode column unnamed
3. F11 (todo.md:505) — `side_effects` runtime storage
4. F15 (todo.md:506) — `processes.input_schema` / `output_schema` validator + format
5. F21 (todo.md:507) — Rule 3 "Check now" trigger
6. F22 (todo.md:508) — Definition of "meaningful" output
7. WB-1 (todo.md:637) — `agent_runs.handoff_source_run_id` write-path
8. DELEG-CANONICAL (todo.md:332) — Canonical truth between `agent_runs` telemetry and `delegation_outcomes`
9. W1-6 (todo.md:646) — Automations column rename — VERIFIED CLOSED
10. W1-29 (todo.md:647) — `*.playbook.ts → *.workflow.ts` — VERIFIED CLOSED
11. BUNDLE-DISMISS-RLS (todo.md:480) — `bundle_suggestion_dismissals` unique-key vs RLS
12. CACHED-CTX-DOC (todo.md:491) — Cached-context "Option B-lite" RLS posture documentation

13. Cross-decision coherence check + cross-chunk dependencies

---

## 1. F6 (todo.md:503) — `safety_mode` vs existing `run_mode` collision

### Decision

**Keep the split.** Introduce a new `safety_mode text NOT NULL DEFAULT 'explore'` column on `workflow_runs` (formerly `playbook_runs`) carrying the Riley `'explore' | 'execute'` enum. The existing `run_mode` column (`'auto' | 'supervised' | 'background' | 'bulk'` per migration `0086_playbook_run_mode.sql`, currently declared as `runMode` on `server/db/schema/workflowRuns.ts:59`) stays as-is; its semantic is "execution style" (where the request originated, how it should be scheduled), not "safety posture."

The two dimensions are orthogonal:
- `run_mode` answers *how was this run dispatched and scheduled* (interactive vs background vs bulk).
- `safety_mode` answers *what is the post-LLM gate posture for side-effecting work* (force-review vs auto-dispatch).

A run can be `run_mode='background'` AND `safety_mode='explore'` simultaneously (a backgrounded portfolio-health pass that still wants Explore-Mode review on every side-effecting step), or `run_mode='auto'` AND `safety_mode='execute'` (an interactive run authorised to fire actions inline). Forcing them through one column means every consumer has to re-discriminate the union, and the existing `run_mode` consumers (the workflow engine's tick loop, the supervised-mode UI, the bulk-import path) continue to need their original four values.

### Rejected options

- **Migrate the existing `run_mode` column to hold `'explore' | 'execute'`** — destroys the four legacy values and breaks every consumer of supervised-mode UI / background scheduling / bulk-import dispatch. The legacy values are still load-bearing; the spec-reviewer's `## Deferred` already names the supervised-mode call-site audit (todo.md:509) but does NOT say the values should be removed, only that the *checkbox* should be removed.
- **Composite `runConfig` JSONB** — violates `prefer_existing_primitives_over_new_ones`. JSONB makes both dimensions opaque to indexes (the `safety_mode = 'explore'` query that drives the Explore-mode default selection becomes a JSONB containment scan). Two boolean-ish enums fit two columns cleanly.

### Files affected

- `server/db/schema/workflowRuns.ts` — add `safetyMode: text('safety_mode').notNull().default('explore').$type<'explore' | 'execute'>()`.
- New migration in the Riley sequence (the spec author picks the next free number — 0223+ depending on what lands first) — `ALTER TABLE workflow_runs ADD COLUMN safety_mode text NOT NULL DEFAULT 'explore'` plus matching `_down` reversal.
- `server/services/agentExecutionService.ts` — `RunCreationRequest` already accepts `safetyMode` per the Riley spec body (lines 1095–1099); thread it into the `workflow_runs` INSERT path when the run is workflow-engine-driven.
- `server/services/workflowEngineService.ts` — read `safety_mode` alongside `run_mode` when building the per-step `RunContext` for `gateResolutionServicePure.resolveEffectiveGate`.
- `shared/types/runStatus.ts` — no change (status sets are closed; this is a new dimension, not a new status).

### Downstream ripple

- The Riley spec body already names `safetyMode` in TypeScript / `safety_mode` in SQL (`docs/riley-observations-dev-spec.md:1091-1094`). This decision confirms the spec body's naming is authoritative.
- Naming-and-schema invariant 2.6 binds: no code branch may write to this column until the Chunk 2 spec is merged.
- Downstream Riley Wave 2 / 3 work picks up the column to drive the explore/execute toggle in the agent settings UI; Chunk 2 only authors the column.

### Open sub-questions for the spec author

- **Default for legacy rows.** `DEFAULT 'explore'` is the safe-mode fallback. Confirm in the spec body whether existing in-flight `workflow_runs` rows (none expected pre-launch, but defensive) should be backfilled to `'execute'` for consistency with their pre-Chunk-2 dispatch behaviour, or left at the new default. Architect recommendation: leave at `'explore'` — pre-launch, no live data, defensive default wins.
- **CHECK constraint vs `text`.** The existing `run_mode` is `text` with the `$type<>` cast for type-discipline; `safety_mode` should match. No CHECK constraint required — same convention as visibility (`text` + app-layer validator).

---

## 2. F10 (todo.md:504) — Portal run-mode column unnamed

### Decision

**Add a new column** `subaccount_agents.portal_default_safety_mode text NOT NULL DEFAULT 'explore'` in the same migration that adds `workflow_runs.safety_mode` (decision 1). When a portal-initiated workflow run lands without an explicit `safetyMode` in the `RunCreationRequest`, `resolveSafetyMode` reads `subaccount_agents.portal_default_safety_mode` for the (agent, subaccount) pair as the agency-configured default.

The Riley spec already references this default at §6.8 / §12.13 but never names the column. This decision pins the name. The mini-spec recommendation (line 504 of todo.md) is `subaccount_agents.portal_default_safety_mode` — adopted verbatim.

### Rejected options

- **Reuse an existing `subaccount_agents` column.** No existing column carries safety-mode semantics. The closest neighbours (`heartbeat_*` columns from migration 0206 in the Riley sequence, `default_safety_mode` on `agents` per §6.6) are either heartbeat-specific or live on the wrong primitive (`agents` is org-level; portal default needs subaccount-level resolution).
- **Read `agents.default_safety_mode` and skip the subaccount column entirely.** The spec body distinguishes "agent default" (org-level, inherited) from "portal default" (subaccount-specific override the agency configures for that client's portal). Conflating them removes the agency's per-client tuning surface.
- **JSONB `portal_config` blob.** Same `prefer_existing_primitives` argument as F6 — opaque to indexes, no advantage over a typed column.

### Files affected

- `server/db/schema/subaccountAgents.ts` — add `portalDefaultSafetyMode: text('portal_default_safety_mode').notNull().default('explore').$type<'explore' | 'execute'>()`.
- The same migration as F6 — `ALTER TABLE subaccount_agents ADD COLUMN portal_default_safety_mode text NOT NULL DEFAULT 'explore'` plus matching `_down`.
- `server/services/agentExecutionService.ts` — extend `resolveSafetyMode` (Riley spec §6.6 lines 1107–1119) to read the column when `request.runSource === 'portal'` (or whichever discriminator the portal-initiated path uses; the spec author picks the existing constant) and `request.safetyMode` is absent and `request.parentRun` is null.
- `client/src/pages/(portal)/...` — the portal "run mode" surface for agency admins (NOT the customer-facing portal — agency admins set the default; customers don't see the toggle in v1). Spec author confirms the surface name during Wave 2/3 authoring; not in scope for Chunk 2.

### Downstream ripple

- Riley spec §4.8 column inventory must list this column. Chunk 2 spec author updates the inventory in the same edit that pins this decision.
- Naming-and-schema invariant 2.6 binds: no code branch may write to this column until the Chunk 2 spec is merged.
- Triggers `subaccount_agents` to widen by one column. Width is not a concern — `subaccount_agents` is a thin join table, ~10 columns today.

### Open sub-questions for the spec author

- **Inheritance precedence.** When the portal initiates a run, the resolution order is: `request.parentRun.safetyMode` (delegation inheritance, Riley §6.6 step 1) → `request.safetyMode` (explicit override, step 2) → `subaccount_agents.portal_default_safety_mode` (this decision, **new** step 3) → `agents.default_safety_mode` (step 4) → `'explore'` literal (step 5 fallback). Confirm this five-step ladder in the spec body explicitly — Riley §6.6 today only enumerates four.
- **Permission to edit.** The agency admin sets this via a UI in the per-subaccount agent settings page. Permission key resolves through the existing subaccount-agent permission set; the spec author confirms which key during the file inventory pass.

---

## 3. F11 (todo.md:505) — `side_effects` runtime storage

### Decision

**Top-level column** `system_skills.side_effects boolean NOT NULL DEFAULT true` with backfill from markdown frontmatter at seed time. The mini-spec recommendation (todo.md:505 option (a)) is adopted.

The default is `true` (safe — treat any unmigrated row as side-effecting → forces review under Explore Mode), matching the Riley spec body's "default to true (safe)" guidance at line 1046.

### Rejected options

- **Nested inside `system_skills.definition` JSONB** — every gate-resolution call (one per skill dispatch — high frequency on the agent execution path) would unpack JSONB to read a single boolean. Indexes on JSONB-extracted scalars are awkward (expression indexes work but lose statistics). Top-level boolean is one fetch, fits in the row, indexable cheaply if needed.
- **Frontmatter-only with seed regeneration** — the markdown files are authoring seed; runtime dispatch reads `system_skills` rows directly. If the runtime path can't see the field without re-reading the markdown, the gate becomes a filesystem dependency at runtime — anti-pattern. Also breaks the existing `systemSkillService.createSystemSkill` write path which doesn't touch markdown.
- **`text` enum (`'mutating' | 'read_only' | 'unknown'`) matching the `automations.side_effects` shape** — tempting for symmetry with the existing `automations.side_effects` column (declared on `server/db/schema/automations.ts:50` with three-value text). Rejected because Riley spec §6.4 line 1036 explicitly types the skill side_effects field as `boolean`, and the gate-resolution algorithm at line 1074 reads it as `subject.skill.sideEffects === true`. Matching the spec's declared type avoids re-litigation.

### Files affected

- `server/db/schema/systemSkills.ts` — add `sideEffects: boolean('side_effects').notNull().default(true)` between the existing `instructions` and `isActive` lines.
- New migration in the Riley sequence — `ALTER TABLE system_skills ADD COLUMN side_effects boolean NOT NULL DEFAULT true` plus `_down`.
- `server/services/systemSkillService.ts` — `createSystemSkill` / `updateSystemSkill` validators accept `sideEffects` (defaulting to `true` if absent) and write it to the row.
- `server/scripts/seedSystemSkills.ts` (or whichever script reads markdown frontmatter at seed time — spec author confirms during file inventory) — read the `side_effects` frontmatter field and pass it through to the insert.
- `server/services/gateResolutionServicePure.ts` — already reads `subject.skill.sideEffects` per Riley §6.5; no change required, but confirm the type flows from the new column to the `Skill` type alias.
- `scripts/gates/verify-skill-side-effects.sh` (Riley §6.4 line 1049) — gate now also re-validates DB-backed rows once the column lands.

### Downstream ripple

- The 152-skill audit (Riley §6.4 line 1043) becomes a backfill: every markdown `side_effects: true | false` value writes to the matching `system_skills.side_effects` column at the next seed run.
- The CI gate `verify-skill-side-effects.sh` validates BOTH markdown frontmatter AND DB rows — both must agree per skill. Drift between the two is a gate failure.
- `system_skills.definition` JSONB stays untouched — the Anthropic tool definition (`name`, `description`, `input_schema`) remains the single thing in there. Adding a new top-level column is the cleaner extension point.

### Open sub-questions for the spec author

- **Backfill ordering.** Migration ships the column with `DEFAULT true`. The audit-driven seed run then writes the per-skill values. Confirm in the spec body that the migration is decoupled from the seed run — they happen in different commits / passes — so a partial rollout (column added but seed not yet re-run) leaves every skill at the safe default.
- **Idempotency on re-seed.** The seed pass should be idempotent — running it twice produces the same row state. Spec author confirms the seed script does not toggle `side_effects` to a different value on re-read; it writes the markdown value verbatim.
- **`true` literal in DEFAULT.** `system_skills` is system-owned (not multi-tenant); no RLS policy interaction. The `DEFAULT true` is a Postgres-level default — no further wiring needed.

---

## 4. F15 (todo.md:506) — `processes.input_schema` / `output_schema` validator + format

### Decision

The columns live on `automations` (not `processes` — the rename is done; see decision 9). They are `text` columns at `server/db/schema/automations.ts:25-26` (`inputSchema: text('input_schema')`, `outputSchema: text('output_schema')`).

**(a) Validator library:** `ajv` (already pinned in `package.json` for the `agent_execution_events` discriminated-union validator and several other JSON-shape-checking sites — accepted primitive in the codebase; `prefer_existing_primitives_over_new_ones` applies). Re-use the singleton `Ajv` instance with `strict: false` to permit JSON Schema draft-07 inputs without forcing draft-2020-12 conformance.

**(b) Schema format:** **JSON Schema draft-07.** Industry standard, ajv-native, well-understood by integration authors. The columns store the JSON-Schema-as-stringified-JSON; the parser does `JSON.parse(row.inputSchema)` then `ajv.compile(parsed)` lazily, cached in-memory by automation id + last-modified timestamp.

**(c) `additionalProperties: false` posture:** **Default to permissive (`additionalProperties: true` — i.e. omit the constraint).** The author may include `"additionalProperties": false` in their schema if they want strict-shape validation; the validator does not inject it. Rationale: pre-launch, integration authors are still iterating webhook contracts; a strict default rejects legitimate-but-unannotated extension fields and creates friction on every new webhook field landed by the engine side.

If the schema fails to parse OR fails to compile, validation is **best-effort skip** (matching Riley §5.4's softened posture) — log a warning, allow the dispatch through. Validation is opt-in through schema correctness, not opt-out through a feature flag.

### Rejected options

- **`zod`** — accepted primitive elsewhere for TypeScript-side runtime validation, but not for "validate this user-authored JSON Schema string." `zod` schemas are TypeScript objects, not parseable from a `text` column at runtime. Adapter cost outweighs the symmetry win.
- **Custom validator** — `prefer_existing_primitives` rejects this. ajv covers every documented case (required fields, type checks, enum, format, oneOf/anyOf, conditionals).
- **JSON Schema draft-2020-12 with `strict: true`** — brittle for hand-authored schemas that omit `$schema`; rejects valid draft-07 inputs the author copy-pasted from CRM webhook docs. The cost is zero — draft-07 covers every field shape the dispatcher needs to validate.
- **Strict `additionalProperties: false` default** — rejected per the (c) rationale: pre-launch integration authoring needs friction-light validation. Strict can be opted in per-schema; the dispatcher does not inject it.

### Files affected

- `server/services/invokeAutomationStepService.ts` — pre-dispatch validation hook. Pure helper `validateInputAgainstSchema(rendered, schemaText) → { ok } | { errors: Ajv.ErrorObject[] }` lives in `server/services/invokeAutomationStepPure.ts` (existing pure-helper file, already imported here per Riley spec body).
- `server/services/invokeAutomationStepPure.ts` — add the validator helper. Keep the `Ajv` instance module-scoped + cached compile.
- `server/services/__tests__/invokeAutomationStepPure.test.ts` — pure tests for: parseable+valid → ok; parseable+invalid → errors; unparseable → skip (best-effort posture).
- No schema change to `automations` — columns already exist.
- `docs/riley-observations-dev-spec.md` § §5.4 / §5.5 / §12.23 — spec body's "best-effort" prose now points at this decision for the validator pin. Chunk 2 spec author flags this as a reference, not an edit (the Riley spec is authored on its own track).

### Downstream ripple

- Pre-dispatch validation failure emits `error_code: 'automation_input_validation_failed'` per Riley §5.7 (line 840 already names the code). Post-dispatch validation failure emits `automation_output_validation_failed` (line 841). Chunk 2 doesn't change the error vocabulary — Chunk 5's W1-38 decision handles `automation_execution_error` separately.
- The Chunk 5 invariant 3.4 (§5.7 error vocabulary is closed) requires that any new error code emitted for validation match the §5.7 list. The two `*_validation_failed` codes are already in §5.7; this decision uses them as-is.
- ajv compile cache eviction — if an automation's `input_schema` is edited, the cached compiled validator must invalidate. The cache key is `automation.id + automation.updatedAt`; on row update, `updatedAt` advances and the cache miss recompiles. No explicit eviction needed.

### Open sub-questions for the spec author

- **Compile cache scope.** Module-scoped `Map<cacheKey, ValidateFunction>` is the simplest shape. Confirm in the spec body whether the cache should be bounded (LRU with a cap) or unbounded — pre-launch, automations are <100 per org, unbounded is fine. Add a TODO if cap is needed at scale.
- **Empty-string input schema.** Treat `inputSchema === '' || inputSchema === null` as "no schema declared" → skip validation. The §5.4 best-effort posture covers this implicitly; spec author calls it out explicitly.
- **Output validation post-dispatch error coupling.** If output validation fails, the run's `runResultStatus` outcome — does the failure demote a successful dispatch to `'failed'` or to `'partial'`? Chunk 5's H3 invariant 3.5 governs the partial/success boundary; the spec author cross-references that decision rather than re-deciding here. Architect recommendation: output validation failure → `'failed'` (the contract was violated; the success criterion was "dispatch + valid output," not "dispatch alone"). Chunk 5 owns the final word.

---

## 5. F21 (todo.md:507) — Rule 3 "Check now" trigger

### Decision

**Drop Rule 3 from v1.** The mini-spec recommendation (todo.md:507 option (b)) is adopted. The heartbeat activity gate ships with three rules, not four:

- Rule 1 — Event-delta threshold (§7.4 line 1295)
- Rule 2 — Time-since-last-meaningful-output with first-tick branch (§7.4 line 1303)
- Rule 4 — State-flag (§7.4 line 1321)

Rule 3 (`any_user_initiated_check_queued = true`, currently §7.4 line 1313–1319) is removed — there is no "Check now" button or API in the codebase, and adding one is scope expansion beyond Chunk 2's "schema decisions and renames" remit. The heartbeat gate is described in Riley §7 as a Wave 1 deliverable; the rule depends on a UI surface (Wave 2/3) that does not exist.

The rule renumber: ship as Rule 1 / Rule 2 / Rule 3 (renumbered from former Rule 4) — keeps the mental model "one rule per signal class" and avoids visible gaps.

### Rejected options

- **Add a `subaccount_agents.check_now_requested_at timestamptz NULL` column + `POST /api/subaccount-agents/:id/check-now` route + admin UI button** — three new surfaces (column, route, button) for a "cheap observation fix" — exactly the introduce-then-defer anti-pattern that invariant 5.4 prohibits. If we author the column we must ship the route and the button; we don't have time pre-launch.
- **Keep Rule 3 with a placeholder column and `false` literal until the UI lands** — ships dead code. The gate evaluates a permanently-`false` rule on every heartbeat tick. Anti-pattern; spec-conformance would flag it as dead-path on the first audit.
- **Defer the entire heartbeat gate** — overcorrects. Rules 1, 2, 4 work today and provide the gate's primary value; only Rule 3 depends on missing UI.

### Files affected

- `docs/riley-observations-dev-spec.md` §7.4 — Chunk 2 spec author flags this as a Riley-spec edit (Riley spec body re-numbers / removes Rule 3). Chunk 2 spec body cites the decision; does not edit Riley directly.
- `server/services/heartbeatActivityGateServicePure.ts` (new in Wave 1 of Riley) — implements only the three remaining rules.
- `HeartbeatGateReason` enum (Riley §7.5 line 1348) — drop `'explicit_trigger'` from the union; ship as `'event_delta' | 'time_threshold' | 'state_flag' | 'no_signal' | 'gate_error'`.
- No schema change.

### Downstream ripple

- Riley §7.4 / §7.5 / §12.16 update in the same Riley-spec amendment commit. Chunk 2 spec records the decision; Riley spec authors apply the edit.
- The triage entry at todo.md:507 gets marked closed when the Riley spec is amended.
- If a "Check now" trigger is needed post-launch (operator wants to force a tick from the UI), it is a separate spec — not a deferred Chunk 2 item.

### Open sub-questions for the spec author

- **Re-opening trigger.** Document in Chunk 2 spec the specific signal that would re-open this decision: "first operator request for an explicit Check-now button after launch." Add to `## Deferred Items` of the Chunk 2 spec, not the Riley spec. (The Riley spec author may also want to mirror the deferral; cross-coordinate at the consistency sweep.)
- **Rule renumbering vs. preserving Rule 4.** Architect prefers re-number (1, 2, 3 dense). Spec author confirms — alternative is to keep the gap (Rules 1, 2, 4) which is technically less consistent but loses the audit-trail confusion of "Rule 3 was removed."

---

## 6. F22 (todo.md:508) — Definition of "meaningful" output

### Decision

A run produces "meaningful" output when:

```
agent_run.status = 'completed'
  AND
  (action_proposed_count >= 1 OR memory_block_written_count >= 1)
```

The mini-spec recommendation (todo.md:508) is adopted verbatim. Both the action-proposal count and the memory-block-written count are observable via existing telemetry: action proposals route through `actionService.proposeAction` which writes to the `action_proposals` table; memory writes route through the memory subsystem which writes to `memory_blocks`. A SQL count of either table joined to the `agent_runs.id` is the canonical query.

**Enforcement site.** The recommendation already named in Riley §7.6 line 1403 is `server/services/agentRunFinalizationService.ts` (or the equivalent terminal-state hook the agent execution path uses today). Spec author confirms the site during file inventory — Riley §7.6 line 1403 marks it as architect-confirm-during-plan-decomposition, which is exactly this pass.

### Rejected options

- **`status='completed'` only** — too permissive. A completed run that produced zero actions and zero memory blocks is operationally indistinguishable from a no-op tick, which is precisely what the heartbeat gate is trying to filter. Counting this as meaningful means `last_meaningful_tick_at` advances on every dispatch — defeats the gate's purpose.
- **Action proposed AND memory written** (both required) — too restrictive. A read-only diagnostic run that surfaces an insight as an action proposal but writes no memory block is meaningful; demanding both excludes legitimate cases. The OR is the correct shape.
- **Action proposed OR memory written OR LLM-driven decision logged** — adds a third arm. The "decision logged" signal is too noisy (every LLM call logs a decision) and conflicts with Riley §7.4 Rule 1 which already accounts for event-driven activity. Two arms is sufficient.
- **Pure-function threshold (`>= N` action proposals)** — overengineered. A single proposal is meaningful; a count threshold introduces a tunable knob with no clear setting.

### Files affected

- `server/services/agentRunFinalizationService.ts` — extend the terminal-state hook to compute `isMeaningful` and conditionally update `subaccount_agents.last_meaningful_tick_at = now()` + reset `subaccount_agents.ticks_since_last_meaningful_run = 0`.
- A new pure helper `computeMeaningfulOutputPure({ status, actionProposedCount, memoryBlockWrittenCount }) → boolean` in the same `*Pure.ts` neighbour (exact location at the spec author's discretion — `agentRunFinalizationServicePure.ts` if it exists, else `agentRunFinalizationService.ts` may grow a pure helper inline).
- Pure tests: status-not-completed → false; completed + zero actions + zero memory → false; completed + 1 action + 0 memory → true; completed + 0 actions + 1 memory → true; completed + many of both → true.
- `docs/riley-observations-dev-spec.md` §7.6 + §12.17 — Riley spec author updates the prose to point at this decision for the canonical definition.

### Downstream ripple

- The query for `actionProposedCount` / `memoryBlockWrittenCount` per run is a simple join — no new index needed if `action_proposals.agent_run_id` and `memory_blocks.agent_run_id` are already indexed (spec author confirms during file inventory).
- The hook runs in the same transaction as the `agent_runs` terminal-state write to avoid race conditions where a tick reads `last_meaningful_tick_at` between the two updates.
- If the action-proposal table or memory-blocks table renames (it shouldn't — they're stable surfaces), this hook gets re-pointed; the pure function stays unchanged.

### Open sub-questions for the spec author

- **Action proposals that get rejected.** Does a run that proposes an action which is then rejected count as meaningful? Architect says yes — the proposal itself is the meaningful signal (the agent surfaced something worth surfacing). Rejection is a downstream decision that doesn't retroactively unmean the proposal. Spec author confirms in the prose.
- **Memory blocks soft-deleted post-write.** Same argument — the write is meaningful at the time it happened. Subsequent soft-delete doesn't unmean it. Spec author confirms.
- **Cross-run memory writes.** A run can write to a memory block that another run owns (via the memory dedup / merge job). Only count writes where `memory_blocks.created_by_agent_run_id = run.id` (or the equivalent ownership column). Spec author pins the ownership column name during file inventory.

---

## 7. WB-1 (todo.md:637) — `agent_runs.handoff_source_run_id` write-path

### Decision

**Populate `handoffSourceRunId` AND keep `parentRunId` for handoff runs (backward-compat).** Both columns are set on handoff-created `agent_runs` rows. This satisfies invariant 2.3 (the column is the canonical handoff edge) while preserving the backward-compatibility of the existing `parentRunId`-based code paths in `agentExecutionService.ts:1226-1232` (trace-session ID derivation) and `agentActivityService.getRunChain` (run-chain consumer).

The runtime semantics:

- **Spawn run** (sub-agent created via `spawn_sub_agents`): `parentRunId = parent.id`, `handoffSourceRunId = null`.
- **Handoff run** (created via `reassign_task`): `parentRunId = handoff_caller.id`, `handoffSourceRunId = handoff_caller.id`. Both equal the calling run's id; the discriminator is which column carries the canonical-edge meaning.
- **Both-cause run** (rare; the spec invariant 1.3 says "both pointers when both caused it"): `parentRunId = spawn_caller.id`, `handoffSourceRunId = handoff_caller.id`.

`delegationGraphServicePure.ts:72` (handoff-edge emission) reads from `handoffSourceRunId`. `agentActivityService.getRunChain` reads from `parentRunId` (backward-compat). Cross-references in invariant 2.3 hold.

The trace-session ID logic at `agentExecutionService.ts:1226-1232` continues to read `parentRunId` for handoff chains — this preserves an existing invariant (handoff chains share a trace session) without requiring a migration of the trace-session derivation.

### Rejected options

- **Clear `parentRunId` on handoff runs (set to null), populate only `handoffSourceRunId`** — breaks `agentActivityService.getRunChain` and the trace-session ID derivation at `agentExecutionService.ts:1226-1232`. Both consumers would need migration to read `handoffSourceRunId` AND OR coalesce with `parentRunId`. Cross-cutting; ships dead-code in the consumers until they migrate. Not for pre-launch.
- **Drop `handoffSourceRunId` and overload `parentRunId` for handoff edges** — defeats the spec invariant 2.3 ("`handoff_source_run_id` is the canonical handoff edge column"). The whole point of the column existing is to disambiguate spawn-edge from handoff-edge in the delegation graph; removing it forces graph emission to re-discriminate from `runSource` alone, which is what the existing pre-WB-1 graph emission was already doing imperfectly.
- **Write `handoffSourceRunId` for handoff runs, leave `parentRunId` null, AND migrate downstream consumers** — proper-but-expensive. Touches `agentActivityService`, the trace-session derivation, every analytics consumer that joins on `parentRunId`. The benefit (one canonical pointer per edge type) is real but cross-cutting. Acceptable post-launch; not for pre-launch.

### Files affected

- `server/services/agentExecutionService.ts` lines ~395–412 — `agent_runs` INSERT extends to set `handoff_source_run_id` from `request.handoffSourceRunId ?? null`. Existing `parentRunId` line at line 402 stays.
- `server/services/agentExecutionService.ts` line ~179 — `AgentRunRequest` interface gains `handoffSourceRunId?: string`.
- `server/services/agentScheduleService.ts` lines 115–134 (the handoff worker) — pass `handoffSourceRunId: data.sourceRunId` to `agentExecutionService.executeRun()` alongside the existing `parentRunId: data.sourceRunId`. Both set, both equal `data.sourceRunId` for handoff runs.
- `server/services/skillExecutor.ts` (`reassign_task` handler) — payload to the `agent-handoff-run` worker already includes `sourceRunId: context.runId` per the handoff design; no change needed there. The worker propagates it to both columns.
- `server/db/schema/agentRuns.ts` — no change. Column already declared at line 228 (verified above).
- Pure test in `server/services/__tests__/agentExecutionServicePure.test.ts` (or wherever the run-creation pure helpers live) — assert that for `runSource === 'handoff'` the request maps both `parentRunId` and `handoffSourceRunId` to `data.sourceRunId`; for `runSource === 'spawn'` only `parentRunId` is set.

### Downstream ripple

- Invariant 2.3 — confirmed satisfied. Spec body for Chunk 2 cites this decision.
- `delegationGraphServicePure.ts` — already reads `handoffSourceRunId` per the `delegationGraphServicePure.ts:72` reference in WB-1's todo entry. Once population is wired, the empty-edge bug closes.
- Future analytics consumers (per invariant 2.5 / DELEG-CANONICAL — see decision 8) read from `delegation_outcomes` for source-of-truth, with `handoffSourceRunId` available as a per-run snapshot for joins.
- Trace-session ID continues to use `parentRunId` per the existing logic. No analytics surface depends on this distinction today.

### Open sub-questions for the spec author

- **Self-reference FK posture.** The `handoff_source_run_id` column is declared without a `.references(() => agentRuns.id)` clause in Drizzle (per the comment at `server/db/schema/agentRuns.ts:219-225` — "self-reference made the whole table `any`"). The FK lives in migration 0216 only. Confirm the spec body does NOT propose adding the Drizzle-side `.references()` clause back. The TS-inference wall is documented in the deferred `agent_runs` split (todo.md:331) and is the explicit reason the FK was dropped from Drizzle.
- **`isSubAgent` flag on handoff runs.** Spawn runs set `isSubAgent: true`. What about handoff runs? Architect recommends `isSubAgent: false` for handoff (the new run is a peer assignment, not a sub-agent). Spec author confirms or amends per existing semantics; no change to schema either way.
- **`hierarchyDepth` for handoff runs.** Spawn runs increment depth by 1 from parent. Handoff runs: same depth as the calling run (peer assignment, not nesting). Spec author confirms in the spec body.

---

## 8. DELEG-CANONICAL (todo.md:332) — Canonical truth between `agent_runs` telemetry and `delegation_outcomes`

### Decision

**`delegation_outcomes` is canonical** for "what was attempted and what was the outcome." `agent_runs` telemetry columns (`delegationScope`, `delegationDirection`, `hierarchyDepth`, `handoffSourceRunId`) are per-run snapshots for joins, not authoritative history.

The recommended direction in todo.md:332 is adopted verbatim and locked in invariant 2.5.

The runtime contract:

- **Every delegation attempt** (spawn or handoff) writes a row to `delegation_outcomes` carrying `runId` (the calling run), `targetAgentId`, `delegationKind`, `outcome` (success / rate_limited / scope_violation / etc.), `errorContext`. This is the source-of-truth event log.
- **Every successfully-created child `agent_runs` row** carries the per-run snapshot columns. These reflect the state at the moment the child was created; they do not carry the outcome of subsequent attempts (failed attempts don't create child rows but do create `delegation_outcomes` rows).

**Drift detection.** Under failure scenarios these can diverge — outcome write fails → run row exists with telemetry but no outcome event; outcome write succeeds and child run create fails → outcome event exists with no child run. The canonical table is whichever you trust as audit truth: `delegation_outcomes`.

**Analytics consumer rule.** Any analytics surface (admin dashboard, cost-attribution report, audit export) reads from `delegation_outcomes` for the source-of-truth value. Reads from `agent_runs` telemetry columns are permitted only for joins where the snapshot is the explicit interest (e.g. "show me the depth at which this run was created"). Such joins require a code comment naming the join purpose — invariant 2.5 enforces this with a manual reviewer check.

### Rejected options

- **`agent_runs` telemetry columns are canonical** — rejected because they cannot represent failed-attempts (no child row created → no telemetry). The audit trail loses every attempt that didn't result in a child run, which is precisely the data you need to debug delegation failures.
- **Both are canonical, with a synchronisation contract** — invites drift. Two writes per delegation attempt, with no transactional binding, will diverge under partial-failure scenarios. The reviewer-flagged ChatGPT round 3 finding (todo.md:332 source log) explicitly called out the drift risk.
- **Document the contract that keeps them aligned** — same drift problem; documenting alignment doesn't enforce it. Picking one as canonical and naming the other as snapshot is enforceable by code review and grep-able in analytics consumers.

### Files affected

- `docs/pre-launch-hardening-invariants.md` — invariant 2.5 already names this; no edit needed in this Chunk 2 spec pass. The Chunk 2 spec body cites the invariant.
- No code change in Chunk 2. The decision is a contract pin, consumed by future analytics specs (admin dashboard, cost-attribution report).
- `tasks/todo.md:332` — Chunk 2 spec marks this resolved with the chunk slug per spec authoring notes.

### Downstream ripple

- Invariant 2.5 enforcement is `Manual` (owner: `spec-conformance` agent + analytics-feature spec author per-new-surface). Future analytics specs cite invariant 2.5 in their RLS / contracts checklist.
- The post-launch `agent_runs` split (todo.md:331) — when that lands, the `agent_runs_delegation` sub-table inherits the snapshot columns. The canonical-vs-snapshot distinction transfers cleanly.
- No new primitives. Per `prefer_existing_primitives_over_new_ones`, both tables already exist; the decision is which one downstream code reads from.

### Open sub-questions for the spec author

- **Migration of any pre-existing analytics consumers.** Grep for `agent_runs` reads of the telemetry columns from analytics surfaces (admin dashboards). If any exist today and aren't routed through `delegation_outcomes`, flag in the spec body — fix path is per-call-site review, not in scope for Chunk 2 unless the spec author finds violations during file inventory.
- **Failure-mode telemetry coverage.** `delegation_outcomes` covers success and explicit-failure outcomes. What about silent failures (e.g. `reassign_task` returns `success: true` but the worker job never enqueues)? Architect recommendation: such cases are bugs, not telemetry gaps. Spec body confirms the silent-failure path is closed by Chunk 5 invariant 3.4 (closed error vocabulary) — every dispatch path emits one of the §5.7 codes. If the spec author finds a silent-failure case during file inventory, route to Chunk 5 deferred items.

---

## 9. W1-6 (todo.md:646) — Automations column rename — VERIFIED CLOSED

### Status

**`verified-closed` as of 2026-04-26.**

Direct verification on disk:

- `migrations/0222_rename_automations_columns.sql` exists and contains the three `RENAME COLUMN` statements:
  - `workflow_engine_id → automation_engine_id`
  - `parent_process_id → parent_automation_id`
  - `system_process_id → system_automation_id`
  - Plus: drops the legacy unique partial index, recreates it on the renamed column; drops the legacy FK constraint, re-adds it with the new column name.
- `migrations/_down/0222_rename_automations_columns.sql` exists (reversal).
- `server/db/schema/automations.ts` declares `automationEngineId` (line 15), `parentAutomationId` (line 38), `systemAutomationId` (line 40). Indexes match (`automations_engine_idx`, `automations_parent_automation_idx`, `automations_system_automation_idx`).
- A grep for the legacy identifiers (`workflowEngineId`, `parentProcessId`, `systemProcessId`) in `server/db/schema/automations.ts` returns zero matches.

### Decision

No further architectural decision required. The Chunk 2 spec annotates W1-6 as `verified-closed` and:

1. Cites the migration filename (`0222_rename_automations_columns.sql`) in the spec body's "Items closed" section.
2. Cross-references invariant 2.1 — already enforced by the static grep for legacy column identifiers (returns zero matches today; gate confirms).
3. Marks `tasks/todo.md:646` as resolved by the Chunk 2 spec slug per the spec authoring notes (`docs/pre-launch-hardening-mini-spec.md` line 231).

The 59-call-site rewrite the spec-conformance log named is implicitly verified closed by the absence of grep hits in `server/`. Spec author runs the grep once during the spec authoring pass and records the result in the spec body's verification section as evidence (single-line "grep clean as of <date>") — not a new gate, just a one-shot check.

### Rejected options

- **Re-author the migration with different column names** — no — the rename already landed and matches the spec.
- **Add a CHECK constraint or enum tightening** — out of scope for Chunk 2; the columns are still `uuid` references with no semantic constraint change required.
- **Treat as still-open and re-do the work** — the work is done. Re-doing it would create migration churn and break the verified state.

### Files affected (annotation only)

- The Chunk 2 spec body cites:
  - `migrations/0222_rename_automations_columns.sql` (existing)
  - `migrations/_down/0222_rename_automations_columns.sql` (existing)
  - `server/db/schema/automations.ts` (already updated)

No file changes in Chunk 2. The annotation is the contribution.

### Downstream ripple

- Invariant 2.1 — already enforced. Static grep currently returns zero matches.
- The W1-6 entry in `tasks/todo.md` is removed (or marked closed with a Chunk-2 spec-slug reference) when the Chunk 2 spec lands.
- Future spec-conformance audits of the Riley Wave-1 spec re-confirm by grep — no new infrastructure needed.

### Open sub-questions for the spec author

- **Phrase the annotation precisely.** Architect-recommended wording for the spec body's "Items closed" entry:

  > **W1-6 — Automations column renames (verified closed).** Migration `0222_rename_automations_columns.sql` performs the three renames (`workflow_engine_id → automation_engine_id`, `parent_process_id → parent_automation_id`, `system_process_id → system_automation_id`) plus the FK + unique-index recreation. `server/db/schema/automations.ts` declares the new identifiers. Grep for legacy identifiers in `server/` returns zero matches as of `<commit-sha-of-spec-authoring-pass>`. Closed by spec slug `pre-launch-schema-decisions-spec`.

- **Cross-link to Riley Wave 1.** The Riley Wave 1 spec-conformance log (todo.md:646) was the original source of W1-6. The Chunk 2 spec author confirms the close-out in the Riley spec's deferred items section, removing the entry per `docs/pre-launch-hardening-mini-spec.md` line 231.

---

## 10. W1-29 (todo.md:647) — `*.playbook.ts → *.workflow.ts` — VERIFIED CLOSED

### Status

**`verified-closed` as of 2026-04-26.**

Direct verification on disk:

- `server/workflows/` directory exists and contains the three expected files:
  - `event-creation.workflow.ts`
  - `intelligence-briefing.workflow.ts`
  - `weekly-digest.workflow.ts`
- `server/playbooks/` directory does NOT exist on disk (glob `server/playbooks/**/*` returns zero matches).
- A glob for `**/*.playbook.ts` returns zero matches.

The rename is complete. The directory is renamed; the files are renamed; no legacy files remain.

### Decision

No further architectural decision required. The Chunk 2 spec annotates W1-29 as `verified-closed` and:

1. Cites the new directory + file names in the spec body's "Items closed" section.
2. Cross-references invariant 2.2 — already enforced by the static glob check for `**/*.playbook.ts` (returns zero matches today).
3. Marks `tasks/todo.md:647` as resolved by the Chunk 2 spec slug.

### Rejected options

- **Re-do the rename to a different convention** — no, the rename matches the Riley §4.8 file-extension convention.
- **Promote the static glob check to a CI gate in Chunk 2** — already covered by invariant 2.2 (`Static`). The existing static-check posture is sufficient; no new gate script needed.

### Files affected (annotation only)

- The Chunk 2 spec body cites:
  - `server/workflows/event-creation.workflow.ts` (existing)
  - `server/workflows/intelligence-briefing.workflow.ts` (existing)
  - `server/workflows/weekly-digest.workflow.ts` (existing)

No file changes in Chunk 2.

### Downstream ripple

- Invariant 2.2 — already satisfied. Static glob currently returns zero matches.
- The W1-29 entry in `tasks/todo.md` is removed (or marked closed) when the Chunk 2 spec lands.

### Open sub-questions for the spec author

- **Importer + seeder verification.** Confirm by grep that no consumer still imports from `server/playbooks/` (the directory shouldn't exist, but a stale import path would surface as a TS error). If any imports reference the old path, route as a one-line cleanup in the Chunk 2 spec — likely already done by whoever moved the files.
- **Phrase the annotation precisely.** Architect-recommended wording:

  > **W1-29 — File-extension convention rename (verified closed).** Directory `server/playbooks/` removed. Three files moved to `server/workflows/event-creation.workflow.ts` / `intelligence-briefing.workflow.ts` / `weekly-digest.workflow.ts`. Glob for `**/*.playbook.ts` returns zero matches as of `<commit-sha>`. Closed by spec slug `pre-launch-schema-decisions-spec`.

---

## 11. BUNDLE-DISMISS-RLS (todo.md:480) — `bundle_suggestion_dismissals` unique-key vs RLS

### Decision

**Option (a) — extend the unique index to `(organisation_id, user_id, doc_set_hash)` and update the matching `onConflictDoUpdate` target.** The mini-spec list (todo.md:480) names two options; option (a) preserves the org-scoping that aligns with `organisation_id NOT NULL` and the existing org-scoped RLS, AND interprets dismissals as a per-org preference (consistent with §5.12 line 1261's "table is org-scoped"). Per-org dismissals are the correct semantic for a multi-org system_admin user — the same user dismissing a doc set in Org A and re-encountering it in Org B should NOT have the dismissal carry across; the doc set may have different members or different relevance per org.

The decision combines two changes that ship together:

1. **Migration:** new migration in the cached-context sequence — drop the existing `(user_id, doc_set_hash)` unique index, recreate as `(organisation_id, user_id, doc_set_hash)`. Includes `_down` reversal that recreates the original unique index.
2. **Service-layer fix:** `server/services/documentBundleService.ts:378` — change the `onConflictDoUpdate` target from `[bundleSuggestionDismissals.userId, bundleSuggestionDismissals.docSetHash]` to `[bundleSuggestionDismissals.organisationId, bundleSuggestionDismissals.userId, bundleSuggestionDismissals.docSetHash]`. This is the bug the original audit flagged — without this change, even after the index is fixed, the service still asserts the old conflict target and the upsert misbehaves under multi-org.

Both changes ship in the same commit. Either alone is incomplete.

The §5.12 spec self-contradiction (line 1258 "personal preference of the user" vs line 1261 "table is org-scoped") resolves to: **per-org preference, not cross-org**. Spec author updates §5.12 of the cached-context spec in the same Chunk 2 PR to clarify.

### Rejected options

- **Option (b) — drop `organisation_id` from the table and RLS, make dismissals truly cross-org per user.** Two reasons to reject:
  1. Doc sets are org-scoped (a doc set's contents reflect org-specific document availability). Dismissing a doc set in Org A should not blanket-dismiss the same hash in Org B if the underlying doc availability differs.
  2. The cached-context spec's "Option B-lite" RLS posture (todo.md:491, the next decision below) explicitly keeps subaccount isolation at the service layer; dropping `organisation_id` would also break the org-layer DB RLS, which IS authoritative on these tables. Going from "DB-layer org RLS + service-layer subaccount filter" → "no DB layer at all" is a backwards step.
- **Add `subaccount_id` to the unique key as well** — over-scopes. Dismissals are agency-admin / system_admin actions; subaccount-context is not the dismissal authority. Adding subaccount to the key would create dismissals that don't carry across the same agency-admin's subaccount switches, which is the opposite of the user-experience intent. Org-level scoping is the correct granularity.
- **Service-layer fix only, no migration** — leaves the DB without the matching unique constraint. The `onConflictDoUpdate` target must match a real unique constraint or Postgres throws at execution time. Both changes are required.
- **Migration only, no service-layer fix** — `documentBundleService.ts:378` would still target the old key and the upsert would fail to find a matching unique constraint. Same Postgres-throw outcome.

### Files affected

- New migration in the cached-context sequence (spec author picks the next free number — likely 0223+ depending on Riley sequencing). Drops `bundle_suggestion_dismissals_user_id_doc_set_hash_unique` (or whatever the existing constraint name is — the spec author confirms during file inventory; the original migration `0212_*_dismissals.sql` is the reference). Recreates as `bundle_suggestion_dismissals_org_user_hash_unique` on `(organisation_id, user_id, doc_set_hash)`.
- `migrations/_down/<n>_<name>.sql` — reversal recreates the original key.
- `server/services/documentBundleService.ts:378` — `onConflictDoUpdate.target` includes `organisationId` as the leading column.
- `docs/cached-context-infrastructure-spec.md` §5.12 — update prose to clarify per-org dismissal semantics. Spec author makes this edit in the same Chunk 2 PR (or routes to a follow-up cached-context spec amendment if scope-control prefers).
- Pure test in the documentBundleService pure helpers (if one exists) — assert that a dismissal in Org A followed by a dismissal in Org B for the same user/hash creates two rows, not one. If no pure helper covers this, the spec author flags as a follow-up test in the spec body's `## Open Decisions`.

### Downstream ripple

- The `bundle_suggestion_dismissals` table grows by zero columns (the unique key changes; the table shape doesn't). No data migration needed pre-launch.
- `suggestBundle` consumers — the function that reads dismissals to filter suggestions — already filters by `organisationId` per existing RLS; no consumer-side change.
- Invariant 1.6 (cached-context Option B-lite) interacts: the org-layer RLS continues to be authoritative on this table. This decision aligns with that posture.

### Open sub-questions for the spec author

- **Existing data behaviour.** Pre-launch, the table likely has zero rows. If any rows exist (test data), the migration recreates the index without backfill — every existing row keeps its `organisation_id` value, and the new index includes them. Spec author confirms by `SELECT count(*) FROM bundle_suggestion_dismissals` during the migration authoring; if non-zero, decide whether to truncate (pre-launch test data) or backfill-skip (rows already have `organisation_id`).
- **Constraint name.** Architect recommends `bundle_suggestion_dismissals_org_user_hash_unique` (drops the long noun chain for readability). Spec author confirms the existing convention in the cached-context migrations and matches.

---

## 12. CACHED-CTX-DOC (todo.md:491) — Cached-context "Option B-lite" RLS posture documentation

### Decision

**The Chunk 2 spec adds a §RLS section to `docs/cached-context-infrastructure-spec.md` documenting the Option B-lite posture as a first-class architectural decision.** The decision content the documentation must capture:

1. **Which tables.** `reference_documents`, `document_bundles`, `document_bundle_attachments`, `bundle_resolution_snapshots`, `bundle_suggestion_dismissals`. (Five tables — the same set named in invariant 1.6.)
2. **What "Option B-lite" means.** Subaccount isolation is enforced at the service layer (filter by `subaccount_id` in every query that reads or writes these tables), not at the DB layer (no `subaccount_id`-bearing RLS policy). Org-layer RLS remains authoritative. Migration `0213_fix_cached_context_rls.sql` is the source-of-truth migration; the documentation cites it.
3. **Why DB-layer subaccount RLS is currently not enforced.** Two reasons, both from migration 0213's header comment:
   - **Bundle resolution at the org layer.** Bundles can be associated with multiple subaccounts (some scoped, some org-wide); a single subaccount filter at the DB layer would force every bundle read into a single-subaccount frame and break cross-subaccount bundle resolution.
   - **Service-layer enforcement is sufficient for the threat model.** Cached-context tables are read through `documentBundleService` exclusively; every read/write site uses `getOrgScopedDb` and applies the subaccount filter explicitly. The threat model is "wrong-org leak" (covered by org-RLS) plus "wrong-subaccount leak" (covered by service filter).
4. **Which code path is the authority.** `server/services/documentBundleService.ts` — every read function that takes a `subaccountId` parameter applies the filter; every write asserts the `subaccount_id` value at insert time. The Chunk 2 spec body lists the specific function names (the spec author greps and enumerates).
5. **What would trigger reinstating the DB-layer subaccount policies.** Two triggers:
   - The first cached-context table that is read by code paths OUTSIDE `documentBundleService` (i.e. a new consumer that doesn't go through the service layer's filter).
   - A confirmed wrong-subaccount leak incident — runtime evidence that the service-layer filter was missed somewhere.
6. **How future cached-context tables should be registered.** New cached-context tables MUST follow the Option B-lite posture (header comment in their migration explicitly noting it) OR carry an opt-in to DB-layer subaccount RLS with a documented rationale. Invariant 1.6 enforces this with a manual reviewer check.

The documentation is a §RLS subsection of the cached-context spec, not a new doc — keep scope narrow per the original mini-spec recommendation.

### Rejected options

- **Document in the cached-context spec's appendix only, not as a first-class §RLS section** — buries the decision. Future readers (spec authors for new cached-context tables) need to find this without a treasure hunt. First-class section is the right granularity.
- **Document in `docs/architecture.md`'s RLS section instead** — wrong scope. `architecture.md` documents the three-layer RLS contract universally; Option B-lite is a per-subsystem exception. Keep the exception local to the cached-context spec.
- **Skip documentation; rely on invariant 1.6 alone** — invariant 1.6 NAMES the posture but doesn't explain it. Future authors need the rationale (why this exception was made), not just the rule.

### Files affected

- `docs/cached-context-infrastructure-spec.md` — new `## RLS posture (Option B-lite)` section (or extension of existing §8 RLS section at line 2177). Approximately 30–60 lines of prose covering the six points above. Spec author may move existing §8.1 content under the new heading if the structure flows better.
- The Chunk 2 spec body includes a one-paragraph summary that points at the cached-context spec's new section, NOT the full text — the cached-context spec is the source of truth.
- `migrations/0213_fix_cached_context_rls.sql` — the source-of-truth migration that established Option B-lite. No edit; just cited.

### Downstream ripple

- Invariant 1.6 — fully satisfied once the documentation lands.
- New cached-context tables (post-launch) — author follows the documented posture or carries an explicit opt-in. Invariant 1.6's manual reviewer check enforces.
- Future audit-runner runs of the RLS hotspot — auditor finds the documentation, knows the posture, classifies any violation correctly (NON_CONFORMANT only if the table opted into Option B-lite without the header comment, OR if a code path bypasses the service-layer filter).

### Open sub-questions for the spec author

- **Document length.** Architect-recommended cap: ~60 lines of prose. If the spec author finds more is needed (e.g. a per-table table mapping subaccount filter sites), expand — but flag the expansion in the Chunk 2 spec's `## Open Decisions` so it gets reviewer attention.
- **Subaccount-scoped reference document tables.** If any cached-context table is genuinely subaccount-only (one subaccount per row, no cross-subaccount semantics), the service-layer filter degenerates to "always filter by subaccount." Spec author confirms during file inventory whether any of the five tables fits this case — if so, the documentation calls it out as a sub-class of Option B-lite (no behavioural difference; just clearer for readers).
- **Cross-link to invariant 1.6.** The cached-context spec's new RLS section cites invariant 1.6 by SHA-pinned link, the same way every other consuming spec pins. Confirm in the Chunk 2 spec body.

---

## 13. Cross-decision coherence check + cross-chunk dependencies

### Within Chunk 2 — cross-decision coherence

| Decision | Depends on | Bound to |
|---|---|---|
| F6 (`safety_mode` split) | none | F10, F11, F22 (all reference safety-mode resolution) |
| F10 (`portal_default_safety_mode`) | F6 (column existence) | none downstream in Chunk 2 |
| F11 (`system_skills.side_effects` boolean) | none | F22 (gate resolution reads `sideEffects`) |
| F15 (ajv + JSON Schema draft-07) | none | none in Chunk 2; Chunk 5 W1-38 reads emitted error codes |
| F21 (drop Rule 3) | none | F22 (Rule 3 was the only "Check now" reset path; removing it doesn't affect F22) |
| F22 ("meaningful" definition) | F11 (gate sees `sideEffects`), F21 (rules without "Check now") | none in Chunk 2 |
| WB-1 (`handoffSourceRunId`) | none | DELEG-CANONICAL (snapshot column read posture) |
| DELEG-CANONICAL (`delegation_outcomes` canonical) | WB-1 (telemetry columns continue to exist) | future analytics specs |
| W1-6 (verified closed) | none | invariant 2.1 |
| W1-29 (verified closed) | none | invariant 2.2 |
| BUNDLE-DISMISS-RLS (composite key + service fix) | CACHED-CTX-DOC (org-RLS posture) | none in Chunk 2 |
| CACHED-CTX-DOC (Option B-lite) | none | invariant 1.6, BUNDLE-DISMISS-RLS |

The dependency graph is acyclic. Decisions can be specified in the Chunk 2 spec in the order F6 → F10 → F11 → F22 → F15 → F21 → WB-1 → DELEG-CANONICAL → W1-6 → W1-29 → BUNDLE-DISMISS-RLS → CACHED-CTX-DOC, which is the order chosen for this document and preserves the dependency-respecting traversal.

### Cross-chunk dependencies

**To Chunk 1 (RLS Hardening):** BUNDLE-DISMISS-RLS migration ships in Chunk 2 but is RLS-relevant. Chunk 1's spec author cross-references this migration in the manifest reconciliation pass (SC-1 60-table delta). The `bundle_suggestion_dismissals` table is already in `RLS_PROTECTED_TABLES`; the new unique index does not change the manifest entry. CACHED-CTX-DOC is documentation-only; no Chunk 1 interaction.

**To Chunk 3 (Dead-Path Completion):** No direct dependency. Chunk 3's `briefApprovalService` introduces new artefact-write paths but does not touch any of the columns Chunk 2 modifies.

**To Chunk 4 (Maintenance Job RLS Contract):** No direct dependency. Maintenance jobs do not read/write the columns Chunk 2 modifies.

**To Chunk 5 (Execution-Path Correctness):** Two interactions:
- **F6 / F10 → safety_mode resolution.** Chunk 5's W1-43 / W1-44 dispatcher work reads `safetyMode` from the run context; the column must exist in `workflow_runs` (Chunk 2) before Chunk 5 can write tests against it. Per invariant 5.6 (implementation order is binding), Chunk 2 lands before Chunk 5.
- **F15 → §5.7 error vocabulary.** Chunk 5's W1-38 decision picks one of three options for the `automation_execution_error` code. Chunk 2's F15 emits `automation_input_validation_failed` and `automation_output_validation_failed` (already in §5.7). The two decisions don't conflict — F15 names existing codes; W1-38 picks among new/existing codes for a different scenario.

**To Chunk 6 (Gate Hygiene Cleanup):** No direct dependency. Chunk 6 is gate hygiene only.

### Invariants pinned by this document

This architect output is consistent with every invariant in `docs/pre-launch-hardening-invariants.md` at SHA `cf2ecbd0`. Specifically:

- Invariant 1.6 (cached-context Option B-lite) — directly addressed by CACHED-CTX-DOC (decision 12).
- Invariant 2.1 (renamed automations columns) — verified-closed by W1-6 (decision 9).
- Invariant 2.2 (file-extension convention) — verified-closed by W1-29 (decision 10).
- Invariant 2.3 (handoff-source-run-id canonical column) — write-path resolved by WB-1 (decision 7).
- Invariant 2.5 (delegation analytics canonical truth) — locked by DELEG-CANONICAL (decision 8).
- Invariant 2.6 (schema decisions land before code) — Chunk 2 spec freeze gate (Task 6.5 in `tasks/builds/pre-launch-hardening-specs/plan.md`) enforces.
- Invariant 5.1 (prefer existing primitives) — every "rejected options" section above cites this rule.
- Invariant 5.4 (no introduce-then-defer) — F21 explicitly applies (no "Check now" placeholder primitive).

### Implementation-order summary for the Chunk 2 spec body

The spec author orders Chunk 2 implementation as:

1. **Schema migrations first** (F6, F10, F11, BUNDLE-DISMISS-RLS) — single migration is acceptable if scope-preserved, or two migrations split safety/portal columns from `system_skills.side_effects` from the unique-index recreation. Architect prefers two migrations for clarity (one Riley-sequence migration for F6/F10/F11; one cached-context-sequence migration for BUNDLE-DISMISS-RLS).
2. **Drizzle schema updates** in the same commit as the matching migration.
3. **Service-layer fix for BUNDLE-DISMISS-RLS** (`documentBundleService.ts:378`) ships in the same commit as the migration that recreates the unique index.
4. **WB-1 wiring** (`AgentRunRequest` + `agentExecutionService` INSERT + `agentScheduleService` worker) — no migration; pure code change.
5. **F15 validator helper** — pure helper add + tests.
6. **Documentation** — CACHED-CTX-DOC §RLS section in the cached-context spec; F22 prose update in Riley §7.6 (cross-spec coordination); F21 prose update in Riley §7.4.
7. **Annotations** — W1-6 and W1-29 verified-closed entries in the Chunk 2 spec body.

DELEG-CANONICAL is contract-only; no commit. Cited from the Chunk 2 spec body and the future analytics specs.

---

**End of architect output for Chunk 2.**

Spec author: consume the decisions above into `docs/pre-launch-schema-decisions-spec.md`. Pin this file's commit SHA in the Chunk 2 spec front-matter. Open sub-questions in each decision section are intentional handoffs — resolve them in the spec body, do not re-route them back to the architect.







