# Composite quality dashboard: dev-session brief

**Status.** Pre-spec brief, ready for a dev session that produces a full spec.
**Owner.** Product (Synthetos).
**Source material.** AP Plus FSI compliance agentic framework demo at AWS Sydney Summit (transcript file `2026-05-14 10-31-42`), specifically the Sara dashboard pattern (single pane of glass, composite enterprise quality score, four quality dimensions, observe-synthesise-act guiding principle). Companion briefs: closed-loop skill improvement (`tasks/research-briefs/closed-loop-skill-improvement-dev-brief.md`) and deterministic validators (`tasks/research-briefs/deterministic-validators-dev-brief.md`).

**Key framing.** This brief is a UI extension of the morning review queue surface specified in the closed-loop brief. **It does not introduce a new nav page.** The composite quality score becomes the header of the existing review queue at the per-subaccount and org-roll-up surfaces, with a separate Synthetos-staff cross-org admin view that follows the same shape as `/system/llm-pnl`. The dashboard is the visualisation layer over data that the closed-loop and deterministic-validators briefs already produce; it does not generate new data, it surfaces what is already there in a form that is glanceable.

---

## Contents

1. One-paragraph summary
2. Context
   - 2.1 Glossary
   - 2.2 What exists today (with file paths)
   - 2.3 Why a composite score, not raw metrics
3. Architectural decisions
   - 3.1 Composite quality score formula
   - 3.2 Score dimensions (Phase 1 set)
   - 3.3 Per-subaccount operator surface (header on review queue)
   - 3.4 Org admin cross-subaccount roll-up
   - 3.5 Synthetos staff cross-org admin view
   - 3.6 Drill-in pattern
   - 3.7 Trend visualisation and snapshot persistence
4. What is explicitly out of scope (Phase 1)
5. Sequencing inside Phase 1
6. Open questions for the dev session
7. Success criteria
8. Known failure modes we are designing against
9. What this brief is not

---

## 1. One-paragraph summary

We are adding a composite quality score that surfaces, in one number plus a one-line "what to address first" callout, the health of a subaccount. The score is derived from data the closed-loop and deterministic-validators briefs already produce: scorecard pass rate, operator correction rate, amendment churn, and run cost trend. Three surfaces consume the same underlying data with different aggregations. The per-subaccount operator sees a header on top of the morning review queue (no new nav). The org admin (agency owner) sees the cross-subaccount roll-up that is already specified in the closed-loop brief, now extended with composite scores per subaccount and sortable by attention-needed. Synthetos staff get a system-tier admin view (similar in spirit to `/system/llm-pnl`). Each surface uses the same drill-in pattern: composite first, dimension breakdown on click, raw verdicts on further drill. Snapshots persist for trend analysis. Goal is to change the operator's daily question from "what is broken" to "is anything broken, and if so, what should I do first."

## 2. Context

### 2.1 Glossary

- **Composite quality score.** Single 0-100 number summarising the health of a subaccount across the dimensions in §3.2.
- **Score dimension.** One axis of the composite (quality, stability, cost, capacity in Phase 1). Each dimension produces its own 0-100 sub-score; the composite is a weighted average.
- **Sub-score.** A dimension's value at a point in time, computed from one or more underlying metrics over a rolling window.
- **Snapshot.** A persisted record of `(scope, dimension, sub-score, composite, computed_at)`. Used for trend analysis and to avoid recomputing on every page load.
- **Attention callout.** A one-line, deterministically-generated string that points at the highest-priority item the operator should address. E.g. "5 amendments awaiting review for over 24 hours."
- **Drill-in dialog.** The expansion pattern where clicking on a composite score opens a dialog showing the four dimensions; clicking on a dimension shows the underlying metrics; clicking on a metric shows the raw verdicts. No page navigation required.
- **Operator surface.** The per-subaccount surface (subaccount admin or org admin acting in subaccount context) where the morning review queue lives. Composite score becomes the header.
- **Roll-up surface.** The org admin's cross-subaccount view (already specified in closed-loop brief §3.4). Composite score per subaccount, sortable.
- **Admin surface.** Synthetos staff view across all orgs. Relaxed design budget; not customer-facing.

### 2.2 What exists today (with file paths)

Everything below is operational on `main` or specified in the companion briefs. The dashboard does not invent new data; it surfaces existing data.

**Scorecard verdicts (the primary input):**
- `server/db/schema/scorecardJudgements.ts` — immutable verdict rows.
- After deterministic-validators brief lands: same table, with `evaluation_method` distinguishing deterministic from semantic verdicts. Composite computation treats them identically.

**Operator corrections:**
- `server/services/feedbackService.ts` — `feedbackVotes` table on `task_activity`, `task_deliverable`, `agent_message`. Today decorative; closed-loop brief specifies their use as a gate metric.

**Amendment churn (from closed-loop brief):**
- `skill_amendments` table (specified in closed-loop brief §3.1). Phase 1 of this dashboard reads `created_at`, `accepted_at`, `rejected_at` to compute churn rate.

**Run cost (from existing LLM ledger):**
- `server/db/schema/llmRequests.ts`, `server/services/systemPnlService.ts` — per-run cost attribution shipped via PR #158 (migrations 0185-0191). Already aggregable per subaccount and per skill.

**Run failure rate:**
- `server/db/schema/agentRuns.ts` — `agent_runs` with status. Aggregable by subaccount.

**Morning review queue (from closed-loop brief §3.4):**
- The page that the per-subaccount composite header attaches to. Two flavours per the closed-loop brief: in-workspace queue (subaccount-scoped) and cross-subaccount org-level roll-up.

**Existing admin surface as design reference:**
- `server/routes/systemPnl.ts`, `client/src/pages/SystemPnlPage.tsx` — `/system/llm-pnl` admin page. The Synthetos-staff cross-org view in §3.5 should reuse this page's layout patterns and access control.

### 2.3 Why a composite score, not raw metrics

The frontend design principles in `docs/frontend-design-principles.md` push hard against dashboards. They state explicitly: default to hidden; KPIs and dashboards are deferred unless a workflow requires them; inline state beats dashboards (status dot beats utilisation chart). At first glance, a composite quality dashboard looks like a violation.

The reason this brief is consistent with the principles, not in tension with them, is the workflow anchor.

The morning review queue in the closed-loop brief is the workflow that requires the composite score. An operator opens the queue to act on pending amendments. To act intelligently they need to know "is the trend getting better or worse" and "which item should I address first." Without the composite header, they have to context-switch to four other places to figure out the picture, then come back. With the composite header, the picture is at the top of the page they are already on.

The roll-up surface for org admins (already in scope in the closed-loop brief) faces the same workflow. An agency owner with 30 client subaccounts cannot review 30 queues every morning. They need to know which client needs them. The composite per subaccount, sortable, **is** that workflow.

The Synthetos-staff admin surface is explicitly not consumer-simple. It is staff-only, similar to `/system/llm-pnl`. The relaxed design budget applies.

So the composite score is workflow-anchored on every surface. It is not a free-floating dashboard. It is the header of pages that already exist for action.

The second reason for compositing rather than showing raw metrics is **noise filtering**. Scorecard pass rate alone fluctuates run-to-run. Operator correction rate alone is noisy on small subaccounts. Amendment churn alone misses cost regressions. The composite is not a more informative number than the four dimensions; it is a more **glanceable** number. The dimensions are still available via drill-in for when the operator needs detail.

## 3. Architectural decisions

### 3.1 Composite quality score formula

A weighted average of the four dimension sub-scores in §3.2, normalised to 0-100, with discrete bands.

```
composite = round(
    weight_quality   * subscore_quality +
    weight_stability * subscore_stability +
    weight_cost      * subscore_cost +
    weight_capacity  * subscore_capacity
)
```

**Initial weights:** equal (0.25 each). Rationale: we do not yet know which dimension correlates best with operator-perceived health. After 4-6 weeks of operation, weights are tunable per org by Synthetos staff (and eventually self-service for org admins, deferred). Equal weights are a defensible default; biased weights without evidence are worse.

**Bands (per the FSI Sara dashboard pattern):**
- 80-100: green ("healthy")
- 60-79: amber ("attention needed")
- 0-59: red ("intervention needed")

These thresholds are starting defaults. Once the no-op canary calibration from the staged-rollout brief runs, the bands can be adjusted to match the actual variance distribution per dimension. Until then, deliberately wide bands prevent the composite from flickering colour day-to-day.

**Sub-score normalisation.** Each dimension is computed in its own units, then normalised to 0-100 via a per-dimension function. The functions are simple (linear or piecewise) and configurable. The intent is that "100" means "best observed performance" and "0" means "intervention needed", with the mapping calibrated per dimension to the typical operator's expectation.

### 3.2 Score dimensions (Phase 1 set)

Four dimensions. Map to the AP Plus FSI demo's four dimensions in spirit (regulatory compliance, operational risk, platform quality, QA) but adapted to Synthetos's product surface.

**Quality.** How often the agent is producing output the system considers good.
- Inputs: scorecard pass rate (weighted 0.7), operator correction rate (weighted 0.3, inverted).
- Window: rolling 7 days.
- Sub-score formula: `100 * (0.7 * pass_rate + 0.3 * (1 - normalised_correction_rate))`.
- High correction rate is treated as a strong negative signal because it is a direct human "the agent got this wrong."

**Stability.** Whether behaviour is changing in concerning ways.
- Inputs: amendment acceptance rate (weighted 0.5), run failure rate (weighted 0.3, inverted), amendment churn (weighted 0.2, inverted).
- Window: rolling 7 days for failure and acceptance, rolling 14 days for churn.
- High amendment churn (many new amendments per skill per week) is treated as a drift warning. Steady amendment growth is the slow-drift signal called out in the closed-loop brief.

**Cost.** Whether spending is in the expected range.
- Inputs: cost per run vs 30-day baseline (weighted 0.6), token usage trend (weighted 0.4).
- Window: rolling 7 days, baseline 30 days.
- Sub-score is 100 if cost is at or below baseline; degrades linearly above. Cost regressions are weighted symmetrically — a 20% increase has the same impact regardless of absolute cost, which keeps the score meaningful for both small and large subaccounts.

**Capacity.** Whether the operator's review workflow is keeping up.
- Inputs: pending amendment review queue depth (weighted 0.5), median review latency (weighted 0.5).
- Window: snapshot of current state.
- A queue depth above the per-skill weekly cap (from closed-loop brief §3.7) is a hard 0; otherwise scales linearly. Median review latency above 48 hours is a hard 0; otherwise scales.

**Why these four, not the FSI four.** AP Plus is a payments-regulated organisation; their dimensions are regulatory compliance, operational risk, platform quality, QA. We are an automation OS for agencies; our equivalents are quality, stability, cost, capacity. Same shape, same purpose, mapped to our customer's actual concerns.

**Safety-class metrics live outside the composite.** Safety scorecard regressions (PII leak, jailbreak, action-policy) are surfaced as separate red banners that override the composite. A subaccount with a safety regression is "intervention needed" regardless of the composite score. This matches the staged-rollout brief's hard-stop posture and prevents a green composite from masking a serious issue.

### 3.3 Per-subaccount operator surface (header on review queue)

A compact header injected into the existing morning review queue page (the page specified in closed-loop brief §3.4). No new route. No new nav item.

**Visual budget (consumer-simple):**
- Single composite number (large, glanceable).
- Traffic-light arrow indicator vs last week (up green, down red, flat grey).
- One-line attention callout (deterministically computed; see below).
- A single "details" affordance that opens the drill-in dialog (§3.6).

**Attention callout rules.** Deterministic, not LLM-generated, in Phase 1. The system picks the highest-priority issue from a fixed priority list:

1. Safety scorecard regression in last 24h → "Safety check `<slug>` regressed; review immediately."
2. Pending amendments awaiting review for over 24h → "<N> amendments awaiting review for over 24 hours."
3. Composite score dropped more than one band vs last week → "Composite score dropped from `<old>` to `<new>` this week."
4. Cost per run up more than 20% vs 30-day baseline → "Run cost up `<pct>%` vs baseline."
5. Operator correction rate up more than 30% vs prior week → "Correction rate up; review recent agent outputs."
6. Otherwise → "All systems healthy" (or omit the callout entirely).

Rule-based, not agentic, in Phase 1. The deterministic-validators brief argues the same case: deterministic rules are explainable, cannot be gamed, and cost nothing. Agentic callouts can be added later if rules feel limiting.

**No standalone /quality or /health page is added.** The composite header is the only operator-facing surface for the score. Operators are not navigating to a dashboard; they are landing on the review queue and seeing the score in context.

### 3.4 Org admin cross-subaccount roll-up

The cross-subaccount roll-up page is already specified in the closed-loop brief §3.4 (review surface for org admins, scoped to all subaccounts they own). This brief extends that page with composite scores and sortability.

**Visual budget (relaxed admin):**
- One row per subaccount.
- Columns: subaccount name, composite score (with band colour), trend arrow vs last week, attention callout (truncated), pending amendments count, last activity timestamp.
- Sort by composite score (ascending = worst first), by trend (descending = biggest drops first), by pending amendments, by last activity.
- Filter by org-admin-defined subaccount tags (if subaccount tagging exists; otherwise deferred).
- Bulk actions: "review pending amendments" link drills into the cross-subaccount queue from the closed-loop brief.

**Attention prioritisation.** The default sort surfaces the subaccount that needs the most attention at the top. An agency owner with 30 clients opens this page once a day, sees their three at-risk clients at the top, drills in, acts.

**No drill-in to the dashboard surface itself.** Drilling on a subaccount's row opens the per-subaccount review queue (the surface in §3.3) for that subaccount, with the composite header as expected. Same UI components, scoped differently.

### 3.5 Synthetos staff cross-org admin view

A new system-tier admin page at `/system/quality` (or similar — naming open in §6). Staff-only, behind the existing `/system/*` auth pattern (same as `/system/llm-pnl`).

**Visual budget (relaxed admin, staff-only):**
- Top-level rollup: composite score by org, sortable, with trend.
- Drill into an org: roll-up by subaccount (same shape as §3.4 but at system tier).
- Drill into a subaccount: per-skill composite breakdown.
- Optional: filter by skill, surface "which skill is dragging the most subaccounts down."

**Why this exists.** Two reasons:
1. Product team needs a feedback loop. If a system skill is consistently producing low quality scores across many subaccounts, that is a system-skill bug or a missing amendment opportunity. The cross-org view surfaces this.
2. Customer success and account management need context. When talking to a customer, knowing whether their composite is improving, declining, or stable is useful context.

**Layout reuse.** Pattern after `client/src/pages/SystemPnlPage.tsx` for visual consistency. Same access control, same admin-tier auth.

### 3.6 Drill-in pattern

Three levels of detail, all reachable from any of the three surfaces. Designed as a dialog (or in-page expansion) on the operator surface to avoid nav. The roll-up and admin surfaces use page-level navigation because they are already admin surfaces and the budget allows it.

**Level 1: composite.** What the surface shows by default. Single number, band, trend, callout.

**Level 2: dimensions.** Click on the composite. Shows the four dimensions (quality, stability, cost, capacity) with their sub-scores, individual trends, and the inputs that fed each. Each dimension is expandable.

**Level 3: raw verdicts and metrics.** Click on a dimension. Shows the underlying records: for quality, the recent failed scorecard verdicts and recent operator corrections; for stability, the recent amendments and run failures; for cost, the recent expensive runs; for capacity, the pending review queue depth and review latency distribution.

**Anchors to existing pages.** Clicking on a verdict opens the existing run detail page (already in product). Clicking on an amendment opens it in the morning review queue. Clicking on a cost outlier opens the LLM ledger view. The dashboard does not duplicate any existing page; it points into them.

**Why dialog, not a separate page, for the operator surface.** Two reasons. First, the operator is on the review queue to take action; pulling them away to a separate page interrupts that. Second, the consumer-simple budget pushes against adding nav items that exist only for inspection. The dialog opens, the operator inspects, the dialog closes, the operator returns to the queue.

### 3.7 Trend visualisation and snapshot persistence

**Snapshot persistence.** A new table `quality_score_snapshots` stores the computed composite and sub-scores per scope per timestamp.

```
quality_score_snapshots(
  id uuid pk,
  scope_type enum ('subaccount', 'org', 'system'),
  scope_id uuid nullable,        // null for system scope
  composite_score integer,
  subscore_quality integer,
  subscore_stability integer,
  subscore_cost integer,
  subscore_capacity integer,
  computed_at timestamptz,
  inputs_hash text                // hash of underlying metrics for cache invalidation
)
```

**Computation cadence.** A scheduled job runs hourly, computes the snapshot for every subaccount, every org, and the system rollup. Storing snapshots avoids recomputing on every page load. Trend graphs read from snapshots; current-state reads compute on-demand if the most recent snapshot is older than the SLA (default: 1 hour).

**On-demand recomputation.** A "refresh now" button on each surface triggers an immediate recomputation. Useful when the operator has just acted on something and wants to see the impact.

**Trend visualisation.** Sparkline only on Phase 1. No full-page line chart; the sparkline shows the last 30 days at the dimension level inside the drill-in dialog. Anchored to the frontend principles: a sparkline is inline state, a full-page line chart is a dashboard. Sparklines pass the rule; full-page charts do not.

**Retention.** Snapshots retained for 365 days. Old snapshots aggregated into weekly summaries beyond 90 days for storage efficiency. Retention is a Synthetos-staff configuration, not user-facing.

## 4. What is explicitly out of scope (Phase 1)

- **Standalone /quality or /health page in operator nav.** Operator surface is the morning review queue header only. Frontend principles forbid the standalone page.
- **LLM-generated attention callouts.** Phase 1 callouts are deterministic rules. Agentic callouts are a Phase 2 question.
- **Self-service weight tuning by org admins.** Weights are equal in Phase 1 and Synthetos-staff-tunable per org. Self-service is deferred until we have evidence the simple weights are wrong.
- **Predictive scoring (future composite forecasts).** Phase 1 reports current and historical state only. No "your score will drop next week if X" predictions.
- **Tying composite to incentives, alerts, or SLAs.** Goodhart's law risk; the score is for situational awareness, not for performance management. Explicitly not a contract.
- **Per-skill composite breakdown on the operator surface.** Operators see subaccount-level composite. Per-skill breakdown is in the system-staff admin surface only, because per-skill detail is too granular for the daily operator workflow.
- **Public/customer-facing trust score.** The composite is internal operational telemetry, not a customer-facing trust badge. Explicit framing in §9.

## 5. Sequencing inside Phase 1

This brief has soft prerequisites: the morning review queue from the closed-loop brief should exist (or be in build) before §3.3 ships. The composite header is meaningless without the page it attaches to. The system-staff admin surface (§3.5) has no such dependency and can ship independently.

**Step 1.** Schema: `quality_score_snapshots` table; aggregation queries for each dimension; rolling-window helpers.

**Step 2.** Composite computation engine: per-dimension sub-score functions, weighted composite, attention-callout rule engine. Pure logic, unit-tested, no UI yet.

**Step 3.** Scheduled snapshot job: hourly recomputation per subaccount, per org, system rollup. Persists to `quality_score_snapshots`. On-demand recomputation API endpoint.

**Step 4.** System-staff admin surface (§3.5). Builds first because it has no dependency on the morning review queue and gives Synthetos staff visibility into the composite logic before customer-facing surfaces ship. Pattern after `/system/llm-pnl`.

**Step 5.** Per-subaccount operator surface header (§3.3). Drops into the existing morning review queue page. Composite, trend arrow, attention callout, drill-in dialog.

**Step 6.** Org admin cross-subaccount roll-up extension (§3.4). Extends the cross-subaccount review surface from the closed-loop brief with composite columns and sortability.

**Step 7.** Drill-in dialog component (§3.6). Single React component reused across all three surfaces. Renders dimension breakdown and links to existing pages for raw verdicts.

**Step 8.** Sparkline visualisation in drill-in dialog. Reads from snapshots.

**Step 9.** Documentation: a one-page operator guide explaining what the composite means, how to interpret the bands, what each dimension measures, and where the data comes from. Lives in customer-facing docs.

Estimated rough size: 4 to 6 weeks of focused build for one engineer, much of it UI work. Soft-dependent on closed-loop brief Phase 1 (specifically the morning review queue) being far enough along that the header has somewhere to attach. The system-staff admin surface (§3.5) and the snapshot infrastructure can ship before that dependency is satisfied.

## 6. Open questions for the dev session

1. **Naming for the staff admin surface.** `/system/quality` vs `/system/health` vs `/system/composite-score`. Recommend `/system/quality` for consistency with existing `/system/llm-pnl`.
2. **Window choice per dimension.** Brief proposes 7 days for quality and stability, 30 days for cost baseline, 14 days for amendment churn. Confirm or adjust.
3. **Sub-score normalisation curves.** Linear vs piecewise vs sigmoid for converting raw metrics to 0-100. Recommend linear with explicit anchors per dimension; can tune later.
4. **Org-level composite rollup formula.** Average of subaccount composites? Weighted by subaccount run volume? Recommend weighted by run volume so a small subaccount with bad health does not dominate an active org's score, but flag this as a real product decision.
5. **Sparkline granularity.** Daily points over 30 days, or hourly over 7 days? Recommend daily for the composite (smoother), with the option to switch to hourly in the dialog if the operator wants more detail.
6. **Refresh-now button rate limiting.** How often can a single operator trigger on-demand recomputation? Recommend 1 per 5 minutes per scope.
7. **Safety-class banner positioning.** Brief proposes a separate red banner that overrides the composite. Confirm this UX. Alternative: composite goes red when safety-class regression occurs, but this risks hiding the specific safety failure under a vague composite drop.
8. **Operator workload sanity check.** How long should an operator spend reading the composite header before clicking through? Target: under 10 seconds for a healthy state, under 30 seconds when amber. Useful as a UX testing benchmark.

## 7. Success criteria

Build is successful when:

1. Every subaccount with at least 7 days of activity has an hourly-refreshed composite score persisted to `quality_score_snapshots`.
2. The composite header renders on the morning review queue with composite, trend, and attention callout visible above the fold without scroll on a 1280-wide viewport.
3. Drill-in dialog renders the four dimensions with sparklines within 500ms of click on a typical subaccount.
4. The cross-subaccount roll-up sorts subaccounts correctly by composite, trend, and attention.
5. Synthetos staff can view system-tier composite at `/system/quality` and drill into any org and any subaccount.
6. Safety-class regressions surface as red banners that override the composite presentation.
7. After 4 weeks of operation in an internal Synthetos subaccount, the composite score correctly anticipates manual operator assessment of subaccount health (i.e., when a Synthetos engineer reviews a subaccount and judges it healthy or unhealthy, the composite agrees in at least 80% of cases).
8. No operator has reported using the dashboard as a vanity metric; all uses observed in user research are tied to action (drilling in, reviewing amendments, investigating cost outliers).

## 8. Known failure modes we are designing against

- **Goodhart's law (the score becomes the goal).** *Mitigation:* explicit framing in §9 that the composite is internal awareness, not a contract or KPI. Phase 1 explicitly does not tie the composite to incentives, alerts, or SLAs. Surface remains internal even at the org admin level.
- **Aggregation hides the action.** A composite that is too smooth misses individual issues. *Mitigation:* the attention callout is rule-based and surfaces specific items; the drill-in dialog is one click away; safety-class banners override the composite.
- **Noise-driven score flicker.** A composite that changes colour every refresh erodes trust. *Mitigation:* deliberately wide bands (60/80 thresholds), rolling 7-day windows for the noisiest inputs, snapshot persistence (no per-refresh recomputation).
- **Operator ignores the dashboard because it is decoration.** *Mitigation:* the composite is the header of a page operators already visit daily for action. There is no "go to dashboard" step. The score is in the path.
- **Cross-subaccount roll-up overload.** An agency owner with 100 subaccounts faces a 100-row table. *Mitigation:* default sort surfaces the worst subaccounts at the top; the rest are paginated; "show only attention-needed" filter is in scope.
- **Composite mutated by data backfills or schema migrations.** A retroactive change to verdict semantics changes historical scores, breaking trend analysis. *Mitigation:* `inputs_hash` column on snapshots invalidates downstream when underlying data changes; trend graphs flag periods where the hash changed mid-window.
- **Safety regressions hidden by green composite.** A subaccount with a single PII leak has a 95 composite but a critical issue. *Mitigation:* safety-class regressions surface as a red banner above the composite, overriding the presentation. The composite is supplementary; safety is primary.
- **Per-skill composite leakage to the operator view.** Operators see subaccount-level composite only; per-skill detail is staff-only. Putting per-skill into the operator surface would invite Goodhart at the skill level.

## 9. What this brief is not

Not a spec. The dev session produces the spec, including the React component contracts, the aggregation query plans, and the snapshot retention policy.

Not a public-facing trust score. The composite is internal operational awareness for Synthetos staff, agency owners, and subaccount operators. It is never displayed to end-customers of the agency, never used in marketing, and never tied to a contractual SLA. External framing about quality is separate.

Not a vanity metric or KPI. The brief explicitly does not tie the composite to incentives, alerts, performance reviews, or pricing. Any future framing in those directions is out of scope and would invite Goodhart's law.

Not a replacement for the underlying telemetry. Cost dashboards, scorecard verdict explorers, run trace pages, and the morning review queue all remain. The composite points into them; it does not replace them.

Not a new nav surface. The operator-facing dimension is the header on the morning review queue. The org-admin dimension is an extension of the cross-subaccount roll-up specified in the closed-loop brief. The Synthetos-staff dimension is a single new admin page at `/system/quality`. Total new nav items added to customer-facing UI: zero.

Not a marketing surface. External framing, if any, is "Synthetos surfaces a composite health score for each subaccount that helps operators see what needs attention." Never "AI-powered quality dashboard" or "real-time agent health intelligence."
