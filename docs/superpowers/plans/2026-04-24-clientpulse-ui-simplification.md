# ClientPulse UI Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-24
**Spec:** [`docs/superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md`](../specs/2026-04-24-clientpulse-ui-simplification-spec.md) (approved, 4 rounds of external review, no remaining design gaps)
**Task classification:** Major
**Branch:** off `main`

---

## Table of contents

- [Goal](#goal)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Files to change](#files-to-change)
- [Phase sequencing](#phase-sequencing)
- [Phase 1 — Backend changes](#phase-1--backend-changes)
- [Phase 2 — Shared hooks and utilities](#phase-2--shared-hooks-and-utilities)
- [Phase 3 — Home dashboard](#phase-3--home-dashboard)
- [Phase 4 — ClientPulse dashboard simplification](#phase-4--clientpulse-dashboard-simplification)
- [Phase 5 — Feature page trims](#phase-5--feature-page-trims)
- [Phase 6 — /admin/pulse retirement](#phase-6--adminpulse-retirement)
- [Phase 7 — Surgical fixes and run meta bar](#phase-7--surgical-fixes-and-run-meta-bar)
- [Phase 8 — Ship gate verification](#phase-8--ship-gate-verification)
- [Risks and mitigations](#risks-and-mitigations)
- [Deferred items](#deferred-items)
- [Self-review](#self-review)

---

## Goal

Apply `docs/frontend-design-principles.md` to ClientPulse surfaces that shipped before those principles were written. Concretely:

1. Convert the home dashboard (`/`) from a run-chart + Quick-Chat surface into a cross-feature **triage hub** — pending-approvals panel, workspace cards, unified activity feed.
2. Retire `/admin/pulse` (both org- and subaccount-scoped) — its approval-lane workflow is absorbed into the home dashboard.
3. Simplify the ClientPulse dashboard (`/clientpulse`) to a primary-task surface — health bands + needs-attention list with sparklines, PENDING chips, and health-score deltas.
4. Ship the unified activity feed component replacing two separate tables (human Recent Activity + implicit run list).
5. Add targeted trims to ClientPulse feature pages (settings 5-tab restructure, drilldown PendingHero, clients list page, table column trims, surgical `s.contribution` / `a.id` removals).
6. Implement the backend data additions the new UI requires — `resolvedUrl`, high-risk endpoint contract, activity-feed additive fields (`triggerType`, `triggeredByUserName`, `durationMs`, `runId`), drilldown `pendingIntervention`, `eventCount` on run detail.
7. Make approve/reject idempotent at the backend, with optimistic updates + 409 conflict handling at the client.

Every task in this plan traces to one or more of the spec's 16 ship gates (G1–G16, §9).

---

## Architecture

**Stack:**
- Client: React 18 + react-router-dom + Tailwind + plain `api` + `useEffect` (no react-query; shared state via manually-passed callbacks).
- Server: Express + `asyncHandler` + Drizzle ORM (PostgreSQL) + Zod validation.
- All routes use `authenticate` + `requireOrgPermission` / `requireSubaccountPermission`; subaccount routes use `resolveSubaccount`.
- Soft delete: `isNull(table.deletedAt)`. All queries scoped by `req.orgId!`.

**Execution model — all changes are synchronous request/response.** No new jobs, queues, or pg-boss work. The backend additions are (a) additive columns on response shapes, (b) one existing-endpoint body implementation (`GET /api/clientpulse/high-risk`), (c) idempotency behaviour change on two existing handlers (approve / reject). No new migrations — see the primitives-reuse note below.

### Primitives-reuse note

| Proposed change | Existing primitive | Decision |
|---|---|---|
| `triggerType` on activity feed for agent runs | `agent_runs.run_type` + `agent_runs.run_source` (both written at insert time; see `server/db/schema/agentRuns.ts`) | **Reuse.** Derive `triggerType` deterministically in the activity service. No new column; no migration. This satisfies §4.2 "MUST be precomputed or cached at write time" because the source columns are already precomputed — the service maps them with no extra DB lookup. |
| `triggeredByUserId` for agent runs | `agent_runs.acting_as_user_id` | **Reuse.** Alias it in the service. |
| `triggeredByUserId` for workflow executions | `executions.triggered_by_user_id` | **Reuse.** |
| `durationMs` for activity rows | `agent_runs.duration_ms` / `executions.duration_ms` | **Reuse.** |
| `eventCount` on run detail | `count(*)` over `agent_execution_events` for the run | **Extend** existing `agentActivityService.getRunDetail` with the aggregate. No migration. |
| `resolvedUrl` on pulse attention items | `pulseService.getAttention` result shape | **Extend** service to add the field. No DB change. |
| Sparkline component | `client/src/components/system-pnl/PnlSparkline.tsx` | PnlSparkline accepts values in `[0,1]` (normalised by producer) and has no `colour` / `terminalDot` props. Extending it would change its contract and break `SystemPnlPage`'s call site. **Invent new** primitive `client/src/components/clientpulse/SparklineChart.tsx` — accepts 0–100 health scores, band colour, terminal dot. Per §3.6 reuse note. |
| `usePendingIntervention` shared hook | No existing shared hook for review approve/reject optimistic flow | **Invent new** — two surfaces need the same optimistic + rollback + refetch behaviour; no existing primitive to extend. |

### Contracts (pinned once, referenced from each phase)

```typescript
// §2.2 — Pulse attention item (additive field)
interface PulseItemAdditions {
  resolvedUrl: string | null;
}

// §2.2.1 — Pending card component
interface PendingApprovalCardProps {
  item: PulseItem;
  resolveDetailUrl: (detailUrl: string) => string | null;
  onAct: (item: PulseItem, intent: 'approve' | 'reject' | 'open') => void;
}

// §2.3.1 — Workspace card component
interface WorkspaceFeatureCardProps {
  title: string;
  href: string;
  summary: ReactNode;
  testId?: string;
}

// §3.5 — High-risk clients endpoint response
interface HighRiskClientsResponse {
  clients: Array<{
    subaccountId: string;
    subaccountName: string;
    healthScore: number;
    healthBand: 'critical' | 'at_risk' | 'watch' | 'healthy';
    healthScoreDelta7d: number;
    sparklineWeekly: number[];         // 4 weekly health scores, chronological oldest first
    lastActionText: string | null;     // "<label> · Nd ago" — server-formatted; null if none
    hasPendingIntervention: boolean;
    drilldownUrl: string;
  }>;
  hasMore: boolean;
  nextCursor: string | null;
}

// §3.6 — SparklineChart component
interface SparklineChartProps {
  values: number[];          // 0-100 scores; values outside [0,100] are clamped
  colour: string;            // Tailwind class or CSS token — never literal hex
  width?: number;            // default 90
  height?: number;            // default 28
  terminalDot?: boolean;     // default true
}

// §4.2 — Activity item (additive)
interface ActivityItemAdditions {
  triggeredByUserId: string | null;
  triggeredByUserName: string | null;
  triggerType: 'manual' | 'scheduled' | 'webhook' | 'agent' | 'system' | null;
  durationMs: number | null;
  runId: string | null;
}

// §4.6 — Unified activity feed
interface UnifiedActivityFeedProps {
  orgId: string;
  limit?: number;
}

// §6.2.1 — Pending hero
interface PendingHeroProps {
  pendingIntervention: {
    reviewItemId: string;
    actionTitle: string;
    proposedAt: string;      // ISO 8601
    rationale: string;
  } | null;
  onApprove: (reviewItemId: string) => Promise<void>;
  onReject: (reviewItemId: string) => Promise<void>;
}

// §6.2.1 — Drilldown endpoint additions
interface DrilldownResponseAdditions {
  pendingIntervention: {
    reviewItemId: string;
    actionTitle: string;
    proposedAt: string;
    rationale: string;
  } | null;
}

// §6.2.1 — Shared hook (no react-query in repo; refetch is caller-supplied)
interface UsePendingInterventionOptions {
  onApproved?: () => void;       // caller-supplied refetch hook
  onRejected?: () => void;
  onConflict?: () => void;
}

interface UsePendingInterventionApi {
  approve: (reviewItemId: string) => Promise<void>;
  reject: (reviewItemId: string, comment: string) => Promise<void>;
  isPending: boolean;
  conflict: boolean;
  error: string | null;
}

// §5.2 — Run detail (additive)
interface RunDetailAdditions {
  eventCount: number;
}
```

### Error codes

| Code | HTTP | Where | Meaning |
|---|---|---|---|
| `ALREADY_RESOLVED` | **200** (was 409) | `POST /api/review-items/:id/approve` and `/reject` | Idempotent replay — return current row as-is with 200. §6.2.1 idempotency contract. |
| `ITEM_CONFLICT` | 409 | same | True conflict — item was modified such that the client's expected state is no longer valid. Client shows "This item was already updated." |
| `COMMENT_REQUIRED` | 400 | `/reject` | Existing; unchanged. |
| `MAJOR_ACK_REQUIRED` | 412 | `/approve` | Existing; unchanged. |

---

## Tech stack

- **React 18**, **react-router-dom 6**, **Tailwind**
- **Express 4**, **Drizzle ORM**, **PostgreSQL 14+**, **Zod 3**
- **sonner** for toasts (already installed; most spec-driven errors are inline, not toast)
- No query library — manual refetch via parent-passed callbacks
- No analytics client — telemetry calls routed through a thin new `client/src/lib/telemetry.ts` helper (no-op / `console.debug` until an analytics client lands). Per §12.

---

## Files to change

### Create (new files)

- `client/src/components/UnifiedActivityFeed.tsx` — unified activity table (§4)
- `client/src/components/dashboard/PendingApprovalCard.tsx` — pending-action card (§2.2.1)
- `client/src/components/dashboard/WorkspaceFeatureCard.tsx` — workspace summary card (§2.3.1)
- `client/src/components/clientpulse/NeedsAttentionRow.tsx` — needs-attention row with sparkline (§3.6)
- `client/src/components/clientpulse/SparklineChart.tsx` — 90×28 SVG sparkline (§3.6)
- `client/src/components/clientpulse/PendingHero.tsx` — drilldown pending banner (§6.2.1)
- `client/src/pages/ClientPulseClientsListPage.tsx` — all-clients filterable list at `/clientpulse/clients` (§6.3)
- `client/src/hooks/usePendingIntervention.ts` — shared optimistic approve/reject hook (§6.2.1)
- `client/src/lib/telemetry.ts` — five tracking helpers (§12)
- `client/src/lib/resolvePulseDetailUrl.ts` — fallback resolver (§2.2)
- `client/src/lib/formatDuration.ts` — duration formatter (§4.3)

### Modify (client)

- `client/src/pages/DashboardPage.tsx` — full redesign per §2
- `client/src/pages/ClientPulseDashboardPage.tsx` — Needs Attention redesign per §3
- `client/src/pages/AgentRunLivePage.tsx` — add run meta bar per §5.1 (G5)
- `client/src/pages/ClientPulseSettingsPage.tsx` — 5-tab layout per §6.1; factor labels per §8.4
- `client/src/pages/ClientPulseDrilldownPage.tsx` — PendingHero + panel trims per §6.2
- `client/src/pages/SubaccountBlueprintsPage.tsx` — 4-column trim + library merge per §6.5
- `client/src/pages/SystemOrganisationTemplatesPage.tsx` — 4-column trim + library merge per §6.5
- `client/src/pages/BriefDetailPage.tsx` — repoint `← Back` from `/admin/pulse` to `/`
- `client/src/components/clientpulse/FireAutomationEditor.tsx` — remove `a.id` render per §8.1
- `client/src/components/clientpulse/ProposeInterventionModal.tsx` — remove `s.contribution` render per §8.2; add 90-day trend mini-chart per §6.4
- `client/src/components/clientpulse/drilldown/SignalPanel.tsx` — remove `s.contribution`; cap to top 5 signals
- `client/src/components/Layout.tsx` — repoint "Pulse" nav items to `/`
- `client/src/App.tsx` — `/ → DashboardPage`; `/admin/pulse` and `/admin/subaccounts/:subaccountId/pulse` replaced with `<Navigate to="/" replace />`; add `/clientpulse/clients` route; repoint `/inbox`, `/admin/activity`, `/admin/subaccounts/:subaccountId/activity`, `/admin/subaccounts/:subaccountId/inbox` redirects to `/` (§7.1 + §10)

### Modify (server)

- `server/services/pulseService.ts` — compute `resolvedUrl: string | null` per `PulseItem`
- `server/services/activityService.ts` — add 5 additive fields; deterministic `id DESC` tiebreaker; partial-failure resilience
- `server/services/agentActivityService.ts` — `getRunDetail` includes `eventCount`
- `server/services/reviewService.ts` — idempotent approve/reject when status already terminal
- `server/services/drilldownService.ts` — new `getPendingIntervention()` helper; `getSummary` caller adds it to response
- `server/routes/activity.ts` — no surface change (service upgrade only)
- `server/routes/clientpulseReports.ts` — implement `GET /api/clientpulse/high-risk` per §3.5 (was returning `{ clients: [] }` with TODO)
- `server/routes/clientpulseDrilldown.ts` — `drilldown-summary` response includes `pendingIntervention`
- `server/routes/agentRuns.ts` — no surface change (service upgrade only)
- `server/routes/reviewItems.ts` — approve/reject: return 200 on idempotent replay, reserve 409 for true conflict

### Delete

- `client/src/pages/PulsePage.tsx`

### Conditional — audit-only per §6.8

- `client/src/pages/OnboardingWizardPage.tsx`
- `client/src/pages/OnboardingCelebrationPage.tsx`

Promoted to "Modify" only if the audit in Phase 5 task 5.7 finds violating copy.

---

## Phase sequencing

```
Phase 1 (backend)
   ├── 1A idempotency on approve/reject             ─┐
   ├── 1B resolvedUrl on pulseService                ├─► Phase 2 hooks depend on these
   ├── 1C activity feed additive fields              ┘
   ├── 1D GET /api/clientpulse/high-risk (implement) ─► Phase 3+4
   ├── 1E drilldown pendingIntervention              ─► Phase 5
   └── 1F eventCount on run detail                   ─► Phase 7 meta bar

Phase 2 (shared hooks + utilities)     ─► Phase 3+4+5 consume them
Phase 3 (home dashboard)               ─► depends on 1A+1B+1C+1D + Phase 2
Phase 4 (ClientPulse dashboard)        ─► depends on 1D + Phase 2
Phase 5 (feature-page trims)           ─► depends on 1A+1E + Phase 2
Phase 6 (/admin/pulse retirement)      ─► depends on Phase 3 landed
Phase 7 (surgical fixes + run meta)    ─► depends on 1F for meta bar
Phase 8 (ship-gate verification)       ─► terminal
```

No backward dependencies. No migrations required anywhere.

---

## Phase 1 — Backend changes

All backend additions that other phases consume. Each task is independently testable. Ship-gates targeted: G1 (depends on 1B), G3/G4 (depend on 1C), G5 (depends on 1F), G7/G11/G12 (depend on 1D/1E), G13/G16 (depend on 1A/1B).

---

### Task 1.1 — Make approve/reject idempotent at the service layer

**Files to modify:**
- `server/services/reviewService.ts`
- `server/routes/reviewItems.ts`

**Contract change:**
- Current behaviour (see `server/routes/reviewItems.ts:86`): if `reviewStatus !== 'pending' && reviewStatus !== 'edited_pending'` the handler throws `{ statusCode: 409, message: 'Item already resolved', errorCode: 'ALREADY_RESOLVED' }`.
- New behaviour (per §6.2.1 idempotency contract): if the item is already `approved` (resp. `rejected`) with the same terminal state the caller is asking for, return **200** with the current row and emit no side effects. Return 409 only when a different terminal state was reached (e.g. caller asks Approve but item was Rejected).

**Steps — TDD:**

- [ ] **1.1.1** Write failing unit test `server/services/reviewService.test.ts` (create if absent) covering:
  - `approveItem` called twice in sequence: second call returns the same row, does NOT re-emit audit, does NOT re-enqueue workflow resume.
  - `rejectItem` called twice: second call returns same row.
  - Approve called on an already-rejected item: throws `{ statusCode: 409, errorCode: 'ITEM_CONFLICT' }`.
  - Reject called on an already-approved item: throws `{ statusCode: 409, errorCode: 'ITEM_CONFLICT' }`.
- [ ] **1.1.2** Verify the tests fail. Commit test file.
- [ ] **1.1.3** In `reviewService.approveItem`:
  - Load the row. If already `approved`, return the existing row (no audit, no workflow resume, no socket emit). If `rejected` or other terminal state, throw `{ statusCode: 409, message: 'Item was already processed with a different outcome', errorCode: 'ITEM_CONFLICT' }`.
  - Otherwise proceed with the existing transition logic.
- [ ] **1.1.4** In `reviewService.rejectItem`: mirror logic. `rejected` → return existing row; `approved` → throw 409 `ITEM_CONFLICT`.
- [ ] **1.1.5** In `server/routes/reviewItems.ts` approve handler: remove the early 409 throw on `reviewStatus !== 'pending' && !== 'edited_pending'` — let the service handle it. Same in reject handler.
- [ ] **1.1.6** Run `npm test -- reviewService` → all green. Run `npm run typecheck`. Commit with message `feat(review): idempotent approve/reject`.

**Error handling:** Keep `MAJOR_ACK_REQUIRED` (412) and `COMMENT_REQUIRED` (400) paths as-is. Idempotent replay must bypass the major-ack check (the row is already approved — no ack needed).

**Test considerations for pr-reviewer:**
- Double-approve via curl returns 200 both times with the same body.
- Approve then Reject returns 409 `ITEM_CONFLICT` with a clear message.
- No duplicate rows in `reviewAudit` after double-approve.
- No duplicate `pgBoss` job enqueued after double-approve.

**Dependencies:** none.

---

### Task 1.2 — Add `resolvedUrl` to pulseService items

**Files to modify:**
- `server/services/pulseService.ts`

**Contract:**

```typescript
// Added to PulseItem interface
resolvedUrl: string | null;
```

**Resolution rules (per §2.2 table):**

| `kind` | `subaccountId` present? | `resolvedUrl` |
|---|---|---|
| `review` | yes | `/clientpulse/clients/<subaccountId>` (drilldown is the v1 destination for review items — per §11 Deferred, a dedicated `/reviews/:id` page is deferred) |
| `review` | no | `null` |
| `task` | yes | `/admin/subaccounts/<subaccountId>/workspace` (existing task-detail destination — confirm via `TaskCard` navigation before finalising) |
| `task` | no | `null` |
| `failed_run` | yes | `/runs/<id>/live` |
| `failed_run` | no | `/runs/<id>/live` |
| `health_finding` | — | `/admin/health` (existing detector surface) |

**Steps:**

- [ ] **1.2.1** Write failing unit test `server/services/pulseService.test.ts` covering one of each `kind` with expected `resolvedUrl`. Verify null handling for review/task missing `subaccountId`.
- [ ] **1.2.2** Verify tests fail. Commit.
- [ ] **1.2.3** Add `resolvedUrl: string | null` to the `PulseItem` interface.
- [ ] **1.2.4** Introduce a pure `resolveUrlForItem(kind, id, subaccountId): string | null` helper inside `pulseService.ts` (not exported) and call it from each of the four `items.push(...)` blocks (review, task, failed_run, health_finding), and from each branch of `getItem`.
- [ ] **1.2.5** Run tests → green. `npm run typecheck`. Commit `feat(pulse): add resolvedUrl on attention items`.

**Test considerations for pr-reviewer:**
- Endpoint returns `resolvedUrl` on every item.
- Null when expected.
- No change to `detailUrl` (still the opaque token — backend-first + fallback contract per §2.2).
- No performance regression — the helper is a pure string concat, no extra DB lookups.

**Dependencies:** none.

---

### Task 1.3 — Activity service additive fields + deterministic sort tiebreaker + partial-failure resilience

**Files to modify:**
- `server/services/activityService.ts`

**Contract changes:**
- Extend `ActivityItem` with `triggeredByUserId`, `triggeredByUserName`, `triggerType`, `durationMs`, `runId` — all nullable (§4.2).
- Tiebreaker: primary `created_at DESC`, secondary `id DESC` (§4.2).
- Graceful degradation: `triggeredByUserName` join failure → `null`, not row omission (§13).

**Precomputation posture.** Per §4.2, `triggerType` must be precomputed, not derived on read. The existing columns already satisfy this:
- `agent_run` → `triggerType` is derived from `agent_runs.run_type` (`'scheduled' | 'manual' | 'triggered'`) with the mapping: `scheduled → 'scheduled'`, `manual → 'manual'`, `triggered → 'webhook'` (or `'agent'` when `run_source === 'sub_agent' | 'handoff'`). `run_source` is inspected to distinguish `webhook` vs `agent` — both columns are written at insert time in `agentExecutionService`.
- `workflow_execution` → `triggerType` is `executions.trigger_type` directly.
- `review_item`, `inbox_item`, `health_finding`, `playbook_run` → `null`.

Since both source columns are already precomputed, the service's read-path derivation is a pure mapping (no DB lookup) and satisfies the §4.2 precomputation rule.

**Steps:**

- [ ] **1.3.1** Write failing unit test `server/services/activityService.test.ts`:
  - Agent run with `run_type='manual'` + `acting_as_user_id` set → `triggerType='manual'`, `triggeredByUserId=acting_as_user_id`, `triggeredByUserName` from users join.
  - Agent run with `run_type='scheduled'` → `triggerType='scheduled'`, `triggeredByUserId=null`.
  - Agent run with `run_type='triggered'` + `run_source='handoff'` → `triggerType='agent'`.
  - Workflow execution passes through `trigger_type` directly.
  - Review item / inbox item / health finding → all additive fields are `null`.
  - Tiebreaker: two rows with identical `createdAt` sort by `id DESC`.
- [ ] **1.3.2** Verify tests fail. Commit.
- [ ] **1.3.3** Extend `ActivityItem` type with the five additive fields.
- [ ] **1.3.4** Update `fetchAgentRuns`:
  - Left-join `users` on `agent_runs.acting_as_user_id = users.id` (keep the join nullable so a deleted user yields `triggeredByUserName: null` rather than dropping the row).
  - Select `durationMs: agentRuns.durationMs`, `runId: agentRuns.id`.
  - Compute `triggerType` from the pure helper `mapAgentRunTriggerType(runType, runSource)`.
  - Wrap the users join in a try/catch at the row-mapping layer so a single missing user doesn't fail the response (per §13 partial-failure rule).
- [ ] **1.3.5** Update `fetchWorkflowExecutions`:
  - Left-join `users` on `executions.triggered_by_user_id = users.id`.
  - Select `triggerType: executions.triggerType`, `durationMs`, `runId: executions.id` (the workflow execution's own id — not an agent run).
- [ ] **1.3.6** Update `fetchReviewItems`, `fetchHealthFindings`, `fetchInboxItems`, `fetchPlaybookRuns` to return all five additive fields as `null`.
- [ ] **1.3.7** Update `sortItems`: for `newest` and `oldest`, add the secondary `id` tiebreaker when timestamps are equal. Same for `attention_first` and `severity` at their final tiebreaker step.
- [ ] **1.3.8** Run tests → green. `npm run typecheck`. Commit `feat(activity): additive fields + deterministic sort`.

**Test considerations for pr-reviewer:**
- Every activity item ships with all five additive fields (values may be null, but the keys must be present).
- Deleted user → `triggeredByUserName` is null, row is NOT dropped.
- Identical timestamps → rows sort by id DESC consistently across refreshes.
- No N+1 queries — the users join is a single LEFT JOIN.

**Dependencies:** none.

---

### Task 1.4 — Implement `GET /api/clientpulse/high-risk`

**Files to modify:**
- `server/routes/clientpulseReports.ts`

**Files to create (maybe):**
- Consider extracting `high-risk-service` helpers into `server/services/clientPulseHighRiskService.ts` if the route file grows beyond ~200 lines; otherwise keep the three pure functions `getPrioritisedClients`, `applyFilters`, `applyPagination` inline in the route file per §3.5.

**Contract:** See `HighRiskClientsResponse` in Architecture §Contracts.

**Query params:**
- `limit` — integer, default 7, hard max 25 (server-enforced)
- `band` — `all | critical | at_risk | watch | healthy` (default `all`). When `all`, excludes healthy. When `healthy`, returns only healthy.
- `q` — optional substring match on `subaccountName` (case-insensitive; `ilike`)
- `cursor` — opaque base64(JSON + HMAC) encoding `(health_score, subaccount_name, subaccount_id)` for composite cursor pagination per §3.5.

**Sort:** PENDING first, then Critical, At Risk, Watch, Healthy. Within each tier: `health_score ASC`, then `subaccount_name ASC`, then `subaccount_id ASC` (deterministic).

**Data sources:**
- Current health score + band: latest row per `subaccountId` in `client_pulse_health_snapshots` + `client_pulse_churn_assessments` (the drilldownService already does this — reuse its shape).
- `healthScoreDelta7d`: current score minus score from 7 days ago in `client_pulse_health_snapshots`.
- `sparklineWeekly`: 4 rows, one per week, from `client_pulse_health_snapshots` aggregated weekly. If insufficient history, fewer entries — never fabricate.
- `lastActionText`: derive from the most recent `actions` row for the subaccount with `status IN ('completed', 'approved')`, formatted as `"<actionType> · <relative time>"` (e.g. `"fire_automation · 3d ago"`) — server owns the formatting per §3.5. Null if none.
- `hasPendingIntervention`: `EXISTS` subquery on `review_items` with `reviewStatus IN ('pending', 'edited_pending')` for the subaccount.
- `drilldownUrl`: `/clientpulse/clients/<subaccountId>`.

**Steps:**

- [ ] **1.4.1** Write failing unit test `server/routes/clientpulseReports.test.ts` (integration style — seed DB; hit the endpoint):
  - `limit` default 7, hard max 25 (requesting `limit=100` returns 25).
  - `band=all` excludes healthy.
  - `band=healthy` returns ONLY healthy.
  - `band=critical` returns only critical.
  - `q=fooCorp` narrows to matching subaccountName.
  - Sort: PENDING rows first; then critical; within band, ascending score.
  - `hasMore` + `nextCursor` correctness: request page 1 with limit=2, then pass cursor, confirm page 2 has no duplicates and no skips when a new row is inserted between pages with a score that would have ranked mid-list.
  - Response shape matches `HighRiskClientsResponse` exactly.
- [ ] **1.4.2** Verify tests fail. Commit.
- [ ] **1.4.3** Introduce three internal helpers per §3.5 decomposition rule:
  ```typescript
  async function getPrioritisedClients(orgId: string): Promise<ClientRow[]> { /* fetch + compute sparkline + delta + pending flag */ }
  function applyFilters(rows: ClientRow[], params: { band?: string; q?: string }): ClientRow[] { /* pure */ }
  function applyPagination(rows: ClientRow[], params: { limit: number; cursor?: string }): { rows: ClientRow[]; nextCursor: string | null } { /* pure — composite cursor encode/decode */ }
  ```
- [ ] **1.4.4** Implement `getPrioritisedClients`:
  - One query fetches the latest health snapshot + churn band per subaccount (use a `DISTINCT ON` or lateral subquery — the canonical pattern for "latest row per group" in the existing drilldownService).
  - One query fetches snapshots from 7 days ago (same pattern) to compute delta.
  - One query fetches 4 weekly snapshots per subaccount — **batch** with a single `WHERE observed_at >= now() - interval '28 days'` + GROUP BY week (§13 N+1 guardrail).
  - One query counts pending review items per subaccount with `EXISTS`.
  - One query for most recent completed action per subaccount.
  - **Band-value mapping:** `ClientPulseChurnAssessment.band` is stored as camelCase (`'atRisk' | 'watch' | 'critical' | 'healthy'`). The response contract (§3.5) uses snake_case (`'at_risk' | 'watch' | 'critical' | 'healthy'`). Add a pure mapper `mapDbBandToApi(band: ChurnBand): HealthBand` that converts `'atRisk' → 'at_risk'` (the only case that differs) before serialising. This same mapper is used in reverse for the `band` query parameter (`'at_risk' → 'atRisk'` before filtering).
- [ ] **1.4.5** Implement `applyFilters`: pure filter on band + ilike q; exclude healthy when band='all'.
- [ ] **1.4.6** Implement `applyPagination`:
  - Encode cursor: `Buffer.from(JSON.stringify({ score, name, id })).toString('base64')`. Sign with HMAC using an env secret (`PULSE_CURSOR_SECRET` — add to `.env.example`).
  - Decode cursor: reverse + verify signature; on failure, throw `{ statusCode: 400, errorCode: 'INVALID_CURSOR' }`.
  - Apply `WHERE (health_score, subaccount_name, id) > (:score, :name, :id)` in the query (or in-memory comparison since the prioritised list is already assembled).
- [ ] **1.4.7** Wire route handler: `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)`. Compose `fetch → filter → paginate → shape response`.
- [ ] **1.4.8** Run tests → green. `npm run typecheck`. Commit `feat(clientpulse): implement high-risk endpoint`.

**Error handling:** Invalid cursor → 400. DB timeout on sparkline → return row with `sparklineWeekly: []` and a WARN log (§13 partial-failure rule). Unknown `band` value → 400.

**Test considerations for pr-reviewer:**
- Concurrent-insert stability: insert a new row that would sort between page 1 and page 2, verify no duplicates and no skips.
- Healthy excluded by default; explicitly requestable.
- PENDING rows always float to the top.
- No N+1 on sparkline — single batched query.

**Dependencies:** none. Independent of 1.1/1.2/1.3.

---

### Task 1.5 — Drilldown `pendingIntervention` additive field

**Files to modify:**
- `server/services/drilldownService.ts`
- `server/routes/clientpulseDrilldown.ts`

**Contract:** See `DrilldownResponseAdditions` in Architecture §Contracts.

**Data source:** most recent `review_item` with `reviewStatus IN ('pending', 'edited_pending')` for `(organisationId, subaccountId)`. Join to `actions` for `actionType`, `payloadJson?.reasoning` for `rationale`, `actions.createdAt` for `proposedAt`.

**Action title format:** `"<actionTypeLabel> for <subaccountName>"`. Labels come from `server/config/actionRegistry.ts` if available; otherwise raw `actionType`.

**Steps:**

- [ ] **1.5.1** Write failing test `server/services/drilldownService.test.ts`:
  - Subaccount with one pending review item → `pendingIntervention` non-null with correct fields.
  - Subaccount with no pending items → `pendingIntervention: null`.
  - Multiple pending items → returns the most recent by `createdAt`.
- [ ] **1.5.2** Verify tests fail. Commit.
- [ ] **1.5.3** Add `async getPendingIntervention({ organisationId, subaccountId })` to `drilldownService`. Return `{ reviewItemId, actionTitle, proposedAt, rationale } | null`.
- [ ] **1.5.4** In `drilldownService.getSummary` (or wherever the route composes the drilldown response), include `pendingIntervention: await getPendingIntervention({ organisationId, subaccountId })`.
- [ ] **1.5.5** Update `server/routes/clientpulseDrilldown.ts` `/drilldown-summary` handler to include the new field in the response shape.
- [ ] **1.5.6** Run tests → green. `npm run typecheck`. Commit `feat(clientpulse): drilldown pendingIntervention`.

**Test considerations for pr-reviewer:**
- Endpoint contract: `pendingIntervention` always present, null when none.
- Correct item returned when multiple pending (most recent).
- `actionTitle` is human-readable, not a raw slug.

**Dependencies:** none.

---

### Task 1.6 — `eventCount` on run detail

**Files to modify:**
- `server/services/agentActivityService.ts`

**Contract:** See `RunDetailAdditions` in Architecture §Contracts.

**Steps:**

- [ ] **1.6.1** Write failing test `server/services/agentActivityService.test.ts` — `getRunDetail` returns `eventCount` as an integer count of `agent_execution_events` for the run.
- [ ] **1.6.2** Verify test fails. Commit.
- [ ] **1.6.3** In `getRunDetail`, add a `count(*)` aggregate query on `agent_execution_events` scoped by `run_id`. Add the result as `eventCount` to the returned object. Audit: if `eventCount` already exists in the payload (per §5.2), skip this task with a note.
- [ ] **1.6.4** Run tests → green. `npm run typecheck`. Commit `feat(runs): eventCount on run detail`.

**Test considerations for pr-reviewer:**
- No new DB round-trip — verify the count is part of the existing query path or added as a single extra query (not per-row).
- `eventCount` is 0 for runs without events (no nulls).

**Dependencies:** none.

---

## Phase 2 — Shared hooks and utilities

Four pure-function / small-hook modules that downstream phases consume. No network change; testable in isolation.

---

### Task 2.1 — `client/src/lib/telemetry.ts`

**Contract:**

```typescript
// §12 — 5 fire-and-forget events
export function trackPendingCardOpened(props: { kind: string; lane: string; itemId: string; resolvedVia: 'backend' | 'fallback' }): void;
export function trackPendingCardApproved(props: { kind: string; lane: string; itemId: string }): void;
export function trackPendingCardRejected(props: { kind: string; lane: string; itemId: string }): void;
export function trackActivityLogViewed(props: { rowCount: number; typesPresent: string[] }): void;
export function trackRunLogOpened(props: { runId: string; activityType: string; triggerType: string | null }): void;
```

**Implementation posture:** Until an analytics client lands, each function is a `console.debug('[telemetry]', eventName, props)` shim. Non-blocking; catches any throw so the UI flow is unaffected.

**Steps:**

- [ ] **2.1.1** Create `client/src/lib/telemetry.ts` with the five functions. Each wraps `try { console.debug(...) } catch { /* swallow */ }`.
- [ ] **2.1.2** No tests (per §12 "No test assertions required for telemetry calls").
- [ ] **2.1.3** `npm run typecheck`. Commit `feat(telemetry): thin shim for pulse events`.

**Dependencies:** none.

---

### Task 2.2 — `client/src/lib/formatDuration.ts`

**Contract:**

```typescript
export function formatDuration(ms: number | null): string;
// null → '—'
// 0-999 → '0s'
// 1000-59999 → 'Ns' (floor)
// 60000-3599999 → 'Nm Ns' (floor)
// >=3600000 → 'Nh Nm' (floor)
```

Per §4.3 all rounding is floor.

**Steps:**

- [ ] **2.2.1** Write failing unit test `client/src/lib/formatDuration.test.ts` covering: `null → '—'`, `0 → '0s'`, `999 → '0s'`, `1000 → '1s'`, `1999 → '1s'`, `59999 → '59s'`, `60000 → '1m 0s'`, `119000 → '1m 59s'`, `3599999 → '59m 59s'`, `3600000 → '1h 0m'`, `7800000 → '2h 10m'`.
- [ ] **2.2.2** Verify test fails. Commit.
- [ ] **2.2.3** Implement with `Math.floor`. Pure function, no I/O.
- [ ] **2.2.4** Run tests → green. Commit `feat(util): formatDuration`.

**Dependencies:** none.

---

### Task 2.3 — `client/src/lib/resolvePulseDetailUrl.ts`

**Contract:**

```typescript
// Fallback resolver for legacy opaque detailUrl tokens.
// Used ONLY when item.resolvedUrl is null. Logs a WARN per §2.2 instrumentation rule.
export function resolvePulseDetailUrl(detailUrl: string, subaccountId?: string | null): string | null;
```

**Rules (must match backend in Task 1.2 for consistency):**

| Prefix | Condition | Result |
|---|---|---|
| `review:<id>` | subaccountId present | `/clientpulse/clients/<subaccountId>` |
| `review:<id>` | no subaccount | `null` |
| `task:<id>` | subaccountId present | `/admin/subaccounts/<subaccountId>/workspace` |
| `task:<id>` | no subaccount | `null` |
| `run:<id>` | — | `/runs/<id>/live` |
| `health:<id>` | — | `/admin/health` |
| any other | — | `null` |

Every call logs `console.warn('[resolvePulseDetailUrl] fallback_resolver_used', { detailUrl })` per §2.2 instrumentation.

**Steps:**

- [ ] **2.3.1** Write failing unit test `client/src/lib/resolvePulseDetailUrl.test.ts` covering each row in the table + an unknown prefix case.
- [ ] **2.3.2** Verify test fails. Commit.
- [ ] **2.3.3** Implement as a pure function. Parse via `detailUrl.split(':', 2)`.
- [ ] **2.3.4** Run tests → green. Commit `feat(util): resolvePulseDetailUrl fallback`.

**Dependencies:** logically aligned with Task 1.2's backend rules, but not blocked — can ship either order as long as the two tables match.

---

### Task 2.4 — `client/src/hooks/usePendingIntervention.ts`

**Contract:** See `UsePendingInterventionOptions` + `UsePendingInterventionApi` in Architecture §Contracts.

**Behaviour (per §6.2.1):**

1. `approve(reviewItemId)` POSTs to `/api/review-items/:id/approve`; `reject(reviewItemId, comment)` POSTs to `/api/review-items/:id/reject` with `{ comment }`.
2. Optimistic: set `isPending=true` before the call. Consumers apply their own local state changes to hide the row immediately.
3. On 200: clear error + conflict; fire the appropriate callback (`onApproved` / `onRejected`).
4. On 409 (`ITEM_CONFLICT`): set `conflict=true`, fire `onConflict`. Caller refetches both `/api/pulse/attention` and the drilldown-summary endpoint so both surfaces reflect server state.
5. On 412 (`MAJOR_ACK_REQUIRED`): surface `error='Major acknowledgement required'` — caller routes the user to the context flow (approval modal) rather than handling major-ack in the shared hook.
6. On any other error (400, 500, network): `error` is set, caller shows inline error UI. `?intent` is NOT stripped (per §2.2 failure-handling rule).
7. Re-entry guard: `approve` / `reject` while `isPending===true` returns immediately without firing a second HTTP call.

**No react-query.** Consumers wire their own refetch via the callback options. This matches the repo's existing `api` + `useEffect` pattern.

**Steps:**

- [ ] **2.4.1** Write failing unit test `client/src/hooks/usePendingIntervention.test.ts` (React test setup; mock `api`):
  - Approve success → `onApproved` called, `conflict=false`, `error=null`, `isPending` cycles true→false.
  - Approve 409 → `conflict=true`, `onConflict` called, `onApproved` NOT called.
  - Approve 412 → `error='Major acknowledgement required'`.
  - Approve 500 → `error` set, `onApproved` NOT called.
  - Double-click: second call while first pending is a no-op.
  - Reject with empty comment → throws synchronously before any HTTP.
- [ ] **2.4.2** Verify tests fail. Commit.
- [ ] **2.4.3** Implement `usePendingIntervention(options)` using `useState` for `isPending`, `conflict`, `error`. Use `api.post`. Branch on `err?.response?.status`.
- [ ] **2.4.4** Run tests → green. `npm run typecheck`. Commit `feat(hook): usePendingIntervention`.

**Test considerations for pr-reviewer:**
- 409 vs 412 vs 500 branching correct.
- Double-click guard prevents duplicate HTTP calls.
- Buttons using the hook set `disabled={isPending}`.
- No stale closures — the hook re-reads callbacks on each call.

**Dependencies:** Task 1.1 (backend idempotency). The hook's 409 path assumes 409 = true conflict, which only holds after Task 1.1 lands.

---

## Phase 3 — Home dashboard

Full redesign of `DashboardPage.tsx` per §2. Targets: G1, G2, G3, G4, G13, G16 + telemetry events `pending_card_opened`, `pending_card_approved`, `pending_card_rejected`, `activity_log_viewed`, `run_log_opened`.

---

### Task 3.1 — `PendingApprovalCard` component

**Files to create:**
- `client/src/components/dashboard/PendingApprovalCard.tsx`

**Contract:** See `PendingApprovalCardProps` in Architecture §Contracts.

**Behaviour:**

- Rendered as a `<div>` (per §2.2 / §8.3 nested-anchor rule — never `<a>`).
- Internal children: lane dot (colour from table §3.7), feature badge pill, subaccount name, action description (bold), rationale, three action buttons: "Open in context", "Approve", "Reject".
- The three buttons invoke `onAct(item, 'open' | 'approve' | 'reject')` — the card never calls HTTP directly.
- **Disabled state:** if `resolveDetailUrl(item.detailUrl)` returns `null` AND `item.resolvedUrl` is null, all three buttons are disabled with the tooltip "This item cannot be actioned from here." (per §2.2 null-destination rule).

**Lane → feature badge mapping:**

| Lane | Badge text | Dot colour (Tailwind) |
|---|---|---|
| `client` | `ClientPulse` | `bg-rose-700` (dark red) |
| `major` | `Config change` | `bg-amber-500` |
| `internal` | `Agent clarification` | `bg-slate-500` |

**Steps:**

- [ ] **3.1.1** Create the file with the `<div>`-rooted component. Three buttons: "Open in context" (secondary), "Approve" (primary green), "Reject" (secondary red). All call `onAct(item, intent)`.
- [ ] **3.1.2** Disabled-state logic: compute `destination = item.resolvedUrl ?? resolveDetailUrl(item.detailUrl)`; if null, render all three buttons with `disabled` + `title="This item cannot be actioned from here."`.
- [ ] **3.1.3** `npm run typecheck`. Commit `feat(dashboard): PendingApprovalCard`.

**Test considerations for pr-reviewer:**
- Card never makes HTTP calls.
- Null destination disables all three buttons (matches §2.2).
- Card is `<div>`, not `<a>` — no nested interactive-element bugs.

**Dependencies:** Tasks 1.2, 2.3.

---

### Task 3.2 — `WorkspaceFeatureCard` component

**Files to create:**
- `client/src/components/dashboard/WorkspaceFeatureCard.tsx`

**Contract:** See `WorkspaceFeatureCardProps` in Architecture §Contracts.

**Behaviour:** `<a>` element wrapping title, summary slot, chevron. Card data-fetching is NOT its responsibility — parent passes rendered `summary` content (e.g. a distribution bar or plain text).

**Steps:**

- [ ] **3.2.1** Create the file with a minimal `<a>` component using Tailwind. No data-fetching, no conditional logic beyond rendering the three children.
- [ ] **3.2.2** `npm run typecheck`. Commit `feat(dashboard): WorkspaceFeatureCard`.

**Dependencies:** none.

---

### Task 3.3 — `UnifiedActivityFeed` component

**Files to create:**
- `client/src/components/UnifiedActivityFeed.tsx`

**Contract:** See `UnifiedActivityFeedProps` + `ActivityItemAdditions` in Architecture §Contracts.

**Behaviour (per §4):**

1. On mount: `GET /api/activity?limit=20&sort=newest`.
2. Render columns Activity / Executed by / Status / Duration / When per §4.3.
3. Actor rendering rules per §4.4:
   - `triggeredByUserId` set AND `type` is `review_item` / `inbox_item` → human avatar.
   - `triggerType=='manual'` AND `triggeredByUserId` set → human avatar + agent name as secondary.
   - `agentName` set → agent pill (indigo) + trigger method subtext.
   - Else → italic `"System · <actor>"`.
4. Log link per §4.5: only for `agent_run` / `workflow_execution` with non-null `runId`; otherwise no link.
5. Duration cell uses `formatDuration(durationMs)` (Task 2.2).
6. **Column visibility consistency rule (§4.2):** evaluate column visibility once from the first fetch response. If fewer than 80% of applicable-type rows populate a column (e.g. `durationMs` for `workflow_execution`), omit the whole column for the session. Do not re-evaluate on pagination.
7. Loading state: 4 skeleton rows. Empty state: "No activity yet." in muted text. Error: silent retry (no error panel — §2.6).
8. On mount with data: fire `trackActivityLogViewed({ rowCount, typesPresent })`.
9. On "View log →" click: fire `trackRunLogOpened({ runId, activityType, triggerType })`.

**Steps:**

- [ ] **3.3.1** Create the component skeleton with `useState` for items + `useEffect` for fetch. Renders skeleton, table, or empty state based on load state.
- [ ] **3.3.2** Implement actor-rendering as a pure helper `renderActor(item): JSX.Element` co-located in the file.
- [ ] **3.3.3** Implement column-visibility computation: on first data arrival, compute per-column null-ratio per applicable type. Store result in state; use it to conditionally render each column header + cell. Do not recompute on subsequent pagination within the session.
- [ ] **3.3.4** Implement "View log →" inline link with the `trackRunLogOpened` call wrapped around the click.
- [ ] **3.3.5** Wire `trackActivityLogViewed` inside the initial fetch-succeeded effect.
- [ ] **3.3.6** `npm run typecheck`. Run `npm run build` to catch JSX issues. Commit `feat(dashboard): UnifiedActivityFeed component`.

**Test considerations for pr-reviewer (visual/manual, per G3/G4):**
- Seed one row of each of the six `type` values → all render without crash (G3).
- "View log →" only on `agent_run`/`workflow_execution` with `runId` (G4).
- Identical-timestamp rows render in stable order (secondary `id DESC` from backend).
- Column-visibility is stable for the session — no mid-session shift.

**Dependencies:** Task 1.3, Task 2.1, Task 2.2.

---

### Task 3.4 — Full `DashboardPage.tsx` redesign

**Files to modify:**
- `client/src/pages/DashboardPage.tsx`

**New sections (replace current Quick Chat grid + run chart + recent activity table):**

1. **Header** — keep greeting ("Good morning, Ben") + last-updated subtitle.
2. **Metric tiles (4)** per §2.1:
   - Pending Approval (links to `#pending`; count from `/api/pulse/attention` total)
   - Clients Needing Attention (links to `/clientpulse`; count from `/api/clientpulse/health-summary`: `attention + atRisk`)
   - Active Agents (existing source)
   - Runs (7 days) — reuse existing `/api/agent-activity/stats?sinceDays=7` `totalRuns`
3. **Pending your approval** — priority-sorted list per §2.2. Rendered only if non-empty.
4. **Your workspaces** — 2-card grid per §2.3: ClientPulse + Settings.
5. **Recent activity** — `<UnifiedActivityFeed orgId={user.organisationId} limit={20} />`.

**Removed:** `RunActivityChart`, `HealthAuditWidget`, Quick Chat agent grid, separate Recent Activity table.

**Priority sort** per §2.2: lane priority client > major > internal; within a lane, server returns newest-first. Client flattens the three lanes in lane order without re-sorting.

**Pending section handlers (per §2.2 mode-2 contract):**

```typescript
const handleAct = (item: PulseItem, intent: 'approve' | 'reject' | 'open') => {
  const destination = item.resolvedUrl ?? resolvePulseDetailUrl(item.detailUrl, item.subaccountId || null);
  if (!destination) return;  // should not happen — button would be disabled

  if (intent === 'open') {
    trackPendingCardOpened({ kind: item.kind, lane: item.lane, itemId: item.id, resolvedVia: item.resolvedUrl ? 'backend' : 'fallback' });
    navigate(destination, { state: { sourceItemId: item.id } });
    return;
  }

  // Approve or Reject: mode-2 — navigate to destination with ?intent preserved
  const tele = intent === 'approve' ? trackPendingCardApproved : trackPendingCardRejected;
  tele({ kind: item.kind, lane: item.lane, itemId: item.id });
  const url = `${destination}${destination.includes('?') ? '&' : '?'}intent=${intent}`;
  navigate(url, { state: { sourceItemId: item.id } });
};
```

**Steps:**

- [ ] **3.4.1** Back up the existing page (git commit "chore(dashboard): snapshot before redesign").
- [ ] **3.4.2** Strip out `RunActivityChart`, `HealthAuditWidget`, Quick Chat grid, the separate Recent Activity table, and their associated `useState` / `useEffect` hooks.
- [ ] **3.4.3** Add new state for `attention: PulseAttentionResponse | null` and fetch from `/api/pulse/attention`. Pass `refetchAttention` as a callback to the pending section.
- [ ] **3.4.4** Render the four metric tiles with the new sources listed above.
- [ ] **3.4.5** Render the Pending section: only if total > 0. Flatten lanes in order `client → major → internal`. For each item, render `<PendingApprovalCard item onAct resolveDetailUrl={resolvePulseDetailUrl} />`.
- [ ] **3.4.6** Render the two `<WorkspaceFeatureCard>` children: ClientPulse (with health distribution summary from `/api/clientpulse/health-summary`) and Settings (team + integration status from org context).
- [ ] **3.4.7** Render `<UnifiedActivityFeed orgId={user.organisationId} limit={20} />` at the bottom.
- [ ] **3.4.8** Apply the `§2.6` loading/empty/error rules: skeleton during load; hide Pending section when empty; feed shows its own empty state.
- [ ] **3.4.9** `npm run typecheck` + `npm run build`. Commit `feat(dashboard): home redesign`.

**Test considerations for pr-reviewer (manual per G1/G2/G13/G16):**
- Approve all pending items → Pending section disappears (G1).
- ClientPulse card shows live distribution (G2).
- Click Approve on a client-lane card → lands on drilldown with `?intent=approve`; the destination page auto-opens the approval UI (G13, G16).

**Dependencies:** Tasks 1.2, 1.3, 2.1, 2.3, 3.1, 3.2, 3.3.

---

### Task 3.5 — `?intent` destination-page contract on drilldown

Per §2.2, every mode-2 destination page must implement intent detection. For the v1 destination set, this means `ClientPulseDrilldownPage`. Other destinations (`/admin/health`, `/admin/subaccounts/:id/workspace`, `/runs/:id/live`) are read-only views — Open-in-context lands there without intent auto-open, and this is acceptable per §2.2 "operator sees only the final confirmation step" only applies to approve/reject flows.

For `review:<id>` + `task:<id>` items, the Approve/Reject context flow lives on the drilldown (reviews) and the workspace page (tasks). The drilldown is the primary review destination; the workspace page's approve flow is existing and is out of scope for modification if it already handles `?intent`.

**Focus: drilldown intent handling.** This task wires `?intent` detection into `ClientPulseDrilldownPage`. It is called out here (in Phase 3) because G16 depends on it, but the actual file edits happen in Phase 5 as part of the PendingHero + drilldown changes — see Task 5.3 for the destination-page intent work.

**Steps (here):** none — just the cross-reference pointer.

**Dependencies:** pointer only; actual work in Task 5.3.

---

## Phase 4 — ClientPulse dashboard simplification

Redesign `ClientPulseDashboardPage.tsx` per §3. Targets: G7, G8, G12 (via Task 4.4 clients-list page).

---

### Task 4.1 — `SparklineChart` component

**Files to create:**
- `client/src/components/clientpulse/SparklineChart.tsx`

**Contract:** See `SparklineChartProps` in Architecture §Contracts.

**Behaviour:**
- Accepts `values: number[]` on the 0–100 health-score scale. Clamp each value to `[0, 100]` before rendering.
- Compute SVG polyline points with normalised-to-height mapping: `y = height - (clamp(value, 0, 100) / 100) * height`.
- `stroke={colour}` — colour is a Tailwind class like `text-rose-500` or a CSS token; implemented via `className` on the polyline for Tailwind-driven colours.
- Terminal dot: if `terminalDot` (default true), render `<circle>` at the last point with radius 2.5.
- Empty `values[]` → render a short em-dash placeholder (`<span className="text-slate-300">—</span>`).

**Steps:**

- [ ] **4.1.1** Write failing unit test `client/src/components/clientpulse/SparklineChart.test.ts`:
  - `values=[]` → renders em-dash.
  - `values=[20, 40, 60, 80]` → polyline points computed per the formula (verify via the rendered SVG's `points` attribute).
  - Values outside [0,100] are clamped (e.g. `[150]` renders same as `[100]`).
  - `terminalDot={false}` → no `<circle>` in output.
- [ ] **4.1.2** Verify tests fail. Commit.
- [ ] **4.1.3** Implement the component. Default `width=90`, `height=28`, `terminalDot=true`.
- [ ] **4.1.4** Run tests → green. `npm run typecheck`. Commit `feat(clientpulse): SparklineChart`.

**Test considerations for pr-reviewer:**
- Colour uses Tailwind class, not literal hex.
- Clamping is enforced.
- 90×28 viewport matches §3.2 spec.

**Dependencies:** none.

---

### Task 4.2 — `NeedsAttentionRow` component

**Files to create:**
- `client/src/components/clientpulse/NeedsAttentionRow.tsx`

**Contract:** See `NeedsAttentionRowProps` in Architecture §Contracts.

**Behaviour (per §3.2):**

Row is an `<a>` wrapping: dot + client name + (optional PENDING chip) + sparkline + health score + delta + last-action text + arrow. Links to `client.drilldownUrl`.

- **Dot colour** keyed by `healthBand` per the §3.7 table (Tailwind class, not hex).
- **Sparkline** uses `SparklineChart` with `values={client.sparklineWeekly}` and `colour` matching the band.
- **Health score** rendered as a big numeral coloured by band; delta shown below with an up/down arrow (`↑` for positive delta, `↓` for negative, `—` for zero) and `" / 7d"` suffix.
- **PENDING chip** shown if `client.hasPendingIntervention` — small rose-700 pill with `⚑ PENDING`.
- **Last action** text = `client.lastActionText` (server-formatted). If null, show `—`.

**Steps:**

- [ ] **4.2.1** Create the file. Implement as a pure presentational component.
- [ ] **4.2.2** `npm run typecheck`. Commit `feat(clientpulse): NeedsAttentionRow`.

**Dependencies:** Task 4.1.

---

### Task 4.3 — Redesign `ClientPulseDashboardPage.tsx`

**Files to modify:**
- `client/src/pages/ClientPulseDashboardPage.tsx`

**Changes (per §3.2):**

1. Replace the current "High-Risk Clients" widget (5 rows, no sparklines) with a **Needs Attention** list of up to 7 rows using the new `NeedsAttentionRow` component.
2. Fetch from `GET /api/clientpulse/high-risk?limit=7` (now implemented per Task 1.4).
3. Remove the inline "Propose" button from each row (§3.3).
4. Remove any per-row approval UI — the approval surface moved to the home dashboard per §1.3.
5. Add a `"View all →"` link at the bottom of the list to `/clientpulse/clients` (the new clients list page).
6. Keep: 4 HealthCard tiles, Latest Report widget, Configuration Assistant button, `← Back to home` link (currently `/clientpulse` has a back-link — confirm it points to `/` post-retirement).

**Steps:**

- [ ] **4.3.1** Replace the existing `setHighRisk` / `GET /api/clientpulse/high-risk` call with the new response shape — the endpoint now returns `{ clients, hasMore, nextCursor }` per Task 1.4. Existing callers expecting the old shape need to adapt (check for `clients` property presence).
- [ ] **4.3.2** Render `clients.map(c => <NeedsAttentionRow key={c.subaccountId} client={c} />)` inside the widget container.
- [ ] **4.3.3** Add the `"View all →"` link to `/clientpulse/clients`.
- [ ] **4.3.4** Remove the Propose inline button + its associated `proposingFor` state + `ProposeInterventionModal` entry point from this page (the modal is still used — from the drilldown). Only the inline button on this list is removed.
- [ ] **4.3.5** Verify the back-link target is `/` (home) post-retirement. If the existing Link uses `/admin/pulse`, change to `/`.
- [ ] **4.3.6** `npm run typecheck` + `npm run build`. Commit `feat(clientpulse): simplify dashboard`.

**Test considerations for pr-reviewer (manual per G7/G8):**
- Propose one intervention for a client → PENDING chip appears on their row + row floats to top (G7).
- Sparklines render with correct band colour (G8).

**Dependencies:** Task 1.4, Task 4.2.

---

### Task 4.4 — `ClientPulseClientsListPage` — new page

**Files to create:**
- `client/src/pages/ClientPulseClientsListPage.tsx`

**Route:** `/clientpulse/clients` (added to `App.tsx` in Task 6.2).

**Behaviour (per §6.3):**

1. Full-width filterable list. Header: page title "Clients" + search input + band chips ("All", "Critical", "At Risk", "Watch", "Healthy").
2. Calls `GET /api/clientpulse/high-risk?limit=25&band=<band>&q=<q>` — reuses the Task 1.4 endpoint.
3. Rows use the same `NeedsAttentionRow` component as the dashboard.
4. Load-more button at the bottom if `hasMore === true`. On click: re-fetch with `cursor=<nextCursor>` and append results.
5. Band chips map UI state to query param (`all → all`, `critical → critical`, etc.). `healthy` opts into healthy-only.
6. Back-link in header: `← Back to ClientPulse` → `/clientpulse`.
7. Loading/empty states per §2.6 rules.

**Steps:**

- [ ] **4.4.1** Create the file with `useState` for `{ clients, hasMore, nextCursor }`, `{ band, q }` filter state, and `cursor` history for load-more.
- [ ] **4.4.2** Implement a `fetchPage(cursor?: string)` helper that posts filter state + cursor to the endpoint and either replaces (when `cursor` is undefined) or appends to `clients`.
- [ ] **4.4.3** Re-fetch from scratch when `band` or `q` change (reset cursor).
- [ ] **4.4.4** Render search input with a 300ms debounce on `q`.
- [ ] **4.4.5** Render band chips as toggle-able buttons. Active chip visually distinct.
- [ ] **4.4.6** Render `clients.map(c => <NeedsAttentionRow key={c.subaccountId} client={c} />)`.
- [ ] **4.4.7** Load-more button: shown only if `hasMore === true`. Click appends results via `fetchPage(nextCursor)`.
- [ ] **4.4.8** `npm run typecheck` + `npm run build`. Commit `feat(clientpulse): clients list page`.

**Test considerations for pr-reviewer (manual per G12):**
- Toggle each band chip scopes the list.
- Search narrows.
- Load-more fetches the next page — no duplicates, no skips.

**Dependencies:** Task 1.4, Task 4.2.

---

## Phase 5 — Feature page trims

Per §6: settings 5-tab restructure, drilldown PendingHero + panel trims, surgical fixes to SignalPanel, ProposeInterventionModal changes, subaccount-blueprints + org-templates column trims, onboarding audit. Targets: G9, G10, G11.

---

### Task 5.1 — `PendingHero` component

**Files to create:**
- `client/src/components/clientpulse/PendingHero.tsx`

**Contract:** See `PendingHeroProps` in Architecture §Contracts.

**Behaviour (per §6.2.1):**

- Renders only when `pendingIntervention` is non-null; parent passes `null` when no pending item.
- Banner shows: `actionTitle` (bold), `rationale` (secondary text), `proposedAt` (formatted relative time), Approve button, Reject button.
- Approve + Reject buttons call `onApprove(reviewItemId)` / `onReject(reviewItemId)` — the parent wires these to `usePendingIntervention`.
- No Defer button in v1 (per §11 Deferred Items).
- Internal `isSubmitting` guard prevents double-click; inline error rendered inside the banner when the hook's `error` is set.

**Conflict handling (per §6.2.1):** When `usePendingIntervention` sets `conflict=true`, the parent passes that state down; the banner shows "This item was already updated." inline and buttons are disabled.

**Steps:**

- [ ] **5.1.1** Create the component as a single-banner presentational unit. Accept optional `conflict: boolean` + `error: string | null` props so the parent can drive those states from the shared hook.
- [ ] **5.1.2** Buttons call `onApprove` / `onReject`. On click, wrap the async call in a `try/catch` with a local re-entry guard.
- [ ] **5.1.3** Render the inline error message below the rationale when `error` is set.
- [ ] **5.1.4** `npm run typecheck`. Commit `feat(clientpulse): PendingHero component`.

**Dependencies:** none directly; Task 2.4 for the shared hook that the parent owns.

---

### Task 5.2 — Drilldown: wire PendingHero + panel trims

**Files to modify:**
- `client/src/pages/ClientPulseDrilldownPage.tsx`

**Changes (per §6.2):**

1. Consume the extended drilldown-summary response (Task 1.5) — destructure `pendingIntervention`.
2. Render `<PendingHero pendingIntervention onApprove onReject conflict error />` above the health-score card.
3. Wire `onApprove` / `onReject` to `usePendingIntervention` (Task 2.4). `onApproved` / `onRejected` / `onConflict` callbacks refetch drilldown-summary.
4. Collapse band-transition history: show last 3, "Show history" expander for rest.
5. Cap Signal panel to top 5 signals (per §6.2); "Show more" expands.
6. Demote "Open Configuration Assistant" from prominent button to inline text link in the page footer.

**Steps:**

- [ ] **5.2.1** Update drilldown data fetch to expect `pendingIntervention` on the response. Fall back to `null` if the field is absent (defensive — for partial backend deploys).
- [ ] **5.2.2** Import `PendingHero` and `usePendingIntervention`. Wire the hook with `onApproved`/`onRejected`/`onConflict` callbacks that re-fetch drilldown-summary.
- [ ] **5.2.3** Render the banner at the top of the main column.
- [ ] **5.2.4** Implement band-transition collapse: `useState(isHistoryExpanded)`; show last 3 by default, all when expanded.
- [ ] **5.2.5** Cap signals passed to `SignalPanel` to top 5 before render; add "Show more" expander below.
- [ ] **5.2.6** Demote "Open Configuration Assistant" from a button to an inline `<a>` in the footer.
- [ ] **5.2.7** `npm run typecheck` + `npm run build`. Commit `feat(clientpulse): drilldown PendingHero + panel trims`.

**Test considerations for pr-reviewer (manual per G11):**
- Propose intervention → drilldown shows banner.
- Click Approve → banner hides; review item flips to approved.
- Click Approve when another user already actioned → inline "This item was already updated." message; banner disappears after refetch.

**Dependencies:** Task 1.5, Task 2.4, Task 5.1.

---

### Task 5.3 — Drilldown `?intent` destination contract

**Files to modify:**
- `client/src/pages/ClientPulseDrilldownPage.tsx`

**Changes (per §2.2 `?intent` destination-page contract):**

On mount, if `?intent=approve | reject` is present:

1. **Stale-intent guard.** If `pendingIntervention === null`: show inline message "This item is no longer pending." and strip `?intent` via `navigate(path, { replace: true })`. Do NOT auto-open the approval UI.
2. **Auto-focus.** If actionable, scroll to the PendingHero and focus the appropriate button (Approve or Reject). For Reject: auto-open the rejection-comment modal directly.
3. **Success:** strip `?intent` via `navigate(path, { replace: true })` on successful completion.
4. **Failure:** keep `?intent` in the URL, show inline error within PendingHero, UI stays open (per §2.2 failure-handling rule).

**Steps:**

- [ ] **5.3.1** Add `useSearchParams` or manual `URLSearchParams` parse. Compute `intent = searchParams.get('intent')`. Validate it against `['approve', 'reject']` — anything else is ignored.
- [ ] **5.3.2** On first render after data arrives:
  - If `pendingIntervention === null` AND intent is set: show "This item is no longer pending." inline; strip `?intent` via `navigate(pathname, { replace: true })`.
  - If `pendingIntervention !== null` AND `intent === 'approve'`: auto-focus the Approve button after a short `setTimeout(..., 100)`.
  - If `pendingIntervention !== null` AND `intent === 'reject'`: auto-open the rejection-comment modal.
- [ ] **5.3.3** On a successful approve/reject, `navigate(location.pathname, { replace: true })` to strip `?intent`.
- [ ] **5.3.4** Error path: do nothing — keep `?intent` in the URL.
- [ ] **5.3.5** `npm run typecheck` + `npm run build`. Commit `feat(clientpulse): drilldown intent auto-open`.

**Test considerations for pr-reviewer (manual per G16):**
- Navigate to `/clientpulse/clients/<subId>?intent=approve` from home dashboard card → approval button is focused.
- Action completes → `?intent` is removed from URL.
- Navigate to same URL after item is already approved → inline "This item is no longer pending." shown; `?intent` stripped.
- Action fails (force 500) → UI stays open, inline error shown, `?intent` still in URL for retry.

**Dependencies:** Task 5.2.

---

### Task 5.4 — Settings page 5-tab restructure

**Files to modify:**
- `client/src/pages/ClientPulseSettingsPage.tsx`

**Changes (per §6.1):**

Replace the 10-block vertical scroll with a 5-tab layout:

| Tab slug | Tab label | Blocks |
|---|---|---|
| `scoring` | Scoring | healthScoreFactors, churnBands |
| `interventions` | Interventions | interventionTemplates, interventionDefaults |
| `blind-spots` | Blind spots | churnRiskSignals |
| `trial` | Trial / Onboarding | onboardingMilestones |
| `operations` | Operations | staffActivity, alertLimits, dataRetention, integrationFingerprints |

- Active tab stored in URL via `?tab=<slug>` (so deep-links land on the right tab). Default `scoring`.
- "Configuration Assistant" button moves to the page header, visible regardless of active tab.
- Factor labels on the Scoring tab: use human-readable `label` from the config schema, not raw keys like `last_login_recency` (per §8.4).

**Steps:**

- [ ] **5.4.1** Read `ClientPulseSettingsPage.tsx` to map which components render each of the 10 blocks.
- [ ] **5.4.2** Add `useSearchParams` to read `?tab=` and default to `scoring`. Set on click.
- [ ] **5.4.3** Render 5 tab buttons at the top. Below, render only the block components matching the active tab.
- [ ] **5.4.4** Move the "Configuration Assistant" button into the page header container.
- [ ] **5.4.5** Factor label fix (§8.4): route any `operational_config` key render through the schema's `label` field.
- [ ] **5.4.6** `npm run typecheck` + `npm run build`. Commit `feat(clientpulse): settings 5-tab layout + factor labels`.

**Test considerations for pr-reviewer (manual per G10):**
- All 5 tabs render the correct blocks.
- Searching rendered HTML for `_recency` or `_trend` on the Scoring tab returns no matches.

**Dependencies:** none.

---

### Task 5.5 — ProposeInterventionModal: 90-day trend + remove `s.contribution`

**Files to modify:**
- `client/src/components/clientpulse/ProposeInterventionModal.tsx`

**Changes (per §6.4 + §8.2):**

1. Remove the `s.contribution` render at ~line 177 (currently: `<span className="text-slate-500 font-mono">{s.contribution}</span>`). Leave the signal name only.
2. Add a 90-day trend mini-chart in the modal header context. Data source: reuse existing drilldown band-transitions or health-snapshot endpoints. If reuse is not viable, **do not silently add a new endpoint** — pause, promote the new endpoint to §10, then proceed.

**Steps:**

- [ ] **5.5.1** Remove the contribution render at ~line 177. Verify via `grep -rn "s\.contribution" client/src/components/clientpulse/ProposeInterventionModal.tsx` returning no matches.
- [ ] **5.5.2** Decide on data source for the 90-day trend:
  - Option A: reuse `GET /api/clientpulse/subaccounts/:subaccountId/band-transitions?windowDays=90` — this returns band transitions, not raw scores. May suffice for a visual "trend" if we render transitions as a stepped line.
  - Option B: existing drilldown-summary only exposes a single score + delta — insufficient for a 90-day series.
  - Option C: add `GET /api/clientpulse/subaccounts/:subaccountId/health-history?days=90` — requires §10 promotion.
  - **Decision recorded in this task during implementation.** If Option A suffices (visual trend from band transitions), use it. Otherwise pause + promote Option C to §10.
- [ ] **5.5.3** Render `SparklineChart` with the chosen series. Colour by current band.
- [ ] **5.5.4** If the series is empty (missing history), OMIT the chart entirely per §4.2 data-reliability rule. Do not render a row of dashes.
- [ ] **5.5.5** `npm run typecheck` + `npm run build`. Commit `feat(clientpulse): propose modal trend chart + contribution cleanup`.

**Test considerations for pr-reviewer (per G9):**
- `grep -rn "s\.contribution" client/src/components/clientpulse/ProposeInterventionModal.tsx` returns zero matches.
- Modal opens without errors when trend data is absent.

**Dependencies:** Task 4.1.

---

### Task 5.6 — Subaccount-blueprints + org-templates table trims

**Files to modify:**
- `client/src/pages/SubaccountBlueprintsPage.tsx`
- `client/src/pages/SystemOrganisationTemplatesPage.tsx`

**Changes (per §6.5):**

1. Trim tables to 4 columns maximum.
2. Remove the "Operational config" column.
3. Merge "Browse shared library" button into the "+ New" modal flow as its first step.

**Steps:**

- [ ] **5.6.1** For each file, identify the current columns. Pick 4: Name, 1 key state, 1 timestamp, 1 action (per `docs/frontend-design-principles.md` cap).
- [ ] **5.6.2** Remove the "Browse shared library" button from the page header. Add a tabbed step to the "+ New" modal that presents "Create from scratch" vs "Browse library" as the first decision. If the existing modal cannot easily accept a tab prefix, document the split as a follow-up in `tasks/todo.md` rather than rebuilding it here.
- [ ] **5.6.3** `npm run typecheck` + `npm run build`. Commit `feat(clientpulse): blueprint/template table trims`.

**Dependencies:** none.

---

### Task 5.7 — Onboarding audit (§6.8) — audit-only

**Files to audit (not pre-committed to modify):**
- `client/src/pages/OnboardingWizardPage.tsx`
- `client/src/pages/OnboardingCelebrationPage.tsx`

**Scope:** Audit-only. Confirm celebration copy and wizard microcopy do NOT expose:
- Internal identifiers (UUIDs, prefix hashes, idempotency keys)
- Raw config-key names (`last_login_recency`, `pipeline_value_trend`, etc.)
- Specific LLM / AI provider names (per `docs/capabilities.md` editorial rules 1–5)

**Steps:**

- [ ] **5.7.1** Read both files end-to-end. List every user-facing string literal.
- [ ] **5.7.2** For each literal, check against the three prohibited categories above.
- [ ] **5.7.3** If ALL pass: commit no code change. Add a one-line note to the PR description: "Onboarding audit passed — no copy changes needed."
- [ ] **5.7.4** If ANY fail: promote the affected file to §10 "To modify" in the spec AND add to the "Modify (client)" list in this plan, then fix the copy. Commit `fix(onboarding): remove internal identifiers/config-keys/provider names from copy`.

**Dependencies:** none.

---

## Phase 6 — `/admin/pulse` retirement

Delete `PulsePage.tsx`; repoint routes, nav, and legacy back-links per §7.1. Targets: G6 + the five "Router transition guarantees" checks listed in §7.1.

---

### Task 6.1 — Delete `PulsePage.tsx`

**Files to delete:**
- `client/src/pages/PulsePage.tsx`

**Steps:**

- [ ] **6.1.1** `git rm client/src/pages/PulsePage.tsx`.
- [ ] **6.1.2** Remove the `const PulsePage = lazy(() => import('./pages/PulsePage'));` line from `App.tsx`. TypeScript will catch remaining references.
- [ ] **6.1.3** `npm run typecheck` — expect errors at former usage sites; these are fixed in Task 6.2. Do not commit yet — combine with 6.2.

**Dependencies:** Phase 3 must be landed (home dashboard is the replacement destination).

---

### Task 6.2 — Update `App.tsx` routes

**Files to modify:**
- `client/src/App.tsx`

**Route changes (per §7.1 + §10):**

| Current | New |
|---|---|
| `<Route path="/" element={<Navigate to="/admin/pulse" replace />} />` | `<Route path="/" element={<DashboardPage user={user!} />} />` |
| `<Route path="/admin/pulse" element={<PulsePage user={user!} />} />` | `<Route path="/admin/pulse" element={<Navigate to="/" replace />} />` |
| `<Route path="/admin/subaccounts/:subaccountId/pulse" element={<PulsePage user={user!} />} />` | `<Route path="/admin/subaccounts/:subaccountId/pulse" element={<Navigate to="/" replace />} />` |
| `<Route path="/inbox" element={<Navigate to="/admin/pulse" replace />} />` | `<Route path="/inbox" element={<Navigate to="/" replace />} />` |
| `<Route path="/admin/activity" element={<Navigate to="/admin/pulse" replace />} />` | `<Route path="/admin/activity" element={<Navigate to="/" replace />} />` |
| `<Route path="/admin/subaccounts/:subaccountId/inbox" element={<Navigate to="../pulse" replace />} />` | `<Route path="/admin/subaccounts/:subaccountId/inbox" element={<Navigate to="/" replace />} />` |
| `<Route path="/admin/subaccounts/:subaccountId/activity" element={<Navigate to="../pulse" replace />} />` | `<Route path="/admin/subaccounts/:subaccountId/activity" element={<Navigate to="/" replace />} />` |
| (none) | `<Route path="/clientpulse/clients" element={<ClientPulseClientsListPage user={user!} />} />` — new route for Task 4.4 |

**Steps:**

- [ ] **6.2.1** Remove the `PulsePage` lazy import from `App.tsx` (already done in 6.1.2 if typecheck passed; re-verify).
- [ ] **6.2.2** Apply each row of the table above. Use exact Route declarations matching the existing pattern (lazy Suspense wrapping).
- [ ] **6.2.3** Add `const ClientPulseClientsListPage = lazy(() => import('./pages/ClientPulseClientsListPage'));` near the top of `App.tsx` + the new `/clientpulse/clients` route.
- [ ] **6.2.4** Run `grep -rn "/admin/pulse" client/src/` — only `<Navigate>` redirect registrations are allowed. Zero other matches.
- [ ] **6.2.5** `npm run typecheck` + `npm run build`. Commit `feat(app): retire /admin/pulse; repoint to /`.

**Dependencies:** Phase 3 (home dashboard must be the landing destination), Task 6.1.

---

### Task 6.3 — Update `Layout.tsx` nav

**Files to modify:**
- `client/src/components/Layout.tsx`

**Changes (per §10):**

Lines ~684 and ~691 currently render a "Pulse" nav item pointing to `/admin/pulse` (or the subaccount-scoped variant). Replace with a "Home" link pointing to `/`, since the pending-approval surface now lives on the home dashboard.

**Steps:**

- [ ] **6.3.1** Open `Layout.tsx`. Replace:
  ```tsx
  <NavItem to={activeClientId ? `/admin/subaccounts/${activeClientId}/pulse` : '/admin/pulse'} icon={<Icons.inbox />} label="Pulse" badge={reviewCount} />
  ```
  with:
  ```tsx
  <NavItem to="/" icon={<Icons.inbox />} label="Home" badge={reviewCount} />
  ```
- [ ] **6.3.2** Replace the second occurrence at ~line 691 (`<NavItem to="/admin/pulse" exact ...label="Pulse" />`) with `<NavItem to="/" exact icon={<Icons.inbox />} label="Home" />`.
- [ ] **6.3.3** Verify via `grep -rn "/admin/pulse" client/src/components/Layout.tsx` — zero matches.
- [ ] **6.3.4** `npm run typecheck` + `npm run build`. Commit `feat(layout): repoint Pulse nav to home`.

**Dependencies:** Task 6.2.

---

### Task 6.4 — Repoint `BriefDetailPage` back-link

**Files to modify:**
- `client/src/pages/BriefDetailPage.tsx`

**Change (per §10):** Line ~157 — change `<Link to="/admin/pulse" ...>← Back</Link>` to `<Link to="/" ...>← Back</Link>`.

**Steps:**

- [ ] **6.4.1** Edit the back-link target. Keep existing styling.
- [ ] **6.4.2** `npm run typecheck` + `npm run build`. Commit `fix(brief): repoint back-link to home`.

**Dependencies:** Task 6.2.

---

### Task 6.5 — Router transition verification

**Files:** no code changes — verification pass.

**Per §7.1 transition guarantees:**

**Steps:**

- [ ] **6.5.1** `grep -rn "/admin/pulse" client/src/` — expect only `<Navigate>` redirects in `App.tsx`, zero link destinations elsewhere.
- [ ] **6.5.2** Manually navigate to `/admin/pulse` in the browser → lands on `/` without a 404 or blank screen.
- [ ] **6.5.3** Manually navigate to `/admin/subaccounts/<realId>/pulse` → lands on `/`.
- [ ] **6.5.4** Click the "Home" nav item (formerly "Pulse") → lands on `/`.
- [ ] **6.5.5** Open a brief detail page + click `← Back` → lands on `/`.
- [ ] **6.5.6** Go to home dashboard → click Approve on a pending card → complete the action → click browser Back → lands on home dashboard (not `/admin/pulse`, not a stale URL).
- [ ] **6.5.7** Open browser DevTools console → expect zero React error-boundary warnings across the redirects.
- [ ] No commit — this is verification only.

**Dependencies:** Tasks 6.1, 6.2, 6.3, 6.4.

---

## Phase 7 — Surgical fixes and run meta bar

Four surgical §8 code fixes (non-breaking) plus the run-detail meta bar from §5.1. Targets: G5, G9 (combined with Task 5.5 and 7.2 — which covers the SignalPanel cleanup).

---

### Task 7.1 — FireAutomationEditor: remove `a.id` render

**Files to modify:**
- `client/src/components/clientpulse/FireAutomationEditor.tsx`

**Change (per §8.1):** Line ~39 currently renders `{a.id} · {a.status}`. Replace with `{a.status}` only. The automation ID is an internal UUID, not meaningful to operators.

**Steps:**

- [ ] **7.1.1** Open the file; find the `LiveDataPicker` render block. Replace `<div className="text-[11px] text-slate-500">{a.id} · {a.status}</div>` with `<div className="text-[11px] text-slate-500">{a.status}</div>`.
- [ ] **7.1.2** Verify via `grep -rn "\ba\.id\b" client/src/components/clientpulse/FireAutomationEditor.tsx` — zero matches in the picker render (line ~39 area).
- [ ] **7.1.3** `npm run typecheck` + `npm run build`. Commit `fix(clientpulse): remove a.id from automation picker`.

**Dependencies:** none.

---

### Task 7.2 — SignalPanel: remove `s.contribution` render + cap to top 5

**Files to modify:**
- `client/src/components/clientpulse/drilldown/SignalPanel.tsx`

**Change (per §8.2 + §6.2):**
1. Remove the `<span className="text-[12px] font-mono text-slate-600">{(s.contribution * 100).toFixed(0)}%</span>` render at lines 31-33.
2. Signal name + last-seen date remain. No percentage, no raw contribution.

**Note on top-5 cap:** per Task 5.2.5, the caller (drilldown page) is responsible for slicing to top 5 before passing to SignalPanel. SignalPanel itself remains dumb and renders everything it receives.

**Steps:**

- [ ] **7.2.1** Edit `SignalPanel.tsx`: remove the contribution span at lines 31-33. Leave the rest of the `<li>` intact.
- [ ] **7.2.2** Verify via `grep -rn "contribution" client/src/components/clientpulse/drilldown/SignalPanel.tsx` — only the `interface Signal` definition retains the prop name; no render references.
- [ ] **7.2.3** `npm run typecheck` + `npm run build`. Commit `fix(clientpulse): remove signal contribution from panel`.

**Test considerations for pr-reviewer (per G9):**
- `grep -rn "s\.contribution" client/src/components/clientpulse/` returns zero matches in both SignalPanel and ProposeInterventionModal.

**Dependencies:** none.

---

### Task 7.3 — Nested-anchor guard (§8.3) — verification only

**Files:** none — this is a verification step for work already done in Task 3.1.

**Verification (per §8.3):**

- [ ] **7.3.1** Confirm `PendingApprovalCard.tsx` root element is `<div>`, not `<a>` or `<button>`.
- [ ] **7.3.2** Confirm no ancestor `<a>` wraps a `PendingApprovalCard` in `DashboardPage.tsx`.
- [ ] No commit — this verifies Task 3.1 did the right thing.

**Dependencies:** Task 3.1.

---

### Task 7.4 — Factor labels (§8.4) — verification only

**Files:** none — this is a verification step for work already done in Task 5.4.

**Verification:**

- [ ] **7.4.1** Load the Settings page → Scoring tab → confirm no raw config-key names visible.
- [ ] **7.4.2** `grep -rn "last_login_recency\|pipeline_value_trend" client/src/` — factor keys only exist in schema/config definitions, never in user-facing render paths.
- [ ] No commit.

**Dependencies:** Task 5.4.

---

### Task 7.5 — AgentRunLivePage: run meta bar

**Files to modify:**
- `client/src/pages/AgentRunLivePage.tsx`

**Change (per §5.1 — G5):**

Add a horizontal meta bar below the existing page heading with 5 fields:

| Field | Source |
|---|---|
| Agent name | `runDetail.agentName` |
| Status badge | `runDetail.status` → colour-coded badge (Completed = green, Running = blue, Failed = red, Cancelled = slate) |
| Total duration | `formatDuration(runDetail.durationMs)` |
| Event count | `runDetail.eventCount` — from Task 1.6 |
| Started timestamp | `runDetail.createdAt` → formatted as absolute time |

**Data source:** `GET /api/agent-runs/:id` — already exists; extended in Task 1.6 to include `eventCount`. No new endpoint.

**Optional polish (MAY ship, no gate):** two-column layout + breadcrumb — do NOT ship in this PR; defer per §5.1 and §11.

**Steps:**

- [ ] **7.5.1** Add a state hook to fetch `/api/agent-runs/:id` on mount. Store the meta in state.
- [ ] **7.5.2** Below the existing heading, render a horizontal flex row with the 5 fields. Use `formatDuration` from Task 2.2 for duration. Build the status badge with Tailwind colour tokens.
- [ ] **7.5.3** If the meta fetch fails (404 / 500), hide the bar silently (per §2.6 dashboard widget fail-silent rule). The timeline + drawer continue to work.
- [ ] **7.5.4** `npm run typecheck` + `npm run build`. Commit `feat(runs): meta bar on live run page`.

**Test considerations for pr-reviewer (manual per G5):**
- Open any completed run → meta bar visible with all 5 fields.
- Open a running run → status shows Running; duration updates if connected.
- Force a 500 on the meta endpoint → timeline still works; bar is hidden.

**Dependencies:** Task 1.6, Task 2.2.

---

## Phase 8 — Ship gate verification

Final verification pass against the 16 ship gates (G1–G16) in §9. No new code — this is a checklist-driven manual + automated verification run.

---

### Task 8.1 — Run automated checks

**Steps:**

- [ ] **8.1.1** `npm run typecheck` — green (G14).
- [ ] **8.1.2** `npm run lint` — green (G15).
- [ ] **8.1.3** `npm run build` — green.
- [ ] **8.1.4** `npm test -- reviewService activityService drilldownService agentActivityService` — all service unit tests pass.
- [ ] **8.1.5** `npm test -- usePendingIntervention formatDuration resolvePulseDetailUrl SparklineChart` — client unit tests pass.
- [ ] **8.1.6** `grep -rn "/admin/pulse" client/src/` → only Navigate redirect lines in `App.tsx`; zero other matches (G6 part 1).
- [ ] **8.1.7** `grep -rn "\ba\.id\b" client/src/components/clientpulse/FireAutomationEditor.tsx` → zero matches in picker render (G9 part 1).
- [ ] **8.1.8** `grep -rn "s\.contribution" client/src/components/clientpulse/` → zero matches in SignalPanel and ProposeInterventionModal (G9 part 2).
- [ ] **8.1.9** `grep -rn "last_login_recency\|pipeline_value_trend" client/src/pages/` → only in config/schema files, not UI render paths (G10).

---

### Task 8.2 — Manual verification run through G1–G13, G16

**Steps (one per gate):**

- [ ] **8.2.1 — G1:** Approve all pending items → Pending section disappears on home dashboard. Seed one → section reappears.
- [ ] **8.2.2 — G2:** Change a client's band in the DB → reload home dashboard → ClientPulse workspace card shows updated counts.
- [ ] **8.2.3 — G3:** Seed one activity row of each of the six `type` values → home dashboard feed renders all without React errors.
- [ ] **8.2.4 — G4:** Seeded rows: "View log →" link visible ONLY on `agent_run` / `workflow_execution` rows with non-null `runId`. Human-action rows have no link.
- [ ] **8.2.5 — G5:** Open any completed run → meta bar shows agent name + status + duration + event count + started timestamp.
- [ ] **8.2.6 — G6:** Navigate `/admin/pulse` → lands `/`. Navigate `/admin/subaccounts/<id>/pulse` → lands `/`. Click former-Pulse nav item → lands `/`. Open brief detail + click `← Back` → lands `/`. Zero `/admin/pulse` references outside `App.tsx` redirects.
- [ ] **8.2.7 — G7:** Propose one intervention → PENDING chip appears on that client's row + row floats to top.
- [ ] **8.2.8 — G8:** Sparklines render correct colour per band — visual check against `_archive/prototypes/pulse/clientpulse-mockup-dashboard.html`.
- [ ] **8.2.9 — G9:** Already covered by grep in 8.1.7 + 8.1.8.
- [ ] **8.2.10 — G10:** Open settings → 5 tabs present, block mapping correct (§6.1 table). No raw config-key names visible.
- [ ] **8.2.11 — G11:** Propose intervention → drilldown shows PendingHero → click Approve → hero hides, review item status flips.
- [ ] **8.2.12 — G12:** Navigate to `/clientpulse/clients` → toggle each band chip → type a name → click load-more → all behaviours work.
- [ ] **8.2.13 — G13:** Seed one pending item of each lane (client-health review, major config-change review, internal clarification) → click Approve on each → item is approved in the relevant table. Repeat for Reject.
- [ ] **8.2.14 — G16:** For each lane type, click Approve on the pending card → destination page auto-opens the approval UI with intent pre-selected → single confirmation click completes the action.

---

### Task 8.3 — Review-agent sequence

Per `CLAUDE.md` task workflow and the session playbook.

**Steps:**

- [ ] **8.3.1** Run `spec-conformance: verify the current branch against its spec`. If it returns `CONFORMANT_AFTER_FIXES`, re-run `pr-reviewer` on the expanded changed-code set. If `NON_CONFORMANT`, triage the dated section per CLAUDE.md rules (non-architectural → fix in-session, re-invoke; architectural → promote to `tasks/todo.md` deferred backlog).
- [ ] **8.3.2** Run `pr-reviewer: review the changes I just made to <file list>`. Persist the `pr-review-log` block to `tasks/review-logs/pr-review-log-clientpulse-ui-simplification-<timestamp>.md`. Process findings in the order: blocking non-architectural → in-session fix; blocking architectural → defer; strong recommendations → implement if in-scope.
- [ ] **8.3.3** If the user explicitly asks for `dual-reviewer` AND the session is local: run it and process findings the same way.
- [ ] **8.3.4** Open the PR only after all blocking findings are addressed and `pr-reviewer` (re-run if needed) is clean.

---

## Risks and mitigations

### Rollout friction — legacy bookmarks to `/admin/pulse`

**Risk:** users who bookmarked `/admin/pulse` or `/admin/subaccounts/<id>/pulse` hit the retired route mid-session. If the redirect chain is broken (e.g. `/admin/pulse` → `/` → some deeper flow), they could see a blank page or a stale flash.

**Mitigation:**
- SPA-level `<Navigate to="/" replace />` (Task 6.2) renders instantly without a server round-trip.
- G6 explicitly verifies five navigation paths per §7.1 before the gate passes.
- Task 6.5 (verification) manually exercises each path.

### Split-brain — stale pending card after another user actions the item

**Risk:** operator A sees a pending card; operator B approves the item elsewhere; operator A clicks Approve → stale 409.

**Mitigation:**
- Task 1.1 makes approve/reject idempotent, so replay after the item reached the same terminal state is a silent 200.
- True conflict (different terminal state) returns 409 `ITEM_CONFLICT`; `usePendingIntervention` (Task 2.4) surfaces this as an inline "This item was already updated." message and refetches both queries (Task 3.4 + Task 5.2).
- Stale-intent guard on the drilldown (Task 5.3) handles the case where the item was actioned between home-dashboard render and destination-page arrival.

### Staleness — home dashboard attention list cached during navigation

**Risk:** operator approves from a pending card (mode-2 navigates to destination); on browser Back, the home dashboard still shows the approved item.

**Mitigation:**
- The home dashboard refetches `/api/pulse/attention` on component mount. Browser Back navigation triggers a remount of `DashboardPage` (standard SPA behaviour).
- `usePendingIntervention` optimistic update hides the item immediately locally — but this only helps if the operator stays on the dashboard. On navigation, the data source is the fresh fetch.
- If, in practice, SPA navigation does not remount `DashboardPage` reliably, Task 3.4 can add a `useEffect` on `location.key` change to refetch. Document this as a follow-up if encountered in Phase 8 verification.

### Telemetry cascade — noisy console during QA

**Risk:** `console.debug` shim in `client/src/lib/telemetry.ts` (Task 2.1) produces significant log volume in development.

**Mitigation:**
- `console.debug` is by default hidden in most DevTools views (visible only when Verbose log-level is enabled).
- Swap to a silent no-op if reviewers flag noise. The shim is a single file — swap time is < 5 minutes.

### Load-bearing assumption — `run_type` + `run_source` precomputed at insert time

**Risk:** Task 1.3 derives `triggerType` from `agent_runs.run_type` + `run_source`. If either column is ever null (or written post-hoc), the derivation fails for those rows.

**Mitigation:**
- Grep confirms `agentExecutionService.executeRun` sets `runType` on the insert path.
- `run_source` defaults to `null` on older rows; the mapper falls back to `runType`-only resolution when `run_source` is null.
- Task 1.3 includes a unit test asserting `triggerType !== undefined` for all six activity types, with a `null` fallback for types that don't source it.

### Cursor-signing secret management

**Risk:** Task 1.4's cursor encoding uses HMAC with `PULSE_CURSOR_SECRET`. If the secret is absent in prod, pagination returns 400 on every request.

**Mitigation:**
- Task 1.4 includes adding the key to `.env.example`.
- Document in the PR description that the secret must be added to the prod environment config before deploy.
- If feasible, fall back to a deterministic per-org seed (not fully secret, but unforgeable enough for the current trust model) so the env-var is optional. Decide during implementation — document the decision.

### New endpoint sneaks in during Task 5.5

**Risk:** ProposeInterventionModal's 90-day trend (§6.4) may need a new endpoint. If an endpoint is added silently, inventory drift occurs.

**Mitigation:**
- Task 5.5.2 explicitly forces a decision checkpoint: reuse (Option A) or promote a new endpoint to §10 (Option C). No silent add.
- If Option C is chosen, pause + edit both this plan's §Files and the spec's §10 before proceeding.

### Performance guardrail regression

**Risk:** Task 1.3's users-join and Task 1.4's sparkline aggregation could push endpoints over the 300ms p95 guardrail in §13.

**Mitigation:**
- Task 1.3 uses a single LEFT JOIN (not per-row subquery).
- Task 1.4 batches sparkline aggregation with a single `WHERE observed_at >= now() - interval '28 days'` query + GROUP BY week — no N+1.
- Task 8.1 + 8.2 manual verification should eyeball p95 in dev; if over 300ms, flag during pr-reviewer.

---

## Deferred items

Single source of truth per §11 of the spec. Nothing outside this list is deferred; nothing in it ships in this plan.

- **Defer 24h behaviour** for pending cards + PendingHero.
- **In-place approve/reject mode** (mode-1) for pending cards.
- **Review-detail page** (`/reviews/:id`) for `review:<id>` items — v1 falls back to the drilldown.
- **MRR / revenue-at-risk** on the ClientPulse workspace card.
- **§6.8 Onboarding audit** — conditional promotion only.
- **CRM Queries workspace card.**
- **Agents workspace card.**
- **90-day portfolio trend chart** on `/clientpulse`.
- **Two-column layout** on `AgentRunLivePage`.
- **"Home / Run detail" breadcrumb** on `AgentRunLivePage`.
- **Workspace feature card grid as a data-driven registry.**
- **Per-client briefing email**, **per-client digest email**, **org-level intelligence briefing email**.
- **Operator-alert-received email surface** (retired).
- **Deleted mockups** — template-editor, inline-edit, weekly-digest, capability-showcase.
- **Backend evolution — precomputed attention queue** (§14 scaling note). Backend optimisation; v1 reads on demand.

---

## Self-review

Run this after writing this plan; fix any issue inline.

### Spec-coverage check

| Spec section | Plan coverage |
|---|---|
| §1 Architecture decisions | Captured in Architecture section + Phase 3/4/6 |
| §2 Home dashboard | Phase 3 (Tasks 3.1–3.5) |
| §2.6 Global loading / empty states | Applied across Phase 3 (Task 3.4.8), Phase 4 (4.3 + 4.4), Phase 5 |
| §3 ClientPulse dashboard | Phase 4 (Tasks 4.1–4.4) |
| §3.5 high-risk endpoint contract | Phase 1 Task 1.4 |
| §3.6 / §3.7 component + token contracts | Phase 4 Task 4.1, Architecture §Contracts |
| §4 Unified activity feed | Phase 3 Task 3.3, Phase 1 Task 1.3 |
| §4.2 triggerType precomputation | Phase 1 Task 1.3 + Primitives-reuse note (satisfied by reusing `run_type`/`run_source`) |
| §4.3 column visibility rule | Phase 3 Task 3.3.3 |
| §5 Run detail | Phase 1 Task 1.6, Phase 7 Task 7.5 |
| §6.1 Settings 5-tab | Phase 5 Task 5.4 |
| §6.2 Drilldown panel trim + PendingHero | Phase 5 Tasks 5.1–5.2 |
| §6.2.1 usePendingIntervention + idempotency + 409 | Phase 1 Task 1.1, Phase 2 Task 2.4, Phase 5 Task 5.2 |
| §6.3 Clients list | Phase 4 Task 4.4 |
| §6.4 Propose modal 90-day trend + contribution cleanup | Phase 5 Task 5.5 |
| §6.5 Blueprint/template table trims | Phase 5 Task 5.6 |
| §6.6 FireAutomationEditor `a.id` removal | Phase 7 Task 7.1 |
| §6.7 mockup-only pages | No file edits planned; review during implementation (stated up-front in §6.7) |
| §6.8 Onboarding audit | Phase 5 Task 5.7 |
| §7 Retired surfaces | Phase 6 (Tasks 6.1–6.5) |
| §7.1 Router transition guarantees | Phase 6 Task 6.5 |
| §8 Surgical code fixes | Phase 7 Tasks 7.1–7.4 + Phase 5 Task 5.5 (for ProposeInterventionModal half of §8.2) |
| §9 Ship gates | Phase 8 Task 8.2 |
| §10 File inventory | Plan §Files to change — direct cross-reference |
| §11 Deferred items | §Deferred items section here |
| §12 Telemetry events | Phase 2 Task 2.1 + Phase 3 Task 3.4 usage |
| §13 Performance guardrails | Phase 1 Tasks 1.3 (LEFT JOIN) + 1.4 (batched sparkline), Partial-failure rule noted in Task 1.3 |
| §14 Scaling note | Deferred items |

### Placeholder scan

- Grep the final file for "TBD", "TODO", "handle edge cases", "similar to Task N" → zero matches. Done below.
- Every task has explicit files, exact line numbers where relevant, exact code snippets where load-bearing.

### Type consistency check

- `PulseItem` is the server-side canonical type; client imports derived via `server/services/pulseService.ts` exports or ad-hoc client-side interface that mirrors the server shape. `PendingApprovalCardProps['item']` uses `PulseItem`.
- `HighRiskClientsResponse` is the public API shape — same type used by `ClientPulseDashboardPage` (dashboard widget), `ClientPulseClientsListPage`, and the `NeedsAttentionRow` component. No divergent copies.
- `ActivityItem` + `ActivityItemAdditions` merge cleanly — additive fields never overlap existing fields. `UnifiedActivityFeed` reads the merged type.
- `HighRiskClientsResponse['clients'][number]['healthBand']` uses snake-case values (`'at_risk'`, `'critical'`, `'watch'`, `'healthy'`). `ClientPulseChurnAssessment` schema uses camelCase (`'atRisk'`). **Mismatch flagged** — the route handler must map DB-side `'atRisk'` → response-side `'at_risk'` in the response shaper. Noted in Task 1.4 as a hidden detail; the mapping is a single line but critical.

### Self-consistency gate (pre-PR)

- [ ] Every new file is in both the plan's §Files and the spec's §10.
- [ ] No backward dependencies in phase sequencing (verified in §Phase sequencing).
- [ ] Primitives-reuse note explicitly justifies every new primitive.
- [ ] Error codes in §Architecture match the usage in Task 1.1, Task 2.4, and the conflict handling in §6.2.1.
- [ ] Deferred items list matches the spec's §11.

---

_End of plan._

