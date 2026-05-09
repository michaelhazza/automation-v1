# SynthetOS Phase 1 Foundation Refactor — Implementation Plan

**Status:** LOCKED — APPROVED FOR BUILD
**Plan date:** 2026-05-09
**Locked:** 2026-05-09 (after ChatGPT plan review: 8 required/recommended fixes applied + 2 final wording cleanups)
**Author:** architect (Phase 2 Step 3, invoked by feature-coordinator)
**Build slug:** `synthetos-foundation-refactor`
**Spec:** `tasks/builds/synthetos-foundation-refactor/spec.md` (LOCKED, 2299 lines, ChatGPT APPROVED 2026-05-09)
**Branch:** `claude/openclaw-worker-mode-VnjQT`
**Scope class:** Major
**Build invocation pattern:** single `feature-coordinator` run, eleven chunks below, executed in declared order (per spec §12.7).

**Post-review changes (locked-in, do not re-litigate during build):**
1. RunTraceEventType union: 15 members (not 13).
2. Chunk 2 = governance migration (was chunk 3); Chunk 3 = controllerStyle field (was chunk 2). Migration numbers re-flowed: 0307 = governance, 0308 = controller_style, 0309 = policy envelope.
3. Sibling `.down.sql` convention reinforced in migration table and each migration chunk; spec body's `migrations/_down/` references are explicitly overridden.
4. Chunk 7 missing-index path: escalate to operator/architect; do not silently add migrations.
5. Chunk 10 mounts the new credentials router in `server/index.ts`; reachability check in acceptance.
6. Chunk 5 acceptance: grep verification command for facade migration.
7. Chunk 6 acceptance: INV-19 trace visibility — failed run yields `run_started` + `run_terminated` only.
8. Chunk 8 contracts: explicit "failed before execution" predicate.
9. Chunk 2 purpose wording: "schema + validation only" (was "schema-only").
10. Migration file bullets: sibling-file note attached to the down migration only.

---

## Contents

- [Model-collapse check](#model-collapse-check)
- [Architecture notes](#architecture-notes)
- [Chunked plan](#chunked-plan)
  - [Chunk 1 — shared-types-and-environment-mapping](#chunk-1--shared-types-and-environment-mapping)
  - [Chunk 2 — subaccount-agents-governance-migration](#chunk-2--subaccount-agents-governance-migration)
  - [Chunk 3 — controller-style-field](#chunk-3--controller-style-field)
  - [Chunk 4 — risk-tier-sweep-and-derivation](#chunk-4--risk-tier-sweep-and-derivation)
  - [Chunk 5 — credential-broker-facade](#chunk-5--credential-broker-facade)
  - [Chunk 6 — policy-envelope-resolver-and-snapshot](#chunk-6--policy-envelope-resolver-and-snapshot)
  - [Chunk 7 — run-trace-api-and-service](#chunk-7--run-trace-api-and-service)
  - [Chunk 8 — run-trace-headline-ui](#chunk-8--run-trace-headline-ui)
  - [Chunk 9 — agent-config-four-tabs](#chunk-9--agent-config-four-tabs)
  - [Chunk 10 — approval-ux-risk-context-and-credentials-audit](#chunk-10--approval-ux-risk-context-and-credentials-audit)
  - [Chunk 11 — naming-glossary-and-awareness-comments](#chunk-11--naming-glossary-and-awareness-comments)
- [Risks and mitigations](#risks-and-mitigations)
- [Executor notes](#executor-notes)

---

## Model-collapse check

The spec is a foundation refactor: a new field on agent runs, a typed risk-tier classification across an action registry, a credential broker facade over existing services, a unified API view across decision-ledger tables (Phase 1 unifies seven; routing_outcomes deferred to Phase 3), a JSONB snapshot of resolved policy at run start, and a glossary doc. None of the six items is an "ingest → extract → transform → render" pipeline that a single multimodal model call could subsume. They are schema, type, service, and route changes against persistent state and an existing execution loop. There is no model call to collapse. **Decision: not applicable; no collapsed-call alternative exists.**

---

## Architecture notes

### Dependency graph (one-line summary)

`shared types → governance migration → controllerStyle field → Risk Tier sweep → Credential Broker → Policy Envelope → Run Trace API → UI surfaces (Run Trace headline / Agent Config tabs / Approval+Credentials) → glossary.`

### Phase mapping (spec §8.1)

- **Phase 1A** primitives: chunks 1, 2, 3, 4, 5 (independent foundations + governance schema).
- **Phase 1B** dependents: chunks 6, 7 (Policy Envelope, Run Trace API).
- **Phase 1D** UI: chunks 8, 9, 10 (depend on 7 and on the Phase 1A schema).
- **Phase 1C** documentation last: chunk 11 (glossary + awareness comments).

The plan ships chunk 1 first because every other backend chunk imports types from it. The governance migration (chunk 2) ships before the controllerStyle field (chunk 3) because chunk 3's run-create wire-up reads `subaccount_agents.controller_style_allowed`, which lands in chunk 2 — landing the governance schema first removes the schema-read-before-schema-create ordering hazard called out in handoff guidance and spec §8.1.

### Why this ordering

1. **Pure types first (chunk 1).** The five new shared types (`ControllerStyle`, `RiskTier`, `ExecutionEnvironment`, `PolicyEnvelopeSnapshot`, `RunTraceEvent`) are the consumer contract for everything else. Authoring them as a single chunk keeps the discriminated unions, exhaustiveness checks, and pure tests close together.
2. **Governance migration (chunk 2) before controllerStyle field (chunk 3) and Risk Tier sweep (chunk 4).** Both chunk 3's controllerStyle resolver wire-up (which reads `controller_style_allowed`) and chunk 4's policy-engine constraint enforcement (which reads `max_risk_tier`, `require_approval_at_tier`) depend on the four governance columns existing on `subaccount_agents`. Landing the schema first means neither dependent chunk has a phase where its code references a column that hasn't been created yet.
3. **controllerStyle field (chunk 3) immediately after chunk 2.** Chunk 3's resolver consumes `subaccount_agents.controller_style_allowed` (chunk 2) and is consumed by chunk 6's snapshot.
4. **Credential Broker (chunk 5) before Policy Envelope (chunk 6).** The envelope captures `resolveAvailableCredentials()` at run start, so the facade must exist before the resolver compiles.
5. **Policy Envelope (chunk 6) before Run Trace API (chunk 7).** The Run Trace response embeds the snapshot, and INV-19 means snapshot resolution is the gating step before any agent loop starts. Both shape the API contract.
6. **Run Trace API (chunk 7) before Run Trace UI (chunk 8).** UI consumes the new endpoint; without the endpoint the UI has nothing to call.
7. **Governance migration (chunk 2) before Agent Config tabs (chunk 9).** The UI writes to the four new columns.
8. **Risk Tier sweep (chunk 4) and Credential Broker (chunk 5) before Approval+Credentials UI (chunk 10).** The Review Queue surfaces tier; the Credentials audit log section reads through the broker's `audit()` method.
9. **Naming glossary (chunk 11) last.** Awareness comments reference chunks 1–7 outputs by their final names; sequencing this chunk last keeps the glossary truthful at write-time.

### Files to create vs files to modify (summary)

**Net-new files (~32):**

- 3 migrations (3 `.sql` + matching `.down.sql` per repo convention; the controller_style and policy_envelope columns ship as separate migration files because they apply to the same table at different sequence points).
- 5 shared type files (`controllerStyle`, `riskTier`, `executionEnvironment`, `policyEnvelope`, `runTraceEvent`) + 5 colocated test files under `shared/types/__tests__/`.
- 1 server config file (`controllerLimits.ts`; `actionRegistry.ts` is modified, not created).
- 5 server services (`controllerStyleResolver.ts`, `credentialBrokerService.ts`, `policyEnvelopeResolver.ts`, `policyEnvelopeResolverPure.ts`, `runTraceService.ts`) + colocated test files.
- 2 CI gate scripts (`scripts/verify-risk-tier-assigned.sh` + `scripts/verify-risk-tier-assigned.ts`).
- 1 client API wrapper (`client/src/lib/api/runTrace.ts`), 1 client lib (`client/src/lib/runTraceFormatters.ts`) + colocated test.
- 7 client components (`RunTraceHeadline`, `ExecutionTab`, `GovernanceTab`, `ModelsIdentityTab`, `IntegrationsTab`, `ApprovalRiskContext`, `CredentialsAuditLog`).
- 1 server route file (`server/routes/credentials.ts`).
- 1 CSV artefact (`tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv`).
- 1 glossary document (`docs/synthetos-nomenclature.md`).

**Modified files (~22):**

- `server/db/schema/agentRuns.ts`, `server/db/schema/subaccountAgents.ts`.
- `server/services/agentExecutionService.ts` (run-create wiring, INV-19 enforcement, controllerStyle dispatch).
- `server/services/policyEngineService.ts` (subaccount-constraint enforcement, riskTier surfacing).
- `server/services/middleware/proposeActionMiddleware.ts` (riskTier / source pass-through).
- `server/config/actionRegistry.ts` (riskTier on every entry).
- `server/routes/agentRuns.ts` (new trace endpoint + controllerStyle param), `server/routes/integrationConnections.ts`, `server/routes/webLoginConnections.ts` (broker migration).
- `server/services/ieeExecutionService.ts` (broker migration).
- `client/src/pages/operate/RunTracePage.tsx` (new endpoint consumption + headline render slot).
- `client/src/components/run-trace/RunTraceEventRenderer.tsx` (new event-type renderers).
- `client/src/pages/admin/SubaccountAgentEditPage.tsx` (four new tabs).
- `client/src/pages/admin/ReviewQueuePage.tsx` (risk-context header).
- `client/src/components/CredentialsTab.tsx` (audit log section).
- `server/services/slackConversationService.ts` (Block Kit template extension).
- `scripts/run-all-gates.sh` (register new gate).
- `architecture.md` (glossary cross-references; awareness comments).
- `server/index.ts` (chunk 10 mounts the new credentials router; one-line `app.use(credentialsRouter)` addition).
- 6 service / job / handler files for awareness comments (chunk 11).
- The permission registry file (chunk 10 establishes which file is canonical for `credentials:audit:read`).

### Migration ordering

The branch currently has zero migrations on top of `main` (verified by feature-coordinator's pre-plan collision check). The latest applied migration in `migrations/` is `0306_agent_default_landing_tab.sql`. Next available number is **0307**. The three new migrations introduced by this plan apply in chunk order:

| Chunk | Migration filename | Purpose | `.down.sql` filename (same folder) |
|---|---|---|---|
| 2 | `migrations/0307_subaccount_agents_governance.sql` | Adds `controller_style_allowed`, `allowed_environments`, `max_risk_tier`, `require_approval_at_tier` columns to `subaccount_agents` | `migrations/0307_subaccount_agents_governance.down.sql` |
| 3 | `migrations/0308_agent_runs_controller_style.sql` | Adds `controller_style` column with default `'native'` and partial index on `controller_style = 'operator'` | `migrations/0308_agent_runs_controller_style.down.sql` |
| 6 | `migrations/0309_agent_runs_policy_envelope.sql` | Adds `policy_envelope_snapshot jsonb` column to `agent_runs` (nullable; no index) | `migrations/0309_agent_runs_policy_envelope.down.sql` |

The repo's convention is sibling `.down.sql` files in the same directory (verified against `migrations/0306_agent_default_landing_tab.down.sql` and the post-0233 batch). The plan does **not** use the `migrations/_down/` legacy subfolder, even though the spec body in places (lines 192, 422, 1811, 1955, 2100, 2141) still references it — the discovered repo convention overrides the spec wording for every migration in this plan. Each `.down.sql` performs a single `ALTER TABLE ... DROP COLUMN` statement (or `DROP INDEX` + `DROP COLUMN` for chunk 3's partial index). All three migrations are non-destructive (default-backed adds only); rollback is item-by-item per spec §8.4.

Migration numbering is fixed at the chunk level so chunks 2, 3, and 6 each own exactly one new migration. If `main` introduces additional migrations between plan time and execution time, the executor renumbers in declared chunk order (2 takes the lowest free slot, 3 the next, 6 the next) — the migration *content* is independent of number.

---

## Chunked plan

Eleven chunks. Chunks 1–7 ship backend; chunks 8–10 ship UI; chunk 11 documents.

---

### Chunk 1 — shared-types-and-environment-mapping

`chunk_name: chunk-1-shared-types-and-environment-mapping`
`spec_sections: §3.6 (state machine closure), §4.1.5, §4.2.4, §4.2.8, §4.4.4, §4.5.4`

**Purpose.** Land every shared TypeScript type the rest of the plan imports. Pure files only, no DB, no service code. Establishes the consumer contract for chunks 2, 4, 5, 6, 7, and 8.

**Files.**

- `shared/types/controllerStyle.ts` — `ControllerStyle` literal union, `CONTROLLER_STYLES` const, `ControllerLimits` interface.
- `shared/types/riskTier.ts` — `RiskTier` numeric union, `RISK_TIERS` const, `GateLevel` literal union, `deriveGateLevel(riskTier, preservedExisting?, policyOverride?)` pure function.
- `shared/types/executionEnvironment.ts` — `ExecutionEnvironment` literal union (`'api_tool' | 'headless' | 'browser' | 'terminal_repo'`), `EXECUTION_ENVIRONMENTS` const, `executionModeToEnvironment(mode)` pure mapping with exhaustiveness check.
- `shared/types/policyEnvelope.ts` — `PolicyEnvelopeSnapshot` interface, `schemaVersion: 1` literal, all sub-shapes per spec §4.5.4.
- `shared/types/runTraceEvent.ts` — `RunTraceEventType` union (14 Phase 1 members per spec §4.4.4: `controller_style_decided`, `policy_envelope_resolved`, `tool_proposed`, `tool_security_decision`, `tool_call`, `tool_result`, `llm_call`, `delegation_spawned`, `delegation_completed`, `review_requested`, `review_decided`, `iee_step`, `run_started`, `run_terminated`; `routing_path_chosen` deferred to Phase 3 alongside canonical ledger consolidation), `RunTraceEventBase` interface, `RunTraceEvent` discriminated union, cursor encode/decode helpers.
- `shared/types/__tests__/controllerStyle.test.ts` (Vitest).
- `shared/types/__tests__/riskTier.test.ts` (Vitest).
- `shared/types/__tests__/executionEnvironment.test.ts` (Vitest).
- `shared/types/__tests__/policyEnvelope.test.ts` (Vitest).
- `shared/types/__tests__/runTraceEvent.test.ts` (Vitest).

**Dependencies.** None. This chunk is the leaf the rest of the plan builds against.

**Contracts.**

- All five files are strict-mode TypeScript with no runtime DB access.
- `deriveGateLevel` source union is `'policy_override' | 'preserved_existing' | 'tier_default'` at this chunk; `'subaccount_constraint'` is added in chunk 4 because the application of that source happens in `policyEngineService` (not in the pure derivation).
- `executionModeToEnvironment` exhausts the existing five `ExecutionMode` values via `const _exhaustive: never = mode` (spec §4.2.8). New `ExecutionMode` values must update both the function and the spec.
- `PolicyEnvelopeSnapshot` carries `schemaVersion: 1` literal — future versions are additive (new optional fields) until v2.
- `RunTraceEvent` discriminated union per event type; payloads are append-only (INV-3).
- Cursor encode/decode round-trip is reversible, encodes the four-tuple `(timestamp, sequenceNumber, sourceTable, sourceId)`, opaque to clients.

**Tests.**

- Pure exhaustiveness for every literal union (compile-time and runtime).
- `deriveGateLevel`: all 7 tier values × {no preserved + no override, preserved auto/review/block, override auto/review/block} cover INV-8 floor preservation.
- `executionModeToEnvironment`: all five `ExecutionMode` inputs map to expected environment; exhaustiveness compile-time guard exercised.
- `PolicyEnvelopeSnapshot`: schema version pinned to `1`; required-field presence at type level.
- `RunTraceEvent`: cursor round-trip; discriminator narrowing for each event type.

**Error handling.** None — pure types and pure functions, no thrown errors.

**Acceptance.**

- Spec §9.1 acceptance items "All new test files exist and pass" for the five colocated test files (this chunk's slice).
- All five files are imported by chunks 2 (`controllerStyle`), 4 (`riskTier`, `executionEnvironment`), 6 (`policyEnvelope`), 7 (`runTraceEvent`), and 8 (`controllerStyle` + `runTraceEvent`).
- `npx tsc --noEmit` passes; `npx vitest run shared/types/__tests__` (the five new files) passes.

**Verification commands.**

- `npm run lint`
- `npm run typecheck`
- `npx vitest run shared/types/__tests__/controllerStyle.test.ts shared/types/__tests__/riskTier.test.ts shared/types/__tests__/executionEnvironment.test.ts shared/types/__tests__/policyEnvelope.test.ts shared/types/__tests__/runTraceEvent.test.ts`

---

### Chunk 2 — subaccount-agents-governance-migration

`chunk_name: chunk-2-subaccount-agents-governance-migration`
`spec_sections: §3.6 (closure: allowed_environments enforced in app-layer Zod), §5.2.9, §6.1, §9.1 (closure-acceptance bullet)`

**Purpose.** Ship the four governance columns on `subaccount_agents` plus their application-layer Zod closure. Schema + validation only — no UI and no runtime enforcement read sites yet (chunks 3, 4, and 9 will read or write through the new columns; chunk 9 ships the writing UI). Lands first in Phase 1A so the schema exists before chunk 3's controllerStyle resolver and chunk 4's policy-engine constraint enforcement try to read it.

**Files.**

- `migrations/0307_subaccount_agents_governance.sql` (new) — adds the four columns per spec §5.2.9 with conservative defaults (`controller_style_allowed = 'native_only'`; `allowed_environments = ARRAY['api_tool', 'headless', 'browser']`; `max_risk_tier = 3`; `require_approval_at_tier = 4`). Includes CHECK constraints on the two text columns and the two integer ranges; the `text[]` column closure is in Zod, not the DB (per §3.6).
- `migrations/0307_subaccount_agents_governance.down.sql` (new) — `ALTER TABLE subaccount_agents DROP COLUMN ...` for each new column. Sibling file in `migrations/`; do not place under `migrations/_down/` — repo convention is sibling files (see migration ordering section above).
- `server/db/schema/subaccountAgents.ts` (modified) — add the four Drizzle columns with matching defaults and `$type<>` annotations.
- The Zod schema file used by the existing `subaccount_agents` create/update routes (file name varies; chunk identifies it via existing `SubaccountAgentEditPage` POST/PATCH handler — likely `server/routes/subaccountAgents.ts` and a colocated `*.schema.ts` if one exists; otherwise extend in-route Zod) — add the closed-enum validator on `allowed_environments` rejecting any element outside `'api_tool' | 'headless' | 'browser' | 'terminal_repo'`.
- `server/db/schema/__tests__/subaccountAgentsGovernance.test.ts` (new, Vitest) — pure-shape test asserting the Drizzle types compile against the four new columns and that the Zod schema rejects an invalid `allowed_environments` element.

**Dependencies.** Chunk 1 (imports `ExecutionEnvironment`, `ControllerStyle` for the Zod schema's enum closure).

**Contracts.**

- New columns on `subaccount_agents`: `controller_style_allowed`, `allowed_environments`, `max_risk_tier`, `require_approval_at_tier`. RLS inherited (the table is already in `RLS_PROTECTED_TABLES`).
- Application-layer Zod backstop on `allowed_environments`: `z.array(z.enum(['api_tool', 'headless', 'browser', 'terminal_repo']))`.
- No new error codes (Zod failures use the existing route validation error path).

**Tests.**

- Pure shape test: Drizzle inferSelect type includes the four new fields; Zod schema rejects a literal `'sandbox'` element on `allowed_environments` (closure backstop test, durable evidence per spec §9.1 closure bullet).

**Error handling.**

- Zod rejection on invalid `allowed_environments` element returns the standard 400 from the existing route-validation middleware.
- Migration is non-destructive (adds with defaults). Down migration drops columns; no data loss.

**Acceptance.**

- Spec §9.1: all four new columns exist on `subaccount_agents`.
- Spec §9.1 closure-acceptance bullet: app-layer rejection of invalid `allowed_environments` element verified by the new test.
- Defaults are correct: existing rows pick up `'native_only'`, `['api_tool', 'headless', 'browser']`, `3`, `4` automatically.
- `npx vitest run server/db/schema/__tests__/subaccountAgentsGovernance.test.ts` passes.

**Verification commands.**

- `npm run lint`
- `npm run typecheck`
- `npm run db:generate`
- `npx vitest run server/db/schema/__tests__/subaccountAgentsGovernance.test.ts`
- `npm run build:server`

---

### Chunk 3 — controller-style-field

`chunk_name: chunk-3-controller-style-field`
`spec_sections: §4.1.1–§4.1.12, §3.5 (foundation.controller_style.derived / .rejected log codes), §3.6 (closure for controller_style), §6.1`

**Purpose.** Add the `controller_style` column to `agent_runs`, ship the resolver, and plumb it through run creation and the loop dispatch. End-to-end functional addition; the only ungated user-visible change is the new column appearing on each new run. Per spec §4.1.6 the resolver reads `subaccount_agents.controller_style_allowed`, which lands in chunk 2 — so chunk 3 always runs against a DB that already has the governance columns.

**Files.**

- `migrations/0308_agent_runs_controller_style.sql` (new) — `ALTER TABLE agent_runs ADD COLUMN controller_style text NOT NULL DEFAULT 'native' CHECK (controller_style IN ('native', 'operator'));` + `CREATE INDEX agent_runs_controller_style_idx ON agent_runs(controller_style) WHERE controller_style = 'operator';`.
- `migrations/0308_agent_runs_controller_style.down.sql` (new) — `DROP INDEX agent_runs_controller_style_idx;` + `ALTER TABLE agent_runs DROP COLUMN controller_style;`. Sibling file in `migrations/`; do not place under `migrations/_down/`.
- `server/db/schema/agentRuns.ts` (modified) — adds `controllerStyle: text('controller_style').notNull().default('native').$type<'native' | 'operator'>()`.
- `server/config/controllerLimits.ts` (new) — `CONTROLLER_LIMITS: Record<ControllerStyle, ControllerLimits>` table per spec §4.1.5 (native: 25 / 1.0× / 20 / 'auto'; operator: 100 / 2.0× / 80 / 'review').
- `server/services/controllerStyleResolver.ts` (new) — `deriveControllerStyle(executionMode, controllerStyleAllowed, override?)`, `ControllerStyleNotAllowedForAgentError` class.
- `server/services/__tests__/controllerStyleResolverPure.test.ts` (new, Vitest) — covers the §4.1.6 spec table including the override-rejected and derivation-downgrade paths.
- `server/services/agentExecutionService.ts` (modified) — at run creation: read `subaccountAgent.controllerStyleAllowed` (from chunk 2's columns), invoke resolver, pass through optional override, set `controllerStyle` on the insert, emit `foundation.controller_style.derived` event with `{ runId, executionMode, controllerStyle, source }`. Replace the bare `MAX_LOOP_ITERATIONS` lookup at the loop site with `CONTROLLER_LIMITS[run.controllerStyle].maxLoopIterations`. Replace the bare token-budget read with `subaccountAgent.tokenBudgetPerRun * CONTROLLER_LIMITS[run.controllerStyle].defaultTokenBudgetMultiplier` at the call site that today reads `tokenBudgetPerRun`. Default-tool-call and approval-default-floor reads added at the same site.
- `server/routes/agentRuns.ts` (modified) — accept optional `controllerStyle` query/body param on the run-creation handler; pass through to the service. On `ControllerStyleNotAllowedForAgentError` return HTTP 422 with `{ errorCode: 'controller_style_not_allowed_for_agent', message }` and emit `foundation.controller_style.rejected`.

**Dependencies.** Chunk 1 (imports `ControllerStyle`, `ControllerLimits`). Chunk 2 (reads `subaccount_agents.controller_style_allowed` from the live row at run creation; chunk 3 cannot ship before chunk 2 because the resolver wire-up reads a column that does not exist until chunk 2 lands).

**Contracts.**

- New column `agent_runs.controller_style text NOT NULL DEFAULT 'native'` (closed enum via CHECK constraint).
- New partial index `agent_runs_controller_style_idx` on `controller_style = 'operator'`.
- `deriveControllerStyle` precedence: explicit override → executionMode default → subaccount-constraint downgrade-or-reject. Source string distinguishes them.
- New error class extends the existing route-error pattern (`{ statusCode: 422, message, errorCode: 'controller_style_not_allowed_for_agent' }`).
- New stable log codes: `foundation.controller_style.derived`, `foundation.controller_style.rejected`.

**Tests.**

- `controllerStyleResolverPure.test.ts` (this chunk authors) — five `executionMode` values × override path + undefined + default + downgrade + reject; verifies returned source for each path.
- Existing `agentExecutionService` tests must continue to pass with `controllerStyle = 'native'` default (regression; INV-2).

**Error handling.**

- `ControllerStyleNotAllowedForAgentError` thrown by service, mapped to HTTP 422 in route via standard `asyncHandler` error path. Body shape `{ errorCode, message }`.
- Migration is non-destructive; on rollback the down migration drops the index then the column. Existing rows unaffected (no backfill, per §4.1.8).
- Resolver throws only on the explicit-override-rejected path; derivation path never throws.
- Loop-limit lookup is total (`CONTROLLER_LIMITS` covers both literal values; TypeScript exhaustiveness ensures no third literal slips in).

**Acceptance.**

- Spec §9.1: `agent_runs.controller_style text NOT NULL DEFAULT 'native'` exists.
- Spec §7.6 scenario 1 prerequisite (Native run defaults preserved).
- Spec §7.6 scenario 2 prerequisite (Operator run picks up `maxLoopIterations: 100`).
- All existing `agentExecutionService` tests pass without modification (INV-2).
- `npx vitest run server/services/__tests__/controllerStyleResolverPure.test.ts` passes.

**Verification commands.**

- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` (to confirm Drizzle schema migration shape; do not run against the live DB).
- `npx vitest run server/services/__tests__/controllerStyleResolverPure.test.ts`
- `npm run build:server`

---

### Chunk 4 — risk-tier-sweep-and-derivation

`chunk_name: chunk-4-risk-tier-sweep-and-derivation`
`spec_sections: §0.5 (CI gate anchor), §4.2.1–§4.2.14, §3.5 (foundation.risk_tier.gate_derived log code), §3.6 (riskTier as config-level write — n/a runtime)`

**Purpose.** Annotate every action in `actionRegistry.ts` with a `riskTier`, integrate the tier into `policyEngineService`, ship the CSV artefact + the `verify-risk-tier-assigned.sh` CI gate, and add the subaccount-constraint enforcement (the fourth source value `'subaccount_constraint'`).

**Files.**

- `server/config/actionRegistry.ts` (modified) — extend `ActionDefinition` with `riskTier: RiskTier` (required at the type level per §4.2.5); assign a tier to each of the ~109 entries using the §4.2.3 rubric. The TypeScript compiler is the first guard; the CI gate is the second. Note the existing field is named `defaultGateLevel` (not `gateLevel`); chunk reads / preserves this when calling `deriveGateLevel`.
- `tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv` (new) — one row per action: `actionType, currentDefaultGateLevel, assignedRiskTier, derivedDefault, sourceIfDifferent, rationaleNote`. Authored alongside the registry edits; reviewed by the architect before merge per §4.2.6.
- `scripts/verify-risk-tier-assigned.sh` (new) — bash wrapper that execs `npx tsx scripts/verify-risk-tier-assigned.ts` (per §4.2.7 spec; the wrapper is needed because Node's CommonJS loader cannot import TypeScript directly, mirroring `scripts/verify-visibility-parity.sh`).
- `scripts/verify-risk-tier-assigned.ts` (new) — typed harness that imports `ACTION_REGISTRY` and exits non-zero with the list of slugs missing `riskTier`.
- `scripts/run-all-gates.sh` (modified) — register the new gate alongside existing entries.
- `server/services/policyEngineService.ts` (modified) — at decision evaluation, call the chunk-1 `deriveGateLevel` with `(action.riskTier, action.defaultGateLevel, policyOverride)`; then apply the two subaccount-constraint rules per §4.2.8 (downgrade-to-block on `riskTier > max_risk_tier`; upgrade-auto-to-review on `riskTier >= require_approval_at_tier`); emit `foundation.risk_tier.gate_derived` with `{ runId, actionSlug, riskTier, gateLevel, source }`. Add `'subaccount_constraint'` to the source union returned from this service (chunk 1's pure function still returns the three-value union; the service wraps it).
- `server/services/middleware/proposeActionMiddleware.ts` (modified) — pass `riskTier` and `gateLevelSource` through to the decision record so the `tool_security_decision` Run Trace event payload (chunk 7) carries them.
- `server/services/__tests__/policyEngineService.riskTier.test.ts` (new, Vitest) — covers the four §7.6 scenarios touching policy evaluation: tier-default block (scenario 3), preserved-existing preservation (scenario 4), max-risk-tier override-to-block, require-approval-at-tier upgrade-to-review (scenario 5).

**Dependencies.** Chunk 1 (imports `RiskTier`, `GateLevel`, `deriveGateLevel`, `ExecutionEnvironment`). Chunk 2 (reads `subaccount_agents.max_risk_tier`, `require_approval_at_tier` columns). Chunk 4 must NOT ship before chunk 2 because `policyEngineService` reads the new columns.

**Contracts.**

- `ActionDefinition.riskTier: RiskTier` is a required field (compile-time guarantee).
- New CI gate `verify-risk-tier-assigned.sh` registered in `scripts/run-all-gates.sh`. Failure blocks CI.
- `policyEngineService.evaluatePolicy` return shape extended with `{ riskTier, gateLevelSource }`. The four-source union is `'subaccount_constraint' | 'policy_override' | 'preserved_existing' | 'tier_default'`. Precedence per §4.2.8: subaccount block overrides everything; subaccount review-upgrade applies after pure derivation; pure derivation otherwise wins.
- New stable log code: `foundation.risk_tier.gate_derived`.
- CSV artefact at `tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv`. Architect sign-off required before merge per §9.5.

**Tests.**

- New unit test for the four §7.6 scenarios above.
- Existing `policyEngineService` tests continue passing; `defaultGateLevel` for every existing action is preserved (INV-8 regression).
- The CI gate is itself the durable test for "every action has a tier"; no separate Vitest authored for this.

**Error handling.**

- The gate exits non-zero with the missing-slug list; CI fails the build.
- `policyEngineService` does not throw on subaccount-constraint application; the constraint is applied as a transformation on the decision shape.
- A run referencing an action whose tier `> max_risk_tier` is gated to `block` at decision time; the existing block-handling pathway in `proposeActionMiddleware` carries the request through to the user-facing error.

**Acceptance.**

- Spec §9.1: all 110 actions have `riskTier` assigned (CI gate passes).
- Spec §9.2: `verify-risk-tier-assigned.sh` registered and green in CI.
- Spec §9.5: architect has signed off the CSV.
- Spec §7.6 scenarios 3, 4, 5 verified end-to-end during PR review.
- `npx vitest run server/services/__tests__/policyEngineService.riskTier.test.ts` passes.

**Verification commands.**

- `npm run lint`
- `npm run typecheck`
- `bash scripts/verify-risk-tier-assigned.sh` (the new gate, run targeted because this chunk authored it; CI runs the full gate suite per the test-gate policy).
- `npx vitest run server/services/__tests__/policyEngineService.riskTier.test.ts`
- `npm run build:server`

---

### Chunk 5 — credential-broker-facade

`chunk_name: chunk-5-credential-broker-facade`
`spec_sections: §4.3.1–§4.3.12, §3.5 (foundation.credential_broker.issued / .revoked log codes), §3.6 (delegated idempotency posture)`

**Purpose.** Ship the `CredentialBrokerService` facade with the five spec-required methods, migrate the three existing call sites off the underlying services, and emit the two new log codes. The facade is structural (delegating to existing services); the underlying mechanics are unchanged.

**Files.**

- `server/services/credentialBrokerService.ts` (new) — exports `credentialBrokerService` with five methods per spec §4.3.3 (`issueCredential`, `injectIntoEnvironment`, `revoke`, `audit`, `resolveAvailableCredentials`); imports `connectionTokenService` and `integrationConnectionService`; emits `foundation.credential_broker.issued` and `foundation.credential_broker.revoked` events.
- `server/services/__tests__/credentialBrokerService.test.ts` (new, Vitest) — pure-unit tests with mocked underlying services, verifying delegation correctness for each method.
- `server/routes/integrationConnections.ts` (modified) — replace direct `connectionTokenService.*` / `integrationConnectionService.*` calls with `credentialBrokerService.{audit, revoke, resolveAvailableCredentials}` per spec §4.3.5.
- `server/routes/webLoginConnections.ts` (modified) — replace direct calls with `credentialBrokerService.{issueCredential, revoke}`.
- `server/services/ieeExecutionService.ts` (modified) — replace direct `connectionTokenService.decryptForUse` (or equivalent injection path) with `credentialBrokerService.injectIntoEnvironment`.

**Dependencies.** None on this plan's other chunks (uses existing `connectionTokenService` and `integrationConnectionService`). Chunk 6 will consume `resolveAvailableCredentials` and so must follow chunk 5.

**Contracts.**

- Five-method facade with the type signatures pinned in spec §4.3.3.
- `IssuedCredential.authType` union includes `'oauth2' | 'api_key' | 'web_login'`; the comment in the file marks `'operator_session'` as Phase-3 forward-compatible (do NOT add the literal yet — only the comment).
- New stable log codes: `foundation.credential_broker.issued`, `foundation.credential_broker.revoked`.
- The facade does NOT re-implement RLS, OAuth refresh, advisory locks, or audit logging — these continue to fire from the underlying services (INV-11).

**Tests.**

- New unit test for the five methods with mocked underlying services. Verifies that each method calls the right underlying primitive with the right scoping fields and that the new events fire on `issueCredential` and `revoke`.
- Existing connection tests pass without modification (INV-2).

**Error handling.**

- Facade methods do not catch underlying errors — they propagate to callers, preserving existing semantics. Route handlers continue to use `asyncHandler`.
- Migration of three call sites is structural: signatures match the existing call shapes; no new error codes.

**Acceptance.**

- Spec §9.1: `CredentialBrokerService` exists at `server/services/credentialBrokerService.ts` with the five methods specified in §4.3.3.
- Spec §9.1: all call sites outside `connectionTokenService` and `integrationConnectionService` use the facade (verified by visual review during this chunk's PR; the deferred advisory gate per spec §11 is NOT shipped in Phase 2). PR review runs the following grep as a one-off mechanical check (not a CI gate): `grep -R "connectionTokenService\|integrationConnectionService" server --exclude="credentialBrokerService.ts" --exclude="connectionTokenService.ts" --exclude="integrationConnectionService.ts"` — output should contain no remaining direct call sites in route handlers, middleware, or other services.
- Spec §7.6 scenario 6 prerequisite (credentials issued via facade visible in audit log).
- `npx vitest run server/services/__tests__/credentialBrokerService.test.ts` passes.

**Verification commands.**

- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/__tests__/credentialBrokerService.test.ts`
- `npm run build:server`

---

### Chunk 6 — policy-envelope-resolver-and-snapshot

`chunk_name: chunk-6-policy-envelope-resolver-and-snapshot`
`spec_sections: §3.3 INV-9, §3.3 INV-19, §3.5 (foundation.policy_envelope.resolved / .resolution_failed), §4.5.1–§4.5.13, §6.1`

**Purpose.** Ship the `policy_envelope_snapshot` JSONB column on `agent_runs`, the resolver service, and the INV-19 fail-closed wiring at run start. Resolver must persist the snapshot before the agent loop starts; failure transitions the run to `failed`.

**Files.**

- `migrations/0309_agent_runs_policy_envelope.sql` (new) — `ALTER TABLE agent_runs ADD COLUMN policy_envelope_snapshot jsonb;` (nullable, no index per §4.5.3).
- `migrations/0309_agent_runs_policy_envelope.down.sql` (new) — `ALTER TABLE agent_runs DROP COLUMN policy_envelope_snapshot;`. Sibling file in `migrations/`; do not place under `migrations/_down/` even though spec body in places references that subfolder — repo convention is sibling files.
- `server/db/schema/agentRuns.ts` (modified) — adds `policyEnvelopeSnapshot: jsonb('policy_envelope_snapshot').$type<PolicyEnvelopeSnapshot | null>()`.
- `server/services/policyEnvelopeResolverPure.ts` (new) — pure helpers (tier-default mapping for `riskTierApprovalDefaults`, source-version hashing, snapshot composition from collected sources). No DB access.
- `server/services/policyEnvelopeResolver.ts` (new) — `resolvePolicyEnvelope(ctx)` aggregates six constraint sources per §4.5.5 (subaccountAgent constraints, org / subaccount spending policies, active policy rules, available credentials via `credentialBrokerService.resolveAvailableCredentials`, capability map, controller limits) and composes the v1 snapshot via the pure helper. Exports `PolicyEnvelopePersistFailedError`. Exports `persist(runId, snapshot)` performing the §4.5.6 state-based UPDATE: `UPDATE agent_runs SET policy_envelope_snapshot = $1 WHERE id = $2 AND policy_envelope_snapshot IS NULL`. Implements first-resolver-wins re-read on zero rows; throws `PolicyEnvelopePersistFailedError` only if both the UPDATE and the re-read fail.
- `server/services/__tests__/policyEnvelopeResolverPure.test.ts` (new, Vitest, pure unit) — tests for the pure helpers (tier-default mapping, source-version hashing, snapshot field assembly).
- `server/services/__tests__/policyEnvelopeResolver.test.ts` (new, Vitest, integration — one of the two carved-out integration tests per spec §7.2) — seeds a subaccount agent with known constraints (budgets, allowed skill slugs, active policy rules, integration connections, capability map), invokes the resolver, asserts every snapshot field matches the expected value across all six sources. Includes the mid-run mutation case (a constraint changes after snapshot write; snapshot remains unchanged) and the NULL-tolerance case (a legacy run with NULL snapshot reads cleanly).
- `server/services/agentExecutionService.ts` (modified) — at run creation, after the existing `INSERT INTO agent_runs ... RETURNING` (around lines 414–443 of the current file), invoke `resolvePolicyEnvelope` then `persist`. On thrown error or persist failure, emit `foundation.policy_envelope.resolution_failed` with `{ runId, error, sourceCounts? }`, transition the run to `status: 'failed'` with reason `policy_envelope_resolution_failed`, and abort before any tool call, LLM call, or IEE worker dispatch (INV-19). On success emit `foundation.policy_envelope.resolved` with `{ runId, schemaVersion, sourceCounts }`.

**Dependencies.** Chunk 1 (imports `PolicyEnvelopeSnapshot`, `ControllerStyle`, `RiskTier`, `ExecutionEnvironment`, `GateLevel`). Chunk 2 (subaccount governance columns feed the snapshot's `allowedEnvironments`, `maxRiskTier`, `riskTierApprovalDefaults`). Chunk 3 (controller_style on the run row, `CONTROLLER_LIMITS` for `controllerLimits` field). Chunk 4 (`deriveGateLevel` for per-tier defaults). Chunk 5 (`credentialBrokerService.resolveAvailableCredentials`).

**Contracts.**

- New column `agent_runs.policy_envelope_snapshot jsonb` (nullable; legacy rows stay NULL per §4.5.9).
- `PolicyEnvelopeSnapshot` v1 (chunk-1 type) is the only supported version.
- INV-19: agent loop never observes a NULL snapshot. Failure transitions the run to `failed` with reason `policy_envelope_resolution_failed`.
- INV-9: state-based UPDATE with `WHERE policy_envelope_snapshot IS NULL` is the immutability guard. First-resolver-wins on retry.
- New stable log codes: `foundation.policy_envelope.resolved`, `foundation.policy_envelope.resolution_failed`.
- New error class `PolicyEnvelopePersistFailedError`.

**Tests.**

- Pure unit (`policyEnvelopeResolverPure.test.ts`) covers tier-default mapping for all 7 tiers, source-version hash determinism, snapshot field assembly given mocked source inputs.
- Integration (`policyEnvelopeResolver.test.ts`) — one of the two carved-out integration tests permitted by §7.2. Seeds constraint sources, asserts complete snapshot. Includes the mid-run-mutation case and the NULL legacy case.
- Existing `agentExecutionService` tests must continue to pass, with the new resolver call path noop-tolerant when the snapshot is already populated (idempotent retry).

**Error handling.**

- Resolver throw → emit `.resolution_failed` log → transition run to `failed` with reason `policy_envelope_resolution_failed` → caller observes the failed run.
- Persist UPDATE returning zero rows → re-read existing snapshot → if read also fails, transition to `failed` and throw `PolicyEnvelopePersistFailedError`.
- Headline copy distinction (chunk 8 will render): "failed before execution" copy reserved for this fail-closed path; "blocked by policy" reserved for runs that reached a policy decision.

**Acceptance.**

- Spec §9.1: `agent_runs.policy_envelope_snapshot jsonb` column exists.
- Spec §9.1: `policy_envelope_snapshot` is populated on every new run (verified by sample of recent runs).
- Spec §9.4: `foundation.policy_envelope.resolved` and `foundation.policy_envelope.resolution_failed` codes emitted in expected scenarios.
- Spec §7.6 scenarios 1, 2 prerequisite (snapshot present on every new run).
- INV-19 enforced: a contrived resolver-failure case in the integration test sees the run terminate with the failure reason and zero tool calls.
- INV-19 trace visibility: an envelope-resolution-failed run is still queryable through Run Trace (chunk 7) and yields `run_started` + `run_terminated` events with no `tool_call` / `tool_result` / `llm_call` / `iee_step` events. This makes the fail-closed path auditable end-to-end.
- `npx vitest run server/services/__tests__/policyEnvelopeResolverPure.test.ts server/services/__tests__/policyEnvelopeResolver.test.ts` passes.

**Verification commands.**

- `npm run lint`
- `npm run typecheck`
- `npm run db:generate`
- `npx vitest run server/services/__tests__/policyEnvelopeResolverPure.test.ts server/services/__tests__/policyEnvelopeResolver.test.ts`
- `npm run build:server`

---

### Chunk 7 — run-trace-api-and-service

`chunk_name: chunk-7-run-trace-api-and-service`
`spec_sections: §3.3 INV-10, §3.5 (foundation.run_trace.queried), §3.6 (terminal-event guarantee + late-event predicate), §4.4.1–§4.4.14, §9.4 (alerting threshold)`

**Purpose.** Ship the read-only `GET /api/agent-runs/:runId/trace` endpoint and the underlying `runTraceService` that performs the UNION across the seven Phase 1 source ledger tables (routing_outcomes deferred to Phase 3), returning unified events with the policy envelope, controller style, and run summary.

**Files.**

- `server/services/runTraceService.ts` (new) — `query(q: RunTraceQuery): Promise<RunTraceResult>` per spec §4.4.6. Builds the UNION ALL query across the seven Phase 1 source tables (per §4.4.1: `agent_execution_events`, `delegation_outcomes`, `tool_call_security_events`, `review_audit_records`, `actions`, `llm_requests`, `iee_steps`); `agent_runs` is read separately to synthesise the `run_terminated` event. `routing_outcomes` is excluded from the UNION because it has no `run_id`/`agent_run_id` column; reintroducing `routing_path_chosen` is deferred to Phase 3 alongside canonical ledger consolidation. Applies cursor predicate per §4.4.5 (four-tuple `(timestamp, COALESCE(sequence_number, 0), source_table, source_id)`). Applies the `toolSlug` per-table predicate table per §4.4.5. Synthesises the `run_terminated` event from `agent_runs.status` reaching a `TERMINAL_RUN_STATUSES` value (sourced from `shared/runStatus.ts`), with timestamp from `completed_at` falling back to `updated_at` (§4.4.4 pin). Marks any event whose own row-level timestamp is greater than the resolved terminal timestamp as `late: true` in its payload. Reads the `policy_envelope_snapshot` from `agent_runs` and returns it in the result. Computes `summary` (final status, total cost cents, total duration ms, event counts). Emits `foundation.run_trace.queried` with `{ runId, eventCount, latencyMs, filters }`. Wraps the call in an `agent.run.trace_queried` Langfuse span.
- `server/services/__tests__/runTraceService.test.ts` (new, Vitest, integration — second carved-out integration test per §7.2) — seeds events across the seven Phase 1 source tables (routing_outcomes deferred to Phase 3) for a synthetic run; asserts ordering tiebreaker, cursor stability across requests, `toolSlug` filter behaviour, terminal event uniqueness (exactly one per run), `late: true` marking on late events, and snapshot embedding.
- `server/routes/agentRuns.ts` (modified) — register `router.get('/:runId/trace', authenticate, asyncHandler(...))` per spec §4.4.7; parse query parameters via Zod (`cursor?`, `limit?`, `eventTypes?`, `sinceTimestamp?`, `untilTimestamp?`, `toolSlug?` — defaults `limit = 50`, max `200`); call `runTraceService.query` with `req.orgId`; return the result. Standard route conventions apply (`authenticate`, org scoping, no direct DB access).

**Dependencies.** Chunk 1 (`RunTraceEvent`, cursor encode/decode). Chunk 3 (`controller_style` returned in response). Chunk 4 (`tool_security_decision` event payload includes `riskTier` and `gateLevelSource`). Chunk 6 (`policy_envelope_snapshot` returned in response).

**Contracts.**

- New endpoint `GET /api/agent-runs/:runId/trace` per §4.4.3 contract. Response shape: `{ runId, events, pagination, envelope, controllerStyle, summary }`.
- Read-only (INV-10). No write paths exposed.
- Pagination defaults: `limit = 50`, `max = 200`. Cursor is opaque, encodes the four-tuple.
- `toolSlug` filter applies per-table per the spec §4.4.5 table; events from excluded source tables are filtered out when `toolSlug` is set.
- Exactly one `run_terminated` event per run; terminal timestamp sourced per §4.4.4 pin.
- Late events marked `late: true` in payload; ordered after the terminal event.
- New stable log code: `foundation.run_trace.queried`. Alerting threshold (p95 > 500ms) wired into observability.
- Standard `authenticate` middleware; org-scoped via `req.orgId`; RLS at DB layer.

**Tests.**

- Integration (`runTraceService.test.ts`) — second carved-out integration test. Seeds 50–100 events across the seven Phase 1 source tables (routing_outcomes deferred to Phase 3); asserts:
  - Total event count and per-type counts.
  - Cursor pagination is stable across two sequential page requests with overlapping timestamps.
  - `toolSlug` filter excludes irrelevant source tables and filters to matching rows in tool-scoped tables.
  - Exactly one `run_terminated` event when the seeded run is terminal.
  - A seeded constituent-ledger event with timestamp greater than `completed_at` is marked `late: true` and ordered after the terminal event.
  - Response includes `envelope`, `controllerStyle`, `summary`.
- Existing RunTracePage rendering tests pass with the new endpoint (chunk 8 may add minor adjustments).

**Error handling.**

- 401, 403, 404 standard via existing route middleware.
- Service throws on invalid cursor → 400 from route handler with `{ errorCode: 'invalid_run_trace_cursor', message }`.
- Latency above the alerting threshold is a runtime signal, not a thrown error; the threshold lives in observability config (chunk 7 wires the log code; alert rule registration is part of the standard observability tooling).
- No new HTTP mappings for `23505` (spec §3.6 confirms no new unique constraints).

**Acceptance.**

- Spec §9.1: `GET /api/agent-runs/:runId/trace` returns the unified event stream per §4.4.3.
- Spec §9.4: `foundation.run_trace.queried` emitted on every query; alerting threshold (p95 > 500ms) wired up.
- Spec §7.6 scenarios 1–7 prerequisite: the endpoint returns the events the scenarios assert on (UI verification in chunk 8).
- `npx vitest run server/services/__tests__/runTraceService.test.ts` passes.

**Verification commands.**

- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/__tests__/runTraceService.test.ts`
- `npm run build:server`

---

### Chunk 8 — run-trace-headline-ui

`chunk_name: chunk-8-run-trace-headline-ui`
`spec_sections: §4.4.8, §5.1.1–§5.1.5, §4.5.6 (failed-before-execution copy)`

**Purpose.** Migrate `RunTracePage.tsx` to consume the new `/api/agent-runs/:runId/trace` endpoint, render the unified event stream, and add the one-line headline component above the existing tree view. Headline shows controller style, approval status, duration, cost.

**Files.**

- `client/src/lib/api/runTrace.ts` (new) — typed fetch wrapper for `GET /api/agent-runs/:runId/trace` returning `RunTraceResult` (chunk-1 type).
- `client/src/lib/runTraceFormatters.ts` (new) — pure formatters for duration ("45 seconds", "2 min 14 sec"), cost ("$0.08"), controller label ("Native run" / "Operator run"), approval-status label ("auto-approved" / "approved by [name]" / "awaiting approval" / "blocked by policy" / "failed before execution" / "failed").
- `client/src/lib/__tests__/runTraceFormatters.test.ts` (new, Vitest) — pure-function tests covering every formatter and every approval-status label including the §4.5.6 failed-before-execution distinction.
- `client/src/components/run-trace/RunTraceHeadline.tsx` (new) — composes the formatters into the one-line badge per §5.1.3 design. No "Details" link in Phase 1 per §5.1.4.
- `client/src/pages/operate/RunTracePage.tsx` (modified) — switch from the existing client-side join orchestration to the new endpoint; render `<RunTraceHeadline ... />` above the existing tree view; preserve the existing tree-of-tool-calls view by filtering the unified stream for tool events.
- `client/src/components/run-trace/RunTraceEventRenderer.tsx` (modified) — add renderers for the new event types: `controller_style_decided`, `policy_envelope_resolved`, `tool_security_decision` (now showing `riskTier` and `gateLevelSource`), and surface the `late: true` marker on late events.

**Dependencies.** Chunk 7 (the endpoint). Chunk 1 (`RunTraceEvent`, `RunTraceResult`-shaped types). Chunk 3 (controller_style on response). Chunk 6 (envelope on response).

**Contracts.**

- Headline copy strictly follows §5.1.3 variants and §5.1.4's "no Details link in Phase 1" rule.
- "Failed before execution" copy reserved for the INV-19 fail-closed path (envelope resolution failure); "Blocked by policy" reserved for runs that reached a policy decision and were denied; "Failed" for runs that started, executed at least one step, then errored.
- Predicate for the "failed before execution" label (formatter must apply this exactly; do not infer from `final_status === 'failed'` alone): `final_status === 'failed' && failure_reason === 'policy_envelope_resolution_failed' && trace contains zero tool_call, tool_result, llm_call, and iee_step events`. Any run failing all three checks falls back to the generic "Failed" label.
- Backend detail (Risk Tier number, Policy Envelope JSON, model name, execution mode label) NOT shown in headline per §5.1.3.
- Approval-status label hides for "Native run" silent case per §5.1.3 (most-common case).
- No em-dashes in any UI copy (project-wide rule).

**Tests.**

- Pure formatter unit tests for every formatter (per §7.2 inventory).
- Existing RunTracePage rendering tests pass with the new endpoint (regression).
- No new component tests authored (per spec §7.1 framing — no frontend tests beyond the formatter pure tests).

**Error handling.**

- API client wraps fetch errors in the existing client-side error pattern. Failed fetch renders existing tree view fallback / error state.
- `late: true` marker is rendered visually but doesn't affect ordering (events already ordered per chunk 7).
- Formatters tolerate `null` / `undefined` inputs (e.g., legacy run with `null` envelope renders "Snapshot unavailable (legacy run)" inline rather than throwing).

**Acceptance.**

- Spec §9.3: Run Trace UI shows the one-line headline above the existing tree view.
- Spec §7.6 scenarios 1, 2, 3, and §4.5.6 fail-closed path render correct headline copy.
- `npx vitest run client/src/lib/__tests__/runTraceFormatters.test.ts` passes.

**Verification commands.**

- `npm run lint`
- `npm run typecheck`
- `npx vitest run client/src/lib/__tests__/runTraceFormatters.test.ts`
- `npm run build:client`

---

### Chunk 9 — agent-config-four-tabs

`chunk_name: chunk-9-agent-config-four-tabs`
`spec_sections: §5.2.1–§5.2.9 (note schema lives in chunk 2; this chunk is UI only)`

**Purpose.** Add the four new tabs to the Agent Configuration page (Execution, Governance, Models and Identity, Integrations). The Execution tab writes to `controller_style_allowed` and `allowed_environments`; Governance writes to `max_risk_tier` and `require_approval_at_tier`; Models and Identity ships with grayed-out placeholder rows labelled "Phase 3 — coming soon" per §12.6; Integrations reuses or formalises existing connection toggles.

**Files.**

- `client/src/pages/admin/SubaccountAgentEditPage.tsx` (modified) — add four new tabs, reorganise existing tabs (Scheduling becomes a "Advanced scheduling" disclosure inside the Execution tab per §5.2.3 mockup); preserve all existing tabs (Skills, Instructions, Budget, Beliefs, Identity, Activity); existing scheduling fields stay reachable via the disclosure.
- `client/src/components/agent-config/ExecutionTab.tsx` (new) — controllerStyle-allowed checkbox ("Allow Operator mode for this agent?"), `allowed_environments` checkboxes (API and Tool, Headless, Browser, Sandbox/Phase 2 grayed, Terminal and Repo gated for system-agents-only), Advanced scheduling disclosure.
- `client/src/components/agent-config/GovernanceTab.tsx` (new) — Risk Tier limit dropdown (0–6), require-approval checkbox (Tier 4+ default per spec mockup), Phase 1.5 placeholder for escalation rules.
- `client/src/components/agent-config/ModelsIdentityTab.tsx` (new) — model selector dropdown (existing surface formalised); grayed-out placeholder rows for Operator Session Identity (Phase 3) and BYO API keys (Phase 1.5) per §12.6 RESOLVED decision.
- `client/src/components/agent-config/IntegrationsTab.tsx` (new) — connection toggles (may reuse existing `CredentialsTab` patterns); "Credentials this agent can use" disclosure linking to subaccount-level credential management.

**Dependencies.** Chunk 2 (the four governance columns). Chunks 7 and 8 should ship first only because the spec sequences UI work (Phase 1D) after Phase 1B; functionally chunk 9 only needs chunk 2.

**Contracts.**

- Four new client component files; each is a self-contained tab component receiving the agent row and a save handler.
- Models and Identity Phase-3 placeholders ship grayed-out per §12.6 decision.
- Existing `subaccount_agents` PATCH route accepts the four new fields (Zod schema extended in chunk 2).
- No em-dashes in any UI copy (project-wide rule).

**Tests.**

- No new component tests (per spec §7.1 framing).
- Pure-function tests for any new formatters (none expected; this chunk is mostly form rendering).
- Manual verification at PR review for the §7.6 scenario-5 set-up (configuring `max_risk_tier` and `require_approval_at_tier` through the UI and seeing the policy engine pick them up).

**Error handling.**

- Form submission errors render via the existing client-side error pattern.
- The Zod schema (chunk 2) rejects invalid `allowed_environments` values; the UI's checkbox set produces only valid values, so this is a defence-in-depth check.

**Acceptance.**

- Spec §9.3: Agent Configuration has the four new tabs (Execution, Governance, Models and Identity, Integrations).
- Spec §12.6 RESOLVED: Phase-3 placeholder rows ship grayed-out with "Phase 3 — coming soon" label.
- §5.2.7 deferred items (Beliefs, per-agent cost limits, escalation rules matrix, BYO API keys) are NOT shipped in this chunk.

**Verification commands.**

- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

---

### Chunk 10 — approval-ux-risk-context-and-credentials-audit

`chunk_name: chunk-10-approval-ux-risk-context-and-credentials-audit`
`spec_sections: §5.3.1–§5.3.5, §5.4.1–§5.4.4, §3.6 (credential audit route idempotency posture)`

**Purpose.** Two related UI surfaces in one chunk: (1) Risk Tier and policy reason context on Review Queue items and Slack approval cards; (2) collapsed Audit Log section on the Credentials tab, backed by a new read-only `GET /api/subaccounts/:id/credential-audit` endpoint. Combined because both consume chunks 4 and 5 and ship at similar size.

**Files.**

- `client/src/components/review/ApprovalRiskContext.tsx` (new) — two-line context header for review items per §5.3.3 design ("Action: Send email to client (Tier 6, requires approval per policy)" + "Context: ..."). No em-dashes in copy.
- `client/src/pages/admin/ReviewQueuePage.tsx` (modified) — render `<ApprovalRiskContext ... />` at the top of each review item card.
- `server/services/slackConversationService.ts` (modified) — extend the Block Kit approval template to include the tier and policy reason per §5.3.4 design.
- `client/src/components/CredentialsAuditLog.tsx` (new) — collapsed-by-default audit log component per §5.4.3 design; fetches from the new endpoint; renders provider name, action label, timestamp.
- `client/src/components/CredentialsTab.tsx` (modified) — append `<CredentialsAuditLog ... />` section.
- `server/routes/credentials.ts` (new) — `GET /api/subaccounts/:id/credential-audit` route per §5.4.4 spec; route stack: `authenticate`, `resolveSubaccount(subaccountId, orgId)`, `requirePermission('credentials:audit:read')`, principal-scoped DB context. Read-only; calls `credentialBrokerService.audit({ organisationId, subaccountId, sinceTimestamp, limit })`.
- `server/index.ts` (modified) — register the new credentials router via `app.use(credentialsRouter)` alongside the existing `integrationConnectionsRouter` import/mount pair (verified at plan time: no existing `routes/credentials.ts`, so a parallel file is being created here for the first time). If a credentials route module appears between plan time and execution time, the executor extends that file instead of creating a parallel one.
- The existing permission registry file (e.g., `server/lib/permissions.ts` or `shared/permissions/index.ts` — chunk identifies the canonical file and registers `credentials:audit:read` slug there alongside existing credential-related slugs; adds the slug to the role-permission mapping for the subaccount-admin role).
- `client/src/components/__tests__/credentialsAuditLogFormatters.test.ts` (new, Vitest) — pure tests for any new formatter functions (provider names, action labels, timestamps).

**Dependencies.** Chunk 4 (`riskTier` and `gateLevelSource` returned from the policy decision; surfaced in review items and Slack). Chunk 5 (`credentialBrokerService.audit` is the read source for the audit log endpoint).

**Contracts.**

- New endpoint `GET /api/subaccounts/:id/credential-audit` per §5.4.4. Read-only; idempotency = safe; backed by `auditEvents` (already in `RLS_PROTECTED_TABLES`). Router mounted in `server/index.ts` so the route is reachable end-to-end (acceptance check below).
- New permission slug `credentials:audit:read` added to the registry and to the subaccount-admin role.
- Slack Block Kit template extended (existing service modified, no new template file).
- Review Queue card and Slack card both surface tier and policy reason text. Plain English copy per project frontend rules.
- No em-dashes in any UI copy.

**Tests.**

- Pure formatter tests for any new formatter functions in `CredentialsAuditLog`. The route handler relies on existing route-test conventions (no new route test file authored, per spec §7.2 footnote).

**Error handling.**

- Route handler uses `asyncHandler`; service errors throw as `{ statusCode, message, errorCode? }`.
- Permission failure returns standard 403.
- Component renders empty-state copy ("No credential events in the last 30 days") when the endpoint returns an empty list.

**Acceptance.**

- Spec §9.3: Approval UX shows risk tier and policy reason context in both Review Queue and Slack messages.
- Spec §9.3: Credentials tab has an Audit Log section (collapsed by default).
- Spec §7.6 scenario 6 verified: credentials issued via facade visible in Credentials audit log.
- Route reachability: `GET /api/subaccounts/:id/credential-audit` returns 200/empty for an authorised principal (mount in `server/index.ts` confirmed; not stranded as an unmounted file).
- `npx vitest run client/src/components/__tests__/credentialsAuditLogFormatters.test.ts` passes.

**Verification commands.**

- `npm run lint`
- `npm run typecheck`
- `npx vitest run client/src/components/__tests__/credentialsAuditLogFormatters.test.ts`
- `npm run build:server`
- `npm run build:client`

---

### Chunk 11 — naming-glossary-and-awareness-comments

`chunk_name: chunk-11-naming-glossary-and-awareness-comments`
`spec_sections: §3.4 INV-13 (no service-wide rename), §4.6.1–§4.6.11`

**Purpose.** Author the glossary document and add awareness comments to high-traffic files. **No code-level renames** (NG7 / INV-13). Documentation only.

**Files.**

- `docs/synthetos-nomenclature.md` (new) — full glossary per §4.6.3 structure: canonical-names table, when-to-use-which-name guidance, why-we-are-not-renaming-code rationale, cross-references.
- `architecture.md` (modified) — add cross-reference at the relevant section headers ("Orchestrator Capability-Aware Routing", "IEE Integrated Execution Environment", "Credentials" — minimum three places per §4.6.4).
- `server/jobs/orchestratorFromTaskJob.ts` (modified) — awareness comment at top: "Capability-Aware Orchestrator (aka 'Router and Execution Planner' per v1.2 brief)."
- `server/services/agentExecutionService.ts` (modified) — awareness comment at top: "executionMode = Execution Environment; controllerStyle = Controller per v1.2 brief."
- `server/services/policyEngineService.ts` (modified) — awareness comment: "Policy Engine is one component of Policy Envelope."
- `server/services/credentialBrokerService.ts` (modified — chunk 5 file) — awareness comment: "Credential Broker and Identity Boundary primitive."
- `server/services/runTraceService.ts` (modified — chunk 7 file) — awareness comment: "Run Trace virtual view; canonical ledger Phase 3+."
- `worker/src/handlers/browserTask.ts` (modified) — awareness comment: "IEE narrow scope today; expanded per v1.2."
- `worker/src/handlers/devTask.ts` (modified) — same comment.
- `client/src/pages/operate/RunTracePage.tsx` (modified — chunk 8 file) — awareness comment: "Run Trace UI; consumes new API contract."

**Dependencies.** All prior chunks (1–10). The glossary and awareness comments reference primitives by their final names; sequencing this chunk last keeps the glossary truthful.

**Contracts.**

- The glossary doc is the single source of truth for canonical names per §4.6.5.
- Awareness comments are 1–3 lines each at the top of each file or above the relevant export.
- `architecture.md` cross-references at section headers, not bulk rewrites (INV-13).

**Tests.** None (per §4.6.9, documentation has no unit tests).

**Error handling.** None (documentation only).

**Acceptance.**

- Spec §9.1: `docs/synthetos-nomenclature.md` exists and is referenced from `architecture.md`.
- Spec §9.5: glossary doc cross-referenced in `architecture.md`.
- All ten files listed above have their awareness comment.

**Verification commands.**

- `npm run lint`
- `npm run typecheck`

---

## Risks and mitigations

Pulled from spec §10 Risk Register, with chunk-level risks added.

### Spec §10 risks (carried forward)

| Risk | Likelihood | Impact | Mitigation | Owner chunk |
|---|---|---|---|---|
| Risk Tier misclassification changes existing approval behaviour silently | Medium | Medium | INV-8 mandates `defaultGateLevel` preservation when set; architect review of CSV before merge; spec §7.6 scenario 4 verifies preservation | Chunk 4 |
| Policy Envelope resolver misses a constraint source | Medium | Medium | Source manifest in snapshot; six-source aggregation listed explicitly in chunk-6 contract; integration test seeds all six sources | Chunk 6 |
| Run Trace endpoint performance regression at scale | Medium | High | Alerting threshold (p95 > 500ms) on `foundation.run_trace.queried`; cursor pagination; relies on existing `(run_id, ...)` indexes; canonical ledger consolidation already roadmapped (Phase 3+, NG4) | Chunk 7 |
| Legacy `agent_runs` rows display as "Native run" in Run Trace UI even when their `execution_mode` was operator-flavoured | Low | Low | Forward-only per §4.1.8, no retroactive backfill | Chunk 3 (no action) |
| CredentialBrokerService facade has subtle delegation bugs | Low | High | Underlying services unchanged; facade is structural; integration tests verify delegation; existing connection tests cover regression | Chunk 5 |
| New JSONB column on `agent_runs` causes table bloat | Low | Medium | Snapshot ~2-5KB per run; existing retention policy applies; monitor over first month | Chunk 6 |
| Migration locks `agent_runs` table during business hours | Low | High | Postgres 11+ `ADD COLUMN ... DEFAULT` is metadata-only; verify Postgres version on target; staging dry-run | Chunks 3, 6 |
| Glossary drift over time as code evolves | Medium | Low | Glossary is source of truth; future specs reference it; awareness comments anchor key files; periodic review (quarterly) | Chunk 11 (post-merge follow-up) |
| Foundation work overruns 4 weeks | Medium | Medium | Eleven chunks with explicit dependencies; can de-scope chunk 9 / 10 UI items if needed (defer to Phase 1.5) | Coordinator |
| UI changes overwhelm non-technical operators | Medium | Medium | Frontend design rules applied (default-hidden, plain language); §5.1.4 enforces no Details link in Phase 1 | Chunks 8, 9 |
| Coordination gap with Spec B (Support Desk Canonical) on Risk Tier conventions | Medium | Low | Section 4.2 establishes the rubric; Spec B references it | Chunk 4 |
| Operator loop limits (`maxLoopIterations: 100`) too high or too low for real workloads | Medium | Medium | Configurable per agent via `maxToolCallsPerRun`; monitor in production; tunable post-merge per §12.1 | Chunk 3 (post-merge follow-up) |

### New chunk-level execution risks (architect-spotted)

| Risk | Likelihood | Impact | Mitigation | Owner chunk |
|---|---|---|---|---|
| Risk Tier sweep CSV diverges from registry edits during the 110-action assignment | Medium | Medium | The CSV and the registry edits ship in the same chunk-4 PR; the CI gate (`verify-risk-tier-assigned.sh`) catches missing assignments; the architect signs off the CSV before merge per spec §9.5 | Chunk 4 |
| INV-19 fail-closed path causes unexpected `failed` runs in production at first deploy if a constraint source is mis-seeded | Low | High | Chunk-6 integration test exercises the failure path explicitly; `foundation.policy_envelope.resolution_failed` log code surfaces every occurrence; rollback plan = revert chunk 6 PR + run down migration | Chunk 6 |
| Subaccount-constraint precedence in `policyEngineService` (chunk 4) introduces a rule ordering bug that silently changes existing approval behaviour | Medium | Medium | Chunk-4 unit test covers all four cases (`scenario 4 preserved` + `scenario 5 max_risk_tier` + `scenario 5 require_approval_at_tier` + the combined case); existing `policyEngineService` regression suite must pass without modification | Chunk 4 |
| Run Trace UNION query (chunk 7) for runs with thousands of events stresses one of the seven Phase 1 source tables (routing_outcomes deferred to Phase 3) that lacks a `(run_id, ...)` index | Medium | High | Chunk 7's contract spells out the index reliance. If a source table is missing an index, chunk 7 does NOT silently add one — the executor escalates to operator/architect with the missing-index list, and the index ships either as an explicit spec amendment or is deferred until runtime telemetry (the new `foundation.run_trace.queried` p95 alert) proves need. The endpoint can ship using existing indexes; the alerting threshold is the first runtime signal | Chunk 7 |
| Chunk 8's `RunTracePage.tsx` migration breaks an existing UI feature (delegation graph, IEE polling, role-aware masking) because the new endpoint bundles state the old fetch paths used to scatter | Medium | Medium | Migration preserves the existing tree-view by filtering the unified stream; existing rendering tests must pass; manual verification at PR review hits the role-aware masking and IEE-polling paths | Chunk 8 |
| Permission registry edit in chunk 10 (`credentials:audit:read`) lands the slug in the wrong file because the project has multiple permission registry candidates | Low | Medium | Chunk 10's contract names this as the one open ambiguity to resolve at execution time; the chunk's PR identifies the canonical file before the rest of the changes land | Chunk 10 |
| Migration renumbering required if `main` introduces new migrations between plan time and execution time | Medium | Low | Migration numbers are renumbered in declared chunk order at execution; migration *content* is independent of number | All migration chunks |
| Builder lands chunk 4 assuming the existing column is named `gateLevel`, not `defaultGateLevel` | Low | Medium | The spec writes `gateLevel` as shorthand; the actual field is `defaultGateLevel` (verified by grep against `actionRegistry.ts`). Chunk 4 contract uses `defaultGateLevel` explicitly | Chunk 4 |

---

## Executor notes

- Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.
- The single exception is chunk 4's `bash scripts/verify-risk-tier-assigned.sh`, which is the new gate authored by THIS plan; the chunk runs it once locally to confirm the gate passes. CI runs the full gate suite as the pre-merge bar.
- Each chunk owns at most one new migration file (chunks 2, 3, 6 each own one). Migration numbers are assigned in chunk-execution order against the live `main` at execution time.
- Each chunk's "Verification commands" section lists ONLY: `lint`, `typecheck`, `build:server` / `build:client` when relevant, and targeted `npx vitest run <path-to-test>` for tests authored in that chunk.
- The §11 advisory CI gates (`verify-controller-style-mapping.sh`, `verify-no-direct-credential-service-calls.sh`) are explicitly NOT shipped in Phase 2 per spec §11 and the handoff.
- No service-wide renames anywhere in the plan (NG7 / INV-13). Chunk 11 is documentation only.

---

## End of plan
