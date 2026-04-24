# Spec Review Final Report — clientpulse-ui-simplification-spec

**Spec:** `docs/superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md`
**Spec commit at start:** untracked (new file in worktree; HEAD was `6ee97b7`)
**Spec commit at finish:** `21f20b6`
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`
**Iterations run:** 2 of 5 (MAX_ITERATIONS)
**Exit condition:** two-consecutive-mechanical-only
**Branch:** `claude/clientpulse-ui-simplification-audit`

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|---|---|---|---|---|---|---|
| 1 | 26 | 3 | 29 | 0 | 0 | 0 | 2 (Defer 24h button; CRM + /agents workspace cards) |
| 2 | 7 | 0 | 7 | 0 | 0 | 0 | 0 |

**Totals:** 33 Codex findings, 3 rubric findings, 36 mechanical edits applied, 0 rejected, 2 AUTO-DECIDED items routed to `tasks/todo.md`.

---

## Mechanical changes applied

Grouped by spec section.

### §0 Purpose and scope
- Deferred reference updated from "see §7" to "see §11" (the canonical Deferred Items section created this review arc).
- "In scope" route claims corrected: `/` described with its current-state redirect; `/pulse` retirement reframed as `/admin/pulse` + `/admin/subaccounts/:subaccountId/pulse`; `AgentRunLivePage` route corrected to `/runs/:runId/live`.

### §1.1 `/admin/pulse` routes retired
- Section renamed from "`/pulse` route retired".
- Both org-scoped and subaccount-scoped retirement variants called out explicitly.
- Data-source language switched from "activityService review_item/inbox_item" to the real `pulseService.getAttention()` primitive with `client | major | internal` lanes.

### §1.2 Home dashboard is generic, not ClientPulse-specific
- Generic-vs-hard-coded contradiction resolved: v1 ships a hard-coded 2-card set; can graduate to a data-driven registry later.
- Router change (repoint `/` at `DashboardPage`) called out explicitly.

### §1.5 Run detail is the existing `AgentRunLivePage`
- Route corrected to `/runs/:runId/live`.
- "may be applied" vs G5-mandatory contradiction resolved: meta bar is "MUST ship (G5)"; two-column layout + breadcrumb are "MAY ship (optional polish; no gate)".

### §2.2 Pending approval section
- Data source switched to `GET /api/pulse/attention` — no new endpoint.
- Priority-sort prose aligned with actual `pulseService` lane structure.
- Detail-URL resolver table added (round 2): maps pulseService opaque tokens (`review:<id>`, `task:<id>`, `run:<id>`, `health:<id>`) to real routes.
- Approve/Reject narrowed (round 2) to mode-2 context-flow submission for v1: buttons navigate with `?intent=approve|reject` preserved. In-place mode-1 submission deferred.
- Defer 24h dropped for v1 → §11 Deferred Items.
- "config-assistant-chat" stale reference removed.

### §2.2.1 `PendingApprovalCard` contract (NEW)
- Component contract added (prop types, data ownership).
- Contract narrowed (round 2) to `onAct(item, intent)` — no in-place HTTP calls; parent handles navigation.

### §2.3 Workspace feature cards
- Grid reduced from 2×2 to 2-card (ClientPulse + Settings) for v1 because `/crm` doesn't exist and `/agents` redirects to `/`. Both deferred cards catalogued in §11.
- MRR-at-risk line dropped (round 2) — `/api/clientpulse/health-summary` doesn't expose revenue. Card shows the 3-band distribution + pill counts the endpoint returns.

### §2.3.1 `WorkspaceFeatureCard` contract (NEW)
- Prop contract added: `{ title, href, summary, testId? }`.

### §3.2 Needs Attention list
- `s.contribution` fix reference pinned to the real path `client/src/components/clientpulse/drilldown/SignalPanel.tsx`.
- Cross-reference to §6.2.1 added.

### §3.5 Backend data additions (NEW)
- Full response contract for `GET /api/clientpulse/high-risk` pinned.
- Query params table added (round 2): `limit | band | q | cursor` with semantics.
- Healthy opt-in rule documented.
- Consolidated (round 2) so §6.3 references this contract rather than restating it.

### §3.6 `NeedsAttentionRow` + `SparklineChart` contracts (NEW)
- Prop contracts added.
- Primitive-reuse note: prefer extending `PnlSparkline` over creating a new file; new file in §10 is conditional on extension not being viable.

### §4.2 Activity feed data source
- Endpoint repointed to existing `/api/activity` backed by `listActivityItems()` (not `listRecent`).
- Real `ActivityItem` shape documented (with `detailUrl`, `subaccountId`, `updatedAt`) instead of the fabricated shape.
- Additive fields (`triggeredByUserId | triggeredByUserName | triggerType | durationMs | runId`) called out explicitly as "To modify" on `server/services/activityService.ts`.

### §4.3 / §4.5 Activity feed columns + log link rules
- Log-link target updated to `/runs/:runId/live`.

### §5.1 + §5.2 Run detail page
- Meta bar reclassified as "MUST ship (G5)"; layout + breadcrumb as "MAY ship".
- `GET /api/agent-runs/:id` documented as existing — add `eventCount` only if missing.
- `AgentRunHistoryPage` entry-point claim corrected (navigates to subaccount-scoped route, not live log).

### §6.2 Drilldown
- `PendingHero` section split out into §6.2.1 with its own contract + backend data additions.
- `s.contribution` fix pinned to `SignalPanel.tsx`.

### §6.2.1 `PendingHero` contract + backend data additions (NEW)
- Prop contract, data source, conditional rendering, and `pendingIntervention` backend extension documented.
- Defer button NOT shipped in v1 (parallel to §2.2).

### §6.3 Clients list page
- Simplified (round 2) to reference §3.5 as the single contract; no duplicated endpoint description.

### §6.4 Propose intervention modal
- File path corrected to `client/src/components/clientpulse/ProposeInterventionModal.tsx`.

### §6.5 Subaccount blueprints + org templates
- Built-file names corrected: `AdminAgentTemplatesPage.tsx` → `SubaccountBlueprintsPage.tsx` + `SystemOrganisationTemplatesPage.tsx`.

### §6.6 Fire automation editor
- File path corrected to `client/src/components/clientpulse/FireAutomationEditor.tsx`.

### §6.8 Onboarding pages
- Rescoped to "audit-only; no file changes pre-committed".
- `CreateOrgPage.tsx` (doesn't exist) replaced with real `OnboardingCelebrationPage.tsx`.

### §7.1 `/admin/pulse` routes retirement
- Renamed and expanded: both route variants, client-side `<Navigate>` redirects, cross-ref to G6.
- `/pulse` curl check replaced with SPA redirect verification.

### §7.2 Mockups deleted or marked deferred
- Collapsed to a one-line pointer at §11 (canonical source of truth).

### §8.1 / §8.2 Surgical fixes
- §8.1 path corrected to `client/src/components/clientpulse/FireAutomationEditor.tsx`.
- §8.2 split across `SignalPanel.tsx` + `ProposeInterventionModal.tsx` with line references.

### §9 Ship gates
- G3 / G4 converted from unit-test requirements to manual / visual checks (framing: no frontend unit tests).
- G6 rewritten as SPA redirect verification (not `curl -I /pulse`). Round 2 additions: G6 also covers sidebar nav + BriefDetailPage back-link.
- G9 split to cover both `SignalPanel` and `ProposeInterventionModal` for `s.contribution`.
- G11 / G12 / G13 added (PendingHero render + approve/reject; ClientPulseClientsListPage loaded + filtered + searched + load-more; home-screen pending cards approve/reject complete per lane).
- G14 / G15 = typecheck + lint (renumbered).

### §10 File inventory
- `server/routes/activity.ts` removed from "To create" (already exists); added to "To modify".
- `server/services/activityService.ts` added to "To modify".
- `server/routes/clientpulseReports.ts` added to "To modify" (implement the empty `/api/clientpulse/high-risk` + back the clients-list page).
- `server/routes/clientpulseDrilldown.ts` added to "To modify" (extend with `pendingIntervention`).
- `server/routes/agentRuns.ts` modify note clarified (reuse existing endpoint, only add `eventCount` if missing).
- `FireAutomationEditor.tsx` and `ProposeInterventionModal.tsx` paths corrected to `clientpulse/` subdirectory.
- `SignalPanel.tsx` added to "To modify".
- `AdminAgentTemplatesPage.tsx` → `SubaccountBlueprintsPage.tsx` + `SystemOrganisationTemplatesPage.tsx`.
- `CreateOrgPage.tsx` (nonexistent) removed; onboarding audit-only note added.
- Router change expanded: repoint `/`, remove both `/admin/pulse` PulsePage routes, add redirects, review other `<Navigate to="/admin/pulse" />` usages, add `/clientpulse/clients`.
- Round 2 additions: `Layout.tsx` (remove/repoint Pulse nav items), `BriefDetailPage.tsx` (repoint back-link).
- `SparklineChart` new file conditional on whether PnlSparkline extension is viable.

### §11 Deferred Items (NEW)
- Canonical list of 13 deferred / conditional items.
- Round 2 additions: in-place mode-1 approve/reject; token resolver for `review:<id>`; MRR / revenue-at-risk on the ClientPulse card; onboarding audit-only.

### Contents table
- `§11. Deferred items` entry added.

---

## Rejected findings

None. Every Codex finding and every rubric finding was accepted and applied.

---

## Directional and ambiguous findings (autonomously decided)

Two AUTO-DECIDED items landed in `tasks/todo.md` under `## Deferred from spec-reviewer review — clientpulse-ui-simplification-spec`:

| # | Iteration | Item | Classification | Decision | Rationale |
|---|---|---|---|---|---|
| 1 | 1 | Defer 24h button on pending approval cards | Ambiguous (scope expansion disguised as UI finding) | AUTO-DECIDED reject | Backend has no defer state; adding one is migration + route + state semantics beyond "UI simplification". Re-open if an operator asks for "snooze this decision for a day". |
| 2 | 1 | CRM Queries + Agents workspace cards | Ambiguous (route correctness = fact; whether to ship placeholder cards = directional) | AUTO-DECIDED reject | `/crm` does not exist; `/agents` redirects to `/`. v1 ships a 2-card grid (ClientPulse + Settings). Re-open when routes land. |

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review. Every factual cross-codebase mismatch the reviewers found was corrected; every contradiction was resolved; every under-specified component now has a prop contract; every load-bearing claim has a named backing mechanism; the file inventory and the prose agree; §11 is the single source of truth for deferred scope.

However:

- **The review did not re-verify the high-level product framing** — that "consumer-simple operator UI on top of enterprise-grade backend" (per `docs/frontend-design-principles.md`) is genuinely what the home dashboard + ClientPulse dashboard + activity feed design delivers. The spec's own "primary task check" passages (§2.5, design-principles-aligned) assert this, but the reviewer only verified internal consistency — not whether the design is product-right. Re-read §2, §3, §4 with fresh eyes before starting implementation.
- **The review did not prescribe sprint sequencing.** The spec describes the full work surface but doesn't sequence it. For implementation, consider building in this order: §8 surgical fixes (quickest wins, lowest risk) → §4 unified activity feed (new component + `ActivityItem` additive fields) → §2 home dashboard redesign (depends on §4 feed and §2.2 resolver) → §3 ClientPulse dashboard + backend high-risk endpoint (depends on §3.5 contract being implementable) → §6.3 clients list (reuses §3.5 endpoint) → §6.1 / §6.2 / §6.5 simpler per-page edits → §7.1 retirement + nav cleanup (last, after all new surfaces are live) → §5 run-detail polish (optional; can slip). That is a judgement call for the implementing session — not binding.
- **Three areas warrant human attention before implementation starts:**
  1. **Mode-1 vs mode-2 approve/reject for pending cards** (§2.2). v1 ships mode-2 only — every click navigates to the existing context flow. Verify this matches product intent. If the intent is "approve in one click from the home screen", that is a directional signal that more backend work is in scope than this spec covers.
  2. **Review-detail route for `review:<id>` tokens** (§2.2 resolver; §11). v1 resolves `review:<id>` to the subaccount drilldown. A dedicated `/reviews/:id` page would be a cleaner UX; the review deferred it as out-of-scope. Confirm that choice.
  3. **Data contract for `/api/clientpulse/high-risk`** (§3.5) is materially new backend work — the endpoint returns empty today. Confirm the backend team has time to implement §3.5 as specified BEFORE starting the frontend work that depends on it, or the UI will demo against empty data.

**Recommended next step:** re-read §2.5, §3.1, §4.1, §5.1 (the primary-task framing statements) with fresh eyes, then start with §8 surgical fixes to get quick wins before tackling §4 + §3.5 (the two biggest new pieces of backend work that everything else depends on).

---

## Review-log artifacts produced

- `tasks/review-logs/spec-review-plan-2026-04-24T01-54-01Z.md` (pre-loop plan)
- `tasks/review-logs/spec-review-log-clientpulse-ui-simplification-spec-1-2026-04-24T01-54-01Z.md` (iter 1 summary)
- `tasks/review-logs/spec-review-log-clientpulse-ui-simplification-spec-1-2026-04-24T01-54-01Z-classifications.md` (iter 1 per-finding)
- `tasks/review-logs/spec-review-log-clientpulse-ui-simplification-spec-2-2026-04-24T02-16-00Z.md` (iter 2 summary + per-finding)
- `tasks/review-logs/_clientpulse-ui-iter1-codex-output-v2.txt` (raw Codex round 1 output)
- `tasks/review-logs/_clientpulse-ui-iter2-codex-output.txt` (raw Codex round 2 output)
- `tasks/todo.md` (2 AUTO-DECIDED items appended under `## Deferred from spec-reviewer review — clientpulse-ui-simplification-spec`)
