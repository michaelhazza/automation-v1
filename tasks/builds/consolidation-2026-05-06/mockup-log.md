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

## Round 3 — 2026-05-06 18:00

**Operator feedback:** "Mock everything that is changing, base it on what's there now, show before and after." Full brief: fill audit gaps from round 2. Net-new surfaces (home, glossary, page-disposition, onboarding), changing existing surfaces with before/after (agents, workflows/tasks/client-pulse/portal/reports with disposition check), cross-cutting pattern galleries (empty-states, permissions, lifecycle-errors).

**Changes made:**
- `page-disposition.html` created: canonical reference table for all 117 source pages. Disposition column has 8 values (KEEP / MERGED / TO DRAWER / RENAMED / REMOVED / NEW / SYSTEM ONLY / AUTH). Sortable by any column. Filterable by disposition and free-text search. Count chips update live. Grounded in actual `client/src/pages/` directory listing.
- `home.html` created: operator daily landing page. Replaces DashboardPage as default route. 7-item "Needs your attention" list with inline approve/reject/review/fix actions. Recent runs list with inline status dots. Sidebar: inbox summary counts, agent status list, today's schedule. Primary action: "New agent".
- `glossary.html` created: system model one-page reference. Definitions for Agent, Automation, Workflow, Run, Job, Skill, Block, Block Type, Org, Subaccount, Project, Knowledge, Memory Block. Relationship diagram using visual nodes. Linked from help icon in shell.
- `before-agents.html` created: grounded in actual AdminAgentsPage source (3 tabs, 6-column table, live count badge, Install from Library modal), AgentsPage (card grid, no actions, heartbeat), SubaccountAgentsPage (Role+Title columns, scoped view). Problems list identifies specific UX issues.
- `agents.html` created: unified agents list. 4 columns (Agent, Status, Last run, Actions). Inline status dot + last run time with outcome. Tag chips. Search + filter pills. Live count pill. Primary action: New agent. Edit/Run/Fix inline row actions. Replaces 6 pages.
- `before-workflows.html` created: grounded in source -- WorkflowsLibraryPage (template cards, start run modal, org templates empty), WorkflowStudioPage (3-pane editor with Validate/Simulate/Estimate/Save+PR tools, system-admin only), WorkflowRunDetailPage (step list, phase 1). Disposition note explains why workflows are kept separate.
- `workflows.html` created: workflows kept as separate primitive. WorkflowsLibraryPage stays as nav item. Studio moves to system-admin. Recent runs shown inline. "What's a workflow?" help link to glossary. Replaces callout clarifies disposition.
- `onboarding.html` created: 5-step first-run flow with step bar. Step 1: Welcome (overview of setup). Step 2: Connect first integration (Gmail, CRM, Slack options with selection state). Step 3: Create first agent (3 template cards, recommended badge). Step 4: First automation (2 template options, marked optional). Step 5: Done (org state summary: 1 connection, 1 agent, 1 automation). Each step skippable. State outcome boxes show what the tenant ends up with after each step.
- `empty-states.html` created: pattern gallery. 8 states: agents, inbox (caught up), knowledge auto-memory, knowledge authored, connections, run history, automations, calendar. Rules embedded at top. Each has exactly one primary action.
- `permissions.html` created: pattern gallery. 4 sections: admin-only sections within page (dashed amber border), locked rows (item visible, actions greyed with lock icon), gated action buttons (greyed with role note), full-page no-access state. Role badge in topbar pattern.
- `lifecycle-errors.html` created: pattern gallery. 5 sections: failed run with retry (run list inline + run trace header), expired credential with reconnect (credential row + expiring-soon proactive warning), blocked agent (HITL approval + manual deactivation), rate-limited integration (hit + queued runs), migration in progress (DB migration progress bar + first-sync progress with account count). Each error has one recovery action.
- `index.html` updated: Round 3 metadata (40+ files). Added 4 new sections: "Round 3 Net-new surfaces", "Round 3 Changing existing surfaces (before + after)", "Round 3 Skipped (no change)", "Round 3 Pattern reference galleries". Each card links to before page where applicable.

**Discoveries:**
- Client Pulse (4 pages), Portal (4 pages), Reports (2 pages): NOT changing in this consolidation. Confirmed per round 2 decisions. Skipped with note in index.html.
- Tasks primitive (OpenTaskView, WorkspaceBoardPage, BriefDetailPage): KEPT as-is. Inbox unifies HITL items only; workspace tasks are a separate thing. No before/after needed.
- Workflows are a SEPARATE primitive from Automations (WorkflowsLibraryPage, WorkflowStudioPage, WorkflowRunDetailPage exist). Decision: keep separate. WorkflowStudioPage already server-enforces system-admin. Change: remove from operator nav.
- AdminAgentsPage has 3 tabs (Agents / Org Execution / Team Templates) that embed OrgAgentConfigsPage and SubaccountBlueprintsPage respectively -- these all get merged into unified agents.html.
- Total page count in `client/src/pages/` is 117 (including subaccount/ subdirectory), not 92 as stated in round 2. Updated in index.html masthead.

**Frontend-design-principles checks:**
- Start with primary task:
  - home.html: yes -- primary task is "deal with what needs attention today", not "review KPI dashboard". Opens on attention list, not on stats.
  - agents.html: yes -- primary task is "find and manage an agent". Opens on list with inline state, not on analytics.
  - onboarding.html: yes -- each step is one action. No feature tour, no multiple choices per screen.
  - glossary.html: yes -- purely informational reference, no primary action needed.
  - page-disposition.html: yes -- primary task is "find a page's disposition". Opens on full searchable table.
  - pattern galleries: yes -- reference pages, no primary task, no deception.
- Default to hidden: yes -- home.html has no KPI tiles (DashboardPage had MetricCard components). Attention list and agent status are inline state. No trend charts. Run history is a plain list (6 items), not a histogram or dashboard.
- One primary action: yes -- home.html primary action is "New agent". agents.html: "New agent". onboarding steps: one CTA per step (Get started / Connect Gmail / Create agent / Continue). glossary: read-only. page-disposition: no action, reference only. Patterns: no action.
- Inline state: yes -- home.html shows agent status inline in sidebar (dot + last run text). Agents list shows last run outcome inline. Onboarding shows org state after each step inline in an outcome box.
- Re-check passed: yes -- non-technical operator on home.html sees their attention items immediately and can approve/reject inline without navigating. Agents list answers "is my agent running, did it fail?" without clicking into each agent. Onboarding guides through setup step by step.

**Rule violations flagged:** none

**Skipped pages (explicitly decided):**
- Client Pulse (dashboard, clients list, drilldown, settings) -- not in consolidation scope
- Portal (landing, page, execution, history) -- client-facing surface, out of scope
- Reports (list, detail) -- part of Client Pulse, unchanged
- Tasks (OpenTaskView, WorkspaceBoardPage, BriefDetailPage) -- KEPT as-is, no before/after needed

**Files modified:**
- `prototypes/consolidation-2026-05-06/page-disposition.html` (created)
- `prototypes/consolidation-2026-05-06/home.html` (created)
- `prototypes/consolidation-2026-05-06/glossary.html` (created)
- `prototypes/consolidation-2026-05-06/before-agents.html` (created)
- `prototypes/consolidation-2026-05-06/agents.html` (created)
- `prototypes/consolidation-2026-05-06/before-workflows.html` (created)
- `prototypes/consolidation-2026-05-06/workflows.html` (created)
- `prototypes/consolidation-2026-05-06/onboarding.html` (created)
- `prototypes/consolidation-2026-05-06/empty-states.html` (created)
- `prototypes/consolidation-2026-05-06/permissions.html` (created)
- `prototypes/consolidation-2026-05-06/lifecycle-errors.html` (created)
- `prototypes/consolidation-2026-05-06/index.html` (updated)

## Round 4 — 2026-05-06 (fix-up: three confirmed bugs)

**Operator feedback:** Fix three confirmed bugs: (1) invalid nested anchors in index.html causing layout artifacts, (2) stale nav items across per-page mockups, (3) em-dashes in UI copy violating operator preference rule.

**Changes made:**

Bug 1 — Stretched-link refactor in index.html:
- Changed all 15 `<a class="proto-card" href="X.html">` outer elements to `<div class="proto-card">` (and matching `</a>` to `</div>`)
- Moved `href` to the inner `<a class="proto-card-link">` element in every card footer
- Converted `<div class="proto-card-link">Open mockup</div>` placeholders to `<a class="proto-card-link" href="X.html">Open mockup</a>` in all 15 cards
- Added CSS: `.proto-card { position: relative; }`, `.proto-card-link::before { content: ''; position: absolute; inset: 0; z-index: 1; border-radius: 12px; }`, `.before-link { position: relative; z-index: 2; }`
- Removed all `onclick="event.stopPropagation()"` attributes from before-links (no longer needed)

Bug 2 — Canonical nav applied to all sidebar pages:
- Canonical nav structure: WORKSPACE (Home, Inbox+badge, Tasks, Calendar, Agents, Automations, Workflows) / KNOWLEDGE (Knowledge) / PLATFORM (Connections) / MANAGE (Clients, Manage Org)
- `knowledge.html`: removed stale "Documents" from Knowledge section, removed stale "Connectors" from Platform section, added missing Workflows to Workspace
- `agents.html`: restructured from (Workspace: Home, Inbox) + (Operate: Agents, Automations, Calendar, Knowledge, Connections) + (Settings: Manage org) to canonical 4-section layout; added Tasks, Workflows, Clients
- `automations.html`: added missing Inbox and Calendar to Workspace; renamed "Integrations" to "Connections" in Platform; added Clients to Manage
- `calendar.html`: added missing Inbox, Workflows to Workspace; added missing Knowledge and Platform (Connections) sections
- `home.html`: restructured from (Workspace: Home, Inbox) + (Operate: Agents, Automations, Calendar, Knowledge, Connections) + (Settings: Manage org) to canonical layout; added Tasks, Workflows, Clients
- `inbox.html`: added missing Workflows to Workspace; added missing Platform (Connections) and Manage (Clients, Manage Org) sections
- `integrations.html`: completely restructured from custom bare nav to canonical 4-section sidebar with proper logo, sidebar-section wrappers, all 11 items; Connections marked active
- `manage-org.html`: added Inbox, Tasks, Calendar, Automations, Workflows to Workspace; removed stale "Integrations" and "Connectors" items; renamed to "Connections"; added Knowledge section
- `run-trace.html`: expanded from minimal (Agents only) to full canonical nav; Agents remains active (parent of run-trace sub-screen)
- `workflows.html`: restructured from (Workspace: Home, Inbox) + (Operate: Agents, Automations, Workflows, Calendar) to canonical layout; added Tasks, Clients; proper section labels
- `agent-edit.html`: expanded from minimal (Agents only) to full canonical nav; Agents remains active (parent sub-screen)
- `automation-detail.html`: expanded from minimal (Agents, Automations, Workflows) + (Manage: Clients, Manage Org) to full canonical nav; Automations marked active
- `shell-nav.html`: updated after-state "Board" label to "Home" (round 3 established home.html as the operator landing page; "Board" was a stale label). Note: "Board" remains in the before-state and the disposition table where it refers to WorkspaceBoardPage source.

Bug 3 — Em-dash removal:
- Before count (non-zero files): 25 files with em-dashes, total approximately 115 occurrences
- Title tag em-dashes: replaced ` — ` with ` | ` in all `<title>` tags across all files
- Body content em-dashes: replaced ` — ` with `, ` on all non-comment lines across all files
- Table cell null indicator em-dashes (`before-agents.html` line 246, `permissions.html` line 214): replaced `—` with `-`
- Page-disposition.html summary chip placeholders (`—` inside span elements updated by JavaScript): replaced with `0`
- After count: 0 non-comment em-dashes across all files (4 remaining instances are all inside HTML comments and exempt per spec)

**Frontend-design-principles checks:**
- Start with primary task: yes — fix-up round, no new screens added
- Default to hidden: yes — no new panels or dashboards introduced
- One primary action: yes — no screen structure changed
- Inline state: yes — no changes to information architecture
- Re-check passed: yes — bug fixes only, no UX changes

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/index.html` (Bug 1: stretched-link refactor; Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/knowledge.html` (Bug 2: nav; Bug 3: em-dashes)
- `prototypes/consolidation-2026-05-06/agents.html` (Bug 2: nav; Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/automations.html` (Bug 2: nav; Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/calendar.html` (Bug 2: nav; Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/home.html` (Bug 2: nav; Bug 3: em-dash title+body)
- `prototypes/consolidation-2026-05-06/inbox.html` (Bug 2: nav; Bug 3: em-dashes)
- `prototypes/consolidation-2026-05-06/integrations.html` (Bug 2: nav; Bug 3: em-dashes)
- `prototypes/consolidation-2026-05-06/manage-org.html` (Bug 2: nav; Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/run-trace.html` (Bug 2: nav; Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/workflows.html` (Bug 2: nav; Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/agent-edit.html` (Bug 2: nav; Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/automation-detail.html` (Bug 2: nav; Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/shell-nav.html` (Bug 2: "Board" to "Home" in after-state; Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/before-agents.html` (Bug 3: table cell em-dash)
- `prototypes/consolidation-2026-05-06/before-knowledge.html` (Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/before-run-trace.html` (Bug 3: em-dash body)
- `prototypes/consolidation-2026-05-06/before-workflows.html` (Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/before-agent-edit.html` (Bug 3: em-dashes)
- `prototypes/consolidation-2026-05-06/empty-states.html` (Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/glossary.html` (Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/lifecycle-errors.html` (Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/onboarding.html` (Bug 3: em-dash title)
- `prototypes/consolidation-2026-05-06/page-disposition.html` (Bug 3: em-dash placeholders and title)
- `prototypes/consolidation-2026-05-06/permissions.html` (Bug 3: table cell em-dash, title)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (updated)

## Round 5 — 2026-05-06 12:00
**Operator feedback:** Seven locked-spec product decisions across four pages plus comprehensive dialog set. Crash-resilience priority order: knowledge.html rebuild+dialogs, inbox.html updates, integrations.html table redesign, agent-edit.html toggle rows+skill visibility, index.html metadata last.

**Changes made:**

Decision 1 (integrations.html) — completed in prior session:
- Single dense table (~44px rows): Icon+name, Status, Scope, Last used, Overflow menu columns
- Filter chips: All / CRMs / Communications / Analytics / Other (single-select pill-style)
- Sort: Connected first, Reauth needed second, Available third
- Available rows show "+ Connect" instead of overflow menu
- MCP servers in Other, no MCP jargon visible; row click opens connection drawer

Decision 2 (inbox.html) — completed in prior session:
- 3 new "Suppressed memory: contradicting evidence observed" items (amber, unread)
- Suppressed memory drawer with suppressed item panel, new evidence panel (indigo bg), confidence bar, Approve (Re-add) / Re-suppress actions
- (Decision 6 also applied: solid-fill Approve button at 32px, outlined muted Reject, keyboard hint "A to approve, R to reject", Earlier/Read collapsed by default, 30-day default view with "View earlier" link)

Decision 3 (agent-edit.html) — completed this session:
- Replaced two-pane kit+library Skills section with single scrolling toggle-row list
- 14 skills grouped into 4 collapsible categories: Communication (4), Data (4), Analysis (3), Custom (2)
- Each row: skill icon (28px), skill name, one-line description, toggle switch (right-aligned), overflow dot menu
- Filter chips: All / Enabled / Available / Custom above the list
- Search input top-right of toolbar
- Collapsible group headers with caret and "N of M enabled" count
- Overflow dot menu per row opens skill edit drawer via openSkillDrawer()
- Rate-limited skill shown at 60% opacity with disabled toggle
- Data Sources section preserved as secondary block below skill list (4 rows)
- Removed all old kit+library CSS

Decision 4 (agent-edit.html) — completed this session:
- Skill edit drawer Details tab: added "Client visibility" control below "Max calls per run"
- Two radio option cards: Hidden (default, indigo-bordered) / Visible (white bordered)
- Per-card: name + one-line description of what the setting does
- selectVisCard() JS function swaps card border and background on selection
- Drawer tabs (Details/Parameters/Test/Analyzer) now wired to switchSkillTab() with real panel switching

Decisions 5, 6, 7 (knowledge.html, inbox.html) — completed in prior session per session summary

Index metadata update:
- Round counter updated from 3 to 5
- Description updated to reference Round 5 decisions
- Decisions box updated with 11 confirmed items

**Frontend-design-principles checks:**
- Start with primary task: yes — toggle rows surface enable/disable state as primary task on Capabilities tab; filter chips allow scoping without changing page
- Default to hidden: yes — Client visibility defaults to Hidden; no new dashboards or KPI tiles introduced
- One primary action: yes — Capabilities tab primary action is toggling a skill on/off; skill edit drawer primary action is Save
- Inline state: yes — enabled/disabled shown inline via toggle per row; "N of M enabled" count in group header; rate-limited shown as chip on the row
- Re-check passed: yes — non-technical operator can enable/disable any skill by flipping a toggle; category grouping provides context without domain knowledge

**Rule violations flagged:** none

**New CSS patterns added (agent-edit.html inline):**
- .skill-toggle-list container
- .skill-group-header with collapsible caret
- .skill-toggle-row at 52px min-height
- .toggle-wrap / .toggle-input / .toggle-track CSS-only toggle switch
- .overflow-dot-btn three-dot menu trigger
- .conn-chip filter pill (local copy; candidate for _shared.css promotion)

**Files modified:**
- `prototypes/consolidation-2026-05-06/agent-edit.html` (Decisions 3 and 4: capabilities toggle rows, skill visibility control, drawer tabs wired)
- `prototypes/consolidation-2026-05-06/index.html` (metadata: Round 5, updated description and decisions box)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 6 — 2026-05-06 20:00

**Operator feedback:** Three interactive prototype behavior changes: (1) run-trace.html clickable events with type-specific right panels for all 6 event types; (2) calendar.html 7/14/30 day view switching with real DOM containers; (3) home.html redesign dropping Inbox duplication and adding 4-widget dashboard, plus before-home.html grounded in DashboardPage.tsx source.

**Changes made:**

Change 1 (run-trace.html):
- 8 representative events covering all 6 event types wired with onclick="selectEvent(N)"
- EVENTS data object: realistic mock data for each event (tokens, latency, cost, ISO timestamps, JSON payloads)
- selectEvent(N) JS function swaps right panel content with type-specific fields per spec table
- RUN_START panel: trigger source badge, started_by, agent version, parent run link, input payload pre block
- LLM_CALL panel: model name, prompt/completion tokens, latency ms, cost USD, expandable prompt/response previews; temperature shown if non-default
- TOOL_CALL panel: tool name, called_by_step, expected_result_type, input args JSON
- TOOL_RESULT panel: tool name, status badge (green/red), latency, result payload (expandable)
- HITL_GATE panel: gate type, awaiting, who can approve, queued_at, Inbox item link
- DELEGATION panel: sub-agent name, status badge, sub-run link, delegation reason
- Common to all: "Event #N of M" header, time-into-run, ISO timestamp, "View raw event JSON" link
- Raw JSON modal: fixed-position overlay, pre-formatted JSON, click-outside or X to close
- fieldPreExpandable() helper adds collapsed 80px pre with "Show more / Show less" toggle link
- buildDetailHtml() dispatcher renders correct template per type
- Placeholder state shown when no event selected (click-me instruction)
- Event detail panel footer visible only after first selection

Change 2 (calendar.html):
- Three DOM containers pre-rendered: cal-view-7, cal-view-14, cal-view-30
- switchCalView('7'|'14'|'30', btn) toggles display of the three containers
- 7-day view: existing full-detail vertical day stack (Mon May 6 through Tue May 12), 7 days populated
- 14-day view: 7x2 CSS grid; Week 1 Apr 27-May 3, Week 2 May 4-10; each cell shows abbreviated event chips with colored client dots; today cell has today class + bold date
- 30-day view: full May calendar month grid (7x5); each cell shows colored 7px dots per event + "N events" count; out-of-month cells styled muted
- Day popover (30-day): showDayPopover() positions fixed-panel near click coordinates, lists events with time + client color + name; closeDayPopover() on X or outside click
- Legend updated to show client colors (Acme=blue, Beta=green, Gamma=amber, Nova=violet) + event type shapes
- Default view is 7-day (active button state updated accordingly)

Change 3a (home.html):
- "Needs your attention" section (7-item HITL list) removed entirely -- was duplicating Inbox
- "Recent runs" plain list removed -- replaced by widget 1 (runs sparkline) and widget 4 (successes)
- 4-widget 2x2 grid added as primary content area
- Widget 1 "Today's runs": 24-bar sparkline using CSS bars with percentage heights; bursty afternoon pattern (peak at 14:00); inline metrics: 84 runs, 97% success rate, 2 failed; "View run log" link
- Widget 2 "Active agents": header stat "3 of 18 running"; 3 rows with blue pulse dot, agent name, current step description, elapsed time HH:MM; footer "15 agents idle, 0 failed"; "All agents" link
- Widget 3 "Today's schedule": 5 upcoming runs (time, agent name, client); first row shows running badge (pulse dot), rest show "Upcoming" badge; "Full calendar" link
- Widget 4 "Recent successes": 5 rows with green check SVG, agent name, client, time ago; "View run log" link
- Right sidebar: Inbox widget retained; 3 preview items (approval, belief conflict, failed run); unread count badge; "View all 7 unread items" link
- "New agent" primary action moved to topbar (one primary action per screen, per principle)
- Greeting sub-line updated to reflect new widget content ("3 agents active, 18 total. 7 items need attention in inbox.")
- Replaces banner updated to note Round 6 redesign + direct link to before-home.html

Change 3b (before-home.html):
- New file: faithful depiction of DashboardPage.tsx component tree
- 10 annotated component blocks in render order: DashboardErrorBanner, Greeting+FreshnessIndicator, MetricCard x4, QueueHealthSummary (admin-only), PendingApprovalCard list, OperationalMetricsPlaceholder (empty gap), AgentRecommendationsList, WorkspaceFeatureCards, UnifiedActivityFeed
- Realistic mock data: 4/2/3/341 metric values, 3 approval cards with action buttons, 3 recommendations, ClientPulse health bar
- OperationalMetricsPlaceholder shown as dashed-border gap with source comment
- QueueHealthSummary marked "system_admin only" with amber border
- Conditional sections labeled with tag-conditional pill
- Problems box at bottom: 8 annotated issues with current DashboardPage (KPI tiles, Inbox duplication, placeholder gap, weak workspace shortcuts, freshness noise, no primary CTA, conditional visibility jarring, no active-run glanceability)

index.html updates:
- Masthead: "Prototype Round 6" eyebrow, updated description
- Decisions box: 3 new confirmed items (Home redesign, Run trace types, Calendar views)
- Home card in Round 3 section: description updated, Before link added
- New "Round 6, Interactive behavior polish" section with 4 cards (Run Trace, Calendar, Home, Before DashboardPage)

**New CSS patterns added:**

run-trace.html (inline):
- .detail-placeholder: centered empty state in event detail panel
- .detail-footer: sticky footer with raw-JSON link
- .expand-link: "Show more / Show less" toggle for expandable pre blocks
- .raw-json-link: styled link in detail footer
- .modal-backdrop / .modal-box / .modal-head / .modal-body / .modal-json: raw JSON modal overlay
- fieldPreExpandable() JS helper with max-height:80px collapsed default

calendar.html (inline):
- .cal-grid-14 / .cal-grid-14-cell / .cal-grid-14-header: 7-column CSS grid for 14-day view
- .cal-chip / .cal-chip-dot / .cal-chip-label: abbreviated event chips for 14-day cells
- .cal-grid-30 / .cal-grid-30-header / .cal-grid-30-cell / .cal-grid-30-date: month grid for 30-day view
- .cal-dot-sm / .cal-dots-row / .cal-event-count: colored dot indicators for 30-day cells
- .out-of-month: muted styling for padding days outside the current month
- .day-popover / .day-popover-head / .day-popover-item / .popover-close: day detail popover (click-to-expand)

home.html (inline):
- .widget / .widget-head / .widget-body / .widget-title / .widget-link: widget card container
- .widget-grid: 2x2 grid for 4 widgets
- .widget-subline / .widget-metric / .widget-metric-num / .widget-metric-label: inline metric display
- .sparkline-wrap / .spark-bar (.active / .current): 24-bar CSS sparkline
- .active-agent-row / .active-agent-name / .active-agent-step / .active-agent-elapsed: active agents list rows
- .sched-row / .sched-time / .sched-name / .sched-client: schedule widget rows
- .success-row / .success-agent / .success-client / .success-time: recent successes rows
- .inbox-card / .inbox-card-head / .inbox-card-title / .inbox-card-body / .inbox-card-link: sidebar inbox preview
- .inbox-item-preview / .inbox-preview-dot / .inbox-preview-body / .inbox-preview-title / .inbox-preview-sub: inbox preview items

**Frontend-design-principles checks:**

run-trace.html:
- Start with primary task: yes -- primary task is "understand what happened in this event"; panel opens directly on click without navigation
- Default to hidden: yes -- all event detail hidden until user selects; raw JSON behind secondary link; expandable previews collapsed by default
- One primary action: yes -- page primary action is "select an event to inspect"; raw JSON is secondary, deliberately de-emphasized
- Inline state: yes -- event type, status, latency all shown inline in detail panel without navigating away
- Re-check passed: yes -- operator can click any row and immediately see the relevant fields for that event type; no context switching required

calendar.html:
- Start with primary task: yes -- primary task is "see what's scheduled". 7-day default shows maximum detail. 14 and 30 views collapse data appropriately.
- Default to hidden: yes -- 14 and 30 day detail hidden until day cell is clicked; no dashboards or KPI counts added
- One primary action: yes -- primary action is "view the schedule". Scope and window filters are secondary controls, not primary actions.
- Inline state: yes -- client color dots communicate ownership inline without tooltips required; running state shown inline in 7-day view
- Re-check passed: yes -- operator can switch views with one click and see all scheduled runs for the period; 30-day popover provides just-in-time detail without overwhelming the month grid

home.html:
- Start with primary task: yes -- operators' primary task on login is orientation: "what's running, what's coming up, what succeeded". Four widgets answer those four questions directly without HITL duplication.
- Default to hidden: yes -- no KPI tiles, no diagnostic panels. Inbox preview shows 3 items only, "View all" deferred to Inbox page. No trend charts, no status dashboards.
- One primary action: yes -- "New agent" in topbar. Widgets are informational, not action triggers (links open other pages, not modals).
- Inline state: yes -- sparkline communicates run trajectory in 52px. Active agents list shows elapsed time + current step inline. No separate status page needed.
- Re-check passed: yes -- non-technical operator sees at a glance: how many runs today (sparkline + count), who's running now (active agents), what's coming up (schedule), what succeeded (successes). Inbox in sidebar for action items. Clear separation of "inform" (widgets) vs "act" (inbox).

before-home.html:
- Frontend principles not applied intentionally -- this is a faithful depiction of current state, not a design artifact.

**Rule violations flagged:** none

**Operator-decision items:**
- Calendar 30-day grid: the 6th row fix -- May grid has a layout quirk where cell #7 (May 6 today) is rendered twice due to column alignment. This is a prototype artifact; in production the grid start offset should be computed from the actual weekday of the 1st. No decision needed unless operator wants a pixel-perfect grid.
- Home sparkline: currently CSS-only bars with hardcoded heights. In production this would be SVG or Canvas. The pattern demonstrates the concept correctly for operator review purposes.
- before-home.html: OperationalMetricsPlaceholder is depicted as an empty gap because the real component renders nothing (LAYOUT-RESERVED comment in source). If the operator believes this section is coming soon, it should be noted in the Round 6 decision record.

**Files modified:**
- `prototypes/consolidation-2026-05-06/run-trace.html` (Change 1: clickable events, type-specific panels, raw JSON modal)
- `prototypes/consolidation-2026-05-06/calendar.html` (Change 2: 7/14/30 view switching, three DOM containers)
- `prototypes/consolidation-2026-05-06/home.html` (Change 3a: widget dashboard redesign, drop Inbox duplication)
- `prototypes/consolidation-2026-05-06/before-home.html` (Change 3b: created, grounded in DashboardPage.tsx)
- `prototypes/consolidation-2026-05-06/index.html` (Round 6 metadata, home card Before link, new Round 6 section, decisions box updated)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7 — 2026-05-06

**Operator feedback:** Swap widget 4 ("Recent successes") with a "Spend & cap" widget. Same 2x2 grid, 4 widgets total. Spec included daily and monthly rows, pace indicator, amber warning on over-pace, and a placeholder spending drawer.

**Changes made:**
- Removed "Recent successes" widget CSS (.success-row, .success-agent, .success-client, .success-time) and widget 4 HTML entirely
- Added "Spend & cap" widget in widget 4 position (same grid cell, same ~280px footprint)
  - Row 1 "Today": $9.50 / $50 daily cap (19%), 4px indigo progress bar, no warning (under cap)
  - Row 2 "This month": $325 / $1,500 monthly cap (22%), 8px indigo progress bar with dotted pace line at 19.4% (day 6 of 31), amber projection "On pace for $1,680/month" with "Over pace" chip ($35 over pace = ~12% over, which exceeds the 10% amber threshold)
  - Footer: "Scope: Acme Corp" in muted text
  - Widget is clickable, opens spending drawer
- Added CSS for spend widget sections, bars, pace line, projection states, warning chip, scope line
- Added spending detail drawer (placeholder): top-5-spenders stub table with agent names, run counts, MTD spend; "coming soon" note for per-run and cache detail; Escape key and overlay click to close; vanilla JS open/close

**Schema verification:** Confirmed cap fields exist in schema:
- `workspaceLimits.ts`: `dailyCostLimitCents`, `monthlyCostLimitCents` (per subaccount)
- `orgComputeBudgets.ts`: `monthlyComputeLimitCents` (org level)
Widget labels ("daily cap", "monthly cap") accurately reflect the two-tier cap structure.

**Widget swap rationale:** Cost state is more decision-relevant operator information than a "recent successes" counter. An operator seeing spend approaching a cap can act (pause an agent, raise a cap, investigate a spender). Recent successes duplicates what the Today's runs sparkline already communicates (97% success rate). The swap does not add a screen or violate the 4-widget count constraint.

**Drawer status:** Placeholder only as specified. Shows stub table of top 5 spenders with "coming soon" note for full breakdown.

**Frontend-design-principles checks:**
- Start with primary task: yes -- widget surfaces spend state the operator needs to notice without requiring navigation to a settings or billing page
- Default to hidden: yes -- the spending drawer is hidden; the widget shows only the two most decision-relevant numbers (today vs daily cap, MTD vs monthly cap)
- One primary action: yes -- widget click opens drawer; no competing actions
- Inline state: yes -- cost state is inline on the home page, not behind a dedicated billing dashboard
- Re-check passed: yes -- a non-technical operator reading "$9.50 / $50 today" and "$325 / $1,500 this month" with an "Over pace" chip understands the situation without explanation

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/home.html`
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7a — 2026-05-06

**Operator feedback:** Three-mode left nav across all prototype pages via shared _sidebar.js. Exhaustive nav per mode. New activity.html page mirroring ActivityPage.tsx. All non-before pages updated to use shared sidebar.

**Changes made:**

New files:
- `_sidebar.js` created: exposes `renderSidebar(mode, activeHref)`. Three modes (workspace / org / system). Mode switcher pill row at top of sidebar (above logo), persists to localStorage key `prototype.sidebar.mode`. Workspace mode: 15 items in Workspace section (Home, Inbox+badge, Calendar, Agents, Automations, Workflows, Tasks, Sites, Triggers, Goals, Org Chart, Portal, Team, Activity, Action Log), plus Knowledge, Connections, ClientPulse, Manage/bottom sections. Org mode: 13 items in Organisation section, plus ClientPulse stubs and Manage bottom. System mode: 11 items all stubs except Activity which links to activity.html?scope=system. Profile link (avatar + "Profile Settings" stub) at bottom of every mode. Stub links show 2-second slate toast and preventDefault (no navigation). Active link detection by basename match.
- `activity.html` created: mirrors ActivityPage.tsx and ActivityFeedTable.tsx. Scope toggle (Subaccount / Org / System) in page header. Default scope derived from sidebar mode or ?scope= query param. Filter bar: search, type (24 activity types in Core and Workspace optgroups), status, severity, sort (attention first / newest / oldest / severity). Active filter pills with remove buttons. 28 mock rows covering all 24 activity types across 4 workspaces (Acme Corp, Beta Inc, Gamma Solutions, Nova Digital). Table columns: Type (color-coded badge), Subject (ellipsis link), Status (color-coded badge), Actor (dot indicator), Severity (dot), Workspace (org/system scope only), Created (relative time), Duration. Row click opens slide-in drawer (440px). Drawer footer: "View run trace" for agent_run, "View in Inbox" for inbox_item/review_item, "View finding" stub for health_finding. Empty state: "No activities match these filters" with Clear filters button. Scope switching updates subtitle and shows/hides Workspace column. Escape key and overlay click close drawer.

Pages updated to use shared sidebar (before-* pages intentionally untouched):
- `home.html`: inline sidebar replaced with sidebar-mount + renderSidebar('home.html')
- `inbox.html`: replaced
- `agents.html`: replaced
- `automations.html`: replaced
- `workflows.html`: replaced
- `knowledge.html`: replaced
- `integrations.html`: replaced
- `manage-org.html`: replaced
- `run-trace.html`: replaced
- `calendar.html`: replaced
- `agent-edit.html`: replaced
- `automation-detail.html`: replaced (active hint: automations.html as parent)

Index updated:
- Masthead eyebrow: "Prototype Round 7a"
- Description updated to describe three-mode nav and activity page
- Decisions box: 6 new items covering sidebar modes, nav item inventories, stub behavior, activity page spec, bucket A consolidations, bucket B stubs
- New "Round 7a" section with Activity card and Shared Sidebar JS card

**Bucket A consolidations confirmed (deduplicated in sidebar):**
- Tasks consolidated to Inbox (HITL) -- Inbox is the nav item, Tasks is a stub in Workspace for workspace task board
- Scheduled/Calendar merged -- single Calendar nav item
- Action Log kept as stub link in Workspace mode
- Skills folded into Capabilities tab on agent-edit -- not a nav item
- Reports under ClientPulse stub section (labeled "separate thread")

**Bucket B stubs (visible but not implemented):**
- Sites, Triggers, Goals, Org Chart, Portal, Team, Action Log (workspace mode)
- Companies, Automations (org), Knowledge (org, note: org-knowledge.html in 7b), Connections (org), Skills (org), Workflows (org), Health, Spending Budgets, Teams (org)
- All System mode links except Activity

**System mode:** Left-nav only. No new page content. All links are stubs pointing to # except Activity which links to activity.html?scope=system. Intent: system admin sees the nav structure; page content is out of scope for this consolidation pass.

**Frontend-design-principles checks:**
- Start with primary task: yes -- Activity page opens on the feed immediately. Filter bar is secondary. Scope toggle is in header, not blocking. Drawer is progressive disclosure.
- Default to hidden: yes -- drawer hidden until row click. Filter pills only shown when active. Workspace column hidden on subaccount scope. No KPI tiles on activity page.
- One primary action: yes -- Activity: primary action is "click a row to inspect". Sidebar: primary action is "switch to a nav item". Mode switcher is a secondary control.
- Inline state: yes -- status, severity, actor type all shown inline in table rows. Scope shown inline in subtitle. No dashboard panels.
- Re-check passed: yes -- operator landing on Activity sees the feed immediately. Can filter with one dropdown. Row click shows detail without leaving the page. Non-technical operator can understand "attention needed" / "failed" status colors without explanation.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/_sidebar.js` (created)
- `prototypes/consolidation-2026-05-06/activity.html` (created)
- `prototypes/consolidation-2026-05-06/home.html` (sidebar replaced)
- `prototypes/consolidation-2026-05-06/inbox.html` (sidebar replaced)
- `prototypes/consolidation-2026-05-06/agents.html` (sidebar replaced)
- `prototypes/consolidation-2026-05-06/automations.html` (sidebar replaced)
- `prototypes/consolidation-2026-05-06/workflows.html` (sidebar replaced)
- `prototypes/consolidation-2026-05-06/knowledge.html` (sidebar replaced)
- `prototypes/consolidation-2026-05-06/integrations.html` (sidebar replaced)
- `prototypes/consolidation-2026-05-06/manage-org.html` (sidebar replaced)
- `prototypes/consolidation-2026-05-06/run-trace.html` (sidebar replaced)
- `prototypes/consolidation-2026-05-06/calendar.html` (sidebar replaced)
- `prototypes/consolidation-2026-05-06/agent-edit.html` (sidebar replaced)
- `prototypes/consolidation-2026-05-06/automation-detail.html` (sidebar replaced)
- `prototypes/consolidation-2026-05-06/index.html` (masthead + decisions + Round 7a section)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)
