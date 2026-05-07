**Status:** draft
**Spec date:** 2026-05-07
**Last updated:** 2026-05-07 (round 2 — bucket-1/bucket-2 polish folded in; foundation Phase 0 patch assumed available)
**Author:** michael
**Build slug:** consolidation-operate
**Depends on:** `tasks/builds/consolidation-foundation/spec.md` (Phase 0; primitives must land first)

---

# Consolidation A — Operate

> Phase-2 stream A of the four-spec consolidation programme. Delivers the run-time observation and approvals surface: the consolidated **Home** dashboard, **Inbox** (priority bands), **Activity** (drawer + modal + per-column sort/filter), and **Run trace** (full page + iframe-embedded modal). Builds against the primitives delivered by Spec 0 (Modal/Drawer/SortableTable/WorkspaceBadge/PageShell/sidebar config/useViewMode).

## Table of contents

0. Programme context
1. Goals
2. Non-goals
3. Existing primitives audit
4. Public API contracts
5. File inventory
6. Permissions / RLS / Execution model
7. Phase / chunk plan
8. Testing posture
9. Coordination with Foundation, B, C
10. Deferred items
11. Self-consistency check
12. Pre-review checklist

## 0. Programme context

The 2026-05-06 prototype consolidates ~25 existing pages into ~12. Spec A owns the **Operate** surface — what's running, what needs my attention, what just happened. The reference prototypes are `prototypes/consolidation-2026-05-06/{home,inbox,activity,run-trace}.html`. Cross-cutting interaction patterns are defined in `tasks/builds/consolidation-2026-05-06/patterns.md` § 1 (modal), § 2 (activity drawer/modal), § 3 (run-trace popup), § 4 (cross-page workspace switching), § 6 (inbox priority bands).

This spec assumes `consolidation-foundation` has shipped or is in flight. The contracts in foundation §4 (Modal extension, Drawer, SortableTable, WorkspaceBadge, PageShell, useViewMode, sidebar config) are treated as locked. A/B/C run in parallel against those contracts; this stream owns no shared primitives.

## 1. Goals

1. Replace `DashboardPage`, `InboxPage` (and its sub-views), `ActivityPage`, `RunTracePage` with a consolidated set of pages that match the prototype: a single Home dashboard, a three-band Inbox, an Activity feed with drawer + modal interactions, and a Run-trace page that doubles as an in-page modal.
2. Wire the cross-page interactions: Activity row → Activity modal → Run-trace modal (iframe-embedded). Workspace badges clickable for org-admin profiles, switching `activeClient` and reloading.
3. Keep the existing backend domain APIs in place where they already work (activity feed, agent runs, approvals). Extend only what the new UI surface demands.
4. Ship without changing any backend route under another stream's domain (no agent CRUD changes, no spend or knowledge changes).

## 2. Non-goals

1. Building any of the Build-stream pages (agents list, agent edit, recurring tasks, project edit) or Govern-stream pages (knowledge, spending, integrations). Those are owned by Specs B and C.
2. Replacing the agent execution engine, the run lifecycle state machine, or the existing approval mechanic. This stream consumes those, doesn't redefine them.
3. Introducing a new identity primitive. "Workspace" remains a UI synonym for the existing client/sub-account.
4. Adding a UI test framework. Frontend tests remain `none_for_now` per `docs/spec-context.md`.
5. Building any cross-cutting frontend primitive. If a missing primitive surfaces during build, route the request back into a Spec-0 patch — do not bolt it into this stream.

## 3. Existing primitives audit

| Primitive | Existing | Verdict | Reason |
|---|---|---|---|
| Activity feed API | `server/routes/activity.ts` + `server/services/activityService.ts` (+ `activityServicePure.ts`) | **Extend** | Already serves the existing ActivityPage. Extend with cursor-paged listing supporting per-column filtering + sort; no new domain logic. |
| Agent activity service | `server/services/agentActivityService.ts` | Reuse | Source of activity records. No change. |
| Inbox / approvals API | `server/routes/inbox.ts`, `server/routes/agentInbox.ts`, `server/services/agentInboxService.ts` (assumed) | **Extend** | Existing inbox surfaces approval items. Extend with grouping by priority band (high/needs-action/previous) and explicit action endpoints (approve/reject/snooze) where missing. |
| Approval channels | `server/routes/approvalChannels.ts` | Reuse | No change. |
| Agent runs API | `server/routes/agentRuns.ts` | Reuse | Run trace consumes by run id. |
| Run trace service | (existing — `agentRunMessageService.ts`, `agentRunSnapshotService` if present) | Reuse | Run trace surface reads from existing run-message + step records. |
| Workflow runs | `server/routes/workflowRuns.ts` | Reuse | Run trace also handles workflow runs by id. |
| Frontend Modal primitive | Foundation §4.1 (`<Modal>` extended) | Consume | Activity modal + Run-trace iframe-embedded modal both use foundation Modal with `size`, `footer`, `bodyPadding`, `zIndex` props. |
| Frontend Drawer primitive | Foundation §4.2 (`<Drawer>`) | Consume | Activity table row click opens drawer (current prototype pattern); modal is the alternate trigger from Home. |
| Frontend SortableTable | Foundation §4.3 (`<SortableTable>`) | Consume | Activity feed table uses it (Type/Status/Actor/Subaccount filterable; Created sortable default desc). |
| Frontend WorkspaceBadge | Foundation §4.5 (`<WorkspaceBadge>`) | Consume | Used in activity rows, drawer, modal, run-trace embedded page. |
| Frontend PageShell | Foundation §4.8 | Consume | Each new page wraps in `<PageShell>` with appropriate `bottomPadding`. |
| Existing DashboardPage | `client/src/pages/DashboardPage.tsx` | **Replace** | Consolidated Home page replaces it. Existing widgets (KPIs, runs chart, activity widget) re-implemented against the new layout. |
| Existing InboxPage | `client/src/pages/InboxPage.tsx` (assumed) | **Replace** | Re-implemented with three priority bands per prototype § 6. |
| Existing ActivityPage | `client/src/pages/ActivityPage.tsx` (assumed) | **Replace** | Re-implemented with `<SortableTable>` + drawer + modal. |
| Existing RunTracePage | `client/src/pages/RunTracePage.tsx` (assumed) | **Replace / extend** | Re-implemented to support `?embedded=1` query flag that hides chrome (sidebar, breadcrumbs, replaces-strip, topbar). The full-page mode keeps existing functionality. |
| `<SearchBox>` (foundation Phase 0 patch) | Foundation §4.9 | Consume | Inbox search, Activity search, Run-trace step search. |
| `<EmptyState>` / `<ErrorState>` (foundation Phase 0 patch) | Foundation §4.10/4.11 | Consume | Inbox empty bands, Activity zero-rows, Home widgets, Run-trace error states. |
| `<ConfirmDialog>` | `client/src/components/ConfirmDialog.tsx` | Reuse | Inbox archive confirmation, run-trace destructive admin actions. |

**Out-of-scope items (deliberately deferred — see §10):** bulk multi-select on Inbox/Activity, keyboard shortcuts, audit-log UI, CSV/JSON export, run-trace step-level commenting/permalinks, real-time WebSocket push.

**Verdict summary:** four pages replaced, two backend routes extended (activity, inbox), no new tables, no new services. All shared frontend primitives consumed from foundation; this stream introduces zero new shared components.

## 4. Public API contracts

### 4.1 Activity feed — extended list endpoint

`GET /api/activity` (existing route in `server/routes/activity.ts`).

**Request query parameters (additive):**

```ts
interface ActivityListQuery {
  scope?: 'workspace' | 'org' | 'system';   // matches viewMode; org/system require permission
  cursor?: string;                           // opaque; see cursor invariant below
  limit?: number;                            // default 50, max 200
  // Filters (multi-select; AND across keys, OR within a key)
  // SQL mapping: WHERE (type IN (...)) AND (status IN (...)) AND (actor IN (...)) ...
  // Empty array = ignore that filter dimension; undefined ≠ empty array (undefined = not set)
  type?: string[];                           // e.g. ['agent_run', 'memory.created']
  status?: string[];
  actor?: string[];
  subaccount?: string[];                     // org/system scope only
  severity?: ('critical' | 'warning' | 'info')[];
  // Sort
  sortKey?: 'createdAt' | 'type' | 'subject' | 'status' | 'actor' | 'severity' | 'subaccount' | 'duration';
  sortDir?: 'asc' | 'desc';                  // default createdAt desc
  // Free text (applied after filters: WHERE <filters> AND <search predicate>)
  q?: string;                                // searches subject + actor + typeLabel
}
```

**Cursor invariant:**
- Cursor encodes `(sortKeyValue, id)` — the sort always includes `id` as a deterministic tiebreaker (e.g. `ORDER BY createdAt DESC, id DESC`).
- Cursor is invalidated if `sortKey`, `sortDir`, or any filter changes between requests. Server must **always ignore** a cursor whose encoded context does not match the current request parameters (never return an error for cursor mismatch); on mismatch, respond as if `cursor` was absent (restart from page 1). Uniform ignore-and-restart avoids client branching and keeps infinite-scroll UX smooth.

**Sort stability:** every sort order must include `id` as a secondary key to prevent flickering rows across pages.

**Response:**

```ts
interface ActivityListResponse {
  items: ActivityItem[];
  nextCursor: string | null;
  filterOptions: {
    type: Array<{ value: string; label: string; count: number }>;
    status: Array<{ value: string; label: string; count: number }>;
    actor: Array<{ value: string; label: string; count: number }>;
    subaccount: Array<{ value: string; label: string; count: number }>;
  };
}
```

**filterOptions count semantics (faceted search rule):** counts are computed against the full result set for the current `scope` and `q`, ignoring pagination but respecting all active filters *except* the dimension being counted. This prevents misleading zero-counts for a dimension the user is currently filtering on.

**filterOptions scaling note:** if the result set for a scope exceeds ~50k rows, the implementation may use cached or approximate counts for filterOptions rather than re-running full aggregations per request. Cached counts should be refreshed on write or on a short TTL. This is not a Phase 1 requirement — note it here so a future "why is Activity slow?" diagnosis has a known fix path.

interface ActivityItem {
  id: string;
  type: string;                              // dotted key, e.g. 'email.sent'
  typeLabel: string;
  subject: string;
  status: 'attention_needed' | 'active' | 'completed' | 'failed' | 'cancelled';
  actor: string;
  actorType: 'agent' | 'human' | 'system' | 'schedule';
  severity: 'critical' | 'warning' | 'info' | null;
  subaccount: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  runId: string | null;
  createdAt: string;                         // ISO
  durationMs: number | null;
  detail: Record<string, unknown>;           // type-specific JSONB; consumed by drawer/modal
}
```

**Producer:** `activityService.ts`. **Consumer:** `<ActivityPage>` and `<HomeRecentActivity>`. **Filter options shape** mirrors what `<SortableTable>` expects via `getFilterOptions` (foundation §4.3) so the page wires server-resolved options instead of deriving from the rendered page slice.

### 4.2 Inbox — priority-banded list

`GET /api/inbox?band=high|needs_action|previous` (extends existing `server/routes/inbox.ts`).

```ts
interface InboxListResponse {
  band: 'high' | 'needs_action' | 'previous';
  items: InboxItem[];
  nextCursor: string | null;
}

interface InboxItem {
  id: string;
  kind: 'approval' | 'review' | 'belief_conflict' | 'failure' | 'archived';
  title: string;
  body: string;
  actions: Array<'approve' | 'reject' | 'snooze' | 'open' | 'archive'>;
  subaccount: { id: string; name: string } | null;
  createdAt: string;                         // "Added: <date>" or "Triggered: <date>" — caller chooses by kind
  dueAt: string | null;
  meta: Record<string, unknown>;
}
```

**Action endpoints** (extending existing inbox routes; idempotent):

- `POST /api/inbox/:id/approve`
- `POST /api/inbox/:id/reject`
- `POST /api/inbox/:id/snooze` body `{ until: ISO }`
- `POST /api/inbox/:id/archive`

Each action returns `{ ok: true, item: InboxItem }`. Concurrency guard: state-based predicate `UPDATE ... WHERE status = 'pending'` — second caller of the same action gets `200 { ok: true, alreadyApplied: true }` (no error). Source-of-truth precedence: the `inbox_item.status` column wins over any cached representation.

### 4.3 Run trace — embedded mode

`GET /run-trace/:id` (frontend route). Adds support for `?embedded=1` query flag.

When `embedded=1`:
- Hide sidebar (Layout sidebar mount), topbar, breadcrumb, replaces-strip.
- Render `.run-layout` at `height: 100vh`, no margin.
- Workspace badges inside the page remain clickable per foundation §4.5 (still triggers `setActiveClient` + reload, which reloads the iframe with the new active client).
- **Isolation invariant:** embedded mode must not mutate the parent page's scroll position or steal focus from the parent document. The `<iframe>` should be sandboxed (`sandbox="allow-scripts allow-same-origin allow-forms"`) where the hosting platform permits it.

Backend contract unchanged — the embedded flag is a frontend-only mode.

### 4.4 Activity modal payload (frontend contract)

The Activity modal opened from the Home recent-activity widget consumes the same `ActivityItem` shape from §4.1. Source-of-truth precedence: when the same activity row appears in the Home widget and the Activity page, both render from a shared `ActivityItem` (no separate Home-specific shape).

### 4.5 Cross-page workspace switching

Wired per foundation §4.5 (`<WorkspaceBadge>`). Operate-stream pages render badges in:
- Activity table rows + drawer + modal.
- Home recent-activity widget rows + Activity modal.
- Run-trace embedded mode header.

Click → `setActiveClient(clientId, clientName)` → page reload. For an iframe-embedded run-trace, the parent page's `activeClient` is updated and the iframe reloads with the new context.

### 4.6 Inbox priority-band UX (frontend contract)

Per `patterns.md § 6`. Three collapsible bands:
- HIGH PRIORITY (red left border, default expanded)
- NEEDS ACTION (amber left border, default expanded)
- PREVIOUS (slate border, default collapsed)

Items render with action buttons top-right and a "Added: <date>" / "Triggered: <date>" label bottom-right. Band header is `position: sticky; top: 0`. No keyboard-hint micro-copy.

### 4.7 Page-level full-text search

Each list page (Inbox, Activity) renders `<SearchBox>` (foundation §4.9, debounced 200ms) wired to the `q` query parameter:

- **Inbox** `q` searches `title + body + actor.name`. Bands collapse if no items match within them.
- **Activity** `q` searches `subject + actor + typeLabel`. Existing search behaviour (already implemented in the prototype) is preserved verbatim.
- **Run-trace** an inline search filters the step list by step name / event type. Page-local; no backend round-trip.

**Search + filter interaction:**
- `q` is applied *after* filters: `WHERE <filters> AND <search predicate>`.
- Clearing the search box (`q = ''`) does NOT clear column filters; they remain active.
- The "Clear filters" action (on `<EmptyState>` and `<SortableTable>`) resets both column filters *and* `q`.

Empty results render `<EmptyState title="No matches" body="Try clearing filters or search">` with a "Clear filters" secondary action that calls `<SortableTable>`'s `clearAllFilters()` (foundation Phase 0 patch §4.3 addition).

### 4.8 Sensitive data masking on run-trace

LLM call payloads, tool-call arguments, and tool-call results may contain PII (emails, phone numbers, customer names) and prompts may leak system instructions. Run-trace masks these by role:

| Field | Workspace user | Org admin | System admin |
|---|---|---|---|
| Step name + status + duration + cost | Visible | Visible | Visible |
| Tool call **arguments** | Masked (`<redacted>`) | Visible | Visible |
| Tool call **result body** | First 200 chars only | Visible | Visible |
| LLM **system prompt** | Masked | Masked | Visible |
| LLM **user prompt + completion** | Visible (own workspace only) | Visible | Visible |
| Raw event JSON modal | Disabled | Read-only | Read-only with "copy" |

Backend determines masking and emits the appropriate fields; the frontend never decides what to show. Consumer-visible field names remain stable across roles (masked fields return `null` or the mask token, never omitted) so the renderer doesn't branch on role. Producer: extend existing run-trace assembly in `server/services/agentRunMessageService.ts` (or equivalent) with a role-aware projection. Source-of-truth precedence: the backend projection is the SoT; the frontend never re-derives.

**Redaction token contract:**
- The exact mask token string is `"<redacted>"` — no other string, no `null`, no omission.
- Masked fields must always be present in the response (never absent); the renderer must never need to branch on field presence.
- Truncated fields (e.g. tool-call result first 200 chars) must include `truncated: true` alongside the value so the renderer can show a "truncated" indicator without inspecting string length.
- **Masking takes precedence over truncation:** if a field is both masked and would be truncated, return `"<redacted>"` with no `truncated` flag. The `truncated` flag is only present when the field is visible but partial.

### 4.9 Activity / Run-trace event metadata depth

Several existing fields are already in the data model but not surfaced:

- **Activity row**: add `triggerSource` field (`schedule | event | manual | api | retry | unknown`) so Home and Activity tables can render a "Source" column. Already derivable from `agent_run.trigger_kind`; expose in the API response. If `trigger_kind` is unavailable or unmapped, emit `"unknown"` (never `null`, never omit).
- **Run-trace LLM events**: render `tokensIn` / `tokensOut` / `costUsd` (already on `agent_run_messages.metadata`). Add to the run-trace event renderer.
- **Run-trace tool-call events**: render `durationMs` (already on the row). Add a small "↔ matching result" affordance that scrolls the matching `tool_result` event into view (correlation by `tool_call_id`).
- **Activity severity dot**: small inline legend (`<span class="severity-legend">critical / warning / info</span>` with three dots) renders above the table on first visit; sticky-dismissed via localStorage. Key: `activitySeverityLegendSeen:{userId}` — include the userId prefix so the flag is per-user in shared-browser environments (e.g. shared-login kiosk).

### 4.10 Confirmation dialogs on destructive actions

- Inbox **archive** (single item): no confirmation (reversible — items can be unarchived from Previous band).
- Inbox **reject**: inline reason input directly inside the row card (no modal). Reason field is optional but encouraged via placeholder copy.
- Run-trace admin actions (cancel run, force fail): `<ConfirmDialog>` with explicit consequence copy ("This will mark the run as failed. The agent will not retry.").
- No bulk actions in this stream — multi-select is deferred per §10.

## 5. File inventory

Files **created** by this spec:

| File | Purpose |
|---|---|
| `client/src/pages/operate/HomePage.tsx` | Consolidated Home dashboard (replaces `DashboardPage.tsx`) |
| `client/src/pages/operate/InboxPage.tsx` | Three-band Inbox (replaces existing `InboxPage`) |
| `client/src/pages/operate/ActivityPage.tsx` | Activity feed with `<SortableTable>` + drawer + modal |
| `client/src/pages/operate/RunTracePage.tsx` | Run trace, with embedded-mode support |
| `client/src/pages/operate/components/ActivityRow.tsx` | Row renderer used by both Activity table and Home widget |
| `client/src/pages/operate/components/ActivityDetailModal.tsx` | Modal opened from Home; uses foundation `<Modal size="md">` |
| `client/src/pages/operate/components/RunTraceModal.tsx` | Modal that wraps run-trace.html in an iframe; uses foundation `<Modal size="iframe" zIndex={1010}>` |
| `client/src/pages/operate/components/InboxBand.tsx` | Collapsible band wrapper (high / needs-action / previous) |
| `client/src/pages/operate/components/InboxItemCard.tsx` | One inbox item row (with inline reject-reason input) |
| `client/src/pages/operate/components/SeverityLegend.tsx` | Tiny dismissible legend for Activity severity dots |
| `client/src/pages/operate/components/RunTraceEventRenderer.tsx` | Renders LLM/tool/event rows with masking applied per role |
| `shared/types/operate.ts` | TypeScript types for `ActivityItem` (with `triggerSource`), `InboxItem`, run-trace event shapes (with masking) |
| `tasks/builds/consolidation-operate/plan.md` | Implementation plan written by `architect` after spec accepted |

Files **modified** by this spec:

| File | Change |
|---|---|
| `server/routes/activity.ts` | Add cursor-paged list with multi-select filters + sort + filterOptions response (additive) |
| `server/services/activityService.ts` (+ `*Pure.ts`) | Add filtered list assembly; existing exports unchanged |
| `server/routes/inbox.ts` | Add `?band=` query parameter; add `/snooze` and `/archive` action endpoints if missing; add `q` search parameter |
| `server/services/agentInboxService.ts` (or equivalent) | Add band derivation logic + snooze/archive + search |
| `server/services/agentRunMessageService.ts` (or equivalent run-trace assembler) | Add role-aware masking projection per §4.8 |
| `client/src/App.tsx` (or router config) | Re-route the consolidated paths: `/`, `/inbox`, `/activity`, `/run-trace/:id` |
| `client/src/config/sidebar.ts` (foundation file) | Add/relabel rows: Home, Inbox, Activity (under Work group). Single-row-per-stream policy per foundation §9. |

Files **NOT modified** by this spec:

- Any file under `server/routes/` for agents, projects, recurring tasks, knowledge, spend, integrations (Spec B and C territory).
- Any DB schema. No new tables, no new migrations.
- Any foundation primitive (`Modal.tsx`, `Drawer.tsx`, `SortableTable.tsx`, `WorkspaceBadge.tsx`, `PageShell.tsx`, `useViewMode.ts`). If a primitive needs a new prop, it goes in a Spec-0 patch.
- Any shared CSS class beyond page-scoped additions (e.g. `.inbox-band`, `.activity-row`, `.run-trace-toolbar` are page-local).

**No new tables, no new migrations, no new permissions, no new background jobs.**

## 6. Permissions / RLS / Execution model

**Permissions:**
- Activity feed list, Inbox list, Run trace read: existing `requirePermission` chains on `activity.ts`, `inbox.ts`, `agentRuns.ts`. No new permission keys.
- `scope=org` on activity feed: requires `org_admin` (existing helper).
- `scope=system` on activity feed: requires system admin override (existing helper).
- Inbox actions (approve/reject/snooze/archive): use the existing approval permission gates on `inbox.ts`. Do not introduce a new gate.
- **Run-trace role-aware masking** (§4.8): backend determines visible fields by user role. No new permission keys; reads existing `req.user.role` + `system_admin_org_override` state.

**Frontend permission gating (action visibility):**
- Inbox approve/reject/snooze/archive buttons hidden when user lacks the inbox-write permission. Backend still enforces; frontend hide is UX-only.
- Run-trace admin actions (cancel run, force fail) hidden for non-org-admin users. Backend enforces.
- Home spend widget (cost MTD KPI) hidden for non-org-admin users. Backend's existing role gate applies; frontend reads identity from auth helper to decide visibility.

**RLS:** No new tenant-scoped tables. Existing tables (`activity_events`, `inbox_items`, `agent_runs`) are already covered by RLS per `architecture.md §1155`. Multi-select filter logic must respect the existing predicate (e.g. when `scope=workspace`, the activity query filters by `subaccount_id = activeClient.id`).

**Execution model:**
- Activity list: synchronous, cached at the route layer (existing pattern). Adding filter/sort doesn't change the synchronous boundary.
- Inbox list: synchronous.
- Inbox actions: synchronous, state-based idempotency (`UPDATE ... WHERE status = 'pending'`). Second caller of same action returns `200 { ok: true, alreadyApplied: true }` — never a 500.
- Run-trace embedded mode: pure frontend, no backend change.

**Idempotency / retry / concurrency:**
- Inbox approve/reject/archive: state-based, predicate guards racing writes. Optimistic predicate is the source-of-truth winner (DB serialises `UPDATE`).
- Snooze: idempotent; `UPDATE ... SET snoozed_until = $1`. Re-snoozing extends the window, not an error.
- HTTP mapping: never bubble `23505` as 500. Concurrency-loss responses use `200 alreadyApplied: true`.

**State machine:** No new state machine. Inbox uses the existing approval lifecycle:

```
pending → approved | rejected | snoozed | archived
```

All action endpoints MUST enforce `WHERE status = 'pending'`. An item in any other state (already snoozed, already archived, etc.) returns `200 { ok: true, alreadyApplied: true }` — never a 4xx or 5xx. Spec adds no new states.

## 7. Phase / chunk plan (preview — architect will finalise)

| Chunk | Scope | Depends on |
|---|---|---|
| C1 | Backend: extend `activity.ts` route + `activityService.ts` with cursor-paged list, multi-select filters, sortKey/sortDir, filterOptions response | Foundation merged (no, just SortableTable contract) |
| C2 | Backend: extend `inbox.ts` with `?band=`, action endpoints, state-based idempotency | — |
| C3 | Frontend: `shared/types/operate.ts` + API client wrappers in `client/src/lib/api.ts` (additive) | C1, C2 |
| C4 | Frontend: `RunTracePage.tsx` rewrite with embedded-mode flag (`?embedded=1`) | Foundation Modal extension |
| C5 | Frontend: `ActivityPage.tsx` with `<SortableTable>` + drawer + `<ActivityDetailModal>` + `<RunTraceModal>` | Foundation SortableTable, Drawer, Modal, WorkspaceBadge; C3, C4 |
| C6 | Frontend: `InboxPage.tsx` with three bands (`<InboxBand>` + `<InboxItemCard>`) | C3 |
| C7 | Frontend: `HomePage.tsx` with KPIs, Runs chart, Recent activity widget (uses ActivityRow + ActivityDetailModal) | Foundation PageShell; C5 |
| C8 | Sidebar config rows + router wiring + delete the old DashboardPage/InboxPage/ActivityPage/RunTracePage | C5, C6, C7 |
| C5b | Run-trace role-aware masking projection (backend §4.8) + `<RunTraceEventRenderer>` (frontend) | C4 |
| C9 | Doc-sync: `architecture.md` "Key files per domain" table updates; `KNOWLEDGE.md` only if a non-obvious gotcha was hit | All |

**Dependency graph:** C3 depends on C1+C2; C5 depends on C3+C4; C6 depends on C3; C7 depends on C5; C8 depends on C5+C6+C7. No backward references.

Estimated total: 4–5 days of one builder (sonnet). Single PR or two (split at C5/C6 if size warrants).

## 8. Testing posture

Per `docs/spec-context.md`:

```
testing_posture: static_gates_primary
runtime_tests: pure_function_only
frontend_tests: none_for_now
```

- **Static gates** (lint, typecheck, build:server, build:client) are the verification surface.
- **Pure-function tests** for: filter-options aggregator (groups counts by category), inbox band-derivation logic, run-trace embedded-flag URL parser. Each colocated `*Pure.test.ts`, invokable via `npx tsx <path>`.
- **No frontend tests, no E2E, no API-contract tests, no visual regression** — per framing.

**Manual verification at G2 (integrated state):**
- Activity table sorts on each sortable column and filters on each filterable column. Apply / Cancel / Esc / outside-click all behave per foundation §4.3 contract. Snapshot restores on Cancel.
- Activity row click opens drawer (per existing pattern). Activity item in Home widget click opens modal. Run-trace link inside modal opens iframe-embedded run-trace modal stacked above.
- Inbox bands collapse/expand. Approve / reject / snooze / archive work; clicking the same action twice does not 500.
- Run-trace `?embedded=1` hides chrome correctly; full-page mode unchanged.
- Workspace badges clickable for org admin; `setActiveClient` + reload propagates correctly into iframe-embedded run-trace.
- Existing pages (DashboardPage, etc) removed from router; visiting their old path 404s or redirects per router config.
- **Search** (per §4.7): `<SearchBox>` debounces correctly on Inbox and Activity; clearing the box restores full results.
- **Empty states**: empty Inbox bands render `<EmptyState>` with appropriate copy; empty Activity (after filters) renders empty state with "Clear filters" action.
- **Sensitive data masking** (per §4.8): test as workspace user, org admin, and system admin; verify the projection table at each role.
- **Severity legend**: dismissable on first visit; localStorage flag persists.
- **Confirmation dialogs**: run-trace cancel/force-fail show confirmation; inbox reject inline reason input works.
- **Action visibility**: workspace user does not see Home spend widget; non-org-admin does not see run-trace admin actions.

## 9. Coordination with Foundation, B, C

**Foundation primitives consumed (locked at the foundation §4 contract version this stream builds against):**

- `<Modal>` (foundation §4.1) — Activity modal (`size="md"`); Run-trace iframe modal (`size="iframe"`, `zIndex={1010}`, `bodyPadding="none"`).
- `<Drawer>` (foundation §4.2) — Activity table row click.
- `<SortableTable>` (foundation §4.3) — Activity feed table.
- `<WorkspaceBadge>` (foundation §4.5) — All workspace mentions across operate pages.
- `<PageShell>` (foundation §4.8) — Wrapper for all four operate pages.
- `useViewMode` (foundation §4.6) — Activity / Home view-mode awareness (workspace vs org vs system).

**Shared-file edit policy** (per foundation §9):

- `client/src/config/sidebar.ts`: this stream adds/edits only the rows for Home, Inbox, Activity. Spec B and C add their own rows.
- Production shared stylesheet: this stream may add page-scoped classes only (`.inbox-band`, `.activity-row`, etc). No edits to `.form-footer`, `.page-shell`, etc. — those are foundation territory.
- `shared/types/operate.ts`: scoped to this stream. Specs B and C own `shared/types/build.ts` and `shared/types/govern.ts` respectively. No cross-stream type sharing.
- DB migrations: none in this stream.

**Cross-stream integration points:**
- Activity feed displays runs from agents (Spec B's domain) and from spend events / connection events (Spec C's domain). Existing `agentActivityService.ts` already aggregates these — no cross-stream coupling introduced by this spec.
- Run-trace links from Activity items consume `agentRuns` (Spec B-adjacent) but the read API is already shared.

## 10. Deferred items

- **Real-time activity feed updates.** Phase 1 polls or reloads on user navigation. WebSocket / SSE push for activity is deferred until usage data shows manual reload is insufficient.
- **Activity / Inbox bulk operations.** Multi-select checkbox column + batch approve/reject/archive deferred to Phase 1.5 follow-up. Single-row actions only in Phase 1.
- **Activity / Inbox / Run-trace export to CSV/JSON.** Deferred. Single export-menu primitive, when introduced, will land as a foundation patch and apply across all list pages uniformly.
- **Keyboard shortcuts (A to approve, R to reject, J/K to navigate rows, etc).** Foundation Modal already has Esc + Tab focus trap. Page-level shortcuts deferred until a coherent global shortcut model lands.
- **Audit log / change history UI** for inbox actions, run-trace admin overrides. Data exists in `auditEvents.ts`; UI is its own spec.
- **Run-trace step-level commenting / annotation / permalinks.** Out of scope; existing commenting UX (if any) preserved as-is.
- **Activity feed virtualised rendering.** Foundation SortableTable defers virtualisation; this stream inherits.
- **Mobile responsive layout tuning.** Pages render reasonably on narrow viewports via PageShell defaults; deeper polish deferred.
- **Inbox per-kind approver-role gating** (different approvers for beliefs vs blocks vs memories). Today's inbox-write permission is uniform; per-kind gating deferred.
- **Run-trace event correlation visual graph** (TOOL_CALL ↔ TOOL_RESULT linkage as a visual line). Phase 1 ships a "scroll to matching event" link; the graph is a follow-up.

## 11. Self-consistency check

- Goals (§1) match Implementation (§4–7)? Yes — every page in §1 has a contract entry in §4 and a chunk in §7. Reuse-vs-new verdicts in §3 match the file inventory in §5.
- Every "must" / "guarantees" claim has a backing mechanism?
  - Inbox idempotency: state-based predicate named in §6.
  - Activity multi-select filter compose: AND across keys, OR within a key — explicitly stated in §4.1.
  - Run-trace embedded mode: pure frontend, no backend coupling — stated in §4.3.
- File inventory complete? Every page/component named in §4 appears in §5. Yes.
- Phase dependency graph clean? §7 lists C3 deps (C1+C2), C5 deps (C3+C4), C7 deps (C5). No backward references.
- Deferred items section exists? §10. Yes.
- Testing posture matches framing? §8 aligns with `frontend_tests: none_for_now`. Pure-function tests only.
- Permissions/RLS/execution-model statements explicit? §6.

## 12. Pre-review checklist

- [x] §0 No deferred-item references; greenfield consolidation.
- [x] §1 Every reused/extended primitive has a "why not new" entry in §3.
- [x] §2 Every new file is in §5.
- [x] §3 Public APIs in §4 include shape + types + producer/consumer.
- [x] §4 No new tenant-scoped tables — §6 declares the existing RLS coverage.
- [x] §5 Execution model declared synchronous + state-based idempotency in §6.
- [x] §6 Phase graph in §7 acyclic.
- [x] §7 `## Deferred Items` (§10) present.
- [x] §8 Self-consistency pass complete (§11).
- [x] §9 Testing posture matches framing (§8).
- [x] §10 Inbox-action concurrency guard + HTTP mapping declared in §6.
- [x] §11 Frontmatter present (top of file).

Spec ready for `spec-reviewer`.
