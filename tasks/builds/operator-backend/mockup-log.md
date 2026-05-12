# Mockup log: Operator Backend (Phase D)

## Round 1 — 2026-05-12 (initial draft)

**Operator feedback:** Initial draft. No prior rounds.

**Changes made:**
- Created `prototypes/operator-backend/` multi-screen directory (directory already existed with `_shared.css` and `brief.md`)
- Built 12 prototype screens plus `index.html` (13 files total)
- C1: `c1-agent-edit-model-access-live.html` — refreshed Phase C screen 08, converting "Available soon" placeholder to live. Adds enabled toggle (Org admin only), duration cap (120 min), concurrency limit (3), AI Subscription allowlist (read-only), fallback key status with CTA if not configured. Two state variants on page: fallback configured vs not configured
- C2: `c2-run-trace-timeline.html` — complete Run Trace timeline for an operator run with all Phase D event types: session start, credential injected (auth type: subscription, plan tier, token redacted), steps 1-4 (subscription), fallback engaged at step 5 (rate_limited), steps 5-8 (API key), artefact harvest, completed. Collapsible event details. Sidebar: session info, credentials used, cost breakdown ($0.00 subscription + $0.18 API key fallback + $0.24 sandbox = $0.42), artefact downloads
- D1: `d1-session-in-progress.html` — live runtime view with animated running pill, time strip (elapsed/remaining/steps), progress strip (current activity), recent steps log. Primary action: Cancel run with confirm modal. Secondary: Snapshot artefacts. State variant B: approaching 120 min cap (amber styling, 15 min remaining warning, Extend CTA)
- D2: `d2-session-completed.html` — completed state with summary stats, cost breakdown (subscription/fallback/sandbox), artefact list with downloads, re-run CTA, view trace link
- D3: `d3-session-failed.html` — failed state (OPERATOR_RUNTIME_CRASH), plain-English explanation, expandable "what does this mean?" section explaining no-auto-restart policy, action cards (retry/trace/report), partial artefacts
- D4: `d4-session-cancelled.html` — cancelled state with who/when notice, run summary, partial artefacts
- D5: `d5-fallback-engaged-banner.html` — fallback engaged amber banner component on in-progress layout. "Why?" opens popover. Running dot changes to amber. Non-dismissable.
- D6: `d6-error-operator-session-unavailable.html` — error screen "This run can't start". Primary CTA: Add fallback API key. "What does this mean?" expander. Subscription status + fallback status inline cards
- D7: `d7-error-concurrency-limit-exceeded.html` — concurrency limit error (3/3 slots used). 3 active session cards with Cancel per row. Cancel opens confirm modal. Footer Org admin gating note
- D8: `d8-active-sessions-list.html` — autonomous runs list page with sidebar nav entry and badge. 2 active cards, slot indicator (2/3), collapsible recent runs. Empty state variant
- D9: `d9-duration-override-modal.html` — duration override modal (Org admin only). Context strip, slider+number input (default 60, max 120), computed new cap and cost estimate, policy note. Once-per-run policy
- D10: `d10-provider-account-suspended.html` — provider revocation screen (ChatGPT Plus). Factual tone. What happened, disclosure record link, action cards (reconnect/fallback/support), CS comms template expander with copyable message

**Frontend-design-principles checks:**
- Start with primary task: yes — each screen is oriented around one operator action (monitor run, download artefact, add fallback, cancel, etc.), not the data model
- Default to hidden: yes — cost breakdown is a section users expand/scroll to; run IDs and internal event types are in expandable details or footers; advanced metrics (vCPU, wall clock) only appear in cost breakdown note. Dashboard tiles are avoided
- One primary action: yes — D1: Cancel run; D2: Download (artefacts); D3: Retry; D4: Start new run; D6: Add fallback API key; D7: Cancel one active run; D8: (monitor); D9: Extend run; D10: Reconnect
- Inline state: yes — status pills, countdown timers, animated running dots, slot indicators, fallback badges all communicate state inline without separate dashboard screens
- Re-check passed: yes — non-technical operator landing on D1 sees "Running / 23 min / Step 3 / Reading invoice PDF" and Cancel button. D6 says "This run can't start" with one CTA. D7 shows the 3 runs and a Cancel button per row

**Rule violations flagged:** none

**Files modified:**
- `prototypes/operator-backend/c1-agent-edit-model-access-live.html` (created)
- `prototypes/operator-backend/c2-run-trace-timeline.html` (created)
- `prototypes/operator-backend/d1-session-in-progress.html` (created)
- `prototypes/operator-backend/d2-session-completed.html` (created)
- `prototypes/operator-backend/d3-session-failed.html` (created)
- `prototypes/operator-backend/d4-session-cancelled.html` (created)
- `prototypes/operator-backend/d5-fallback-engaged-banner.html` (created)
- `prototypes/operator-backend/d6-error-operator-session-unavailable.html` (created)
- `prototypes/operator-backend/d7-error-concurrency-limit-exceeded.html` (created)
- `prototypes/operator-backend/d8-active-sessions-list.html` (created)
- `prototypes/operator-backend/d9-duration-override-modal.html` (created)
- `prototypes/operator-backend/d10-provider-account-suspended.html` (created)
- `prototypes/operator-backend/index.html` (created)
- `tasks/builds/operator-backend/mockup-log.md` (created, this file)

---

## Round 2 — 2026-05-12

**Operator feedback:** Round 1 mockups had the wrong shape — they treated operator runs as a parallel "autonomous runs" UI universe with its own pages (D1-D8, D10). The operator review redirected: operator runs must INTEGRATE into the existing task management UI (OpenTaskView), not replace it. Round 2 reworks all screens against the actual codebase.

**Changes made:**

Codebase read before drafting:
- `client/src/pages/OpenTaskView.tsx`: `flex flex-col h-screen bg-white` shell. ChatPane (left 26%), ActivityPane (middle 22%), RightPaneTabs (flex-1 right).
- `client/src/components/openTask/TaskHeader.tsx`: status badges mapped `running | paused | paused_cost | paused_wall_clock | stopped -> Active`. badgeColor: green for running, amber for paused, red for stopped.
- `client/src/components/openTask/ChatPane.tsx`: chatMessages (user: bg-indigo-600/white, agent: bg-slate-100/text-slate-800), MilestoneCard, ApprovalCard, ThinkingBox.
- `client/src/components/openTask/ActivityPane.tsx`: activityEvents with timestamp + summary. "Activity" header. Collapsible (minus button). "N new events" float button.
- `client/src/components/openTask/RightPaneTabs.tsx`: tabs `now | plan | files`, default active = `plan`. Tab strip: `border-b-2 border-indigo-600` for active.
- `client/src/components/openTask/NowTab.tsx`: steps filtered to `running | awaiting_approval`. Running dot: `bg-green-400 animate-pulse`.
- `client/src/components/openTask/PlanTab.tsx`: numbered step list. Status dots: pending=slate-300, running=green-400/animate-pulse, completed=green-500, failed=red-400, awaiting=amber-400.
- `client/src/components/openTask/FilesTab.tsx`: group tabs `outputs | references | versions` (rounded-full pills, indigo when active). Sort dropdown. Thumbnail strip. FileReader pane.
- `client/src/pages/operate/RunTracePage.tsx`: PageShell, header `Run Trace + RunIdDisplay`, chainInfo, ieePanel (indigo-50, animate-pulse), RunTraceHeadline, RuntimeCheckSummaryStrip, RunTraceEventRenderer, RunTraceArtifactsPanel.
- `client/src/pages/operate/components/RunTraceEventRenderer.tsx`: ToolCallEventCard (border rounded-xl, iteration badge indigo-50, expand chevron). SystemEventRow for system events. Sections: "System events (N)" uppercase label, "Tool calls (N)" uppercase label.
- `client/src/components/run-trace/RunTraceHeadline.tsx`: flex items-center gap-2 flex-wrap badge row: controller pill (BADGE_NEUTRAL), approval status pill, duration pill (BADGE_SLATE), cost pill.
- `client/src/components/run-trace/RunTraceArtifactsPanel.tsx`: "Artifacts (N)" uppercase label, ArtifactRow with kind pill (report=indigo, transcript=slate, media=violet, attachment=amber, log=slate), display name, Preview/Download/Copy link buttons.
- `client/src/components/TaskCard.tsx`: px-3 py-2.5 bg-white border border-slate-200 rounded-lg. Row 1: priority dot + title. Row 2: agent pills + due date.
- `client/src/pages/AgentRunHistoryPage.tsx`: SessionLogCardList with status filter dropdown (All, Completed, Failed, Timeout, Cancelled). Breadcrumb, title, pagination.

**Files deleted (wrong-shape round 1 D-screens):**
- `prototypes/operator-backend/d1-session-in-progress.html`
- `prototypes/operator-backend/d2-session-completed.html`
- `prototypes/operator-backend/d3-session-failed.html`
- `prototypes/operator-backend/d4-session-cancelled.html`
- `prototypes/operator-backend/d5-fallback-engaged-banner.html`
- `prototypes/operator-backend/d6-error-operator-session-unavailable.html`
- `prototypes/operator-backend/d7-error-concurrency-limit-exceeded.html`
- `prototypes/operator-backend/d8-active-sessions-list.html`
- `prototypes/operator-backend/d10-provider-account-suspended.html`

**Files kept from round 1:**
- `prototypes/operator-backend/c1-agent-edit-model-access-live.html` — correct shape, no changes
- `prototypes/operator-backend/_shared.css` — kept, used by all screens

**Files updated from round 1:**
- `prototypes/operator-backend/c2-run-trace-timeline.html` — already had round 2 framing header (done in earlier commit); breadcrumbs and sidebar links fixed to point to r3/r10 (removed dead d8/d2 links)
- `prototypes/operator-backend/d9-duration-override-modal.html` — updated header comment to clarify modal launched from TaskHeader "Extend duration" button. Background replaced with actual TaskHeader approaching-limit state. Footer note added linking to R2. All links updated from d1 to r2.

**Files created (R1-R11):**
- `prototypes/operator-backend/r1-opentaskview-operator-running.html` — Full OpenTaskView, operator run live (23 min elapsed, 97 min left). Status pill "Operator running" (green). Snapshot now + Cancel buttons. ChatPane: operator system messages. ActivityPane: step boundary events. Now tab: current step + progress bar. Files: 2 partial artefacts.
- `prototypes/operator-backend/r2-opentaskview-operator-running-approaching-limit.html` — Same task, 105 min elapsed. Amber pill, "15 min left" amber badge. ActivityPane amber inline notice. "Extend duration" CTA (Org admin only) in TaskHeader linking to D9.
- `prototypes/operator-backend/r3-opentaskview-operator-completed.html` — Terminal completed. "Completed" indigo pill. Final summary in ChatPane. Full timeline with terminal event in ActivityPane. Inline cost summary (3 lines, not a dashboard). Files tab auto-switched active. All artefacts with Preview/Download/Copy link.
- `prototypes/operator-backend/r4-opentaskview-operator-failed.html` — Terminal failed ("Token budget exhausted"). Red pill with reason sub-label. Plain-English failure in ChatPane. Failure event highlighted in ActivityPane. Partial artefacts + Retry CTA.
- `prototypes/operator-backend/r5-opentaskview-operator-cancelled.html` — Terminal cancelled. Slate pill with who/when. "You cancelled this run." message. Partial timeline. Partial artefacts + Retry.
- `prototypes/operator-backend/r6-opentaskview-fallback-engaged.html` — Mid-run, fallback engaged. Same layout as R1. Amber system message in ChatPane. Amber inline event row in ActivityPane with collapsible "Why?". TaskHeader "API fallback" sub-tag. Status pill stays green. No separate page.
- `prototypes/operator-backend/r7-taskheader-operator-controls.html` — Component spec: TaskHeader across states (a) Idle, (b) Operator running, (b) variant with API fallback, (c) Approaching limit with Org admin Extend CTA, (d) Terminal completed, (d) variant Failed. Exact vocabulary and layout from TaskHeader.tsx.
- `prototypes/operator-backend/r8-modal-concurrency-limit.html` — Concurrency limit modal (3 of 3). 3 active session cards with task links + Cancel per row. Footer: Org admin settings link. Primary: Close. Shown over faded tasks list. Replaces D7.
- `prototypes/operator-backend/r9-modal-operator-unavailable.html` — "This run can't start" modal. Two status cards (no subscription, no fallback). Primary: "Add fallback API key". Secondary: "Connect a subscription". Shown over faded TaskHeader. Replaces D6.
- `prototypes/operator-backend/r10-tasks-list-operator-filter.html` — Existing tasks list + new "All tasks | Operator runs only" filter chip. Operator runs show status pill and elapsed/remaining inline on task cards. Empty state if no runs. Slot indicator shows 3/3 capacity. Replaces D8.
- `prototypes/operator-backend/r11-connections-suspended-state.html` — Phase C connections page (AI Subscriptions tab) with suspended row. "Suspended by OpenAI" red pill. Reconnect button + "View affected tasks" link. Collapsed "What this means" expander with copyable CS comms snippet + disclosure record link. Replaces D10.

**Index rewritten:**
- 3 sections: "Existing surfaces extended" (C1, C2, R10, R11) | "Operator-run states inside OpenTaskView" (R1-R6) | "Components and modals" (R7, R8, R9, D9)
- Top banner explaining Round 2 design rationale
- Vocabulary reference footer with exact codebase class names and tab labels

**Phase C visual continuity confirmed:** All files link to `../consolidation-2026-05-06/_shared.css` + `../operator-session-identity/_shared.css` + `_shared.css`, matching Phase C style conventions.

**Frontend-design-principles checks:**
- Start with primary task: yes — operator runs are just runs, surfaced in the existing place users look for tasks. Each screen is oriented around one moment in the user's workflow (monitoring a run, seeing results, handling failure). Not the data model.
- Default to hidden: yes — no new top-level nav entries. Operator-mode affordances appear inline in the existing task UI. Cost summary is 3 lines in ActivityPane (not a dashboard). Duration override is a modal. Run trace is a link, not the primary surface.
- One primary action: yes — R1: Cancel run. R2: Extend duration (or Cancel). R3: Download (via Files tab). R4/R5: Retry. R6: no new primary action (run continuing). R7: component spec (no primary action). R8: Close. R9: Add fallback API key. R10: navigate to a task. R11: Reconnect.
- Inline state: yes — operator status appears in TaskHeader pill. Fallback engaged appears inline in ActivityPane and ChatPane. Duration warning appears inline in ActivityPane. Cost appears inline at bottom of ActivityPane terminal state.
- Re-check passed: yes — a non-technical operator finds an operator run by going to Tasks, opening the task, and seeing "Operator running" in the header with elapsed time and a Cancel button. No new pages to discover. The design is the existing task flow with operator affordances added inline.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/operator-backend/c2-run-trace-timeline.html` (links updated)
- `prototypes/operator-backend/d9-duration-override-modal.html` (footer note + background updated)
- `prototypes/operator-backend/r1-opentaskview-operator-running.html` (created)
- `prototypes/operator-backend/r2-opentaskview-operator-running-approaching-limit.html` (created)
- `prototypes/operator-backend/r3-opentaskview-operator-completed.html` (created)
- `prototypes/operator-backend/r4-opentaskview-operator-failed.html` (created)
- `prototypes/operator-backend/r5-opentaskview-operator-cancelled.html` (created)
- `prototypes/operator-backend/r6-opentaskview-fallback-engaged.html` (created)
- `prototypes/operator-backend/r7-taskheader-operator-controls.html` (created)
- `prototypes/operator-backend/r8-modal-concurrency-limit.html` (created)
- `prototypes/operator-backend/r9-modal-operator-unavailable.html` (created)
- `prototypes/operator-backend/r10-tasks-list-operator-filter.html` (created)
- `prototypes/operator-backend/r11-connections-suspended-state.html` (created)
- `prototypes/operator-backend/index.html` (rewritten)
- `tasks/builds/operator-backend/mockup-log.md` (this update)
