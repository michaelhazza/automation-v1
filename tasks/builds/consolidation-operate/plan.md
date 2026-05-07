**Plan version:** 1.3
**Plan date:** 2026-05-07 (v1.3 — final ChatGPT-review tightenings: filterOptions operates on RLS-filtered merged set; redirect query-param ordering deterministic. v1.2 — cursor invariant locked, filter-reset uses remount nonce, iframe-recursion guard, KPI tile isolation, stale-response/cache-control invariants, redirect grammar pinned)
**Branch:** `ui-consolidation-operate` (already created from `main`)
**Spec:** `tasks/builds/consolidation-operate/spec.md` (Status: accepted)
**Foundation status:** Phase 0 (`consolidation-foundation`) is **already merged** on `main` (PR #270). All §4 primitives in foundation are locked at the version on `main`.

---

# Consolidation A — Operate · Implementation Plan

> Phase-2 stream A. Replaces Home/Inbox/Activity/Run-trace pages and extends the activity + inbox APIs and the run-trace assembler. No new tables, no new migrations, no new permission keys.

## Table of contents

- Model-collapse check
- Architecture notes
- Spec reconciliations
- Chunk dependency diagram
- Hand-off context for builder
- Chunk C1 — Activity API extension
- Chunk C2 — Inbox API extension
- Chunk C3 — Shared types + API client wrappers
- Chunk C4 — Run-trace page rewrite (embedded mode)
- Chunk C5 — Activity page (table + drawer + modals)
- Chunk C5b — Run-trace masking projection + renderer
- Chunk C6 — Inbox page (three priority bands)
- Chunk C7 — Home page (KPIs + Runs + Recent activity)
- Chunk C8 — Router wiring + sidebar + delete old pages
- Chunk C9 — Doc-sync
- Cross-cutting risks and mitigations
- Self-consistency notes
- Builder hand-off checklist

## Model-collapse check

This stream is **render-and-react UI plumbing** (page routing, drawer + modal interactions, table sort/filter, three-band inbox, role-aware projection of an existing run record). There is no ingest → extract → transform → render pipeline; there is no LLM call to make. The collapsed-call alternative does not apply. **Reject collapse.** Proceed with the chunk decomposition that mirrors spec §7.

## Architecture notes

- **No new patterns invented.** Every new file consumes an existing foundation primitive (`Modal`, `Drawer`, `SortableTable`, `WorkspaceBadge`, `PageShell`, `SearchBox`, `EmptyState`, `ErrorState`, `ConfirmDialog`, `useViewMode`) or extends a backing service that already exists.
- **Backend deltas are additive.** `activity.ts` route + `activityService.ts` already implement cursor-paged, multi-source listing with `(createdAt DESC, id ASC)` tiebreaking and a `buildCursorPredicate` helper. C1's job is to extend the **response envelope** with `filterOptions` and to widen the **request grammar** with `sortKey`/`sortDir` + multi-select `actor`/`subaccount` filters — not to rewrite the cursor walk.
- **Cursor invariant — explicit lock.** The live implementation tiebreaks by `id ASC` under primary `createdAt DESC`. This is **mixed-direction by design**: `createdAt` is server-assigned and effectively monotonic per source, so the tiebreaker only fires on same-millisecond inserts; `id ASC` is cheap to index against and stable. **Locked invariants for any sort grammar extension in C1:**
  1. The secondary tiebreaker is **always `id`** regardless of `sortKey`.
  2. When `sortDir` flips for the primary key, the tiebreaker direction **also flips** so that `(primary, id)` remain in the same effective order — i.e. the cursor encoding is `(primarySortValue, id)` walked in the effective order of the request, never mixed-direction in a way that breaks `buildCursorPredicate`.
  3. The cursor opaque payload encodes the effective sort `(sortKey, sortDir, lastPrimaryValue, lastId)`. Cursor reuse across a different `(sortKey, sortDir)` returns page 1 silently (already in spec §4.1).
  Document this in the C1 changelog and in the JSDoc on `buildCursorPredicate`. The historical `id ASC` under `createdAt DESC` remains as a special case **only** for the legacy `sort=attention_first` shim — the new `sortKey`/`sortDir` grammar follows rule 2.
- **Inbox naming reconciliation.** The spec assumes a single `inbox_items` table with a `status` column and a service called `agentInboxService`. Reality: the existing service is `inboxService.ts` and inbox items are a UNION across `tasks` (`status='inbox'`), `review_items` (`reviewStatus='pending'`), and `agent_runs` (failed/timeout) keyed by `(entityType, entityId)`. The C2 implementation must derive priority bands from this union shape — there is no single `inbox_item.status` column to predicate on. See "Spec reconciliations" below.
- **Run-trace masking is a backend concern.** The renderer must never branch on role; it reads the projection emitted by `agentRunMessageService` and treats the redaction token (`"<redacted>"`) and `truncated: true` flag as the only signals it consumes. C5b owns this projection — both halves (server + client) live in one chunk to keep the contract atomic.
- **Embedded-mode is a frontend-only concern.** `?embedded=1` toggles a top-level frontend boolean (read once on mount via `URLSearchParams`); Layout / topbar / replaces-strip mounts are conditioned on it. No backend coupling.

## Spec reconciliations

The spec assumed a few file/path names that do not match the current codebase. The plan resolves each as follows:

| Spec assumption | Reality | Plan resolution |
|---|---|---|
| `client/src/pages/RunTracePage.tsx` exists and is replaced | Actual file: `client/src/pages/RunTraceViewerPage.tsx`. Routes mounted at `/admin/subaccounts/:subaccountId/runs/:runId` and `/admin/runs/:runId`. No `/run-trace/:id` route exists. | C4 creates `client/src/pages/operate/RunTracePage.tsx` (new) and adds `/run-trace/:id` to `APP_ROUTE_PATTERNS`. C8 deletes `RunTraceViewerPage.tsx` and rewires the two old admin run paths to redirect to `/run-trace/:id` so existing deep-links keep working. |
| `server/services/agentInboxService.ts` (assumed) | Actual service: `server/services/inboxService.ts`. Inbox is a UNION across `tasks` / `review_items` / `agent_runs`, with read-state in `inbox_read_states`. There is NO `inbox_items` table and NO single `status` column shared across kinds. | C2 modifies `inboxService.ts` (not `agentInboxService.ts`). Band derivation runs in JS over the unioned rows (band by `(kind, isRead, dueAt, severity)`); there is no `WHERE status = 'pending'` predicate to apply uniformly. Idempotency is per-kind: tasks update `tasks.status`, reviews update `review_items.reviewStatus`, agent runs are read-only from inbox's POV. The spec's "approve/reject" actions apply only to `review_item` and `approval` kinds in this codebase — see C2 risks. |
| `client/src/lib/api.ts` is the API wrapper | Confirmed: file exists and is the right place. | C3 adds operate-stream wrappers there. |
| `actions` table holds inbox approval state with `status='pending_approval'` | Confirmed. The `inbox_item` flavour with `kind='approval'` is sourced from `actions` rows where `status='pending_approval'`, NOT from `review_items`. The `activityService.ts` `fetchInboxItems` helper already proves this. | C2's `kind='approval'` items predicate against `actions.status='pending_approval'`. The state-based concurrency guard in spec §6 (`UPDATE ... WHERE status = 'pending'`) maps to `UPDATE actions SET status = 'approved' WHERE status = 'pending_approval'`. Other kinds use their own state machines. |
| New routes `/`, `/inbox`, `/activity`, `/run-trace/:id` | `/` exists. `/inbox`, `/activity` (top-level), `/run-trace/:id` are NOT in `APP_ROUTE_PATTERNS`. | C8 adds the missing patterns to `routes.ts` and registers them in `App.tsx`. |
| `<SortableTable getFilterOptions>` consumes a derived option list | Confirmed: `ColumnDef.getFilterOptions?: (rows: Row[]) => Array<{ value: string; label: string }>`. The contract returns options without counts. | C5 wires `getFilterOptions` to a function that reads from the server-supplied `filterOptions` (which DOES carry counts). The renderer renders `label (count)` if a count is present. No primitive change required. |
| Spec §4.7 "Clear filters" calls `<SortableTable>`'s `clearAllFilters()` | The current SortableTable already renders an internal "Clear filters" control via `showClearFilters` (default true). It does not export a programmatic `clearAllFilters()` method. | C5 piggybacks on the built-in control. The page-level "Clear filters" CTA inside `<EmptyState>` clears `q` AND triggers a **page-owned `tableResetNonce`** (a `useState<number>` incremented on click). The page renders `<SortableTable key={\`activity-${tableResetNonce}\`} persistKey="operate-activity" …>` so the increment forces React to remount the table. On remount, SortableTable re-reads its persisted state once — combined with bumping the `persistKey` suffix to `operate-activity:v${tableResetNonce}` (or clearing the persisted key on the same handler) the column-filter state resets cleanly via the primitive's own boundary. **DO NOT mutate `localStorage` under `table:v1:<persistKey>` from outside SortableTable** — that violates the foundation's "consume primitives, don't reach inside them" discipline and creates a tight coupling that breaks the next time SortableTable's internal persistence shape changes. If the remount approach proves insufficient (e.g. it loses non-filter state the user wants to keep, like sort), escalate to a Spec-0 patch that adds an imperative `clearAllFilters()` ref API on SortableTable. |

## Chunk dependency diagram

```
C1 (activity API)          C2 (inbox API)           C4 (run-trace page)
        \                        /                          |
         \                      /                           |
          +--------> C3 (types + api.ts) <-----------------+
                              |
              +---------------+---------------+
              |               |               |
              v               v               v
             C5 (Activity)   C6 (Inbox)      C7 (Home)
              |                                 ^
              v                                 |
             C5b (run-trace masking projection + renderer)
              |
              v
             C8 (router + sidebar + delete old pages)
              |
              v
             C9 (doc-sync)
```

- **Independent (parallel-eligible once spec is locked):** C1, C2, C4. They touch disjoint files and do not import from each other.
- **Single-threaded after C3:** C5 needs C3+C4. C6 needs C3. C7 needs C5 (it imports `<ActivityRow>` and `<ActivityDetailModal>` from C5). C5b can land any time after C4 but before C8 (C5b's renderer is consumed by both C4's full-page mode and C5's RunTraceModal).
- **Sequencer:** C8 must wait on C5+C6+C7+C5b. C9 last.
- **No backward references.** Verified.

## Hand-off context for builder

- **Phase 0 foundation is merged on `main`.** Do not patch primitives in this stream. If a missing primitive surfaces, stop and route the request to a Spec-0 patch per spec §2.5.
- **Branch:** `ui-consolidation-operate` is checked out. Do not switch branches.
- **Test posture:** `static_gates_primary`. Per-chunk verification = `npm run lint`, `npm run typecheck`, `npm run build:server` / `npm run build:client` (when relevant), and **targeted Vitest** runs of the pure-function tests authored in this plan via `npx vitest run <path>`. No frontend tests, no E2E, no API-contract tests, no umbrella `npm test`.
- **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**
- **Pure-function tests required (per spec §8):**
  - Filter-options aggregator (C1) — colocated `__tests__/activityServicePure.test.ts` extension.
  - Inbox band-derivation (C2) — new `__tests__/inboxServicePure.test.ts` (creates a Pure file alongside `inboxService.ts` if one is missing).
  - Run-trace embedded-flag URL parser (C4) — colocated `__tests__/runTraceEmbeddedPure.test.ts`.
- **CEO-style hand-off:** when reporting back, summarise progress in plain English. Don't paste raw chunk logs.

---

## Chunk C1 — Activity API extension (cursor + multi-select filters + sort grammar + filterOptions)

**Goal.** Extend `GET /api/activity` (and the subaccount/system variants) to accept the spec §4.1 query grammar and return the spec §4.1 response envelope (items + nextCursor + filterOptions), without breaking existing consumers.

**Files to modify.**
- `server/routes/activity.ts` — accept `actor`, `subaccount`, `sortKey`, `sortDir`; map them into `ActivityFilters`; emit `filterOptions` on response. Keep the existing `sort` enum accepted for backward compat (legacy `attention_first` etc. map via a thin shim in the Pure layer).
- `server/services/activityService.ts` — extend `ActivityFilters` with `actor?: string[]`, `subaccount?: string[]`, `sortKey?`, `sortDir?`; thread through to per-source fetchers; build the post-merge filterOptions aggregator.
- `server/services/activityServicePure.ts` — add `aggregateFilterOptions(items, activeFilters)` returning `{ type, status, actor, subaccount }` with the spec's faceted-search semantics (counts respect every active filter EXCEPT the dimension being counted; counts respect `q` and `scope`).
- `server/services/__tests__/activityServicePure.test.ts` — extend with cases for: empty filters → counts equal items grouped; single dimension active → that dimension's counts ignore the active filter; combined filters → AND across dimensions, OR within a dimension; missing `triggerSource` falls back to `'unknown'`.

**Contracts implemented.** Spec §4.1 cursor invariant (already correct in `buildCursorPredicate`), sort stability with `id` as secondary key (already correct), filterOptions count semantics (new), `triggerSource` derivation (already in `mapAgentRunTriggerType`; verify and surface as a top-level field).

**Invariants locked in this chunk (must appear in code comments + JSDoc):**
- **Cursor secondary tiebreaker direction follows the primary sort direction** (see Architecture notes — rule 2). Any new `sortKey`/`sortDir` combination MUST encode `(primary, id)` in the effective order requested. The legacy `id ASC` under `createdAt DESC` is preserved only for the `sort=attention_first` shim.
- **`filterOptions` counts are computed from the FILTERED result set BEFORE pagination/cursor slicing.** The aggregator runs over the in-memory merged-and-filtered set used to derive `items` for page 1, NOT over the post-cursor slice. Faceted-search semantics (counts respect every active filter EXCEPT the dimension being counted; counts respect `q` and `scope`) operate on this pre-pagination set. This prevents "counts only reflect visible page" regressions. **The aggregator runs over the already-RLS-filtered + cross-source-merged set** — i.e. after each per-source fetcher has applied its tenancy/permission predicates and after the merge step has reconciled duplicates. It MUST NOT count rows directly off raw per-source fetches, because (a) some rows are filtered out by RLS the caller cannot see, and (b) merge reconciliation can drop or coalesce duplicates that would otherwise inflate counts. A future optimisation that pushes count aggregation closer to the source must preserve this invariant or explicitly re-prove it.
- **No shared HTTP caching across users.** The activity endpoint sets `Cache-Control: private, no-store` (it already returns user-scoped + RLS-filtered data). Re-confirm in the route handler — do NOT add `public` or `s-maxage`.

**Dependencies.** None inside this stream; foundation already merged.

**Verification commands (per CI-only test-gate policy).**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/__tests__/activityServicePure.test.ts`

**Acceptance.**
- All verification commands above pass.
- Manual smoke (per spec §8): `curl /api/activity?type=agent_run&type=review_item&sortKey=createdAt&sortDir=desc&limit=5` returns `{ items, nextCursor, filterOptions: { type, status, actor, subaccount } }`.
- Cursor mismatch (changed sortKey) returns page 1 silently — no 400.

**Risks / open questions.**
- **`triggerSource` field naming — RESOLVED.** Emit BOTH `triggerType` (existing) and `triggerSource` (new spec name) on every `ActivityItem`. Additive only; do not rename in place. C9 doc-sync notes `triggerType` deprecated; removal is a follow-up after consumers migrate.
- **filterOptions for large result sets.** Spec §4.1 calls out a >50k-row scaling path (cached/approximate). Phase 1 implements the naive in-memory aggregation against the pre-paginated merged set; do NOT pre-emptively cache. Note the path exists if SLO breaks.
- **Legacy sort enum compat.** Existing callers pass `sort=attention_first`. Keep accepting it; `sortKey`/`sortDir` is additive. If both arrive, `sortKey`/`sortDir` wins.

---

## Chunk C2 — Inbox API extension (priority bands + action endpoints + idempotency)

**Goal.** Extend `inboxService.ts` and `server/routes/inbox.ts` with priority-band derivation (`high | needs_action | previous`) plus three spec §4.2 action endpoints (`approve`, `reject`, `archive`), each idempotent under the existing per-kind state machines. **Snooze is deferred** (column `inbox_read_states.snoozed_until` does not exist and adding it breaks the spec's no-migrations pledge — see resolved gaps at end of plan).

**Files to modify.**
- `server/routes/inbox.ts` — add `GET /api/inbox?band=` (response shape: spec §4.2 `InboxListResponse`); add `POST /api/inbox/:id/approve|reject|archive`. Do NOT add `/snooze`. Keep existing `/api/inbox/unified`, `/mark-read`, `/mark-unread`, `/archive` (bulk) endpoints functional.
- `server/services/inboxService.ts` — add `listInboxByBand(userId, orgId, { band, q, subaccountId })` that calls existing union-fetchers and applies the band-derivation pure function. Add per-kind action methods: `approveItem(orgId, ref)` (review_item → `review_items.reviewStatus='approved'` via `WHERE reviewStatus IN ('pending','edited_pending')`; approval-flavour inbox items via `actions.status='approved'` from `WHERE status='pending_approval'`); `rejectItem(orgId, ref, reason)` (writes reason to `review_items.reviewerComment` if column exists — verify at C2 kickoff; if absent, reason is dropped — the inline UI input still functions, audit trail captures the action); `archiveItem(userId, orgId, ref)` (already exists as bulk; add single-id variant or reuse bulk with one item).
- `server/services/inboxServicePure.ts` (NEW) — `deriveBand(item: UnifiedInboxItem): 'high' | 'needs_action' | 'previous'` with deterministic rules (e.g. unread + critical/dueAt within 24h → high; unread → needs_action; read or archived → previous). No "snoozed" input — snooze is deferred. Pin the rule set in this Pure file; do NOT spread it across the service.
- `server/services/__tests__/inboxServicePure.test.ts` (NEW) — vitest cases covering each band rule, `q` filter, kind-specific edge cases.

**Contracts implemented.** Spec §4.2 list + actions; §6 state-based idempotency (per-kind predicate, named in spec reconciliations table); §6 HTTP mapping (concurrency loss → `200 { ok: true, alreadyApplied: true }`, never 4xx/5xx); §6 unique-constraint mapping (no new constraints).

**Dependencies.** None inside this stream.

**Verification commands (per CI-only test-gate policy).**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/__tests__/inboxServicePure.test.ts`

**Acceptance.**
- All verification commands pass.
- Manual smoke: `POST /api/inbox/<reviewItemId>/approve` twice returns `200` both times; second response carries `alreadyApplied: true`.
- `GET /api/inbox?band=high` returns only band='high' items; `?band=previous` returns archived/read items.

**Risks / open questions.**
- **Approve/reject only applies to review_item + approval kinds.** Failed agent_run inbox items have no "approve" semantic; the route must return `400 { errorCode: 'inbox_action_not_applicable' }` for those. Spec doesn't pin this — flag for builder; default behaviour above is the chosen handling.
- **Reject reason persistence.** Builder verifies `review_items.reviewerComment` (or equivalent) at C2 kickoff. If present: write reason there. If absent: drop reason silently, audit trail captures the action only. Inline reject UI behaviour does not change either way (resolved per operator gap #4).

---

## Chunk C3 — Shared types + API client wrappers

**Goal.** Land the TypeScript contract that the operate frontend pages share (Activity item shape, Inbox item shape, Run-trace event shapes including masking) and the `client/src/lib/api.ts` wrappers for the new endpoints.

**Files created.**
- `shared/types/operate.ts` — `ActivityItem` (re-exporting/refining the server `ActivityItem` with the new `triggerSource` and `detail` JSONB), `InboxItem` (kind union, action union), `RunTraceEvent` discriminated union (LLM call, tool call, tool result, step start, step end), `MaskingProjection` flag on each event whose visibility depends on role (`{ value: T | '<redacted>'; truncated?: true }`). One Pure module — no React/Express imports.

**Files modified.**
- `client/src/lib/api.ts` — add `fetchActivity(query)`, `fetchInbox({ band, q })`, `inboxApprove(id)`, `inboxReject(id, reason)`, `inboxArchive(id)`, `fetchRunTrace(runId)`. Each wraps the existing fetch helper; no new auth shape. (No `inboxSnooze` — snooze deferred.)

**Contracts implemented.** Spec §4.1 / §4.2 / §4.4 / §4.8 frontend type surface.

**Dependencies.** C1, C2 (so the response shape on the wire matches what the client decodes).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Acceptance.**
- All verification commands pass.
- Type-only contract — no runtime tests in this chunk.

**Risks / open questions.**
- **One `shared/types/operate.ts` vs two.** Spec §9 explicitly assigns this file to operate; B and C own their own. Builder MUST NOT import operate types from B/C or vice versa.
- **Redaction token type.** Use a literal `'<redacted>'` string (not a sentinel symbol) per spec §4.8. Renderer pattern-matches on the literal.

---

## Chunk C4 — Run-trace page rewrite with embedded-mode flag

**Goal.** Create `client/src/pages/operate/RunTracePage.tsx` to replace `RunTraceViewerPage.tsx`. Support `?embedded=1` to suppress sidebar/topbar/breadcrumb/replaces-strip and render the run layout at `height: 100vh`.

**Files created.**
- `client/src/pages/operate/RunTracePage.tsx` — full-page run trace. Reads `embedded` once via `URLSearchParams` on mount; passes the boolean down to the layout chrome and to `<RunTraceEventRenderer>` (which lands in C5b). Workspace badges in the header use `<WorkspaceBadge>` (clickable for org_admin per foundation §4.5).
- `client/src/lib/runTraceEmbeddedPure.ts` (NEW) — `parseEmbeddedFlag(search: string): boolean`. Pure function over `URLSearchParams`; treats `?embedded=1`, `?embedded=true` as truthy; everything else falsy.
- `client/src/lib/__tests__/runTraceEmbeddedPure.test.ts` — vitest cases: missing param, `=1`, `=0`, `=true`, `=false`, `=`, multi-key `?embedded=1&embedded=0` (first occurrence wins — `URLSearchParams.get()` contract).
- `client/src/pages/operate/components/RunTraceModal.tsx` — modal that wraps the run-trace via `<iframe>` with `?embedded=1`. Uses foundation `<Modal size="iframe" zIndex={1010} bodyPadding="none">`. Sandbox attribute: `sandbox="allow-scripts allow-same-origin allow-forms"` per spec §4.3 isolation invariant.

**Files modified.**
- `client/src/config/routes.ts` — append `'/run-trace/:id'` to `APP_ROUTE_PATTERNS`. (Adding the route only; wiring in C8.)

**Contracts implemented.** Spec §4.3 embedded mode; §4.3 isolation invariant (sandbox); §4.5 workspace badge clickability.

**Embedded-mode recursion guard (locked invariant).** When `embedded === true`, `RunTracePage` MUST suppress every UI affordance that can open another `RunTraceModal` or another iframe-embedded run-trace. Concretely:
- Run-id links inside the embedded page render as plain text (or a copy-to-clipboard chip), NOT as `<RunTraceModal>` triggers.
- The event renderer (`<RunTraceEventRenderer>` in C5b) receives the `embedded` boolean as a prop and disables any "open in modal" affordance it would otherwise expose.
- Any cross-link to another run (e.g. parent/child run pointers) becomes a plain link to `/run-trace/:otherId` (top-window navigation via `target="_top"`), NOT a modal launch.
This prevents nested-iframe recursion and the "embedded modal opens an embedded modal" regression that a future feature could otherwise introduce. Add a top-of-file invariant comment in `RunTracePage.tsx` so reviewers catch violations.

**Dependencies.** Foundation Modal extension (already merged on main).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx vitest run client/src/lib/__tests__/runTraceEmbeddedPure.test.ts`

**Acceptance.**
- All verification commands pass.
- Manual smoke (after C8 wires the route): `/run-trace/<runId>?embedded=1` renders `.run-layout` at `100vh` with no sidebar; `/run-trace/<runId>` renders normal page.

**Risks / open questions.**
- **Component dependency on `<RunTraceEventRenderer>`.** That component lands in C5b. C4 ships with a placeholder renderer (a thin pass-through) and C5b replaces it. Alternative: merge C4 + C5b. **Recommendation: keep them separate to keep blast radius small; the placeholder is a literal `<pre>{JSON.stringify(event)}</pre>` for the dev-time gap — never visible to a user because C5b lands before C8.**
- **Existing `RunTraceViewerPage.tsx` behaviour.** That file may have non-trivial logic (fetch, state). C4 must port its non-trivial behaviour, not re-derive. Builder reads it end-to-end before authoring C4.

---

## Chunk C5 — Activity page (table + drawer + activity-detail modal + run-trace modal)

**Goal.** Create `client/src/pages/operate/ActivityPage.tsx` using `<SortableTable>` with the spec §4.1 column set, `<Drawer>` for row click, `<ActivityDetailModal>` for the Home-widget entry path, and `<RunTraceModal>` for run-id clicks. Workspace badges per §4.5.

**Files created.**
- `client/src/pages/operate/ActivityPage.tsx` — wraps `<PageShell>`; renders `<SearchBox>` (200ms debounce, wired to `q`, latest-request-wins per "Stale-response handling" below); renders `<SortableTable key={\`activity-${tableResetNonce}\`} persistKey="operate-activity">`; row click opens `<Drawer>`. `<EmptyState>` rendered when `items.length === 0`; the page-level "Clear filters" CTA inside the empty state clears `q` AND increments `tableResetNonce` to force a clean SortableTable remount (per "Spec reconciliations" row 7). **No direct localStorage writes from this file.**

**Stale-response handling for debounced fetches (Activity).** The page maintains a monotonic `requestSeq` ref. Each `fetchActivity` call captures the seq value at dispatch; on resolve, the handler discards the response if `requestSeq.current !== capturedSeq`. This is **latest-request-wins** semantics: rapid typing in `<SearchBox>` cannot reorder responses into state. Same pattern in C6 (Inbox).
- `client/src/pages/operate/components/ActivityRow.tsx` — row renderer used by the table AND by `<HomeRecentActivity>`. Renders subject, type tag, status dot, severity dot, actor, workspace badge, "X ago" timestamp, run-id link (opens `<RunTraceModal>`).
- `client/src/pages/operate/components/ActivityDetailModal.tsx` — uses foundation `<Modal size="md">`. Renders the same `ActivityItem` payload shape as the drawer (per spec §4.4 source-of-truth precedence). Contains the run-id affordance that opens `<RunTraceModal>` stacked above (`zIndex=1010`).
- `client/src/pages/operate/components/SeverityLegend.tsx` — sticky-dismissible legend. Reads localStorage key `activitySeverityLegendSeen:{userId}` (per spec §4.9). Renders a "got it" close that sets the flag.

**Files modified.** None (consumes only).

**Contracts implemented.** Spec §4.1 query/response (consumer side), §4.4 (modal payload precedence), §4.5 (workspace badges), §4.7 (search interaction; clearing q does NOT clear filters; "Clear filters" CTA clears both), §4.9 (severity legend sticky-dismissed; trigger source column; legend per-user prefix), §4.10 (no bulk; reject not applicable on Activity).

**Dependencies.** C3 (types + api wrappers), C4 (RunTraceModal).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Acceptance.**
- All verification commands pass.
- Manual smoke (per spec §8): sort each sortable column; filter each filterable column; Apply / Cancel / Esc / outside-click all behave per foundation §4.3; row click opens drawer; run-id link opens iframe-embedded run-trace modal stacked above.

**Risks / open questions.**
- **Drawer vs modal trigger ambiguity.** Spec §4.4: drawer is the default for Activity-page row click; modal is the default for Home-widget click. The same `<ActivityRow>` is used by both. The trigger handler must be passed in by the parent — `<ActivityRow onOpen={(item) => …}>` — so the row component itself stays trigger-agnostic.
- **Action visibility gating (spec §6).** Activity page does not gate row visibility on permissions (the data is already RLS-filtered). The Home spend widget (C7) DOES gate. Builder must not over-apply gating here.

---

## Chunk C5b — Run-trace role-aware masking projection + event renderer

**Goal.** Land the masking projection on the backend (`agentRunMessageService`) and the role-agnostic renderer on the frontend (`<RunTraceEventRenderer>`). Together they implement spec §4.8.

**Files created.**
- `client/src/pages/operate/components/RunTraceEventRenderer.tsx` — renders an `RunTraceEvent` (typed in C3). Pattern-matches on `event.type`. For each potentially-masked field, treats `'<redacted>'` as masked (renders a redaction chip) and `truncated: true` as "show first N chars + ellipsis with truncated indicator". Never reads `req.user.role` or any auth state — the projection has already decided. Accepts an `embedded?: boolean` prop (forwarded from `RunTracePage`); when `true`, suppresses any "open in modal" / "open in iframe" affordance per the C4 recursion guard.

**Files modified.**
- `server/services/agentRunMessageService.ts` — add a `projectForRole(messages, role)` function (or extend `streamMessages` to accept a role projection) that emits the spec §4.8 visibility table. **Mask precedence over truncation per spec §4.8** (if a field would be both masked and truncated, return `'<redacted>'` with no `truncated` flag).
- `server/services/agentRunMessageServicePure.ts` — pure helper `projectMessageForRole(message, role): RunTraceEvent` that is the single source for the masking decision. Called from `agentRunMessageService` and tested in isolation.
- `server/services/__tests__/agentRunMessageServicePure.test.ts` — vitest cases for each role × field cell of the spec §4.8 visibility table; one case for the mask-vs-truncate precedence rule.
- The run-trace read endpoint (whatever serves `RunTracePage`'s data fetch — verify in C4: likely `server/routes/agentRuns.ts` or a dedicated runTrace route) must call `projectForRole(messages, req.user.role)` before returning. **Builder must locate the actual read path** and modify there — NOT in `agentRunMessageService` directly if the service is consumed by non-trace callers (e.g. agent-execution loop), to avoid leaking masked data into agent execution.

**Contracts implemented.** Spec §4.8 visibility table; §4.8 redaction-token contract (`'<redacted>'` literal, never null, never absent); §4.8 truncated flag contract; §4.8 mask-precedence-over-truncation rule.

**Cache-control invariant (locked).** Run-trace responses carrying role-aware masking projections **MUST NOT be shared-cacheable across roles or users**. The route handler sets `Cache-Control: private, no-store` and emits no `ETag` that could be reused across sessions. Even if no CDN/edge cache exists today, this prevents a future infra change (Cloudflare, internal cache layer, browser back-forward cache misuse) from leaking masked-vs-unmasked content across roles. Builder verifies the response headers on the read endpoint and asserts the same in any wrapper helpers. Add a comment block explaining *why* the header is required so a future "let's cache this for performance" PR is forced to address role-sensitivity first.

**Dependencies.** C4 (the renderer is consumed by `RunTracePage` and `RunTraceModal`).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npm run build:client`
- `npx vitest run server/services/__tests__/agentRunMessageServicePure.test.ts`

**Acceptance.**
- All verification commands pass.
- Manual smoke (per spec §8): test as workspace user, org admin, system admin; verify the projection table at each role.

**Risks / open questions.**
- **Locating the run-trace read endpoint.** Builder must grep for the route that serves the run-trace UI today (likely `agentRuns.ts` `/runs/:runId/messages`). The masking projection MUST go on the read path that serves the UI, not on the write path that records messages.
- **Role detection for system-admin-org-override.** When system admin is scoped into an org via `X-Organisation-Id`, they retain system-admin role for masking purposes (sees everything). Spec §6 confirms — confirm `req.user.role` reflects this.
- **Performance.** The projection is O(messages); for long runs (>1000 messages) this is still cheap. No caching needed in Phase 1.

---

## Chunk C6 — Inbox page (three priority bands)

**Goal.** Create `client/src/pages/operate/InboxPage.tsx` rendering three collapsible bands (HIGH PRIORITY, NEEDS ACTION, PREVIOUS), each populated by `GET /api/inbox?band=...`. Action buttons per item; inline reject reason input; no bulk.

**Files created.**
- `client/src/pages/operate/InboxPage.tsx` — wraps `<PageShell>`. Renders `<SearchBox>` (200ms debounce, **latest-request-wins**: each band keeps its own `requestSeq` ref and discards stale responses on resolve, identical to C5). Three `<InboxBand>` components rendered in spec §4.6 order. Each band fetches independently (parallel `Promise.all` on mount; refetch on `q` change). Empty band → `<EmptyState>` inside the band; empty page (all three empty) → page-level `<EmptyState>`.
- `client/src/pages/operate/components/InboxBand.tsx` — collapsible wrapper (high/needs_action/previous). `position: sticky; top: 0` header per spec §4.6. Default expanded for high + needs_action; collapsed for previous.
- `client/src/pages/operate/components/InboxItemCard.tsx` — renders one item. Top-right action buttons (approve/reject/archive depending on `item.actions` — no snooze). Inline reject reason input (textarea, optional, encouraged via placeholder per spec §4.10) directly in the card — NOT a modal. Bottom-right "Added: <date>" / "Triggered: <date>" label per spec §4.6. Action visibility hidden per user permissions (spec §6).

**Files modified.** None.

**Contracts implemented.** Spec §4.2 (consumer side); §4.6 (band UX); §4.7 (search wired); §4.10 (reject is inline, archive has no confirmation).

**Dependencies.** C3.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Acceptance.**
- All verification commands pass.
- Manual smoke: bands collapse/expand; clicking the same action button twice returns 200 both times (no UI error spinner-loop); search debounces and re-queries each band.

**Risks / open questions.**
- **Action availability per kind.** Per "Spec reconciliations" row 4: only `approval` and `review` kinds support approve/reject; `failure` (failed agent run) and `archived` only support `open`/`archive`. Builder reads `item.actions` from the server (not derived in the UI) — server is SoT.
- **Frontend permission gate for action buttons.** Hidden when user lacks inbox-write permission. Read from existing auth helper (likely `client/src/lib/auth.ts`).

---

## Chunk C7 — Home page (KPIs + Runs chart + Recent activity widget)

**Goal.** Create `client/src/pages/operate/HomePage.tsx` to replace `DashboardPage.tsx`. Top KPIs, a runs chart, and a Recent activity widget that uses `<ActivityRow>` (from C5) and opens `<ActivityDetailModal>` on row click.

**Files created.**
- `client/src/pages/operate/HomePage.tsx` — wraps `<PageShell>`. Renders KPI tiles (count of in-flight runs, attention-needed count, Cost MTD — last one gated to org_admin per spec §6), a runs-over-time chart, and a Recent activity section that calls `fetchActivity({ limit: 10 })` and renders rows via `<ActivityRow>`. Row click opens `<ActivityDetailModal>` (NOT a drawer — Home uses modal per spec §4.4); run-id click opens `<RunTraceModal>` stacked.

**KPI loading isolation (locked invariant).** Each KPI tile owns its own `loading` / `error` / `data` state and fetches independently. **A failure in one tile MUST NOT blank or fail the others.** Concretely: each tile renders one of `{ skeleton | value | inline-error chip }` based on its own promise state; tiles do NOT share a parent `useQuery` or a single `Promise.all`. The runs chart and Recent activity section follow the same per-section isolation. This prevents the regression where Cost MTD failing for an org_admin (e.g. permission edge case, transient billing-source 5xx) blanks the entire KPI strip.

**Files modified.** None.

**Contracts implemented.** Spec §4.4 (modal opens from Home, not drawer); §4.5 (workspace badges in widget rows); §6 (Cost MTD KPI gated to org_admin).

**Dependencies.** C5 (imports `<ActivityRow>` and `<ActivityDetailModal>`); foundation `<PageShell>`.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Acceptance.**
- All verification commands pass.
- Manual smoke: page renders for workspace user without spend KPI; renders for org_admin with spend KPI; clicking a row opens modal (not drawer).

**Risks / open questions.**
- **Existing DashboardPage widgets to preserve vs cut.** DashboardPage today carries widgets we may not want on the new Home (e.g. role-specific debug panels). Spec §1 says "existing widgets re-implemented against the new layout". Builder picks the subset that matches the prototype `prototypes/consolidation-2026-05-06/home.html` and lists any cuts in the chunk's PR description.
- **Runs chart data source.** Reuse the existing chart-data endpoint that DashboardPage uses. Do NOT introduce a new analytics endpoint.

---

## Chunk C8 — Router wiring + sidebar config + delete old pages

**Goal.** Wire the new operate pages into the router, add the missing route patterns, update the sidebar config (single-row-per-stream policy), redirect the old run-trace admin paths, and delete the four replaced pages.

**Files modified.**
- `client/src/App.tsx` — replace `<Route path="/" element={<DashboardPage …>}>` with `<Route path="/" element={<HomePage …>}>`. Add `<Route path="/inbox" element={<InboxPage …>}>`, `<Route path="/activity" element={<ActivityPage …>}>`, `<Route path="/run-trace/:id" element={<RunTracePage …>}>`. Replace the two old admin run paths with redirects per the **locked redirect grammar** below. Remove the lazy imports and route mounts of the replaced pages.

**Locked redirect grammar (C8).** All builders implement these mappings exactly — no variation:

| From | To |
|---|---|
| `/admin/runs/:runId?<query>` | `/run-trace/:runId?<query>` (query string passed through verbatim) |
| `/admin/subaccounts/:subaccountId/runs/:runId?<query>` | `/run-trace/:runId?subaccountId=:subaccountId&<query>` (route param promoted to a `subaccountId` query param; existing query keys preserved; if the inbound query already has `subaccountId`, the path-param value wins) |
| `/admin/agent-inbox?<query>` | `/inbox?<query>` |
| `/subaccounts/:subaccountId/agent-inbox?<query>` | `/inbox?subaccountId=:subaccountId&<query>` (same promotion rule) |

Implementation pattern: a small `redirectToOperate(routeParams, search)` helper in `App.tsx` (or a colocated `client/src/lib/operateRedirects.ts`) builds the target URL deterministically. Use `<Navigate replace>` so the old URL is removed from history. Hash fragments (if any) pass through unchanged.

**Deterministic query-param ordering (locked).** When a path param is promoted to a query param (the `subaccountId` rows above), the helper emits the **promoted param FIRST**, followed by the inbound query keys in their original insertion order. Concretely: build the target via `new URLSearchParams()`, `set('subaccountId', :subaccountId)` first (overwriting any inbound key — path-param wins per the conflict rule), then iterate the inbound `URLSearchParams` and `append` only keys that are not `subaccountId`. The helper MUST NOT sort, dedupe non-conflicting keys, or otherwise reorder — this guarantees stable URLs for snapshot tests, log diffs, and analytics correlation, and prevents drift if a future contributor changes how `URLSearchParams` is iterated.
- `client/src/config/routes.ts` — add `/inbox`, `/activity` to `APP_ROUTE_PATTERNS`. (`/run-trace/:id` was added in C4.) Note: `/system/activity` already exists; keep it pointing at the new `<ActivityPage>` with system scope.
- `client/src/config/sidebar.ts` — edit ONLY the rows for Home/Inbox/Activity per spec §9 single-row-per-stream policy. Adjust labels and `to:` targets to match the new routes. Inbox row uses `staticRoute('/inbox')`; Activity row uses `staticRoute('/activity')`. Do NOT touch other groups (Spec B / C territory).

**Files deleted.**
- `client/src/pages/DashboardPage.tsx`.
- `client/src/pages/InboxPage.tsx`.
- `client/src/pages/ActivityPage.tsx`.
- `client/src/pages/RunTraceViewerPage.tsx`.

**Contracts implemented.** Spec §1 goal 1 (routing), §9 single-row-per-stream policy.

**Dependencies.** C5, C6, C7, C5b. (C4 alone is not enough; the router must not point at a page that depends on C5b's renderer placeholder.)

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Acceptance.**
- All verification commands pass.
- Manual smoke: visiting `/`, `/inbox`, `/activity`, `/run-trace/:id` renders the new pages. Each redirect in the locked grammar table above produces the exact target URL (verify subaccount path-param promotes to `?subaccountId=...` query, existing query keys preserved, hash fragment preserved, history `replace` behaviour). Old paths are no longer reachable.
- Static check: `grep -r "DashboardPage\|InboxPage\|ActivityPage\|RunTraceViewerPage" client/src` returns zero hits (other than the deletions themselves).

**Risks / open questions.**
- **Subaccount-scoped activity route.** `/admin/subaccounts/:subaccountId/activity` currently points at `<ActivityPage>`. Decision: keep it pointing at the NEW operate `<ActivityPage>`, with the page reading the `:subaccountId` param to scope the fetch. This stays inside the spec §9 single-row-per-stream policy because the sidebar row is still one entry.
- **Inbox routes currently nested.** Existing paths like `/admin/agent-inbox` and `/subaccounts/:subaccountId/agent-inbox` exist (per `activityService.ts` `detailUrl`). Resolved by the locked redirect grammar above: both redirect to `/inbox` with `subaccountId` promoted to query when present.
- **Sidebar review-count badge.** Sidebar Home item carries `badge: reviewCount`. Continue to populate from existing source; no change.

---

## Chunk C9 — Doc-sync

**Goal.** Update `architecture.md` and `KNOWLEDGE.md` to match the new operate surface.

**Files modified.**
- `architecture.md` — "Key files per domain" table: add Home/Inbox/Activity/Run-trace rows pointing at the new files; remove rows pointing at deleted files. Note new routes in any route-table entries.
- `docs/capabilities.md` (only if a capability description references a deleted page or path) — verify and patch under the editorial rules.
- `KNOWLEDGE.md` — append entries ONLY if a non-obvious gotcha was hit during build. Do NOT add boilerplate "we built operate" entries. Likely candidates: the `inboxService` naming reconciliation, the `triggerType` vs `triggerSource` field-rename caution, the masking-precedence-over-truncation rule.

**Files NOT modified.** Foundation specs, consolidation-foundation files, Spec B/C territory.

**Contracts implemented.** None — doc-sync only.

**Dependencies.** All prior chunks.

**Verification commands.**
- `npm run lint`
- `npm run typecheck` (unaffected by docs but cheap to run as a sanity check that no import paths broke)

**Acceptance.**
- Verification commands pass.
- `grep -n "DashboardPage\|RunTraceViewerPage" architecture.md` returns zero hits.

**Risks / open questions.**
- **Capabilities editorial rules.** Any `docs/capabilities.md` edit must obey vendor-neutral, model-agnostic rules per `CLAUDE.md` Editorial Rules pointer. Builder reads those before editing.

---

## Cross-cutting risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `inboxService` naming reconciliation breaks the spec's idempotency guarantee (§6 assumes single `status` column). | High | Per-kind state predicates documented in C2 risk list. Failure-kind items return `400 inbox_action_not_applicable` for approve/reject. |
| Run-trace masking projection accidentally applied to agent execution loop, leaking masked text into the LLM. | Medium | C5b risk row 1: builder MUST modify the read endpoint, not the write/append path. PR description must name which file was modified and confirm `appendMessage` is unaffected. |
| `?embedded=1` iframe steals focus or scroll position from parent. | Medium | C4 sandbox attribute (`allow-scripts allow-same-origin allow-forms`). Manual verification at G2 explicitly tests the parent scroll/focus invariant. |
| `clearAllFilters()` mechanism is brittle. | Low | Resolved: page owns a `tableResetNonce` and remounts `<SortableTable>` via `key={…}`. **No direct writes into SortableTable's localStorage shape.** If remount proves insufficient (e.g. sort state should survive a filter-reset), escalate to a Spec-0 patch adding an imperative `clearAllFilters()` ref API. |
| Old run-trace deep links (`/admin/runs/:runId`) break in shared bookmarks or email links. | Low | C8 redirects preserve query string. Add a 30-day soft deprecation banner if operator wants — not in scope for this stream. |
| Existing `triggerType` consumers (e.g. AgentActivityTab) regress when we add `triggerSource`. | Low | Resolved: emit BOTH fields during this stream; deprecate `triggerType` in C9. |
| Snooze UI present but no persistence column → broken UX. | N/A | Resolved: snooze removed from C2/C3/C6 entirely (deferred to follow-up). No `/snooze` endpoint, no `'snooze'` action in `InboxItem.actions`, no snooze button. |
| Cursor regressions when `sortDir` flips (skipped or duplicated rows). | Medium | Resolved: C1 locks the secondary-tiebreaker-direction-follows-primary invariant; legacy `id ASC` under `createdAt DESC` preserved only for the `attention_first` shim. JSDoc on `buildCursorPredicate` documents the rule. |
| `filterOptions` counts reflect only the visible page rather than the filtered set. | Low | Resolved: C1 locks pre-pagination aggregation as an invariant in code + JSDoc. |
| Embedded run-trace iframe opens another embedded run-trace (recursion). | Low | Resolved: C4 + C5b share the embedded-mode recursion guard; affordances are suppressed when `embedded === true`. |
| Cost MTD KPI failure blanks the entire Home strip. | Medium | Resolved: C7 locks per-tile loading/error isolation; tiles fetch independently and render their own state. |
| Run-trace masking projection cached across roles by future infra. | Low | Resolved: C5b locks `Cache-Control: private, no-store` on the read endpoint; comment block explains the why so a future "let's cache this" PR confronts role-sensitivity first. |
| Old deep-link redirects implemented inconsistently across builders. | Low | Resolved: C8 locks the four-row redirect grammar table; helper `redirectToOperate` is the single source. |
| Debounced search races (older response overwrites newer state). | Medium | Resolved: C5 + C6 use a per-fetcher `requestSeq` ref with latest-request-wins discard on resolve. |

## Self-consistency notes

- **Goals (spec §1) ↔ chunks.** Each goal has a chunk: G1 → C5+C6+C7+C4+C8; G2 → C4+C5+C7 (workspace badges); G3 → C1+C2 (extend, don't break); G4 → all chunks (no cross-stream backend changes).
- **Source-of-truth precedence.** Activity item shape: shared `ActivityItem` rendered by both Home widget and Activity page (C5 row component). Run-trace masking: backend projection (C5b). Inbox item state: per-kind canonical column (C2 reconciliation table).
- **No backward references.** C3 needs C1+C2; C5 needs C3+C4; C6 needs C3; C7 needs C5; C5b needs C4; C8 needs C5+C6+C7+C5b. Verified.
- **Deferred items (spec §10) are NOT in scope.** No bulk multi-select; no keyboard shortcuts; no audit log UI; no CSV/JSON export; no permalink/comment; no realtime push; no virtualisation.

## Builder hand-off checklist

**Parallel-eligible (run as separate builder sessions if the operator wants concurrency):**
- C1 (activity API) — no in-stream dependencies.
- C2 (inbox API) — no in-stream dependencies.
- C4 (run-trace page) — no in-stream dependencies (uses foundation Modal which is on main).

**Sequenced (must wait):**
- C3 — gate on C1 + C2.
- C5 — gate on C3 + C4.
- C6 — gate on C3.
- C7 — gate on C5.
- C5b — gate on C4 (can run concurrent with C5/C6/C7 once C4 lands).
- C8 — gate on C5 + C6 + C7 + C5b.
- C9 — gate on C8 (last).

**Estimated builder days:** 4–5 days for one Sonnet builder running serially. With parallel C1/C2/C4 and parallel C5/C6/C7/C5b mid-build, estimate compresses to ~3 days wall-clock.

**Mandatory pre-build checks:**
1. Verify branch is `ui-consolidation-operate`. Do NOT switch.
2. Confirm Phase 0 foundation primitives are present on `main` (spot-check `client/src/components/Modal.tsx` has `size`/`footer`/`zIndex`/`bodyPadding` props; `client/src/components/SortableTable.tsx` exports `ColumnDef`).
3. Read `tasks/builds/consolidation-2026-05-06/patterns.md` § 1, 2, 3, 4, 6 before C4/C5/C6/C7.
4. Read `prototypes/consolidation-2026-05-06/{home,inbox,activity,run-trace}.html` only when a §4 contract is ambiguous; spec is canonical.

**Spec gaps — RESOLVED (operator decision, 2026-05-07):**

1. **`triggerSource` vs `triggerType` field naming.** **RESOLVED — emit both.** During this stream, the API emits both `triggerType` (existing) and `triggerSource` (new spec name) on every `ActivityItem`. C9 doc-sync notes that `triggerType` is deprecated; removal is a follow-up after consumers migrate. Builder: do NOT rename in place — additive only.

2. **`inbox_read_states.snoozed_until` column.** **RESOLVED — column does NOT exist** (verified against `server/db/schema/inboxReadStates.ts` — only `isRead` / `isArchived` / `readAt` are present). Snooze is **deferred** to a follow-up rather than break the spec's "no new migrations" pledge. **C2 scope change:**
   - DROP the `POST /api/inbox/:id/snooze` endpoint from C2.
   - DROP `'snooze'` from `InboxItem.actions` for every kind in C3 (`shared/types/operate.ts`).
   - DROP the snooze button from `<InboxItemCard>` in C6.
   - DROP "snoozed override" from the band-derivation Pure rule set in C2 (treat read/archived as the only "previous" inputs).
   - Add to spec §10 deferred items in C9: "Inbox snooze (per-user, time-bound) — pending `inbox_read_states.snoozed_until` migration."

3. **Frontend run-trace data fetch endpoint identity.** **RESOLVED — builder confirms via grep at C5b kickoff.** Most likely target: `server/routes/agentRuns.ts` `/runs/:runId/messages` (or equivalent read path). Builder runs `grep -rn "agentRunMessageService\|/runs/.*messages" server/routes` at C5b start, picks the read endpoint that serves the UI today, applies the role-aware projection there. The append/write path remains untouched (cross-cutting risk row 2 stands). If the grep finds two plausible read endpoints, pick the one wired into `RunTraceViewerPage.tsx`'s current fetch (trace through `client/src/lib/api.ts` or component imports).

4. **Inbox `reject` reason persistence column.** **RESOLVED — default to existing column; if absent, capture nothing.** Builder checks for `review_items.reviewerComment` (or equivalent existing free-text column) at C2 start. If present: `rejectItem(reason)` writes the reason there. If absent: the inline reject input remains in the UI for UX continuity, but the reason is logged via the existing audit/event trail only — no new column. C2 risk row updated accordingly.

**No remaining gaps. Proceed to C1.**
