# Implementation Plan — personal-assistant-v2-operator

**Status:** LOCKED 2026-05-13 — ready for `feature-coordinator` plan-gate
**Plan author:** `architect` (Phase 2 invocation)
**Plan date:** 2026-05-13
**Review rounds:** 2 (ChatGPT-web plan review; round 2 verdict: plan-gate ready after F1 / T2 applied)
**Spec:** `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md` (commit `e27a218a`, APPROVED)
**Brief:** `tasks/builds/personal-assistant-v2-operator/brief.md`
**Handoff:** `tasks/builds/personal-assistant-v2-operator/handoff.md`
**Build slug:** `personal-assistant-v2-operator`
**Branch:** `claude/personal-assistant-post-merge-audit`
**Scope class:** Major
**Ship model:** single Phase 2 branch; no scope split across branches.

## Contents

- Model-collapse check
- 1. Architecture notes
- 2. Chunk plan
  - Chunk 1a — Foundation: SQL schema + migrations + RLS manifest
  - Chunk 1b — Foundation: shared types + CI gate + capability-map extension + backfill
  - Chunk 2 — Routing context + matcher rule + addressing parser
  - Chunk 3 — Cross-owner delegation authorisation + request assembly + run-trace projection
  - Chunk 4 — Approval-owner routing + stall job + timeout-policy decision tree
  - Chunk 5 — Operator-mode EA enablement verification
  - Chunk 6 — Operator-session initial-context bundling
  - Chunk 7 — Live-file events: tool-call interceptor + bridge + UPSERT writer
  - Chunk 8 — Live-file events: sandbox-side filesystem watcher + path-safety
  - Chunk 9 — Doc-sync + KNOWLEDGE + ADR consideration
- 3. Risks and mitigations
- 4. Dependency graph
- 5. Executor notes

---

## Model-collapse check

The three questions answered before drafting:

1. **Does this feature decompose into ingest -> extract -> transform -> render?** No. V2 is plumbing: a controller-style flip, a JSONB scope axis, two new `RoutingContext` fields, a two-axis matcher rule, a cross-owner authorisation primitive, an approval-routing column, a tenant-scoped artefact-metadata table with concurrent UPSERT semantics, an operator-runtime tool-call interceptor, a sandbox-side filesystem watcher, and an initial-context bundler. None of those steps are "extract structured output from one prompt" work.
2. **Is each step doing something a frontier multimodal model could do in a single call?** No. Every step is deterministic plumbing (RLS, state machines, idempotent UPSERTs, credential broker resolution, pg-boss stall job). The single LLM-touching surface, initial-context bundling, is a deterministic 4 KB trim algorithm, not a model call.
3. **Decision: REJECTED.** V2 does not collapse into a single LLM call. Reasons: (a) RLS, credential broker, approval queue, and sandbox watcher are non-LLM primitives; (b) the cross-owner privacy projection is a deterministic security boundary that must not be delegated to a model's discretion; (c) auditability (the `delegation_outcomes.substep_status` state machine is consumed by jobs, routes, and the FE — a model-collapsed surface would have no replay trace).

Recorded decision: V2 ships as the nine-functional-chunk plan below (Chunk 1 split into 1a + 1b — see §2 chunk-decomposition note). No model-collapsed alternative is feasible.

---

## 1. Architecture notes

V2 is a composer build over `user-owned-agents` (#291), `personal-assistant-v1` (#291), and `operator-backend` (Spec D, #288). It adds five additive primitives and one ancillary helper. No new product surfaces, no new orchestrator branches.

**Design choices and what was rejected:**

- **Single new tenant-scoped table (`operator_run_files`), not an extension of `execution_files`.** `execution_files` is keyed on IEE executions (distinct lifecycle/domain). Reusing it would force dual-parent semantics. Rejected. (Spec §4.1, decision PA-V2-OP-S1 locked 2026-05-13.)
- **Extend `delegation_outcomes` for the cross-owner state machine, not a new state-machine table.** `delegation_outcomes` is already the delegation ledger; splitting state across two tables would lose colocation with the parent decision. Rejected the alternative. (Spec §4.1, decision PA-V2-OP-S2 locked 2026-05-13.)
- **UPSERT-derived version, not preflight existence lookup.** Two writers racing to the same path would both observe "no prior row" with preflight semantics and both emit `file.created`. The canonical UPSERT (`ON CONFLICT (agent_run_id, path) DO UPDATE SET version = operator_run_files.version + 1 RETURNING version`) makes Postgres serialise the conflict; event type derives from the returned `version`. (Spec §4.1, §5.7, §9.3.)
- **Read-time privacy projection (`runTraceProjectionForViewer`), not per-event write-time filtering.** Owner-side events stay in `agent_execution_events` unchanged; the projection chooses what to forward when the viewer is the initiator. Two-layer enforcement (service + route) is deliberate so a future direct consumer of `agentExecutionEventService` still gets the projection. (Spec §4.3, §5.4, §6.5.)
- **Two-axis routing in `RoutingContext` (`requester_user_id` + optional `target_owner_user_id`), not a single owner field.** Without the second axis, cross-owner delegation (Sarah asking about Michael's calendar) would filter Michael's PA out because `requester_user_id != owner_user_id`. (Spec §5.2.)
- **`approver_user_id` as an override-only column.** NULL preserves V1 initiator-defaulted semantics exactly; cross-owner proposals set it explicitly. Backfilling NULL rows would silently change V1 behaviour. (Spec §5.5.)
- **Inline session-start bundle assembly, not async.** The operator runtime needs the 4 KB bundle in its boot payload — deferring would race with first tool calls. (Spec §7.)

**Load-bearing invariants the build must preserve (every chunk audits against these):**

1. **Universal `OpenTaskView` + run-trace invariant.** Every controller surfaces through the same `OpenTaskView` primitives and the same event renderer. V2 adds four event variants and zero new visual chrome. (Spec §1, §4.6.)
2. **No EA-specific branching in the orchestrator.** Matcher, approval router, delegation path, and credential broker MUST work for any user-owned agent (stub Dev Agent acceptance fixture). (Spec §0.5, Appendix A.)
3. **Two-axis routing.** Matcher rule is `if c.capability_map.owner_user_id is set: target ?? requester` (Spec §5.2).
4. **Credentials follow the executor.** Sub-run resolves credentials with `ownerUserId = target_owner_user_id` via the existing broker (`user-owned-agents` §3.3 invariant).
5. **Approval routes to the owner.** Cross-owner action proposals set `approver_user_id = executor_agent.owner_user_id`; same row otherwise. (Spec §5.5.)
6. **Run-trace privacy projection.** Initiator views are filtered at read time by `runTraceProjectionForViewer`, applied at both service and route layers. Owner-side per-state timestamps are owner-private by default (opt-in allow-list). (Spec §5.4.)
7. **Single terminal event per `(parent_run_id, substep_id)`.** Row-level write-time predicate `UPDATE ... WHERE id = $2 AND terminal_at IS NULL` enforces uniqueness; partial index on `(run_id, substep_status) WHERE terminal_at IS NULL` supports it. (Spec §9.4.)
8. **UPSERT-derived `version`.** Tool-call and watcher paths both go through the canonical UPSERT; event type is `version === 1 ? 'file.created' : 'file.modified'`. Preflight lookups are watcher-dedupe-only, never event-type source. (Spec §5.7, §9.1.)
9. **Untrusted-client invariant.** `target_owner_user_id` is server-side-only. HTTP-supplied values are discarded before `RoutingContext` is built. (Spec §5.4.)

**Pattern selection:** existing primitives extended (capability-map JSONB axis, `delegation_outcomes` columns, `actions.approver_user_id`, RLS manifest, operator-event registry, `agentExecutionEventService` projection invocation). One new tenant-scoped table (`operator_run_files`) because no existing artefact-metadata primitive matches the run-keyed lifecycle. One new pure helper (`runTraceProjectionForViewer`) because no existing projection helper covers cross-owner viewer-role filtering. One new CI gate (`verify-capability-map-shape.sh`) because no existing gate enforces the new JSONB shape.

---

## 2. Chunk plan

The spec's §8 chunking is ratified with one split: **Chunk 1 is split into 1a (schema + migrations + RLS manifest) and 1b (shared types + CI gate + computeCapabilityMap extension + backfill)**. Rationale: spec §8 Chunk 1 modifies ~12 files spanning four logical responsibilities (data layer, type layer, RLS governance, capability-map projection). Splitting it produces two cleaner chunks that satisfy the feature-coordinator's `<= 5 files OR <= 1 logical responsibility` rule.

**Chunk 1a / 1b dependency:** 1a and 1b are independent in file scope (no shared edits). 1b depends on 1a for **sequencing discipline only** — 1a establishes the data-layer foundation that downstream chunks (3, 4, 7) consume, and 1b's CI gate is intentionally introduced after the foundation. The backfill in 1b updates JSONB values inside the existing `subaccount_agents.capability_map` column; **it does NOT depend on any new SQL column from 1a** (Chunk 1a does not touch `subaccount_agents`). The split is logical, not invented.

**Chunk 1a file-count exemption.** Chunk 1a intentionally exceeds the `<= 5 files` heuristic because migration pairs (`.sql` + `.down.sql`), the Drizzle TS schema (hand-written, must match the SQL), and the RLS manifest entry must land atomically — splitting these across chunks would leave the schema in an inconsistent intermediate state. Single logical responsibility: data-layer foundation.

Total chunks: **10** (1a, 1b, 2, 3, 4, 5, 6, 7, 8, 9).

### Chunk 1a — Foundation: SQL schema + migrations + RLS manifest

- **name:** `foundation-sql-schema-and-rls-manifest`
- **spec_sections:** §4.1, §4.3 (rlsProtectedTables row), §4.8 (operatorRunFiles schema row), §6.1, §9.1, §9.3, §9.4
- **prerequisites:** none
- **files (new):**
  - `migrations/0357_ea_controller_style_native_and_operator.sql` + `.down.sql` — EA seed + per-instance flip to `'native_and_operator'`; idempotent on the `controller_style_allowed = 'native_only'` predicate
  - `migrations/0351_actions_approver_user_id.sql` + `.down.sql` — `ADD COLUMN approver_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT`
  - `migrations/0352_delegation_outcomes_cross_owner_state.sql` + `.down.sql` — adds three columns (`cross_owner_approval_timeout_policy TEXT NULL` with CHECK on the three-value union, `substep_status TEXT NOT NULL DEFAULT 'proposed'` with CHECK on the ten-value union, `terminal_at TIMESTAMPTZ NULL`) and a partial index `(run_id, substep_status) WHERE terminal_at IS NULL`
  - `migrations/0353_operator_run_files.sql` + `.down.sql` — creates the `operator_run_files` table with UNIQUE `(agent_run_id, path)`, four CHECKs (`version >= 1`, `size_bytes >= 0`, `path <> ''`, `storage_key <> ''`), and the canonical org-isolation RLS policy filtering on the row's own `organisation_id` column
  - `server/db/schema/operatorRunFiles.ts` — Drizzle schema (leaf file; imports only `drizzle-orm`, `shared/types/**`, other schema files per DEVELOPMENT_GUIDELINES §3)
- **files (modified):**
  - `server/config/rlsProtectedTables.ts` — add `operator_run_files` manifest entry pointing to migration 0353 (`policyMigration: '0353_operator_run_files.sql'`)
  - `server/db/schema/actions.ts` — manually add the `approver_user_id` column definition matching migration 0351. Drizzle TS schema files are hand-written in this repo; `npm run db:generate` is a verification step (no-orphan-diff check), not a code generator.
  - `server/db/schema/delegationOutcomes.ts` — manually add the three new column definitions (`cross_owner_approval_timeout_policy`, `substep_status`, `terminal_at`) and the partial index, matching migration 0352.
  - **Audit at chunk start:** if `db:generate` produces any diff to OTHER schema files (unrelated to the migrations 0345 + 0351–0353 scope), stop and surface — that indicates pre-existing drift, not a 1a responsibility. Record the result in the chunk-close summary.
- **contracts:** `APPROVAL_ROW_V2` columns (§5.5 — column only, semantics in Chunk 4), `operator_run_files` row shape (§4.1, §5.7), `delegation_outcomes` state-machine columns (§4.1, §9.7)
- **error-handling strategy:**
  - Migration 0345: `state-based` idempotency via `WHERE controller_style_allowed = 'native_only'`; re-run is a no-op. Fails closed if the predicate column is absent (would indicate schema drift). (§9.1 row 1.)
  - Migrations 0351–0353: `state-based` via `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE POLICY IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. (§9.1 rows 2–3.)
  - Migration 0353 UPSERT path: `guarded` retry — UNIQUE `(agent_run_id, path)` (§9.2). Schema alone cannot fail at write time except via constraint violation (caught by Chunk 7 service).
  - rlsProtectedTables manifest: missing entry would fail `verify-rls-coverage.sh` at CI time (fail-closed).
- **acceptance criterion:** (§10 Acceptance criteria 1 prereq) typecheck + lint pass; `npm run db:generate` produces a clean diff (no unintended changes); migration files apply cleanly on a fresh DB; the `operator_run_files` RLS policy filters on `organisation_id` (no JOIN through `agent_runs`) and rejects rows when the GUC is unset; the partial index on `delegation_outcomes (run_id, substep_status) WHERE terminal_at IS NULL` exists; `server/config/rlsProtectedTables.ts` lists `operator_run_files` with the correct `policyMigration` pointer. CI's `verify-rls-coverage.sh` (CI-only) will catch missing manifest registration.
- **g1-checks:**
  - `npm run lint`
  - `npm run typecheck`
  - `npm run db:generate` (verify the migration files match Drizzle schema, no orphan changes)

### Chunk 1b — Foundation: shared types + CI gate + capability-map extension + backfill

- **name:** `foundation-shared-types-ci-gate-capability-map`
- **spec_sections:** §4.2 (computeCapabilityMapPure extension), §4.3 (capabilityMapService extension), §4.4 (new CI gate), §4.6 (shared types), §5.1, §5.2 (type-only — matcher logic ships in Chunk 2), §6.4
- **prerequisites:** Chunk 1a, for sequencing discipline. The backfill in this chunk updates JSONB values inside the existing `subaccount_agents.capability_map` column; **no new SQL column on `subaccount_agents` is required from 1a**. The CI gate `verify-capability-map-shape.sh` (newly introduced here) scans `subaccount_agents` rows; ordering after 1a keeps the foundation coherent across chunks 2/3/4/7 that share the same data layer.
- **files (new):**
  - **File-existence audit at chunk start.** The four `shared/types/*.ts` files listed below were verified absent at plan time (2026-05-13). If any of them have since landed in another branch, MODIFY in place instead of creating — drop the file from `files(new)` and add to `files(modified)`. Record the audit outcome in the chunk-close summary. Same audit applies to `actionServicePure.ts` in Chunk 4.
  - `shared/types/routingContext.ts` (new) — `RoutingContextV2` interface per §5.2 (NOTE: matcher behaviour ships in Chunk 2; this chunk lands the type only)
  - `shared/types/capabilityMap.ts` (new) — `CapabilityMapV2` JSONB shape per §5.1
  - `shared/types/operatorEvents.ts` (new) — declares four new event variants: `file.created`, `file.modified`, `cross_owner_substep.awaiting_initiator_decision`, `cross_owner_substep.completed`. (Note: this is a new namespace file distinct from the existing `shared/types/operatorBackendEvents.ts`, which holds the `operator-session.*` lifecycle family. The new variants are not in that namespace; they integrate via `AGENT_EXECUTION_EVENT_CRITICALITY` in `shared/types/agentExecutionLog.ts` — see modified-files row below.)
  - `shared/types/crossOwnerApproval.ts` (new) — `CrossOwnerApprovalTimeoutPolicy` literal union + two pause-reason constants per §5.6
  - `scripts/gates/verify-capability-map-shape.sh` — new CI gate per §4.4; enforces the five invariants from spec §5.1 + brief §3.3
  - `server/services/__tests__/capabilityMapServicePure.computeCapabilityMap.test.ts` — pure test for the `computeCapabilityMapPure` extension (asserts `owner_user_id` is emitted when `agentRow.owner_user_id` is set; absent when null; deterministic across input permutations per DEVELOPMENT_GUIDELINES §8.21)
  - `scripts/backfill-capability-map-owner-user-id.ts` (or extend an existing recompute script if present) — one-shot recompute of `subaccount_agents.capability_map` for all user-owned agents to emit `owner_user_id`. Idempotent (state-based: re-run leaves the same shape). Implemented as an admin+per-tenant `withOrgTx` job mirroring `memoryDedupJob.ts` per DEVELOPMENT_GUIDELINES §2.
- **files (modified):**
  - `shared/types/agentExecutionLog.ts` — append four entries to `AGENT_EXECUTION_EVENT_CRITICALITY` per §4.6: `file.created: false`, `file.modified: false`, `cross_owner_substep.awaiting_initiator_decision: true`, `cross_owner_substep.completed: true`
  - `server/services/capabilityMapService.ts` — extend `computeCapabilityMapPure(skills, integrationReference, agentRow)` to emit `owner_user_id` when `agentRow.owner_user_id` is non-null; add the recompute helper that runs in the same Drizzle transaction as an `agents.owner_user_id` update (§6.4 invariant). Matcher rule edits DEFER to Chunk 2.
- **contracts:** `CAPABILITY_MAP_V2` (§5.1), `ROUTING_CONTEXT_V2` type-only (§5.2), `OPERATOR_FILE_EVENT` type-only (§5.7), `CROSS_OWNER_APPROVAL_TIMEOUT_POLICY` (§5.6), four new entries in `AGENT_EXECUTION_EVENT_CRITICALITY` (§4.6).
- **error-handling strategy:**
  - `computeCapabilityMapPure` extension: pure function — total over its inputs; missing `owner_user_id` returns the same shape as today (omits the field). `safe` retry class.
  - Recompute path: `state-based` (full-replace within the same transaction); §9.1 row 4.
  - Backfill script: idempotent re-run; fails closed on any user-owned agent whose `owner_user_id` references a deleted user (matches the gate's invariant — explicit error, not silent skip). Uses `withOrgTx` per tenant write per DEVELOPMENT_GUIDELINES §2; never a single shared admin tx across all orgs.
  - CI gate `verify-capability-map-shape.sh`: fail-closed on any drift; returns non-zero exit when any row violates the five invariants. Locally never invoked; runs in CI.
- **acceptance criterion:** typecheck + lint pass; the new `computeCapabilityMapPure` pure test passes; the backfill script runs locally against a seeded DB and leaves every user-owned agent with `capability_map.owner_user_id` matching `agents.owner_user_id`; the gate script file exists with executable permission and matches the `scripts/verify-*.sh` shape (header comment, exit-code contract, scan-path env var if relevant). The `AGENT_EXECUTION_EVENT_CRITICALITY` registry contains the four new entries — `verify-operator-event-registry.sh` (CI-only) will catch any missing registration.
- **g1-checks:**
  - `npm run lint`
  - `npm run typecheck`
  - `npx vitest run server/services/__tests__/capabilityMapServicePure.computeCapabilityMap.test.ts`

### Chunk 2 — Routing context + matcher rule + addressing parser

- **name:** `routing-context-matcher-and-addressing`
- **spec_sections:** §4.3 (capabilityMapService, capabilityDiscoveryHandlers, skillExecutor, integrationReferenceService audit), §5.2, §5.3, Appendix A
- **prerequisites:** Chunk 1b (the matcher rule reads `capability_map.owner_user_id`, which Chunk 1b's recompute writes; the `RoutingContextV2` type lands in 1b)
- **files (new):**
  - `server/services/__tests__/capabilityMapServicePure.routing.test.ts` — concrete fixtures for the four Appendix A routing scenarios (direct-owner, cross-ownership, approval-owner, ambiguous-fail-closed). The test asserts routing OUTCOMES per Appendix A prose-wins rule.
- **files (modified):**
  - `server/services/capabilityMapService.ts` — extend `matchCapability(routingContext, candidates)` with the two-axis owner-scope rule (§5.2). Audit during implementation: confirm the score scale is `[0, 1]`; if not, recalibrate the 0.15 address-boost magnitude proportionally inside `matchCapability` (§5.3 footnote).
  - `server/tools/capabilities/capabilityDiscoveryHandlers.ts` — propagate `requester_user_id` from the authenticated request principal into the `RoutingContext`; parse `@PA` / `@MyAssistant` / `@<DisplayName>` and populate `addressed_agent` + `address_parse_result`; **discard any client-supplied `target_owner_user_id` on the inbound payload** before building `RoutingContext` (§5.4 untrusted-client invariant — security-critical). **Chunk 2 does NOT resolve `target_owner_user_id`.** The field is supported on `RoutingContext` if already populated by a trusted upstream (matcher rule honours it per §5.2), but actual derivation from intent text or tool-call payload via `crossOwnerDelegationAuthorisation` lands in Chunk 3. This avoids a backward dependency on a Chunk 3 module. Until Chunk 3 ships, `target_owner_user_id` will simply be undefined on inbound requests, and the matcher falls back to the `requester` arm of the §5.2 rule.
  - `server/services/skillExecutor.ts` — AUDIT ONLY. If `context` object plumbing for `requester_user_id` is needed, additive change here. No-op expected. (Spec §4.3 row.)
  - `server/services/integrationReferenceService.ts` — AUDIT ONLY. Drop from the changed-files list if the audit confirms no change needed.
- **contracts:** Matcher rule (§5.2) with score-boost 0.15; `ADDRESSING_PARSE_RESULT` (§5.3); `@<DisplayName>` resolver uses the existing capability-discovery visibility helper (audit in this chunk per spec §5.3 — if no shared helper exists, the resolver falls back to `organisation_id = $org AND subaccount_id = routingContext.subaccountId AND deleted_at IS NULL`, NOT org-wide, and surfaces the gap to the chunk's audit log).
- **error-handling strategy:**
  - Matcher: pure, deterministic, `safe` retry class (§9.2). A candidate that fails capability matching cannot be promoted by the address boost (§5.3 acceptance criterion).
  - Address parser: `not_found` / `collision` / `unsupported_cross_owner` are NORMAL paths, not errors. They are recorded on `address_parse_result` for run-trace diagnostics; no exception thrown.
  - Untrusted-client filter: client-supplied `target_owner_user_id` is silently DROPPED (not 400'd) so legitimate clients that include the field by mistake don't see an opaque error; the spec treats this as defence-in-depth, with the security boundary in server-side derivation. Log at `debug` level for diagnostic visibility (no empty catches per DEVELOPMENT_GUIDELINES §8.36).
- **acceptance criterion:** typecheck + lint pass; pure-function vitest passes on all four Appendix A fixtures. **No-EA-branching invariant (narrowed scope):** grep returns zero hits for `executive-assistant` in `capabilityMapService.matchCapability`, the approval router, and the delegation path; the four fixtures must pass for a stub Dev Agent with equivalent `capability_map`. **Legitimate exception:** the `@PA` / `@MyAssistant` alias resolver references `system_agent_slug = 'executive-assistant'` per spec §5.3 line 320 — this is alias semantics (resolve `@PA` to the requester's owned PA), not orchestrator branching, and is allowed. `@<DisplayName>` collision returns `{ kind: 'collision', candidates: [...] }` without applying score boost; `@<User>'s PA` returns `'unsupported_cross_owner'`.
- **g1-checks:**
  - `npm run lint`
  - `npm run typecheck`
  - `npx vitest run server/services/__tests__/capabilityMapServicePure.routing.test.ts`

### Chunk 3 — Cross-owner delegation authorisation + request assembly + run-trace projection

- **name:** `cross-owner-delegation-and-privacy-projection`
- **spec_sections:** §4.2, §4.3 (agentExecutionEventService, taskEventStream, agentRuns), §5.4, §6.5
- **prerequisites:** Chunk 2 (matcher must route correctly before delegation routes a sub-step)
- **files (new):**
  - `server/services/crossOwnerDelegationAuthorisation.ts` — two-layer authorisation signal detection. Inputs: `RoutingContext` (Layer 1 = `normalised_intent_text` parser, Layer 2 = trusted parent-agent tool-call payload). Returns `{ authorised: true, target_owner_user_id, signal }` or `{ authorised: false, clarifying_question: string }`.
  - `server/services/crossOwnerDelegationAuthorisationPure.ts` — pure rules: regex set for possessives (`"Michael's calendar"`, `"my colleague Jane's inbox"`), known-user resolution against subaccount membership, normalisation. Pure: no DB.
  - `server/services/crossOwnerDelegationRequestAssembler.ts` — assembles the complete `CROSS_OWNER_DELEGATION_REQUEST` (§5.4) including `required_capabilities`, `delegation_scope`, `cross_owner_approval_timeout_policy`. Owns the WRITE of `delegation_outcomes.cross_owner_approval_timeout_policy` (column from migration 0352 per Chunk 1a).
  - `server/services/crossOwnerDelegationRequestAssemblerPure.ts` — pure derivation rules for `delegation_scope` and `cross_owner_approval_timeout_policy` (default `'fail_parent'`; `'continue_without_substep'` when parent tool-call sets `{ optional: true }`; `'ask_initiator'` only when parent emits explicit fallback signal).
  - `server/services/runTracePure.ts` — exports `runTraceProjectionForViewer(viewerUserId, run)`. Pure projection helper enforcing §5.4 + §5.7 cross-owner privacy invariants. Allow-list-driven (timestamp fields are opt-in per §5.4 final paragraph — any new owner-side timestamp column added later is owner-private by default).
  - `server/services/__tests__/crossOwnerDelegationAuthorisationPure.test.ts` — Layer 1 / Layer 2 / fail-closed fixtures.
  - `server/services/__tests__/crossOwnerDelegationRequestAssemblerPure.test.ts` — timeout-policy derivation, `delegation_scope` inheritance.
  - `server/services/__tests__/runTracePure.viewerProjection.test.ts` — asserts owner sees full trace, initiator sees coarse status only, raw owner data blanked when `viewerUserId !== run.ownerUserId`. **Includes an idempotency fixture: applying `runTraceProjectionForViewer` twice to the same input MUST yield the same output as applying it once** (no field-allow-list regression where the second pass drops a field the first pass preserved). This protects the deliberate two-layer enforcement at service + route from accidentally producing different shapes.
  - Implementer's discretion (handoff §1 open item 2): split `runTraceProjectionForViewer` out of `runTracePure.ts` into its own `*Pure.ts` file if test surface warrants. Leave as judgement call; do not over-prescribe.
- **files (modified):**
  - `server/services/agentExecutionEventService.ts` — invoke `runTraceProjectionForViewer(viewerUserId, run)` on every cross-owner run-trace fetch (paginated read, replay, snapshot) BEFORE returning to the route layer. Existing service; only adds the projection invocation. Viewer ID source is the existing principal context this service already accepts; no new parameter plumbing.
  - `server/routes/taskEventStream.ts` — SSE/WebSocket bridge for the `agent-run` channel; add the same projection invocation on outbound event frames. **Two-layer enforcement is deliberate** (spec §5.4) — both the service and the route apply the projection so a future direct consumer of `agentExecutionEventService` that bypasses the route still gets filtered output. This is an architectural risk to surface (see §3 risks).
  - `server/routes/agentRuns.ts` — same projection invocation on HTTP read endpoints; cross-owner runs MUST NOT serialise raw owner-side payloads. Routes use `asyncHandler` per architecture.md routing convention; service errors throw `{ statusCode, message, errorCode? }`.
  - `server/tools/capabilities/capabilityDiscoveryHandlers.ts` — picks up the `target_owner_user_id` derivation deferred from Chunk 2: invoke `crossOwnerDelegationAuthorisation.authorise(...)` against `normalised_intent_text` (Layer 1) or a trusted parent-agent tool-call payload (Layer 2); on `{ authorised: true }`, populate `RoutingContext.target_owner_user_id`; on `{ authorised: false }`, surface the clarifying question through the existing disambiguation flow rather than routing. The `requester_user_id` propagation and `@` parser already landed in Chunk 2; this is an additive edit only.
- **contracts:** `CROSS_OWNER_DELEGATION_REQUEST` (§5.4); `runTraceProjectionForViewer` signature `(viewerUserId: string, run: Run) => Run` (allow-list-driven; opt-in timestamps; **idempotent — applying twice yields the same output as applying once**, so the deliberate service+route two-layer enforcement does not double-strip fields). Producer/consumer per §5.4.
- **error-handling strategy:**
  - Authorisation: returns a sum type. No throws. Fail-closed when both layers return false — orchestrator surfaces clarifying question.
  - Assembler: throws when `target_owner_user_id` is missing (programmer error — caller should have run authorisation first). Caught at the orchestrator boundary as a `{ statusCode: 500, message, errorCode: 'cross_owner_assembler_precondition' }` per architecture convention.
  - Projection: pure function, total over inputs. Throws on missing `viewerUserId` (programmer error — never called from a code path without a viewer). Allow-list is HARD — any timestamp field not in the allow-list is dropped. Adding a new owner-side timestamp column requires explicit allow-list edit + spec amendment (§5.4 final paragraph).
  - Two-layer enforcement (service + route): if either layer is bypassed by future code, the other catches it. Architectural risk — surfaced in §3.
- **acceptance criterion:** typecheck + lint pass; the three new pure tests pass; running `grep -r "executive-assistant" server/services/crossOwner*.ts server/services/runTracePure.ts` returns zero hits (no-EA-branching invariant); the pure projection test confirms that when `viewerUserId !== run.ownerUserId`, owner-private fields (`raw calendar payload`, `inbox snippets`, `draft bodies`, `attachment names`, per-state timestamps not on the allow-list) are blanked from the projected output.
- **g1-checks:**
  - `npm run lint`
  - `npm run typecheck`
  - `npx vitest run server/services/__tests__/crossOwnerDelegationAuthorisationPure.test.ts`
  - `npx vitest run server/services/__tests__/crossOwnerDelegationRequestAssemblerPure.test.ts`
  - `npx vitest run server/services/__tests__/runTracePure.viewerProjection.test.ts`

### Chunk 4 — Approval-owner routing + stall job + timeout-policy decision tree

- **name:** `approval-owner-routing-and-stall-job`
- **spec_sections:** §4.3 (actionService, workflowGateStallNotifyJob), §5.5, §5.6, §9.1 (idempotency rows), §9.7 (state machine — `awaiting_cross_owner_approval` / `approved` / `rejected` transitions)
- **prerequisites:** Chunk 3 (delegation authorisation must precede approval routing; the assembler decides timeout policy)
- **POST-MERGE INTEGRATION NOTE (added after main-sync merge `66fce3d4`, 2026-05-13):** PR #296 (close deferred PA-V1, merged into main 2026-05-13) modified both Chunk 4 target files:
  - `server/services/actionService.ts` — `+125 / -17` across PR #291-close (`4e211611`), PR #296 round 1 tx-contract guard on `transitionState` (`c5659ed1`), and PR #296 round 2 F2 reversal — idempotency key now includes a per-emission discriminator to prevent multi-draft collapse (`62b660cb`; pattern captured in `KNOWLEDGE.md` 2026-05-13 entry).
  - `server/jobs/workflowGateStallNotifyJob.ts` — `+15` across PR #291-close and PR #296 round 1 F1 (`51d8205a`, `system-rejected` naming alignment).

  Chunk 4 builder MUST: (a) re-confirm the `proposeAction` signature and idempotency-key shape after main's discriminator change before adding the optional `approver_user_id` param — the new param plugs into the existing key-or-add-discriminator contract, it does NOT replace it; (b) honour main's `transitionState` tx-contract guard when adding any state-changing UPDATE for the new approval path; (c) align any new stall-job emitted reasons with main's `system-rejected` naming style. The Chunk 4 acceptance criteria are unchanged — but the integration surface is no longer "the file we planned against." Audit-during-chunk applies.
- **files (new):**
  - `server/services/__tests__/actionServicePure.crossOwnerApprover.test.ts` — pure tests on the read-path union helper and the approver-derivation rule.
  - `server/services/__tests__/workflowGateStallNotifyJobPure.timeoutPolicyDecisionTree.test.ts` — pure tests on the decision tree (`'fail_parent'` → `failed` + reason; `'continue_without_substep'` → `partial` + reason; `'ask_initiator'` → emit `awaiting_initiator_decision` + proposeAction with `approver_user_id = initiator_user_id`).
  - `server/services/actionServicePure.ts` (new — verified absent at plan time) — pure helpers for the read-path union and approver derivation. **Audit at chunk start:** if the file has since landed in another branch, MODIFY in place instead and move this row to `files (modified)`.
- **files (modified):**
  - `server/services/actionService.ts` — `proposeAction` accepts optional `approver_user_id` and writes it on the action row; the existing idempotency key (§9.2) is unchanged. Add `listPendingApprovalsForUser(userId)` returning rows where `approver_user_id = $1` UNION rows where `approver_user_id IS NULL AND <V1 initiator predicate>` (§5.5). MUST filter by `organisationId` and use `withOrgTx` per DEVELOPMENT_GUIDELINES §1; soft-delete filter via `isActive(table)` per §8.27. State-changing UPDATE on approval transitions filters by `(organisation_id, status)` and asserts `rowCount === 1` per §8.35.
  - `server/jobs/workflowGateStallNotifyJob.ts` — at the 24-hour hard-stop, route notification to `approver_user_id`'s Slack identity; honour `cross_owner_approval_timeout_policy` (`'fail_parent'` / `'continue_without_substep'` / `'ask_initiator'`) per §5.6. The `'ask_initiator'` branch creates an approval row via `actionService.proposeAction(..., { approver_user_id: initiator_user_id })` so the typed decision request lands in the existing approval queue; the parent stays paused with the new `awaiting_initiator_decision_after_cross_owner_timeout` reason. Emit `cross_owner_substep.awaiting_initiator_decision` event (registered in Chunk 1b) on the `'ask_initiator'` path; emit `cross_owner_substep.completed { status: 'failed', reason: 'cross_owner_approval_timeout' }` on `'fail_parent'`; emit `cross_owner_substep.completed { status: 'partial', reason: 'cross_owner_approval_timed_out_optional' }` on `'continue_without_substep'`. Terminal-event guarantee enforced by the row-level write-time predicate `UPDATE delegation_outcomes SET substep_status = $1, terminal_at = NOW() WHERE id = $2 AND terminal_at IS NULL` (§9.4) — 0 rows affected = already terminal, losing caller emits NO event (suppression-is-success per DEVELOPMENT_GUIDELINES §8.33).
- **contracts:** `APPROVAL_ROW_V2` (§5.5) — override-only semantics: NULL = derive via V1 default; never backfill. `CROSS_OWNER_APPROVAL_TIMEOUT_POLICY` (§5.6).
- **error-handling strategy:**
  - `proposeAction`: existing idempotency key (`key-based` per §9.1 row 5). Concurrency: state-based predicate on `actions.status` per §9.3.
  - Stall job: idempotent on `WHERE status = 'pending_approval' AND created_at < NOW() - INTERVAL '24 hours'` (§9.1 last row). 0 rows = already resolved, no-op.
  - Terminal-event emit: row-level write-time predicate (§9.4). Losing caller returns `{ success: true, suppressed: true, reason: 'already_terminal' }` per DEVELOPMENT_GUIDELINES §8.33 (suppression-is-success).
  - State transition: every state-machine UPDATE flows through the row-level predicate; values constrained by the CHECK in migration 0352. State enum is closed (adding a status requires spec amendment per §9.7) — use `assertValidTransition` from `shared/stateMachineGuards.ts` per DEVELOPMENT_GUIDELINES §8.18 if applicable.
  - Empty catch banned (DEVELOPMENT_GUIDELINES §8.36); state-changing UPDATE asserts single-row effect per §8.35.
- **acceptance criterion:** typecheck + lint pass; pure-function tests on the read-path union + approver derivation + timeout-policy decision tree pass; the three new event variants from Chunk 1b can be produced by the stall job per the decision tree; the `'ask_initiator'` branch wires through to `proposeAction` (verified by pure test, not runtime test). **`proposeAction` idempotency-key invariant:** pure test confirms that adding the optional `approver_user_id` argument does NOT collapse, override, or otherwise alter `main`'s per-emission idempotency discriminator — two proposals with the same body but different `approver_user_id` (or one with `NULL` and one explicit) MUST still resolve identically under the existing idempotency key per §9.2. This protects the post-merge integration risk where the override column could silently widen the dedupe window.
- **g1-checks:**
  - `npm run lint`
  - `npm run typecheck`
  - `npx vitest run server/services/__tests__/actionServicePure.crossOwnerApprover.test.ts`
  - `npx vitest run server/services/__tests__/workflowGateStallNotifyJobPure.timeoutPolicyDecisionTree.test.ts`

### Chunk 5 — Operator-mode EA enablement verification

- **name:** `operator-mode-ea-enablement`
- **spec_sections:** §1 Goal 1, §4.3 (controllerStyleResolver, agentExecutionService), §10 Acceptance criterion #1
- **prerequisites:** Chunks 1a, 2, 3 (migration 0357 ships in 1a; matcher and authorisation must work end-to-end for operator-mode EA dispatch to validate)
- **files (new):**
  - `server/services/__tests__/controllerStyleResolverPure.eaOperatorMode.test.ts` — pure test only if Chunk 5 audit reveals a helper worth covering; otherwise no new test file.
- **files (modified):**
  - `server/services/controllerStyleResolver.ts` — AUDIT ONLY. Spec records the no-op confirmation as an acceptance criterion. The existing four-case logic (explicit override, subaccount default, mode default, constraint downgrade) selects operator when allowed-set is `'native_and_operator'` and the orchestrator requests operator. If the audit reveals a behavioural change needed, surface it explicitly and amend the spec before editing.
  - `server/services/agentExecutionService.ts` — AUDIT ONLY. The existing dispatch path is expected to work once `controller_style_allowed` is flipped. If the audit reveals plumbing changes, surface explicitly.
- **contracts:** No new contracts. Existing operator-backend dispatch contract (Spec D §3.4) consumes the seed value flipped in migration 0357.
- **error-handling strategy:** No new error paths. The resolver's existing four-case logic returns a definite controller-style decision; no fail-closed branch added by V2.
- **acceptance criterion:** typecheck + lint pass; AUDIT outcome recorded in the chunk's commit message (either "no-op confirmed in `controllerStyleResolver` lines X–Y" or "behavioural change needed — see surfaced item"). If no behavioural change, the chunk's diff is empty for these two files except for any new test file or comment. (Spec §10 Acceptance criterion 1 is a dogfood acceptance check tracked separately — not unit-testable.)
- **g1-checks:**
  - `npm run lint`
  - `npm run typecheck`

### Chunk 6 — Operator-session initial-context bundling

- **name:** `operator-session-initial-context-bundler`
- **spec_sections:** §4.2 (operatorSessionInitialContextBundler + Pure), §4.3 (operatorSessionLifecycleService), §5.8, §7
- **prerequisites:** Chunk 5 (operator-mode EA must dispatch correctly for the bundler to land in a session-start payload)
- **files (new):**
  - `server/services/operatorSessionInitialContextBundler.ts` — orchestrates the build. Reads `memory_blocks WHERE agent_id = ea.id` (with `isActive` filter per DEVELOPMENT_GUIDELINES §8.27), `voice_profiles WHERE owner_user_id = ea.owner_user_id`, `users WHERE id = ea.owner_user_id` for timezone + working hours, and recent-activity summary (last 24h from existing store). Returns the bundle. Uses `withOrgTx` for DB reads per DEVELOPMENT_GUIDELINES §1.
  - `server/services/operatorSessionInitialContextBundlerPure.ts` — pure trim algorithm under §5.8. Priority: voice profile features > most-recent memory blocks > older memory blocks. Hard cap 4096 bytes serialised; deterministic.
  - `server/services/__tests__/operatorSessionInitialContextBundlerPure.test.ts` — pure tests asserting (a) the trim algorithm respects the 4 KB cap across multiple input permutations (DEVELOPMENT_GUIDELINES §8.21 determinism rule); (b) voice profile is always included before memory blocks; (c) the configuration-error fallback (voice profile alone exceeds 4 KB) trims to `tone_features` + `style_markers` only and logs.
- **files (modified):**
  - `server/services/operatorSessionLifecycleService.ts` — at session start (the `operator_runs` insert path), call `operatorSessionInitialContextBundler` for EA-templated operator sessions; serialise into the operator runtime's start payload. Existing primitive; only adds the bundler invocation.
- **contracts:** `OPERATOR_SESSION_INITIAL_CONTEXT_BUNDLE` (§5.8).
- **error-handling strategy:**
  - Trim algorithm: pure, deterministic, total over inputs. Hard cap enforced.
  - Configuration-error path: voice profile alone exceeds 4 KB — log at `warn` (DEVELOPMENT_GUIDELINES §8.36 — never empty catch), fall back to a trimmed voice profile (`tone_features` + `style_markers` only). The lifecycle service does NOT throw; the runtime starts with the degraded bundle.
  - DB read failures (degrade-only): memory blocks and voice profile reads are individually optional — failure logs at `warn` and the bundler proceeds with available inputs.
  - DB read failures (owner identity, conditional fail-closed): the `users WHERE id = ea.owner_user_id` read supplies timezone + working hours, which directly drive scheduling behaviour for the session. **Failure handling:** if `owner_user_id` is already authenticated on the session-start path and a safe default timezone (`'UTC'`) + safe default working hours can be applied, log at `warn` and proceed with the degraded bundle. Otherwise — missing `owner_user_id` on the session, or no safe default available in the deployment environment — FAIL the session start and surface the error to the lifecycle service caller. Silently degrading to wrong-timezone scheduling is a worse failure than not starting.
  - The bundle's `serialised_size_bytes` field reflects whatever made it in.
- **acceptance criterion:** typecheck + lint pass; pure tests pass including the determinism check across input permutations; the bundle's serialised size never exceeds 4096 bytes across all test fixtures.
- **g1-checks:**
  - `npm run lint`
  - `npm run typecheck`
  - `npx vitest run server/services/__tests__/operatorSessionInitialContextBundlerPure.test.ts`

### Chunk 7 — Live-file events: tool-call interceptor + bridge + UPSERT writer

- **name:** `live-file-events-tool-call-interceptor`
- **spec_sections:** §4.2 (operatorSandboxFileEventBridge + Pure), §4.3 (operatorSessionService), §4.6 (`file.created` / `file.modified` event variants — registered in Chunk 1b), §5.7, §6.5, §9.1 (operator_run_files row write), §9.3 (concurrent file-write race)
- **prerequisites:** Chunks 1a (table + RLS), 1b (event-variant registry entries), 3 (runTraceProjectionForViewer for cross-owner privacy filter on file-event payloads), 5 (operator-mode dispatch must work)
- **files (new):**
  - `server/services/operatorSandboxFileEventBridge.ts` — tool-call interceptor for runtime tool-registry file writes. Path:
    1. Upload file to R2 via existing `getS3Client()` / `getBucketName()` from `server/lib/storage.ts`. R2 PUT is `safe` retry-classified per §9.2.
    2. Execute the canonical UPSERT against `operator_run_files` (`INSERT ... VALUES (..., 1, ...) ON CONFLICT (agent_run_id, path) DO UPDATE SET version = operator_run_files.version + 1, size_bytes = EXCLUDED.size_bytes, content_sha256 = EXCLUDED.content_sha256, mime_type = EXCLUDED.mime_type, emitted_by = EXCLUDED.emitted_by, emitted_at = NOW() RETURNING version`). The UPSERT runs inside `withOrgTx` (DEVELOPMENT_GUIDELINES §1).
    3. Derive event type from returned `version` (`version === 1 ? 'file.created' : 'file.modified'`) — NEVER from preflight existence check.
    4. Emit event via pg-boss `operator-session-progressed` channel. Bridge to WebSocket `agent-run` channel.
    5. For cross-owner runs, the bridge stamps `ownerUserId` from the executor agent (the row's owner). Initiator-side serialisation is filtered later by `runTraceProjectionForViewer` (§5.7 cross-owner privacy projection) — the bridge does NOT pre-filter.
  - `server/services/operatorSandboxFileEventBridgePure.ts` — pure helpers: shape validation, MIME detection (file-extension table or `mime-types` lib), content-sha256 computation (hash the in-memory buffer), watcher dedupe (`existing.content_sha256 === observed`), and event-type derivation from the post-UPSERT `version` (takes `version` as input — does NOT perform its own preflight lookup).
  - `server/services/__tests__/operatorSandboxFileEventBridgePure.test.ts` — pure tests asserting (a) `version === 1` → `file.created`, `version > 1` → `file.modified`; (b) watcher dedupe matches on `content_sha256`; (c) MIME detection covers the common types; (d) sha256 computation is deterministic.
- **files (modified):**
  - `server/services/operatorSessionService.ts` — wire the file-event bridge into the operator-session tool-registry handler so file-write tool calls trigger `operatorSandboxFileEventBridge.handle*` before returning to the runtime. Tool-call path is inline / synchronous per §7 (deferring would race with subsequent reads).
- **contracts:** `OPERATOR_FILE_EVENT` (§5.7); the `OPERATOR_RUN_FILES` row shape (§4.1).
- **error-handling strategy:**
  - R2 PUT failure: `safe` retry via existing `withBackoff` (accepted primitive in `docs/spec-context.md`). On exhausted retries, throw — operator runtime sees a tool-call error and decides whether to retry/abort. Surfaced as a tool-call error in run trace.
  - UPSERT path: `guarded` per §9.2 — UNIQUE `(agent_run_id, path)` (§9.3 row 1) serialises conflicting INSERTs; the canonical UPSERT resolves to `prior_row.version + 1` under the row lock. No separate allocator state.
  - Tool-call-vs-watcher race (§9.3 row 2): watcher dedupe checks the current row's `content_sha256` against the observed hash (latest-row-only — §5.7). On hash match, watcher SKIPS emit (suppression-is-success per DEVELOPMENT_GUIDELINES §8.33: `{ success: true, suppressed: true, reason: 'lost_race_to_tool_call' }`). On hash mismatch, watcher writes through the canonical UPSERT and emits based on the returned `version`.
  - pg-boss `send()`: `safe` retry. Consumer dedupe key: `agentRunId + path + version` (§9.2 row 4).
  - Cross-owner privacy: `file.*` event payloads carry full owner-side metadata at emission; the projection in Chunk 3's `runTraceProjectionForViewer` blanks them for initiator-side views (§5.7 cross-owner privacy projection).
  - Empty catch banned (DEVELOPMENT_GUIDELINES §8.36).
- **acceptance criterion:** typecheck + lint pass; pure tests pass; the bridge's UPSERT path is unit-tested for the version-derivation rule (mocked DB returning `version: 1` → `file.created`, mocked DB returning `version: 4` → `file.modified`); a grep for `SELECT.*FROM operator_run_files` in `operatorSandboxFileEventBridge.ts` returns ZERO hits for preflight-existence patterns (the rule from §5.7 — preflight is never the source of truth). Spec §10 Acceptance criterion #5 (5-file dogfood run) is a manual acceptance check tracked separately.
- **g1-checks:**
  - `npm run lint`
  - `npm run typecheck`
  - `npx vitest run server/services/__tests__/operatorSandboxFileEventBridgePure.test.ts`

### Chunk 8 — Live-file events: sandbox-side filesystem watcher + path-safety

- **name:** `live-file-events-sandbox-watcher`
- **spec_sections:** §4.5, §5.7 (watcher dedupe rule), §9.3 (tool-call-vs-watcher race)
- **prerequisites:** Chunk 7 (event shape + bridge contract must already exist for the watcher to bridge into)
- **files (new):**
  - `infra/sandbox-templates/operator-session/file-watcher.js` (or `.ts` compiled to JS, depending on the template's build setup — confirm during chunk start) — chokidar-equivalent process inside the sandbox. Watches `/workspace/artefacts/` and `~/Downloads/`. On `add` / `change` events:
    1. Resolve the observed path via `realpath` (symlinks expanded).
    2. Confirm `realpath` is strictly inside one of the configured watched roots. Reject otherwise.
    3. Reject hidden credential-style paths: `.env`, `*.pem`, `*.key`, `.ssh/*`, `.aws/*` (see §4.5 path-safety invariant).
    4. Reject parent-directory escapes.
    5. Read file content; compute sha256.
    6. IPC to the parent process (runtime); the runtime calls `operatorSandboxFileEventBridge.handleWatcherEvent(...)` which executes the canonical UPSERT and emits accordingly.
    7. On any rejection: log at `warn` severity with the unresolved path REDACTED (do not log the raw path; redact to `/workspace/artefacts/<redacted>` or `~/Downloads/<redacted>` — leaks like `.env` filenames are themselves sensitive).
- **files (modified):**
  - `infra/sandbox-templates/operator-session/Dockerfile` — install the chokidar-equivalent dependency; add the watcher process to the entrypoint or supervisor.
  - `infra/sandbox-templates/operator-session/entrypoint.sh` — start the watcher process alongside the runtime; ensure it terminates cleanly on session end.
  - `infra/sandbox-templates/operator-session/CURRENT_VERSION` — bump version marker; sandbox image rebuild required (coordinate with infra — see §3 risks).
- **contracts:** Watcher path-safety invariant (§4.5); shared event shape with Chunk 7 (`OPERATOR_FILE_EVENT`). The watcher reads the same `content_sha256` invariant as the Chunk 7 dedupe rule (§5.7).
- **error-handling strategy:**
  - Path-safety rejections: log at `warn`, drop event silently for the runtime (no IPC sent). This is correct behaviour: a `.ssh/id_rsa` "appearing" in the sandbox should not generate a run-trace event the initiator (or even the owner) sees.
  - IPC failures: `safe` retry (the watcher buffers events and retries IPC on reconnect; max-attempts then drop with `warn` log; never empty catch per DEVELOPMENT_GUIDELINES §8.36).
  - chokidar-equivalent failure mode: if the watcher process crashes, the supervisor restarts it. Tool-call path continues to emit events independently — watcher is a backstop, not the only path.
  - The watcher does NOT write to `operator_run_files` directly. It bridges to the runtime, which calls `operatorSandboxFileEventBridge.handleWatcherEvent` (in the host, with proper RLS context).
- **acceptance criterion:** typecheck + lint pass on any TypeScript portions; the sandbox template image builds locally (`bash infra/sandbox-templates/operator-session/build.sh` or equivalent — confirm during chunk start); the path-safety rejection logic is covered by a small unit test if the watcher script is in TypeScript; manual verification (deferred to CI / sandbox infra) that the watcher process starts and exits cleanly.
- **g1-checks:**
  - `npm run lint`
  - `npm run typecheck`
  - (sandbox-template build verification is infra-side, not a `g1` check the builder runs — coordinate with infra; per `references/test-gate-policy.md`, full build verification is CI-only)

### Chunk 9 — Doc-sync + KNOWLEDGE + ADR consideration

- **name:** `doc-sync-and-knowledge`
- **spec_sections:** §4.7, Appendix B
- **prerequisites:** all functional chunks (1a, 1b, 2, 3, 4, 5, 6, 7, 8) merged into the integration branch
- **files (new):** none necessarily — consider authoring a new ADR if Appendix B item 8 ("approval follows executor's owner, not initiator") earns one. ADR template at `docs/decisions/_template.md`. Implementer decides.
- **files (modified):**
  - `architecture.md` — add (a) universal `OpenTaskView` + run-trace invariant clause under the agent / controller section; (b) `owner_user_id` scope axis to the capability-map description; (c) cross-ownership delegation pattern under the hierarchical-delegation section. Use existing section anchors per `docs/context-packs/` discipline.
  - `docs/synthetos-governed-agentic-os-brief-v1.2.md` §5.6 (Run Trace) — note that all controllers feed the same run-trace surface.
  - `docs/capabilities.md` — add the EA "standing autonomous operator" entry. Editorial Rules apply (vendor-neutral, marketing-ready, model-agnostic) per the file's `§ Editorial Rules`.
  - `KNOWLEDGE.md` — append patterns extracted at finalisation: (i) two-axis routing for owner-scoped capabilities, (ii) approval routes follow executor's owner not initiator, (iii) live-file events on R2 via UPSERT-derived version (already partially captured during spec round 2), (iv) two-layer service+route privacy projection enforcement.
- **contracts:** none — documentation only.
- **error-handling strategy:** documentation drift is the only failure mode. Mitigated by the doc-sync sweep at finalisation. `chatgpt-pr-review` step 6 enforces the doc-sync checklist; missing verdict blocks finalisation.
- **acceptance criterion:** every row in `docs/doc-sync.md` has a `yes` / `no` / `n/a` verdict in the Phase 3 review log with a substantive rationale (per `docs/doc-sync.md § Verdict rule`); editorial-rules compliance on `docs/capabilities.md` (no em-dashes in UI/app-facing text per CLAUDE.md user preferences, vendor-neutral, marketing-ready); the universal `OpenTaskView` clause cites the V2 spec section.
- **g1-checks:**
  - `npm run lint`
  - (no test files; no `typecheck` strictly needed unless code-fenced examples in docs reference TS — confirm during chunk start)

---

## 3. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Concurrent file-write race on `operator_run_files`** (two writers to the same `(agent_run_id, path)` could both emit `file.created` under a naive preflight-lookup model) | High | Locked at spec time. Canonical UPSERT (`ON CONFLICT ... DO UPDATE SET version = ... + 1 RETURNING version`) serialises conflicts via the UNIQUE constraint; event type derives from the returned version. Chunk 7 acceptance criterion includes a grep for `SELECT.*FROM operator_run_files` returning zero preflight patterns. Pure-test coverage of the version-derivation rule. (§5.7, §9.3 row 1; KNOWLEDGE.md entry from spec round 2.) |
| **Migration 0357 EA-flip reversibility** (`controller_style_allowed` data migration on existing rows; hard-revert pauses operator-mode runs in flight) | Medium | `.down.sql` flips back to `'native_only'` for the same predicate. Spec acknowledges (§4.1 row 1) that hard-revert "pauses operator-mode runs only" — there is no graceful drain. Mitigation: revert during a quiet window; document the operational cost in `KNOWLEDGE.md` at finalisation (Chunk 9). Pre-prod posture (`pre_production: yes`, `commit_and_revert`) makes this acceptable. |
| **Two-layer cross-owner privacy projection defeatable by a future direct consumer** (the projection is invoked at both `agentExecutionEventService` (Chunk 3) and `taskEventStream` / `agentRuns` routes; a future code path that reads from `agent_execution_events` via `db` directly, or via a NEW service that bypasses the existing service+route, could leak owner data) | High (security-shaped) | Spec §4.3 explicitly notes the two-layer enforcement is "deliberate." Architecture-level invariant: any new read path for cross-owner run trace MUST invoke `runTraceProjectionForViewer`. Surfaced in `architecture.md` doc-sync (Chunk 9) with the cross-ownership pattern clause. The `verify-rls-contract-compliance.sh` gate enforces no direct-DB-access in routes/lib — that gate's existence is the structural backstop. Future PR reviewers (`adversarial-reviewer` on security-surface diffs) must check this invariant. |
| **Sandbox-template change in Chunk 8 requires image rebuild** (chokidar-equivalent dependency, `CURRENT_VERSION` bump, supervisor/entrypoint edit; sandbox infra owns the image deployment) | Medium | Coordinate with infra during Chunk 8. The change is additive (existing tool-call path in Chunk 7 already covers most file writes); even with no watcher deployed, V2 is functional. Watcher is a backstop for browser downloads / sandbox script outputs. **Required-vs-deferred split:** Chunk 8's code + Dockerfile/entrypoint/version-bump edits + template build (`bash infra/sandbox-templates/operator-session/build.sh` or equivalent) MUST pass before merge — this is in scope for Phase 2. **External deployment of the rebuilt sandbox image** (pushing the new image to the registry, rolling pods) may proceed on the infra team's release schedule and is NOT a merge blocker. Surface explicitly in Chunk 8 commit message. |
| **`@<DisplayName>` resolver visibility helper audit** (spec §5.3 says the resolver reuses an existing visibility helper from `capabilityDiscoveryHandlers.ts`; if no shared helper exists, the resolver falls back to subaccount-scoped lookup) | Low | Audit during Chunk 2 (flagged as audit-during-chunk in spec, not a blocker). If no shared helper exists, the resolver uses `organisation_id = $org AND subaccount_id = routingContext.subaccountId AND deleted_at IS NULL` (subaccount-scoped, NOT org-wide). Surface in the chunk's audit log. The fallback is safe (more restrictive than org-wide); the gap may become an `architecture.md` clarification item in Chunk 9. |
| **`runTraceProjectionForViewer` allow-list drift** (any new owner-side timestamp column added later is owner-private by default per §5.4; the projection allow-list must explicitly opt it in — but a developer adding a new timestamp column may forget to update the allow-list, leading to silent leak if the projection's strict-allow-list logic is not preserved) | Medium | The helper is strict-allow-list. The Chunk 3 pure test asserts that an UNKNOWN timestamp field is blanked from the projected output. If a future timestamp column is added without allow-list update, the column simply isn't forwarded — fail-closed by design. Surface as a `KNOWLEDGE.md` pattern in Chunk 9: "owner-side timestamps on `delegation_outcomes` and related tables are owner-private by default; the projection allow-list is opt-in." |
| **Spec §10 dogfood acceptance criteria are NOT unit-testable** (acceptance criteria 1–6 require live operator-backend sessions, real Slack approvals, real R2 events; pure tests cannot prove them) | Acknowledged | Spec §10 is explicit: acceptance criteria are "dogfood-verified, not unit-tested." Static gates + targeted pure tests are the load-bearing safety net during build (per `docs/spec-context.md` `static_gates_primary`). Dogfood verification happens after Phase 3 ships, in a separate session. Do NOT block Phase 2 on these criteria. |
| **Backfill script in Chunk 1b touches every user-owned agent's `capability_map`** (idempotent re-run is safe, but the first run does writes — if it errors mid-stream it leaves some rows backfilled and others not) | Low | The backfill is per-org-transactional (`withOrgTx` per DEVELOPMENT_GUIDELINES §1; mirrors `memoryDedupJob.ts` per the maintenance-job pattern in §2). Failure halfway through leaves earlier orgs migrated and later orgs unchanged — re-running picks up where it left off (state-based, idempotent). The new CI gate `verify-capability-map-shape.sh` catches drift at CI time on any subsequent build. |

---

## 4. Dependency graph

```
                  Chunk 1a (SQL schema + migrations + RLS manifest)
                       |
                       v
                  Chunk 1b (shared types + CI gate + capability-map extension + backfill)
                       |
                       v
                  Chunk 2 (routing context + matcher + addressing parser)
                       |
                       v
                  Chunk 3 (cross-owner delegation auth + assembler + runTraceProjectionForViewer)
                       |
            +----------+----------+
            v                     v
       Chunk 4              Chunk 5
       (approval-owner      (operator-mode EA
        routing + stall      enablement
        job)                 verification)
                                  |
                       +----------+----------+
                       v                     v
                  Chunk 6              Chunk 7
                  (initial-context     (tool-call interceptor +
                   bundler)             bridge + UPSERT writer)
                                              |
                                              v
                                         Chunk 8
                                         (sandbox-side watcher +
                                          path-safety)

           (Chunks 4, 6, 8 all feed into Chunk 9)
                            |
                            v
                Chunk 9 (doc-sync + KNOWLEDGE + ADR)
```

Forward-only dependencies. No backward references. Chunks 4 and 5 run in parallel after Chunk 3 (Chunk 5 verifies operator-mode EA enablement and does not depend on approval-owner routing or the stall job). Chunks 6 and 7 run in parallel after Chunk 5. Chunk 8 strictly depends on Chunk 7 (event-shape contract). Chunk 9 strictly depends on every functional chunk (1a, 1b, 2, 3, 4, 5, 6, 7, 8) merging first.

Chunk 7 also depends on Chunk 3 (the `runTraceProjectionForViewer` privacy filter is applied to cross-owner file-event payloads on the outbound path — see Chunk 7 prerequisites).

---

## 5. Executor notes (for `feature-coordinator` + `builder`)

- **Per-chunk `builder` posture:** chunks 1a, 1b, 2, 3, 4, 6, 7 are pure-test-heavy and rely on targeted vitest. Chunks 5 and 8 are audit / infra; their g1 set is minimal. Chunk 9 is docs only.
- **Surgical changes (CLAUDE.md §6):** chunks 2, 3, 4 each carry "audit during implementation" rows in the spec — if the audit reveals no change is needed, drop the row from the changed-files list at chunk close. Do not "improve" surrounding code mid-chunk.
- **No drive-by changes (CLAUDE.md §6, DEVELOPMENT_GUIDELINES §8.2):** every touched file traces to a spec section in the chunk's `spec_sections:` field.
- **Doc-sync at finalisation (Chunk 9):** every row in `docs/doc-sync.md` MUST get a verdict — `yes` / `no` / `n/a` — per the canonical investigation procedure. `chatgpt-pr-review` Phase 3 step 6 enforces.
- **Spec amendments:** if any chunk reveals a spec ambiguity that requires re-litigation, STOP and route to spec-coordinator before continuing. Do not silently amend the spec mid-build.
- **No new UI surfaces.** V2 ships with zero mockups (brief §0.5 decision #6). Any genuinely new visual surface that emerges mid-build must be surfaced explicitly to the operator before adding a mockup — default posture is extend existing surfaces with new event types / labels / chips, not new components or pages.
- **CEO-level communication (CLAUDE.md user preferences):** chunk-close summaries to the operator should be short, plain English, business-framed. Technical detail belongs in commit messages and this plan, not in chat.

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

## End of plan
