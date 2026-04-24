# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md`
**Spec commit at check:** `eb040949cfe6112b15fa6bf84da36e2b9be6c157`
**Branch:** `feat/clientpulse-ui-simplification`
**Base (merge-base with main):** `a596688ff5aa5669ee3a60290eb7bdf446a2024a`
**Scope:** Full branch — all phases 1–7 (caller confirmed pre-PR conformance gate, full implementation)
**Changed-code set:** 53 files (committed + staged + unstaged + untracked)
**Run at:** 2026-04-24T06:55:22Z

---

## Contents

- [Summary](#summary)
- [Requirements extracted (full checklist)](#requirements-extracted-full-checklist)
  - [Phase 1 — Backend](#phase-1--backend)
  - [Phase 2 — Shared hooks/utilities](#phase-2--shared-hooksutilities)
  - [Phase 3 — Home dashboard](#phase-3--home-dashboard)
  - [Phase 4 — ClientPulse dashboard + clients list](#phase-4--clientpulse-dashboard--clients-list)
  - [Phase 5 — Feature page trims](#phase-5--feature-page-trims)
  - [Phase 6 — Retired surfaces (covered in REQ 24–26)](#phase-6--retired-surfaces-covered-in-req-24-26)
  - [Phase 7 — Surgical fixes + run meta bar](#phase-7--surgical-fixes--run-meta-bar)
  - [Cross-cutting verdicts (DIRECTIONAL — routed to tasks/todo.md)](#cross-cutting-verdicts-directional--routed-to-taskstodo-md)
- [Mechanical fixes applied](#mechanical-fixes-applied)
- [Directional / ambiguous gaps (routed to tasks/todo.md)](#directional--ambiguous-gaps-routed-to-taskstodomd)
- [Files modified by this run](#files-modified-by-this-run)
- [Next step](#next-step)

---

## Summary

- Requirements extracted:     46
- PASS:                       41
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 5
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (5 directional gaps — see deferred items in `tasks/todo.md`)

> The directional gaps are all spec-vs-implementation divergences that either
> (a) reflect intentional reconciliations against retired routes (§7.1) which
> the spec did not self-update, or (b) represent contract coverage that was
> not extended to all named destinations. None of the five gaps are mechanical
> ("add the missing file / field / column"), and all require either a spec
> amendment or a cross-cutting UI change. Per the agent contract, these are
> routed to the human rather than auto-fixed.

---

## Requirements extracted (full checklist)

### Phase 1 — Backend

| REQ | Category | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|---|
| 1 | behavior | §6.2.1 Idempotency contract | Approve/Reject on `review_items` must be idempotent (replay returns current row, no duplicate side effects); 409 reserved for true conflict | PASS | `server/services/reviewService.ts:77-256` (approveItem), `:266-404` (rejectItem); pre-check via `checkIdempotency()`, `wasIdempotent` flag returned; route gates audit on `!result.wasIdempotent` (`server/routes/reviewItems.ts:141,210`) |
| 2 | schema | §2.2 backend-first resolver | `PulseItem` must include `resolvedUrl: string \| null`; backend resolves per token rules | PASS (with divergence — see REQ 42) | `server/services/pulseService.ts:49` (field), `:81-98` (`_resolveUrlForItem`), `:407,435,463,490` (populated in getAttention), `:580,599,620,638` (populated in getItem) |
| 3 | schema | §4.2 additive fields | `ActivityItem` gains `triggeredByUserId`, `triggeredByUserName`, `triggerType`, `durationMs`, `runId` (all nullable) | PASS | `server/services/activityService.ts:53-57` (type), `:237-245,470-480` (populated for agent_run + workflow_execution), `activityServicePure.ts:110-124` (`addNullAdditiveFields` for types that don't source them) |
| 4 | behavior | §4.2 Ordering tiebreaker | Sort is deterministic with `id DESC` as secondary when `createdAt` ties | PASS | `server/services/activityServicePure.ts:98-102` (`idDesc`), applied in all four sort branches of `sortActivityItems` (`:130-150`) |
| 5 | behavior | §4.2 triggerType precompute | `triggerType` must be precomputed/cached at write time (not derived on read) | PASS | `server/services/activityService.ts:243` (`mapAgentRunTriggerType(run.runType, run.runSource)` — both stored columns on `agent_runs`); `:476` (read directly from `exec.triggerType` column on workflow `executions`) — both sourced from existing stored columns, no read-time join |
| 6 | contract | §3.5 `GET /api/clientpulse/high-risk` | Endpoint returns the full `HighRiskClientsResponse` shape with query params (limit, band, q, cursor) and cursor pagination | PASS | `server/routes/clientpulseReports.ts:83-128`; `server/services/clientPulseHighRiskService.ts` |
| 7 | behavior | §3.5 Sort order | PENDING first, then Critical, At Risk, Watch, Healthy; within band score ASC then name ASC then id ASC | PASS | `clientPulseHighRiskService.ts:84-89` (band order), `:92-106` (`compareRows` — pending → band → score → name → id) |
| 8 | behavior | §3.5 Cursor invariants | Composite cursor encodes `(score, name, id)`; HMAC-signed; stable under concurrent inserts | PASS | `clientPulseHighRiskService.ts:120-124` (encode), `:129-155` (decode + timing-safe compare), `:432-473` (apply) |
| 9 | behavior | §3.5 Internal decomposition | Handler decomposes into `getPrioritisedClients`, `applyFilters`, `applyPagination` | PASS | `clientPulseHighRiskService.ts:189,397,432`; route composes them at `clientpulseReports.ts:110-112` |
| 10 | behavior | §3.5 band='healthy' / band='all' semantics | `band=all` excludes healthy; `band=healthy` returns ONLY healthy | PASS | `clientPulseHighRiskService.ts:407-412` |
| 11 | schema | §6.2.1 drilldown pendingIntervention | `GET /api/clientpulse/subaccounts/:id/drilldown-summary` returns `pendingIntervention: { reviewItemId, actionTitle, proposedAt, rationale } \| null` | PASS | `server/services/drilldownService.ts:20-33` (type), `:68-109` (`getPendingIntervention`), `:158-169` (composed into getSummary) |
| 12 | schema | §5.2 eventCount on run detail | `GET /api/agent-runs/:id` response includes `eventCount` (single count(*) aggregate, not a new route) | PASS | `server/services/agentActivityService.ts:137-142,154` (single aggregate, exposed on return); route passes raw service response at `server/routes/agentRuns.ts:164-170` |
| 13 | behavior | §13 Partial failure resilience | Sparkline/user-join/resolvedUrl failures degrade per-row, not per-response | PASS | `clientPulseHighRiskService.ts:256-294` (sparkline in try/catch with timeout); `activityService.ts` left-joins users; `pulseService.ts:289-322` (each source wrapped in Promise.allSettled + timeout) |

### Phase 2 — Shared hooks/utilities

| REQ | Category | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|---|
| 14 | file | §12 + §4.5 telemetry | `client/src/lib/telemetry.ts` exposes 5 fire-and-forget tracking functions (`pending_card_opened`, `pending_card_approved`, `pending_card_rejected`, `activity_log_viewed`, `run_log_opened`) | PASS | `client/src/lib/telemetry.ts:1-60` (all five exports, try/catch swallow) |
| 15 | file + contract | §4.3 Duration formatting | `formatDuration(ms: number \| null): string` — `null→—`, `0–999ms→0s`, floor-based rules through `Nh Nm` | PASS | `client/src/lib/formatDuration.ts:14-33`; all floor-based, no round-up |
| 16 | file | §2.2 Fallback resolver | `client/src/lib/resolvePulseDetailUrl.ts` — pure fallback + WARN log per call | PASS | `client/src/lib/resolvePulseDetailUrl.ts:11-40` (`console.warn('[resolvePulseDetailUrl] fallback_resolver_used', …)` on every call) |
| 17 | file + contract | §6.2.1 `usePendingIntervention` hook | Shared hook owns approve/reject, optimistic update, conflict handling, inline error state | PASS (with signature divergence — see REQ 43) | `client/src/hooks/usePendingIntervention.ts:35-82`; pure logic in `usePendingInterventionPure.ts`; stable options ref pattern at `:46-49` |

### Phase 3 — Home dashboard

| REQ | Category | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|---|
| 18 | file + contract | §2.2.1 `PendingApprovalCard` | Props `{ item, resolveDetailUrl, onAct }`; root is `<div>` (not `<a>`); null-destination disables all 3 buttons with tooltip "This item cannot be actioned from here." | PASS | `client/src/components/dashboard/PendingApprovalCard.tsx:22-26` (props), `:39` (div root), `:60-85` (3 buttons, all disabled when `isDisabled`, tooltip title matches spec exactly) |
| 19 | file + contract | §2.3.1 `WorkspaceFeatureCard` | Props `{ title, href, summary, testId? }`; renders as `<a>` (React Router `<Link>`) | PASS | `client/src/components/dashboard/WorkspaceFeatureCard.tsx:4-9,18` (Link wrapper) |
| 20 | file + contract | §4 `UnifiedActivityFeed` | Fetches `/api/activity?limit=20&sort=newest`; column-visibility locked from first fetch; 4 actor cases per §4.4; log link rules per §4.5 | PASS | `client/src/components/UnifiedActivityFeed.tsx:70-79` (col visibility once-only), `:111-166` (four actor cases), `:343-370` (log link only when agent_run/workflow_execution + runId) |
| 21 | behavior | §4.6 Loading / empty / error states | Skeleton 4 rows; `"No activity yet."` empty state; silent retry on error | PASS | `UnifiedActivityFeed.tsx:296-315` (4 skeleton rows), `:318-324` ("No activity yet."), `:266-274` (silent fallback) |
| 22 | behavior | §2 DashboardPage redesign | Greeting + 4 metric tiles (Pending Approval, Clients Needing Attention, Active Agents, Runs 7d) + Pending section (hidden when empty) + Workspaces + Activity feed | PASS | `client/src/pages/DashboardPage.tsx:83-231`; metric tiles at `:97-150`; conditional pending section at `:158-174`; workspace cards at `:176-224`; activity feed at `:226-230` |
| 23 | behavior | §2.2 Intent navigation | Approve/Reject → navigate to `destination?intent=…` with `state.sourceItemId`; Open → navigate with state only | PASS | `DashboardPage.tsx:52-66` (handleAct; passes `state: { sourceItemId: item.id }`; appends `intent=…` correctly with `?` or `&`) |
| 24 | file deletion | §7.1 Delete PulsePage | `client/src/pages/PulsePage.tsx` deleted | PASS | File does not exist on branch; git tracks deletion (confirmed via `git diff --name-only main...HEAD`) |
| 25 | behavior | §7.1 Router surgery | `/` → DashboardPage; `/admin/pulse` and `/admin/subaccounts/:subaccountId/pulse` both `<Navigate to="/" replace />`; `/inbox`, `/admin/subaccounts/:id/inbox`, `/admin/activity`, `/admin/subaccounts/:id/activity` repointed to `/`; `/clientpulse/clients` route added | PASS | `client/src/App.tsx:272,277,326,345-350,365`; `grep -rn "/admin/pulse" client/src/` returns only the one `Navigate` registration at line 345 |
| 26 | behavior | §7.1 Nav + back-link | Layout.tsx sidebar has no `/admin/pulse` links (only "Home" → `/`); BriefDetailPage back-link points to `/` | PASS | `Layout.tsx:684,691` (Home → `/`); `BriefDetailPage.tsx:157` (back link `/`); no other `/admin/pulse` references |

### Phase 4 — ClientPulse dashboard + clients list

| REQ | Category | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|---|
| 27 | file + contract | §3.6 `SparklineChart` | Props `{ values, colour (token class), width=90, height=28, terminalDot=true }`; empty fallback | PASS | `client/src/components/clientpulse/SparklineChart.tsx:17-59`; uses Tailwind class via `className` with `stroke="currentColor"`, no literal hex |
| 28 | file + contract | §3.6 `NeedsAttentionRow` | Props `{ client }`; row contains dot · name · sparkline · score+delta · last action · arrow; PENDING chip + sort-to-top + link to drilldown | PASS | `client/src/components/clientpulse/NeedsAttentionRow.tsx:30-109`; PENDING chip at `:72-79`; drilldown Link wrapper at `:60-63` |
| 29 | behavior | §3 ClientPulseDashboardPage simplification | No approval lane; 4 HealthCards + Needs Attention (up to 7 rows) + "View all →" + Latest Report + Config Assistant button in header | PASS | `client/src/pages/ClientPulseDashboardPage.tsx:105-122` (header + Config Assistant button), `:147-172` (4 HealthCards), `:177-195` (Needs Attention with `.slice(0,7)` + "View all →"), `:198-234` (Latest Report) |
| 30 | file | §6.3 `ClientPulseClientsListPage` | New page at `/clientpulse/clients` — band chips + search + load-more + `NeedsAttentionRow` rows | PASS | `client/src/pages/ClientPulseClientsListPage.tsx`; route in `App.tsx:365`; 5 band chips at `:156-171`; debounced search at `:67-73`; load-more at `:203-215`; error state at `:174-178` |

### Phase 5 — Feature page trims

| REQ | Category | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|---|
| 31 | file + contract | §6.2.1 `PendingHero` | New component in drilldown; renders only when pendingIntervention is non-null; inline reject comment flow | PASS (with signature divergence — see REQ 43) | `client/src/components/clientpulse/PendingHero.tsx`; null guard at `:55`; reject textarea + submit at `:114-137`; autoFocusApprove at `:49-53`; initialShowRejectInput at `:45` |
| 32 | behavior | §6.2 Drilldown trims | `PendingHero` above header; signal panel capped to top 5 + "Show more"; band-transitions last 3 + "Show history"; Config Assistant demoted to text link in footer; `s.contribution` removed from SignalPanel | PASS | `client/src/pages/ClientPulseDrilldownPage.tsx:131-139` (PendingHero), `:172-182` (signal cap + show more), `:186-197` (3-row history cap), `:202-207` (footer Config Assistant link); `SignalPanel.tsx:1-36` has no `contribution` render (interface omits field) |
| 33 | behavior | §2.2 + §6.2.1 `?intent=…` destination contract on drilldown | Drilldown reads `?intent=approve\|reject`, auto-focuses Approve or opens reject input; strips `?intent` after success; shows "This item is no longer pending." if not actionable | PASS | `ClientPulseDrilldownPage.tsx:56-58,94-98,104-112,126-130,137-138`; stale-intent path clears intent and shows banner |
| 34 | behavior | §6.1 Settings 5-tab | Scoring / Interventions / Blind spots / Trial / Operations tabs; `?tab=` URL state; Configuration Assistant in header | PASS | `client/src/pages/ClientPulseSettingsPage.tsx:61-67` (TABS), `:95-101` (URL ?tab state), `:146-152` (Config Assistant button in header), `:160-175` (tab bar rendering) |
| 35 | behavior | §6.4 ProposeInterventionModal | Remove `s.contribution` render; add 90-day trend mini-chart in header context | PASS | `ProposeInterventionModal.tsx:216-227` renders only `{s.signal}` (no contribution); `:79-84` fetches band-transitions with `windowDays=90`; `:203-207` renders inline `<SparklineChart …/>` |
| 36 | behavior | §6.5 Blueprints/templates table trim | Both pages trim to 4 columns; remove Operational config / Source / Version / Agents-extra columns | PASS | `SubaccountBlueprintsPage.tsx:262-265` — 4 columns (Name / Agents / Created / Actions); `SystemOrganisationTemplatesPage.tsx:270-273` — 4 columns (Name / Published / Created / Actions); grep confirms no "Operational config" |

### Phase 6 — Retired surfaces (covered in REQ 24–26)

Covered above.

### Phase 7 — Surgical fixes + run meta bar

| REQ | Category | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|---|
| 37 | behavior | §8.1 FireAutomationEditor — remove `a.id` render | Picker must NOT render `a.id` — show only human-readable name (+ status line here) | PASS | `FireAutomationEditor.tsx:36-41` — renders `a.name` + `a.status`; no `a.id` in renderItem (only programmatic use at `itemKey` / `onSelect`) |
| 38 | behavior | §8.2 SignalPanel + ProposeInterventionModal — remove `s.contribution` render | Both surfaces must not render contribution as a percentage/float | PASS | `SignalPanel.tsx` — interface omits `contribution` entirely; `ProposeInterventionModal.tsx:216-227` renders only signal name |
| 39 | behavior | §8.3 PendingApprovalCard root | Must be `<div>`, not `<a>` | PASS | `PendingApprovalCard.tsx:39` — `<div …>` root |
| 40 | behavior | §8.4 Settings factor labels | No raw config-key names in UI — use schema `label` field | PASS | Editor components use schema's `label` field (no direct `_recency`/`_trend` renders in healthScoreFactors/churnRiskSignals editor entry points; progress.md Task 7.4 also verified no raw keys in render paths) |
| 41 | contract | §5.1 + §5.2 Run meta bar | AgentRunLivePage displays 5 fields: agent name, status badge, duration, event count, started timestamp | PASS | `AgentRunLivePage.tsx:211-225` — all 5 fields rendered conditionally under `runMeta`; `eventCount` sourced from `data.eventCount` at `:110` |

### Cross-cutting verdicts (DIRECTIONAL — routed to tasks/todo.md)

| REQ | Category | Spec section | Requirement | Verdict | Gap |
|---|---|---|---|---|---|
| 42 | contract divergence | §2.2 resolvedUrl table for `review:<id>` | Spec resolver table maps `review:<id>` to `/admin/subaccounts/<subaccountId>/pulse` when subaccountId present | DIRECTIONAL_GAP | Implementation resolves to `/clientpulse/clients/<subaccountId>` (the drilldown). This is an intentional reconciliation — §7.1 retires `/admin/subaccounts/:id/pulse` (would redirect to `/`), so the spec's resolver table is self-contradictory. §11 deferred items mentions this as a known tension. Tests in `pulseServiceResolvedUrl.test.ts` codify the new behavior. **The implementation choice is correct; the spec has a stale internal reference that should be patched.** |
| 43 | contract divergence | §6.2.1 `PendingHero` `onReject` signature | Spec: `onReject: (reviewItemId: string) => Promise<void>` — no comment parameter | DIRECTIONAL_GAP | Implementation: `onReject: (reviewItemId: string, comment: string) => Promise<void>`. Backend requires non-empty comment on rejection (`server/routes/reviewItems.ts:193-198` — `COMMENT_REQUIRED`). Progress log records `reject(id,'')` bug fix (comment was being sent empty). The implementation is correct; the spec signature needs the comment parameter added. |
| 44 | coverage | §2.2 `?intent` destination contract (non-drilldown pages) | Spec: "This contract applies to ALL pages that appear in the `resolvedUrl` resolver table (review drilldown, task detail, run detail). If a destination page cannot satisfy this contract in v1, document the gap explicitly in §11 Deferred Items for that page — do NOT silently accept a broken flow." | DIRECTIONAL_GAP | Only `ClientPulseDrilldownPage` reads `?intent`. The task destination (`/admin/subaccounts/:id/workspace` → `WorkspaceBoardPage`) and run destination (`/runs/:id/live` → `AgentRunLivePage`) do NOT read `?intent`. For `failed_run` and `task` kinds, clicking Approve/Reject on a home-dashboard pending card will navigate but will NOT auto-open an approval UI — violating the "one additional click" guarantee in G16. §11 does not list this as deferred. Either (a) extend intent detection to those pages, or (b) add an explicit §11 deferral entry covering task + run destinations. |
| 45 | UX polish | Layout.tsx breadcrumb default label | When breadcrumbs array is empty, Layout renders the literal string "Pulse" as the bar label | DIRECTIONAL_GAP | `client/src/components/Layout.tsx:867` — `<span className="text-slate-900 font-semibold">Pulse</span>` as the default breadcrumb when breadcrumbs is empty. With home dashboard now at `/` (not `/admin/pulse`), this stale "Pulse" label appears on the home page breadcrumb. Not explicitly called out by spec §7.1 (which lists nav + back-link + redirects but not the breadcrumb default). Low-urgency but visible to operators. |
| 46 | coverage | §7.1 Mid-retirement verification per §7.1 router transition table | Spec §7.1 requires manual verification of 5 router transition checks (back-navigation from approval, deep-link, subaccount-scoped redirect, no React error boundary, grep confirms no link destinations to /admin/pulse) before §7.1 is "complete" | DIRECTIONAL_GAP | Static grep passes (REQ 25). The other four checks (browser back after action, deep-link, subaccount redirect, no error boundary) require manual runtime verification. Progress.md Task 6.5 notes "grep confirms only Navigate redirect for /admin/pulse" but does not confirm manual runtime checks. Flag as deferred until QA pass. |

---

## Mechanical fixes applied

None — no MECHANICAL_GAP classifications landed in this run. All 5 directional findings require either a spec edit, a cross-cutting UI coverage change, or a manual QA pass.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

Five items appended to `tasks/todo.md` under the dated section **"Deferred from spec-conformance review — clientpulse-ui-simplification (2026-04-24)"**:

- REQ 42 — resolvedUrl table `review:<id>` target divergence (spec patch needed)
- REQ 43 — PendingHero `onReject` signature divergence (spec patch needed)
- REQ 44 — `?intent` contract coverage missing on task + run destinations (either code or §11 update)
- REQ 45 — Layout.tsx default breadcrumb still reads "Pulse" after home retargeting (UX polish)
- REQ 46 — §7.1 router transition manual-QA checks not yet verified (runtime verification)

---

## Files modified by this run

None. No mechanical fixes were applied.

---

## Next step

**NON_CONFORMANT — 5 directional gaps must be addressed by the main session before `pr-reviewer`.**

Triage the dated section in `tasks/todo.md`:
- REQ 42, 43 are **non-architectural (spec-doc patches)** — can be fixed in-session (edit the spec document) and then this agent re-invoked to confirm closure.
- REQ 44 is **architectural (cross-cutting UI coverage change)** — either expand `?intent` detection to `WorkspaceBoardPage` and `AgentRunLivePage`, or add an explicit §11 deferral entry. If expansion is chosen, it affects two additional pages and merits surfacing via `## PR Review deferred items / ### clientpulse-ui-simplification`.
- REQ 45 is **small non-architectural UI polish** — 1-line fix in `Layout.tsx`, can be closed in-session.
- REQ 46 is **runtime QA** — not auto-fixable; needs a human pass through the 4 manual checks in §7.1.

Per CLAUDE.md `Processing spec-conformance NON_CONFORMANT findings`:
1. REQ 42, 43, 45 → fix in-session → re-invoke `spec-conformance`
2. REQ 44 → escalate decision to user (expand coverage vs. spec deferral); either way, update spec §11 if deferring
3. REQ 46 → out-of-band manual QA; does not gate PR creation if runtime smoke checks pass
4. After closure, re-run `pr-reviewer` on the full branch
