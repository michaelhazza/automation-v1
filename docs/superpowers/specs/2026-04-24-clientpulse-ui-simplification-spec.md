# ClientPulse UI Simplification — Implementation Spec

**Status:** Approved — ready for implementation (4 rounds of external review completed; no remaining design gaps)
**Date:** 2026-04-24
**Branch target:** off `main` (current: `claude/cached-context-infrastructure-fcVmS`)
**Research foundation:** `tasks/builds/clientpulse-ui-simplification/audit.md` (superseded as implementation guide)
**Original build specs (historical record only):**
- `tasks/builds/clientpulse/session-1-foundation-spec.md`
- `tasks/builds/clientpulse/session-2-spec.md`

---

## Contents

- [§0. Purpose and scope](#0-purpose-and-scope)
- [§1. Architecture decisions](#1-architecture-decisions)
- [§2. Home dashboard (/) redesign](#2-home-dashboard--redesign)
  - [§2.6 Global loading and empty-state rules](#26-global-loading-and-empty-state-rules)
- [§3. ClientPulse dashboard (/clientpulse) simplification](#3-clientpulse-dashboard-clientpulse-simplification)
  - [§3.7 Colour token table](#37-colour-token-table)
- [§4. Unified activity feed component](#4-unified-activity-feed-component)
- [§5. Run detail page](#5-run-detail-page)
- [§6. ClientPulse feature page simplifications](#6-clientpulse-feature-page-simplifications)
- [§7. Retired surfaces](#7-retired-surfaces)
- [§8. Surgical code fixes](#8-surgical-code-fixes)
- [§9. Ship gates](#9-ship-gates)
- [§10. File inventory](#10-file-inventory)
- [§11. Deferred items](#11-deferred-items)
- [§12. Telemetry events](#12-telemetry-events)
- [§13. Performance guardrails](#13-performance-guardrails)
- [§14. Scaling note — `GET /api/pulse/attention`](#14-scaling-note--get-apipulseattention)

---

## §0. Purpose and scope

ClientPulse shipped in Sessions 1 and 2 before `docs/frontend-design-principles.md` was written. The original mockups were data-model-first: every backend capability surfaced as a UI panel. This spec drives the corrective pass — redesigning the dashboards, activity feed, and feature pages to start from the operator's primary task rather than the data model.

**In scope:**
- Home dashboard (`/`) — full redesign: adds cross-feature approval hub, workspace summary cards, unified activity feed. NOTE: `/` currently redirects to `/admin/pulse`; this spec includes the router change that points `/` at `DashboardPage` (see §10).
- ClientPulse dashboard (`/clientpulse`) — simplification: sparklines, health scores, PENDING chips; no structural rework
- Unified activity feed — new component replacing two separate tables; covers all six activity types
- Run detail page — entry point added from the activity feed; based on the existing `AgentRunLivePage` (route `/runs/:runId/live`)
- ClientPulse feature pages — per-page simplifications from the Stage 1 audit (settings tabs, column trims, surgical fixes)
- `/admin/pulse` and `/admin/subaccounts/:subaccountId/pulse` routes — both retired; responsibilities redistributed (see §7.1)

**Out of scope for this spec:**
- Any change to the backend scoring engine, intervention state machine, or data model
- New intervention primitives
- Any behavioural change to the agent execution pipeline
- Briefing/digest per-client email templates (deferred — see §11)

**Mockup set** (all in `prototypes/pulse/`):
- Current-state references: `current-main-dashboard.html`, `current-clientpulse-dashboard.html`
- Proposed designs: `home-dashboard.html`, `clientpulse-mockup-dashboard.html`, `run-detail.html`
- Feature pages: all `clientpulse-mockup-*.html` files

---

## §1. Architecture decisions

### §1.1 `/admin/pulse` routes retired

`PulsePage.tsx` (mounted at both `/admin/pulse` and `/admin/subaccounts/:subaccountId/pulse`) is retired. Its three approval-lane responsibilities are redistributed:

| Former `/admin/pulse` lane | New home |
|---|---|
| Client-health interventions awaiting operator approval | Home dashboard "Pending your approval" section |
| Major config-change proposals awaiting approval | Home dashboard "Pending your approval" section |
| Internal agent clarifications awaiting operator response | Home dashboard "Pending your approval" section |

Both the org-scoped and subaccount-scoped variants are retired — the home dashboard aggregates across subaccounts for the primary operator view, and the per-subaccount drilldown already surfaces per-client context on its own page.

The pending-items section on the home dashboard replaces the lane-card metaphor with a simpler priority-sorted list. The data source is the existing `pulseService.getAttention()` primitive (route `GET /api/pulse/attention`), which already classifies items into `client | major | internal` lanes and is the right existing abstraction for this view (see §2.2).

### §1.2 Home dashboard is generic, not ClientPulse-specific

`DashboardPage.tsx` is the generic home for all workspaces. It does not hard-code ClientPulse logic inside the page itself. The "Your workspaces" feature card grid ships as a **hard-coded v1 card set** (see §2.3) — the grid is a static JSX list in v1. If more workspaces land later, the grid can graduate to a data-driven registry; this spec does not build that registry today.

The page is mounted at `/` by this spec. The current `/ → /admin/pulse` redirect in `client/src/App.tsx` is removed as part of the retirement in §1.1.

### §1.3 ClientPulse dashboard stays feature-specific

`ClientPulseDashboardPage.tsx` shows only ClientPulse concerns: health band distribution, per-client needs-attention rows, and the latest report. Approval workflow is no longer surfaced here — it lives on the home dashboard.

### §1.4 Activity feed unifies six types in one table

Two separate tables on the current home dashboard (Recent Activity + implicit run list) are replaced by one `UnifiedActivityFeed` component that covers all six `activityService` types: `agent_run`, `review_item`, `health_finding`, `inbox_item`, `playbook_run`, `workflow_execution`. The actor column distinguishes humans, agents, and system events visually.

### §1.5 Run detail is the existing `AgentRunLivePage`

No new run-detail page is built. The existing `AgentRunLivePage` (route `/runs/:runId/live`) is the destination of "View log →" links from the activity feed. The mockup `prototypes/pulse/run-detail.html` documents the target visual state — the run meta bar (§5.1) is shipped in this spec (covered by ship gate G5); the two-column layout is an optional polish item that MAY be applied but is not gated.

---

## §2. Home dashboard (/) redesign

**File:** `client/src/pages/DashboardPage.tsx`
**Route:** `/` (repointed by this spec; currently redirects to `/admin/pulse` — see §10 router change)
**Mockup:** `prototypes/pulse/home-dashboard.html`
**Current-state reference:** `prototypes/pulse/current-main-dashboard.html`

### §2.1 What changes

| Section | Current | Proposed |
|---|---|---|
| Greeting | "Good morning, Ben" + last-updated subtitle | Same — keep as-is |
| Metric tiles (4) | Active Agents / Runs Today / Success Rate / Items Created | Pending Approval (urgent, links to #pending) / Clients Needing Attention (links to /clientpulse) / Active Agents / Runs (7 days) [¹] |
| Body section 1 | Workspace health widget (single panel) | **Pending your approval** — priority-sorted list of items awaiting operator action |
| Body section 2 | Run activity bar chart (14-day) | **Your workspaces** — 2×2 feature card grid |
| Body section 3 | Quick Chat agent grid (4 agent shortcuts) | **Recent activity** — unified feed table (see §4) |
| Body section 4 | Recent Activity runs table | *(absorbed into unified feed)* |

¹ **"Runs (7 days)"** — count of `agent_runs` rows with `created_at >= now() - interval '7 days'` scoped to the operator's organisation. Source: a new lightweight `GET /api/agent-runs/stats?period=7d` query on `agentRuns` (or reuse `GET /api/agent-runs?limit=0&period=7d` if that endpoint already accepts a period param). Only confirmed after implementation review — if a cheaper aggregation already exists (e.g. from the existing stats endpoint used by the metric tiles), prefer it.

### §2.2 Pending approval section

Renders only when the returned list is non-empty. If empty, the section is hidden entirely — no empty-state panel.

**Data source:** existing `GET /api/pulse/attention` (backed by `pulseService.getAttention()` in `server/services/pulseService.ts`). The endpoint returns items with `kind: 'review' | 'task' | 'failed_run' | 'health_finding'` classified into `client | major | internal` lanes. No new endpoint is introduced.

**Priority sort:** the server already returns items grouped into `lanes: { client: [...], major: [...], internal: [...] }`. The section flattens them in that order. Within each lane, newest-first by `createdAt` (server-side; client does no re-sort).

**Lane priority overrides recency (explicit rule).** A `major`-lane item that is 30 days old renders after all `client`-lane items regardless of their age. Lane priority is the primary sort key; `createdAt` is secondary within a lane only. This is intentional — an older client-health intervention is more operationally urgent than a newer internal clarification. Future developers must not "fix" this ordering toward pure recency.

Each card shows:
- Colour-coded left dot (client lane = dark red, major lane = amber, internal lane = slate)
- Feature badge pill (ClientPulse / Config change / Agent clarification — mapped from `kind` + lane)
- Client name if applicable (from `pulseItem.subaccountName`)
- One-line action description (bold)
- One-line rationale (secondary text)
- "Open in context" button → routes the user to the real URL for the item
- Approve / Reject buttons (right column). **Defer is NOT shipped in v1** (see §11 Deferred Items).

**`detailUrl` resolution — backend-first approach.** `pulseService.getAttention()` currently returns `detailUrl` as an opaque token (e.g. `review:<id>`, `task:<id>`, `run:<id>`, `health:<id>`). This spec requires the endpoint to be extended so it returns a fully resolved `resolvedUrl` string alongside (or instead of) `detailUrl`:

```typescript
// Added to each pulse attention item
resolvedUrl: string | null;   // fully qualified SPA path e.g. "/clientpulse/clients/abc123"
                               // null when the backend cannot determine a destination (e.g. entity deleted)
```

**Backend resolution rules:**

| Token kind | `resolvedUrl` value |
|---|---|
| `review:<id>` | `/admin/subaccounts/<subaccountId>/pulse` (when `subaccountId` present) or `null` |
| `task:<id>` | existing task detail path (whatever `TaskCard` currently navigates to) |
| `run:<id>` | `/runs/<id>/live` |
| `health:<id>` | `/clientpulse/clients/<subaccountId>` (subaccount drilldown) |

The client-side resolver remains as a **fallback only** — it maps the legacy opaque `detailUrl` token to the correct path in case `resolvedUrl` is absent (e.g. older cached data or a backend not yet upgraded). The resolver is a small pure function co-located with `DashboardPage.tsx`.

**Implementation warning — do not let the fallback become primary.** The fallback resolver must not become the de-facto routing mechanism during development. Instrumentation rule: log a `WARN fallback_resolver_used` event every time the client resolver fires (i.e. `resolvedUrl` was null and the fallback was needed). Target: fallback usage below 5% of pending card navigations before release. If fallback usage is high during QA, the backend `resolvedUrl` resolution is not implemented correctly — do not paper over it by extending the frontend fallback.

**Navigation traceability.** When navigating to a resolved URL with intent, pass a lightweight state hint so the destination page can verify item identity and improve telemetry:

```typescript
navigate(`${resolvedUrl}?intent=approve`, {
  state: { sourceItemId: item.id }
})
```

The destination page MAY read `location.state?.sourceItemId` to confirm the correct item is loaded before auto-opening the approval UI. This is not required for correctness (the stale-intent guard in §2.2 already handles mismatched state), but it improves traceability when debugging edge cases and enriches the `pending_card_approved` telemetry event with the originating item.

**Null destination handling.** If both `resolvedUrl` and the fallback resolver return `null`:
- The "Open in context" button is **disabled** with tooltip: **"This item cannot be actioned from here."**
- The **Approve and Reject buttons are also disabled** — because both use mode-2 (navigate to destination + `?intent`), they require a resolvable URL. A null destination with active Approve/Reject buttons creates a dead-end: the operator clicks and nothing happens. Disabled state prevents that.
- Tooltip on the disabled Approve/Reject buttons: same text — "This item cannot be actioned from here."

(Tooltip wording is terse, factual, lowercase after the verb — apply this tone consistently to all disabled-state tooltips in this spec.)

**Approve / Reject contract (narrowed in v1).** The pending card does NOT attempt to reproduce the full approve/reject flow for every item type. Two distinct UX modes are used, chosen by `kind`:

1. **In-place approve/reject** — only for item types whose backend supports button-only approval (no comment, no acknowledgement modal). As of this spec, that is limited to: NONE confirmed to be button-only. The default posture is mode (2).
2. **Context-flow approve/reject** — the Approve and Reject buttons navigate to the item's resolved detail URL with a `?intent=approve` or `?intent=reject` query param, so the existing context flow (which already owns the rejection-comment modal, the major-acknowledgement modal, etc.) handles the actual submission. This is the default for v1.

G13 (see §9) verifies mode-2 behaviour specifically: clicking Approve or Reject from the pending card lands the operator in the item's existing context flow with the intent preserved; the existing flow completes the submission.

If any `kind` value graduates to mode-1 during implementation (e.g. `task` has a true button-only approval today), add it explicitly to this table — do not silently upgrade.

**`?intent` destination-page contract.** Every page listed as a mode-2 destination MUST implement intent detection on mount. This is a hard contract — a page that ignores `?intent` forces the operator to re-navigate to the approval action, breaking the one-additional-click guarantee:

1. On mount, read `?intent=approve | reject` from the URL search params.
2. If intent is present: auto-open the approval/rejection UI (e.g. open the modal, scroll to the approval section, focus the primary action button) and pre-select the intent action.
3. The operator sees only the final confirmation step — not the full decision flow from scratch.
4. After the action completes **successfully**, remove the `?intent` param from the URL (use `replace: true`) to avoid a stale intent on back-navigation.

**Stale intent guard.** Before auto-opening the approval UI in step 2, the destination page MUST verify that the item is still actionable. If the item's status is no longer `pending` or `edited_pending` (e.g. already approved, already rejected, or deleted since the card was rendered):
- Do NOT auto-open the approval UI.
- Show an inline informational message: **"This item is no longer pending."**
- Strip `?intent` from the URL (`replace: true`).
- The page renders normally — the operator can still view context, they simply cannot re-action an item that has already been processed.

This covers the case where a user bookmarks a `?intent` URL, or where another user actioned the item between the home dashboard render and the navigation.

**`?intent` failure-handling rule.** The success path above is not enough on its own. If an intent-driven action fails (network error, validation rejection, modal fails to open):

1. The approval UI MUST remain open — do not close the modal or scroll away.
2. An inline error message MUST be shown within the approval UI (not a toast, not a full-page error — inline, adjacent to the action that failed).
3. The `?intent` param MUST NOT be stripped from the URL — the operator must be able to reload and retry from the same intent state.
4. The operator must be able to retry without re-navigating back to the home dashboard.

This means the error boundary around the intent-triggered UI must be local, not page-level. If the intent detection logic itself throws (e.g. invalid `kind` value in the URL), the page still renders normally without the approval UI — it does not crash.

This contract applies to ALL pages that appear in the `resolvedUrl` resolver table (review drilldown, task detail, run detail). If a destination page cannot satisfy this contract in v1 (e.g. the page needs a refactor to accept a modal-open signal), document the gap explicitly in §11 Deferred Items for that page — do NOT silently accept a broken flow.

G16 (see §9) is the ship gate for this contract.

Cards are `<div>` containers — not `<a>` elements — to avoid nested-interactive-element bugs (see §8.3).

**Primary task:** Triage pending items from the home screen and land in the right context flow in one click, without hunting through nav.

### §2.2.1 Component contract — `PendingApprovalCard`

```typescript
interface PendingApprovalCardProps {
  item: PulseItem;                                 // shape exported from server/services/pulseService.ts
  resolveDetailUrl: (detailUrl: string) => string | null;  // fallback resolver — used when item.resolvedUrl is null
  onAct: (item: PulseItem, intent: 'approve' | 'reject' | 'open') => void;
}
```

The card does NOT invoke approve/reject HTTP calls directly. All three buttons call `onAct(item, intent)` — the parent (DashboardPage) navigates to the resolved URL with the intent preserved, and the existing context flow handles submission. This keeps the card UI-only and matches the mode-2 contract above. If a future `kind` graduates to mode-1 (in-place approve), the card contract gains optional `onApproveInPlace` / `onRejectInPlace` props at that time.

Card is a `<div>` (not `<a>`) — interactive child buttons/links mandate the nested-anchor rule in §8.3. The lane colour, feature badge, and rationale text are all derived from `item` — the card has no per-lane branching logic baked in beyond those derivations.

### §2.3 Workspace feature cards

Hard-coded v1 card set — 2-card horizontal grid (responsive: 2 columns on wide screens, stacked on narrow). Cards are `<a>` elements.

| Card | Data shown | Link |
|---|---|---|
| ClientPulse | Health distribution bar (3-band) + pill counts ("N healthy · N need attention · N at risk") | `/clientpulse` |
| Settings | Team member count + integration status | `/clientpulse/settings` |

The ClientPulse card data comes from `GET /api/clientpulse/health-summary` (already used by `ClientPulseDashboardPage`) which exposes `healthy | attention | atRisk` counts. MRR / revenue-at-risk is NOT rendered — the health-summary endpoint does not expose a revenue field today, and extending it is a scope expansion not covered by this UI pass (see §11). The Settings card uses static text + integration status pulled from the existing org context.

**Deferred cards (see §11):**
- **CRM Queries card** — deferred until `/crm` route exists.
- **Agents card** — deferred until `/agents` is a real landing page (it currently redirects to `/`).

The grid graduates to 2×2 when either deferred card lands.

### §2.3.1 Component contract — `WorkspaceFeatureCard`

```typescript
interface WorkspaceFeatureCardProps {
  title: string;
  href: string;
  summary: ReactNode;   // free-form content: distribution bar, pill counts, plain text
  testId?: string;
}
```

Renders as an `<a>` element. Title, summary, and chevron layout are owned by the card. Data-fetching is NOT the card's responsibility — the parent passes rendered `summary` content.

### §2.4 What is removed

- `RunActivityChart` (14-day bar chart) — deferred per design principles (decoration chart, not task-enabling)
- Quick Chat agent grid — replaced by workspace feature cards (more purposeful, same nav function)
- Separate "Recent Activity" runs table — absorbed into the unified activity feed (§4)
- Workspace health widget — replaced by pending-approvals section (more actionable)

### §2.5 Primary task check

A non-technical operator opening the home dashboard can answer in one glance: *"What needs my attention right now?"* The pending section answers this directly. The workspace cards answer: *"Where do I go next?"* The activity feed answers: *"What has happened recently?"* No diagnostic panels, no metric dashboards.

### §2.6 Global loading and empty-state rules

These rules apply to every dashboard surface in this spec (home dashboard, ClientPulse dashboard, drilldown, activity feed, clients list):

| State | Rule |
|---|---|
| **Loading** | Skeleton placeholders only — never a spinner. Skeletons must match the final layout dimensions so the page does not shift when data arrives. |
| **Task-driven sections (empty)** | Hide entirely when empty (no placeholder, no "nothing here" text). "Pending your approval" on the home dashboard is the canonical example — when the queue is empty, the section is absent, not shown as an empty card. |
| **Informational sections (empty)** | Show a single-line empty state in muted text. "No activity yet." for the activity feed. "No clients need attention." for the Needs Attention list. Keep the section container visible so the page structure is recognisable. |
| **Error** | Dashboard widgets fail silently — hide the widget, no error panel. Critical actions (approve, reject) show an inline error message on failure, not a full-page error. |

The distinction between "task-driven" and "informational" is intent-based: if the section is empty because there is genuinely nothing to do (good state), hide it. If the section is a persistent feature that happens to have no data yet, show the empty state so the operator knows the feature exists and is working.

## §3. ClientPulse dashboard (/clientpulse) simplification

**File:** `client/src/pages/ClientPulseDashboardPage.tsx`
**Route:** `/clientpulse`
**Mockup:** `prototypes/pulse/clientpulse-mockup-dashboard.html`
**Current-state reference:** `prototypes/pulse/current-clientpulse-dashboard.html`

### §3.1 What stays

- 4 `HealthCard` components (Total / Healthy / Needs Attention / At Risk) with pastel colouring — no change to data or styling
- "Latest Report" widget in the right column
- "Configuration Assistant" button in the page header
- Back-link to `/` (home)

### §3.2 What changes: Needs Attention list

The current "High-Risk Clients" widget shows 5 rows with no sparklines. The proposed "Needs Attention" list shows up to 7 rows and adds:

| Addition | Detail |
|---|---|
| Inline sparkline | 4-week health trend rendered as an inline SVG `<polyline>` (90×28 viewport) with a terminal circle dot. Colour matches the client's current health band. |
| Health score | Displayed as a large number (e.g. `28`) coloured by band. Delta from 7 days ago shown below (e.g. `↓ 2 / 7d`). |
| PENDING chip | `⚑ PENDING` badge shown when the client has an intervention awaiting operator approval. These rows sort to the top of the list. |
| Row count | Up to 7 rows (was 5). "View all →" link at the bottom opens `clientpulse-mockup-clients-list.html` → `/clientpulse/clients`. |

**Sort order:** PENDING first (by health score asc within), then Critical (by health score asc), then At Risk, then Watch. Healthy clients do not appear.

**Row columns** (grid): colour dot · client name + sub-meta · sparkline · health score + delta · last action · arrow

Each row is an `<a>` linking to `/clientpulse/clients/:subaccountId` (drilldown).

The "Propose" button is removed from this list view — intervention proposals are initiated from the drilldown page, not the dashboard.

### §3.3 What is removed

- "Propose" inline button on each High-Risk row (was a second primary action on a row that already navigates to the drilldown — violates one-primary-action rule)
- Separate approval lane (moved to home dashboard §2.2)

### §3.4 Portfolio trend chart (deferred)

The proposed mockup shows a 90-day portfolio trend chart below the Latest Report widget. This is deferred to a follow-on session. The chart would show the org-level health band distribution over time — a genuine navigational aid, not a decoration. Defer gate: only add if an operator explicitly asks "how is my portfolio trending overall?" See §11 Deferred Items.

### §3.5 Backend data additions required by §3.2 and §6.3

The current `GET /api/clientpulse/high-risk` (in `server/routes/clientpulseReports.ts`) returns `{ clients: [] }` with a TODO — it is not wired to any data source. This spec requires that endpoint to be implemented with the response contract below, which backs BOTH the dashboard Needs Attention list (§3.2) and the full clients-list page (§6.3). This is the single source of truth for the endpoint; §6.3 references this contract rather than restating it.

**Query parameters:**

| Param | Type | Default | Purpose |
|---|---|---|---|
| `limit` | integer | 7 (dashboard) / 25 (clients list) | Max rows returned. Server enforces a hard max of 25. |
| `band` | `all \| critical \| at_risk \| watch \| healthy` | `all` | Filters to the selected band. When `band=all`, Healthy clients are excluded (dashboard default). When `band=healthy`, ONLY healthy clients are returned (opt-in, used by the clients-list page's Healthy chip). All other band values return only that band. |
| `q` | string | unset | Case-insensitive substring match on `subaccountName`. Applied before sort + limit. |
| `cursor` | opaque string | unset | Load-more cursor. The server signs the cursor so forward pagination is stable even when rows are inserted. |

**Response contract:**

```typescript
interface HighRiskClientsResponse {
  clients: Array<{
    subaccountId: string;
    subaccountName: string;
    healthScore: number;         // current score 0–100
    healthBand: 'critical' | 'at_risk' | 'watch' | 'healthy';
    healthScoreDelta7d: number;  // current minus 7-days-ago; can be negative
    sparklineWeekly: number[];   // 4 values (one per week for the last 4 weeks); chronological, oldest first
    lastActionText: string | null;      // server-formatted: "<action label> · <relative time>" e.g. "Retention call · 3d ago"; null if no recent action. Format is owned server-side so all consumers display consistently. Never return a raw timestamp.
    hasPendingIntervention: boolean;    // derived from review_item / action status
    drilldownUrl: string;               // e.g. "/clientpulse/clients/:subaccountId"
  }>;
  hasMore: boolean;
  nextCursor: string | null;
}
```

**Sort order:** the server applies the §3.2 sort (PENDING first, then Critical, then At Risk, then Watch, then Healthy if `band=healthy`) so the client can trust the order regardless of which surface is consuming it. Within each band tier, rows are ordered by `health_score ASC` (worst first) then `subaccount_name ASC` as a tiebreaker — this makes the sort deterministic and stable across pagination pages.

**Cursor pagination stability invariant.** The cursor pagination implementation must satisfy two hard guarantees regardless of concurrent inserts or updates:

1. A row already returned in a previous page MUST NOT appear again in a subsequent page.
2. A row MUST NOT be skipped because rows were inserted ahead of it between page requests.

Both invariants require a **composite cursor** that encodes the full sort key: `(health_score, subaccount_name, subaccount_id)`. The server signs the encoded cursor (e.g. base64 of JSON + HMAC) and decodes it on the next request to apply a deterministic `WHERE (health_score, subaccount_name, id) > (:score, :name, :id)` (or `<` depending on direction) predicate. Opaque offset-based pagination (`OFFSET N`) is NOT acceptable — it produces skips and duplicates under concurrent inserts.

The cursor must be treated as opaque by the client; the client passes it back verbatim, never constructs it.

**Internal service decomposition.** The handler at `server/routes/clientpulseReports.ts` must decompose into three internal functions to keep the implementation testable:

```typescript
// Internal shape (not exported)
function getPrioritisedClients(orgId: string): Promise<ClientRow[]>
function applyFilters(rows: ClientRow[], params: { band?: string; q?: string }): ClientRow[]
function applyPagination(rows: ClientRow[], params: { limit: number; cursor?: string }): { rows: ClientRow[]; nextCursor: string | null }
```

Each function is pure (or nearly pure) and individually testable. The route handler composes them: fetch → filter → paginate → shape response. Do not inline all three operations into a single query string.

### §3.6 Component contracts — `NeedsAttentionRow`, `SparklineChart`

```typescript
interface NeedsAttentionRowProps {
  client: HighRiskClientsResponse['clients'][number];
}

interface SparklineChartProps {
  values: number[];           // raw series — values MUST be on the 0–100 scale (health scores). The server returns sparklineWeekly as health scores already in that range. If a consumer passes values outside 0–100, the component clamps them. Never scale differently across pages — the 0–100 health-score scale is the canonical axis for all ClientPulse sparklines.
  colour: string;             // CSS colour token (see §3.7 colour token table) — never a literal hex value
  width?: number;             // default 90
  height?: number;            // default 28
  terminalDot?: boolean;      // default true
}
```

### §3.7 Colour token table

All band colours must use CSS variable tokens, not literal hex values. Implementation should define these in the project's design token file (e.g. `client/src/styles/tokens.css` or Tailwind config) rather than scattering literal colours across components.

| Band | Token name | Semantic meaning |
|---|---|---|
| Critical | `--band-critical` | Darkest red |
| At Risk | `--band-at-risk` | Red |
| Watch | `--band-watch` | Amber |
| Healthy | `--band-healthy` | Green |

Lane colours for pending-approval cards:

| Lane | Token name |
|---|---|
| client | `--lane-client` (dark red) |
| major | `--lane-major` (amber) |
| internal | `--lane-internal` (slate) |

If the project already has an established token convention (e.g. Tailwind colour aliases), use those instead — don't introduce a parallel token system.

**Primitive reuse note.** The repo already exposes inline sparkline implementations at `client/src/components/system-pnl/PnlSparkline.tsx` and `client/src/components/ActivityCharts.tsx`. The ClientPulse design requires band-colour keying + terminal dot + 90×28 viewport, which the existing primitives don't cover. **Implementation preference:** reuse `PnlSparkline` directly if its props accept `colour` and `terminalDot`; otherwise extend it with those two props and reuse across both surfaces. Only introduce a new file (`client/src/components/clientpulse/SparklineChart.tsx`) if extending the existing primitive would conflict with its current call sites. The §10 inventory reflects this preference — the new file is listed as "create only if PnlSparkline extension is not viable".

---

## §4. Unified activity feed component

**New component:** `client/src/components/UnifiedActivityFeed.tsx`
**Used by:** `DashboardPage.tsx` (home dashboard)
**Mockup:** `prototypes/pulse/home-dashboard.html` — "Recent activity" section

### §4.1 Purpose

Replaces two separate tables (human "Recent Activity" narrative list + agent "Recent Runs" table) with a single chronological feed covering all activity types. An operator can scan one table to understand everything that has happened — agent runs, human approvals, config changes, system detections.

### §4.2 Data source

**Endpoint:** `GET /api/activity?limit=20&sort=newest` (existing; backed by `listActivityItems()` exported from `server/services/activityService.ts`). Allowed sort values are `attention_first | newest | oldest | severity`. No new endpoint is introduced.

**Ordering tiebreaker.** Under high throughput, multiple activity items can share identical `createdAt` timestamps (e.g. a batch agent run spawning several events in the same millisecond). The sort order MUST be deterministic:
- Primary: `created_at DESC`
- Secondary: `id DESC` (UUID/ULID insertion order as stable tiebreaker)

Without the tiebreaker, rows with identical timestamps appear in non-deterministic order between refreshes, causing visible reordering in the feed. The secondary `id DESC` ensures a consistent stable order the operator can rely on.

**Current response shape (from `server/services/activityService.ts`):**

```typescript
interface ActivityItem {
  id: string;
  type: 'agent_run' | 'review_item' | 'health_finding' | 'inbox_item' | 'playbook_run' | 'workflow_execution';
  status: 'active' | 'attention_needed' | 'completed' | 'failed' | 'cancelled';
  subject: string;
  actor: string;
  subaccountId: string | null;
  subaccountName: string | null;
  agentId: string | null;
  agentName: string | null;
  severity: 'critical' | 'warning' | 'info' | null;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
  detailUrl: string;
}
```

**Additive fields required for the unified feed.** `UnifiedActivityFeed` needs per-item data the current shape does not carry. This spec extends `ActivityItem` with the five fields below; the extension is part of the §10 inventory as a modification to `server/services/activityService.ts` and any internal type exports consumers rely on.

```typescript
// Added by this spec
triggeredByUserId: string | null;
triggeredByUserName: string | null;    // denormalised from users join
triggerType: 'manual' | 'scheduled' | 'webhook' | 'agent' | 'system' | null;
durationMs: number | null;             // for agent_run and workflow_execution
runId: string | null;                  // set for agent_run and workflow_execution with a log
```

All five fields are nullable; existing activity types that don't source them (e.g. `health_finding`) return `null` for each. No existing consumer of `ActivityItem` is broken by the additive extension.

**Data reliability rule.** Before exposing a field in the UI, confirm it can be populated for ≥ 80% of rows of the relevant `type`. If a field can only be populated for a minority of rows, **omit the column or cell entirely** rather than rendering inconsistent nulls (`—`) across most rows. A column of dashes signals a broken feature, not missing data. Apply this check per-column and per-type:

- `triggerType` is the highest-risk field: it requires a join or denormalization step. **`triggerType` MUST be precomputed or cached at write time** (not derived on read). Acceptable approaches: (a) write `trigger_type` into the activity log row when the event fires, or (b) compute it as a materialised column. Ad-hoc joins on the read path are not acceptable — they introduce latency and miss historical rows. Confirm coverage before shipping G3.
- `durationMs` for `workflow_execution` rows: confirm the execution pipeline writes end-time consistently before rendering a Duration column for those rows.
- `triggeredByUserName`: requires a users join. Confirm the join succeeds for all rows with non-null `triggeredByUserId` before shipping (no 30% join-miss rate).

**Column visibility consistency rule.** The 80% coverage rule applies at the **endpoint level**, not per-row. Column visibility is determined once when the component mounts and the first page of data arrives — it does not change within a session even if subsequent data pages have different null patterns. A column that is present in the first response is present for the entire session; a column absent from the first response (because it failed the 80% threshold) is absent for the session. This prevents the table layout from shifting mid-scroll as rows with different data shapes load in. The `UnifiedActivityFeed` component must evaluate column visibility once from the first fetch response and fix it for that render cycle.

### §4.3 Table columns

| Column | Width | Content |
|---|---|---|
| **Activity** | ~38% | `subject` (bold) + subtext context line. For `agent_run` and `workflow_execution` rows where `runId` is set: inline "View log →" link → `/runs/:runId/live`. |
| **Executed by** | ~22% | Agent pill (indigo `agentName` + secondary `triggerType` label) **or** human avatar (coloured initial circle + `triggeredByUserName`) **or** italic "System · `actor`" |
| **Status** | ~12% | Colour-coded badge: Completed (green) / Failed (red) / Running (blue) / Approved (green) / Rejected (slate) / Waiting (amber) / Detected / Info |
| **Duration** | ~8% | `durationMs` formatted per formatting rules below |
| **When** | ~10% | Relative time (`12 min ago`, `Yesterday`, `7 days ago`) |

**Duration formatting rules.** All duration values across the spec (activity feed, run meta bar) use a single formatting function. Rules:

| Input | Output |
|---|---|
| `null` | `—` (em dash) |
| `0` to `999ms` | `0s` |
| `1000ms` to `59999ms` | `Ns` (e.g. `28s`) — always round **down** to nearest second |
| `60000ms` to `3599999ms` | `Nm Ns` (e.g. `1m 42s`) — seconds component always rounds **down** |
| `≥ 3600000ms` | `Nh Nm` (e.g. `1h 3m`) — minutes component always rounds **down** |

Always round down (floor), never round up or round to nearest. This prevents jitter: a `1m 59s` run never flickers to `2m 0s` between refreshes if the final event arrives slightly late. The formatting function is a pure utility — colocate it with the feed component as `formatDuration(ms: number | null): string`.

### §4.4 Actor rendering rules

```
if triggeredByUserId is set AND type is review_item or inbox_item:
  → human avatar (avatar colour keyed by userId, initial from name)
elif triggerType is 'manual' AND triggeredByUserId is set:
  → human avatar + agent name as secondary text (human triggered an agent)
elif agentName is set:
  → agent pill (indigo) + trigger method subtext
     trigger method labels: 'scheduled' → "Scheduled" | 'manual' → "Manual" |
     'webhook' → "Webhook · <source>" | 'agent' → "Agent chain" | 'system' → "System"
else:
  → italic "System · <actor>"
```

### §4.5 Log link rules

Show "View log →" link only when:
- `type` is `agent_run` or `workflow_execution`, AND
- `runId` is non-null

Link target: `/runs/:runId/live` (existing `AgentRunLivePage` route).

Human-action rows (`review_item`, `inbox_item`) and system events (`health_finding`) never show a log link — they have no execution log.

### §4.6 Component contract

```typescript
interface UnifiedActivityFeedProps {
  orgId: string;
  limit?: number;  // default 20
}
```

The component fetches its own data on mount. It does not receive items as props — this keeps `DashboardPage` clean.

Loading state: skeleton rows (4 shimmer lines).
Empty state: "No activity yet." in muted text.
Error state: silent retry, no error panel shown on the home dashboard (non-critical widget).

---

## §5. Run detail page

**Existing file:** `client/src/pages/AgentRunLivePage.tsx`
**Route:** `/runs/:runId/live`
**Mockup:** `prototypes/pulse/run-detail.html`

### §5.1 No new page — polish only

`AgentRunLivePage.tsx` already implements the core functionality: initial snapshot fetch, live socket subscription, `Timeline` + `EventDetailDrawer` components, sequence-gap detection, and the event-cap banner. No new page is created.

This spec adds a targeted visual improvement pass to make the page match the mockup's clarity:

| Improvement | Current | Proposed | Status |
|---|---|---|---|
| Run meta bar | Run ID in mono + "Live execution log" heading only | Add: agent name, status badge (Completed/Running/Failed), total duration, event count, started timestamp — rendered as a horizontal meta bar below the heading | MUST ship (G5) |
| Layout | Single-column full-width | Two-column: timeline (left, ~55%) + event detail drawer (right, sticky, ~380px) — drawer appears inline instead of as a floating overlay so context is always visible on wide screens | MAY ship (optional polish; no ship gate) |
| Breadcrumb | None | "Home / Run detail" breadcrumb linking back to `/` | MAY ship (optional polish; no ship gate) |

### §5.2 Data additions for meta bar

`GET /api/agent-runs/:id` already exists in `server/routes/agentRuns.ts` (served via `agentActivityService.getRunDetail`). Reuse this endpoint directly. If the response does not already include `eventCount`, extend the service to return it (simple `count(*)` on the events table for the run). All other meta-bar fields (agent name, status, duration, startedAt, completedAt) are already present in the run-detail payload — audit before implementation and only extend what is actually missing.

The `/api/agent-runs/:runId/events` endpoint remains the source for the timeline body; only the meta bar uses the summary lookup.

### §5.3 Entry points

The run detail page is reached from:
1. Activity feed "View log →" inline link (§4.5) — primary new entry point this spec adds
2. Direct URL (e.g. from a notification or shared link)

**Note on `AgentRunHistoryPage.tsx`:** it navigates to `/admin/subaccounts/:subaccountId/runs/:runId` (a different run-detail surface), not the live log. This spec does not rewire that click — it remains unchanged and targets its existing destination.

---

## §6. ClientPulse feature page simplifications

All pages below have updated mockups in `prototypes/pulse/`. Each entry lists: the mockup, the built file(s), and the specific changes required.

### §6.1 Settings page — 5-tab restructure

**Mockup:** `prototypes/pulse/clientpulse-mockup-settings.html`
**Built file:** `client/src/pages/ClientPulseSettingsPage.tsx` (or equivalent settings route)
**Change:** Replace the 10-block vertical scroll layout with a 5-tab layout:

| Tab | Blocks included |
|---|---|
| Scoring | healthScoreFactors, churnBands |
| Interventions | interventionTemplates, interventionDefaults |
| Blind spots | churnRiskSignals |
| Trial / Onboarding | onboardingMilestones |
| Operations | staffActivity, alertLimits, dataRetention, integrationFingerprints |

Each tab renders only its blocks. No change to the underlying editor components — this is a layout change only. The "Configuration Assistant" button moves to the page header (always visible regardless of active tab).

Factor labels on the Scoring tab must be human-readable strings — no raw config key names (e.g. `last_login_recency` → "Last-login recency", `pipeline_value_trend` → "Pipeline value trend").

### §6.2 Drilldown — panel trim + pending hero

**Mockup:** `prototypes/pulse/clientpulse-mockup-drilldown.html`
**Built file:** `client/src/pages/ClientPulseDrilldownPage.tsx`
**Changes:**
- Add `PendingHero` banner above the health score card when `hasPendingIntervention === true` (see §6.2.1 for contract + backend data additions).
- Collapse band-transition history: show last 3 transitions only; "Show history" expander for the rest.
- Remove `s.contribution` float from the signal panel — the file is `client/src/components/clientpulse/drilldown/SignalPanel.tsx` (see §8.2 for the parallel fix in ProposeInterventionModal).
- Demote "Open Configuration Assistant" from a prominent button to an inline text link in the page footer.
- Cap signal panel to top 5 signals (was unbounded). "Show more" link for remainder.

### §6.2.1 `PendingHero` contract + backend data additions

```typescript
interface PendingHeroProps {
  pendingIntervention: {
    reviewItemId: string;
    actionTitle: string;        // e.g. "Book retention call for Smith Dental"
    proposedAt: string;         // ISO 8601
    rationale: string;          // one-line why
  } | null;
  onApprove: (reviewItemId: string) => Promise<void>;
  onReject: (reviewItemId: string) => Promise<void>;
}
```

The banner renders only when `pendingIntervention` is non-null; parents pass `null` when no intervention is pending.

**Backend data additions:** `GET /api/clientpulse/drilldown/:subaccountId` (or whichever drilldown endpoint `ClientPulseDrilldownPage` currently consumes) must be extended to return a `pendingIntervention` object with the shape above (or `null`). The endpoint must pull the most recent `review_item` with status `pending` / `edited_pending` scoped to the subaccount. The route + service change is part of the §10 inventory.

**Consistency rule — PendingHero ↔ home dashboard.** The PendingHero on the drilldown page and the pending approval card on the home dashboard reflect the same underlying `review_item` row. They MUST stay in sync:

1. Both surfaces use a **shared data hook** (`usePendingIntervention(subaccountId: string)`) that wraps the relevant API calls and owns the optimistic update logic. Neither `DashboardPage` nor `ClientPulseDrilldownPage` maintains its own independent approval state.
2. After an Approve or Reject action from either surface, the hook applies an **optimistic update** immediately (item disappears from pending state) and confirms on API response. On error, the optimistic update is rolled back and an inline error message is shown.
3. Query invalidation: after a successful approve/reject, the hook invalidates both the home-dashboard attention query (`/api/pulse/attention`) and the drilldown query (`/api/clientpulse/drilldown/:subaccountId`) so both surfaces reflect the new state on the next render.

**Conflict rule.** If the API returns a conflict (e.g. the item was already approved by another user, or its state changed since the page loaded), the hook must:
1. **Revert** the optimistic update immediately — the item reappears in the pending state locally.
2. **Refetch** both source queries (`/api/pulse/attention` + the relevant drilldown query) to pull the true server state.
3. **Show an inline message** adjacent to the card/banner: **"This item was already updated."** — not a toast, not a modal, inline.

HTTP 409 Conflict is the expected server response for this case. If the server returns a non-409 error (network failure, 500), apply the failure-handling rule from §2.2 instead (revert + show retry-able inline error, do not strip `?intent`).

**Idempotency contract.** Approve and Reject actions MUST be idempotent on the backend. If an operator double-clicks Approve, or a network retry fires the same request twice, the `review_item` state transition must happen exactly once. Subsequent identical calls for the same `reviewItemId` must:
- Return the current final state (e.g. `{ status: 'approved', ... }`) without side effects.
- NOT emit a duplicate approval event, duplicate notification, or duplicate intervention record.

Implementation approach: the approval/rejection handler checks the current `review_item.status` before writing. If status is already `approved` (or `rejected`), it returns the current row as-is with HTTP 200 (idempotent success), not 409. HTTP 409 is reserved for *conflict* (a different action was taken than expected), not for replay. The `usePendingIntervention` hook must also disable its action buttons for the duration of a pending request (no double-click race on the client side), but the backend idempotency is the authoritative guard.

The shared hook is a new file: `client/src/hooks/usePendingIntervention.ts`. Add it to the §10 file inventory.

**Note on Defer:** the drilldown's pending banner does NOT ship a Defer button in v1 for the same reason as §2.2 — no defer endpoint exists. Approve and Reject only. See §11 Deferred Items.

### §6.3 Clients list page

**Mockup:** `prototypes/pulse/clientpulse-mockup-clients-list.html`
**Built file:** Not built (new page). Route: `/clientpulse/clients`
**What to build:** Filterable list of all clients with health-band filter chips (All / Critical / At Risk / Watch / Healthy) + search input. Each row: colour dot, client name, sparkline, health score + delta, last action, arrow link to drilldown. Pagination: load-more pattern (not offset pagination).

**Data source:** reuses the `GET /api/clientpulse/high-risk` endpoint defined in §3.5. The page invokes it with `limit=25` and whichever `band` / `q` / `cursor` params the UI state requires. The full endpoint contract (query params, response shape, sort rules, pagination model) lives in §3.5 — do not restate it here. The clients-list page is a pure consumer of that contract.

### §6.4 Propose intervention modal

**Mockup:** `prototypes/pulse/clientpulse-mockup-propose-intervention.html`
**Built file:** `client/src/components/clientpulse/ProposeInterventionModal.tsx`
**Changes:** Remove `s.contribution` render (§8.2). Add 90-day trend mini-chart in the modal header context section (so the operator sees trend before approving). No other structural changes.

### §6.5 Subaccount blueprints + organisation templates tables

**Mockups:** `prototypes/pulse/clientpulse-mockup-subaccount-blueprints.html`, `clientpulse-mockup-organisation-templates.html`
**Built files:** `client/src/pages/SubaccountBlueprintsPage.tsx` and `client/src/pages/SystemOrganisationTemplatesPage.tsx`
**Change:** Trim table to 4 columns maximum (remove "Operational config" column — it is informational and already viewable in the blueprint detail). Merge "Browse shared library" into the "+ New" modal flow rather than a separate button.

### §6.6 Fire automation editor

**Mockup:** `prototypes/pulse/clientpulse-mockup-fire-automation.html`
**Built file:** `client/src/components/clientpulse/FireAutomationEditor.tsx` (line ~39)
**Change:** Remove the raw automation ID (`a.id`) from the picker display. Show only the human-readable automation name. (See §8.1.)

### §6.7 Config assistant chat, email authoring, send SMS, create task, operator alert

Mockup-only changes already applied in `prototypes/pulse/`. No built-code changes required for these pages — the existing components match the simplified mockup intent. Review during implementation to confirm parity.

### §6.8 Onboarding pages — audit-only

**Mockups:** `prototypes/pulse/clientpulse-mockup-onboarding-orgadmin.html`, `clientpulse-mockup-onboarding-sysadmin.html`
**Built files:** `client/src/pages/OnboardingWizardPage.tsx`, `client/src/pages/OnboardingCelebrationPage.tsx`
**Scope:** Audit-only. Confirm celebration copy and any wizard microcopy do not expose internal identifiers, raw config-key names, or specific LLM / AI provider names (per `docs/capabilities.md` editorial rules). If the audit finds nothing to change, this item ships no code. If it finds something, the files change — add them to §10 at that time. This spec does NOT pre-commit file edits for onboarding.

---

## §7. Retired surfaces

### §7.1 `/admin/pulse` routes

**File to remove:** `client/src/pages/PulsePage.tsx`
**Router entries to remove:** in `client/src/App.tsx`:
- `<Route path="/admin/pulse" element={<PulsePage ... />} />`
- `<Route path="/admin/subaccounts/:subaccountId/pulse" element={<PulsePage ... />} />`
- Any `<Navigate to="/admin/pulse" ... />` redirect from other paths (e.g. `/`, `/inbox`, `/admin/activity`) — these are repointed to `/` (the redesigned home) except where the redirect is about a different surface entirely.
**Nav links:** Remove any nav item pointing to `/admin/pulse` or `/admin/subaccounts/:id/pulse`.
**Client-side compatibility redirects:** Add `<Navigate to="/" replace />` entries in `client/src/App.tsx` for:
- `/admin/pulse`
- `/admin/subaccounts/:subaccountId/pulse`
so any in-app links or bookmarks land on the redesigned home. This is an SPA redirect, not an HTTP 301 — verified by ship gate G6 (see §9).

**Router transition guarantees.** Before marking §7.1 complete, verify ALL of the following:

| Check | Method |
|---|---|
| Every former `/admin/pulse` entry point resolves to a meaningful page (not a blank screen, not a 404). | Manual: grep for `/admin/pulse` across `client/src/` — confirm zero occurrences remain as link destinations (only `<Navigate>` redirect registrations allowed). |
| Back navigation: after clicking a pending card's "Open in context" button and taking an action, pressing browser Back returns to the home dashboard (not to `/admin/pulse` or a stale URL). | Manual: run the flow in the browser; press Back after an action. |
| Deep-link / bookmark: a user who bookmarked `/admin/pulse` is redirected to `/` without a white screen. | Manual: paste the URL directly into the browser; observe clean redirect. |
| Subaccount-scoped pulse URL: `/admin/subaccounts/abc123/pulse` also redirects cleanly. | Manual: same as above with a real subaccountId. |
| No React error boundary fires on any redirect path. | Manual: open browser console; expect zero errors during the navigation tests above. |

These verifications are folded into G6 — G6 does not pass until all five checks above pass.

### §7.2 Mockups deleted or marked deferred

Detailed list moved to §11 (canonical Deferred Items). At a glance: four mockups were deleted from the design set (template-editor, inline-edit, weekly-digest, capability-showcase); four remain in `prototypes/pulse/` as deferred or retired (briefing-per-client, digest-per-client, intelligence-briefing, operator-alert-received).

---

## §8. Surgical code fixes

These are small targeted changes identified in the Stage 1 audit cross-cutting findings. They are non-breaking and can be applied in the same PR.

### §8.1 FireAutomationEditor — remove `a.id` render

**File:** `client/src/components/clientpulse/FireAutomationEditor.tsx`
**Line:** ~39
**Fix:** The automation picker currently shows `a.id` (an internal UUID) alongside the automation name. Remove the ID render — show name only. IDs are internal system identifiers not meaningful to operators.

### §8.2 Signal panel + ProposeInterventionModal — remove `s.contribution` render

Both surfaces render `s.contribution` as a decimal float (e.g. `0.34` in the modal, `34%` in the panel). Both are internal scoring weights, not operator-facing information. The signal name + direction (up/down) is sufficient.

**Files:**
- `client/src/components/clientpulse/drilldown/SignalPanel.tsx` (line ~32 — renders `(s.contribution * 100).toFixed(0)%`)
- `client/src/components/clientpulse/ProposeInterventionModal.tsx` (line ~177 — renders raw `s.contribution`)

**Fix:** Remove the contribution render in both files. Leave the signal name + up/down arrow + label intact.

### §8.3 Nested anchor fix — home dashboard pending cards

**File:** `client/src/pages/DashboardPage.tsx` (new pending section)
**Rule:** Pending approval cards must be `<div>` containers, never `<a>` elements wrapping `<button>` or `<a>` children. Browsers silently close the outer `<a>` when they encounter an inner interactive element, collapsing CSS grid layouts. This was the cause of the broken layout in the first home-dashboard mockup draft.

### §8.4 Settings — factor label display

**File:** `client/src/pages/ClientPulseSettingsPage.tsx` and health-score factor rendering components
**Fix:** Any place that renders an `operational_config` key name directly to the UI (e.g. `last_login_recency`, `pipeline_value_trend`) must use the human-readable label from the config schema instead. The schema already carries a `label` field for this purpose — use it.

---

## §9. Ship gates

| Gate | Surface | Verification |
|---|---|---|
| **G1** | Home dashboard renders "Pending your approval" section when pending items exist; section is absent when the queue is empty. | Manual: approve all pending items → section disappears. Add one → section reappears. |
| **G2** | Home dashboard "Your workspaces" ClientPulse card shows live health distribution (not static). | Manual: change a client's band → card refreshes on next load with updated counts. |
| **G3** | Unified activity feed renders rows for all six activity types without crashing. | Manual: seed one row of each `type` value via the DB or a stub endpoint response; visit the home dashboard; visually confirm each renders without a React error. No unit test required. |
| **G4** | Activity feed "View log →" link appears only for `agent_run` / `workflow_execution` rows with a non-null `runId`. Human-action rows have no link. | Manual: visual check across seeded rows covering all six types. No unit test required. |
| **G5** | `AgentRunLivePage` shows the run meta bar (agent name, status, duration, event count, started timestamp). | Manual: open any completed run → meta bar visible with all 5 fields. |
| **G6** | `/admin/pulse` and `/admin/subaccounts/:subaccountId/pulse` redirect to `/` in the SPA. Sidebar "Pulse" nav and BriefDetailPage back-link land on the home dashboard, not on a 404 or stale route. | Manual: (a) visit both `/admin/pulse` URLs directly → UI lands on home without a 404. (b) Click the sidebar nav item that formerly said "Pulse" → lands on home. (c) Open a brief detail page and click `← Back` → lands on home. No `/admin/pulse` references remain in `grep -rn "/admin/pulse" client/src/`. |
| **G7** | ClientPulse Needs Attention list shows PENDING chip on clients with pending interventions; those rows sort first. | Manual: approve all → no chips. Propose one → chip appears on that client row, row moves to top. |
| **G8** | Inline sparklines render correct colour per health band (Critical = dark red, At Risk = red, Watch = amber, Healthy = green). | Visual check against mockup. |
| **G9** | `FireAutomationEditor` no longer renders `a.id`. `ProposeInterventionModal` AND `SignalPanel` no longer render `s.contribution`. | `grep -rn "\ba\.id\b" client/src/components/clientpulse/FireAutomationEditor.tsx` returns no matches in the picker render (line ~39). `grep -rn "s\.contribution" client/src/components/clientpulse/` returns no matches in the modal or signal panel. |
| **G10** | Settings page renders 5 tabs with correct block-to-tab mapping. No raw config-key names visible on-screen. | Manual: open each tab, verify blocks match §6.1. Search rendered HTML for `_recency`, `_trend` — expect no matches. |
| **G11** | `PendingHero` renders on drilldown when `pendingIntervention` is non-null and hides when null. Approve / Reject buttons complete their action. | Manual: propose an intervention on a client → visit drilldown → hero visible; click Approve → hero hides and review item status flips to approved. |
| **G12** | `ClientPulseClientsListPage` at `/clientpulse/clients` loads, filter chips scope the list, search input filters, load-more fetches the next page. | Manual: navigate to the page, toggle each band chip, type a client name, click load-more. All four behaviours work. |
| **G13** | Home dashboard pending cards' Approve / Reject buttons complete the underlying approve / reject call for each of the three lane types (client-health, major config, internal clarification). | Manual: seed one pending item of each lane → click Approve on each → verify the item is marked approved in the relevant table. Reject likewise. |
| **G14** | `npm run typecheck` passes with no new errors. | CI / manual. |
| **G15** | `npm run lint` passes. | CI / manual. |
| **G16** | Clicking Approve or Reject on a home dashboard pending card lands the operator at the item's destination page with the approval UI already open and the intent pre-selected. The operator completes the action with **at most one additional click** (the final confirmation). No re-navigation, no hunting for the approval button. | Manual: for each of the three lane types (client-health, major config, internal clarification), click Approve on the pending card → observe the destination page auto-opens the approval UI → click the single confirmation → action completes. Repeat for Reject. |

---

## §10. File inventory

### To create

| File | Purpose |
|---|---|
| `client/src/components/UnifiedActivityFeed.tsx` | Unified activity table component (§4) |
| `client/src/components/dashboard/PendingApprovalCard.tsx` | Single pending-action card for home dashboard (§2.2.1) |
| `client/src/components/dashboard/WorkspaceFeatureCard.tsx` | Workspace summary card (generic; §2.3.1) |
| `client/src/components/clientpulse/NeedsAttentionRow.tsx` | Single row in the ClientPulse needs-attention list with sparkline (§3.6) |
| `client/src/components/clientpulse/SparklineChart.tsx` | Inline 90×28 SVG sparkline. **Create only if `PnlSparkline` extension is not viable** — see §3.6 primitive-reuse note. |
| `client/src/components/clientpulse/PendingHero.tsx` | Pending intervention banner on drilldown (§6.2.1) |
| `client/src/pages/ClientPulseClientsListPage.tsx` | All-clients filterable list (§6.3) |
| `client/src/hooks/usePendingIntervention.ts` | Shared hook for pending-intervention state, optimistic updates, and cross-surface query invalidation (§6.2.1) |

### To modify

| File | Change |
|---|---|
| `client/src/pages/DashboardPage.tsx` | Full redesign per §2 |
| `client/src/pages/ClientPulseDashboardPage.tsx` | Needs Attention list redesign per §3 |
| `client/src/pages/AgentRunLivePage.tsx` | Add meta bar per §5.1; two-column layout + breadcrumb are optional polish (no gate) |
| `client/src/pages/ClientPulseSettingsPage.tsx` | 5-tab layout per §6.1 |
| `client/src/pages/ClientPulseDrilldownPage.tsx` | Pending hero + panel trims per §6.2 |
| `client/src/pages/SubaccountBlueprintsPage.tsx` | Trim table to 4 columns; merge library-browse into "+ New" (§6.5) |
| `client/src/pages/SystemOrganisationTemplatesPage.tsx` | Trim table to 4 columns; merge library-browse into "+ New" (§6.5) |
| `client/src/components/clientpulse/FireAutomationEditor.tsx` | Remove `a.id` render per §8.1 |
| `client/src/components/clientpulse/ProposeInterventionModal.tsx` | Remove `s.contribution` render per §8.2; add 90-day trend mini-chart in modal header (§6.4) |
| `client/src/components/clientpulse/drilldown/SignalPanel.tsx` | Remove `s.contribution` render per §8.2 |
| `client/src/App.tsx` | Repoint `/` at `DashboardPage` (remove current `/ → /admin/pulse` redirect); remove `/admin/pulse` and `/admin/subaccounts/:subaccountId/pulse` PulsePage routes; add `<Navigate to="/" replace />` redirects for both retired paths; review all other `<Navigate to="/admin/pulse" ... />` entries (e.g. `/inbox`, `/admin/activity`, `/admin/subaccounts/:id/inbox`, `/admin/subaccounts/:id/activity`) and repoint them to `/` where the redirect is semantically "take me home"; add `/clientpulse/clients` route for the new clients-list page |
| `client/src/components/Layout.tsx` | Remove or repoint the "Pulse" nav items that point at `/admin/pulse` (line ~684 for subaccount-scoped) and `/admin/pulse` (line ~691 for org-scoped). The nav becomes a "Home" link pointing at `/` instead, since the pending-approval surface now lives on the home dashboard. |
| `client/src/pages/BriefDetailPage.tsx` | Repoint the `← Back` link from `/admin/pulse` to `/` (line ~157). |
| `server/routes/activity.ts` | Extend `ActivityItem` additive fields (`triggeredByUserId`, `triggeredByUserName`, `triggerType`, `durationMs`, `runId`) per §4.2 — the service and the denormalising joins change, not the route surface |
| `server/services/activityService.ts` | Back the additive `ActivityItem` fields end-to-end (joins, type export) — see §4.2 |
| `server/routes/clientpulseReports.ts` | Implement `GET /api/clientpulse/high-risk` per the §3.5 contract (currently returns `{ clients: [] }` with TODO); back the `/clientpulse/clients` list page's filter/search/load-more semantics (§6.3) |
| `server/routes/clientpulseDrilldown.ts` | Extend drilldown response with `pendingIntervention` object (or `null`) per §6.2.1 |
| `server/services/pulseService.ts` | Extend `getAttention()` response items with `resolvedUrl: string | null` per §2.2 backend-first resolution contract |
| `server/routes/agentRuns.ts` | Add `eventCount` to the existing `GET /api/agent-runs/:id` response if missing (§5.2). Do NOT create a new endpoint — reuse the existing one. |

### To delete / retire

| File | Action |
|---|---|
| `client/src/pages/PulsePage.tsx` | Delete; replace routes with `<Navigate to="/" replace />` per §7.1 |
| Any nav component linking to `/admin/pulse` or `/admin/subaccounts/:subaccountId/pulse` | Remove nav entry |

### Onboarding (conditional)

`client/src/pages/OnboardingWizardPage.tsx` and `client/src/pages/OnboardingCelebrationPage.tsx` are audit-only per §6.8. They are NOT listed under "To modify" unless the audit finds specific edits to make, in which case they are promoted at that time.

### Mockup set (reference only — not shipped)

All in `prototypes/pulse/`. Current-state references: `current-main-dashboard.html`, `current-clientpulse-dashboard.html`. Proposed: `home-dashboard.html`, `clientpulse-mockup-dashboard.html`, `run-detail.html`, plus all `clientpulse-mockup-*.html` feature pages.

---

## §11. Deferred items

Single source of truth for everything the spec mentions but does NOT ship in this session. An item is in scope if and only if it is NOT in this list.

- **Defer 24h behaviour for pending approval cards.** The home dashboard pending cards (§2.2) and the drilldown PendingHero (§6.2.1) show Approve / Reject only — no Defer. Backend has no defer state and adding one is a scope expansion (new column + endpoint + state semantics). Ship only if an operator explicitly asks for "snooze this decision for a day".
- **In-place approve/reject mode for pending cards.** §2.2's v1 contract uses mode-2 only: Approve/Reject buttons on the home dashboard pending card navigate to the item's existing context flow (which owns rejection-comment and major-acknowledgement modals). A mode-1 in-place button-only submission path is deferred until a `kind` is confirmed to have a true button-only approve/reject primitive on the backend. Ship mode-1 for that `kind` at that time; do not pre-build mode-1 speculatively.
- **Token resolver for `review:<id>` items.** §2.2's client-side resolver maps `pulseService` tokens to real URLs. For `review:<id>` tokens, the current fallback is the subaccount-scoped drilldown (when `subaccountId` is present) or a disabled "Cannot open in-place" tooltip. A dedicated review-detail page (e.g. `/reviews/:id`) is deferred — ship only if an operator explicitly asks for a direct deep-link to a review without going through the subaccount drilldown.
- **MRR / revenue-at-risk on the ClientPulse workspace card.** §2.3 drops the "$X MRR at risk" line because `GET /api/clientpulse/health-summary` does not expose a revenue field today. Extending the summary endpoint is a scope expansion not covered by this UI pass. Ship when (a) subaccount revenue is available in canonical data AND (b) an operator explicitly asks for an MRR-at-risk signal on the home screen.
- **§6.8 Onboarding audit.** `OnboardingWizardPage.tsx` and `OnboardingCelebrationPage.tsx` are AUDIT-ONLY in this spec — no file edits are pre-committed. If the audit finds specific edits to make, promote the files to §10 "To modify" at that time. Otherwise, no changes ship under this spec.
- **CRM Queries workspace card.** Deferred until `/crm` is a real route with a landing page. Re-open §2.3 to add the card when the route exists.
- **Agents workspace card.** Deferred until `/agents` is a real landing page (it currently redirects to `/`). Re-open §2.3 to add the card when the route exists.
- **90-day portfolio trend chart.** §3.4 describes an org-level health-band distribution chart below the Latest Report widget. Ship only if an operator explicitly asks "how is my portfolio trending overall?"
- **Two-column layout on `AgentRunLivePage`.** §5.1 lists this as MAY ship (no gate). Optional polish; not part of this session's baseline deliverable.
- **"Home / Run detail" breadcrumb on `AgentRunLivePage`.** Same status as the two-column layout — MAY ship, no gate.
- **Workspace feature card grid as a data-driven registry.** §1.2 states v1 ships a hard-coded 2-card set (ClientPulse + Settings). Graduate to a registry-driven grid when a third or fourth workspace lands.
- **Per-client briefing email** (`prototypes/pulse/clientpulse-mockup-briefing-per-client.html`). Mockup kept; no build. Ship only if an operator asks for automated per-client forward-looking briefings.
- **Per-client digest email** (`prototypes/pulse/clientpulse-mockup-digest-per-client.html`). Mockup kept; no build. Ship only if an operator asks for per-client weekly retrospective digests.
- **Org-level intelligence briefing email** (`prototypes/pulse/clientpulse-mockup-intelligence-briefing.html`). Mockup kept; no build. Ship a minimal variant only if explicitly requested.
- **Operator-alert-received email surface** (`prototypes/pulse/clientpulse-mockup-operator-alert-received.html`). Retired — approval workflow absorbed by home dashboard §2.2. The mockup file is kept as historical reference only.
- **Deleted mockups** (not in `prototypes/pulse/` at all):
  - `clientpulse-mockup-template-editor.html` — built pattern is simpler inline editing; no separate editor page.
  - `clientpulse-mockup-inline-edit.html` — pattern not needed.
  - `clientpulse-mockup-weekly-digest.html` — org-level email digest deferred (see intelligence briefing above).
  - `clientpulse-mockup-capability-showcase.html` — reference doc only, not a UI surface.

---

## §12. Telemetry events

Five lightweight tracking events are introduced in this spec to give visibility into the new home dashboard and approval flow. These enable UX validation, drop-off detection, and feature prioritisation without building a monitoring product.

All five events are fire-and-forget client-side calls (no UI-blocking behaviour). They do NOT block renders or actions. If the tracking call fails, the action continues normally. Events are tracked via whatever analytics infrastructure the project currently uses (check `client/src/lib/analytics.ts` or equivalent — do not introduce a new analytics client).

| Event | When to fire | Properties |
|---|---|---|
| `pending_card_opened` | When the operator clicks "Open in context" on a pending approval card | `{ kind, lane, itemId, resolvedVia: 'backend' \| 'fallback' }` |
| `pending_card_approved` | When the operator clicks Approve on a pending approval card | `{ kind, lane, itemId }` |
| `pending_card_rejected` | When the operator clicks Reject on a pending approval card | `{ kind, lane, itemId }` |
| `activity_log_viewed` | When the activity feed renders on the home dashboard (component mounts with data) | `{ rowCount, typesPresent: string[] }` |
| `run_log_opened` | When the operator clicks a "View log →" link in the activity feed | `{ runId, activityType, triggerType }` |

Implementation: fire from the relevant event handlers in `DashboardPage.tsx` and `UnifiedActivityFeed.tsx`. No test assertions required for telemetry calls — confirm the calls exist in the implementation, but do not write tests that assert on them.

---

## §13. Performance guardrails

All dashboard endpoints introduced or modified by this spec must return within **300ms at p95** under normal load (single organisation, ≤ 500 clients, ≤ 50k activity rows). This is a "slow creep" prevention contract — not a launch blocker, but a standard that must be measurable from day one.

| Endpoint | Guardrail | Notes |
|---|---|---|
| `GET /api/pulse/attention` | < 300ms p95 | Already exists; ensure `resolvedUrl` resolution does not add a serial chain of sub-queries |
| `GET /api/clientpulse/high-risk` | < 300ms p95 | New endpoint; ensure sparkline and delta queries are batched, not N+1 per client row |
| `GET /api/activity` | < 300ms p95 | Additive join for `triggeredByUserName` and `triggerType` must be a single JOIN, not per-row sub-selects |
| `GET /api/agent-runs/:id` | < 300ms p95 | `eventCount` addition must be a `count(*)` aggregate in the existing query, not a separate round-trip |

**Enforcement mechanism:** Add a slow-query log assertion to each endpoint's integration test fixture (or use `server/lib/instrumentedQuery` if it exists). Log a WARN if a query exceeds 100ms in development. No hard fail in CI for now — the 300ms target is a measurable posture, not a gated check.

If the `sparklineWeekly` data cannot be computed within the 300ms budget for large orgs, pre-compute it as a materialised column or background job and serve from cache — do NOT do 4× rolling-window aggregation queries inline per request.

**Partial failure resilience.** All endpoints must degrade gracefully under partial data failure — a failed enrichment join must NOT fail the entire response:

- If the `triggeredByUserName` join fails (e.g. user deleted, join timeout), the activity row still returns with `triggeredByUserName: null`. The "Executed by" cell renders the fallback ("System · `actor`") — it does not crash or omit the row.
- If `sparklineWeekly` cannot be computed for a specific client row (e.g. missing historical data), the row returns with `sparklineWeekly: []`. The sparkline component renders an empty baseline — it does not omit the row.
- If `resolvedUrl` computation fails for one attention item (e.g. entity deleted mid-request), that item returns with `resolvedUrl: null` and the card renders with disabled action buttons per §2.2. The endpoint does not fail the entire attention list.

Implementation: wrap each enrichment step (user join, sparkline aggregation, URL resolution) in a `try/catch` or nullable fallback. Partial failure at one step must not propagate to the surrounding row or sibling rows. Log the failure at WARN level with the `itemId` and `enrichmentStep` for observability.

---

## §14. Scaling note — `GET /api/pulse/attention`

This endpoint will be the first performance bottleneck as usage grows. It aggregates across multiple item types, now includes `resolvedUrl` resolution per item, and drives the highest-visibility surface (home dashboard). As the attention queue grows in breadth (more `kind` values, more lanes) and depth (many concurrent pending items), latency and branching logic will accumulate.

**Not required for v1**, but worth knowing where this evolves:

- Move toward a **precomputed attention queue**: an `attention_items` materialised table (or a lightweight denormalised view) written at the time a `review_item`, `task`, or `health_finding` enters actionable state, rather than aggregated on read.
- Use **event-driven updates**: when a `review_item` status changes, a background job updates the attention queue rather than recomputing it on the next request.
- **`resolvedUrl` should be written at queue insert time**, not resolved on every read — the resolution rules are known when the item enters the queue.

This evolution does not change the API surface from the frontend's perspective — it is a pure backend optimisation. The spec as written is the correct interface contract; this note describes how the implementation layer should evolve when the read-time aggregation becomes a bottleneck. Track this in §11 Deferred Items if it becomes a near-term priority.
