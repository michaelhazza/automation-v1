# Mockup Log — consolidation-2026-05-06

## Round 1 — 2026-05-06 00:00

**Operator feedback:** Initial draft (no prior rounds)

**Changes made:**
- Created `prototypes/consolidation-2026-05-06/_shared.css` — full design system CSS with CSS custom properties, sidebar/shell components, tab system, button variants, badge variants, form elements, drawer pattern, data table, search box, empty state
- Created `prototypes/consolidation-2026-05-06/index.html` — prototype navigator grouping all 10 screens by consolidation type (Primitive consolidation / Page merge / Nav restructure), with confirmed decisions box and "Replaces" pill lists per card
- Created `prototypes/consolidation-2026-05-06/shell-nav.html` — before/after left nav comparison: ~45 items (labeled REMOVED/MERGED/INTO AGENT/TO DRAWER/INTO ORG/INTO INTEGR) vs proposed ~16 items with descriptive "what-contains" lines; summary stat cards showing the reduction
- Created `prototypes/consolidation-2026-05-06/knowledge.html` — consolidates SubaccountKnowledgePage + WorkspaceMemoryPage + MemoryBlockDetailPage + MemoryReviewQueuePage into one page with 3 top-level tabs (Auto-memory / Authored knowledge / Review queue); Auto-memory has 6 sub-tabs; block detail is a drawer; new entry and new block are drawers
- Created `prototypes/consolidation-2026-05-06/agent-edit.html` — consolidates AdminAgentEditPage + AdminSkillsPage + AdminSkillEditPage; Skills tab embedded inside agent edit with toggle-based picker; skill edit is a 560px drawer with 4 sub-tabs (Details / Tool definition / Parameters / Test); all AgentForm fields preserved
- Created `prototypes/consolidation-2026-05-06/run-trace.html` — consolidates AgentRunLivePage + RunTraceViewerPage; auto-detects live vs historical via mode toggle (demo); chain sidebar + trace timeline + event detail panel + delegation graph tab; all event fields preserved
- Created `prototypes/consolidation-2026-05-06/automations.html` — consolidates AutomationsPage + AdminAutomationsPage; admin notice banner (permission-gated); search/status/tag/engine filters; admin row actions (activate/deactivate/delete) inline; new automation drawer with all create-form fields
- Created `prototypes/consolidation-2026-05-06/automation-detail.html` — consolidates AutomationExecutionPage + ExecutionDetailPage + AdminAutomationEditPage; 3 tabs (Definition / Run sandbox / History); inline edit toggle on Definition tab; dark-theme schema blocks; run tab with JSON input + file upload + live output console; history tab with execution detail drawer
- Created `prototypes/consolidation-2026-05-06/calendar.html` — consolidates ScheduleCalendarPage + SubaccountScheduleCalendarPage; scope filter pills replace dual routes; per-client colored dot indicators; 7/14/30 day window selector; legend row; cal-item cards with agent name, type badge, client name, status
- Created `prototypes/consolidation-2026-05-06/integrations.html` — consolidates IntegrationsAndCredentialsPage + AdminHealthFindingsPage; Connections tab (credentials + MCP integrations) + Issues tab (severity-colored finding cards, run-health-audit button, mark-resolved permission-gated note); severity count cards in Issues header
- Created `prototypes/consolidation-2026-05-06/manage-org.html` — consolidates OrgSettingsPage all tabs into 7 tabs (General / Tags / Engines / Board Templates / Permission Sets / Spending / Health Audit); note: Integrations and Memory are separate nav items and NOT duplicated here; admin-only fields (plan, status) in amber-bordered section; Tags uses colored chip UI; per-section saves in General

**Frontend-design-principles checks:**
- Start with primary task: yes — each screen opens on the operator's primary task (e.g., Knowledge opens on Auto-memory summary, not the data model; Automations opens on the list ready to run, not admin config)
- Default to hidden: yes — KPI tile rows from WorkspaceMemoryPage replaced with a single inline meta row; run cost panel deferred out; search diagnostics deferred to admin-only advanced section; block internal IDs not exposed
- One primary action: yes — each screen has one primary action (Knowledge: "Regenerate summary"; Automations: "New automation"; Automation detail: "Run" in sandbox tab; Integrations: "Connect integration"; Manage org: per-section "Save")
- Inline state: yes — run status shown as inline dot + last-run text on agent-edit header; integration validity shown as inline badge on credential rows; automation readiness shown as inline pill on automations list
- Re-check passed: yes — all screens tested against "non-technical operator completing primary task without feeling overwhelmed": tabs are labelled in plain language, admin actions are visually separated but not hidden, no dense diagnostic panels are visible by default

**Rule violations flagged:** none

**Deferred items:**
- `Search Diagnostics` tab from WorkspaceMemoryPage — deferred to admin-only advanced section; operator primary task does not require it
- `RunCostPanel` from AdminAgentEditPage — deferred; cost dashboard is secondary to agent configuration
- `SkillAnalyzerPage` / `SkillStudioPage` (advanced skill editing UI) — not mocked; would live inside skill-edit drawer's "Tool definition" sub-tab (JSON editor present as placeholder)
- `OrgMemoryPage` — accessible via Knowledge nav item scoped to org level; not duplicated inside Manage Org tabs (avoids double-surfacing)
- Delegation graph in run-trace.html — placeholder tab present; full graph visualization deferred (no graph library loaded)
- Board template detail editing — board templates tab in manage-org.html shows cards but no template-edit drawer (out of scope for this consolidation pass)

**Files modified:**
- `prototypes/consolidation-2026-05-06/_shared.css` (created)
- `prototypes/consolidation-2026-05-06/index.html` (created)
- `prototypes/consolidation-2026-05-06/shell-nav.html` (created)
- `prototypes/consolidation-2026-05-06/knowledge.html` (created)
- `prototypes/consolidation-2026-05-06/agent-edit.html` (created)
- `prototypes/consolidation-2026-05-06/run-trace.html` (created)
- `prototypes/consolidation-2026-05-06/automations.html` (created)
- `prototypes/consolidation-2026-05-06/automation-detail.html` (created)
- `prototypes/consolidation-2026-05-06/calendar.html` (created)
- `prototypes/consolidation-2026-05-06/integrations.html` (created)
- `prototypes/consolidation-2026-05-06/manage-org.html` (created)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (created)

## Round 2 — 2026-05-06 14:00

**Operator feedback:**
1. Knowledge: populate every sub-panel with 8-10 realistic examples. Remove Review Queue tab (move to Inbox). Leave tab names blank for operator to name.
2. Inbox (new page): consolidate all HITL surfaces. 15-20 mixed items, inline approve/reject, detail drawer for complex items.
3. Agent Edit: full rebuild. Capabilities tab has Skills (kit+library, 180+ skills, 40/60 split) AND Data Sources (separate sub-section). 6 tabs: Configure, Behaviour (with Prompt History), Capabilities, Schedule, Budget, Runs.
4. Before pages: create before-*.html for every consolidated screen.
5. Automation Detail: not a top-level nav item. Make automation names clickable from automations.html.
6. Connections: rebuild integrations.html service-first. Multiple credential types: API key, OAuth, Web login (URL+user+pass+TOTP), Cookie session, Certificate. Per-connection drawer with 5 tabs.
7. Shell nav: comprehensive audit of all ~92 pages. Update with full before/after and mapping table. Update manage-org.html to match OrgSettingsPage tabs.

**Changes made:**
- `knowledge.html` rewritten: Review Queue tab removed (amber link to Inbox instead), 10 realistic Entries, 10 Memory Blocks with dot-notation labels, 8 Baseline rows, 9 Authored knowledge entries, ~300-word Summary. Tab naming left blank per operator request.
- `inbox.html` created: Unified HITL feed, 15 items (7 unread + 8 read), belief_conflict drawer with side-by-side diff, block_proposal drawer, inline approve/reject on applicable items, type/client/age/sort filters, section dividers.
- `agent-edit.html` rebuilt: 6-tab structure. Capabilities tab has two sub-sections (Skills kit+library and Data Sources). 180+ skill library with facets, recommended group, copy-from-agent, unavailable states. Prompt History sub-panel in Behaviour tab. Test panel (320px).
- `before-knowledge.html` created: 2x2 grid of 4 source pages.
- `before-agent-edit.html` created: 3x2 grid of 5 source pages including SkillAnalyzerPage.
- `before-run-trace.html` created: 1x2 grid of 2 source pages.
- `before-automations.html` created: 1x2 grid of 2 source pages.
- `before-automation-detail.html` created: 1x3 grid of 3 source pages.
- `before-calendar.html` created: 1x2 grid of 2 source pages.
- `before-integrations.html` created: 1x2 grid of 2 source pages.
- `before-manage-org.html` created: 2x3 grid of 6 tab mockups with duplicate mapping table.
- `before-inbox.html` created: 2x2 grid of 4 source pages.
- `integrations.html` rebuilt as Connections: service-first (8 services), credential type chips per row, 3 fully-detailed drawers (Gmail=OAuth+SMTP, S3=expiring API key, Portal=Web login+TOTP), stub drawers for others. New connection drawer with 5 credential type radio buttons.
- `shell-nav.html` rebuilt: before nav lists ~92 pages with disposition pill per item. After nav lists 16 items with plain-language descriptions. Full mapping table covers every page file with route, category, destination, and method (nav item/drawer/tab/merged/system/auth).
- `manage-org.html`: added Replaces callout banner. Note about Memory and Integrations tabs removed.
- `run-trace.html`: added Replaces 2 pages callout banner.
- `automations.html`: added Replaces 2 pages callout + "Click any automation name" annotation. Auto-name text now indigo + hover underline.
- `automation-detail.html`: added Replaces 3 pages callout + "Opened from row click, not top-level nav" note.
- `index.html` rewritten: updated to Round 2 metadata. Added Inbox card. Added Before links on every card footer. Moved automation-detail to new "Sub-screens" section. Updated Connections card description. Updated shell-nav stats (92 pages, 16 items).

**Frontend-design-principles checks:**
- Start with primary task: yes -- Knowledge opens on Summary (the operator's primary task: understand what the agent knows). Inbox opens on the unread action list. Connections opens on the service list ready to click.
- Default to hidden: yes -- SkillAnalyzerPage (KPI tiles + heatmap) is not surfaced in the operator flow; it lives in system shell only. Connection health issues are behind the Issues tab and the per-connection Issues tab, not as a default dashboard.
- One primary action: yes -- Connections: "Connect service". Inbox: "Approve" (on the first unread item). Knowledge: "Regenerate summary" (in auto-memory). Agent Edit: "Save agent".
- Inline state: yes -- credential health shown as badge on connection row. Skill enabled/unavailable shown as chip on kit pane. Inbox unread count shown as nav badge.
- Re-check passed: yes -- operator can complete "approve a pending HITL item" in 2 clicks from Inbox. Operator can "connect Gmail" from Connections in one drawer flow. No KPI tiles on default views.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/knowledge.html` (rewritten)
- `prototypes/consolidation-2026-05-06/inbox.html` (created)
- `prototypes/consolidation-2026-05-06/agent-edit.html` (rebuilt)
- `prototypes/consolidation-2026-05-06/before-knowledge.html` (from Round 1 session)
- `prototypes/consolidation-2026-05-06/before-agent-edit.html` (created)
- `prototypes/consolidation-2026-05-06/before-run-trace.html` (created)
- `prototypes/consolidation-2026-05-06/before-automations.html` (created)
- `prototypes/consolidation-2026-05-06/before-automation-detail.html` (created)
- `prototypes/consolidation-2026-05-06/before-calendar.html` (created)
- `prototypes/consolidation-2026-05-06/before-integrations.html` (created)
- `prototypes/consolidation-2026-05-06/before-manage-org.html` (created)
- `prototypes/consolidation-2026-05-06/before-inbox.html` (created)
- `prototypes/consolidation-2026-05-06/integrations.html` (rebuilt)
- `prototypes/consolidation-2026-05-06/shell-nav.html` (rebuilt)
- `prototypes/consolidation-2026-05-06/manage-org.html` (updated)
- `prototypes/consolidation-2026-05-06/run-trace.html` (updated)
- `prototypes/consolidation-2026-05-06/automations.html` (updated)
- `prototypes/consolidation-2026-05-06/automation-detail.html` (updated)
- `prototypes/consolidation-2026-05-06/index.html` (rewritten)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (updated)
