# Implementation Plan — consolidation-build

**Spec:** `tasks/builds/consolidation-build/spec.md`
**Build slug:** `consolidation-build`
**Depends on:** `consolidation-foundation` (PR #270 merged on main; primitives available)
**Authored:** 2026-05-07
**Author:** architect (inline)
**Target builder:** sonnet (one chunk per `builder` sub-agent invocation under `feature-coordinator`)
**Estimated effort:** 6-8 builder-days; two PRs likely (backend C1-C5b, frontend + doc-sync C6-C11)
**Plan version:** v1.1

**Changelog.**
- v1.2 (2026-05-07) — final review pass: fixed C2 acceptance criteria (308 reference removed; legacy path correctly described as internal-delegation with deprecation headers); added cursor encoding literal example (O1); strengthened `linkedAgents` ordering invariant — service MUST preserve caller order, no silent reorder permitted (O2).
- v1.1 (2026-05-07) — incorporates ChatGPT plan-review pass tightenings (F1–F12, M1–M4): explicit optimistic-CAS wording on Q1 ETag concurrency; locked save-ordering invariant; null-ordering rules on the recurring-tasks cursor; faceted-filter semantics for `buildFilterOptions`; PG≥11 fast-default migration note; `linked_agent_ids` uniqueness invariant; legacy `/test-run` compatibility shim via internal-delegation + Deprecation header (no 308); durable-execution requirement for async test-run detach; `canonicalStringify` numeric normalisation rules; trigger-entity-keyed precedence for recurring-task dedupe; `EtagMismatchError` wraps full 409 payload; `AdminAgentsPage.tsx` deletion is in-scope for C10; project-route SoT invariant; `agentRevisionCount ?? 1` invariant codified at the service tier.
- v1 (2026-05-07) — initial plan.

---

## Table of contents

1. Executor notes
2. Model-collapse check
3. Architecture notes — open-question resolutions (Q1-Q7)
4. Pre-existing violation handling
5. Stepwise implementation plan
6. Per-chunk detail
   - C1 — Agent edit backend: GET /:id/full + tab-scoped writes + ETag concurrency + schema migration
   - C2 — Agent test-run async contract
   - C3 — Recurring tasks aggregator service + route
   - C3b — `formatFireCondition()` pure helper + tests
   - C4 — `PATCH /api/projects/:id` field expansion + linkedAgents
   - C5 — `shared/types/build.ts` + frontend API client wrappers
   - C5b — Agent list response: `agentRevisionCount`
   - C6 — AgentEditPage shell + 8 tabs + TestRunnerCard + picker modals
   - C7 — AgentsListPage with SortableTable + view-mode awareness
   - C8 — RecurringTasksPage with SortableTable + filters
   - C9 — ProjectEditPage with FormFooter + Goals migration banner
   - C10 — Sidebar + router wiring + retire legacy admin/skill pages
   - C11 — Doc-sync (architecture.md, capabilities.md, retired-page references)
7. Risks and mitigations
8. Doc-sync targets (full)
9. Self-consistency check
10. Chunk size summary
11. Acceptance gate (whole-build)

---

## 1. Executor notes

> **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

Per-chunk verification commands are restricted to:

- `npm run lint`
- `npm run typecheck`
- `npm run build:server` on chunks that touch `server/`
- `npm run build:client` on chunks that touch `client/`
- `npx tsx <colocated-test-path>` for any pure-function tests authored in the chunk

This plan is implementation-only for the thirteen chunks defined in §6. Spec scope (`tasks/builds/consolidation-build/spec.md` §4) is the authoritative contract; if a chunk discovers a contradiction between spec and reality, the builder reports `PLAN_GAP` and the coordinator routes back to architect — the builder does NOT silently widen scope.

**Foundation primitives are imported from `client/src/components/` and `client/src/hooks/`** (PageShell, Modal, Drawer, FormFooter, SortableTable, SearchBox, EmptyState, ErrorState, WorkspaceBadge, ViewModeSwitcher, useViewMode) — never re-create them, and never modify them in this build (they are owned by `consolidation-foundation`). If a primitive needs an additive prop, raise a `PLAN_GAP` and request a Phase-0 patch.

---

## 2. Model-collapse check

The four model-collapse questions:

1. Does this feature decompose into ingest → extract → transform → render?
2. Is each step doing something a frontier multimodal model could do in a single call?
3. If yes: can the whole pipeline collapse into one model call with a structured-output schema?

**Verdict: not applicable.** This build ships React UI, REST endpoints, a SQL aggregator, and a JSONB-backed schema additive. There is no LLM in the loop, no extraction, no transformation a frontier model could perform. The recurring-tasks aggregator unions trigger / scheduled-task / manual-run rows into one shape — that is deterministic SQL projection, not model work. Reject collapse: there is nothing to collapse.

(The agent-test endpoint runs an LLM, but the spec's scope is "expose the existing `agentExecutionService` over the new async contract". The model call is already in the codebase; this build only changes the HTTP surface.)

---

## 3. Architecture notes — open-question resolutions

### Q1 — ETag canonicalisation: single helper at `server/lib/agentEtag.ts`

**Decision.** Ship one new file: `server/lib/agentEtag.ts` exporting `computeAgentEtag(payload: AgentFullForEtag): string`. Service-tier callers (`agentService.getFull`, every tab-scoped writer) call it and store/return the result; the route layer enforces `If-Match` via a thin middleware `agentEtagPrecondition`.

**Why a new helper rather than reusing `testRunIdempotency.canonicalStringify`.** The existing helper at `server/lib/testRunIdempotency.ts` is bound to time-bucketed sha256 and includes a "client key hint" mixin — semantics that don't match a content-addressed concurrency token. Extending it would add a code path that branches on caller intent and weaken the test-run guarantees. The clean split is: `testRunIdempotency` covers idempotency keys (time-bucketed); `agentEtag` covers content hashes (deterministic, no time component). Both can call a shared `canonicalStringify` helper if reuse becomes valuable later — out of scope for this build.

**Signature:**

```ts
// server/lib/agentEtag.ts
export interface AgentFullForEtag {
  // Subset of fields that make up the agent's "version-relevant" state.
  // Lex-sorted at every nested level by canonicalStringify.
  // Excludes: createdAt, updatedAt, etag (self-referential), runs preview (not part of identity).
  configure: { name: string; description: string; roleTitle: string; parentAgentId: string | null;
    model: string; outputSize: 'compact' | 'standard' | 'extended';
    allowSubaccountModelOverride: boolean;
    responseMode: 'balanced' | 'expressive' | 'precise' | 'highly_creative'; };
  behaviour: unknown;          // full behaviour blob (additionalPrompt + parsed sections)
  personality: unknown;        // full personality blob (JSONB)
  skills: Array<{ id: string; key: string; configJson: unknown; status: string }>;
  dataSources: Array<{ id: string; kind: string; ref: string; status: string }>;
  triggers: Array<{ id: string; kind: string; spec: unknown; status: string }>;
  budget: { dailyCapUsd: number | null; monthlyCapUsd: number | null; warnThresholdPct: number };
}

/** sha256 of canonical JSON. Spec §4.2 ETag canonicalisation rules. */
export function computeAgentEtag(payload: AgentFullForEtag): string;

/** Internal: lex-sorts keys, omits undefined, preserves array order, normalises numbers. */
export function canonicalStringify(value: unknown): string;
```

**`canonicalStringify` numeric normalisation rules (F9 — be precise; independent implementations cannot drift):**

- Integers and floats with the same mathematical value emit the same token: `1` and `1.0` and `1.00` all serialise as `1`.
- `-0` normalises to `0`.
- Exponent notation is normalised to plain-decimal: `1e3` and `1000` both emit `1000`. Exponents only re-appear when the absolute value lies outside the safe-decimal range Node uses for `String(Number(...))` round-tripping (handled by `Number.prototype.toString()` defaults — explicit fallback).
- Trailing zeroes after the decimal point are stripped: `1.50` → `1.5`.
- `NaN`, `+Infinity`, `-Infinity` are **rejected** — `canonicalStringify` throws on encounter (these are not valid ETag inputs and should never appear in agent state).
- BigInts are **rejected** — agent state is plain JSON; a BigInt indicates a service-tier bug.
- Object keys are sorted lex-ascending at every nested level (Unicode code-point order via `String.prototype.localeCompare(... { sensitivity: 'variant' })`-equivalent — concretely the default `Array.prototype.sort` comparator, which is code-point order in modern Node).
- `undefined` values inside objects are omitted; `null` values are preserved.
- Arrays preserve insertion order (caller's responsibility to sort beforehand — see INVARIANT-Q1-A above for `AgentFull` array ordering).

These rules are encoded in `agentEtagPure.test.ts` as explicit assertions so the helper is replaceable across releases without ETag drift.

**Caller contract.**
- `agentService.getFull(agentId, orgId)` builds the assembled record, calls `computeAgentEtag`, returns `{ ...record, etag }`.
- Every tab-scoped writer follows the optimistic-update pattern below.

**Concurrency mechanism (Spec §6 "ETag-based, state-based race guard"):**

```ts
// Inside the service write method (pseudo):
if (!expectedEtag) throw { statusCode: 428, message: 'If-Match header required' };
const current = await agentService.getFull(agentId, orgId);
if (current.etag !== expectedEtag) {
  throw { statusCode: 409, message: 'Agent changed', errorCode: 'ETAG_MISMATCH', currentEtag: current.etag };
}
await db.transaction(async (tx) => { /* mutate this tab's columns, update updatedAt */ });
return agentService.getFull(agentId, orgId);   // returns the new ETag in the body
```

**Concurrency guarantee (be precise — F1).** This pattern provides **optimistic stale-write detection, NOT serialisable compare-and-swap**. Last-writer-wins remains possible inside the read-compare-write race window:

```
T0: A reads etag E1
T1: B reads etag E1
T2: A passes compare + commits new state (etag now E2)
T3: B passes compare against its stale E1 (still loads from a snapshot that pre-dates A's commit, depending on isolation level) + commits over A's state
```

This window is acceptable for Phase 1 because **agent edits are low-frequency administrative operations** (one or two operators editing a given agent at a time, not high-throughput writes). The 409-on-next-attempt feedback loop catches the lost-update most of the time and the user reloads. Documented and accepted, not stronger than that.

**Deferred stronger guarantee.** If telemetry shows real lost-update cases post-launch, upgrade to one of:
- transaction-level `SELECT ... FOR UPDATE` on the agent row before the read-compare step (simplest), OR
- a monotonic `revision bigint` column on `agents` used as the SQL-level predicate inside the same transaction (`UPDATE ... WHERE revision = $expected RETURNING revision + 1`).

Both options are out of scope for this build (flagged in §10 deferred items). Spec §6 calls this a "state-based race guard" — that wording is accurate as a stale-write detector, not as a CAS primitive.

**Route-layer middleware:**

```ts
// server/middleware/agentEtagPrecondition.ts
export const agentEtagPrecondition: RequestHandler = (req, res, next) => {
  if (!req.header('If-Match')) {
    res.status(428).json({ error: 'If-Match required', errorCode: 'IF_MATCH_REQUIRED' });
    return;
  }
  next();
};
```

**HTTP mapping:**
- `If-Match` missing → 428 Precondition Required.
- `If-Match` mismatch → 409 with `{ error, errorCode: 'ETAG_MISMATCH', currentEtag }`. Client refetches.
- Successful write → 200 with `{ ...updatedAgent, etag: <new> }`.

**Considered and rejected:** per-tab ETag (would let a Behaviour write succeed while a Configure write was in flight, defeating the "consistent snapshot" guarantee Spec §4.2 names verbatim — "ETag is agent-global"). Adding an `etag text` column to the `agents` table (premature; the hash is cheap to recompute, and a stored ETag would need a trigger/job to stay in sync with the `additionalPrompt`, `agent_data_sources`, and `agent_triggers` rows the canonical shape includes).

**INVARIANT-Q1-A — Stable array ordering inside `AgentFull` (M3).** ETag is sha256 of canonical JSON, so any non-deterministic array order would mutate the ETag on every read and break the optimistic-concurrency contract. The service tier MUST sort every array in `AgentFull` deterministically before returning the record OR before computing the ETag — both produce identical hashes:

- `skills`: ORDER BY `createdAt` ASC, `id` ASC
- `dataSources`: ORDER BY `createdAt` ASC, `id` ASC
- `triggers`: ORDER BY `createdAt` ASC, `id` ASC
- `runs.last5`: ORDER BY `startedAt` DESC, `id` DESC (already a "latest-first" semantic the UI depends on)

**INVARIANT-Q1-B — Save-ordering contract (F2).** The Save-button writer chain on AgentEditPage iterates tabs in this exact order:

```
configure → behaviour → personality → skills → data-sources → triggers → budget
```

This order MUST remain deterministic and stable across releases because each successful tab write mutates the next tab's required `If-Match` ETag (each writer returns a fresh `AgentFull` with a new etag, threaded into the next request). Reordering writes — for example, "save Skills first because that's where the user clicked Save" — silently breaks the chain when two tabs were edited together. Future refactors that touch this order MUST update this invariant explicitly and run an end-to-end multi-tab dirty test.

**INVARIANT-Q1-C — Max response size for `GET /:id/full` (M1).** This endpoint is intentionally non-paginated for Phase 1 and the assembled payload is bounded by the agent's skills + triggers + dataSources rows + 5 runs preview. Expected upper bound: <500KB per response under typical configurations (≤30 skills, ≤20 triggers, ≤30 data-source bindings, 5 runs each ≤2KB). If telemetry shows responses ≥500KB, split the runs preview off into a separate `/api/agents/:id/runs?limit=5` endpoint and reduce the canonical ETag input to exclude runs. Out of scope for this build; flagged in §10 deferred items.

### Q2 — Project field renames: explicit conversion at the route boundary

**Decision.** Public API uses spec names (`budgetUsd`, `budgetWarnThresholdPct`, `repositoryUrl`, `objective`, `linkedAgents`); DB columns keep their existing names (`budgetCents`, `budgetWarningPercent`, `repoUrl`). Conversion lives in **one place**: `server/services/projectService.ts > toApiProject(row)` and `> fromApiPatch(body)` (paired pure mappers, colocated with the service). The route file calls `projectService.patch(orgId, projectId, body)` — never sees DB column names.

**Mapping rules:**
- `budgetUsd <-> budgetCents` (multiply by 100 / divide by 100; integer cents in DB; whole-USD float on the wire). Validation: `budgetUsd >= 0`, finite. Reject `null` for now (use omit to clear; a follow-up may allow null-clear).
- `budgetWarnThresholdPct <-> budgetWarningPercent` (1:1, integer 0-100).
- `repositoryUrl <-> repoUrl` (1:1, nullable string).
- `objective` — NEW column on `projects` table. Migration adds `objective text` (nullable). PATCH accepts string or `null`.
- `linkedAgents` — NEW column. **Decision: array column, not join table.** Add `linked_agent_ids uuid[] NOT NULL DEFAULT '{}'` to `projects`. Reading: spec §4.5 returns `linkedAgents: string[]`. Writing: PATCH replaces the array. **Why column, not join table:** (a) agent-project linkage is read-only at this scope (Linked Agents on project edit is a static cross-reference, not a permissioned subset); (b) no per-link metadata is required by the spec; (c) array column avoids a one-row-per-agent table that would need its own RLS policy. **If a future spec adds per-link metadata** (role, permissions, override budget), promote to `project_agent_links` table — flagged in §10 deferred items.

  **INVARIANT-Q2-A — `linkedAgents` uniqueness and ordering (F6, O2).** The array MUST contain unique agent UUIDs in exactly the caller-supplied order. Two requirements:

  1. **No duplicates.** UI bugs or copy-paste in tooling can produce `['a','a','a']`. `projectService.fromApiPatch` normalises via insertion-order-preserving dedupe before persistence:

     ```ts
     if (body.linkedAgents !== undefined) {
       const seen = new Set<string>();
       const deduped: string[] = [];
       for (const id of body.linkedAgents) {
         if (!seen.has(id)) { seen.add(id); deduped.push(id); }
       }
       updates.linkedAgentIds = deduped;  // caller order preserved, duplicates removed
     }
     ```

  2. **No silent reorder.** The service MUST preserve caller ordering exactly except for duplicate removal — no alphabetical sort, no id-sort, no any-sort. Reason: ordering may become semantically meaningful (priority ranking, execution order) in a future spec; silently alphabetising now would be a breaking change later. The `deduped` array above achieves this. Tested in `projectServicePure.test.ts` (input `['c','a','a','b']` → output `['c','a','b']`; original caller order preserved).

  Also enforced at the validation boundary (zod): `z.array(z.string().uuid()).max(500)` — an upper bound that surfaces accidental fan-outs early.
- `migratedFromGoalsAt` already implied by spec §4.5 banner. Add column `migrated_from_goals_at timestamptz` (nullable) in the same migration so the banner has a source of truth. Goals retirement is out of scope; the column is set retrospectively by ops (manual or one-off backfill).

**Migration:** one file (additive only, NOT NULL with safe defaults). See Q-supplement for the full DDL.

The Drizzle schema file (`server/db/schema/projects.ts`) is updated additively in C4.

**Considered and rejected:** API names match DB names (would push the rename burden onto every client and contradict the spec contract). Silent dual-name acceptance ("accept either `budgetUsd` or `budgetCents`") — adds an undocumented compat layer and invites drift. Mapping in middleware (correct mechanically, but the service is the natural seam — route-level mapping would split the concern across two files).

### Q3 — `agent_data_sources.metadata jsonb` column: NOT added in this build

**Decision.** Re-read spec §4.2 dataSources shape:

```ts
dataSources: Array<{ id; kind; ref; status: 'connected' | 'disconnected' | 'error' }>
```

No per-binding metadata field is named in the contract. The existing `agent_data_sources` schema (priority, maxTokenBudget, cacheMinutes, syncMode, loadingMode, sourceHeaders, lastFetchStatus) covers every wire field the spec requires. Skip the column.

**Mapping at the service tier:**
- `kind` ← `sourceType` (renaming for spec parity).
- `ref` ← `sourcePath`.
- `status` ← derived from `lastFetchStatus` + `connectionId`'s connection status (cross-stream: Spec C `integration_connections` table). Read-only join.

**If C6-frontend discovers a UI need for arbitrary per-binding metadata** (e.g. a "Notes" field next to a binding), raise a `PLAN_GAP` rather than slip the column in silently. Spec §10 already lists "Data-source schema validation in UI" as deferred — a metadata column is the same shape and belongs in that deferred bucket.

### Q4 — Async test-run contract: enqueue immediately, return 202, poll separately

**Decision.** Convert the existing `POST /api/agents/:id/test-run` (synchronous) into the spec's `POST /api/agents/:id/test` (async 202). **Rename + behaviour change in one step.**

The current implementation (in `server/routes/agents.ts`) calls `agentExecutionService.executeRun(...)` synchronously and returns the run record at status 201. The async contract requires:

1. Caller submits → server creates the `agent_runs` row (status `running`) → returns `{ runId, status: 'running' }` at 202 immediately.
2. Caller polls `GET /api/agent-runs/:runId?shape=test` until `status` ∈ `{ completed, failed }`.

**Mechanism.** `agentExecutionService.executeRun` already builds the run row before invoking the LLM loop. Wrap the existing call in an immediate-return shim:

```ts
// In the route handler (post-rename):
const runRow = await agentExecutionService.startRunAsync({
  agentId, organisationId: req.orgId!, subaccountId, subaccountAgentId,
  isTestRun: true, idempotencyKey, idempotencyCandidateKeys, /* … */
});
res.status(202).json({ runId: runRow.id, status: 'running' });
// The actual LLM loop continues in the background via the existing executeRun pipeline.
```

The new `startRunAsync` method:
- Reuses the existing `executeRun` flow up to the `agent_runs` row INSERT (idempotency check, run-row creation).
- Detaches the LLM loop using the **existing durable execution mechanism** (see F8 invariant below).
- Returns the inserted run row.

**INVARIANT-Q4-A — Durable execution required (F8).** `setImmediate(...)` is **forbidden** for detaching the LLM loop if any durable queue worker exists in this codebase. Reason: `setImmediate` runs the continuation on the same Node process; a process crash, deploy restart, or an unhandled promise rejection between the 202 and the LLM-loop completion **orphans** the run row in `running` state forever. The async test-run contract MUST flow through the same durable infrastructure that handles production agent runs.

Builder pre-check (C2): before writing `startRunAsync`, audit `server/services/agentExecutionService.ts` for the production async path. If `executeRun` is itself called from a durable queue worker (BullMQ, pg-boss, custom worker), `startRunAsync` enqueues a job and returns. If the production path is also synchronous, raise a `PLAN_GAP` rather than introducing a `setImmediate` shim — the durability question is too important to be decided silently inside this build. Only after architect confirms durable infrastructure exists is detached execution allowed; if confirmed absent, the test-run path stays synchronous-but-non-blocking via the existing `executeRun` invocation pattern (the route returns 202 once the run row is inserted; the LLM loop runs to completion in the same request handler before the route's `next()` fires the response, mediated by the existing pipeline). Whichever decision is made, document it in the chunk's PLAN_GAP block so the durability assumption is explicit.

**Read endpoint:** `GET /api/agent-runs/:runId` already exists at `server/routes/agentRuns.ts`. Add a `?shape=test` query parameter that triggers the AgentTestResult projection: `status`, `durationMs` from `completedAt - startedAt`, `resultPreview` truncated to 200 chars, `traceUrl` synthesised as `/run-trace/${runId}`. **A thin response-mapper** lives in `server/services/agentTestRunMapperPure.ts` (new pure helper) — isolates the test-runner contract from the broader run-detail shape.

**Idempotency.** Unchanged. Existing `deriveTestRunIdempotencyCandidates` (10s dual-bucket) handles the resubmit case. The 24-hour scope wording in Spec §4.3 is a policy mismatch with the existing 10s bucket — **document the deviation in C2's PLAN_GAP block**:

> Spec §4.3 names a 24-hour idempotency TTL. Existing implementation uses 10s dual-bucket. The plan adopts the existing implementation as-is for this build (ship and test, then address the TTL question in a follow-up). Rationale: changing the bucket size is a multi-spec concern (Spec C runs share the same helper); a unilateral change in this build risks downstream test runs across the platform.

**HTTP mapping:**
- 202 Accepted with `{ runId, status: 'running' }` on a fresh submit.
- 200 OK with `{ runId, status: <existing> }` on an idempotent hit (existing testRunIdempotency contract).
- 429 with rate-limit headers when the per-user test-run rate limit fires (existing behaviour preserved).

**In-flight guard (Spec §4.7).** Frontend responsibility — `<TestRunnerCard>` disables the Run button between submit and terminal poll. No backend change needed.

**Considered and rejected:** keeping `/test-run` and adding a parallel `/test` endpoint (carries two API surfaces forever — rename is cleaner). Inline-and-block-briefly with a 202 fallback (adds a latency-sensitive branch and complicates idempotency).

**Migration of consumers (F7 — preserve method + body explicitly).** Browser/client behaviour around automatic POST replay on 308 is uneven across internal tooling — a 308 redirect on a POST to `/test-run` is NOT guaranteed to replay the body, and some axios configurations follow the redirect with GET. **Preferred mechanism for one release:**

1. Keep the legacy `POST /api/agents/:id/test-run` handler in `server/routes/agents.ts`.
2. The legacy handler internally delegates to the same `agentExecutionService.startRunAsync(...)` invocation as the new path — same idempotency, same rate limit, same response shape.
3. The legacy handler emits a `Deprecation` response header (`Deprecation: true`, `Sunset: <ISO date one release out>`, `Link: </api/agents/:id/test>; rel="successor-version"`) and a WARN-level log line each time it fires (`logger.warn({ path: '/test-run', userId, agentId }, 'deprecated_test_run_path')`).
4. Internal callers (test fixtures page, etc.) are updated to the new path in C6 (frontend).
5. The legacy handler is removed in a follow-up release after the WARN-log volume drops to zero — flagged in §10 deferred items.

**Considered and rejected: 308 redirect.** Operationally fragile (POST replay is not universally honoured) and obscures the deprecation signal (the redirect target sees the request as if it were a fresh call, hiding the legacy-path usage from logs). The internal-delegate-with-deprecation-header pattern is the safer industry default for migrating a POST endpoint.

### Q5 — Subaccount scope reconciliation: new top-level routes resolve subaccount internally

**Decision.** New consolidated routes live at `/api/agents/:id/...` and `/api/recurring-tasks` (top-level, not subaccount-scoped). The service tier resolves subaccount via the agent record (every agent has exactly one `organisationId`; subaccount linkage flows through `subaccount_agents` per `req.orgId` filter). RLS scoping is unaffected — every query filters by `req.orgId`, every cross-subaccount read goes through the existing `subaccountAgentService`.

**Why not subaccount-scoped paths:** the spec's authoring surface is the org-level agents domain (`agents` table), not the per-subaccount link (`subaccount_agents` table). Configuring "the agent" once, then linking it per-subaccount, is the existing semantic. The spec consolidates the config-once pages, not the per-link pages — `SubaccountAgentEditPage` is in scope for retirement only because its functionality (skill / heartbeat overrides per subaccount) collapses into the org-level Skills tab + Schedule tab via the existing `subaccountAgents` overrides. **The per-link override surface itself is not removed** — it remains reachable via the existing route until a follow-up spec re-uses AgentEditPage in subaccount-link mode. Out of scope here; flagged as a follow-up risk in §7.

**Existing subaccount-scoped routes are retained:**
- `/api/subaccounts/:subaccountId/projects/:projectId` (project CRUD) is the existing surface. Spec §4.5 names `PATCH /api/projects/:id` — the plan ships this as a NEW top-level route that internally resolves the project's subaccount and delegates to the new `projectService`. The subaccount-scoped path stays for backward compatibility.
- `/api/subaccounts/:subaccountId/triggers` and `/api/subaccounts/:subaccountId/scheduled-tasks` remain the SoT for trigger / scheduled-task CRUD. The recurring-tasks aggregator is read-only and flows mutations back to these paths.

**INVARIANT-Q5-A — Project route source-of-truth (M2).** The top-level `/api/projects/:id` (introduced in C4) and the existing subaccount-scoped `/api/subaccounts/:subaccountId/projects/:projectId` MUST remain semantically equivalent. Both routes call `projectService.patch` / `projectService.getById` — the service is the single source of truth for project mutation. Neither route may add field handling or validation that the other lacks. Future field additions go to `projectService` (and its `toApiProject` / `fromApiPatch` mappers); both routes inherit the change automatically. A drift between the two routes (e.g. one accepts `objective`, the other doesn't) is treated as a bug, not a feature. **This invariant is documented in the doc-strings of both route handlers in C4 and re-asserted in C11's architecture.md update.**

### Q6 — Identity-key safeguard for `PUT /skills`, `/data-sources`, `/triggers`

**Decision.** Single shared helper at `server/lib/identityKeyDiff.ts`:

```ts
export interface IdentityDiffResult<T> {
  added: T[];
  updated: T[];
  removed: T[];
  /** Items present in `existing` but NOT in `incoming`. Default: forbid. */
  silentlyRemoved: T[];
}

export function diffByIdentityKey<T, K extends string | number>(
  existing: T[], incoming: T[], identityKey: (item: T) => K,
): IdentityDiffResult<T>;
```

Each tab-scoped PUT writer:

```ts
const diff = diffByIdentityKey(existing, incoming, (s) => s.id);
if (!force && diff.silentlyRemoved.length > 0) {
  throw {
    statusCode: 409,
    message: `Refusing to remove ${diff.silentlyRemoved.length} item(s) without force=true`,
    errorCode: 'IDENTITY_KEY_DELETION_BLOCKED',
    details: { removedIds: diff.silentlyRemoved.map(s => s.id) },
  };
}
// Apply added / updated / removed in transaction.
```

**Identity keys:**
- Skills: `skill.id` (UUID of the binding row, not the skill registry key).
- Data sources: `dataSource.id`.
- Triggers: `trigger.id`.

**Force semantics.** `?force=true` query parameter. Confirmation flows in Spec §4.11 (skill-remove with recent runs, trigger-pause with high fire volume) pass `force=true` after the user confirms. The default (force absent / false) protects against client bugs that drop items silently.

**Why a shared helper:** all three writers have identical diff-and-error semantics; duplicating the diff+throw logic across three writers invites drift.

**Tests (colocated):** `server/lib/__tests__/identityKeyDiffPure.test.ts` covers: empty existing, empty incoming, full overlap, full disjoint, partial overlap, identity collisions (incoming has two items with the same key — error), null/undefined ID handling (defensive throw at the helper boundary).

### Q7 — Sidebar reorganisation: additive edits, no rewrite

**Decision.** `client/src/config/sidebar.ts` is owned by `consolidation-foundation`. Per spec §9 "Shared-file edit policy", Build stream owns the **rows** under the Build group: Agents, Automations (existing), Recurring tasks. Inspecting current state of `sidebar.ts`:

- "Agents" row: currently exists in `work` group with workspace-scoped `to`. **Action:** retarget to top-level `staticRoute('/agents')` (the new consolidated AgentsListPage) and remove the workspace-scoped duplicate.
- "Automations" row: already exists at `staticRoute('/automations')`. **Action:** none.
- "Recurring tasks" row: does NOT exist. **Action:** add. Replaces the legacy "Scheduled" row currently at `buildRoute('/admin/subaccounts/:subaccountId/scheduled-tasks', { subaccountId: activeClientId })`.
- "Triggers" row in `work` group also surfaces recurring work today. **Action:** retire from sidebar (its content lives inside the new RecurringTasksPage union); keep the page route alive for backward links.
- The `platform` group's `sys-agents` row (`/system/agents`) is retired (consolidated into `/agents` with viewMode='system'). **Action:** remove from sidebar; redirect the route in C10.

Net diff to `sidebar.ts`: ~6 row changes (3 removals, 1 add, 2 retargets). All within the file's existing factory shape; no structural change. Builder extends the existing `client/src/config/__tests__/buildNavItems.test.ts` (handed forward from foundation) with the new row set.

`client/src/config/routes.ts` adds three new patterns: `/agents/:id/edit`, `/recurring-tasks`, `/projects/:id/edit`. The existing `/agents/:agentId` (singular) and `/admin/subaccounts/:subaccountId/agents/:agentSubaccountId/manage` patterns remain for existing chat/per-link links. Pattern parameter name `:id` (not `:agentId`) is chosen to match spec §4 wording.

### Q-supplement — Behaviour and Personality storage (no spec field exists today)

The spec lists three contracts for `behaviour` and `personality`:

```ts
behaviour: { briefingTemplate: string; constraints: string[]; ... };
personality: { traits: string[]; tone: string; ... };
```

The `agents` table today carries `masterPrompt` and `additionalPrompt` (text) — no `behaviour` or `personality` column.

**Decision.**
- **Behaviour** maps to existing `additionalPrompt: text`. The PATCH endpoint accepts `{ briefingTemplate, constraints[] }` and the service composes them into a single textarea-friendly string before persistence. Round-tripping (re-parsing back into structured fields) is **not** required for Phase 1 — the prototype's Behaviour tab is a single textarea. The structured shape in spec §4.2 is forward-compatible: a future spec can split the prompt into fenced sections and parse them back.
- **Personality** maps to a NEW `personality jsonb DEFAULT '{}'::jsonb NOT NULL` column on `agents`. Shape: `{ traits: string[]; tone: string; description: string; enabled: boolean }`. Same migration as the projects fields above — single migration file for the whole build.

**Updated migration (single file in C1):**

```sql
-- server/db/migrations/<NNNN>_consolidation_build_schema_additions.sql
ALTER TABLE agents ADD COLUMN personality jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE projects ADD COLUMN objective text;
ALTER TABLE projects ADD COLUMN linked_agent_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN migrated_from_goals_at timestamptz;
CREATE INDEX projects_linked_agent_ids_gin ON projects USING gin (linked_agent_ids);
```

**Migration safety assumptions (F5).**
- **PostgreSQL ≥ 11 is assumed.** PG 11+ supports the "fast-default" path for `ADD COLUMN ... NOT NULL DEFAULT <constant>` — the default is stored as table metadata and existing rows are NOT rewritten. The same migration on PG ≤ 10 would rewrite the entire `agents` and `projects` tables, taking an `ACCESS EXCLUSIVE` lock for the duration of the rewrite. This repo's production runtime is PG ≥ 14 (verify via `references/architecture.md` / Replit-bundled Postgres before rolling out); migration is safe.
- **Volatility check:** `'{}'::jsonb` and `'{}'` (uuid[]) and `null` (timestamptz) are constant defaults — fast-default eligible. Any future migration MUST use a constant default for `ADD COLUMN ... NOT NULL` to retain this property; a `DEFAULT now()` or function default forces a table rewrite.
- **Rollback plan.** Each statement is independently reversible via `ALTER TABLE ... DROP COLUMN ...` (and `DROP INDEX projects_linked_agent_ids_gin`). The migration is additive and does NOT depend on data being present in the new columns — production rollback is a single-statement-per-line down migration. Drizzle generates the down migration automatically; verify the down file before commit.
- **Future large-table migrations** in this repo MUST avoid rewrite-risk defaults (e.g. `DEFAULT now()`, `DEFAULT gen_random_uuid()`) when adding NOT NULL columns. Prefer a three-step migration: (1) add nullable column, (2) backfill in batches, (3) `SET NOT NULL` after backfill completes. Documented as a deferred-policy item in `KNOWLEDGE.md` if the inventory pass surfaces a counter-example.

Service-tier reads + writes round-trip the JSON. The Drizzle schema file declares `personality: jsonb('personality').$type<AgentPersonality>().notNull().default(sql\`'{}'::jsonb\`)`. `shared/types/build.ts` declares the `AgentPersonality` interface as the SoT.

### Patterns applied

- **Adapter pattern (Q2)** — `toApiProject` / `fromApiPatch` adapt internal column names to public spec contract names in one place.
- **Pure-function extraction (Q1, Q6)** — `computeAgentEtag`, `canonicalStringify`, `diffByIdentityKey` — all colocated `*Pure.ts` siblings with `*Pure.test.ts` tests.
- **Single source of truth (Q5)** — top-level routes resolve subaccount internally; existing per-subaccount routes remain authoritative for their existing consumers.
- **Composition over inheritance (C6)** — AgentEditPage composes 8 tab components rather than a tab class hierarchy.

### Patterns deliberately not applied

- **No new state-management library on AgentEditPage.** React Query caches `GET /:id/full`; tab components are controlled (state lifted to AgentEditPage) so the Discard button can revert all dirty tabs in one operation.
- **No event sourcing on agent edits.** `agent_prompt_revisions` already handles prompt history; this build does not extend it.
- **No new cross-cutting frontend primitive.** Every primitive consumed (PageShell, FormFooter, Modal, Drawer, SortableTable, SearchBox, EmptyState, ErrorState, WorkspaceBadge, ViewModeSwitcher, useViewMode) is shipped by foundation.

---

## 4. Pre-existing violation handling

Static reasoning identifies these pre-existing patterns the build interacts with:

1. **`server/routes/agents.ts` already exceeds the ~200-line guideline** (currently ~297 lines). The chunk additions for tab-scoped PATCH/PUT routes will push it further. **Decision:** split into `server/routes/agents.ts` (CRUD + list + the existing endpoints) and `server/routes/agents/agentTabs.ts` (the new tab-scoped PATCH/PUT + GET /:id/full). The split lives in C1 and matches `architecture.md` "one file per domain, max ~200 lines".
2. **`server/routes/projects.ts` accesses `db` directly** (violates "routes call services only"). Refactored in C4 by introducing `server/services/projectService.ts` and delegating from the route handlers.
3. **`server/db/schema/projects.ts`** uses `budgetCents` / `repoUrl` field names. These are not violations; the spec's renamed contract is added at the service tier (Q2 above). Leave the schema names alone.
4. **`testRunIdempotency.ts` 10s bucket** vs spec's stated 24-hour TTL — flagged in Q4. The plan adopts the existing implementation; the spec wording is a directional follow-up, not a violation.
5. **No backend `behaviour` or `personality` columns exist** on `agents` table (only `masterPrompt` + `additionalPrompt`). Spec §4.2 names a `behaviour` and `personality` shape on the agent. See Q-supplement.

If C1's typecheck or lint reports a pre-existing issue outside this list, the chunk fixes it in-place if directly tied to the change, or flags it in the PR description with the line "pre-existing, not introduced by this chunk."

CI is the authoritative gate runner for any pre-existing baseline violation.

---

## 5. Stepwise implementation plan

Thirteen chunks, ordered for forward-only dependencies. C1-C5b are backend; C6-C10 are frontend; C11 closes doc-sync.

| # | Chunk | Files (approx) | Depends on |
|---|---|---|---|
| C1 | Agent edit backend: GET /:id/full + tab-scoped PATCH/PUT + ETag + schema migration | ~12 | — |
| C2 | Agent test-run async contract | 3 | C1 |
| C3 | Recurring tasks aggregator service + route | 4 | — |
| C3b | `formatFireCondition()` pure helper + tests | 2 | C3 |
| C4 | `PATCH /api/projects/:id` + linkedAgents + objective | 3 | C1 (shared migration) |
| C5 | `shared/types/build.ts` + frontend API client wrappers | 3 | C1, C2, C3, C4 |
| C5b | Agent list response: `agentRevisionCount` | 2 | C1 |
| C6 | AgentEditPage shell + 8 tabs + TestRunnerCard + picker modals | ~18 | C5 |
| C7 | AgentsListPage with SortableTable + view-mode awareness | 2 | C5, C5b |
| C8 | RecurringTasksPage with SortableTable + filters | 2 | C3, C5 |
| C9 | ProjectEditPage with FormFooter + Goals migration banner | 3 | C5 |
| C10 | Sidebar + router wiring + retire legacy admin/skill pages | ~12 | C6, C7, C8, C9 |
| C11 | Doc-sync (architecture.md, capabilities.md, retired-page references) | 3 | All |

**Dependency graph.** C1 / C3 / C3b / C4 are backend-only and independent (C3b depends on C3; C4 shares a migration file with C1 — see note below). C2 needs C1's `agentEtag.ts` import paths. C5 depends on every backend chunk because it ingests their wire shapes into TypeScript types. C5b is a small extension to C7's input. C6 / C7 / C8 / C9 each depend on C5; C7 also on C5b. C10 depends on every frontend chunk. C11 closes after every other chunk.

**Note on shared migration.** C1 introduces the schema migration file (one file containing ALL three schema additions: `agents.personality`, `projects.objective`, `projects.linked_agent_ids`, `projects.migrated_from_goals_at`). C4 modifies `projects.ts` Drizzle schema declaration and the route file; the migration itself ships in C1 because Drizzle migration order and PR atomicity favour shipping all DDL together. C4 verifies the migration applied before exercising the new columns.

**PR slicing recommendation.** Backend chunks (C1-C5b) ship as one PR; frontend chunks (C6-C10) ship as a second PR; doc-sync (C11) ships in either PR (whichever closes the work).

---

## 6. Per-chunk detail

### Chunk C1 — Agent edit backend: GET /:id/full + tab-scoped writes + ETag + schema migration

**spec_sections:** §4.2 (full agent payload + tab-scoped PATCH/PUT + ETag canonicalisation rules + identity-key safeguard), §6 (permissions, RLS, execution model).

**Logical responsibility:** ship the read-side `GET /:id/full` aggregator, the seven tab-scoped writers, and the ALL-build schema migration. ETag-based concurrency and identity-key-safe full-replacement diff are first-class.

**Files to create:**
- `server/lib/agentEtag.ts` — `computeAgentEtag()` + `canonicalStringify()` (per Q1).
- `server/lib/__tests__/agentEtagPure.test.ts` — colocated tests (lex sort, undefined drop, array order preserved, number normalisation, deterministic across calls, sha256 hex output).
- `server/lib/identityKeyDiff.ts` — `diffByIdentityKey()` (per Q6).
- `server/lib/__tests__/identityKeyDiffPure.test.ts` — tests per Q6.
- `server/middleware/agentEtagPrecondition.ts` — middleware enforcing `If-Match` header presence (returns 428 if missing).
- `server/routes/agents/agentTabs.ts` — NEW route file; tab-scoped PATCH/PUT + GET /:id/full.
- `server/db/migrations/<NNNN>_consolidation_build_schema_additions.sql` — ALL DDL for the build (per Q-supplement).

**Files to modify:**
- `server/db/schema/agents.ts` — add `personality jsonb`.
- `server/db/schema/projects.ts` — add `objective text`, `linkedAgentIds uuid[]`, `migratedFromGoalsAt timestamptz` (Drizzle declarations; the SQL migration ships here in the same chunk).
- `server/services/agentService.ts` — add `getFull(agentId, orgId)`, `patchConfigure(...)`, `patchBehaviour(...)`, `patchPersonality(...)`, `replaceSkills(...)`, `replaceDataSources(...)`, `replaceTriggers(...)`, `patchBudget(...)`. Each method internally re-fetches the full record after write and returns it with the new ETag. Each method takes `expectedEtag` as a service-level argument (not header sniffing — that's the route's job).
- `server/routes/agents.ts` — register the new sub-router from `agentTabs.ts`; KEEP existing endpoints intact.

**Files NOT touched:** `server/services/agentExecutionService.ts` (test-run lives in C2), `server/services/triggerService.ts` (delegated to from `replaceTriggers` but not modified), `server/services/scheduledTaskService.ts`, `server/services/agentRecommendationsService.ts`.

**Contracts (locked from spec §4.2):**

```ts
// shared/types/build.ts (DEFINED HERE; ships in C5 — referenced by service code via forward import)
interface AgentFull {
  id: string;
  etag: string;
  configure: {
    name: string; description: string; roleTitle: string; parentAgentId: string | null;
    model: string; outputSize: 'compact' | 'standard' | 'extended';
    allowSubaccountModelOverride: boolean;
    responseMode: 'balanced' | 'expressive' | 'precise' | 'highly_creative';
  };
  behaviour: { briefingTemplate: string; constraints: string[] };  // mapped to additionalPrompt server-side
  personality: { traits: string[]; tone: string; description: string; enabled: boolean };
  skills: Array<{ id: string; key: string; name: string; configJson: unknown; status: 'enabled' | 'disabled' }>;
  dataSources: Array<{ id: string; kind: string; ref: string; status: 'connected' | 'disconnected' | 'error' }>;
  triggers: Array<{ id: string; kind: 'schedule' | 'event' | 'manual'; spec: unknown; status: 'active' | 'paused' }>;
  budget: { dailyCapUsd: number | null; monthlyCapUsd: number | null; warnThresholdPct: number };
  runs: { last5: AgentRunPreview[]; total30d: number; cost30d: number };
}

interface AgentRunPreview {
  id: string; status: string; startedAt: string; completedAt: string | null;
  durationMs: number | null; costUsd: number;
}
```

**Endpoints registered in `agentTabs.ts`:**

```
GET    /api/agents/:id/full                  [authenticate, requireOrgPermission(AGENTS_VIEW)]
PATCH  /api/agents/:id/configure             [authenticate, AGENTS_EDIT, agentEtagPrecondition]
PATCH  /api/agents/:id/behaviour             [authenticate, AGENTS_EDIT, agentEtagPrecondition]
PATCH  /api/agents/:id/personality           [authenticate, AGENTS_EDIT, agentEtagPrecondition]
PUT    /api/agents/:id/skills?force=         [authenticate, AGENTS_EDIT, agentEtagPrecondition]
PUT    /api/agents/:id/data-sources?force=   [authenticate, AGENTS_EDIT, agentEtagPrecondition]
PUT    /api/agents/:id/triggers?force=       [authenticate, AGENTS_EDIT, agentEtagPrecondition]
PATCH  /api/agents/:id/budget                [authenticate, AGENTS_EDIT, agentEtagPrecondition]
```

System-managed agent guard: every writer checks `agent.isSystemManaged === false || (req.user.role === 'system_admin')`. Throw 403 with `errorCode: 'SYSTEM_AGENT_READ_ONLY'` otherwise.

**Implementation skeleton — writer pattern (Configure):**

```ts
// server/services/agentService.ts (new method)
async patchConfigure(
  agentId: string,
  orgId: string,
  expectedEtag: string,
  patch: AgentConfigurePatch,
  actor: { userId: string; role: string },
): Promise<AgentFull> {
  const current = await this.getFull(agentId, orgId);
  if (current.isSystemManaged && actor.role !== 'system_admin') {
    throw { statusCode: 403, message: 'System agent', errorCode: 'SYSTEM_AGENT_READ_ONLY' };
  }
  if (current.etag !== expectedEtag) {
    throw { statusCode: 409, message: 'Agent changed', errorCode: 'ETAG_MISMATCH', currentEtag: current.etag };
  }
  await db.transaction(async (tx) => {
    await tx.update(agents).set({
      ...(patch.name !== undefined && { name: patch.name.trim() }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.roleTitle !== undefined && { agentTitle: patch.roleTitle }),
      ...(patch.parentAgentId !== undefined && { parentAgentId: patch.parentAgentId }),
      ...(patch.model !== undefined && { modelId: patch.model }),
      ...(patch.outputSize !== undefined && { outputSize: patch.outputSize }),
      ...(patch.allowSubaccountModelOverride !== undefined && { allowModelOverride: patch.allowSubaccountModelOverride }),
      ...(patch.responseMode !== undefined && { responseMode: patch.responseMode }),
      updatedAt: new Date(),
    }).where(and(eq(agents.id, agentId), eq(agents.organisationId, orgId)));
  });
  return this.getFull(agentId, orgId);
}
```

**Full-replacement writer skeleton (skills):**

```ts
async replaceSkills(
  agentId: string, orgId: string, expectedEtag: string,
  incoming: SkillBindingPayload[],
  options: { force: boolean },
  actor: ActorCtx,
): Promise<AgentFull> {
  // ... same ETag + system-managed checks as above ...
  const existing = await skillBindingService.list(agentId, orgId);
  const diff = diffByIdentityKey(existing, incoming, (s) => s.id);
  if (!options.force && diff.silentlyRemoved.length > 0) {
    throw {
      statusCode: 409,
      message: `Refusing to remove ${diff.silentlyRemoved.length} skill(s) without force=true`,
      errorCode: 'IDENTITY_KEY_DELETION_BLOCKED',
      details: { removedIds: diff.silentlyRemoved.map(s => s.id) },
    };
  }
  await db.transaction(async (tx) => {
    for (const s of diff.silentlyRemoved.concat(diff.removed)) { /* delete */ }
    for (const s of diff.added) { /* insert */ }
    for (const s of diff.updated) { /* update */ }
  });
  return this.getFull(agentId, orgId);
}
```

**Error handling:**
- ETag missing in `If-Match` → 428 (middleware).
- ETag mismatch → 409 + `currentEtag` in body.
- Identity-key silent deletion (force=false) → 409 with `IDENTITY_KEY_DELETION_BLOCKED`.
- System-managed agent + non-system-admin → 403 with `SYSTEM_AGENT_READ_ONLY`.
- Unique constraint hits (e.g. agent slug uniqueness on rename) → 409 with `SLUG_CONFLICT` (never bubble 23505 as 500).
- Transaction failure → 500 with the underlying error code.

**Test considerations (mandatory pure-function tests):**

- `agentEtagPure.test.ts` (15+ cases): lex-sort at every nesting level; undefined dropped from objects; array order preserved; numbers like `1.0` and `1` produce the same hash; deterministic across N calls; sha256 output is hex 64 chars.
- `identityKeyDiffPure.test.ts` (10+ cases per Q6).

**Verification commands:**

```
npm run lint
npm run typecheck
npm run build:server
npx tsx server/lib/__tests__/agentEtagPure.test.ts
npx tsx server/lib/__tests__/identityKeyDiffPure.test.ts
```

**Acceptance criteria:**
- Migration applies cleanly via `npm run db:generate` (verify file shape; do not push).
- `GET /api/agents/:id/full` returns the AgentFull shape with a non-empty `etag`.
- Each tab-scoped writer rejects missing `If-Match` (428) and stale `If-Match` (409 with `currentEtag` in body).
- `PUT /skills` without `force=true` rejects deletions; with `force=true` applies them.
- `npx tsx` passes both pure tests.

**Estimated effort:** 1.5 builder-days.

---

### Chunk C2 — Agent test-run async contract

**spec_sections:** §4.3 (async 202 + poll), §4.7 (in-flight guard — frontend, NOT this chunk).

**Logical responsibility:** convert `POST /api/agents/:id/test-run` (synchronous 201) into `POST /api/agents/:id/test` (async 202), and surface a `GET /api/agent-runs/:runId?shape=test` projection that emits the `AgentTestResult` shape.

**Files to create:**
- `server/services/agentTestRunMapperPure.ts` — pure mapper from `agent_runs` row → `AgentTestResult`.
- `server/services/__tests__/agentTestRunMapperPure.test.ts` — colocated tests.

**Files to modify:**
- `server/routes/agents.ts` — ADD route handler at `/api/agents/:id/test` (the new spec path). Keep the legacy `/api/agents/:id/test-run` handler for one release as an internal-delegating compatibility shim that emits a `Deprecation` response header + WARN log line on every call (per Q4 F7). DO NOT use a 308 redirect — POST body replay across redirects is not universally honoured.
- `server/services/agentExecutionService.ts` — add `startRunAsync(input): Promise<{ runId, status }>`. The body builds the run row, returns it, and detaches the LLM loop via the existing internal mechanism (existing `executeRun` flow continues in the background).
- `server/routes/agentRuns.ts` — extend `GET /api/agent-runs/:runId` with an optional `?shape=test` query that triggers the AgentTestResult projection. The base shape is unchanged for existing consumers.

**Files NOT touched:** `server/lib/testRunIdempotency.ts` (existing dual-bucket retained), `server/lib/inboundRateLimiter.ts`.

**Contracts (locked from spec §4.3):**

```ts
// POST request body:
interface AgentTestRequest {
  input: string;                  // textarea content
  workspaceContextId: string;     // active client/sub-account
  idempotencyKey: string;         // client UUID
}

// 202 response:
interface AgentTestAccepted { runId: string; status: 'running'; }

// Poll response (GET /api/agent-runs/:runId?shape=test):
interface AgentTestResult {
  runId: string;
  status: 'running' | 'completed' | 'failed';
  durationMs: number | null;
  resultPreview: string | null;       // first 200 chars of last assistant message
  traceUrl: string | null;            // `/run-trace/${runId}` once the run has started
}
```

**Implementation skeleton:**

```ts
// route handler (post-rename):
router.post('/api/agents/:id/test',
  authenticate, requireOrgPermission(AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { input, workspaceContextId, idempotencyKey } = req.body;
    const limitResult = await rateLimitCheck(rateLimitKeys.testRun(req.user!.id), TEST_RUN_RATE_LIMIT_PER_HOUR, 3600);
    if (!limitResult.allowed) {
      setRateLimitDeniedHeaders(res, limitResult.resetAt, limitResult.nowEpochMs);
      res.status(429).json({ error: '...' });
      return;
    }
    const orgSa = await orgSubaccountService.requireOrgSubaccount(req.orgId!);
    const saLink = await subaccountAgentService.getLinkByAgentInSubaccount(req.orgId!, orgSa.id, req.params.id);
    if (!saLink) { res.status(404).json({ error: 'No subaccount link' }); return; }

    const [currentKey, previousKey] = deriveTestRunIdempotencyCandidates({
      userId: req.user!.id, targetType: 'agent', targetId: req.params.id,
      input: { prompt: input ?? null, inputJson: null }, clientKeyHint: idempotencyKey,
    });
    const run = await agentExecutionService.startRunAsync({
      agentId: req.params.id, organisationId: req.orgId!,
      subaccountId: orgSa.id, subaccountAgentId: saLink.id,
      isTestRun: true, userId: req.user!.id,
      triggerContext: { triggeredBy: req.user!.id, source: 'test_panel', isTestRun: true, prompt: input },
      idempotencyKey: currentKey,
      idempotencyCandidateKeys: [currentKey, previousKey],
    });
    res.status(202).json({ runId: run.id, status: 'running' });
  })
);
```

**Error handling:**
- Rate-limit hit → 429 (existing behaviour, unchanged).
- Idempotency hit (same key, prior run still in flight or terminal) → 200 with the existing run's status (NOT 202; spec §4.3 explicitly says "Re-submitting the same idempotencyKey within its scope returns 200 with the existing run's current state").
- Subaccount not resolved → 404.

**Test considerations (mandatory pure-function tests):**

`agentTestRunMapperPure.test.ts`:
- in-flight run → `status: 'running'`, `durationMs: null`, `resultPreview: null`, `traceUrl: null`.
- Completed run → terminal status, `durationMs` computed from `completedAt - startedAt`, `resultPreview` is first 200 chars of `output`, `traceUrl` is `/run-trace/${runId}`.
- Failed run → `status: 'failed'`, `durationMs` computed if `completedAt` set, `resultPreview` is the failure reason.
- Edge cases: missing `output`, missing `startedAt` (defensive null).

**Verification commands:**

```
npm run lint
npm run typecheck
npm run build:server
npx tsx server/services/__tests__/agentTestRunMapperPure.test.ts
```

**Acceptance criteria:**
- `POST /api/agents/:id/test` returns 202 with `{ runId, status: 'running' }`.
- `POST /api/agents/:id/test-run` (legacy path) internally delegates to the same implementation — returns 202 with identical response shape, **not** a 308 redirect; response carries `Deprecation: true` + `Sunset` headers; a WARN log line fires with `deprecated_test_run_path`.
- `GET /api/agent-runs/:runId?shape=test` returns the spec's `AgentTestResult` shape.
- Idempotent re-submit returns 200 with the existing run.

**Estimated effort:** 0.5 builder-days.

---

### Chunk C3 — Recurring tasks aggregator service + route

**spec_sections:** §4.4 (RecurringTask shape, source precedence, identity-key dedupe rules).

**Logical responsibility:** ship a read-only aggregator over `agent_triggers` + `scheduled_tasks` + manual run history, exposing the spec §4.4 shape.

**Files to create:**
- `server/services/recurringTasksService.ts` — impure (Drizzle).
- `server/services/recurringTasksServicePure.ts` — pure: union projection helpers, sort comparator with id-DESC tiebreaker, cursor encode/decode. (`formatFireCondition` is a stub here; full implementation in C3b.)
- `server/services/__tests__/recurringTasksServicePure.test.ts` — colocated tests.
- `server/routes/recurringTasks.ts` — `GET /api/recurring-tasks` route.

**Files to modify:**
- `server/index.ts` — mount the new route file.

**Contracts (locked from spec §4.4):**

```ts
interface RecurringTask {
  id: string;
  name: string;
  fireKind: 'schedule' | 'event' | 'manual';
  fireCondition: string;
  action: string;
  scope: { kind: 'workspace' | 'org'; id: string; name: string };
  project: { id: string; name: string } | null;
  status: 'active' | 'paused' | 'error';
  lastFiredAt: string | null;
  fires30d: number;
  nextFireAt: string | null;
}

interface RecurringTasksResponse {
  rows: RecurringTask[];
  cursor: string | null;
  filterOptions: Record<string, Array<{ value: string; label: string }>>;
}

interface RecurringTasksQuery {
  scope?: 'workspace' | 'org' | 'system';
  fireKind?: ('schedule' | 'event' | 'manual')[];
  status?: ('active' | 'paused' | 'error')[];
  agent?: string[]; project?: string[];
  q?: string;                                              // free-text search (Spec §4.8)
  cursor?: string; limit?: number;
  sortKey?: 'name' | 'fireCondition' | 'action' | 'scope' | 'project' | 'status' | 'lastFired' | 'fires30d' | 'nextFire';
  sortDir?: 'asc' | 'desc';
}
```

**Implementation skeleton:**

```ts
export const recurringTasksService = {
  async list(orgId: string, query: RecurringTasksQuery): Promise<RecurringTasksResponse> {
    const triggers = await db.select().from(agentTriggers)
      .where(and(eq(agentTriggers.organisationId, orgId), isNull(agentTriggers.deletedAt)));
    const scheduled = await db.select().from(scheduledTasks)
      .where(eq(scheduledTasks.organisationId, orgId));
    const manualRuns = await db.select().from(agentRuns)
      .where(and(eq(agentRuns.organisationId, orgId), eq(agentRuns.runType, 'manual'),
        gte(agentRuns.startedAt, thirtyDaysAgo())));

    const agentsMap = await loadAgentsMap(orgId);
    const projectsMap = await loadProjectsMap(orgId);

    const rows = unionRecurringTasks({ triggers, scheduled, manualRuns, agents: agentsMap, projects: projectsMap });
    const searched = applySearch(rows, query.q);
    const filtered = applyFilters(searched, query);
    const sorted = applySortWithTiebreaker(filtered, query.sortKey, query.sortDir);
    const { page, nextCursor } = paginate(sorted, query.cursor, query.limit ?? 50);
    // INVARIANT-C3-A (F4): filterOptions are derived post-search, pre-pagination, excluding the
    // self-filter dimension. Each dimension's options are computed against the row set with EVERY
    // OTHER active filter applied but NOT the dimension itself — so toggling a filter doesn't
    // collapse its own options to one. Counts displayed alongside each option reflect the visible
    // result set the user is filtering, not the unfiltered universe.
    const filterOptions = buildFilterOptions(searched, query);

    return { rows: page, cursor: nextCursor, filterOptions };
  },
};
```

**Pure helper signatures (in `recurringTasksServicePure.ts`):**

```ts
export function unionRecurringTasks(input: {
  triggers: AgentTrigger[]; scheduled: ScheduledTask[]; manualRuns: AgentRun[];
  agents: Map<string, { id: string; name: string }>; projects: Map<string, { id: string; name: string }>;
}): RecurringTask[];
// INVARIANT-C3-B (F10): trigger rows take precedence over scheduled-task rows ONLY when both
// reference the SAME UNDERLYING TRIGGER ENTITY — not merely the same agent. The dedupe key for
// trigger/scheduled deduplication is `(triggerEntityId)` where `triggerEntityId` is the
// `agent_triggers.id` for trigger rows and the `scheduled_tasks.triggerId` (FK back to the same
// trigger) for scheduled rows. If a scheduled row has no `triggerId` (standalone schedule), it
// emits a separate row even when an unrelated trigger exists for the same agent.
// Manual run rows are NEVER deduplicated against trigger/scheduled rows.
// Unique key for manual rows: `(agentId + runId)`.

export function applySortWithTiebreaker(
  rows: RecurringTask[], sortKey: SortKey | undefined, dir: 'asc' | 'desc',
): RecurringTask[];
// Sort by sortKey THEN by id DESC tiebreaker. Default sort: nextFireAt DESC, id DESC.
// `id DESC` tiebreaker is mandatory per Spec §4.4 pagination invariant.
//
// INVARIANT-C3-C (F3): null ordering is locked. Without this, page boundaries drift and cursor
// pagination produces duplicate or skipped rows.
//   - dir === 'asc'  → null sorts LAST (treated as +∞ sentinel for comparisons).
//   - dir === 'desc' → null sorts LAST (treated as +∞ sentinel; nulls always trail real values).
//   - cursor encode/decode treats null sortValue as the literal string `" NULL "`
//     (prefix-non-collidable with any real string) so a cursor pointing at a null-row tail is
//     stable across encoding round-trips.
// Affected dimensions: nextFireAt, lastFiredAt, project (string|null), scope (string|null).

export function encodeCursor(row: RecurringTask, sortKey: SortKey, dir: 'asc' | 'desc'): string;
export function decodeCursor(cursor: string): { sortValue: unknown; id: string };
// Cursor is base64url-encoded JSON `{ v: 1, k: sortKey, d: dir, s: sortValue, i: id }`. Mismatch
// between decoded `k`/`d` and current query throws 400 (cursor was issued for a different sort).
//
// O1 — Literal encoding example (prevents future incompatible cursor implementations):
//   Input : row.nextFireAt = "2026-05-07T12:00:00Z", row.id = "3fa85f64-...", sortKey = "nextFire", dir = "asc"
//   JSON  : {"v":1,"k":"nextFire","d":"asc","s":"2026-05-07T12:00:00Z","i":"3fa85f64-..."}
//   Cursor: base64url of the above string, no padding
//
//   For a null sortValue:
//   JSON  : {"v":1,"k":"nextFire","d":"asc","s":null,"i":"3fa85f64-..."}
//   Cursor: base64url of the above string
//   Decode: treats `s: null` as the null sentinel (sorts last regardless of dir).
//
// Version field `v` is included to allow a clean format migration if the schema needs to change.
// Cursors issued under v1 are rejected by a future v2 decoder with 400 rather than silent misparse.

export function buildFilterOptions(
  rows: RecurringTask[],
  query: RecurringTasksQuery,
): Record<string, Array<{ value: string; label: string; count: number }>>;
// INVARIANT-C3-A (F4): each dimension's options are computed against `rows` filtered by every
// OTHER active dimension in `query` but NOT this dimension itself (faceted-filter semantics).
// `count` reflects the row count post-search, post-other-filters. Matches the codebase's existing
// faceted-filter pattern (consolidation-operate review SoT). Tests assert: toggling fireKind
// does not collapse the fireKind option set; toggling status updates fireKind counts but not
// status counts.

export function applySearch(rows: RecurringTask[], q: string | undefined): RecurringTask[];
// Spec §4.8: case-insensitive substring match against `name + fireCondition + action`.
// Empty/undefined q is identity.

export function formatFireCondition(triggerOrSchedule: TriggerOrSchedule): string;
// Stub here; full implementation + tests in C3b.
```

**Error handling:**
- Bad cursor (decode failure) → 400.
- Bad sortKey → 400.
- No `req.orgId` → 401 (handled upstream by `authenticate`).

**Test considerations (mandatory pure-function tests):**
- `unionRecurringTasks` — no-deduplication of manual against trigger; trigger takes precedence over scheduled **only when both reference the same trigger entity** (F10) — same-agent-different-trigger does NOT dedupe; standalone-scheduled-with-null-triggerId emits a separate row alongside an unrelated trigger for the same agent; agent name lookup falls back to "Unknown agent" when missing.
- `applySortWithTiebreaker` — equal primary keys → sort by id DESC; sort flip preserves stability; **null sorts last in both directions (F3)** for nextFireAt, lastFiredAt, project, scope.
- `encodeCursor` / `decodeCursor` — round-trip with non-null sortValue; round-trip with null sortValue (uses `" NULL "` sentinel); cursor issued for `(nextFire, asc)` rejected when query is `(nextFire, desc)` (mismatch → 400); corrupt input throws.
- `buildFilterOptions` — faceted-filter semantics (F4): with `{ fireKind: ['schedule'], status: ['active'] }`, the `fireKind` options are computed against the row set filtered by `status === 'active'` only; the `status` options are computed against the row set filtered by `fireKind === 'schedule'` only; counts reflect post-search filtered visibility.
- `applySearch` — case-insensitive substring match against `name + fireCondition + action`; empty `q` is identity.

**Verification commands:**

```
npm run lint
npm run typecheck
npm run build:server
npx tsx server/services/__tests__/recurringTasksServicePure.test.ts
```

**Acceptance criteria:**
- `GET /api/recurring-tasks?scope=workspace` returns the spec shape with a non-empty `rows` array (when there are triggers/schedules in the test fixture).
- Filter by `fireKind=manual` excludes triggers and schedules.
- Sort by `nextFire,asc` returns rows ordered by `nextFireAt` ascending, with `null` last and id-DESC tiebreaker.
- Pagination cursor round-trips: page 1 → page 2 → page 1 with the same query.

**Estimated effort:** 1 builder-day.

---

### Chunk C3b — `formatFireCondition()` pure helper + tests

**spec_sections:** §4.9 (RRULE / fire-condition human-readable preview).

**Logical responsibility:** turn an RRULE string + timezone (or an event filter, or "manual") into a deterministic English string per spec §4.9 formatting contract.

**Files to modify:**
- `server/services/recurringTasksServicePure.ts` — replace the stub with the full implementation.
- `server/services/__tests__/recurringTasksServicePure.test.ts` — add `formatFireCondition` cases.

**Contract (locked from spec §4.9):**

```ts
export function formatFireCondition(input:
  | { kind: 'schedule'; rrule: string; timezone: string; scheduleTime: string }
  | { kind: 'event'; eventType: string; eventFilter: Record<string, unknown> }
  | { kind: 'manual' }
): string;

// Output rules:
// - All times rendered in UTC.
// - Deterministic for identical input.
// - No localisation (UTC only).
// - Max output length 80 chars (truncate with ellipsis if longer).

// Examples:
//   { kind: 'schedule', rrule: 'FREQ=DAILY', timezone: 'UTC', scheduleTime: '09:00' } → 'Daily 9am UTC'
//   { kind: 'schedule', rrule: 'FREQ=WEEKLY;BYDAY=MO', timezone: 'UTC', scheduleTime: '08:00' } → 'Weekly Mon 8am UTC'
//   { kind: 'schedule', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', timezone: 'UTC', scheduleTime: '00:00' } → 'Monthly 1st 00:00 UTC'
//   { kind: 'schedule', rrule: 'FREQ=HOURLY' } → 'Hourly'
//   { kind: 'schedule', rrule: 'FREQ=MINUTELY;INTERVAL=15' } → 'Every 15 minutes'
//   { kind: 'event', eventType: 'task_created', eventFilter: {} } → 'On task_created'
//   { kind: 'event', eventType: 'hubspot.contact.created' } → 'On hubspot.contact.created'
//   { kind: 'manual' } → 'Manual run'
```

**Implementation note.** No `rrule` library dependency — the existing rrule strings in the codebase use a small subset (FREQ + BYDAY + BYMONTHDAY + INTERVAL, with scheduleTime parsed separately). Hand-rolled parser ~80 lines. Unknown rrule patterns fall back to a literal echo of the rrule string truncated to 80 chars.

**Tests (mandatory):** the 5+ examples above plus edge cases (BYDAY=MO,TU,WE → 'Weekly Mon, Tue, Wed 8am UTC'; INTERVAL=2 + DAILY → 'Every 2 days 9am UTC'; unknown FREQ → fallback truncated; empty eventType → 'On unknown event'; eventFilter populated → ignored in the string per spec).

**Verification commands:**

```
npm run lint
npm run typecheck
npm run build:server
npx tsx server/services/__tests__/recurringTasksServicePure.test.ts
```

**Acceptance criteria:** the spec-named examples produce the spec-named output; deterministic across N invocations.

**Estimated effort:** 0.5 builder-days.

---

### Chunk C4 — `PATCH /api/projects/:id` field expansion + linkedAgents

**spec_sections:** §4.5 (project edit fields), §6 (PATCH semantics).

**Logical responsibility:** add a top-level `PATCH /api/projects/:id` that accepts the spec-named fields, with explicit-null-clear semantics, and delegate to a new `projectService`.

**Files to create:**
- `server/services/projectService.ts` — promotes the inline DB calls in `server/routes/projects.ts` into a service. Includes `toApiProject(row)` and `fromApiPatch(body)` mappers (per Q2). Architecture rule: routes call services only.
- `server/services/__tests__/projectServicePure.test.ts` — colocated tests for the mappers (round-trip `budgetUsd ↔ budgetCents`, null-clear semantics, omit-is-no-op).

**Files to modify:**
- `server/routes/projects.ts` — refactor existing handlers to delegate to `projectService`. Add new top-level `GET /api/projects/:id` and `PATCH /api/projects/:id` (per spec §4.5). Existing `/api/subaccounts/:subaccountId/projects/:projectId` paths kept for backward compatibility, also delegating to the service.

**Files NOT touched:** other consumers of `projects` table (e.g. `pageProjects.ts`, `projectDetail` consumers).

**Contracts (locked from spec §4.5):**

```ts
interface ProjectPatch {
  name?: string;
  color?: string;
  description?: string;
  status?: 'active' | 'paused' | 'archived';
  objective?: string | null;
  targetDate?: string | null;          // null clears
  budgetUsd?: number | null;
  budgetWarnThresholdPct?: number;
  repositoryUrl?: string | null;
  linkedAgents?: string[];             // FULL replacement (no diff)
}

interface ApiProject {
  id: string;
  organisationId: string;
  subaccountId: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'archived';
  color: string;
  objective: string | null;
  targetDate: string | null;
  budgetUsd: number | null;
  budgetWarnThresholdPct: number;
  repositoryUrl: string | null;
  linkedAgents: string[];
  migratedFromGoalsAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

**Permissions:** existing `requireOrgPermission` keys; no new permission keys per Spec §6.

**Implementation skeleton:**

```ts
// server/services/projectService.ts
export const projectService = {
  async getById(orgId: string, projectId: string): Promise<ApiProject> {
    const [row] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organisationId, orgId), isNull(projects.deletedAt)));
    if (!row) throw { statusCode: 404, message: 'Project not found' };
    return toApiProject(row);
  },

  async patch(orgId: string, projectId: string, body: ProjectPatch): Promise<ApiProject> {
    const updates = fromApiPatch(body);
    if (body.linkedAgents !== undefined) {
      // Validate all linkedAgents belong to this org.
      const validIds = await db.select({ id: agents.id }).from(agents)
        .where(and(eq(agents.organisationId, orgId), inArray(agents.id, body.linkedAgents), isNull(agents.deletedAt)));
      const validSet = new Set(validIds.map(r => r.id));
      const missing = body.linkedAgents.filter(id => !validSet.has(id));
      if (missing.length > 0) {
        throw { statusCode: 422, message: 'Unknown agent(s)', errorCode: 'INVALID_LINKED_AGENT', details: { missing } };
      }
    }
    const [row] = await db.update(projects).set({ ...updates, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.organisationId, orgId), isNull(projects.deletedAt)))
      .returning();
    if (!row) throw { statusCode: 404, message: 'Project not found' };
    return toApiProject(row);
  },
};

// Pure mapper:
export function fromApiPatch(body: ProjectPatch): Partial<typeof projects.$inferInsert> {
  const updates: Partial<typeof projects.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.description !== undefined) updates.description = body.description ?? null;
  if (body.status !== undefined) updates.status = body.status;
  if (body.color !== undefined) updates.color = body.color;
  if (body.objective !== undefined) updates.objective = body.objective ?? null;
  if (body.targetDate !== undefined) updates.targetDate = body.targetDate === null ? null : new Date(body.targetDate);
  if (body.budgetUsd !== undefined) updates.budgetCents = body.budgetUsd === null ? null : Math.round(body.budgetUsd * 100);
  if (body.budgetWarnThresholdPct !== undefined) updates.budgetWarningPercent = body.budgetWarnThresholdPct;
  if (body.repositoryUrl !== undefined) updates.repoUrl = body.repositoryUrl;
  if (body.linkedAgents !== undefined) updates.linkedAgentIds = body.linkedAgents;
  return updates;
}
```

**Error handling:**
- `budgetUsd` < 0 or non-finite → 400 (zod).
- Unknown field in body → 400 (zod `.strict()`).
- `linkedAgents` contains an agent UUID not in this org → 422 with `INVALID_LINKED_AGENT`.

**Test considerations:**
`projectServicePure.test.ts`:
- `fromApiPatch` round-trips every field.
- `budgetUsd: 0` → `budgetCents: 0` (not null).
- `targetDate: null` → DB null.
- Missing field → no key in output object.
- `linkedAgents: []` → `linkedAgentIds: []` (clears the array).

**Verification commands:**

```
npm run lint
npm run typecheck
npm run build:server
npx tsx server/services/__tests__/projectServicePure.test.ts
```

**Acceptance criteria:**
- `PATCH /api/projects/:id` with `{ budgetUsd: 5000 }` writes `budget_cents = 500000`.
- `PATCH /api/projects/:id` with `{ targetDate: null }` clears the date.
- `PATCH /api/projects/:id` with `{ budgetUsd: -1 }` returns 400.
- `GET /api/projects/:id` returns `linkedAgents: string[]` (always an array, never null).

**Estimated effort:** 0.5 builder-days.

---

### Chunk C5 — `shared/types/build.ts` + frontend API client wrappers

**spec_sections:** §4.1, §4.2, §4.3, §4.4, §4.5, §4.10.

**Logical responsibility:** declare the wire types in `shared/types/build.ts` and ship typed API client helpers under `client/src/lib/api/build.ts`.

**Files to create:**
- `shared/types/build.ts` — `AgentListItem`, `AgentFull`, `AgentRunPreview`, `AgentTestRequest`, `AgentTestAccepted`, `AgentTestResult`, `RecurringTask`, `RecurringTasksQuery`, `RecurringTasksResponse`, `ApiProject`, `ProjectPatch`, `AgentPersonality`. Single source of truth for build-stream wire shapes.
- `client/src/lib/api/build.ts` — typed wrappers around `api.get/post/patch/put` for every endpoint introduced in C1-C4. Includes ETag handling: every writer accepts `ifMatch: string` and includes it as `If-Match` header; on 409, the response body's `currentEtag` is surfaced as a typed `EtagMismatchError`.

**Files NOT touched:** existing API client wrappers (`client/src/lib/api.ts` keeps its low-level helpers).

**Implementation note.** `shared/types/` is the existing convention for cross-tier types (see `shared/runStatus.ts`). Build module follows that pattern.

**Wrapper sketch:**

```ts
// client/src/lib/api/build.ts
import api from '../api';
import type { AgentFull, ProjectPatch, RecurringTasksQuery } from '../../../../shared/types/build';

// F11: wrap the full 409 response payload, not just currentEtag, so callers can render
// richer banners later (conflicting actor, updatedAt, changed fields) without another
// API surface bump. Today only `currentEtag` is consumed; the rest is forward-compatible.
export interface EtagMismatchPayload {
  errorCode: 'ETAG_MISMATCH';
  currentEtag: string;
  // Reserved for future server emission — fields below are optional and ignored if absent:
  conflictingActor?: { id: string; name: string } | null;
  updatedAt?: string;
  changedFields?: string[];
  message?: string;
}

export class EtagMismatchError extends Error {
  constructor(public readonly payload: EtagMismatchPayload) {
    super(payload.message ?? 'Agent changed');
  }
  /** Convenience accessor — the field most callers need. */
  get currentEtag(): string { return this.payload.currentEtag; }
}

export const buildApi = {
  async getAgentFull(agentId: string): Promise<AgentFull> {
    const { data } = await api.get<AgentFull>(`/api/agents/${agentId}/full`);
    return data;
  },
  async patchAgentConfigure(agentId: string, body: AgentConfigurePatch, ifMatch: string): Promise<AgentFull> {
    try {
      const { data } = await api.patch<AgentFull>(`/api/agents/${agentId}/configure`, body, {
        headers: { 'If-Match': ifMatch },
      });
      return data;
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409 && err.response.data?.errorCode === 'ETAG_MISMATCH') {
        throw new EtagMismatchError(err.response.data as EtagMismatchPayload);
      }
      throw err;
    }
  },
  // ... patchBehaviour, patchPersonality, putSkills, putDataSources, putTriggers, patchBudget
  // ... testRun, getAgentRunForTest
  // ... listAgents, listRecurringTasks
  // ... getProject, patchProject
};
```

**Verification commands:**

```
npm run lint
npm run typecheck
npm run build:client
```

**Acceptance criteria:**
- All build-stream wire types live in `shared/types/build.ts`.
- All endpoints have typed wrappers.
- `EtagMismatchError` carries `currentEtag` for the calling page to use.

**Estimated effort:** 0.5 builder-days.

---

### Chunk C5b — Agent list response: `agentRevisionCount`

**spec_sections:** §4.10 (Agent versioning indicator).

**Logical responsibility:** extend `GET /api/agents` to include `agentRevisionCount` from `agent_prompt_revisions`, plus `lastRevisionEditedAt` and `lastRevisionAuthor` for the tooltip.

**Files to modify:**
- `server/services/agentService.ts` — extend `listAgents` and `listAllAgents` return shape with `agentRevisionCount`, `lastRevisionEditedAt`, `lastRevisionAuthor`.
- `shared/types/build.ts` (added in C5) — `AgentListItem` includes `agentRevisionCount: number`, `lastRevisionEditedAt: string | null`, `lastRevisionAuthor: string | null`.

**Implementation skeleton:**

```ts
// In listAllAgents, after the main SELECT:
const revisionStats = await db
  .select({
    agentId: agentPromptRevisions.agentId,
    count: sql<number>`COUNT(*)::int`,
    lastEditedAt: sql<Date>`MAX(${agentPromptRevisions.createdAt})`,
    lastAuthorId: sql<string>`(ARRAY_AGG(${agentPromptRevisions.changedBy} ORDER BY ${agentPromptRevisions.createdAt} DESC))[1]`,
  })
  .from(agentPromptRevisions)
  .where(eq(agentPromptRevisions.organisationId, organisationId))
  .groupBy(agentPromptRevisions.agentId);

const authorIds = revisionStats.map(r => r.lastAuthorId).filter(Boolean);
const authors = authorIds.length > 0
  ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, authorIds))
  : [];
const authorMap = new Map(authors.map(u => [u.id, u.name]));
const revisionMap = new Map(revisionStats.map(r => [r.agentId, r]));

return rows.map((a) => ({
  // ... existing fields ...
  agentRevisionCount: revisionMap.get(a.id)?.count ?? 1,  // fallback per Spec §4.10
  lastRevisionEditedAt: revisionMap.get(a.id)?.lastEditedAt ?? null,
  lastRevisionAuthor: authorMap.get(revisionMap.get(a.id)?.lastAuthorId ?? '') ?? null,
}));
```

**Performance note.** The single GROUP BY + small users-by-IN query is N=2 regardless of agent count. Acceptable for org-tier list pages (typical ≤100 agents). If list pages grow past ~1000 agents this needs revisiting; out of scope.

**INVARIANT-C5b-A — Revision-count fallback (M4).** Agents with zero rows in `agent_prompt_revisions` MUST report `agentRevisionCount: 1`, never `0`. Reason: the agent itself counts as the first revision in user-facing language (the version chip displays `v1` from day one). A zero would be misleading ("this agent has no version") and breaks the chip's increment semantics (`v2` after the first edit, not `v1` after the first edit). Both `listAgents` (org/system scope) and `listAllAgents` (any scope) MUST apply the `?? 1` fallback at the service tier — never at the client. The fallback is enforced inside `agentService` so every consumer (list page, edit page, future API users) sees the same shape. Tested at the service-mapper level; documented in `shared/types/build.ts` JSDoc on `AgentListItem.agentRevisionCount`.

**Verification commands:**

```
npm run lint
npm run typecheck
npm run build:server
```

**Acceptance criteria:**
- `GET /api/agents` returns `agentRevisionCount: number` for every row, default `1` when no revisions exist.
- The N+1 anti-pattern is avoided (two batched queries, not per-agent fetches).

**Estimated effort:** 0.25 builder-days.

---

### Chunk C6 — AgentEditPage shell + 8 tabs + TestRunnerCard + picker modals

**spec_sections:** §4.2, §4.3, §4.6, §4.7, §4.11, §4.12.

**Logical responsibility:** replace 5 legacy admin/skill pages and the SubaccountAgentEditPage's authoring surface with a single tabbed page driven by `GET /:id/full`.

**Files to create:**
- `client/src/pages/build/AgentEditPage.tsx` — page shell, tab routing, ETag round-trip orchestrator, dirty-tab tracking, FormFooter integration.
- `client/src/pages/build/components/AgentEditTabs/ConfigureTab.tsx`
- `client/src/pages/build/components/AgentEditTabs/BehaviourTab.tsx`
- `client/src/pages/build/components/AgentEditTabs/PersonalityTab.tsx`
- `client/src/pages/build/components/AgentEditTabs/SkillsTab.tsx`
- `client/src/pages/build/components/AgentEditTabs/DataSourcesTab.tsx`
- `client/src/pages/build/components/AgentEditTabs/ScheduleTab.tsx`
- `client/src/pages/build/components/AgentEditTabs/BudgetTab.tsx`
- `client/src/pages/build/components/AgentEditTabs/RunsTab.tsx`
- `client/src/pages/build/components/TestRunnerCard.tsx` — inline card per spec §4.7.
- `client/src/pages/build/components/SkillPickerModal.tsx` — `<Modal>` + `<SearchBox>` over the skill registry.
- `client/src/pages/build/components/DataSourcePickerModal.tsx` — `<Modal>` + `<SearchBox>` over connections (cross-stream read; uses Spec C connections endpoint).
- `client/src/pages/build/components/AgentVersionChip.tsx` — small `vN` chip + tooltip via existing `HelpHint`.
- `client/src/pages/build/components/DeleteAgentDialog.tsx` — type-to-confirm wrapper around `<ConfirmDialog>`.

**Files NOT touched in this chunk:**
- Foundation primitives (PageShell, FormFooter, Modal, SearchBox, EmptyState, ErrorState, ConfirmDialog).
- Backend services or routes.

**Tab routing.** The active tab lives in URL state via `?tab=configure|behaviour|personality|skills|data-sources|schedule|budget|runs`. Default `configure`. AgentEditPage reads via `useSearchParams()` and writes back when a tab button is clicked.

**Page shell skeleton:**

```tsx
// client/src/pages/build/AgentEditPage.tsx
export default function AgentEditPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') ?? 'configure') as TabKey;
  const { data, refetch } = useQuery(['agentFull', id], () => buildApi.getAgentFull(id!));

  // Per-tab dirty patches:
  const [pendingPatches, setPendingPatches] = useState<Partial<Record<TabKey, unknown>>>({});
  const dirtyTabs = useMemo(() => new Set(Object.keys(pendingPatches) as TabKey[]), [pendingPatches]);

  const handleSave = useCallback(async () => {
    if (!data) return;
    let etag = data.etag;
    const writeOrder: TabKey[] = ['configure', 'behaviour', 'personality', 'skills', 'data-sources', 'triggers', 'budget'];
    for (const tab of writeOrder) {
      if (!dirtyTabs.has(tab)) continue;
      try {
        const updated = await invokeWriter(tab, id!, pendingPatches[tab]!, etag);
        etag = updated.etag;       // chain to next writer
        setPendingPatches(prev => { const next = { ...prev }; delete next[tab]; return next; });
      } catch (err) {
        if (err instanceof EtagMismatchError) {
          showEtagBanner(err.currentEtag, () => refetch());
          return;                  // stop chain; keep remaining dirty tabs intact
        }
        throw err;
      }
    }
    refetch();
  }, [data, dirtyTabs, pendingPatches, id, refetch]);

  const handleDiscard = useCallback(() => setPendingPatches({}), []);

  // ... rendering ...
}
```

**ETag round-trip pattern.**
- AgentEditPage holds `data.etag` from the latest fetch.
- Each tab writer call passes `ifMatch: data.etag`.
- On 409, the page shows an inline banner with two actions: "Reload" (refetch) and "Cancel".
- Save iterates tabs in this stable order: configure → behaviour → personality → skills → data-sources → triggers → budget. Each writer returns the new ETag; the page's local `etag` updates between writes so the next writer's `If-Match` is correct.
- **Partial-save semantics:** if the chain fails mid-iteration (409 on write 3 of 5), the first two writes are committed and the remaining three remain dirty. The banner explains this. Documented in AgentEditPage's top-of-file comment.

**TestRunnerCard skeleton (Spec §4.7):**

```tsx
export function TestRunnerCard({ agentId }: { agentId: string }) {
  const [input, setInput] = useState('');
  const [workspaceContextId, setWorkspaceContextId] = useState<string>(getActiveClientId() ?? '');
  const [submission, setSubmission] = useState<{ runId: string; idempotencyKey: string } | null>(null);
  const { data: result } = useQuery(
    ['agentTestResult', submission?.runId],
    () => buildApi.getAgentRunForTest(submission!.runId),
    { enabled: submission !== null && (!result || result.status === 'running'), refetchInterval: 1500 },
  );

  // In-flight guard (Spec §4.7): disable Run while submission in flight or polling running.
  const inFlight = submission !== null && result?.status === 'running';

  return (
    <section className="section-card">
      <div className="grid">
        <textarea value={input} onChange={(e) => setInput(e.target.value)} />
        <WorkspaceContextDropdown value={workspaceContextId} onChange={setWorkspaceContextId} />
      </div>
      <div className="action-row">
        <button disabled={inFlight} onClick={async () => {
          const idempotencyKey = crypto.randomUUID();
          const res = await buildApi.testRun(agentId, { input, workspaceContextId, idempotencyKey });
          setSubmission({ runId: res.runId, idempotencyKey });
        }}>Run test</button>
        <span className="meta">{result ? `Last run ${result.status} in ${(result.durationMs ?? 0) / 1000}s` : ''}</span>
        {result?.traceUrl && <a href={result.traceUrl}>View run trace</a>}
      </div>
      {result?.status === 'completed' && <ResultBlock body={result.resultPreview} />}
    </section>
  );
}
```

**Permission gating (Spec §6 frontend gating):**
- `data.isSystemManaged === true && !isSystemAdmin` → hide Save/Discard/Delete; render "System agent (read-only)" label in the header.
- `!isOrgAdmin` → hide Delete agent and Skill remove buttons inside Skills tab.

**Tab-level pure tests.** None — frontend tests are `none_for_now`. The pure portions of TestRunnerCard's polling state (when to disable, when to stop polling) are covered by `agentTestRunMapperPure.ts` (already in C2).

**Verification commands:**

```
npm run lint
npm run typecheck
npm run build:client
```

**Acceptance criteria (visual G2):**
- Open `/agents/:id/edit?tab=configure`: form renders, edits mark Configure tab dirty, Save persists and clears dirty state.
- Switching tabs preserves pending edits (dirty tabs accumulate).
- Discard reverts all dirty tabs.
- ETag mismatch banner appears when a second tab simulates a concurrent write.
- Test runner card runs a sample input and shows result preview + "View run trace" link.
- System-managed agent renders read-only label and hides Save/Delete.

**Estimated effort:** 2 builder-days (largest chunk).

---

### Chunk C7 — AgentsListPage with `<SortableTable>` + view-mode awareness

**spec_sections:** §4.1, §4.10 (version chip), §4.11 (delete confirmation).

**Logical responsibility:** replace `SystemAgentsPage` and `AdminAgentsPage` (existing) with a single view-mode-aware list page.

**Files to create:**
- `client/src/pages/build/AgentsListPage.tsx`.

**Implementation skeleton:**

```tsx
export default function AgentsListPage() {
  const { viewMode } = useViewMode();
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 200);
  const { data: agents, isLoading, error, refetch } = useQuery(
    ['agents', viewMode, debouncedQ],
    () => buildApi.listAgents({ scope: viewMode, q: debouncedQ }),
  );

  const columns: ColumnDef<AgentListItem>[] = [
    { key: 'name', label: 'Name', sortable: true, render: (row) => (
      <span>{row.name} <AgentVersionChip count={row.agentRevisionCount} editedAt={row.lastRevisionEditedAt} author={row.lastRevisionAuthor} /></span>
    ) },
    { key: 'status', label: 'Status', sortable: true, filterable: true,
      getFilterOptions: (rs) => uniq(rs.map(r => ({ value: r.status, label: r.status }))) },
    { key: 'parentAgentName', label: 'Reports to', sortable: true, filterable: true },
    { key: 'subaccount', label: 'Workspace',
      render: (row) => row.subaccount ? <WorkspaceBadge clientId={row.subaccount.id} clientName={row.subaccount.name} /> : null },
    { key: 'lastRunAt', label: 'Last run', sortable: true, render: (row) => formatRelativeTime(row.lastRunAt) },
    { key: 'runs30d', label: 'Runs (30d)', sortable: true, align: 'right' },
    { key: 'cost30d', label: 'Cost (30d)', sortable: true, align: 'right',
      render: (row) => `$${row.cost30d.toFixed(2)}` },
  ];

  if (isLoading) return <PageShell><PageSkeleton /></PageShell>;
  if (error) return <PageShell><ErrorState retry={() => refetch()} /></PageShell>;
  if (!agents || agents.length === 0) return (
    <PageShell><EmptyState title="No agents yet" body="..." primaryAction={{ label: 'Create agent', onClick: ... }} /></PageShell>
  );

  return (
    <PageShell header={<PageHeader title="Agents" actions={<CreateAgentButton />} />}>
      <SearchBox value={q} onChange={setQ} placeholder="Search agents..." />
      <SortableTable
        rows={agents}
        columns={columns}
        rowKey={(r) => r.id}
        persistKey="agents-list"
        onRowClick={(r) => navigate(buildRoute('/agents/:id/edit', { id: r.id }))}
      />
    </PageShell>
  );
}
```

**View-mode behaviour:**
- `viewMode === 'workspace'` → query `?scope=workspace`; result subset is agents linked to the current `activeClientId`.
- `viewMode === 'org'` → `?scope=org`; org-tier agents only.
- `viewMode === 'system'` → `?scope=system`; system-tier agents only (gated by isSystemAdmin in `useViewMode`).

**Verification commands:**

```
npm run lint
npm run typecheck
npm run build:client
```

**Acceptance criteria:**
- ViewModeSwitcher in the foundation Layout sidebar updates the listing.
- Sort by Cost (30d) descending puts highest-cost agents first.
- Filter by Status=paused shows only paused agents.
- Search debounces 200ms and matches name + description + parentAgentName.
- Version chip shows `v1` for an agent with zero revisions (fallback per spec §4.10).
- Empty state shows "No agents yet" with a Create agent action.

**Estimated effort:** 0.75 builder-days.

---

### Chunk C8 — RecurringTasksPage with `<SortableTable>` + filters

**spec_sections:** §4.4, §4.8 (search), §4.9 (fireCondition is server-rendered), §4.11 (pause/resume confirmation).

**Logical responsibility:** ship the new aggregator's UI.

**Files to create:**
- `client/src/pages/build/RecurringTasksPage.tsx`.

**Implementation skeleton.** Mirrors AgentsListPage with these differences:
- Columns: Name, Fire condition, Action, Scope, Project, Status, Last fired, Fires (30d), Next fire.
- Filters: fireKind (schedule/event/manual), status (active/paused/error), scope (workspace/org), agent, project. Each renders a SortableTable filterable column.
- Row action: pause/resume (writes back to the underlying trigger via existing `/api/subaccounts/:subaccountId/triggers/:triggerId` endpoint). Pause confirmation only when `fires30d >= 10` (spec §4.11).
- No row click navigation — recurring tasks are surfaced read-only at this level (the row's name links to the underlying agent edit page or scheduled-task detail).
- `<SearchBox>` debounced 200ms; query parameter `q` matches `name + fireCondition + action` per spec §4.8.

**Cross-stream coupling.** Pause/resume requires the trigger's subaccountId; that's part of the row's `scope.id` field for workspace-scoped triggers. For org-scoped triggers the existing trigger service exposes the org-level write path.

**Implementation sketch:**

```tsx
export default function RecurringTasksPage() {
  const { viewMode } = useViewMode();
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 200);
  const { data, isLoading, error, refetch } = useQuery(
    ['recurringTasks', viewMode, debouncedQ],
    () => buildApi.listRecurringTasks({ scope: viewMode, q: debouncedQ }),
  );

  const columns: ColumnDef<RecurringTask>[] = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'fireCondition', label: 'Fire condition', sortable: true },
    { key: 'action', label: 'Action', sortable: true, filterable: true },
    { key: 'scope', label: 'Scope', filterable: true,
      getValue: (r) => r.scope.name,
      render: (r) => <WorkspaceBadge clientId={r.scope.id} clientName={r.scope.name} variant="inline" /> },
    { key: 'project', label: 'Project', filterable: true,
      getValue: (r) => r.project?.name ?? '',
      render: (r) => r.project ? <span>{r.project.name}</span> : '—' },
    { key: 'status', label: 'Status', sortable: true, filterable: true },
    { key: 'lastFiredAt', label: 'Last fired', sortable: true, render: (r) => formatRelativeTime(r.lastFiredAt) },
    { key: 'fires30d', label: 'Fires (30d)', sortable: true, align: 'right' },
    { key: 'nextFireAt', label: 'Next fire', sortable: true, render: (r) => formatRelativeTime(r.nextFireAt) },
  ];

  // ... empty / error / loading states using foundation primitives ...

  return (
    <PageShell header={<PageHeader title="Recurring tasks" />}>
      <SearchBox value={q} onChange={setQ} placeholder="Search recurring tasks..." />
      <SortableTable rows={data?.rows ?? []} columns={columns} rowKey={(r) => r.id} persistKey="recurring-tasks" />
    </PageShell>
  );
}
```

**Verification commands:**

```
npm run lint
npm run typecheck
npm run build:client
```

**Acceptance criteria:**
- Page shows a unioned list of triggers + scheduled tasks + recent manual runs.
- fireCondition shows the spec's English strings ("Daily 9am UTC", "On hubspot.contact.created", "Manual run").
- Filtering by `fireKind=manual` excludes triggers and schedules.
- Pause confirmation fires only on high-volume tasks (`fires30d >= 10`).

**Estimated effort:** 0.75 builder-days.

---

### Chunk C9 — ProjectEditPage with `<FormFooter>` + Goals migration banner

**spec_sections:** §4.5, §4.6 (FormFooter alignment), §4.11 (delete confirmation).

**Logical responsibility:** ship the consolidated project edit form.

**Files to create:**
- `client/src/pages/build/ProjectEditPage.tsx`.
- `client/src/pages/build/components/DeleteProjectDialog.tsx` — type-to-confirm wrapper around `<ConfirmDialog>` (linked agents count drives type-to-confirm threshold).
- `client/src/pages/build/components/MigratedFromGoalsBanner.tsx` — read-only banner shown when `migratedFromGoalsAt` is set.

**Implementation skeleton:**

```tsx
export default function ProjectEditPage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, refetch } = useQuery(['project', id], () => buildApi.getProject(id!));
  const [dirty, setDirty] = useState<Partial<ProjectPatch>>({});

  if (!project) return null;

  return (
    <PageShell header={<PageHeader title={`Edit ${project.name}`} />} bottomPadding={100}>
      {project.migratedFromGoalsAt && <MigratedFromGoalsBanner migratedAt={project.migratedFromGoalsAt} />}

      <Section title="Identity">
        <Field label="Name"><input value={dirty.name ?? project.name} onChange={(e) => setDirty(d => ({ ...d, name: e.target.value }))} /></Field>
        <Field label="Color"><ColorPicker value={dirty.color ?? project.color} onChange={(c) => setDirty(d => ({ ...d, color: c }))} /></Field>
        <Field label="Description"><textarea value={dirty.description ?? project.description ?? ''} onChange={...} /></Field>
      </Section>

      <Section title="Objective">
        <Field label="Objective" hint="Injected as runtime context to all agent prompts under this project.">
          <textarea value={dirty.objective ?? project.objective ?? ''} onChange={...} />
        </Field>
      </Section>

      <Section title="Project management">
        <Field label="Status">{/* select active / paused / archived */}</Field>
        <Field label="Target date">{/* date input; null clears */}</Field>
        <Field label="Budget (USD)"><input type="number" min="0" step="100" /></Field>
        <Field label="Warn at (% of budget)"><input type="number" min="0" max="100" /></Field>
      </Section>

      <Section title="Linked resources">
        <Field label="Repository URL"><input type="url" /></Field>
        <Field label="Linked agents">
          <AgentMultiSelect value={dirty.linkedAgents ?? project.linkedAgents} onChange={...} />
        </Field>
      </Section>

      <FormFooter>
        <button onClick={() => setDirty({})}>Discard</button>
        <button onClick={async () => {
          await buildApi.patchProject(id!, dirty);
          setDirty({});
          refetch();
        }} disabled={Object.keys(dirty).length === 0}>Save changes</button>
        <button style={{ marginLeft: 'auto' }} onClick={() => /* open DeleteProjectDialog */}>Delete project</button>
      </FormFooter>
    </PageShell>
  );
}
```

**Verification commands:**

```
npm run lint
npm run typecheck
npm run build:client
```

**Acceptance criteria:**
- All spec §4.5 fields editable.
- FormFooter buttons align to the form column edges (verified visually at G2).
- MigratedFromGoals banner renders for projects with `migratedFromGoalsAt` set.
- Delete project shows linked-agent count in the confirmation copy; type-to-confirm fires when count > 0.

**Estimated effort:** 0.75 builder-days.

---

### Chunk C10 — Sidebar + router wiring + retire legacy admin/skill pages

**spec_sections:** §3 audit table (Replace verdicts), §9 (sidebar).

**Logical responsibility:** wire new routes, update sidebar, remove legacy pages from App.tsx, and add 308 redirects from old admin/skill routes to consolidated equivalents.

**Files to modify:**
- `client/src/config/routes.ts` — ADD `/agents/:id/edit`, `/recurring-tasks`, `/projects/:id/edit`. Keep `/agents/:agentId` (singular, for chat) and `/admin/subaccounts/:subaccountId/agents/:agentSubaccountId/manage` (per-link override; out of scope for retirement in this build).
- `client/src/config/sidebar.ts` — per Q7: retarget `agents` row to `/agents`; ADD `recurring-tasks` row; REMOVE `scheduled` row (subsumed by recurring-tasks); REMOVE `triggers` row (subsumed); REMOVE platform `sys-agents` row (consolidated into `/agents` viewMode=system).
- `client/src/config/__tests__/buildNavItems.test.ts` — extend test cases (handed forward from foundation) to assert the new sidebar shape under each user-shape fixture, plus three new shapes (workspace user with no projects/agents; org admin viewing system view; system admin viewing workspace mode of a specific client).
- `client/src/App.tsx` — register routes for `AgentsListPage`, `AgentEditPage`, `RecurringTasksPage`, `ProjectEditPage`. Add redirects from retired routes:
  - `/admin/agents` → `/agents` (status 308)
  - `/admin/agents/:id` → `/agents/:id/edit`
  - `/admin/skills` → `/agents` (skills are now folded in; tab=`skills` after picking an agent)
  - `/admin/skills/:id` → `/agents` (no direct equivalent; surface a one-time toast)
  - `/admin/skill-studio` → `/agents` (toast)
  - `/system/skill-studio` → `/agents` (toast)
  - `/system/skill-analyser` → `/agents` (toast)
  - `/system/agents` → `/agents?scope=system`
  - `/admin/subaccounts/:subaccountId/scheduled-tasks` → `/recurring-tasks?scope=workspace`
  - `/admin/subaccounts/:subaccountId/agents/:linkId/manage` → KEEP (out of scope for retirement)

**Files to delete (definitive — F12):**
- `client/src/pages/AdminAgentEditPage.tsx` (2,110 lines)
- `client/src/pages/AdminAgentsPage.tsx` — replaced by `AgentsListPage`; the App.tsx redirect from `/admin/agents` → `/agents` lands on the new page, so the legacy file has no remaining surface. **Deletion is in scope for C10**, conditional on the search-step pass below finding no internal references. If references exist, the chunk retargets them in the same diff and then deletes; it does NOT defer to a follow-up.
- `client/src/pages/AdminSkillsPage.tsx` (258 lines)
- `client/src/pages/AdminSkillEditPage.tsx` (177 lines)
- `client/src/pages/SkillStudioPage.tsx` (371 lines)
- `client/src/pages/SkillAnalyzerPage.tsx` (169 lines)
- `client/src/pages/SystemAgentsPage.tsx` (325 lines)
- `client/src/pages/ScheduledTasksPage.tsx` (323 lines)
- `client/src/pages/GoalsPage.tsx` (353 lines) — Migrated-from-Goals notice covers this surface.

**Files NOT deleted:**
- `client/src/pages/SubaccountAgentEditPage.tsx` (787 lines) — out of scope per Q5.
- `client/src/pages/AgentChatPage.tsx`, `client/src/pages/SystemAgentEditPage.tsx`, `client/src/pages/SystemSkillsPage.tsx` — kept; chat surface and system-tier authoring are out of scope.

**Search step before deletion (per CLAUDE.md "Surgical Changes"):** grep the entire repo for each deleted-page export name and import path. Any internal reference must be retargeted before delete; if a reference is in test code or docs, retarget or delete the test/doc in the same chunk.

**Pre-deletion inventory pass.** Before deleting `AdminAgentEditPage.tsx` (2,110 lines), the builder produces `tasks/builds/consolidation-build/migration-gaps.md` listing any prop, useEffect, sub-component, or API call that does NOT have a counterpart in the new AgentEditPage. Anything orphaned is reported as PLAN_GAP for architect review before deletion proceeds.

**Verification commands:**

```
npm run lint
npm run typecheck
npm run build:client
npx tsx client/src/config/__tests__/buildNavItems.test.ts
```

**Acceptance criteria:**
- Visiting `/admin/agents` redirects to `/agents`.
- Visiting `/admin/agents/abc-123` redirects to `/agents/abc-123/edit`.
- Sidebar shows Agents / Automations / Recurring tasks under Build.
- Deleted page files are gone; no broken imports.
- buildNavItems test still passes with the new sidebar shape.

**Estimated effort:** 0.75 builder-days.

---

### Chunk C11 — Doc-sync (architecture.md, capabilities.md, retired-page references)

**spec_sections:** §11 self-consistency; CLAUDE.md §11 (Docs Stay In Sync With Code).

**Logical responsibility:** update every reference doc whose content changed.

**Files to modify:**
- `architecture.md` — "Key files per domain" rows: ADD `client/src/pages/build/AgentsListPage.tsx`, `AgentEditPage.tsx`, `RecurringTasksPage.tsx`, `ProjectEditPage.tsx`, `server/routes/agents/agentTabs.ts`, `server/services/recurringTasksService.ts`, `server/services/projectService.ts`, `server/lib/agentEtag.ts`, `server/lib/identityKeyDiff.ts`. REMOVE rows pointing at deleted pages. Update any narrative section that names retired pages by name.
- `docs/capabilities.md` — update consumer-facing capability descriptions naming "Skill Studio" or "Skill Analyzer" (those surfaces are folded into Agent Edit > Skills tab). Editorial rules per `docs/capabilities.md § Editorial Rules`.
- `KNOWLEDGE.md` — append entries ONLY for non-obvious gotchas surfaced during implementation (the chunk does NOT pre-fill; the doc-sync gate decides what's worth recording).
- `docs/decisions/2026-05-07-consolidation-build-page-retirement.md` — NEW ADR recording the decision to retire 9 pages into 4. Template per `docs/decisions/_template.md`.

**Files NOT modified:**
- `DEVELOPMENT_GUIDELINES.md` — no new development discipline rule introduced.
- `docs/spec-context.md` — no testing-posture change.
- `docs/frontend-design-principles.md` — no new principle introduced.
- `docs/integration-reference.md` — no integration behaviour change.
- `references/test-gate-policy.md` — no posture change.

**Verification commands:**

```
npm run lint
npm run typecheck
```

**Acceptance criteria:**
- `architecture.md` "Key files per domain" lists every new file.
- `architecture.md` no longer references retired page names.
- `docs/capabilities.md` updates match retired-page semantics.
- ADR file present at `docs/decisions/2026-05-07-consolidation-build-page-retirement.md`.

**Estimated effort:** 0.25 builder-days.

---

## 7. Risks and mitigations

### R1 — AdminAgentEditPage (2,110 lines) hides behaviours not captured in spec

**Risk:** legacy page may carry undocumented features (specific CTAs, embedded modals, special-case paths for system-managed agents) that disappear in the consolidated AgentEditPage.

**Mitigation:** before deleting `AdminAgentEditPage.tsx` in C10, the builder runs an inventory pass per the C10 description and produces `tasks/builds/consolidation-build/migration-gaps.md`. Anything not represented in spec §4.2 is reported as PLAN_GAP for architect review. Only then is the file deleted.

**Residual risk:** undocumented behaviours discovered post-merge surface in user-reported bugs. Acceptable for a consolidation rollout; backfill in follow-up.

### R2 — ETag round-trip across multiple tabs surfaces UX edge cases

**Risk:** user edits Configure tab, then Behaviour, then clicks Save. The Save iterates writers; the third writer (Skills) returns 409 because a parallel session changed something. Now the first two writes are committed and the third isn't — partial save.

**Mitigation:** the Save button calls writers in a fixed order, wrapping each in a try/catch. On 409 mid-iteration, surface the inline ETag-mismatch banner with two actions: "Reload" (refetch + reset all dirty state) and "Cancel" (keep the unsaved-but-not-yet-attempted dirty tabs as-is so the user can retry the failed tab after reload). Document the partial-save behaviour explicitly in `AgentEditPage.tsx`'s top-of-file comment.

**Residual risk:** users may be confused by partial-save semantics. Document in `KNOWLEDGE.md` if user reports surface during G2; out of scope for spec amendment.

### R3 — Recurring tasks aggregator performance under high trigger volume

**Risk:** the aggregator pulls all triggers, all scheduled tasks, and all manual runs in 30 days for the org, then projects + sorts in memory. For a large org this is O(N) memory + sort.

**Mitigation:** Phase-1 acceptable — the typical org has ≤200 triggers/schedules and ≤5,000 manual runs. The aggregator uses cursor-paginated output (50 rows per page) so the wire payload is bounded. The sort happens in the service (not the DB), which is acceptable at this scale. **If a customer reports slow recurring-tasks page**, the fix is to push sort + filter into SQL — flagged as deferred follow-up.

**Residual risk:** acceptable for Phase 1.

### R4 — `linkedAgents` array column lacks per-link metadata

**Risk:** spec §4.5 frames `linkedAgents` as a list of agent IDs. A future spec will likely want per-link metadata (role, override budget, delegated permission). The array column makes that promotion harder.

**Mitigation:** flagged as deferred. The column is small enough that promoting to a `project_agent_links` table is a single migration: ADD TABLE, COPY existing IDs, DROP COLUMN. Manageable as a Phase-1.5 spec. Until then, the array column is a SoT for the simple case.

**Residual risk:** future spec carries a small migration cost. Acceptable.

### R5 — `additionalPrompt` overload as both Behaviour textarea and existing prompt-revision target

**Risk:** Behaviour tab edits flow into `additionalPrompt`; existing `agent_prompt_revisions` table records changes to `masterPrompt + additionalPrompt`. A behaviour-tab save creates a new revision row, which is good — but the spec's structured `behaviour: { briefingTemplate, constraints[] }` shape is collapsed into a single text blob before persistence. Round-tripping (parsing back to structured) is not implemented.

**Mitigation:** Phase-1 ships a single textarea for Behaviour (per the prototype). The structured shape lives in `shared/types/build.ts` and the API contract — server stores it as the composed string and re-emits it as `briefingTemplate=full text, constraints=[]`. **Frontend treats Behaviour as a textarea today.** A future spec can split the prompt into fenced sections + parse them.

**Residual risk:** a third-party API consumer expecting structured Behaviour gets a single-string `briefingTemplate` and empty `constraints`. Acceptable for Phase-1; document in `shared/types/build.ts` JSDoc.

### R6 — Test-run TTL mismatch (10s bucket vs spec's 24-hour wording)

**Risk:** spec §4.3 names a 24-hour idempotency TTL; the existing implementation uses 10s dual-bucket. Adopting the existing implementation means a user clicking Run with the same UUID 30 seconds later starts a new run (not what the spec contract suggests).

**Mitigation:** the contract is documented in C2 as a known directional gap. The frontend's `<TestRunnerCard>` re-uses the existing 10s-bucket helper indirectly (by sending a fresh UUID per click), so the user-facing idempotency is what users actually do (re-click within seconds). The 24-hour wording is what the spec intends; the next iteration of this spec or a follow-up Phase-2 amendment widens the bucket.

**Residual risk:** spec/code drift documented. Resolve by amendment, not silent change.

### R7 — Sidebar shape regression on user-shape combinations not covered by buildNavItems tests

**Risk:** C10 retargets multiple sidebar rows. The buildNavItems test (handed forward from foundation) covers four user shapes; combinations outside those (e.g. workspace user with `hasSidebarItem('clientpulse')` true but no client active) may regress.

**Mitigation:** C10 extends the existing buildNavItems test with three additional shapes: (a) workspace user with no projects/agents (empty state); (b) org admin viewing system view (no Build group rows); (c) system admin viewing workspace mode of a specific client. If a regression slips, it surfaces in G2 visual diff.

**Residual risk:** edge cases discovered post-merge surface as user reports. Acceptable.

### R8 — `SubaccountAgentEditPage` retention creates a "where do I edit" UX split

**Risk:** the consolidated `AgentEditPage` is the org-tier authoring surface. The per-subaccount-link override page (`SubaccountAgentEditPage`, 787 lines) is retained out of scope. Users who want per-subaccount overrides have to find that surface separately, and there's no clear nav signpost.

**Mitigation:** AgentEditPage's Schedule and Skills tabs include a small "Overrides per workspace" link that deep-links to the per-link page when an active client is selected. Out of scope for Phase 1: a deeper UX merge of the two surfaces.

**Residual risk:** documented in §10 deferred-items below.

### R9 — Migration ordering: schema additions ship in C1, but C4 modifies projects first in code review

**Risk:** if C4 is reviewed/merged before C1's migration applies, the `projects.objective` / `linked_agent_ids` columns don't exist yet and C4's runtime tests fail.

**Mitigation:** the plan locks the migration in C1 (the first chunk). PR ordering: backend chunks (C1-C5b) ship as one PR with migrations applied first. C4 is part of that PR. Frontend chunks (C6-C11) ship as a second PR after backend merge.

**Residual risk:** none if PR ordering is honoured. If split into more PRs, document the dependency in each PR description.

### R10 — Skill registry surface lost from SkillStudioPage / SkillAnalyzerPage

**Risk:** legacy SkillStudio (371 lines) had a test-case manager surface that may not have a clear home in AgentEditPage > Skills tab. Skill Analyzer (169 lines) surfaced "what skills does this agent need" recommendations.

**Mitigation:** before deleting these pages in C10, the inventory pass surfaces their behaviour. Skill test cases collapse into the existing `agent_test_fixtures` table — exposed via the AgentEditPage TestRunnerCard. Skill Analyzer recommendations are out of scope for visible UI (covered by `agentRecommendationsService.ts`, surfaced inside Behaviour tab as "Suggestions"). If the inventory pass surfaces anything truly orphaned, raise a PLAN_GAP.

**Residual risk:** the test-case surface may be smaller in the consolidated UI than in SkillStudio. Acceptable per the consolidation goal of fewer surfaces.

---

## 8. Doc-sync targets (full)

Per CLAUDE.md §11 and `docs/doc-sync.md`:

| Doc | Verdict | Reason |
|---|---|---|
| `architecture.md` | YES | Key files per domain rows for new pages, services, helpers; remove rows for retired pages |
| `docs/capabilities.md` | YES | Skill Studio / Skill Analyzer / Goals retired surfaces; Agent Edit consolidation; Recurring Tasks new surface |
| `KNOWLEDGE.md` | CONDITIONAL | Only if implementation surfaces a non-obvious gotcha |
| `CLAUDE.md` | NO | No new global rule introduced |
| `DEVELOPMENT_GUIDELINES.md` | NO | No new discipline rule introduced |
| `docs/frontend-design-principles.md` | NO | Consumes existing principles |
| `docs/integration-reference.md` | NO | No integration behaviour change |
| `docs/spec-context.md` | NO | No testing posture change |
| `docs/decisions/` | YES (one ADR) | The choice to retire 9 pages into 4 is durable; ADR `2026-05-07-consolidation-build-page-retirement.md` records why |
| `references/test-gate-policy.md` | NO | No posture change |
| `tasks/builds/consolidation-build/handoff.md` | YES | Coordinator appends Phase 2 close at handoff time |

---

## 9. Self-consistency check

- **Goals (spec §1) match implementation (chunks):** every goal maps. Goal 1 (consolidate agent edit) → C1 + C5 + C6. Goal 2 (consolidate agents list) → C7 + C5b. Goal 3 (recurring tasks) → C3 + C3b + C8. Goal 4 (project edit) → C4 + C9. Goal 5 (extend backend, no replace) → C1 + C2 + C3 + C4 (additive). Goal 6 (inline test runner) → TestRunnerCard in C6.
- **Every "must" / "guarantees" claim has a backing mechanism:** ETag concurrency (C1 + Q1); identity-key safeguard (Q6 + C1); idempotent test-run (C2 + existing helper); recurring-tasks SoT precedence (Q5 + C3); deterministic fireCondition (C3b + tests).
- **File inventory complete:** every component named in spec §5 has a chunk that creates it. Every modified file is named in a chunk's "Files to modify" section.
- **Phase dependency graph clean:** C5 depends on C1-C4; C6 on C5; C7 on C5+C5b; C8 on C3+C5; C9 on C5; C10 on all frontend chunks; C11 on all chunks. Forward-only, no cycles.
- **Deferred items honoured (spec §10):** every deferred item is preserved in §10 of the spec; no chunk implements anything in spec §10.
- **Testing posture matches spec §8:** pure-function tests for `agentEtagPure`, `identityKeyDiffPure`, `recurringTasksServicePure` (incl. `formatFireCondition`), `agentTestRunMapperPure`, `projectServicePure`. No frontend tests, no E2E, no API-contract tests. Static gates as the verification surface.
- **Permissions / RLS / execution model:** all new tab-scoped writes use existing AGENTS_EDIT permission; no new permission keys (per spec §6). Schema migration is additive; RLS manifest unchanged (the new `personality` column on `agents` and the new fields on `projects` are column-level, not row-level, so RLS coverage is inherited).
- **No silent partial success:** Save button on AgentEditPage either succeeds end-to-end or surfaces partial state via inline banner (R2 mitigation).

---

## 10. Chunk size summary

| Chunk | Files (approx) | Logical responsibilities | Estimate (builder-days) |
|---|---|---|---|
| C1 | ~12 (incl. migration) | 1 (agent edit backend + ETag + diff helpers + schema) | 1.5 |
| C2 | 3 | 1 (test-run async contract) | 0.5 |
| C3 | 4 | 1 (recurring-tasks aggregator + route) | 1 |
| C3b | 2 | 1 (formatFireCondition pure helper) | 0.5 |
| C4 | 3 | 1 (project edit endpoint + service + linkedAgents) | 0.5 |
| C5 | 3 | 1 (shared types + frontend wrappers) | 0.5 |
| C5b | 2 | 1 (agent revision count) | 0.25 |
| C6 | ~18 | 1 (AgentEditPage + tabs + TestRunnerCard + pickers) | 2 |
| C7 | 2 | 1 (AgentsListPage) | 0.75 |
| C8 | 2 | 1 (RecurringTasksPage) | 0.75 |
| C9 | 3 | 1 (ProjectEditPage + DeleteProjectDialog) | 0.75 |
| C10 | ~12 | 1 (sidebar + routes + retirements) | 0.75 |
| C11 | 3 | 1 (doc-sync + ADR) | 0.25 |

**Total: ~10 builder-days.** Spec estimate of 6-8 days assumes parallel execution of independent chunks (C1 ‖ C3 ‖ C4) and a tight C6 implementation. Realistic single-builder serial estimate: 9-11 days.

---

## 11. Acceptance gate (whole-build)

The build is complete when:

1. Every chunk's acceptance criteria pass (G1 per chunk).
2. `npm run lint`, `npm run typecheck`, `npm run build:server`, `npm run build:client` all pass cleanly.
3. Every pure-function test authored in this build passes via `npx tsx`.
4. Manual G2 verification (per spec §8) passes:
   - Agents list view-mode switching, sort, filter, search.
   - AgentEditPage: open all 8 tabs, edit each, save, ETag round-trip simulation produces 409 banner.
   - TestRunnerCard inline card runs sample input, polls until terminal, shows result + trace link.
   - RecurringTasksPage: union shows triggers + schedules + manual; filters work; pause/resume routes back to underlying trigger.
   - ProjectEditPage: form footer alignment, Goals migration banner for migrated projects.
   - Old admin/skill pages 308-redirect to new equivalents.
   - Empty / error states render.
   - Action visibility by role (system-managed agent read-only for non-system-admin, etc.).
5. PR review by `pr-reviewer` and `dual-reviewer` (Codex) returns APPROVED.
6. Doc-sync chunk (C11) commits architecture.md + capabilities.md + ADR + KNOWLEDGE.md updates.

---

**End of plan.**
