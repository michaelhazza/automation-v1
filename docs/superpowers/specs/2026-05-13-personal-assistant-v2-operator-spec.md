**Status:** draft
**Spec date:** 2026-05-13
**Last updated:** 2026-05-13 (post-spec-reviewer + schema decisions locked)
**Author:** michaelhazza (via Claude Opus spec-coordinator)
**Build slug:** `personal-assistant-v2-operator`
**Branch:** `claude/personal-assistant-post-merge-audit`
**Scope class:** Major
**Source brief:** `tasks/builds/personal-assistant-v2-operator/brief.md` (DRAFT 2026-05-13, all decisions ratified)
**Strategic parent:** `docs/synthetos-governed-agentic-os-brief-v1.2.md` §6.3 (Operator Controller), §16.1 (Executive Assistant Phase 3 full delivery)

# Personal Assistant V2 — Operator Mode + Cross-Ownership Delegation — Spec

## Contents

- [1. Goals + non-goals + framing](#1-goals--non-goals--framing)
- [2. Scope summary](#2-scope-summary)
- [3. Source-of-truth references](#3-source-of-truth-references)
- [4. File inventory lock](#4-file-inventory-lock)
- [5. Domain model + contracts](#5-domain-model--contracts)
  - [5.1 Capability-map shape (extension)](#51-capability-map-shape-extension)
  - [5.2 RoutingContext (extension)](#52-routingcontext-extension)
  - [5.3 Addressing parser contract](#53-addressing-parser-contract)
  - [5.4 Cross-owner delegation contract](#54-cross-owner-delegation-contract)
  - [5.5 Approval row shape (`approver_user_id`)](#55-approval-row-shape-approver_user_id)
  - [5.6 Cross-owner approval timeout policy](#56-cross-owner-approval-timeout-policy)
  - [5.7 File events (`file.created`, `file.modified`)](#57-file-events-filecreated-filemodified)
  - [5.8 Operator session initial-context bundle](#58-operator-session-initial-context-bundle)
- [6. Permissions / RLS checklist](#6-permissions--rls-checklist)
- [7. Execution model](#7-execution-model)
- [8. Chunk sequencing (dependency graph)](#8-chunk-sequencing-dependency-graph)
- [9. Execution-safety contracts](#9-execution-safety-contracts)
- [10. Testing posture](#10-testing-posture)
- [11. Self-consistency pass result](#11-self-consistency-pass-result)
- [12. Deferred items](#12-deferred-items)
- [13. Open questions](#13-open-questions)
- [Appendix A — Reuse acceptance test (brief §0.5)](#appendix-a--reuse-acceptance-test-brief-05)
- [Appendix B — Doc-sync checklist](#appendix-b--doc-sync-checklist)

---

## 1. Goals + non-goals + framing

### Goals

1. Flip the Executive Assistant's allowed-controllers from `'native_only'` to `'native_and_operator'` for the system-agent template and every existing user-owned EA instance, so the EA can run adaptive multi-step work for its owner inside the operator-backend runtime (Spec D, merged #288).
2. Extend the capability-routing primitive with one optional `owner_user_id` scope field on the persisted `subaccount_agents.capability_map` JSONB shape, so the orchestrator's matcher can route owner-scoped requests correctly without any EA-specific branching.
3. Extend the orchestrator routing context with `requester_user_id` (required) and `target_owner_user_id` (optional) so the matcher can distinguish self-service from cross-ownership delegation using two axes.
4. Implement cross-ownership delegation at runtime: any agent in the org may delegate a sub-step to a user-owned agent when the sub-step requires the owner's data; credentials follow the executor (per `user-owned-agents` §3.3 broker invariant); approvals route to the owner, not the initiator.
5. Recognise `@PA`, `@MyAssistant`, and `@<DisplayName>` as soft routing hints in orchestrator-side intent text (no UI autocomplete in V2).
6. Extend operator-backend's event stream with live `file.created` and `file.modified` events emitted from two sources inside the operator-session sandbox: a tool-call interceptor on the runtime's tool registry, and a filesystem watcher on a designated artefacts directory.
7. Inject memory + voice profile + owner-identity context into the initial context of every operator-mode EA session, under a 4 KB hard cap, with mid-session memory updates applied at chain-link boundaries only.

### Non-goals (canonical)

Inherits every entry in brief §5. The two most load-bearing non-goals carried by this spec are:

- **No new UI surfaces.** Zero mockups. Every visible change reuses `OpenTaskView` (`client/src/pages/OpenTaskView.tsx`), `GlobalAskBar` (`client/src/components/global-ask-bar/GlobalAskBar.tsx`), `RunTraceEventRenderer`, `FilesTab`, the approval queue, and the operator-backend prototypes `r1-r17`. The orchestrator-side `@`-parser does not bring an autocomplete UI; address parsing is text-only.
- **No EA-specific branching in the orchestrator.** The matcher, approval router, and delegation path must work identically for any user-owned agent (a stub Dev Agent configured with `owner_user_id` and equivalent `capability_map` MUST pass the same routing fixtures per brief §0.5 reuse acceptance criterion). EA-specific helpers are confined to `server/services/eaDrafts/` and `server/services/voiceProfile/`.

### Framing assumptions

From `docs/spec-context.md`:

- `pre_production: yes` — commit-and-revert rollout; no staged rollout, no feature flag for the migration.
- `testing_posture: static_gates_primary` — runtime tests are limited to pure-function Vitest tests (the canonical pure-function unit-test harness on this repo, per `docs/testing-conventions.md`). No API, database, frontend, Playwright, supertest, or own-app integration tests are added for V2. Static gates (`verify-*.sh`) and CI typecheck/lint are the load-bearing safety nets.
- `prefer_existing_primitives_over_new_ones: yes` — V2 is a composer. The only genuinely new things this spec introduces are: one optional JSONB field, one routing-context field pair, one approval column, one CI gate, two event types, one sandbox-side watcher process.

V2-specific framing additions:

- **Universal OpenTaskView + run-trace invariant** (brief §3.1): every agent run under every controller surfaces through the same `OpenTaskView` primitives. The controller-style badge, chain-link boundary markers, and budget events that operator-mode runs surface are emitted by event types ALREADY DEFINED IN OPERATOR-BACKEND (Spec D §3.13 + prototypes `r1-r17`) — V2 introduces NO new badge/boundary/budget event types. The complete list of new event variants V2 adds to the run-trace stream is the four declared in §4.6: `file.created`, `file.modified` (§5.7), `cross_owner_substep.awaiting_initiator_decision` (emitted only on the `ask_initiator` timeout branch, §5.6), and `cross_owner_substep.completed` (the single terminal event for every cross-owner sub-run, §9.4). The "no new visual chrome" claim is therefore enforced by event-type closure: §4.6 is the canonical inventory; anything not listed there must reuse an existing operator-backend renderer. This invariant is platform-level and gets a clause in `architecture.md` during V2's doc-sync sweep (§4).
- **Two-axis routing** (§5.2). Self-service is `target_owner_user_id` absent and `owner_user_id == requester_user_id`. Cross-ownership is `target_owner_user_id` present and `owner_user_id == target_owner_user_id`.
- **Two-layer delegation authorisation** (brief §3.6 ratified): named-owner reference in user intent (Layer 1) OR explicit owner-scoped capability request from a trusted parent-agent tool call (Layer 2). If neither, delegation fails closed with a clarifying question.

## 2. Scope summary

V2 is a composer build over `user-owned-agents` (#291 inline), `personal-assistant-v1` (#291), and `operator-backend` (#288 / Spec D). The build adds five additive extensions:

1. EA `controllerStyleAllowed` flip migration (data migration on existing rows; idempotent).
2. `capability_map.owner_user_id` JSONB axis + `computeCapabilityMapPure` extension + new CI gate `scripts/gates/verify-capability-map-shape.sh`.
3. Orchestrator `RoutingContext.{requester_user_id, target_owner_user_id}` propagation + matcher rule + intent-parser extension for `@PA` / `@MyAssistant` / `@<DisplayName>`.
4. Cross-ownership delegation runtime: two-layer authorisation signal, owner-credentialed sub-run, approval-owner rule (`actions.approver_user_id` column + cross-owner timeout policy on delegation record), run-trace privacy invariant (initiator sees status + typed summary only, never raw owner source data).
5. Operator-backend live-file event extension: tool-call interceptor + sandbox-side filesystem watcher + `file.created` / `file.modified` events bridged onto the existing `agent-run` WebSocket channel.

Plus one ancillary: memory + voice profile + owner-identity initial-context injection for operator-mode EA sessions (4 KB hard cap, chain-link-boundary updates).

Estimated effort: ~2 weeks single build session (per brief §7). Single Phase 2 ship; internal chunks sequenced per §8.

## 3. Source-of-truth references

When this spec and another document disagree on a ratified design decision, the ranking below wins:

1. `tasks/builds/personal-assistant-v2-operator/brief.md` — ratified decisions in §0, §3, §4.A (carries the operator's authoritative decisions on naming, scope, routing rules, authorisation signal, use case shortlist, CI gate name, context budget, etc.).
2. This spec — adds architectural rigour (file paths, migration numbers, contract examples, idempotency posture, source-of-truth precedence) that the brief leaves unpinned. Where the brief and this spec disagree on a NEW item the brief didn't decide, this spec is authoritative.
3. Predecessor briefs/specs whose primitives V2 reuses verbatim:
   - `tasks/builds/user-owned-agents/brief.md` — broker invariant (§3.3): cited by §5.4 when stating "credentials follow the executor."
   - `tasks/builds/operator-backend/brief.md` (Spec D) — operator-runtime prompt-cache partition + initial-context injection contract (§3.4): cited by §7 ("No new prompt-cache partitions").
   - `tasks/builds/personal-assistant-v1/brief.md` — EA agent template, voice-profile + memory-block contracts: cited by §5.8.
4. `architecture.md` — wins on conventions (RLS policy shape, three-layer isolation, route handler patterns, naming conventions).
5. `docs/spec-context.md` — wins on framing (testing posture, rollout model, accepted primitives).
6. `docs/spec-authoring-checklist.md` — wins on the rules this spec's structure must satisfy (§4 inventory lock, §5 contract anatomy, §9 execution-safety contracts). Cited by §5 intro.
7. `KNOWLEDGE.md` — informational gotchas that may surface authoring traps but don't override decisions.

The spec under review does NOT contradict any framing statement in `docs/spec-context.md`. The testing-posture statement (§10) explicitly stays inside `runtime_tests: pure_function_only`. There is no `feature_flag` request, no staged rollout, no E2E test plan against the app.

## 4. File inventory lock

Every file/column/migration referenced anywhere in this spec must appear in one of the tables below. Reviewer will fail the spec on any prose mention not reflected here.

### 4.1 Migrations (new)

| Number | Purpose | Idempotency | Reversible (.down.sql)? |
|---|---|---|---|
| `migrations/0345_ea_controller_style_native_and_operator.sql` | Flip `subaccount_agents.controller_style_allowed` from `'native_only'` to `'native_and_operator'` for the EA system-agent template AND for every existing user-owned EA instance (`system_agent_slug = 'executive-assistant'` AND `controller_style_allowed = 'native_only'`). | Yes — `WHERE controller_style_allowed = 'native_only'`. Re-running is a no-op. | Yes — `0345_*.down.sql` flips back to `'native_only'` for the same predicate (operator may need to retain operator-runs evidence; spec acknowledges this is a hard-revert and pauses operator-mode runs only). |
| `migrations/0346_actions_approver_user_id.sql` | Add `approver_user_id UUID NULL` to `actions`. FK → `users(id) ON DELETE RESTRICT`. NULL means "approve via existing initiator-defaulted path." Backfill: NULL for all existing rows (no rewrite of historical approvals). | Yes — `ADD COLUMN IF NOT EXISTS`. | Yes — `DROP COLUMN approver_user_id`. |
| `migrations/0347_delegation_outcomes_cross_owner_state.sql` | Three additive columns on `delegation_outcomes`: (1) `cross_owner_approval_timeout_policy TEXT NULL` constrained to `('fail_parent', 'continue_without_substep', 'ask_initiator')` via CHECK; NULL = not a cross-owner delegation. (2) `substep_status TEXT NOT NULL DEFAULT 'proposed'` constrained to the canonical status vocabulary `('proposed', 'authorised', 'routed', 'executing', 'awaiting_cross_owner_approval', 'approved', 'rejected', 'success', 'partial', 'failed')` per §9.7. (3) `terminal_at TIMESTAMPTZ NULL` set when `substep_status` transitions to a terminal value (`success` / `partial` / `failed`). Plus a partial index on `(run_id, substep_status) WHERE terminal_at IS NULL` for the §9.4 uniqueness predicate. Strategy locked 2026-05-13: extend `delegation_outcomes` rather than introduce a separate state-machine table — matches the existing ledger concept and avoids splitting cross-owner state across two tables. | Yes — `ADD COLUMN IF NOT EXISTS` for each column; partial index is `CREATE INDEX IF NOT EXISTS`. | Yes — `DROP COLUMN` for each plus `DROP INDEX`. |
| `migrations/0348_operator_run_files.sql` | Create new tenant-scoped table `operator_run_files` keyed on `agent_run_id` (FK → `agent_runs.id ON DELETE CASCADE`) with columns `(id UUID PK, agent_run_id UUID NOT NULL, owner_user_id UUID NULL REFERENCES users(id), path TEXT NOT NULL CHECK (path <> ''), storage_key TEXT NOT NULL CHECK (storage_key <> ''), size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0), mime_type TEXT NOT NULL, version INT NOT NULL CHECK (version >= 1), content_sha256 TEXT NOT NULL, emitted_by TEXT NOT NULL CHECK (emitted_by IN ('tool_call', 'watcher')), emitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), organisation_id UUID NOT NULL, subaccount_id UUID NOT NULL)`, UNIQUE `(agent_run_id, path)`, plus an RLS policy (org_scoped via direct `organisation_id` column for fast plan). The matching `server/config/rlsProtectedTables.ts` manifest entry is added in Chunk 1 as a TypeScript edit, NOT inside the SQL migration (a SQL file cannot mutate a TypeScript manifest). Strategy locked 2026-05-13: new table, not an extension of `execution_files` — `execution_files` is keyed on `execution_id → executions.id` (IEE executions, distinct lifecycle/domain) and reusing it would force confusing dual-parent semantics. **Versioning model (latest-metadata-row-only).** `(agent_run_id, path)` is the natural key — exactly one row per file path per run; version is updated in place, not stored as a history row. New writes use the canonical UPSERT: `INSERT INTO operator_run_files (...) VALUES (..., 1, ...) ON CONFLICT (agent_run_id, path) DO UPDATE SET version = operator_run_files.version + 1, size_bytes = EXCLUDED.size_bytes, content_sha256 = EXCLUDED.content_sha256, mime_type = EXCLUDED.mime_type, emitted_by = EXCLUDED.emitted_by, emitted_at = NOW() RETURNING version`. Concurrency: Postgres serialises conflicting INSERTs on the unique constraint, so each writer reads the prior `version` under a row lock when conflicting and increments atomically. No `MAX(version)`, no separate sequence, no per-row allocator state needed — the version is just `prior_row.version + 1` resolved by the UPSERT. | Yes — `CREATE TABLE IF NOT EXISTS`, idempotent RLS policy creation; UPSERT is naturally idempotent on `(agent_run_id, path)`. | Yes — `DROP TABLE operator_run_files CASCADE` + Chunk-1 reversal of the rlsProtectedTables.ts edit. |

One new tenant-scoped table: `operator_run_files`. Migration 0348 creates the table and its RLS policy (filtering on the row's own `organisation_id` column — faster plan than joining through `agent_runs`). A paired TypeScript edit in Chunk 1 (§4.3 `server/config/rlsProtectedTables.ts` row) adds the manifest entry — a SQL migration cannot mutate a TypeScript file, so the two land in the same chunk but as separate edits. The three existing tables touched by V2 (`subaccount_agents`, `actions`, `delegation_outcomes`) are already RLS-policied and present in the manifest; column additions don't require new policies.

### 4.2 New service code

| Path | Purpose |
|---|---|
| `server/services/operatorSandboxFileEventBridge.ts` | Tool-call interceptor for runtime tool-registry file writes. Uploads file to R2 via existing `getS3Client()` / `getBucketName()` (`server/lib/storage.ts`), executes the canonical UPSERT against `operator_run_files` (§4.1) capturing `RETURNING version`, derives the event type from the returned version (`version = 1 ⇒ file.created`; `version > 1 ⇒ file.modified`), then emits the event via `pg-boss` `operator-session-progressed` channel and bridges to WebSocket `agent-run` channel. A preflight existence check is NEVER used as the source of truth for the event type — it is permitted only as a fast-path watcher dedupe (§5.7). |
| `server/services/operatorSandboxFileEventBridgePure.ts` | Pure helpers: shape validation, MIME detection, content-sha256 computation, watcher dedupe (`existing.content_sha256 === observed`), and event-type derivation from the persisted UPSERT result (`version === 1 ? 'file.created' : 'file.modified'`). The pure helper takes the post-UPSERT `version` as input — it does NOT perform any preflight lookup of its own. |
| `server/services/crossOwnerDelegationAuthorisation.ts` | Two-layer authorisation signal detection (Layer 1: parser-emitted named-owner reference in `RoutingContext.normalised_intent_text`; Layer 2: explicit owner-scoped capability request emitted by a trusted parent-agent tool call payload). Returns `{ authorised: true, target_owner_user_id, signal }` or `{ authorised: false, clarifying_question: string }`. Does NOT build the full `CROSS_OWNER_DELEGATION_REQUEST` — the assembler below does that. |
| `server/services/crossOwnerDelegationAuthorisationPure.ts` | Pure rules: regex set for possessives (`"Michael's calendar"`, `"my colleague Jane's inbox"`), known-user resolution against subaccount membership, normalisation. |
| `server/services/crossOwnerDelegationRequestAssembler.ts` | Higher-level assembler. Inputs: parent-run record + `RoutingContext` + authorisation result + parent-agent tool-call payload. Output: a complete `CROSS_OWNER_DELEGATION_REQUEST` (§5.4) including `required_capabilities`, `delegation_scope`, and `cross_owner_approval_timeout_policy`. Owns the WRITE of `delegation_outcomes.cross_owner_approval_timeout_policy` (column added in migration 0347). Consumed by the delegation router. |
| `server/services/crossOwnerDelegationRequestAssemblerPure.ts` | Pure derivation rules for `delegation_scope` (inherits from parent tool-call payload) and `cross_owner_approval_timeout_policy` (default `'fail_parent'`; `'continue_without_substep'` when parent tool-call payload sets `{ optional: true }`; `'ask_initiator'` when parent emits explicit "fall back to initiator" capability signal). |
| `server/services/operatorSessionInitialContextBundler.ts` | Builds the initial-context bundle (memory blocks + voice profile + owner identity context) under 4 KB budget. Reads `memory_blocks WHERE agent_id = ea.id`, `voice_profiles WHERE owner_user_id = ea.owner_user_id`, `users WHERE id = ea.owner_user_id` for timezone + working hours, and recent-activity summary (last 24h, from existing summary store). |
| `server/services/operatorSessionInitialContextBundlerPure.ts` | Pure trimming algorithm under §5.8. Priority: voice profile features > most-recent memory blocks > older memory blocks. Hard cap 4096 bytes serialised; trim algorithm deterministic. |
| `server/services/runTracePure.ts` (extend existing if present; otherwise new) | Add `runTraceProjectionForViewer(viewerUserId, run)` — pure projection helper for the cross-owner privacy invariant (§5.4). Called at read time by every consumer of the cross-owner run trace. Concrete consumers (added to §4.3 below) MUST invoke this helper before serialising any cross-owner run-trace payload over HTTP or WebSocket. |

### 4.3 Modified service code

| Path | Change |
|---|---|
| `server/services/capabilityMapService.ts` | (a) `computeCapabilityMapPure(skills, integrationReference, agentRow)` — emit `owner_user_id` in the output when `agentRow.owner_user_id` is non-null. (b) `matchCapability(routingContext, candidates)` — add the two-axis owner-scope rule per §5.2. (c) recompute helper that runs in the same transaction as `agents.owner_user_id` writes (per §6.4 invariant). |
| `server/services/integrationReferenceService.ts` | If `computeCapabilityMap` is invoked from here, thread the `owner_user_id` through; otherwise unchanged. (Audit during implementation; if no change needed, drop from this row.) |
| `server/services/operatorSessionLifecycleService.ts` | At session start (`operator_runs` insert path), call `operatorSessionInitialContextBundler` for EA-templated operator sessions; serialise into the operator runtime's start payload. |
| `server/services/operatorSessionService.ts` | Wire the file-event bridge into the operator-session tool-registry handler so file-write tool calls trigger `operatorSandboxFileEventBridge.handle*` before returning to the runtime. |
| `server/services/agentExecutionService.ts` | Verify operator-mode EA dispatch — the existing path is expected to work without modification once the EA's `controller_style_allowed` is flipped; spec records the no-op confirmation as an acceptance criterion. |
| `server/services/actionService.ts` | When proposing a cross-owner action, set `approver_user_id` to the executor agent's `owner_user_id`; same row otherwise. Approval-queue read path (`listPendingApprovalsForUser(userId)`) gains a filter that includes rows where `approver_user_id = $1`. |
| `server/jobs/workflowGateStallNotifyJob.ts` | When emitting the stall notification for a cross-owner approval, route to the `approver_user_id` Slack identity; carry the typed pause reason `awaiting_cross_owner_approval` from the parent task. Honour `cross_owner_approval_timeout_policy` at hard-stop: default `'fail_parent'`, opt-in `'continue_without_substep'` or `'ask_initiator'`. |
| `server/services/controllerStyleResolver.ts` | NO CHANGE expected. Spec records the no-op confirmation as an acceptance criterion — when the EA's allowed-set is `'native_and_operator'`, the resolver's existing four-case logic (explicit override, subaccount default, mode default, constraint downgrade) selects operator on the orchestrator's request without modification. |
| `server/tools/capabilities/capabilityDiscoveryHandlers.ts` | Orchestrator-side intent parser + matcher entry point (`executeCheckCapabilityGap`, dispatched by `server/services/skillExecutor.ts:1767-1770`). Propagate `requester_user_id` from the authenticated request principal into the `RoutingContext`; parse `@PA` / `@MyAssistant` / `@<DisplayName>` and populate `addressed_agent`; resolve `target_owner_user_id` from intent text or tool-call payload via `crossOwnerDelegationAuthorisation`. |
| `server/services/skillExecutor.ts` | No direct change expected: this file dispatches to the `check_capability_gap` handler above. Spec records the no-op confirmation as an acceptance criterion. If the audit during Chunk 2 reveals that `requester_user_id` propagation requires plumbing through `skillExecutor`'s `context` object, the change is additive and remains within this row. |
| `server/services/agentExecutionEventService.ts` | Run-trace event-stream read path. On every cross-owner run-trace fetch (paginated read, replay, snapshot dump), the service invokes `runTraceProjectionForViewer(viewerUserId, run)` (§4.2) BEFORE returning to the route layer. The projection applies the §5.4 privacy invariant by filtering owner-private fields from initiator-side views. Existing primitive — V2 only adds the projection invocation; no schema or per-event filtering changes. |
| `server/routes/taskEventStream.ts` | Server-Sent-Events / WebSocket bridge for the `agent-run` channel. Adds the same `runTraceProjectionForViewer(viewerUserId, run)` invocation on the outbound side before sending an event frame to the FE. Two-layer enforcement (service + route) is deliberate: a future direct consumer of `agentExecutionEventService` that bypasses the route still gets the projection because the service applies it first. |
| `server/routes/agentRuns.ts` | Run-trace HTTP read endpoints. Same projection invocation on the outbound serialisation path. Cross-owner runs MUST NOT serialise raw owner-side payloads to the initiator's HTTP response. Acceptance criterion in Chunk 3: write a small pure-function test that asserts `runTraceProjectionForViewer` blanks the owner-private fields when `viewerUserId !== run.ownerUserId`. |
| `server/config/rlsProtectedTables.ts` | Add `operator_run_files` to the RLS-protected table manifest. TypeScript edit in Chunk 1, paired with migration 0348 (the migration creates the table + RLS policy; this edit registers it in the manifest so `verify-rls-coverage.sh` recognises it). |

### 4.4 New CI gate

| Path | Purpose |
|---|---|
| `scripts/gates/verify-capability-map-shape.sh` | Per brief §3.3: confirms every persisted `subaccount_agents.capability_map` row satisfies the five invariants (subaccount-owned rows: `owner_user_id` absent/null; user-owned rows: matches `agents.owner_user_id` exactly; soft-deleted excluded; no dangling user refs; recompute path leaves no stale `owner_user_id`). |

### 4.5 Sandbox-template change

| Path | Change |
|---|---|
| `infra/sandbox-templates/operator-session/` | Add `chokidar`-equivalent filesystem watcher process to the sandbox template image. Watches `/workspace/artefacts/` and `~/Downloads/`. Emits the same `file.*` event shape used by the tool-call interceptor (bridges back to the parent process, which calls `operatorSandboxFileEventBridge`). **Path-safety invariant:** the watcher only emits events for paths whose `realpath` (resolved with symlinks expanded) remains strictly inside the configured watched roots. Path-traversal attempts, symlinks that resolve outside the roots, hidden credential-style paths (e.g. `.env`, `*.pem`, `*.key`, `.ssh/*`, `.aws/*`), and any parent-directory escapes are ignored and logged at `warn` severity with the unresolved path redacted. Browser downloads and script outputs are less controlled than tool writes, so the watcher is the security boundary. |

### 4.6 Shared types

| Path | Change |
|---|---|
| `shared/types/routingContext.ts` (new file if absent; otherwise extend existing) | Add `requester_user_id: string`, `target_owner_user_id?: string`, `raw_intent_text: string`, `normalised_intent_text: string`, `addressed_agent: { id: string; score_boost: number } | null`, `address_parse_result: 'matched' | 'not_found' | 'collision' | 'unsupported_cross_owner'`. |
| `shared/types/capabilityMap.ts` (new if absent) | Add optional `owner_user_id?: string` on the JSONB shape; type-narrows when `agentRow.owner_user_id` is non-null. |
| `shared/types/operatorEvents.ts` (extend existing operator-event types) | Add four new event variants: `file.created`, `file.modified`, `cross_owner_substep.awaiting_initiator_decision`, and `cross_owner_substep.completed`. `file.*` payload shape per §5.7; `cross_owner_substep.completed` payload per §9.4 (carries `parent_run_id`, `substep_id`, `status: 'success' | 'partial' | 'failed'`, optional typed `reason`); `cross_owner_substep.awaiting_initiator_decision` payload carries `parent_run_id`, `substep_id`, and the typed decision request shape (see §5.6 `ask_initiator` branch). Each variant must be registered with criticality in the `AGENT_EXECUTION_EVENT_CRITICALITY` registry (`shared/types/agentExecutionLog.ts`) so `verify-operator-event-registry.sh` passes. Other sub-step lifecycle states (`proposed`, `authorised`, `routed`, `executing`) are tracked on the `delegation_outcomes.substep_status` column (added in migration 0347) and do NOT surface as run-trace events (per §9.4). The `substep_id` field on every `cross_owner_substep.*` event is `delegation_outcomes.id` for the matching row. |
| `shared/types/crossOwnerApproval.ts` (new) | `CrossOwnerApprovalTimeoutPolicy` literal union; two pause-reason constants: `awaiting_cross_owner_approval` (V1 same-owner approval path, V2 cross-owner approval path) and `awaiting_initiator_decision_after_cross_owner_timeout` (emitted only when `cross_owner_approval_timeout_policy = 'ask_initiator'` fires per §5.6). |
| `shared/types/agentExecutionLog.ts` (extend existing) | Add four new entries to the `AGENT_EXECUTION_EVENT_CRITICALITY` registry — one per V2-added event variant declared in `shared/types/operatorEvents.ts` (above). The registry is a `Readonly<Record<AgentExecutionEventType, boolean>>` (single source of truth at `shared/types/agentExecutionLog.ts:408`); `true` = critical retry-tier (run-flow-relevant; treated like `run.started` / `run.completed` / `llm.completed` / `handoff.decided`), `false` = info-tier (UI-progress; treated like `skill.invoked` / `skill.completed` / `tool.error`). Required assignments: `'file.created': false`, `'file.modified': false` (UI-progress only — owner-side FE renders a file appearing; not run-flow-critical). `'cross_owner_substep.awaiting_initiator_decision': true`, `'cross_owner_substep.completed': true` (terminal-state semantics for the parent run; the parent-run resume path depends on these reaching the consumer). Edited in Chunk 1 alongside the new types. |

### 4.7 Doc-sync (mandatory at finalisation)

| Path | Change |
|---|---|
| `architecture.md` | Add universal OpenTaskView + run-trace invariant clause; add `owner_user_id` scope axis to the capability-map description; add cross-ownership delegation pattern under hierarchical-delegation section. |
| `docs/synthetos-governed-agentic-os-brief-v1.2.md` §5.6 | Note that all controllers feed the same run-trace surface (universal invariant). |
| `docs/capabilities.md` | Add the "standing autonomous operator" capability bullet under the EA entry; carries editorial rules (vendor-neutral, marketing-ready). |
| `KNOWLEDGE.md` | Append patterns extracted at finalisation (e.g. "two-axis routing for owner-scoped capabilities," "approval routes follow executor's owner, not initiator," "live-file events on R2"). |

### 4.8 Referenced existing primitives (no code change, named for traceability)

Files and gates that this spec cites in §6, §8, §9, §10, and Appendix B but does NOT modify. Listed here so the §4 inventory-lock invariant ("every file mentioned in this spec appears in §4") holds without forcing prose rewrites.

| Path | Why cited |
|---|---|
| `scripts/gates/verify-rls-coverage.sh` | §10: re-runs to confirm `operator_run_files` (new in migration 0348) is registered in `rlsProtectedTables.ts` and that no UNREGISTERED new tables slipped past. |
| `scripts/gates/verify-rls-contract-compliance.sh` | §6.5, §10: confirms no direct-DB-access patterns introduced by `runTraceProjectionForViewer` / `actionService` changes. |
| `scripts/gates/verify-operator-event-registry.sh` | §10: extended check that all four V2-added variants (`file.created`, `file.modified`, `cross_owner_substep.awaiting_initiator_decision`, `cross_owner_substep.completed`) are registered in `AGENT_EXECUTION_EVENT_CRITICALITY`. Existing gate; no code change to the gate itself, but the registry it scans gains new entries (§4.6). |
| `docs/doc-sync.md` | §8 Chunk 9, Appendix B: canonical checklist for finalisation doc updates. No edit required. |
| `references/test-gate-policy.md` | Appendix B: confirm `verify-capability-map-shape.sh` is listed. No edit required unless the gate is missing. |
| `docs/spec-authoring-checklist.md` | §5 intro: anatomy reference for contract rigour. No edit required. |
| `.claude/agents/chatgpt-pr-review.md` | §8 Chunk 9: definition of the `chatgpt-pr-review` agent (doc-sync gate at finalisation). No code change. |
| `server/db/schema/delegationOutcomes.ts` | §5.4, §9.4, §9.7, §13 (#2): existing schema definition for `delegation_outcomes`. Migration 0347 (§4.1) extends it in-place with the cross-owner state-machine columns; Drizzle schema regeneration in Chunk 1 picks up the new columns. No hand-edits to this file beyond the regenerated output. |
| `client/src/pages/OpenTaskView.tsx` | §1 non-goals: the universal task-view surface that operator-mode runs render through unchanged. |
| `client/src/components/global-ask-bar/GlobalAskBar.tsx` | §1 non-goals: orchestrator entry; `@`-parsing is server-side, the FE component is unchanged. |
| `server/db/schema/operatorRunFiles.ts` (NEW) | New Drizzle schema definition for the `operator_run_files` table created in migration 0348. Exports a thin write helper used by `operatorSandboxFileEventBridge`. |
| `server/services/__tests__/capabilityMapServicePure.routing.test.ts` (CREATED in Chunk 2) | Appendix A: concrete test fixtures for the four routing fixtures. New file; the path is locked here even though the file lands in Chunk 2 — see §4.2/§4.3 for the implementation files those tests cover. |
| `server/services/eaDrafts/` | §1 non-goals: existing EA-specific helper directory; V2 does NOT extend it. Cited so the "no EA branching in orchestrator" claim survives audit. |
| `server/services/voiceProfile/` | §1 non-goals: existing EA-specific helper directory; V2 does NOT extend it. Same survival rationale as `eaDrafts/`. |
| `docs/spec-context.md` | §1 framing assumptions, §3 ranked-source #5. The agent-facing framing-ground-truth file; consulted by `spec-reviewer` and by the implementer to confirm framing assumptions are still current. No edit by this build (operator-maintained). |
| `tasks/builds/user-owned-agents/brief.md` | §3 ranked-source #3, §5.4 broker invariant citation. No edit (already merged). |
| `tasks/builds/operator-backend/brief.md` | §3 ranked-source #3, §1 universal-OpenTaskView invariant citation, §7 prompt-cache contract. No edit (already merged as Spec D / PR #288). |
| `tasks/builds/personal-assistant-v1/brief.md` | §3 ranked-source #3, §5.8 voice-profile + memory-block contract citation. No edit (already merged). |
| `tasks/todo.md` | §13: historical traceability only — schema decisions `PA-V2-OP-S1` (file-events backing store) and `PA-V2-OP-S2` (cross-owner state machine) were tracked here before resolution on 2026-05-13. Both are now locked in §4.1 (migrations 0347 and 0348) and §13 entries are RESOLVED; the `tasks/todo.md` rows may be removed at finalisation. |
| `server/lib/storage.ts` | §4.2 `operatorSandboxFileEventBridge.ts` and §8 Chunk 7: provides existing `getS3Client()` / `getBucketName()` helpers; no edit. |

## 5. Domain model + contracts

Every data shape crossing a service boundary in V2 has a named contract below. Each contract pins producer + consumer + TypeScript shape, plus a concrete example payload where copy-paste clarity is the point and a source-of-truth precedence note where two stores hold related data. Contracts whose shape is fully specified by the TypeScript declaration (literal unions, simple field additions) carry shape + producer/consumer only; an example would be redundant. Anatomy rules per `docs/spec-authoring-checklist.md` §3.

### 5.1 Capability-map shape (extension)

**Name:** `CAPABILITY_MAP_V2`
**Type:** Persisted JSONB on `subaccount_agents.capability_map`
**Producer:** `computeCapabilityMapPure(skills, integrationReference, agentRow)`
**Consumer:** `matchCapability(routingContext, candidates)` + read paths in `subaccount_agents` reads

```ts
type CapabilityMapV2 = {
  computedAt: string,                  // ISO timestamp
  referenceLastUpdated?: string,       // unchanged
  integrations: string[],              // unchanged
  read_capabilities: string[],         // unchanged
  write_capabilities: string[],        // unchanged
  skills: string[],                    // unchanged
  primitives: string[],                // unchanged
  owner_user_id?: string,              // NEW — present when agentRow.owner_user_id is non-null
}
```

Example (user-owned EA):

```json
{
  "computedAt": "2026-05-14T08:00:00.000Z",
  "integrations": ["gmail", "google_calendar", "slack"],
  "read_capabilities": ["inbox_read", "calendar_read", "slack_read"],
  "write_capabilities": ["draft_email", "create_event", "send_slack"],
  "skills": ["check_calendar", "draft_reply", "summarise_thread"],
  "primitives": ["proposeAction"],
  "owner_user_id": "01928a4b-3f50-7a91-8f12-2c5e9c7d4a01"
}
```

Example (subaccount-owned generic agent):

```json
{
  "computedAt": "2026-05-14T08:00:00.000Z",
  "integrations": ["hubspot"],
  "read_capabilities": ["crm_read"],
  "write_capabilities": ["crm_update"],
  "skills": ["lookup_contact"],
  "primitives": ["proposeAction"]
}
```

**Source-of-truth precedence:** `agents.owner_user_id` is canonical. `capability_map.owner_user_id` is a recomputed projection. Reads MUST use `agents.owner_user_id` for credential resolution; `capability_map.owner_user_id` is read only by the matcher. If the two disagree, the recompute is stale — the CI gate `verify-capability-map-shape.sh` (§4.4) catches drift.

### 5.2 RoutingContext (extension)

**Name:** `ROUTING_CONTEXT_V2`
**Type:** TypeScript interface, in-memory only (not persisted)
**Producer:** orchestrator request-intake (intent parser + auth resolver)
**Consumer:** `matchCapability` (capability matching), delegation router (`crossOwnerDelegationAuthorisation` + `crossOwnerDelegationRequestAssembler`). Not a consumer of `runTraceProjectionForViewer` — that helper takes `(viewerUserId, run)` per §4.2, not a `RoutingContextV2`.

```ts
interface RoutingContextV2 {
  organisationId: string,
  subaccountId: string,
  requester_user_id: string,           // NEW (required)
  target_owner_user_id?: string,       // NEW (optional)
  requested_capabilities: string[],
  intent: string,                      // backward-compatible alias for normalised_intent_text
  raw_intent_text: string,             // NEW — unmodified input
  normalised_intent_text: string,      // NEW — after address extraction + stripping
  addressed_agent: { id: string; score_boost: number } | null,  // NEW
  address_parse_result: 'matched' | 'not_found' | 'collision' | 'unsupported_cross_owner',  // NEW
  // ... existing fields preserved
}
```

**Matcher rule** (the only behavioural addition):

```
For each candidate agent c in candidates:
  if c.capability_map.owner_user_id is set:
    if routingContext.target_owner_user_id is set:
      MATCH iff c.capability_map.owner_user_id == routingContext.target_owner_user_id
    else:
      MATCH iff c.capability_map.owner_user_id == routingContext.requester_user_id
  else:
    MATCH iff c.subaccount_id == routingContext.subaccountId (existing rule)
```

`target_owner_user_id` is populated by `crossOwnerDelegationAuthorisation` (§5.4). If the resolver returns `{ authorised: false }`, the orchestrator returns a clarifying question instead of routing.

### 5.3 Addressing parser contract

**Name:** `ADDRESSING_PARSE_RESULT`
**Producer:** orchestrator intent parser (Step 1 of request-intake)
**Consumer:** `RoutingContext` populator + matcher score-boost layer

```ts
type AddressingParseResult =
  | { kind: 'matched',   agent: { id: string; displayName: string; score_boost: 0.15 } }
  | { kind: 'not_found', strippedToken: string }
  | { kind: 'collision', candidates: string[]; strippedToken: string }
  | { kind: 'unsupported_cross_owner', strippedToken: string }
```

Address forms:

| Form | Resolution |
|---|---|
| `@PA` | `agents WHERE owner_user_id = requester_user_id AND system_agent_slug = 'executive-assistant' AND deleted_at IS NULL` |
| `@MyAssistant` | alias for `@PA` |
| `@<DisplayName>` | Reuses the existing agent visibility rules used by the orchestrator's capability-discovery path (`server/tools/capabilities/capabilityDiscoveryHandlers.ts`, dispatched by `server/services/skillExecutor.ts:1767-1770`) — NOT a new org-wide query. In practice this means the resolver applies the same `(organisationId, subaccountId)` scoping the rest of the matcher already uses, then filters by `name = <DisplayName> AND deleted_at IS NULL`. The implementer audits the existing visibility helper during Chunk 2; if no shared helper exists, the resolver applies `organisation_id = $org AND subaccount_id = routingContext.subaccountId AND deleted_at IS NULL` (subaccount-scoped, not org-wide) and surfaces the gap to the audit log. |
| `@<User>'s PA` | NOT supported in V2 — returns `'unsupported_cross_owner'` (logged in run-trace for diagnostics) |

**Collision rule** (brief §3.5 ratified): if `@<DisplayName>` resolves to ≥2 agents, no score boost is applied and `address_parse_result = 'collision'`. Pure capability matching proceeds.

**Score boost magnitude:** 0.15 (additive). The matcher's score scale is `[0, 1]` and is owned by `capabilityMapService.matchCapability` (§4.3) — V2 adds the boost as a small additive term that moves a tied candidate to the front without overriding capability mismatches. Implementation acceptance criterion: a candidate that fails capability matching (zero base score) cannot be promoted into the candidate set by a 0.15 address boost; the boost is applied only to candidates that already match on capabilities. If the existing matcher's score scale is found during Chunk 2 audit to differ from `[0, 1]` (e.g. it returns raw counts), the boost magnitude is recalibrated proportionally inside `matchCapability` and the spec is amended in the same chunk.

### 5.4 Cross-owner delegation contract

**Name:** `CROSS_OWNER_DELEGATION_REQUEST`
**Producer:** `crossOwnerDelegationRequestAssembler.build(...)` (§4.2). Upstream inputs to the assembler include the parent-run record, the `RoutingContext` (§5.2), the result of `crossOwnerDelegationAuthorisation.authorise(...)` (which contributes `authorisation_signal` + `target_owner_user_id`), and the parent-agent tool-call payload (which contributes `delegation_scope` + the `{ optional: true }` flag and any explicit "fall back to initiator" capability signal).
**Consumer:** matcher (sub-step routing) + credential broker + approval router + run-trace projection

```ts
type CrossOwnerDelegationRequest = {
  parent_run_id: string,
  parent_owner_principal: 'subaccount' | 'user' | 'org' | 'system',
  parent_owner_id: string,
  initiator_user_id: string,                // who initiated the parent task
  required_capabilities: string[],
  authorisation_signal: 'user_named_owner' | 'parent_agent_explicit_capability',
  target_owner_user_id: string,
  delegation_scope: DelegationScope,        // existing enum, reused
  cross_owner_approval_timeout_policy: 'fail_parent' | 'continue_without_substep' | 'ask_initiator',  // default 'fail_parent'
}
```

**Authorisation invariant** (brief §3.6 ratified, two-layer rule):

1. **Layer 1** — `crossOwnerDelegationAuthorisationPure` detects a named-owner or possessive reference (`"Michael's calendar"`, `"my colleague Jane's inbox"`) in `normalised_intent_text`. Resolves against subaccount membership. If matched, returns `{ authorised: true, target_owner_user_id, signal: 'user_named_owner' }`.
2. **Layer 2** — the parent agent's tool call payload includes an explicit `target_owner_user_id` field. Returns `{ authorised: true, target_owner_user_id, signal: 'parent_agent_explicit_capability' }`.
3. **Else** — returns `{ authorised: false, clarifying_question: "Whose data does this need?" }`. The orchestrator surfaces this verbatim via the existing disambiguation flow.

**Untrusted-client invariant.** `target_owner_user_id` MUST NOT be accepted from HTTP / client / FE input under any circumstances. The orchestrator's request-intake path discards any client-supplied `target_owner_user_id` on the inbound payload before constructing `RoutingContext`. The field may only be set by (a) the server-side authorisation resolver above (Layer 1, derived from intent text) or (b) a trusted server-internal parent-agent tool-call schema after the tool-call payload itself has passed its own validation (Layer 2). Treat any code path that propagates a client-supplied `target_owner_user_id` into `RoutingContext` as a security defect.

**Credentials follow the executor.** When the sub-run is routed to Michael's PA, the credential broker resolves with `ownerUserId: michael` (per `user-owned-agents` §3.3 broker invariant). The parent run's credentials are NOT used for the sub-run.

**Run-trace privacy projection** (brief §3.6 mandatory fixture):

| Viewer | Sees |
|---|---|
| Owner (executor's owner) | Full delegated sub-run trace, raw source data, approval detail, result |
| Initiator (parent run's initiator) | At any point: the current sub-step lifecycle state (`proposed` / `authorised` / `routed` / `executing` / `awaiting_cross_owner_approval` / `approved` / `rejected`) read on demand via the existing run-trace HTTP endpoint, sourced from `delegation_outcomes.substep_status` (column added in migration 0347), plus the run-trace event stream of emitted events: at most one `cross_owner_substep.awaiting_initiator_decision` event (only on `ask_initiator` timeout path) and exactly one terminal `cross_owner_substep.completed` event with `status: 'success' | 'partial' | 'failed'` plus typed result summary. No raw owner data is included on either path. Intermediate lifecycle states are READ-MODEL ONLY: they are visible to the initiator because the existing run-trace endpoint reads `delegation_outcomes.substep_status` (filtered by `runTraceProjectionForViewer` to hide owner-private payload fields) — they are NOT emitted as separate `cross_owner_substep.*` event variants (see §4.6, §9.4). The closed terminal-event vocabulary remains `success | partial | failed` per §9.4. |
| Shared parent run trace | Sub-run outcome only — no raw calendar slots, inbox snippets, draft bodies, attachment names, or credential-derived metadata from the target owner |

The projection is enforced at READ time by `runTraceProjectionForViewer(viewerUserId, run)` (new pure helper in `server/services/runTracePure.ts`), not by per-event filtering. The owner's events stay in the database; the projection chooses what to send over the wire to the initiator. Violations are security bugs.

**Initiator-visible lifecycle timing invariant.** The initiator's view of cross-owner sub-step lifecycle state is limited to coarse status values (the seven in-flight + three terminal values defined in §9.7) — it MUST NOT include owner-side per-state timestamps (`authorised_at`, `routed_at`, `executing_started_at`, individual approval-request and approval-decision timestamps, owner-side tool-call durations, or any other timing column on `delegation_outcomes` or related rows) beyond:

- The parent task's own `paused_at` / `resumed_at` timestamps (already visible to the initiator as part of the parent run trace).
- Timestamps explicitly included in the typed result summary on the terminal `cross_owner_substep.completed` event (the owner-side sub-run author opts these in by hand; the default is to include none).

The projection helper enforces this by allow-listing the timestamp fields it forwards on cross-owner sub-step rows when the viewer is the initiator. Any new timestamp column added to `delegation_outcomes` (or any other owner-side table referenced in the projection path) is owner-private by default and must be explicitly added to the allow-list — opt-in, not opt-out. This is to prevent fine-grained owner-activity inference (e.g. tracking when the owner is online, how long approvals took, whether the owner reviewed quickly or slowly) via lifecycle-state timing leaks that the coarse status enum alone would not reveal.

### 5.5 Approval row shape (`approver_user_id`)

**Name:** `APPROVAL_ROW_V2`
**Producer:** `actionService.proposeAction(..., { approver_user_id?: string })`
**Consumer:** approval queue read paths, stall notifier, Slack-approval delivery

```ts
// actions table — addition only
{
  // ... all existing columns
  approver_user_id: string | null,      // NEW. NULL = approve via existing initiator-defaulted path (V1 behaviour)
}
```

**Default rule:** when an action is proposed inside a cross-owner sub-run, `actionService` sets `approver_user_id = executor_agent.owner_user_id`. For all other proposals, `approver_user_id = NULL` (preserves V1 same-owner behaviour exactly).

**Semantics of `approver_user_id` (canonical):** `approver_user_id` is an **override** field, not the canonical approver for all approvals. NULL does NOT mean "approver unknown" — it means "derive approver using the existing V1 ownership rule (initiator-defaulted)." Implementations MUST NOT backfill `approver_user_id` for existing rows, and MUST NOT start writing `approver_user_id` for non-cross-owner proposals; doing so would silently change V1 approval semantics by short-circuiting the V1 initiator-derivation path. The column is read-only-when-NULL for the V1 path and override-only-when-set for the V2 cross-owner path.

**Read paths:** approval queue `listPendingApprovalsForUser(userId)` returns rows where `approver_user_id = $1` AND rows where `approver_user_id IS NULL AND <V1 initiator predicate>`. This is a UNION; both predicates can match the same user (operator who is also the owner of the executor agent).

### 5.6 Cross-owner approval timeout policy

**Name:** `CROSS_OWNER_APPROVAL_TIMEOUT_POLICY`
**Producer:** `crossOwnerDelegationRequestAssembler.build(...)` (§4.2) writes `delegation_outcomes.cross_owner_approval_timeout_policy` as part of the assembled `CROSS_OWNER_DELEGATION_REQUEST` row.
**Consumer:** `workflowGateStallNotifyJob` at the 24-hour hard-stop

```ts
type CrossOwnerApprovalTimeoutPolicy = 'fail_parent' | 'continue_without_substep' | 'ask_initiator'
```

**Default:** `'fail_parent'`. Sub-steps marked optional by the delegating agent's tool call (`{ optional: true }` in the delegation payload) may set `'continue_without_substep'`. `'ask_initiator'` is rare — used only when the parent agent emits an explicit "fall back to initiator" capability signal.

**Stall job behaviour:**

- `'fail_parent'` → parent task transitions to `failed` with reason `cross_owner_approval_timeout`; sub-run emits `cross_owner_substep.completed { status: 'failed', reason: 'cross_owner_approval_timeout' }` (terminal — per §9.4).
- `'continue_without_substep'` → mark the sub-step skipped; sub-run emits `cross_owner_substep.completed { status: 'partial', reason: 'cross_owner_approval_timed_out_optional' }` (terminal — per §9.4). Resume parent on next event.
- `'ask_initiator'` → sub-run is NOT yet terminal at the 24-hour boundary. The stall job (`server/jobs/workflowGateStallNotifyJob.ts` — see §4.3) emits a non-terminal `cross_owner_substep.awaiting_initiator_decision` event (the second emitted `cross_owner_substep.*` variant, registered alongside `.completed` in `AGENT_EXECUTION_EVENT_CRITICALITY` per §4.6), creates an approval row via `actionService.proposeAction(..., { approver_user_id: initiator_user_id })` so the typed decision request lands in the EXISTING approval queue read path (`listPendingApprovalsForUser(initiator_user_id)` — §4.3 actionService row), and the parent stays paused with `awaiting_initiator_decision_after_cross_owner_timeout` until the initiator resolves the approval. When the initiator's approval row transitions to terminal (approved/rejected via the existing approval-flow handler), the resume hook in the parent task triggers the sub-run to emit its single terminal `cross_owner_substep.completed { status: 'success' | 'failed', reason: 'initiator_resumed_after_cross_owner_timeout' | 'initiator_abandoned_after_cross_owner_timeout' }` event. There is no second 24-hour stall — the same V1 approval lifecycle handler that V2 already reuses for `awaiting_cross_owner_approval` also handles `awaiting_initiator_decision_after_cross_owner_timeout`. Both pause reasons resolve through the same existing `actions` → approval-queue → resume-on-decision plumbing.

### 5.7 File events (`file.created`, `file.modified`)

**Name:** `OPERATOR_FILE_EVENT`
**Producer:** `operatorSandboxFileEventBridge.handle*` (either tool-call interceptor path or sandbox-watcher path)
**Consumer:** `OpenTaskView` `FilesTab` via existing `agent-run` WebSocket channel

```ts
type OperatorFileEvent = {
  type: 'file.created' | 'file.modified',
  agentRunId: string,
  ownerUserId: string | null,         // executor's owner; null for subaccount-owned agents
  path: string,                       // relative path inside sandbox
  storageKey: string,                 // R2 key: runs/{agentRunId}/{relativePath}
  size: number,                       // bytes
  mimeType: string,
  version: number,                    // monotonic per (agentRunId, path); 1 for first create, +1 per modify
  contentSha256: string,
  emittedAt: string,                  // ISO timestamp
  emittedBy: 'tool_call' | 'watcher',
}
```

Example:

```json
{
  "type": "file.modified",
  "agentRunId": "01928a4b-3f50-7a91-8f12-2c5e9c7d4a01",
  "ownerUserId": "01928a4b-3f50-7a91-8f12-2c5e9c7d4a02",
  "path": "artefacts/report.md",
  "storageKey": "runs/01928a4b-3f50-7a91-8f12-2c5e9c7d4a01/artefacts/report.md",
  "size": 8492,
  "mimeType": "text/markdown",
  "version": 4,
  "contentSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "emittedAt": "2026-05-14T10:23:11.482Z",
  "emittedBy": "tool_call"
}
```

**Critical:** signed-read URLs are NOT included in event payloads. They expire (60–300s per existing `deriveSignedUrlExpiry()`) and would be stale in replayed run traces. The client requests a fresh signed URL via the existing `GET /api/runs/:runId/files/:storageKey/url` route when the user clicks to open the file.

**Source-of-truth precedence for files:** the R2 storage key is canonical content. The `operator_run_files` row is a metadata index. Event stream is a derived projection — replay of events MUST be idempotent against the row + storage key.

**Event-type derivation rule (canonical).** The bridge determines event type from the UPSERT result, NOT from a preflight existence check. The UPSERT (§4.1) returns the post-write `version`; if `version === 1` the bridge emits `file.created`, otherwise `file.modified`. This rule is required for correctness under concurrency — two writers racing to insert the same new path are serialised by the UNIQUE `(agent_run_id, path)` constraint, exactly one becomes `version = 1` (emits `file.created`), and the loser becomes `version = 2` (emits `file.modified`). A preflight existence lookup performed independently by both writers would observe "no prior row" on each side and both would incorrectly emit `file.created`. Preflight lookups are permitted ONLY for watcher dedupe (see below); they are never the source of truth for event type.

**Tool-call interceptor vs watcher precedence:** tool-call interceptor wins on `version` allocation by virtue of being the first writer through the UPSERT path. The watcher is a backstop for FS-write paths the tool registry does not cover (browser downloads, sandbox script outputs). **Watcher dedupe rule (latest-row-only semantics).** Given that `operator_run_files` stores exactly one row per `(agent_run_id, path)`, the watcher reads the CURRENT row for the observed `(agent_run_id, path)` and skips emit only when `current_row.content_sha256 === observed_hash`. If the hash differs (including the legitimate case where the file path was previously seen at a different hash and has now changed again), the watcher writes through the canonical UPSERT and emits based on the returned `version`. The watcher never inspects historical hashes — there are no history rows — so a file changing from hash A to B and back to A is treated as a new modify event (current row carries B; observed A differs; UPSERT advances version; emit `file.modified`). This is the correct behaviour: a regression-to-prior-content is still a change the FE should render.

**Cross-owner privacy projection for file events.** For initiator-side views of a cross-owner sub-run, every `file.created` / `file.modified` payload is filtered through `runTraceProjectionForViewer` (§5.4) before serialisation. Initiators see that a file artefact exists for a cross-owner sub-run ONLY when the delegated sub-run returns it as part of the typed result summary on the terminal `cross_owner_substep.completed` event. Raw filenames, storage keys, sizes, mime types, content hashes, and any other file metadata from the owner's private workspace are hidden from the initiator by default. The owner-side view is unchanged — owners see the full event stream including all `file.*` events.

### 5.8 Operator session initial-context bundle

**Name:** `OPERATOR_SESSION_INITIAL_CONTEXT_BUNDLE`
**Producer:** `operatorSessionInitialContextBundler.build(eaAgent, ownerUser)`
**Consumer:** operator runtime initial prompt assembly (consumed at sandbox boot)

```ts
type OperatorSessionInitialContextBundle = {
  voice_profile: {                          // priority 1
    tone_features: string[],
    style_markers: string[],
    do_not_use: string[],
    canonical_examples: string[],           // small, count-bounded
  } | null,
  memory_blocks: Array<{                    // priority 2: most-recent first
    label: string,
    content: string,
    updated_at: string,
  }>,
  owner_identity: {                         // priority 3
    timezone: string,                       // IANA, e.g. 'Europe/London'
    working_hours: { start: string; end: string } | null,
    recent_activity_summary?: string,       // last-24h compact summary
  },
  serialised_size_bytes: number,            // computed
}
```

**Size budget:** 4096 bytes serialised (JSON, no pretty-printing). Hard cap. Trimming algorithm (deterministic):

1. Include all of `voice_profile`.
2. Include `owner_identity` minus optional fields if needed.
3. Include `memory_blocks` newest-first until budget exhausted; drop overflow.
4. If `voice_profile` alone exceeds budget, the spec considers this a configuration error — log + fall back to a trimmed `voice_profile` containing only `tone_features` and `style_markers`.

**Mid-session updates:** memory writes during the session are stored via the runtime's existing `update_memory_block` tool call. The runtime re-loads the in-context memory only at chain-link boundaries — NOT mid-link. This is brief §4.A item 1, ratified.

**Voice profile updates:** voice profile is NOT updated by operator runs. The periodic voice-profile-derivation job (existing) is the only writer.

## 6. Permissions / RLS checklist

V2 modifies three existing tenant-scoped tables and creates one new tenant-scoped table. Existing (column adds only): `subaccount_agents` (via `capability_map`), `actions` (via `approver_user_id`), `delegation_outcomes` (via `cross_owner_approval_timeout_policy`, `substep_status`, `terminal_at`). All three are already RLS-policied and present in `server/config/rlsProtectedTables.ts` — column additions don't require new policies. New: `operator_run_files` (migration 0348) — covered in §6.1 below.

**6.1 Tenant-scoped table inventory.** One new tenant-scoped table: `operator_run_files` (created by migration 0348; strategy locked 2026-05-13 — see §4.1). The manifest entry in `server/config/rlsProtectedTables.ts` is a paired TypeScript edit in Chunk 1 (§4.3), not part of the SQL migration. RLS policy filters on the row's own `organisation_id` column (no join through `agent_runs` — faster plan). The three other tables touched by V2 (`subaccount_agents`, `actions`, `delegation_outcomes`) already have RLS coverage; column additions don't require new policies. `verify-rls-coverage.sh` runs against the manifest on every CI build and will fail if `operator_run_files` is missing.

**6.2 Route guards.** The orchestrator's request-intake path is already gated by `authenticate` middleware (sets `req.user.id` → `requester_user_id`). No new HTTP endpoints in V2.

**6.3 Principal-scoped context.** The credential broker (`user-owned-agents` §3.3) is the principal-scoped read path. When a sub-run executes under `target_owner_user_id`, the broker resolves credentials with `ownerUserId = target_owner_user_id` and the connection runs with that principal context — existing primitive, no change.

**6.4 Recompute invariant.** When `agents.owner_user_id` is changed (rare — typically only on re-seeding or user reassignment), `capability_map.owner_user_id` MUST be recomputed in the same transaction. Implementation pattern: a Drizzle transaction wraps the `agents` update AND the `capability_map` recompute via `computeCapabilityMapPure`. The CI gate `verify-capability-map-shape.sh` catches any drift that escapes this invariant.

**6.5 Run-trace projection.** The cross-owner privacy invariant (§5.4) is enforced by `runTraceProjectionForViewer` at read time, NOT by RLS. The owner's events stay in `agent_execution_events` (already RLS-policied for tenant isolation, and the projection helper additionally filters by viewer-role). Direct DB reads (forbidden by `verify-rls-contract-compliance.sh`) cannot bypass this — all reads go through `agentExecutionEventService`.

## 7. Execution model

| Operation | Model | Justification |
|---|---|---|
| EA seed flip (migration 0345) | One-shot SQL migration, no rollout flag | Pre-prod posture (`feature_flags: only_for_behaviour_modes` in `docs/spec-context.md`). Idempotent on the predicate. |
| Capability-map recompute on agent ownership change | Inline, same-transaction with `agents` write | Source-of-truth precedence (§5.1) requires synchronous recompute. No job row. |
| Orchestrator routing (RoutingContext build + match) | Inline / synchronous | Caller blocks on routing result. |
| Cross-owner delegation authorisation | Inline / synchronous | Cheap pure check. |
| Cross-owner approval routing (write of `approver_user_id`) | Inline within `actionService.proposeAction` transaction | Same transaction as the action row write. |
| Cross-owner approval stall job | pg-boss queue (existing `workflowGateStallNotifyJob`) | V1 pattern, unchanged. Only the recipient resolution and the typed pause reason are new. |
| Operator-session initial-context bundle | Inline at session start (called by `operatorSessionLifecycleService.startSession`) | Operator runtime needs the bundle in its boot payload; cannot be async. |
| File event emission (tool-call path) | Inline within the tool-call handler — synchronous R2 upload, synchronous event emit | Tool registry returns synchronously to the runtime; deferring the upload would race with subsequent reads. |
| File event emission (watcher path) | Async, sandbox-internal process → IPC to runtime → bridge | The watcher cannot block file-system operations; it observes after the fact. Bridges via pg-boss `operator-session-progressed` channel. |
| Cross-owner timeout decision | pg-boss stall job at hard-stop boundary | Existing 24-hour stall threshold. |

**No new pg-boss queues.** All new work either rides existing queues (`operator-session-progressed`, `agent-run` WebSocket bridge) or is inline.

**No new prompt-cache partitions.** The initial-context bundle is part of the operator runtime's initial prompt; cache behaviour is governed by the operator runtime's existing partition contract (per Spec D §3.4).

## 8. Chunk sequencing (dependency graph)

V2 ships as a single Phase 2 build session. Internally, chunks sequence as follows. Every chunk's prerequisites must ship in an equal-or-earlier chunk.

**Chunk 1 — Foundation: schema + types + CI gate**

Migrations 0345 (EA controller-style flip), 0346 (`actions.approver_user_id`), 0347 (`delegation_outcomes` cross-owner state columns: `cross_owner_approval_timeout_policy`, `substep_status`, `terminal_at`, partial index), 0348 (new `operator_run_files` table + RLS policy). Paired TypeScript edit to `server/config/rlsProtectedTables.ts` registering `operator_run_files` (the SQL migration cannot mutate the manifest). New `server/db/schema/operatorRunFiles.ts` Drizzle schema. New shared types in `shared/types/` (`routingContext.ts`, `capabilityMap.ts`, `operatorEvents.ts` extensions, `crossOwnerApproval.ts`). New CI gate `scripts/gates/verify-capability-map-shape.sh`. `computeCapabilityMapPure` extension to emit `owner_user_id`. Backfill: re-run capability-map recompute for all user-owned agents (one-shot script in same chunk).

Prerequisites: none (composes existing schema columns).
Verifies: typecheck, lint, `verify-capability-map-shape.sh` + `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` pass on fresh DB. The RLS-coverage gate must confirm `operator_run_files` is registered.

**Chunk 2 — Routing context + matcher rule**

`RoutingContext` shape extension. `matchCapability` two-axis rule. `requester_user_id` propagation from authenticated request principal. Address-parser extension (`@PA` / `@MyAssistant` / `@<DisplayName>`).

Prerequisites: Chunk 1 (capability_map.owner_user_id exists for matcher to read).
Verifies: typecheck, lint. Pure-function unit tests for the matcher (allowed under `runtime_tests: pure_function_only`).

**Chunk 3 — Cross-owner delegation authorisation + request assembly + credentials**

`crossOwnerDelegationAuthorisation` service + pure helper (Layer-1/Layer-2 detection). `crossOwnerDelegationRequestAssembler` service + pure helper (assembles the full `CROSS_OWNER_DELEGATION_REQUEST` per §5.4; owns the WRITE of `delegation_outcomes.cross_owner_approval_timeout_policy` added in migration 0347). Wire both into the delegation router (authorisation first, then assembler). Credential-broker invocation with `ownerUserId = target_owner_user_id` is existing behaviour (no change required, but spec records the acceptance criterion: a sub-run routed to Michael's PA reads Michael's credentials). The `runTraceProjectionForViewer` pure helper (§4.2) lands here so the privacy invariant is in place before any cross-owner sub-run ships.

Prerequisites: Chunk 2 (matcher must already route correctly).
Verifies: typecheck, lint. Pure-function unit tests for the authorisation rules, the assembler's `delegation_scope` / timeout-policy derivation, and `runTraceProjectionForViewer`.

**Chunk 4 — Approval-owner routing + stall job**

Migration 0346 already shipped in Chunk 1 (column add). This chunk wires `actionService.proposeAction` to set `approver_user_id` for cross-owner actions, updates `listPendingApprovalsForUser` to union both predicates, and updates `workflowGateStallNotifyJob` to route to `approver_user_id` with the new typed pause reason and timeout-policy decision tree.

Prerequisites: Chunk 3 (delegation must be authorised before approval routing matters).
Verifies: typecheck, lint. Pure-function unit tests for the union read path and timeout-policy decision tree.

**Chunk 5 — Operator-mode EA enablement**

Migration 0345 (the flip) — schedules during Chunk 1 if possible, but verification (operator-mode run actually dispatched) belongs here because it requires Chunk 2 + Chunk 3 routing to succeed. `controllerStyleResolver` confirmed no-op. `agentExecutionService` confirmed no-op. Operator-mode EA dispatches via the existing operator-backend path.

Prerequisites: Chunks 1–3.
Verifies: typecheck, lint. Acceptance test: a manual operator-mode EA run completes through the existing operator-backend prototypes (r1, r2, r17 chain-link).

**Chunk 6 — Operator-session initial-context bundling**

`operatorSessionInitialContextBundler` + pure helper. Wire into `operatorSessionLifecycleService.startSession`. Trim algorithm validated against 4 KB budget.

Prerequisites: Chunk 5 (operator-mode EA must dispatch first).
Verifies: typecheck, lint. Pure-function unit tests for trim algorithm budget compliance.

**Chunk 7 — Live-file events: tool-call interceptor**

`operatorSandboxFileEventBridge` + pure helper. Wire into `operatorSessionService` tool-registry handler. R2 upload via existing `getS3Client()` / `getBucketName()`. `operator_run_files` row writes (table created in migration 0348, ships in Chunk 1). Event emission onto `operator-session-progressed` channel; bridge to WebSocket `agent-run` channel.

Prerequisites: Chunk 5 (operator-mode runs must exist to emit file events from).
Verifies: typecheck, lint. Pure-function unit tests for create-vs-modify decision and version allocation.

**Chunk 8 — Live-file events: sandbox-side watcher**

Add the chokidar-equivalent process to `infra/sandbox-templates/operator-session/`. Configure it to watch `/workspace/artefacts/` and `~/Downloads/`. IPC to runtime → bridge.

Prerequisites: Chunk 7 (event shape + bridge contract must already exist).
Verifies: typecheck, lint. Sandbox-template build succeeds.

**Chunk 9 — Doc-sync + KNOWLEDGE updates**

Per §4.7. Architecture clauses, master-brief edit, `docs/capabilities.md` editorial-compliant capability addition, `KNOWLEDGE.md` pattern extraction.

Prerequisites: all functional chunks (1–8) merged so that doc claims are backed by code.
Verifies: doc-sync checklist (`docs/doc-sync.md`) passes; `chatgpt-pr-review` doc-sync gate accepts.

**No backward dependencies. No orphaned deferrals. No phase-boundary contradictions.** Every column referenced by code in Chunk N is created in Chunk ≤N.

## 9. Execution-safety contracts

### 9.1 Idempotency posture

| Write path | Posture | Mechanism |
|---|---|---|
| Migration 0345 (EA seed flip) | `state-based` | `WHERE controller_style_allowed = 'native_only'` predicate. Re-running is a no-op. |
| Migration 0346 (`approver_user_id` add) | `state-based` | `ADD COLUMN IF NOT EXISTS`. |
| Migration 0347 (timeout policy add) | `state-based` | `ADD COLUMN IF NOT EXISTS`. |
| `capability_map` recompute | `state-based` | Always full-replace within the same transaction; no partial updates. |
| Cross-owner action proposal (`actionService.proposeAction` with `approver_user_id`) | `key-based` | Existing `proposeAction` idempotency key (unchanged). |
| `operator_run_files` row write on `file.*` | `key-based` | UNIQUE `(agent_run_id, path)` on `operator_run_files` (migration 0348). Canonical UPSERT (§4.1) `RETURNING version`; event type derived from `version` (1 ⇒ created, >1 ⇒ modified). Never INSERT duplicate; never decide event type from a preflight lookup. |
| File event emit | `state-based` | Watcher dedupe checks the current row's `content_sha256` against the observed hash (latest-row-only — §5.7). Tool-call path advances version monotonically via the UPSERT. |
| Cross-owner timeout job | `state-based` | UPDATE … WHERE `status = 'pending_approval' AND created_at < NOW() - INTERVAL '24 hours'`. 0 rows affected = already resolved. |

### 9.2 Retry classification

| Operation | Class | Boundary |
|---|---|---|
| `proposeAction` (with `approver_user_id`) | `guarded` | Existing idempotency key. Retry-safe. |
| R2 upload of file content | `safe` | Existing `withBackoff` wrapper at the storage layer. R2 PUT is idempotent. |
| `operator_run_files` row insert | `guarded` | UNIQUE `(agent_run_id, path)` (migration 0348). Retry-on-conflict → fall through to modify path. |
| Event emit onto pg-boss | `safe` | pg-boss `send()` is at-least-once; consumers must dedupe by `agentRunId + path + version`. |
| `controllerStyleResolver` decisions | `safe` | Pure. Deterministic. |
| Authorisation signal resolution | `safe` | Pure. Deterministic. |

### 9.3 Concurrency guard for racing writes

| Race | Guard | Losing-caller behaviour |
|---|---|---|
| Two parallel tool-call file writes to same path | UNIQUE `(agent_run_id, path)` (added in migration 0348 per §4.1). The canonical UPSERT pattern from §4.1 — `INSERT ... VALUES (..., 1, ...) ON CONFLICT (agent_run_id, path) DO UPDATE SET version = operator_run_files.version + 1, ...` — serialises conflicting writes via the unique constraint and resolves the new `version` as `prior_row.version + 1` under the row lock. No separate allocator or sequence needed. | Second writer gets the next version; row is updated to latest size, hash, mime, emitter, timestamp. |
| Tool-call write + watcher emit for same file in same tick | Watcher dedupe checks the CURRENT `operator_run_files` row for `(agent_run_id, path)` (latest-row-only — no history rows exist; see §5.7 watcher dedupe rule). Skip emit iff `current_row.content_sha256 === observed_hash`. | If hashes match, watcher skips (tool-call already covered the write). If hashes differ, watcher writes through the canonical UPSERT and emits based on the returned `version` per §5.7 — the event type is derived from the UPSERT result, never from a preflight existence check. |
| Two cross-owner approvals racing to terminal state | Existing `actions.status` optimistic predicate (`UPDATE … WHERE status = 'pending_approval'`) | 0 rows affected → losing caller reads winning decision. |
| Capability-map recompute racing with `agents.owner_user_id` write | Same-transaction wrapping (mandatory per §6.4) | Serialised by Postgres MVCC; no race possible. |
| Two delegations to same target owner in same tick | No guard needed — distinct `delegation_outcomes` rows | n/a |

### 9.4 Terminal event guarantee

Every cross-owner sub-run emits exactly one terminal event:

- `cross_owner_substep.completed` with `status: 'success' | 'partial' | 'failed'`

The terminal-event correlation key is `(parent_run_id, substep_id)`, where `substep_id` is the canonical sub-step identifier carried on every `cross_owner_substep.*` event. The `substep_id` value is `delegation_outcomes.id` (settled architecture — see §5.4 and §9.7). Migration 0347 extends `delegation_outcomes` with the state-machine columns (`substep_status`, `terminal_at`) and the partial index on `(run_id, substep_status) WHERE terminal_at IS NULL` that enforces the "exactly one terminal event per `(parent_run_id, substep_id)`" guarantee via the row-level write-time predicate `UPDATE delegation_outcomes SET substep_status = $1, terminal_at = NOW() WHERE id = $2 AND terminal_at IS NULL` (0 rows affected = already terminal; losing caller reads the winning row and emits no event). The existing `agentExecutionEventService` registers and validates the new event types per §4.6; the uniqueness guarantee itself is at the row level, not the event-stream level. Implementation acceptance criterion (Chunk 3): a pure-function test verifies the write-time predicate so that a second `cross_owner_substep.completed` emit for the same `(parent_run_id, substep_id)` is a 0-row update + no-op event emit.

Multi-path termination (closed set — adding a status requires a spec amendment):

- `success` — sub-step ran, returned typed result. Reached via the normal `proposed → authorised → routed → executing → success` path OR via the `ask_initiator → initiator_resumed_after_cross_owner_timeout` path (§5.6).
- `partial` — `continue_without_substep` timeout policy fired; sub-step skipped; parent continues without the result (explicit, not silent).
- `failed` — `fail_parent` timeout policy fired, the credential broker failed to resolve, the sub-run hard-failed inside operator runtime, OR the `ask_initiator → initiator_abandoned_after_cross_owner_timeout` path resolved to abandonment (§5.6).

Lifecycle states (`proposed`, `authorised`, `routed`, `executing`) are tracked as values of the `delegation_outcomes.substep_status` column (added in migration 0347) — they are state-machine transitions, NOT separate emitted events. The only `cross_owner_substep.*` event variants V2 emits onto the run-trace stream are: (a) `cross_owner_substep.awaiting_initiator_decision` (non-terminal, emitted ONLY when the `ask_initiator` timeout-policy branch fires per §5.6) and (b) `cross_owner_substep.completed` (the single terminal event). Both are inventoried in §4.6. State-machine state changes that are NOT emitted as run-trace events MAY still produce ordinary `delegation_outcomes` row UPDATEs but they do not surface to the FE event stream — the FE renders the run-trace from `.completed` plus, if the path goes through the `ask_initiator` branch, the intermediate `.awaiting_initiator_decision`.

**Canonical `substep_id` contract:** every `cross_owner_substep.*` event payload carries a `substep_id: string` field whose value is `delegation_outcomes.id` for the matching row. The `substep_id` value is stable for the life of the sub-step and is the correlation key paired with `parent_run_id` for the "exactly one terminal event" guarantee.

### 9.5 No-silent-partial-success

`'partial'` is the explicit terminal status for `continue_without_substep` timeout. It is NEVER `'success'`. The matcher / parent agent receives the typed result `{ status: 'skipped', reason: 'cross_owner_approval_timed_out_optional' }` and decides whether to proceed or fail itself.

### 9.6 Unique-constraint-to-HTTP mapping

| Constraint | Violation HTTP status | Reason |
|---|---|---|
| `operator_run_files` UNIQUE `(agent_run_id, path)` (migration 0348) | No HTTP exposure — internal event path only | Caught and routed to modify path. |
| `actions` UNIQUE (existing keys) | Unchanged — V1 behaviour | n/a |
| `delegation_outcomes` no new UNIQUE | n/a | n/a |

No new HTTP-exposed unique constraints.

### 9.7 State machine closure

**Cross-owner sub-step state machine** (new). The canonical status enum on `delegation_outcomes.substep_status` (column added in migration 0347) is:

```
proposed → authorised → routed → executing
                                     │
                                     ├──→ awaiting_cross_owner_approval ──→ approved ──→ executing (loops until no pending approvals)
                                     │                                  ╲
                                     │                                   ╲──→ rejected ──→ failed
                                     │
                                     └──→ [success | partial | failed]   (terminal — no further transitions)
```

The full status vocabulary the state record may hold at any moment is:
`'proposed' | 'authorised' | 'routed' | 'executing' | 'awaiting_cross_owner_approval' | 'approved' | 'rejected' | 'success' | 'partial' | 'failed'`. The terminal subset (no further transitions) is `'success' | 'partial' | 'failed'`. The other seven values are in-flight states. §5.4's initiator-visible list and the diagram above MUST stay aligned — adding or removing a status requires a spec amendment.

Forbidden transitions:

- `authorised → routed` requires successful credential broker resolution under `target_owner_user_id`. If broker fails, transition to `failed` (never bypass into `routed`).
- `executing → success` requires either no Tier 4+ writes OR every Tier 4+ write approved by `approver_user_id`. Approval timeout transitions to terminal per timeout policy (§5.6).
- `awaiting_cross_owner_approval → approved` resumes executing; `awaiting_cross_owner_approval → rejected` transitions to `failed`.
- No backward transitions other than the explicit `approved → executing` resume edge. No transitions out of terminal states.

Status set is closed: adding a new sub-step status requires a spec amendment.

## 10. Testing posture

Per `docs/spec-context.md` (`testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`):

**In scope:**

- **Pure-function unit tests** for new pure helpers: matcher rule, authorisation detector, trim algorithm, file event create-vs-modify decision, version allocator, run-trace projection.
- **Static gates** as the primary safety net:
  - `verify-capability-map-shape.sh` (new) — guards capability-map invariants.
  - `verify-operator-event-registry.sh` (existing) — extended check that all four V2-added variants (`file.created`, `file.modified`, `cross_owner_substep.awaiting_initiator_decision`, `cross_owner_substep.completed`) are registered with criticality in `AGENT_EXECUTION_EVENT_CRITICALITY` per §4.6.
  - `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` (existing) — for the three existing tables touched (`subaccount_agents`, `actions`, `delegation_outcomes`) the gates confirm the new columns don't introduce direct-DB-access patterns; for the new `operator_run_files` table (migration 0348) the gates confirm it is registered in `rlsProtectedTables.ts` and has a working RLS policy on a fresh DB.
- **CI typecheck + lint** — load-bearing for shape correctness across the new contracts.

**Out of scope (per `convention_rejections`):**

- vitest / jest / playwright for own-app frontend.
- supertest for API contract tests.
- E2E tests against the app.
- Frontend unit tests.

**Acceptance criteria (dogfood-verified, not unit-tested):**

1. A manual `@PA` request from the operator routes to the operator's own EA, dispatches in operator mode, completes via the operator-backend prototype path.
2. A manual cross-owner delegation request (use case #1 from brief §3.8 — complex client investigation) where the parent task is a subaccount agent and the sub-step needs the owner's data routes correctly, with credentials following the executor and the run trace showing the chain link.
3. A Tier 4+ write inside a cross-owner sub-run produces an approval row with `approver_user_id = executor_agent.owner_user_id`; the owner sees the approval in their queue; the initiator's run trace shows the typed pause reason `awaiting_cross_owner_approval`.
4. The 24-hour stall job, when fired against a cross-owner approval, executes the timeout-policy decision tree correctly per §5.6.
5. A long-running operator-mode EA task writes 5 files at different chain-link boundaries. `file.created` and `file.modified` events appear on the `agent-run` WebSocket channel before the terminal completion event. `FilesTab` shows files updating live.
6. Stub Dev Agent (per brief §0.5 reuse acceptance test) configured with `owner_user_id` and equivalent `capability_map` passes the same four routing fixtures as the EA — no EA-specific branching in matcher, approval router, or delegation path.

## 11. Self-consistency pass result

Performed at draft completion (2026-05-13):

- **Goals ↔ Implementation match.** Every goal in §1 maps to chunks in §8. No orphaned goals.
- **Single-source-of-truth claims survive.** `agents.owner_user_id` is the canonical source (§5.1); `capability_map.owner_user_id` is a recomputed projection. R2 storage key is the canonical file content; the `operator_run_files` row is a derived metadata index. Event stream is a derived projection (§5.7).
- **Non-functional claims match execution model.** No latency budgets, no cache-efficiency targets. The 4 KB initial-context budget (§5.8) is enforced by the trim algorithm in the inline bundler. The 24-hour stall threshold is inherited from V1 unchanged.
- **Every load-bearing claim has a named mechanism.**
  - "Credentials follow the executor" → credential broker (`user-owned-agents` §3.3 invariant)
  - "Approval routes to owner not initiator" → `actionService.proposeAction` writes `approver_user_id` + `listPendingApprovalsForUser` union read
  - "Privacy projection" → `runTraceProjectionForViewer` at read time, invoked by `agentExecutionEventService` + `taskEventStream` + `agentRuns` routes (§4.3)
  - "Idempotent migrations" → state-based predicates (§9.1)
  - "Universal OpenTaskView invariant" → event-type extensions on existing renderer (no new chrome); §4.6 is the canonical inventory of all four new variants
  - "`ask_initiator` decision request loop" → reuses the existing V1 approval-row plumbing: `actionService.proposeAction(..., { approver_user_id: initiator_user_id })` writes the typed decision request, `listPendingApprovalsForUser(initiator_user_id)` exposes it, and the existing approval-flow resume hook transitions the paused parent task (§5.6)
  - "Terminal-event uniqueness `(parent_run_id, substep_id)`" → row-level write-time predicate `UPDATE delegation_outcomes SET substep_status = $1, terminal_at = NOW() WHERE id = $2 AND terminal_at IS NULL` (0 rows affected = already terminal; losing caller reads the winning row)
- **Phase dependency graph is acyclic.** §8 chunks 1→9, each prerequisite earlier. Verified by hand.

## 12. Deferred items

- **Layer-3 live content streaming for text files.** Character-by-character delta events for incrementally appended text docs. Deferred to V2.5+ per brief §3.9. V2 ships the snapshot pattern (file appears + size grows + click opens current snapshot).
- **GlobalAskBar `@`-autocomplete UI.** Phase 1.5 / V2.5 UX polish. V2 ships text-only orchestrator-side parsing.
- **Calendar-aware multi-person orchestration (use case #3 from brief §3.8).** Deferred to V2.1 until a second PA-provisioned user exists in the dogfood subaccount.
- **`@<arbitrary user>'s PA` direct addressing.** Routing to another user's PA happens via cross-ownership delegation, not direct addressing. Address parser returns `'unsupported_cross_owner'` for this form (logged for diagnostics).
- **EA-specific operator-mode duration / concurrency / approval overrides.** V2 inherits operator-backend defaults (120-min soft cap, 5 concurrent sessions per subaccount, 50 chain links, Tier 5 ceiling). V2.5 may revisit per real-world data.
- **Real-time chat with the EA ("conversational PA").** Different product; not in roadmap.
- **Cross-day persistent investigations.** Operator-backend chain-resume supports it; use case not yet justified.
- **Operator-mode web browsing.** Requires `iee-browser-on-e2b` spec.
- **`user_memory_blocks` (shared memory across user-owned agents for the same user).** Future additive primitive if a real need emerges.
- **Org-principal agents as a distinct ownership class.** Not exercised by V2.
- **Bedrock AgentCore Runtime as a second ExecutionBackend adapter.** Phase 3.5 candidate-list work.

## 13. Open questions

All architectural questions are RESOLVED. No blockers remain; every chunk is implementable as specified.

1. **File-events backing store — RESOLVED 2026-05-13.** New table `operator_run_files` (strategy (a)), keyed on `agent_run_id → agent_runs.id`. Migration 0348 creates the table with the full column set, UNIQUE `(agent_run_id, path)`, schema-level CHECKs (`version >= 1`, `size_bytes >= 0`, `path <> ''`, `storage_key <> ''`), and an RLS policy that filters on the row's own `organisation_id` column (avoids the JOIN-through-`agent_runs` plan). The matching `server/config/rlsProtectedTables.ts` manifest entry is a paired TypeScript edit in Chunk 1 (not part of the SQL migration). Versioning model is latest-metadata-row-only (one row per `(agent_run_id, path)`) with version incremented in place via the canonical UPSERT (`ON CONFLICT (agent_run_id, path) DO UPDATE SET version = operator_run_files.version + 1, ...`) — no `MAX(version)`, no separate sequence, no per-row allocator state. Rationale: the existing `execution_files` table is keyed on `execution_id → executions.id` (IEE executions — a distinct lifecycle/domain from operator runs); extending it would force confusing dual-parent semantics and partial-conditional UNIQUE constraints. The new table is semantically clean and the marginal cost (one tenant-scoped table + one RLS policy + one rlsProtectedTables entry) is small. Operator confirmed via spec-coordinator decision prompt 2026-05-13.

2. **Cross-owner sub-step state machine — RESOLVED 2026-05-13.** Extend `delegation_outcomes` (strategy (a)). Migration 0347 adds three columns to `delegation_outcomes`: `cross_owner_approval_timeout_policy TEXT NULL`, `substep_status TEXT NOT NULL DEFAULT 'proposed'` (constrained to the canonical vocabulary in §9.7), `terminal_at TIMESTAMPTZ NULL`, plus a partial index on `(run_id, substep_status) WHERE terminal_at IS NULL` for the §9.4 uniqueness predicate. Rationale: `delegation_outcomes` is conceptually the delegation ledger; adding the state-machine columns keeps the cross-owner state alongside its parent decision, avoids splitting state across two tables, and reuses the existing tenant-scoped RLS policy. Spec-reviewer recommended this strategy; operator confirmed via spec-coordinator decision prompt 2026-05-13.

3. The exact path of the orchestrator routing module that owns the intent parser — resolved during spec-review iteration 1 to `server/tools/capabilities/capabilityDiscoveryHandlers.ts` (§4.3, with dispatcher in `server/services/skillExecutor.ts:1767-1770`). Informational only.

4. Whether `runTraceProjectionForViewer` deserves a dedicated `*Pure.ts` split — surfaces during Chunk 3 implementation; defers to the implementer's judgement on test surface.

No architectural HITL checkpoint required — every load-bearing design decision is locked. Item #4 above is implementer-discretion only (test-surface taste, not architecture) and does not gate the build.

---

## Appendix A — Reuse acceptance test (brief §0.5)

The four routing fixtures in brief §0.5 are the spec's load-bearing reuse test. The plain-text descriptions below are illustrative — they sketch the intent of each fixture. The CONCRETE fixture data (full `RoutingContextV2` instance per §5.2, candidate `CapabilityMapV2` set per §5.1, complete `CROSS_OWNER_DELEGATION_REQUEST` per §5.4, action proposal payload per §5.5) is authored in code under `server/services/__tests__/capabilityMapServicePure.routing.test.ts` (created in Chunk 2). The code is the source of truth for fixture shapes; this Appendix is the source of truth for the routing OUTCOMES each fixture must verify. If the code and prose disagree on an outcome, the prose wins and the code is corrected.

1. **Direct-owner request.** Stub Dev Agent owned by Michael; `requester_user_id = michael`, no `target_owner_user_id`; intent contains a stub-Dev-Agent capability slug. Expected: stub Dev Agent selected.
2. **Cross-ownership delegation.** Stub Dev Agent owned by Michael; parent run is a subaccount agent; `requester_user_id = sarah`, `target_owner_user_id = michael`. Expected: stub Dev Agent selected; credentials resolved with `ownerUserId = michael`; approval routed to Michael.
3. **Approval-owner rule.** Cross-owner action proposed inside the sub-run. Expected: `approver_user_id = michael`; Michael's approval queue contains the row; Sarah's parent task pauses with `awaiting_cross_owner_approval`.
4. **Ambiguous routing.** No `target_owner_user_id`; `requester_user_id = sarah` (not Michael); intent does not contain a named-owner reference. Expected: `crossOwnerDelegationAuthorisation` returns `{ authorised: false, clarifying_question: ... }`; orchestrator surfaces the clarifying question. No delegation.

If any of the four fixtures requires an `executive-assistant` slug check in the matcher, approval router, or delegation path, the primitive design is wrong and must be reworked before merge.

## Appendix B — Doc-sync checklist

Per `docs/doc-sync.md`:

- [ ] `architecture.md` — universal OpenTaskView + run-trace invariant clause
- [ ] `architecture.md` — capability_map.owner_user_id description
- [ ] `architecture.md` — cross-ownership delegation pattern under hierarchical-delegation section
- [ ] `docs/synthetos-governed-agentic-os-brief-v1.2.md` §5.6 — universal invariant note
- [ ] `docs/capabilities.md` — EA "standing autonomous operator" entry (vendor-neutral, marketing-ready)
- [ ] `KNOWLEDGE.md` — pattern extractions from build chunks
- [ ] `references/test-gate-policy.md` — confirm `verify-capability-map-shape.sh` is listed
- [ ] `docs/decisions/` — consider ADR for "approval follows executor's owner, not initiator" (durable policy decision)

## End of spec
