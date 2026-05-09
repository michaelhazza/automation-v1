# Plan — Agent Workspace (Persistent Embodiment Layer)

**Plan date:** 2026-05-08
**Build slug:** agent-workspace
**Source spec:** `tasks/builds/agent-workspace/spec.md` (1599 lines, implementation-ready with hardening, LOCKED — no spec edits in this revision)
**Source brief:** `docs/agent-workspace-implementation-brief.md` (Rev 10, LOCKED)
**Branch:** `claude/add-agent-cloud-compute-Kb4ii`
**Author:** architect (Opus, invoked by feature-coordinator)
**Revision:** Rev 3 (2026-05-08) — chatgpt-plan-review tightenings; see Revision history below.

This plan decomposes the spec into ordered build chunks. Every chunk respects the §5 file-inventory lock. Every chunk maps to one or more spec sections via the `spec_sections:` field. Forward-only dependency graph; no chunk references a primitive introduced in a later chunk.

---

## Revision history

### Rev 3 — 2026-05-08 (chatgpt-plan-review tightenings; APPROVED with tightenings)

**Reason.** Round 1 of `chatgpt-plan-review` returned **APPROVED with tightenings** — no structural redesign, eight precision tightenings to pin currently-implicit deterministic contracts explicitly. All technical / mechanical; auto-applied. Verbatim review at `tasks/review-logs/chatgpt-plan-review-agent-workspace-2026-05-08T12-40-27Z.md`.

**Scope of this revision:**

1. **Chunk 3 — watermark predicate pinned in SQL.** §11.1 cross-run tuple predicate restated literally inside the chunk contract so future readers do not need to round-trip the spec to know the ordering rule.
2. **Chunk 5 — payload budget measurement nailed down.** ≤150KB budget now defined as gzip-compressed UTF-8 HTTP response body under production Express compression settings; profiling consumers can no longer drift between raw-JSON-bytes and on-wire-bytes.
3. **Chunk 5 — cache-invalidation log suppression extended.** Subscriber-inactive log adds a 24h suppression window across deploy loops so clustered restarts do not flood logs.
4. **Chunk 6 / 9 — elapsed-timer drift semantics pinned.** Client-side ticking allowed for display smoothness; authoritative `elapsedSinceRunStartMs` reset only from server snapshot or SSE; locally-derived elapsed never persisted.
5. **Chunk 9 — ring-buffer eviction order locked.** Eviction follows `(event_timestamp ASC, event_id ASC)`; protects replay determinism under burst pressure.
6. **Chunk 9 — Last-Event-ID precedence simplified.** If header present, header always supersedes query param; query param consulted only when header absent. Drops the previous open-vs-reconnect distinction in favour of a deterministic single rule.
7. **Chunk 10 — teardown / external side-effect boundary.** Container release MUST execute after `withOrgTx` commit; external teardown is forbidden inside the transaction scope.
8. **Chunk 11 — prune batching invariant.** `agentObservationsPruneJob` deletes in 1000-row batches ordered by `(created_at ASC, id ASC)`, repeats until empty; prevents giant transaction spikes and protects VACUUM pressure.

**Untouched by this revision:** chunk count, file inventory, dependency graph, hardened invariants (`(event_timestamp, event_id)` ordering, `process.hrtime.bigint()`, `Buffer.byteLength`, UTC half-open intervals, single-node SSE, FOR UPDATE row-locks, per-agent partition basis), spec text (still LOCKED), Phase 1 hard-block on Chunk 12.

---

### Rev 2 — 2026-05-08 (post-PR #274 merge baseline shift)

**Reason.** Branch was synced with `origin/main` (merge commit `3b52cab8`) which absorbed PR #274 (`auto-knowledge-retrieval`, squash `b1c4d14d`). The original Rev 1 plan was authored before this merge and assumed migrations 0288/0289 were free, that Phase 1 was hypothetical, and that no shared retrieval-observability primitives existed.

**Scope of this revision:**

1. **Migration numbers shifted.** Original 0288 → **0295** (`agent_workspace_presence_and_sessions`); original 0289 → **0296** (`agent_default_landing_tab`). PR #274 occupies 0288–0294. Updated chunk titles, file lists, dependency notes, and risks. The spec text remains LOCKED at 0288/0289; the discrepancy is a known Rev 2 reconciliation — the spec's structural intent (which schema modifies which table) governs, while the plan's numbers govern the actual filenames.

2. **Chunks 3, 4, 5, 7, 9, 14 reframed around shipped Phase 1 surfaces.** PR #274 shipped `retrievalObservabilityService` (emits `retrieval.summary` events into `agent_execution_events`), `retrievalServicePure` (generic ranker), `documentRetrievalServicePure`, `memoryBlockRetrievalServicePure`, and the Files / Documents tabs at `/govern/knowledge`. Agent-workspace **composes** with these surfaces as read-side consumers — no duplication, no replacement, no new emission.

3. **§15.1 Phase 1 coordination gaps confirmed.** PR #274 did NOT ship two contracts the spec's §15.1 expects:
   - **Deep-link query-parameter resolver** at `/govern/knowledge?tab=files`. Main's `/api/files` accepts only `subaccountId` + `linkedToKnowledge`, not the spec's five-tuple `?agentId=...&runId=...&eventId=...&fileId=...&versionId=...`. Chunk 12 remains hard-blocked.
   - **`knowledge.files.*` lifecycle events** (`promoted | deleted | archived | restored | metadata_changed | access_changed | merged`). Main does not emit any of them. Chunk 5 ships subscribers regardless; degrades to TTL-only freshness when no events arrive.
   Both gaps are operator-owned (escalate / defer / schedule Phase 1 follow-up); plan does NOT synthesise either contract.

4. **KNOWLEDGE.md patterns from PR #274 cited as reuse anchors:**
   - **#6 (generic ranker, primitive-specific filters wrap it)** — informational only; agent-workspace does not introduce a new ranking surface. The closed-comparator pattern is the precedent for §7.6 `orderHomePresenceSections` (already aligned in Chunk 2).
   - **#7 (bounded observability with deterministic top-N truncation)** — directly applied as the model for Chunk 9's `agentPresenceStreamPublisher` per-event payload caps + ring-buffer caps. Made explicit in the chunk contract.

5. **Chunk count and structure unchanged.** No chunks added, removed, merged, or renumbered. The file list per chunk is unchanged except for the migration filenames.

6. **Two new programme-level risks** added to §7: (a) Phase 1 deep-link resolver missing on main, (b) `knowledge.files.*` events missing on main. Mitigations recorded in the same row.

**Untouched by this revision:** all hardened invariants (`(event_timestamp, event_id)` ordering, `process.hrtime.bigint()`, `Buffer.byteLength`, UTC half-open intervals, single-node SSE, FOR UPDATE row-locks, per-agent partition basis), the architecture-notes decisions, model-collapse check, executor notes, UX considerations, and self-consistency pass shape.

---

## Table of contents

1. Architecture notes
2. Model-collapse check
3. File inventory cross-reference
4. Executor notes
5. Chunk plan (14 chunks)
   - Chunk 1: Migration 0305 + Drizzle schemas + RLS manifest
   - Chunk 2: Pure helper modules + their unit tests
   - Chunk 3: Tenant-aware service layer
   - Chunk 4: Event emitter extension + observation-emit hook
   - Chunk 5: Migration 0306 + Overview aggregator + Overview routes
   - Chunk 6: AgentEditPage Overview tab shell + identity + presence hero + hooks
   - Chunk 7: Overview cards batch A
   - Chunk 8: Overview cards batch B + Working Time chart
   - Chunk 9: SSE publisher + presence stream + Home widget
   - Chunk 10: IEE session lifecycle + run-engine integration
   - Chunk 11: Maintenance jobs
   - Chunk 12: Run trace lineage chips
   - Chunk 13: Capabilities + positioning rewrite
   - Chunk 14: Architecture.md doc-sync + KNOWLEDGE.md patterns
6. UX considerations (cross-chunk)
7. Risks & open questions (programme-level)
8. Self-consistency pass

---

## 1. Architecture notes

### Decisions made (with what was rejected)

**1. Schema-first, service-shell-first chunk ordering.** Chunk 1 introduces the migration, Drizzle schemas, and RLS manifest entries WITHOUT business logic. Chunk 2 lands the pure resolvers. Chunk 3 wires the services. This forces the schema/RLS contract to be reviewable in isolation before any logic depends on it. Considered: bundle schema and service into one chunk (rejected; too many files for one builder session, and schema is the load-bearing contract that must be PR-reviewed alone).

**2. Pure helpers extracted as first-class chunk artifacts.** `agentPresenceServicePure`, `agentObservationServicePure`, `agentWorkingTimeServicePure`, `ieeSessionServicePure`, `orderHomePresenceSections`, `currentFocusValidator` — each is a chunk-level commit so unit tests land beside the helper that produces them. Considered: ship pure helpers inline with their tenant-aware orchestrators (rejected; conflates the test surface and confuses §16.1 enforcement).

**3. Phase 1 of the spec splits into Chunks 1–4.** Phase 1 introduces 5 tables, 6 services, 4 pure helpers, and 1 column-extension on `iee_artifacts`. Too much for one builder session. The split aligns with logical responsibilities: schema (1), pure helpers (2), tenant services (3), event-emit extension (4).

**4. Phase 2 of the spec splits into Chunks 5–8.** The Overview tab decomposes into: aggregator + endpoints (5), tab-shell + identity + presence hero (6), card components batch A (7), card components batch B + working time chart (8). This keeps each chunk to ≤5 client files OR ≤1 logical responsibility.

**5. Phase 3 of the spec is one chunk (9).** SSE handler + publisher + client SSE library + workspace hook + Home widget — all bound to the live-stream contract. Reviewers benefit from seeing the round-trip in one PR. The chunk has 8 files but only 1 logical responsibility (live presence delivery), satisfying the "≤5 files OR ≤1 logical responsibility" rule.

**6. Phase 4 of the spec splits into Chunks 10–11.** Session lifecycle service + IEE-execution wiring (10) is one responsibility. Maintenance jobs (11) is a different responsibility; bundling would create a 9-file chunk with two surfaces.

**7. Phase 5 is one chunk (12).** Lineage chips are a focused UI concern; 5 files all bound to the four-tuple contract. **Rev 2 status:** still hard-blocked on Phase 1 deep-link resolver — confirmed not in main as of `b1c4d14d`. See §7 Risks.

**8. Phase 6 is one chunk (13).** Capabilities rewrite + sales-conversation note. Doc-only.

**9. Doc-sync as a tail chunk (14).** Architecture.md updates land at the end so the prose can describe what was actually shipped, not what was planned. **Rev 2 framing:** PR #274 already added a `Document Retrieval Pipeline` section under *Reference Documents*; agent-workspace's prose lands as a **new sibling section** (`Agent Workspace`) under *Layer 4 — UI*, not an extension of the retrieval-pipeline section. Cross-references the existing section from the Knowledge In Use surface description; avoids stomp/duplication.

### Single-source-of-truth invariants the plan defends

These are the invariants from `tasks/builds/agent-workspace/handoff.md` that the chunked plan MUST NOT break apart in implementation:

- `(event_timestamp ASC, event_id ASC)` is the canonical ordering invariant; referenced by §11.1 acceptance predicate, §12.4 replay sort, §13.4 SSE replay. Pure helper test (Chunk 2) is unit-level enforcement; projection writer (Chunk 3) is runtime-level enforcement; SSE replay (Chunk 9) is transport-level enforcement.
- `process.hrtime.bigint()` monotonic clock for hysteresis (§12.3, §11.7); implemented in Chunk 3 inside `agentPresenceService` against an in-process `Map<agentId, ...>`.
- `Buffer.byteLength(body, 'utf8')` for the 8KB observation cap (§7.3); implemented in Chunk 3 inside `agentObservationService.append()`.
- UTC-anchored, half-open, non-overlapping bucket intervals (§7.5); pure helper in Chunk 2; ledger writer in Chunk 3.
- Single-node SSE publisher topology (§13.1.1); locked at Chunk 9; broker layer is in §18 Deferred. **Rev 2:** event payloads on this stream follow KNOWLEDGE.md pattern #7 (bounded payload, deterministic per-event caps).
- `SELECT ... FOR UPDATE` row-locks on supersession DFS (§7.3); implemented in Chunk 3.
- Per-agent partition basis (concurrency=4) for projection rebuild (§6.3); contract locked in spec; rebuild job itself is deferred (§18) and is NOT a chunk in this plan.

### Primitives reused (no new primitive without justification)

| What we need | Reused | New |
|---|---|---|
| Tenant-isolation transactions | `withOrgTx`, `withAdminConnection` | none |
| Event emission | `agentExecutionEventService` | extended with one new variant (`observation_emitted`); no new event-type registry |
| Schema discriminated union for events | `shared/types/agentExecutionLog.ts` | one new variant added in same union |
| Permission keys | `ORG_PERMISSIONS.AGENTS_VIEW` (existing) | two new keys: `AGENTS_OBSERVATIONS_PIN` (Chunk 1), `AGENTS_PRESENCE_STREAM_SUBSCRIBE` (Chunk 9) |
| RLS template | architecture.md canonical template | applied verbatim to 5 new tables |
| Job scheduler | `pg-boss` via `server/jobs/index.ts` boot-self-heal | 4 new jobs registered through existing pattern |
| Run-trace renderer | `RunTraceEventRenderer` (existing) | composed via new `<EventFileLineageChips>`; no replacement |
| Agent-edit tab strip | `AgentEditPage` (existing) | new `Overview` tab inserted as leftmost; existing tabs unchanged |
| Home page widget | existing `MetricCard` chrome | new `HomeActiveAgentsWidget` body component; `MetricCard` props do not accept a body slot, so this is the minimum-scope addition (spec §2 explicit decision) |
| **Retrieval-summary events (Rev 2)** | **`retrievalObservabilityService.emitRetrievalSummary` + `retrieval.summary` event subtype on `agent_execution_events` (PR #274)** | none — `KnowledgeInUseCard` (Chunk 7) and `recentObservations` source-kind discrimination (Chunks 3+4) **read** these existing events; agent-workspace does not emit them. |
| **Bounded-observability payload pattern (Rev 2)** | **KNOWLEDGE.md pattern #7 from PR #274** | applied as the model for `agentPresenceStreamPublisher` ring-buffer + per-event caps in Chunk 9. |
| **Files tab surface (Rev 2)** | **`/govern/knowledge` Files tab from PR #274 (`KnowledgeFilesTab.tsx`)** | Chunk 7's `FilesSnapshotCard` deep-links into this surface; Chunk 12's lineage chips deep-link into it. **Both depend on Phase 1 follow-up shipping the query-parameter resolver — see §7 Risks.** |

### Architectural risks with chunk-level mitigation

| Risk | Mitigation |
|---|---|
| **(Rev 2) Phase 1 deep-link query-parameter resolver missing on main** | Confirmed not in `b1c4d14d`; `/api/files` accepts only `subaccountId` + `linkedToKnowledge`. Chunk 12 is sequenced LAST; if the resolver is not landed when Chunk 12 starts, escalate before building. The plan does not synthesise a placeholder contract. Spec §17 Q4 unchanged. |
| **(Rev 2) Phase 1 `knowledge.files.*` lifecycle events missing on main** | Confirmed via grep — no emission on main. Chunk 5's `agentOverviewAggregator` ships subscribers that no-op gracefully when zero events arrive (logs `overview.cache_invalidation_subscriber_inactive` at INFO once per boot per event-name) and degrade to TTL-only freshness. Spec §17 Q11 unchanged. |
| Single-node SSE topology constrains horizontal scaling | Locked in §13.1.1; multi-node broker is explicitly deferred. The `agent_presence_projections` table IS the cross-node consistency layer (read on reconnect). |
| Worst-case Overview payload (50-runs, 200-pinned, 30-knowledge) blows 150KB budget | Chunk 5 includes the worst-case profiling task (Open Question 6); if budget violated, builder hardens lazy-load delegations before declaring chunk done. |
| **(Rev 2) Migration 0295/0296 collision with concurrent work on main** | Branch-sync verified at S1 entry: latest main migration is 0294 (PR #274), so 0295/0296 are free. Re-verify at S2 in Phase 3 if main has advanced; rename to next-available number per `DEVELOPMENT_GUIDELINES.md §6.2` if collision detected. **Rev 4 update (2026-05-09):** S2 detected collision with PR #275 (`trust-verification-layer`, 0295–0304). Branch migrations renamed to **0305 / 0306** per the existing playbook. All references updated. |
| `agent_execution_events.sequence_number` is per-run not global, but projection writer crosses runs | §11.1 acceptance predicate uses per-run sequence + cross-run timestamp tuple. Pure helper test (Chunk 2) covers the concurrent-run collision case. |

## 2. Model-collapse check

This is a backend-data + UI-projection feature, not a data-pipeline (ingest → extract → transform → render). No frontier multimodal model can replace:

- The presence-state resolver (closed-enum DAG over event signals + scheduler state).
- The supersession-cycle DFS guard (graph traversal with FOR UPDATE locks for transactional safety).
- The bucket-split working-time accumulator (deterministic millisecond math against a closed event-pair table).
- The SSE publisher topology (process-local registry, ring buffer for replay).
- The anti-fake-progress validator (regex-style pattern check; must run server-side at every projection write).

**Rejection rationale.** This feature is determinism-critical (reconciliation invariants, replay semantics, idempotency keys). A model call introduces non-determinism, latency, audit-trail loss, and per-emission cost. The Anti-fake-progress validator looks like a candidate for an LLM check, but the spec explicitly mandates server-side regex/pattern enforcement (§7.2) and the LLM call would multiply per-event cost by 100x for no quality gain over the pattern check.

The single LLM-adjacent surface (the focus-line summariser) is already an existing primitive (LLM-based step summarisation). This spec consumes its output and validates it; it does NOT propose a new model call.

**Decision: reject collapse, keep deterministic implementation.**

## 3. File inventory cross-reference

The spec §5 names 85 files. This plan touches all of them across 14 chunks. Cross-reference:

| Spec phase | Plan chunk(s) | File count |
|---|---|---|
| Phase 1 (server schema + resolver) | Chunks 1, 2, 3, 4 | 21 files |
| Phase 2 (Overview tab + working time) | Chunks 5, 6, 7, 8 | 21 files |
| Phase 3 (SSE + Home widget) | Chunk 9 | 8 files |
| Phase 4 (session-scoped runtime) | Chunks 10, 11 | 7 files |
| Phase 5 (run trace lineage) | Chunk 12 | 5 files |
| Phase 6 (capabilities rewrite) | Chunk 13 | 2 files |
| Doc-sync | Chunk 14 | 3 files (architecture.md, KNOWLEDGE.md, doc-sync.md verdict-only) |

Total: 67 unique files; some files modified across multiple chunks (e.g. `server/lib/permissions.ts` in Chunk 1 and Chunk 9; `server/db/schema/index.ts` exports in Chunk 1; `server/jobs/index.ts` in Chunk 11).

## 4. Executor notes

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

Each chunk's "Verification commands" section lists ONLY:
- `npm run lint`
- `npm run typecheck`
- `npm run build:client` (when the chunk modifies client code)
- `npm run db:generate` (when the chunk adds a migration)
- Targeted `npx vitest run <path-to-test>` for tests authored in that chunk

Per `tasks/builds/agent-workspace/handoff.md`, builders use **Sonnet**. The plan is locked; mid-build architectural questions return to Opus only for that question.

Per the build slug's pre-production posture (`docs/spec-context.md`), no live data exists; migrations need no backfill rehearsal; the rollout model is `commit_and_revert`.

**Rev 2 note on spec-vs-plan migration-number divergence.** The spec text (locked, 1599 lines) refers to migrations 0288 and 0289. The plan refers to 0295 and 0296 because PR #274 absorbed 0288–0294 between spec lock and Phase 2 entry. Builders should use the plan's numbers in DDL filenames, but trust the spec's structural intent (which schema modifies which table). `spec-conformance` reviewers should accept the renamed filenames as a Rev 2 reconciliation, not a spec deviation.

## 5. Chunk plan (14 chunks)

Dependencies are forward-only. Each chunk lists its prerequisites.

### Chunk 1 — Migration 0305 + Drizzle schemas + RLS manifest

**spec_sections:** §5 Phase 1 (subset), §6.1, §6.2, §6.3, §6.4, §6.5, §8

**Scope.** Land migration `0305_agent_workspace_presence_and_sessions.sql` (and its `.down.sql`) creating five new tables (`agent_observations`, `iee_sessions`, `agent_presence_projections`, `agent_working_time_rollups`, `agent_working_time_event_ledger`) plus column-additions to `iee_artifacts`. Land Drizzle schema files for each new table and the modified `iee_artifacts`. Append all five new tables to `RLS_PROTECTED_TABLES`. Add the new permission key `ORG_PERMISSIONS.AGENTS_OBSERVATIONS_PIN` to `server/lib/permissions.ts`. NO services in this chunk; NO logic.

**Rev 2 — migration number.** Spec §5 says "0288"; PR #274 occupies 0288–0294. This chunk uses **0295**. Builders use the plan's filename; spec text remains LOCKED at 0288.

**Rev 4 (S2 collision) — migration number.** PR #275 (`trust-verification-layer`) merged on `main` 2026-05-09 occupying 0295–0304. Branch's 0295 was renamed to **0305**. All bullets, references, and code (rlsProtectedTables.ts, schema/index.ts, architecture.md) updated to 0305. Filename in working tree: `migrations/0305_agent_workspace_presence_and_sessions.sql`.

**Files to create or modify:**
- `migrations/0305_agent_workspace_presence_and_sessions.sql` (N) — exact DDL per spec §6.1, §6.2, §6.3, §6.4, §6.5; includes the `agent_observations_immutability_guard` PL/pgSQL trigger; includes RLS policies for all five new tables (canonical org-isolation policy, FORCE RLS).
- `migrations/0305_agent_workspace_presence_and_sessions.down.sql` (N) — DROP in reverse order; DROP TRIGGER + FUNCTION; remove `iee_artifacts` columns.
- `server/db/schema/agentObservations.ts` (N) — Drizzle table; imports from `drizzle-orm` and `shared/types/agentObservations.ts` (the type file is created in Chunk 2; for now this chunk uses string literals matching the CHECK constraint).
- `server/db/schema/ieeSessions.ts` (N)
- `server/db/schema/agentPresenceProjections.ts` (N)
- `server/db/schema/agentWorkingTimeRollups.ts` (N)
- `server/db/schema/agentWorkingTimeEventLedger.ts` (N)
- `server/db/schema/ieeArtifacts.ts` (M) — add `agentRunId`, `producingEventId`, `producedVersionId` columns.
- `server/db/schema/index.ts` (M) — export new schemas.
- `server/lib/permissions.ts` (M) — add `AGENTS_OBSERVATIONS_PIN: 'org.agents.observations.pin'` to `ORG_PERMISSIONS`.
- `server/config/rlsProtectedTables.ts` (M) — append five entries with `policyMigration` pointing at `0305`.

**Contracts.** Schema CHECK constraints lock the closed enums (`observation_type`, `presence_state`, `degraded_reason`, `degraded_base_state`, session `status`, session `release_reason`); the immutability trigger enforces append-only at the DB layer. Drizzle column types: `text` for closed-enum columns (validated app-side against the literal-tuple types added in Chunk 2); `jsonb` for `metadata` and `summary`; `bigint` for `working_time_seconds`; `timestamp with time zone` consistently.

**Error handling.** This chunk has no runtime error path; it is pure schema. Migration failures surface at runtime; rollback uses the `.down.sql`.

**Test considerations (for pr-reviewer + spec-conformance, not authored in this chunk):**
- Migration applies cleanly on a fresh dev DB.
- `.down.sql` reverses the migration cleanly.
- All five new tables appear in `RLS_PROTECTED_TABLES`; `policyMigration` field references `0295`.
- The `agent_observations` immutability trigger raises P0001 when `app.allow_observation_mutation` is unset.
- `iee_artifacts` retains existing rows after the column-add (default NULL for new columns).
- `verify-rls-coverage.sh` (CI gate) recognises the new manifest entries.

**Dependencies.** None (foundation chunk).

**Verification commands:**
```
npm run lint
npm run typecheck
npm run db:generate
```

---

### Chunk 2 — Pure helper modules + their unit tests

**spec_sections:** §7.1, §7.2, §7.3, §7.5, §7.6, §11.7, §12.3, §12.4, §16.1

**Scope.** Land all `*Pure.ts` helper modules and their `*Pure.test.ts` siblings. Pure functions (no DB, no network, no filesystem); the single source of truth for the deterministic logic the orchestrators consume in Chunk 3.

**Files to create or modify:**
- `shared/types/agentPresence.ts` (N) — `AgentPresenceState` literal tuple + type, `CurrentFocus` interface, `PRESENCE_FRESHNESS_THRESHOLDS_MS` constants per §11.7.
- `shared/types/agentObservations.ts` (N) — `OBSERVATION_TYPES` literal tuple + type, `ObservationSourceKind` enum, `AgentObservation` interface.
- `server/services/agentPresenceServicePure.ts` (N) — `resolveAgentPresence(events, sessionState, scheduleState, ctx) → { state, currentFocus, lastEventAt, ... }` per §7.1, §7.2, §12.4 ordering. Pure; no DB.
- `server/services/agentPresenceServicePure.test.ts` (N) — vitest; covers resolution-chain order, closed-enum exhaustiveness, replay-safety with the `(event_timestamp, event_id)` tuple, monotonic-clock hysteresis simulation against wall-clock jumps.
- `server/services/agentObservationServicePure.ts` (N) — `validateObservationBody(body) → { ok, byteLength }` using `Buffer.byteLength(body, 'utf8')`; `classifyObservation(rawEvent) → { type, sourceKind }`; `detectSupersessionCycle(rows, candidateParentId) → boolean` (in-memory DFS used by tests; real one in Chunk 3 reads `FOR UPDATE`).
- `server/services/agentObservationServicePure.test.ts` (N) — DFS cycle guard (self-loop, 2-cycle, 3-cycle, depth-bound at 32); body-size cap (UTF-8 octets vs `body.length` for non-ASCII strings); classifier closed-enum.
- `server/services/agentWorkingTimeServicePure.ts` (N) — `splitIntervalAcrossBuckets(startMs, endMs) → Array<{ bucketDate, contributionMs }>`; `accumulateWorkingTime(events) → { workingTimeSeconds, runCount, ... }`; UTC-anchored; half-open intervals; millisecond-exact bucket sum invariant per §7.5.
- `server/services/agentWorkingTimeServicePure.test.ts` (N) — single-bucket, exact-boundary edge (interval ends at midnight UTC), multi-bucket span, year-long-span drift bound (≤365 ms), concurrent-run summing, sub-agent attribution, half-open rule (`T = boundary` belongs to the new bucket).
- `server/services/ieeSessionServicePure.ts` (N) — `decideIdleTimeout(session, now) → 'keep' | 'tear_down'`; `classifyTeardownReason(triggerEvent) → release_reason`; `detectOrphan(session, now) → boolean`.
- `server/services/ieeSessionServicePure.test.ts` (N) — idle-timeout edge cases, teardown-reason classifier, orphan detection.
- `client/src/lib/orderHomePresenceSections.ts` (N) — pure comparator per §7.6.
- `client/src/lib/orderHomePresenceSections.test.ts` (N) — section-order invariant, `next_run_at ASC` within `scheduled`, `updated_at DESC` within other sections, degraded float-up via `degraded_base_state`.
- `client/src/lib/currentFocusValidator.ts` (N) — `validateCurrentFocus(text) → { ok, reason? }`; rejects forbidden patterns per §7.2.
- `client/src/lib/currentFocusValidator.test.ts` (N) — forbidden patterns, concrete-anchor requirement, fallback-to-stale-state behaviour.

**Contracts.**
```typescript
// shared/types/agentPresence.ts
export const AGENT_PRESENCE_STATES = ['idle','running','waiting_on_human','waiting_on_dependency','scheduled','degraded','failed'] as const;
export type AgentPresenceState = typeof AGENT_PRESENCE_STATES[number];

export interface CurrentFocus {
  text: string; truncated: boolean; fullText: string;
  sourceEventId: string | null;
  sourceKind: 'active_run_step'|'pending_hitl_gate'|'scheduled_next_run'|'last_completed_run'|'static_fallback';
  serverNow: string; ageMs: number;
}

export const PRESENCE_FRESHNESS_THRESHOLDS_MS = {
  EVENT_STREAM_DELAYED: 10_000, WORKER_HEARTBEAT_STALE: 30_000,
  FOCUS_LINE_STALE_COPY: 30_000, DEGRADED_HYSTERESIS: 10_000,
  DEGRADED_OSCILLATION_WINDOW: 30_000, DEGRADED_OSCILLATION_HOLD: 60_000,
} as const;

// server/services/agentWorkingTimeServicePure.ts
export function splitIntervalAcrossBuckets(startMs: number, endMs: number): Array<{ bucketDate: string; contributionMs: number }>;
// Postcondition: sum of contributionMs equals (endMs - startMs) exactly.

export function accumulateWorkingTime(events: AgentExecutionEvent[]): {
  workingTimeSeconds: number; runCount: number;
  successfulRuns: number; failedRuns: number; partialRuns: number;
};
```

**Error handling.** Pure helpers throw on invariant violations (e.g. `splitIntervalAcrossBuckets(end < start)` throws `RangeError`); orchestrators in Chunk 3 catch and map to HTTP. Tests assert the throws.

**Test considerations.**
- `accumulateWorkingTime` reconciliation: a fixture run with 7 step pairs + 2 HITL pauses + 1 sub-agent delegation must yield the exact computed seconds count.
- `splitIntervalAcrossBuckets` with an interval crossing 365 UTC midnights: sum-of-contributions equals `(endMs - startMs)` exactly; no millisecond is dropped or double-counted.
- `detectSupersessionCycle` with a 5-row chain ending in a self-loop returns `true`; 5-row chain that is acyclic returns `false`; 33-row depth chain returns `true` (depth bound).
- `validateObservationBody` for a body of 8192 ASCII chars returns `{ ok: true, byteLength: 8192 }`; for `'é'.repeat(4097)` (8194 bytes UTF-8) returns `{ ok: false, byteLength: 8194 }`.
- `orderHomePresenceSections`: `degraded` agent with `degraded_base_state = 'running'` floats into the `running` section; same agent without `degraded_base_state` is a contract violation (§6.3 CHECK forbids it).

**Dependencies.** Chunk 1 (the schema's literal-tuple types are referenced by these files via the `shared/types/*` exports added here).

**Verification commands:**
```
npm run lint
npm run typecheck
npx vitest run server/services/agentPresenceServicePure.test.ts
npx vitest run server/services/agentObservationServicePure.test.ts
npx vitest run server/services/agentWorkingTimeServicePure.test.ts
npx vitest run server/services/ieeSessionServicePure.test.ts
npx vitest run client/src/lib/orderHomePresenceSections.test.ts
npx vitest run client/src/lib/currentFocusValidator.test.ts
```

---

### Chunk 3 — Tenant-aware service layer (presence, observation, working time, session-skeleton)

**spec_sections:** §7.1, §7.3, §7.5, §11.1, §11.3, §11.5, §12.3, §13.5, §13.6, §15.1

**Scope.** Land the four orchestrator services (`agentPresenceService`, `agentObservationService`, `agentWorkingTimeService`, `ieeSessionService` skeleton). Each is tenant-aware (uses `withOrgTx`), composes the pure helpers from Chunk 2, and writes through to the schema from Chunk 1. The `ieeSessionService` skeleton in this chunk only exposes the read API and basic create/heartbeat; full lifecycle integration with `ieeExecutionService` is in Chunk 10.

**Rev 2 — composition note for `agentObservationService.append()`.** The spec §7.3 already enumerates `retrieval_summary` as one of the four `metadata.source_kind` values. PR #274's `retrievalObservabilityService.emitRetrievalSummary` writes the underlying `retrieval.summary` event into `agent_execution_events`; the run-step terminal-event hook in Chunk 4 invokes `agentObservationService.append()` with `metadata.source_kind = 'retrieval_summary'` AND `metadata.source_id = <retrieval.summary event id>`. This chunk's contract for `append()` MUST accept the `retrieval_summary` source-kind without special-casing — it rides the existing four-kind enum unchanged. Composition only; no new code path.

**Files to create or modify:**
- `server/services/agentPresenceService.ts` (N) — `resolveAgentPresence(agentId, ctx)` writes to `agent_presence_projections`; uses `INSERT ... ON CONFLICT (agent_id) DO UPDATE` with the §11.1 watermark predicate. Maintains in-process `Map<agentId, { degradedEnteredHrtime: bigint, oscillationWindowStartHrtime: bigint }>` for monotonic-clock hysteresis. Rejects illegal transitions per §12.2 (logs `presence.illegal_transition_attempt`).

  **Watermark predicate (Rev 3 — pinned literally so future readers do not round-trip §11.1):**

  ```sql
  ON CONFLICT (agent_id) DO UPDATE
  SET ...
  WHERE
    excluded.event_timestamp > agent_presence_projections.event_timestamp
    OR (
      excluded.event_timestamp = agent_presence_projections.event_timestamp
      AND excluded.event_id > agent_presence_projections.event_id
    )
  ```

  Latest-wins under same-instant ties; the `(event_timestamp, event_id)` tuple is the canonical replay/reconnect order. This predicate MUST NOT be relaxed during future optimisation — the chunk-level contract owns the invariant; §11.1 is reference, not authority, for this DDL.
- `server/services/agentObservationService.ts` (N) — `append(observation, ctx)` runs inside `withOrgTx`; computes `idempotency_key`; runs DFS cycle guard with `SELECT ... FOR UPDATE` row-locks; maps 23505 → 200 (idempotent hit, returns existing row); maps cycle detection → 409; maps body-size violation → 400. Writer-only API; no `update()` method exported.
- `server/services/agentWorkingTimeService.ts` (N) — `applyEvent(event, ctx)` runs inside `withOrgTx`; inserts ledger row first (`INSERT INTO agent_working_time_event_ledger ON CONFLICT DO NOTHING RETURNING event_id`); only on non-empty RETURNING applies the contribution to rollup bucket(s) using `splitIntervalAcrossBuckets`; all bucket updates in same transaction. Read API: `getRollupsForRange(agentId, startDate, endDate, ctx)`.
- `server/services/ieeSessionService.ts` (N) — skeleton: `createSession(runId, agentId, ctx)` with `UNIQUE(run_id)` 23505→409 mapping; `heartbeat(sessionId, ctx)`; `getSession(sessionId, ctx)`. Lifecycle integration with run-start / step-dispatch / run-end is added in Chunk 10.

**Contracts.**
```typescript
// agentPresenceService.ts
export async function resolveAgentPresence(agentId: string, ctx: PrincipalContext): Promise<AgentPresenceProjection>;
export async function applyEventToPresence(event: AgentExecutionEvent, ctx: PrincipalContext): Promise<void>;

// agentObservationService.ts
export async function append(input: AppendObservationInput, ctx: PrincipalContext): Promise<AgentObservation>;
// On UNIQUE(idempotency_key) hit: returns the existing row (200 from caller).
// On supersession cycle: throws { statusCode: 409, errorCode: 'supersession_cycle_detected', rejectedSupersedesObservationId: string }
// On body too large: throws { statusCode: 400, errorCode: 'observation_body_too_large', byteLength: number, limitBytes: 8192 }

// agentWorkingTimeService.ts
export async function applyEvent(event: AgentExecutionEvent, ctx: PrincipalContext): Promise<void>;
export async function getRollupsForRange(agentId: string, startDate: string, endDate: string, ctx: PrincipalContext): Promise<AgentWorkingTimeRollup[]>;
```

**Error handling.**
- Service-layer 23505 mapping happens INSIDE the service; routes never see the raw constraint violation.
- `withOrgTx` wraps every public method; no direct `db` access.
- Service errors throw as `{ statusCode, message, errorCode? }`; route handlers use `asyncHandler`.
- Body-size validation runs at the service boundary BEFORE the DB layer (defence-in-depth: DB CHECK is the load-bearing fallback).
- Observation-mutation bypass modes (`pin`, `retention_prune`) are NOT exposed in this chunk; `agentObservationService` has no `update()` or `delete()` method. The `pin` and `retention_prune` paths are owned by the v1.1 pin route and the prune job in Chunk 11 respectively.

**Test considerations.**
- Pure-function tests already cover the deterministic logic in Chunk 2; this chunk's orchestrators are integration-shaped, so they are NOT covered by unit tests per the spec's testing posture (`pure_function_only`).
- `pr-reviewer` checks at branch level: every public service method runs inside `withOrgTx`; no raw `db` import; 23505 never bubbles to 500.
- `spec-conformance` checks: §11.1 watermark predicate present in `agentPresenceService`; `Buffer.byteLength` (NOT `body.length`) in `agentObservationService`; `process.hrtime.bigint()` (NOT `Date.now()`) in hysteresis calc; FOR UPDATE clause in supersession DFS query.

**Dependencies.** Chunks 1, 2.

**Verification commands:**
```
npm run lint
npm run typecheck
```
(No new vitest tests; the deterministic logic is covered by Chunk 2's pure tests.)

---

### Chunk 4 — Event emitter extension + observation-emit hook

**spec_sections:** §5 Phase 1 (subset), §7.3, §15.2 (Trust composition note)

**Scope.** Extend the existing `agentExecutionEventService` discriminated union with the `observation_emitted` event variant. Wire the run-step terminal-event hook in `agentExecutionService` to call `agentObservationService.append()` for the closed observation-type set (`learned | detected | decided | flagged | produced`). NO new event-type registry; rides on the existing union per the spec's "reuse > extend > invent" framing.

**Rev 2 — retrieval.summary integration.** The retrieval-summary handler already exists on main (`server/services/retrievalObservabilityService.ts`); this chunk wires `agentExecutionService` to also call `agentObservationService.append({ source_kind: 'retrieval_summary', source_id: <emitted retrieval.summary event id> })` after a successful retrieval-summary emission. The append is fire-and-forget at the post-emission boundary; failure to insert the observation row is logged at WARN with `observation.retrieval_summary_emit_failed` and does NOT roll back the retrieval-summary event itself.

**Files to create or modify:**
- `shared/types/agentExecutionLog.ts` (M) — add the `observation_emitted` variant to the existing discriminated union; reuse the existing event-shape pattern.
- `server/services/agentExecutionEventService.ts` (M) — emit hook for `observation_emitted` events; calls into the observation-event emitter pipeline.
- `server/services/agentExecutionService.ts` (M) — at the run-step terminal-event boundary, when the step result includes a typed observation payload, invoke `agentObservationService.append()`. The retrieval-summary handler also invokes `append()` for retrieval-derived observations (Rev 2 — composition with PR #274's existing emission, no duplication of the retrieval-summary event itself).

**Contracts.**
```typescript
// shared/types/agentExecutionLog.ts (existing union extended)
export type AgentExecutionLogEvent =
  | ExistingVariant1
  | ExistingVariant2
  | { kind: 'observation_emitted'; observationId: string; observationType: typeof OBSERVATION_TYPES[number]; agentId: string; runId: string; eventTimestamp: string; }
  | ...;
```

**Error handling.**
- The `observation_emitted` event variant is emitted AFTER the observation row has been written; if the row write fails (e.g. cycle detection 409), the variant is not emitted and the run-step terminal event proceeds without it.
- Failure to emit the event variant after a successful row write is a degraded path: the observation exists in the DB but not in the event stream; logged at WARN with `observation.event_emit_failed`. Reason: §11.3 *External-call ordering* — DB write first, event-stream emission second; failures surface as observable telemetry without rolling back the row.

**Test considerations.**
- `pr-reviewer` at branch level: discriminated-union exhaustiveness check in TypeScript catches any consumer that has not been updated.
- `spec-conformance`: the new variant is present in `shared/types/agentExecutionLog.ts`; the run-step terminal hook calls `agentObservationService.append()`; no raw observation insert paths exist anywhere.
- The exhaustiveness compiler check covers the validator (`§8.13 Discriminated-union validators` from `DEVELOPMENT_GUIDELINES.md` is satisfied because the union-update lands in the same commit as the consumer update).

**Dependencies.** Chunks 1, 2, 3.

**Verification commands:**
```
npm run lint
npm run typecheck
```

---

### Chunk 5 — Migration 0306 + Overview aggregator + Overview routes

**spec_sections:** §5 Phase 2 (subset), §6.6, §7.4, §9 (execution model), §9.1 (cache invalidation triggers)

**Scope.** Land migration `0306_agent_default_landing_tab.sql` (adds `users.default_agent_tab`). Land `agentOverviewAggregator` service that composes the §7.4 initial-payload contract from existing tables, honouring the ≤150KB compressed budget. Land all the new GET endpoints on `server/routes/agents.ts` (or a new `server/routes/agentOverview.ts` if `agents.ts` is over the 200-line ceiling — builder decides at write time). Wire the §9.1 files-snapshot cache invalidation triggers to the existing `agent_execution_events` channel; trigger detection logic lives in `agentOverviewAggregator`; subscribers wire at server bootstrap.

**Rev 3 — payload budget measurement contract.** The ≤150KB budget is **measured as the gzip-compressed UTF-8 HTTP response body under production Express compression settings (default `compression()` middleware, gzip, level 6)**. NOT raw `JSON.stringify` byte length, NOT brotli, NOT pre-compression. The Open Question 6 profiling task in this chunk MUST report the gzipped on-wire byte count for the worst-case fixture; the raw JSON byte count is informational only. If the production middleware is later swapped to brotli, the budget recomputes against brotli output — but until then, gzip is the contract.

**Rev 2 — migration number.** Spec §5 says "0289"; this chunk uses **0296** (next free after PR #274's 0294).

**Rev 4 (S2 collision) — migration number.** PR #275 occupied 0295–0304 on main 2026-05-09. Branch's 0296 renamed to **0306**. Filename in working tree: `migrations/0306_agent_default_landing_tab.sql`.

**Rev 2 — Phase 1 coordination on cache invalidation.** Per §15.1 the Files snapshot subscribes to `knowledge.files.{promoted,deleted,archived,restored,metadata_changed,access_changed,merged}` events on `agent_execution_events`. **None of these are emitted on main as of `b1c4d14d`.** The Overview aggregator MUST ship the subscriber wiring in this chunk regardless — it logs `overview.cache_invalidation_subscriber_inactive` at INFO once per boot per event-name when zero events arrive in the first 5 minutes after boot, and degrades to TTL-only freshness (60s per spec §13.7). When Phase 1 follow-up emits any of these events, the subscribers activate without code change. This is the contract for §15.1 conditional triggers — the subscriber is shipped; emission is Phase 1's deferred work.

**Rev 3 — log suppression across clustered restarts.** The "once per boot per event-name" rule is single-node correct but noisy under deploy loops or autoscaler churn. Subscriber-inactive log gets a **24h suppression window keyed `(event_name, host_or_pod_identity)`**: the first INFO emission per `(event_name, host)` per UTC day is logged; subsequent boots within the same UTC day on the same host downgrade to DEBUG. Cross-host boots are independent (no shared state). Implementation: in-process `Map<event_name, lastEmittedAtMs>`; if `now - lastEmittedAtMs < 24h`, downgrade to DEBUG. Resets on process restart — that is fine; the 24h window is best-effort, not load-bearing.

**Rev 2 — Knowledge In Use composition.** The `KnowledgeInUseCard` data shape in §7.4 is already pre-defined to consume `retrieval.summary` events from `agent_execution_events` (PR #274). This chunk's `agentOverviewAggregator.getKnowledgeInUse(agentId, ctx)` query reads the most-recent `retrieval.summary` event for a recent run via `agent_execution_events.event_type = 'retrieval.summary'` and returns the truncated bounded payload directly. No new ranking; no new emission; uses PR #274's pure helpers `retrievalObservabilityServicePure` only as **read-side reference** for understanding the bounded payload shape. If no recent run has emitted `retrieval.summary`, the card returns `{ entries: [], asOf: null, phase1_pending: false }` — empty is a valid state, not a degraded one.

**Files to create or modify:**
- `migrations/0306_agent_default_landing_tab.sql` (N) — `ALTER TABLE users ADD COLUMN default_agent_tab text NOT NULL DEFAULT 'overview' CHECK (default_agent_tab IN ('overview','configure','behaviour','personality','skills','scorecards','data-sources','schedule','budget','runs'))`. No backfill needed (`DEFAULT` covers existing rows).
- `migrations/0306_agent_default_landing_tab.down.sql` (N)
- `server/db/schema/users.ts` (M) — add `defaultAgentTab` column.
- `server/services/agentOverviewAggregator.ts` (N) — `buildOverviewPayload(agentId, ctx) → OverviewPayload`; lazy-load delegations live in separate methods (`getObservations`, `getFilesSnapshot`, `getActivityFeed`, `getKnowledgeInUse`, etc.); files-snapshot cache invalidation hooks subscribed at boot per §9.1.
- `server/routes/agents.ts` (M) or `server/routes/agentOverview.ts` (N) — new endpoints (each gated by `requirePermission(ORG_PERMISSIONS.AGENTS_VIEW)`):
  - `GET /api/agents/:id/overview`
  - `GET /api/agents/:id/observations`
  - `GET /api/agents/:id/files-snapshot`
  - `GET /api/agents/:id/tools-usage`
  - `GET /api/agents/:id/activity-feed`
  - `GET /api/agents/:id/connections-health/:connectionId`
  - `GET /api/agents/:id/working-time`
  - `GET /api/agents/:id/knowledge-in-use/:entryId/provenance`
- `server/index.ts` or equivalent bootstrap wiring (M) — subscribe `agentOverviewAggregator`'s cache-invalidation hooks to the `agent_execution_events` event tail at server boot.

**Contracts.**
```typescript
// agentOverviewAggregator.ts
export interface OverviewPayload {
  identity: { id: string; name: string; role: string; reportsTo: string | null; subaccountId: string | null; };
  presence: { state: AgentPresenceState; subtitle: string | null; activeRunId: string | null; currentFocus: CurrentFocus; elapsedSinceRunStartMs: number | null; serverNow: string; };
  activeGoals: ActiveGoal[];
  recentObservations: AgentObservation[]; // top 3 only
  knowledgeInUse: KnowledgeInUseEntry[];   // sourced from retrieval.summary events (PR #274)
  filesSnapshot: FileSnapshotEntry[];
  toolsUsageBands: { frequently: string[]; occasionally: string[]; rarely: string[]; asOf: string; };
  schedulePeek: { nextRunAt: string | null; trigger: string | null; label: string | null; } | null;
  connectionsHealth: ConnectionHealthEntry[];
  workingTime: { range: 'today'|'week'|'month'|'quarter'; buckets: WorkingTimeBucket[]; captionTotalSeconds: number; captionRunsCount: number; captionSuccessRate: number; captionAverageRunDurationSeconds: number; };
  activityFeed: ActivityFeedRow[]; // first 5
}
export async function buildOverviewPayload(agentId: string, ctx: PrincipalContext): Promise<OverviewPayload>;
```

**Error handling.**
- Routes use `asyncHandler`; service errors throw `{ statusCode, message, errorCode? }`.
- `:subaccountId` is NOT in any of these routes (agents are subaccount-scoped via the agent's own `subaccount_id` column, not via URL param), so `resolveSubaccount` is not called here.
- All routes use `withOrgTx` via the service; the aggregator never accesses `db` directly.
- Knowledge In Use surface: empty array is normal (no recent retrieval.summary event yet); not a degraded path. `phase1_pending` flag on the response defaults to `false` (PR #274 already shipped retrieval.summary as a first-class event subtype). The flag is reserved for if a future Phase 1 amendment introduces a stricter prerequisite.
- Files snapshot subscriber inactivity (no `knowledge.files.*` events for 5 min after boot) is logged INFO once and continues with TTL-only freshness; not an error.

**Test considerations.**
- `pr-reviewer` at branch level: payload size budget (≤150KB compressed) verified manually; the spec's worst-case profile (50-runs, 200-pinned, 30-knowledge) is profiled in this chunk per Open Question 6. Profile output goes in `tasks/builds/agent-workspace/progress.md` Phase 2.
- `spec-conformance`: every endpoint listed in §7.4 is present; each uses `requirePermission(ORG_PERMISSIONS.AGENTS_VIEW)`.
- Verify `getKnowledgeInUse` reads from `agent_execution_events.event_type = 'retrieval.summary'` (not from a hypothetical separate table).

**Dependencies.** Chunks 1, 2, 3. **(Rev 2)** Reads from the `agent_execution_events` table populated by `retrievalObservabilityService` from PR #274 — read-only dependency on shipped main, no version constraint beyond `b1c4d14d`.

**Verification commands:**
```
npm run lint
npm run typecheck
npm run db:generate
```

---

### Chunk 6 — AgentEditPage Overview tab shell + identity card + presence hero + hooks

**spec_sections:** §5 Phase 2 (subset), §7.1, §7.2, §7.4, §13.6 (`useAgentPresence` hook contract)

**Scope.** Insert `Overview` as the leftmost tab on `AgentEditPage`; new default landing per `users.default_agent_tab`. Land the composition root (`AgentOverviewTab`), the identity card, the presence hero (status pill + current focus + elapsed timer), and the two hooks (`useAgentPresence`, `useAgentOverview`). The hooks are server-confirmed-snapshot only; anti-optimistic invariant per §13.6 enforced by code review.

**Files to create or modify:**
- `client/src/pages/build/AgentEditPage.tsx` (M) — insert `Overview` as leftmost tab; read `users.default_agent_tab` on mount; route to that tab.
- `client/src/components/agent-workspace/AgentOverviewTab.tsx` (N) — composition root; renders cards in spec-defined order (identity → active goals → recent observations → knowledge in use → files snapshot → tools → connections → schedule → working time → activity feed).
- `client/src/components/agent-workspace/IdentityCard.tsx` (N) — name, role, reports-to, sub-account.
- `client/src/components/agent-workspace/PresenceHero.tsx` (N) — status pill + current focus + elapsed timer; consumes `useAgentPresence`.

  **Rev 3 — elapsed-timer drift semantics (pinned).** The `elapsedSinceRunStartMs` value is **server-authoritative**. Client-side ticking is allowed for display smoothness (e.g. `setInterval` increments the rendered elapsed by 1000 ms each second between server messages) ONLY for visual continuity — the authoritative value resets exclusively from server snapshot (initial fetch) or SSE event (`presence_state_changed`, `current_focus_updated`). Locally-derived elapsed values MUST NOT be persisted, MUST NOT be sent back to the server, and MUST NOT participate in invoice / working-time math. On every server message the rendered elapsed snaps to the new authoritative value (no smoothing across the snap). On reconnect-after-drop, the server snapshot is canonical; any locally-ticked drift is discarded silently. Reason: prevents accidental "optimistic duration" divergence that could leak into UI billing copy or user-visible totals.
- `client/src/hooks/useAgentPresence.ts` (N) — single server-confirmed snapshot per render; no optimistic synthesis; no React Query `optimisticData` binding.
- `client/src/hooks/useAgentOverview.ts` (N) — initial payload fetch + lazy-fetch delegations.

**Contracts.**
```typescript
// client/src/hooks/useAgentPresence.ts
export function useAgentPresence(agentId: string): {
  state: AgentPresenceState;
  subtitle: string | null;
  currentFocus: CurrentFocus;
  elapsedSinceRunStartMs: number | null;
  serverNow: string;
  isLoading: boolean;
  isError: boolean;
};
```

**Error handling.** Hooks return `isLoading`/`isError`; consumers render skeleton or error state. No client-local presence synthesis on error; the surface fails to a server-confirmed last-known state with an "as of N seconds ago" caption per §13.7 graceful-degradation rule.

**Test considerations.**
- Per `docs/spec-context.md` testing posture: `frontend_tests: none_for_now`. No unit tests in this chunk.
- `pr-reviewer` at branch level: visual diff against Mockups 2 (active state) and Mockup 4 (first-run state); status pill width fixed across all 7 states (§13.8); aria-live wiring per §13.8 (deferred details to Chunk 9 where SSE-driven updates land; the layout-stability prep is here).
- `spec-conformance`: `useAgentPresence` hook implementation contains no `optimisticData` reference; no client-side state derivation from raw signals.

**Dependencies.** Chunks 1, 2, 3, 5.

**Verification commands:**
```
npm run lint
npm run typecheck
npm run build:client
```

---

### Chunk 7 — Overview cards batch A (recent observations, knowledge in use, files snapshot)

**spec_sections:** §5 Phase 2 (subset), §7.3, §9.1 (cache invalidation), §13.7 (freshness matrix), §15.1 (Phase 1 deep-link contract)

**Scope.** Land three Overview cards that consume the lazy-load delegations: recent observations (top-3 + lazy `Show 2 more`), knowledge in use (top-3 + provenance expand), files snapshot (top-3 + deep-link to Phase 1 Knowledge → Files).

**Rev 2 — KnowledgeInUseCard data shape.** Reads `KnowledgeInUseEntry[]` from `useAgentOverview()` (Chunk 6). The entries source from PR #274's `retrieval.summary` events as wired in Chunk 5's `agentOverviewAggregator.getKnowledgeInUse()`. Empty list is the *normal first-run* state, not a degraded `phase1_pending` placeholder. The `phase1_pending` placeholder remains in the contract but is unset by default (Phase 1 retrieval observability shipped; no degraded variant needed).

**Rev 2 — FilesSnapshotCard deep-link.** The chip's deep-link query parameter shape `?agentId=...&runId=...&eventId=...&fileId=...&versionId=...` is defined by spec §7.7 + §15.1. **The Phase 1 Files tab on main (`KnowledgeFilesTab.tsx`) does NOT yet accept these query params.** This chunk renders the deep-link href with the contract-shaped query string; clicking it navigates to `/govern/knowledge?tab=files&agentId=...&...`. If the Files tab does not consume the params yet, the user lands on the unfiltered Files tab — graceful, not broken. When Phase 1 follow-up wires the resolver, the deep-link starts pre-filtering. No code change required in this chunk when that lands.

**Files to create or modify:**
- `client/src/components/agent-workspace/RecentObservationsCard.tsx` (N) — top-3; `Show 2 more` triggers `GET /api/agents/:id/observations?limit=2&cursor=...`; renders `body_truncated = true` rows with a *Truncated* affordance.
- `client/src/components/agent-workspace/KnowledgeInUseCard.tsx` (N) — top-3 with provenance expand; reads from PR #274 retrieval.summary projection via `useAgentOverview()`.
- `client/src/components/agent-workspace/FilesSnapshotCard.tsx` (N) — top-3; deep-link query parameter `?agentId=...&runId=...&eventId=...&fileId=...&versionId=...` per §15.1 (links into PR #274's Files tab; resolver-side wiring on the Files tab is Phase 1 follow-up — see §7 Risks).

**Contracts.** Each card is a presentational React component receiving its slice of the `OverviewPayload` from `useAgentOverview()`. Lazy-load on click is via direct `fetch` against the matching endpoint from Chunk 5.

**Error handling.** Empty / error / loading per `frontend-design-principles.md`. *Truncated* affordance on observations links to the run trace event detail panel (existing surface).

**Test considerations.**
- Visual diff against Mockups 2/3.
- Phase 1 graceful: KnowledgeInUseCard with `entries=[]` renders empty-state ("No retrieval-summary events yet — these appear after the agent's next run") rather than a phase1-pending placeholder. The `phase1_pending` placeholder is reserved for if a future Phase 1 amendment introduces a stricter prerequisite.

**Dependencies.** Chunks 5, 6.

**Verification commands:**
```
npm run lint
npm run typecheck
npm run build:client
```

---

### Chunk 8 — Overview cards batch B (active goals, tools, connections, schedule, working time chart, activity feed, first-run, hook)

**spec_sections:** §5 Phase 2 (subset), §7.5, §11.6 (working-time reconciliation), §13.6, §13.7

**Scope.** Land the remaining Overview cards plus the working-time chart, the activity feed card, the first-run variant, and the working-time hook. Working Time chart caption surfaces *"You're billed for this time only, not while the agent is idle"*; chart total reconciles 1:1 with the per-agent invoice line (§7.5 reconciliation invariant — the rollup is the single source for both).

**Files to create or modify:**
- `client/src/components/agent-workspace/ActiveGoalsCard.tsx` (N)
- `client/src/components/agent-workspace/ToolsUsageBandsCard.tsx` (N) — three qualitative bands.
- `client/src/components/agent-workspace/ConnectionsHealthCard.tsx` (N) — read-only snapshot; edits live on Connections page.
- `client/src/components/agent-workspace/SchedulePeekCard.tsx` (N) — when next, what triggers.
- `client/src/components/agent-workspace/WorkingTimeChart.tsx` (N) — timeframe pills (today/week/month/quarter); per-bar hover surfaces contributing run ids; caption per spec §1.1 G8.
- `client/src/components/agent-workspace/ActivityFeedCard.tsx` (N) — first 5 rows; *View all* deep-link.
- `client/src/components/agent-workspace/FirstRunOverview.tsx` (N) — lean first-run page per Mockup 4 (welcome banner + 3 quick-action cards + identity + tools + connections; no checklist, no empty placeholders).
- `client/src/hooks/useAgentWorkingTime.ts` (N) — per-timeframe data fetcher; the bucket containing "now" gets live updates from SSE in Chunk 9.

**Contracts.**
```typescript
export function useAgentWorkingTime(agentId: string, range: 'today'|'week'|'month'|'quarter'): {
  buckets: WorkingTimeBucket[];
  captionTotalSeconds: number;
  // ... rest of caption stats
  isLoading: boolean;
  isError: boolean;
};
```

**Error handling.** Mockup 4 first-run rendering is conditional on the agent having no completed runs AND no observations; the gate lives in `AgentOverviewTab` (Chunk 6). This chunk only ships the first-run component itself.

**Test considerations.**
- Visual diff against Mockups 2/3/4.
- Working-time chart total reconciles with invoice line (manual operator pass against a fixture run).
- Activity feed cap = 5 rows; *View all* opens the existing run trace surface.

**Dependencies.** Chunks 5, 6, 7.

**Verification commands:**
```
npm run lint
npm run typecheck
npm run build:client
```

---

### Chunk 9 — SSE publisher + presence stream + Home widget

**spec_sections:** §5 Phase 3, §13 (live transport contract — all subsections), §7.6 (Home widget ordering)

**Scope.** Land the single-node SSE publisher, the per-agent and workspace-scope stream endpoints, the SSE client library, the workspace-scope hook, and the Home widget that replaces the existing Active Agents `MetricCard` body. Add `ORG_PERMISSIONS.AGENTS_PRESENCE_STREAM_SUBSCRIBE` permission key. Wire ARIA-live throttle helper per §13.8.

**Rev 2 — bounded-payload pattern reuse.** This chunk's `agentPresenceStreamPublisher` is a high-cardinality observability surface (per-agent ring buffers, per-event payloads). It MUST follow KNOWLEDGE.md pattern #7 (PR #274 finalisation): per-event payload caps, ring-buffer size cap (60s × max-event-rate), deterministic truncation at the publisher boundary if a single event exceeds the cap (truncate `data` field, set `truncated: true` flag, emit per-day `presence_stream.event_truncated` metric). Constants live in `agentPresenceStreamPublisher.ts` and are tested in a small companion file (the publisher itself remains integration-shaped; the cap-decision helper is pure and testable).

**Files to create or modify:**
- `server/lib/permissions.ts` (M) — add `AGENTS_PRESENCE_STREAM_SUBSCRIBE: 'org.agents.presence.stream.subscribe'`.
- `server/services/agentPresenceStreamPublisher.ts` (N) — singleton in-process publisher; subscriber registry keyed `(agentId | subaccountId, subscriberId)`; ring buffer for 60s reconnect-replay window; `fanOut(event)` invoked from `agentExecutionEventService` event tail. NO Redis pub/sub; NO message bus; explicit single-node topology per §13.1.1. Per-event payload caps + deterministic truncation per KNOWLEDGE.md pattern #7.

  **Rev 3 — ring-buffer eviction order (pinned).** Eviction MUST follow `(event_timestamp ASC, event_id ASC)` — the canonical replay tuple. When the buffer cap is exceeded under burst pressure, the oldest canonical-order event is evicted first. **Eviction is NOT FIFO-by-insert-order**; insert-order can diverge from canonical order if events arrive out-of-order from concurrent run-step emissions. The buffer therefore stores events in canonical-order indexed structure (insertion-sort, or a sorted ring) so that replay always returns the same subset for the same `Last-Event-ID` regardless of arrival order.

- `server/routes/agentPresenceStream.ts` (N) — two SSE endpoints:
  - `GET /api/agent-presence/stream/:agentId`
  - `GET /api/agent-presence/stream/workspace/:subaccountId` — calls `resolveSubaccount(req.params.subaccountId, req.orgId!)` before consuming the ID per §1 RLS rules.
  - Both gated by `requirePermission(ORG_PERMISSIONS.AGENTS_VIEW + ORG_PERMISSIONS.AGENTS_PRESENCE_STREAM_SUBSCRIBE)`.
  - **Last-Event-ID precedence (Rev 3 — simplified).** If `Last-Event-ID` header is present on the request, it ALWAYS supersedes `lastEventId` query param — regardless of whether the request is an initial open or an auto-reconnect (the server cannot reliably distinguish the two; native `EventSource` sends the header on every reconnect). The query param is consulted ONLY when the header is absent. If both header and query param are supplied and conflict, the header wins and the divergence is logged at DEBUG (`presence_stream.last_event_id_conflict`). This single rule replaces the prior open-vs-reconnect distinction.
- `client/src/lib/agentPresenceStream.ts` (N) — wraps native `EventSource`; reconnect with `Last-Event-ID`; `(event_timestamp, event_id)` ordering on the client side.
- `client/src/hooks/useWorkspacePresence.ts` (N) — workspace-scope hook for the Home widget.
- `client/src/pages/operate/HomePage.tsx` (M) — replace `MetricCard` invocation with `HomeActiveAgentsWidget`.
- `client/src/components/home/HomeActiveAgentsWidget.tsx` (N) — sectioned live widget per Mockup 1; consumes `useWorkspacePresence`; sections ordered via `orderHomePresenceSections` from Chunk 2.
- `client/src/lib/accessibility/announceLiveUpdate.ts` (N) — ARIA-live throttle helper (one announcement per 5s per surface; bursts collapse to "N events in last minute").

**Contracts.**
```typescript
// server/services/agentPresenceStreamPublisher.ts
export interface PresenceStreamEvent {
  agentId: string;
  eventTimestamp: string;
  serverNow: string;
  eventId: string;
  data: unknown;
  eventType: 'presence_state_changed'|'current_focus_updated'|'observation_appended'|'activity_row'|'working_time_bucket_updated'|'server_heartbeat';
  truncated?: boolean;  // pattern #7: set when payload truncated at publisher boundary
}
export function fanOut(event: PresenceStreamEvent): void;
export function subscribe(scope: { kind: 'agent', agentId: string } | { kind: 'workspace', subaccountId: string }, subscriberId: string, send: (event: PresenceStreamEvent) => void): { unsubscribe: () => void };
export function replaySinceLastEventId(scope: ..., lastEventId: string | null): PresenceStreamEvent[];

// client/src/hooks/useWorkspacePresence.ts
export function useWorkspacePresence(subaccountId: string): { rows: PresenceRow[]; isConnected: boolean; isReconnecting: boolean; };
```

**Error handling.**
- Cross-org isolation gate: handshake-time check that the subscribing user has `AGENTS_VIEW` + `AGENTS_PRESENCE_STREAM_SUBSCRIBE` for the requested `(agentId | subaccountId)`; fails 403 if not.
- Buffer-overflow path (client gone >60s): server sends a single `presence_state_changed` event with the canonical state; client snaps; logged at INFO.
- Client SSE drop: hook surfaces `isReconnecting: true`; UI renders a local "Reconnecting..." banner; **canonical presence state on the server is unchanged** (per §12.3 client-vs-canonical separation).
- Per-event payload truncation: triggered when `JSON.stringify(data)` exceeds the per-event byte cap; `truncated: true` flag set; metric `presence_stream.event_truncated` incremented (one bucket per day).
- **Rev 3 — elapsed-timer authority on the stream.** SSE events that carry an `elapsedSinceRunStartMs` field (e.g. `presence_state_changed`, `current_focus_updated`) deliver the **server-authoritative** value at emission time. Per Chunk 6's pinned semantics, the client snaps to this value on receipt and MAY tick locally between events for display smoothness, but server messages always win. Server MUST NOT subtract or interpolate elapsed across stream events; each event carries an absolute, freshly-computed value.

**Test considerations.**
- `pr-reviewer` at branch level: cross-org leak test (manually verified — two browser tabs from different orgs subscribed to `:agentId` belonging to org A; org B's tab gets 403).
- `spec-conformance`: §13.1.1 single-node topology — no Redis client import, no message bus import.
- Visual diff against Mockup 1 (Home widget).
- ARIA-live throttle: simulated 12-event burst collapses to one announcement.
- Pattern #7 reuse: byte-bound cap is a constant, not a magic number; deterministic truncation is tested in a small Pure helper file beside the publisher.

**Dependencies.** Chunks 1, 2, 3, 4, 5.

**Verification commands:**
```
npm run lint
npm run typecheck
npm run build:client
```

---

### Chunk 10 — IEE session lifecycle + run-engine integration

**spec_sections:** §5 Phase 4 (subset), §6.2, §7.5, §11.3 (concurrency guards)

**Scope.** Implement the full session lifecycle in `ieeExecutionService` per §6.2 transitions (active ↔ idle, → torn_down, → failed). Wire `iee_sessions` row creation at run start, container-handle-reuse-or-spawn at step dispatch, heartbeat extension at heartbeat events, and summary-write + container-release at run terminal event. Per spec §10, `iee_sessions` schema and skeleton service exist from Chunks 1+3; this chunk adds the lifecycle integration.

**Files to create or modify:**
- `server/services/ieeExecutionService.ts` (M) — at run start: `ieeSessionService.createSession(runId, agentId, ctx)`; at step dispatch: dispatch into existing container if alive, else spawn new; at heartbeat events: `ieeSessionService.heartbeat(sessionId, ctx)` updating `last_heartbeat_at`; at run terminal event: write `summary` JSON, upload durable artifacts to Phase 1 Execution Files store (existing primitive), release container, set `released_at` + `release_reason`.
- `server/services/ieeSessionService.ts` (M) — extend the skeleton from Chunk 3 with the lifecycle methods: `tearDown(sessionId, reason, ctx)` (optimistic predicate `WHERE status IN ('active','idle')` per §11.3); `markFailed(sessionId, ctx)`; `recordSummary(sessionId, summary, ctx)`.

**Contracts.**
```typescript
// ieeSessionService.ts (added in this chunk)
export async function tearDown(sessionId: string, reason: 'run_completed'|'idle_timeout'|'orphan_cleanup'|'failed'|'operator_cancelled', ctx: PrincipalContext): Promise<{ alreadyTornDown: boolean }>;
export async function markFailed(sessionId: string, ctx: PrincipalContext): Promise<void>;
export async function recordSummary(sessionId: string, summary: object, ctx: PrincipalContext): Promise<void>;
```

**Error handling.**
- Second teardown attempt returns the prior teardown's result (existing `release_reason`); no error.
- Heartbeat after teardown is a no-op (0 rows updated under `WHERE id = $1 AND status IN ('active','idle')`).
- Container failure → `status = 'failed'`, `release_reason = 'failed'`; the `container_handle` is retained for 24h post-teardown per Open Question 5.
- Run-terminal-event integration uses §11.3 race-claim ordering: state-claim first (`tearDown` predicate succeeds), THEN external side-effect (container release).

**Rev 3 — transaction / external-side-effect boundary (pinned).** Container release is an external side effect (network call to the IEE compute primitive) and MUST execute **after** successful `withOrgTx` commit, NEVER inside the transaction scope. Sequence:

1. Open `withOrgTx`.
2. Execute optimistic-predicate UPDATE on `iee_sessions` (the `tearDown` row-claim).
3. If the UPDATE returned 1 row, COMMIT the transaction. If it returned 0 rows, ROLLBACK and treat as already-torn-down.
4. **Only after a successful commit**, invoke the external container-release call.
5. If the external release call fails post-commit, the row state is already terminal — log `iee_session.container_release_post_commit_failure` at WARN with the session id; the orphan-cleanup job (Chunk 11) reclaims abandoned container handles. Do NOT roll back the row state; the row is the source of truth for "logically released" and the external resource leak is the observable telemetry.

`withOrgTx(async (tx) => { ... })` returns a value; the container-release call MUST be invoked after the `await withOrgTx(...)` line returns, not inside the callback. `pr-reviewer` enforces: any `containerReleaseClient.release(...)` call inside a `withOrgTx` callback is a blocking finding. Reason: prevents transaction/network entanglement regressions where a hung external call holds the row lock and blocks other writers.

**Test considerations.**
- `pr-reviewer` at branch level: race-claim ordering verified (state-update precedes container-release in `ieeExecutionService`).
- `spec-conformance`: terminal-state writes use a guarded predicate per `DEVELOPMENT_GUIDELINES.md §8.18`. The `iee_sessions` state machine is local to this service; the assert wraps the UPDATE (a localised version of the global state-machine guard suffices).

**Dependencies.** Chunks 1, 2, 3.

**Verification commands:**
```
npm run lint
npm run typecheck
```

---

### Chunk 11 — Maintenance jobs (orphan cleanup, prune, compact)

**spec_sections:** §5 Phase 4 (subset), §6.7 (retention policy)

**Scope.** Land the four pg-boss jobs that maintain the new tables. All jobs follow the existing pattern: admin-iteration over orgs, per-org `withOrgTx` for tenant-scoped writes (per `DEVELOPMENT_GUIDELINES.md §2`).

**Files to create or modify:**
- `server/jobs/ieeSessionOrphanCleanup.ts` (N) — every 5 min; walks `iee_sessions` rows with NULL `released_at` whose run is in a terminal state; calls `ieeSessionService.tearDown(reason='orphan_cleanup')`.
- `server/jobs/ieeSessionsCompactJob.ts` (N) — daily; compacts `iee_sessions.summary` blobs older than 90 days; retains rows.
- `server/jobs/agentObservationsPruneJob.ts` (N) — daily; prunes non-pinned observations older than 90 days. Sets `app.allow_observation_mutation = 'retention_prune'` for the DELETE; logged via `securityAuditService` per §6.1.

  **Rev 3 — batching invariant (pinned).** Deletes execute in **deterministic batches of at most 1000 rows ordered by `(created_at ASC, id ASC)`**, looping until a batch returns zero rows. Implementation:

  ```sql
  DELETE FROM agent_observations
   WHERE id IN (
     SELECT id FROM agent_observations
      WHERE pinned_at IS NULL
        AND created_at < NOW() - INTERVAL '90 days'
      ORDER BY created_at ASC, id ASC
      LIMIT 1000
      FOR UPDATE SKIP LOCKED
   )
  ```

  Each batch runs in its own per-org transaction (admin-iteration pattern). `FOR UPDATE SKIP LOCKED` lets the prune coexist with concurrent writers without blocking. Loop exit condition: a batch deletes zero rows. Reason: avoids giant transaction spikes, protects PostgreSQL VACUUM pressure, and keeps retention deterministic and auditable per-batch.
- `server/jobs/workingTimeRollupCompactJob.ts` (N) — monthly; collapses per-day buckets older than 1 year to monthly resolution.
- `server/jobs/index.ts` (M) — register the four jobs with their schedules; boot-time self-heal pattern per the existing `optimiserScheduleRegister` precedent.

**Contracts.** Each job exports a `runJob(ctx)` function and a schedule expression.

**Error handling.**
- Per `DEVELOPMENT_GUIDELINES.md §2` and the architecture admin/per-tenant pattern: each job uses an admin connection for iteration over orgs and `withOrgTx` per-org for writes.
- `agentObservationsPruneJob` MUST set `app.allow_observation_mutation = 'retention_prune'` GUC for the lifetime of the DELETE transaction; the immutability trigger blocks otherwise.
- Partial-success: a per-org failure does not abort the job; the failure is logged with the org id and the next org continues. Per the §2 rule: each org is its own admin transaction OR a SAVEPOINT inside an outer admin tx.

**Test considerations.**
- `pr-reviewer` at branch level: admin-iteration + `withOrgTx`-per-org pattern (verified against `memoryDedupJob.ts` precedent).
- `spec-conformance`: §6.7 retention policy table matches each job's behaviour.

**Dependencies.** Chunks 1, 2, 3, 10.

**Verification commands:**
```
npm run lint
npm run typecheck
```

---

### Chunk 12 — Run trace lineage chips (HARD-BLOCKED on Phase 1 contract lock)

**spec_sections:** §5 Phase 5, §7.7, §15.1 (deep-link contract)

**Scope.** Land the inline file-lineage chips on Run trace event rows. Each chip resolves on the four-tuple `(run_id, event_id, produced_file_id, produced_version_id)`. Deep-link query parameter shape locked with Phase 1.

**Hard prerequisite — DO NOT BUILD UNTIL:**
- Phase 1 follow-up has committed its deep-link query-parameter resolver in `client/src/pages/govern/components/KnowledgeFilesTab.tsx` (or equivalent). **Rev 2 status: NOT shipped on main as of `b1c4d14d` (PR #274).** Main's Files tab accepts `subaccountId` + `linkedToKnowledge` only. The five-tuple resolver is Phase 1 follow-up work.
- The contract is locked in `shared/types/runTraceLineage.ts` (this chunk creates that file; if Phase 1 prefers a different shape, this chunk's `shared/types/runTraceLineage.ts` reflects Phase 1's shape — no synthesis).

If Phase 1 has not landed when this chunk starts, **escalate to the operator before building**. The plan does not include a placeholder contract.

**Files to create or modify:**
- `shared/types/runTraceLineage.ts` (N) — four-tuple shape + deep-link query-param contract.
- `client/src/pages/operate/components/EventFileLineageChips.tsx` (N) — chip cluster per event; max 4 visible + `+N more` expand.
- `client/src/pages/operate/components/FileLineageChip.tsx` (N) — individual chip; deep-link with version tuple; *Newer version available* badge when applicable.
- `client/src/pages/operate/components/RunTraceEventRenderer.tsx` (M) — compose `<EventFileLineageChips>` into each event row's content area; visual budget per §15.2.
- `client/src/pages/operate/RunTracePage.tsx` (M) — wire props through.

**Contracts.**
```typescript
// shared/types/runTraceLineage.ts
export interface FileLineageTuple { runId: string; eventId: string; fileId: string; versionId: string; }
export const FILE_LINEAGE_DEEP_LINK_PATH = '/govern/knowledge'; // Phase 1 owns; Rev 2: PR #274 placed Files tab under /govern/knowledge?tab=files
export function buildFileLineageDeepLink(tuple: FileLineageTuple, agentId: string): string;
// Result: `/govern/knowledge?tab=files&agentId=...&runId=...&eventId=...&fileId=...&versionId=...`
```

**Error handling.**
- Legacy `iee_artifacts` rows without all four fields render as un-chipped events (no chip surface; surrounding event row unchanged).
- Click on chip pointing at an archived file: Phase 1 owns the resolution (chip carries the version tuple; if file is archived, Phase 1 surface decides whether to render archived state or "no longer accessible").

**Test considerations.**
- Visual diff against Mockup 5.
- Layout caps: max 4 chips visible, `+N more` overflow inline-expandable, max event-row height 3 lines, filename truncation 36 chars middle-ellipsis.
- Chronological ordering invariant: causal order (NOT alphabetic, NOT MIME-grouped).

**Dependencies.** Chunks 1 (for `iee_artifacts` columns), 5 (for Overview tab indirectly), AND external Phase 1 follow-up deep-link resolver lock.

**Verification commands:**
```
npm run lint
npm run typecheck
npm run build:client
```

---

### Chunk 13 — Capabilities + positioning rewrite

**spec_sections:** §5 Phase 6, §14 (all subsections)

**Scope.** Land the `docs/capabilities.md` rewrites and the sales-conversation enablement note. Doc-only chunk.

**Files to create or modify:**
- `docs/capabilities.md` (M) — new top-level *Persistent Agent Workspace* section near the top; IEE intro reframe; new *Replaces / Consolidates* row for hosted-VM-per-agent platforms; Always-on capability reframe per §14.1.
- `docs/sales-conversation-vm-question.md` (N) — single-paragraph internal note pivoting *"do you give the agent its own VM?"* to workspace + on-demand compute language.

**Contracts.** Editorial Rules in `docs/capabilities.md § Editorial Rules` apply: vendor-neutral, marketing-ready, model-agnostic. `spec-conformance` and `pr-reviewer` enforce.

**Error handling.** N/A; docs.

**Test considerations.**
- Acceptance criterion (§14.4): a non-technical reviewer reads the updated `docs/capabilities.md` and answers *"what does Synthetos give my agent?"* in workspace-language without reaching for infrastructure language.
- A second reviewer locates the answer to *"how does this compare to Manus / OpenClaw?"* without finding any sentence beginning *"we do not have..."*.
- Marketing-language audit on sales decks / product copy / blog drafts is operator-driven (§14.2) and tracked in the Phase 3 finalisation handoff; NOT a build-PR file.

**Dependencies.** None (doc-only; not blocked by code chunks).

**Verification commands:**
```
npm run lint
```

---

### Chunk 14 — Architecture.md doc-sync + KNOWLEDGE.md patterns

**spec_sections:** §5 Phase doc-sync row

**Scope.** Update `architecture.md` to describe the Agent Workspace surface, the SSE publisher topology, the retention policy, and the new key files. Append observed patterns to `KNOWLEDGE.md`. Confirm `docs/doc-sync.md` checklist.

**Rev 2 — sibling, not extension.** PR #274 already added the *Document Retrieval Pipeline* section (lines ~967–1059) under *Reference Documents*. Agent Workspace adds a **new top-level section** under *Layer 4 — UI* (or as a sibling to *Layer 4 — UI*), not an extension of the retrieval pipeline. The section names: *Agent Workspace* (top-level) — Overview tab, Presence stream topology, Working time accounting, IEE session lifecycle, retention policy. Cross-references the existing *Document Retrieval Pipeline* section where the Knowledge In Use surface composes with `retrieval.summary` events.

**Files to create or modify:**
- `architecture.md` (M) — add new top-level *Agent Workspace* section; add *Key files per domain* rows for Overview aggregator, Presence stream publisher, IEE session lifecycle service, working-time accumulator; add presence-stream + retention-policy bullets under their relevant existing sections. Cross-reference the *Document Retrieval Pipeline* section from Knowledge In Use surface description.
- `KNOWLEDGE.md` (M, append-only) — patterns observed during build (e.g. "single-node SSE topology pattern with reconnect-snapshot recovery", "monotonic-clock hysteresis with in-process Map", "DFS cycle guard with FOR UPDATE for transactional safety", "ledger-table per-event idempotency for rollups crossing UTC midnight", "bounded-payload pattern reuse — KNOWLEDGE.md #7 applied beyond retrieval to SSE per-event caps").
- `docs/doc-sync.md` (read + verdict only; no edit) — confirm the build follows the canonical doc-sync checklist; record verdicts for each registered doc.

**Contracts.** N/A; docs.

**Error handling.** N/A.

**Test considerations.**
- `feature-coordinator` Doc-sync gate (Step 9) verifies all registered docs have explicit verdicts (yes / no with rationale / n/a).

**Dependencies.** All other chunks (this is the tail chunk that describes shipped behaviour).

**Verification commands:**
```
npm run lint
```

## 6. UX considerations (cross-chunk)

These apply across Chunks 6–9 + 12.

**Mockup compliance.** The five HTML prototypes at `prototypes/agent-workspace/` are the canonical visual reference per brief Rev 10:
- Mockup 1 (`home-active-agents.html`) → Chunk 9 Home widget
- Mockup 2 (`agent-overview-active.html`) → Chunks 6/7/8 active-state Overview
- Mockup 3 (`agent-overview-idle.html`) → Chunks 6/7/8 idle-state Overview
- Mockup 4 (`agent-overview-first-run.html`) → Chunk 8 first-run variant
- Mockup 5 (`run-trace-lineage.html`) → Chunk 12 lineage chips

Builders MUST compare implementation against the prototype HTML files; any divergence is a builder bug, not a spec bug.

**Loading / empty / error states.** Each card has three states:
- Loading: skeleton matching the final layout (no layout shift on data arrival per §13.8 layout stability).
- Empty: scoped empty-state per `frontend-design-principles.md` (e.g. *Recent observations*: "Nothing yet — observations appear after the agent's next run").
- Error: graceful degradation per §13.7 ("as of N seconds ago" caption); never renders stale data as live.

**Permissions gating.** `ORG_PERMISSIONS.AGENTS_VIEW` gates every Overview surface and the SSE stream subscription. Workspace-scope Home widget ALSO requires `ORG_PERMISSIONS.AGENTS_PRESENCE_STREAM_SUBSCRIBE` (Chunk 9). For viewers without `AGENTS_VIEW`, the Overview tab does not appear in the AgentEditPage tab strip; the existing tab strip remains intact.

**Reduced-motion + ARIA.** §13.8 invariants enforced at component-level: every animation honours `prefers-reduced-motion: reduce`; status-pill changes announced via `aria-live="polite"`; `waiting_on_human` and `failed` transitions use `aria-live="assertive"`; live updates rate-limited via `announceLiveUpdate.ts` (Chunk 9).

## 7. Risks & open questions (programme-level)

| Risk / open question | Likelihood | Impact | Mitigation / owner |
|---|---|---|---|
| **(Rev 2, NEW) Phase 1 deep-link query-parameter resolver missing on main as of `b1c4d14d`** | confirmed | high (blocks Chunk 12) | Spec §17 Q4 unchanged. Chunk 12 sequenced last; if resolver still missing at Chunk-12 entry, escalate to operator. Plan does not synthesise the resolver or invent a fallback link surface. Operator-owned: schedule Phase 1 follow-up before Chunk 12 build start, OR explicitly defer Chunk 12 to a v1.1 build. |
| **(Rev 2, NEW) Phase 1 `knowledge.files.*` lifecycle events missing on main** | confirmed | medium (degrades cache freshness, not correctness) | Spec §17 Q11 unchanged. Chunk 5 ships the subscriber wiring regardless; degrades to TTL-only freshness; logs `overview.cache_invalidation_subscriber_inactive` once per boot per event-name when zero events arrive in 5 min. When Phase 1 follow-up emits, subscribers activate without code change. Operator-owned: schedule Phase 1 follow-up; non-blocking for v1 ship. |
| Migration 0295 / 0296 collision with concurrent main-branch work | low | medium | Verified at S1 (no collision; main at 0294); re-verify at S2 in Phase 3; rename to next available number per `DEVELOPMENT_GUIDELINES.md §6.2`. |
| Worst-case Overview payload exceeds 150KB | medium | medium | Chunk 5 includes profiling task (Open Question 6); harden lazy-load delegations if violated; document budget exceedance in `progress.md`. |
| SSE single-node topology silently breaks if deployed multi-node | low | high | §13.1.1 explicitly locks single-node; `pr-reviewer` enforces no Redis/message-bus imports; broker is in §18 Deferred. |
| Anti-optimistic UI synthesis pattern slips past code review | medium | high | `useAgentPresence` hook test is purely a code-shape check; manual `pr-reviewer` enforcement per §16.5; `spec-conformance` adds a grep gate against `optimisticData` on presence state. |
| `agent_observations` immutability trigger missed in a future migration that replaces the table | low | high | Trigger lives in `0295`; any corrective migration that touches the table must re-create it; the immutability is the load-bearing safety; `pr-reviewer` flags absence in any subsequent migration. |
| `process.hrtime.bigint()` not available in some runtime context (e.g. Edge runtime) | very low | medium | This codebase runs Node only (Express); no Edge runtime in scope. If that ever changes, the in-process Map needs a different monotonic source. |
| **(Rev 2) Spec text refers to migrations 0288/0289; plan uses 0295/0296** | known | low (cosmetic) | Documented in §4 Executor notes and Revision history. `spec-conformance` reviewers should treat this as a Rev 2 reconciliation, not a deviation. The spec is locked; the plan reconciles to the post-PR-#274 migration sequence. |

### Open questions deferred to Phase 2 builder (no blocker, but flagged)

These mirror spec §17 (which remains the source of truth — re-read directly):
- **Q4** Phase 1 deep-link query-parameter resolver shape (subsumed by the Risks row above).
- **Q11** Phase 1 file-lifecycle event names AND coverage (subsumed by the Risks row above).
- Q3 idle-timeout configurability — locked at 300s for v1.
- Q5 container-handle lifecycle on failure — locked at 24h retention for v1.
- Q6 worst-case Overview payload profiling — owner is Chunk 5 builder.
- Q9 anti-fake-progress validator location — locked at focus-line summariser server-side.
- Q10 current-focus cache backend — defaults to process-local memory.
- Q7 (profiling-gated) materialised activity-feed projection — deferred unless profiling shows it's needed.
- Q1, Q2, Q8 — resolved at spec close; do not re-open.

## 8. Self-consistency pass

Run on the entire plan immediately before submitting to `chatgpt-plan-review`.

- Every chunk's `spec_sections:` field maps to a real spec section. Confirmed.
- Every file in spec §5 is touched in exactly one chunk (or in multiple chunks if it is a Modify across phases). Confirmed.
- No chunk references a primitive introduced in a later chunk. Verified by chunk dependency declarations:
  - Chunks 1, 2 → no deps
  - Chunk 3 → depends on 1, 2
  - Chunk 4 → depends on 1, 2, 3
  - Chunks 5, 6, 7, 8 → depend on 1–5 in various combinations (forward only)
  - Chunk 9 → depends on 1, 2, 3, 4, 5
  - Chunks 10, 11 → depend on 1, 2, 3 (and 11 on 10)
  - Chunk 12 → depends on 1, 5, AND external Phase 1 follow-up deep-link resolver
  - Chunk 13 → no dependencies (doc-only)
  - Chunk 14 → depends on all (tail)
- `(event_timestamp ASC, event_id ASC)` ordering invariant: enforced at unit level in Chunk 2, runtime level in Chunk 3, transport level in Chunk 9. Three-tier defence.
- Monotonic-clock hysteresis: pure helper in Chunk 2 simulates wall-clock jumps; runtime in Chunk 3 uses `process.hrtime.bigint()`; degraded-recovery semantics in Chunk 9's stream events. Three-tier defence.
- Closed enums (`AgentPresenceState`, `observation_type`, session `release_reason`): Postgres CHECK in Chunk 1, TypeScript literal-tuple in Chunk 2, application use in Chunks 3+. Three-tier defence.
- File-inventory drift: every file referenced in chunk-prose appears in the chunk's "Files to create or modify" list; no orphan paths.
- Phase 5 hard-block (Chunk 12) is documented at chunk-level, plan-level, and risks-level — three places. Operator cannot miss it. **Rev 2:** explicitly confirmed against `b1c4d14d` (PR #274 main state) — resolver is not shipped, so the hard-block remains active.
- Testing posture per `docs/spec-context.md` (`pure_function_only` runtime tests; no frontend / API-contract / E2E): only Chunk 2 authors new vitest tests (six pure-helper test files) plus the small companion to Chunk 9's truncation-decision helper; subsequent chunks rely on the pure-helper tests for deterministic logic and on `pr-reviewer` / `spec-conformance` for orchestrator-shape checks.
- Doc-sync: Chunk 14 closes the loop; `feature-coordinator`'s Doc-sync gate (Step 9) records verdicts for every registered doc.
- **(Rev 2)** Migration numbers: 0295 + 0296 are the next free numbers after main's 0294. Re-verified at Rev 2 write time. Plan and spec text disagree on numbers (locked spec says 0288/0289); resolution: plan wins for filenames, spec structural intent governs.
- **(Rev 2)** Composition with PR #274: `retrieval.summary` events (existing on main, emitted by `retrievalObservabilityService`) are read by `agentOverviewAggregator.getKnowledgeInUse()` (Chunk 5) and serve as one of four `metadata.source_kind` values for `agent_observations` rows (Chunks 3+4). No duplication of emission; pure read-side composition.
- **(Rev 2)** KNOWLEDGE.md pattern #7 (bounded observability with deterministic top-N truncation) is reused as the model for Chunk 9's `agentPresenceStreamPublisher` per-event payload caps + ring buffer. Pattern #6 (generic ranker) is informational only; agent-workspace does not introduce a new ranker.
- **(Rev 3)** Eight previously-implicit invariants are now pinned at chunk level: (1) §11.1 watermark predicate restated literally in Chunk 3; (2) gzip-compressed UTF-8 HTTP body as Chunk 5 budget unit; (3) 24h log suppression on Chunk 5's subscriber-inactive log; (4) `(event_timestamp ASC, event_id ASC)` ring-buffer eviction in Chunk 9; (5) Last-Event-ID header always supersedes query param in Chunk 9; (6) server-authoritative elapsed timer with allowed local ticking but no persistence in Chunks 6+9; (7) container release after `withOrgTx` commit, never inside, in Chunk 10; (8) 1000-row deterministic prune batches with `FOR UPDATE SKIP LOCKED` in Chunk 11. None of these are structural changes; all are precision tightenings that make existing intent self-evident at chunk level.

---

**End of plan.** Total: 14 chunks across 6 spec phases plus doc-sync. Plan is forward-only, builder-session-sized, and respects the spec's hardened invariants. Rev 2 reconciles to the post-PR-#274 baseline without altering chunk shape, dependencies, or invariants.
