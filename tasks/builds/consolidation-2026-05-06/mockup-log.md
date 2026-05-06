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

## Round 7b-2 — 2026-05-06
**Operator feedback:** Build team.html (Members + Org Chart tabs) and before-team.html, update index.html and mockup-log.md.

**Changes made:**
- `team.html` created: Members tab with 8 mock rows (7 active, 1 pending invite), avatar circles (color-coded initials), role badges (Org admin / Manager / User / Client user), permission set badge, last-active column, status dots (active/pending/suspended), overflow 3-dot menu per row (Edit, Resend invite, Suspend, Remove actions). Row click opens 440px member detail drawer. Drawer: avatar+name+email header, role and permission set dropdowns, joined/last-active fields, recent activity list (3-5 items per member), send-password-reset button, status toggle, suspend/remove danger zone at bottom. Pending row shows dashed avatar border, "Resend invite"/"Cancel invite" in overflow menu and in drawer. Invite modal: email, first name, last name, role dropdown, permission set dropdown, "Send invite" button. After submit: toast "Invite sent to email" and new pending row appended live to table. Org Chart tab: CSS flexbox tree (no D3), Acme Corp hierarchy (CEO Sarah Chen, VP Sales Mike Liu with 3 reports including SDR Manager Lisa Wong who has 2 sub-reports, VP Marketing Carlos Diaz with 1 report). Pending invitee (James Kim) shown as dashed-border card. Anna Brown (not yet invited) shown as grey card. Card hover: indigo border + elevation. Card click: opens same member detail drawer as Members tab. "Add unassigned member to chart" button below chart fires stub toast. Read-view-only note below chart. Tab switching wired with `switchTeamTab()`. Overflow dropdowns use fixed positioning. Escape key closes drawer and modal. Toast auto-dismisses at 2.5s.
- `before-team.html` created: Before banner explaining the two-page production state. Old-style sidebar depicting production nav (no mode switcher, Team under Manage section, Org Chart as a separate Org-level section). Two-column split: left half shows SubaccountTeamPage (email-first flat table, 6 rows, utilitarian "Add member" button, annotation about modal limitations), right half shows OrgChartPage (sparser hierarchy: name+role only, no avatars, no email, no click actions, annotation about read-only state). Problems box with 7 specific gaps. After-state link at bottom pointing to team.html.
- `index.html` updated: masthead eyebrow changed to "Prototype Round 7b-2", description updated to describe team.html, file count updated to 44+, decisions box gets Round 7b-2 bullet, new Round 7b-2 section at bottom with two cards (team.html and before-team.html with cross-links).

**Design decisions:**
- Single `team.html` (tabs) vs two separate pages: tabs chosen because Members and Org Chart are two views of the same data set (people at Acme Corp). An operator who adds a member via the invite modal should immediately be able to place them in the org chart without navigating.
- Member detail drawer is shared across both tabs. This means the single interaction pattern (click to inspect) works regardless of which tab the operator is on, reducing cognitive overhead.
- Org Chart is CSS flexbox only for this prototype. No graph library loaded. The layout is sufficient to communicate the hierarchy and the click-through pattern. Drag-and-drop editing is noted as deferred to production in the chart's footnote.
- Pending invite row (James Kim) is shown in both the Members table and the Org Chart (as a dashed-border card under Lisa Wong, who invited him). This makes the pending state visible from both surfaces.
- Anna Brown (not yet invited, shown in Org Chart under Lisa Wong) demonstrates the "unassigned in chart" state that the "+ Add unassigned member to chart" button would address.
- `_sidebar.js` workspace mode has Team as a stub (fires toast). This is per the brief: the Team link in the sidebar remains a stub; team.html is reachable directly or via the index.

**Frontend-design-principles checks:**
- Start with primary task: yes -- Members tab is the default active view (primary task: manage team members). Org Chart is secondary, behind a tab. Invite modal is reachable from two obvious CTAs.
- Default to hidden: yes -- member detail drawer is hidden until row/card click. Overflow menu is hidden until dot-button click. No KPI tiles. No analytics panel. Last-active column shows relative time, not a chart.
- One primary action: yes -- "Invite member" is the primary action on this page (CTA in both the topbar and the page header). The Members toolbar has a second invite button but it is the same action, not a competing action.
- Inline state: yes -- status (active/pending/suspended) is shown as an inline status dot + label directly in the table row. Role and permission set are shown as small badges inline. Last active is a plain relative time string inline.
- Re-check passed: yes -- a non-technical operator landing on this page can immediately see who their team members are, their roles, and whether any invites are pending. Clicking a row gives full detail without navigating away. The Org Chart is one click away on a clearly labelled tab.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/team.html` (created)
- `prototypes/consolidation-2026-05-06/before-team.html` (created)
- `prototypes/consolidation-2026-05-06/index.html` (masthead, decisions box, Round 7b-2 section)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7b-1 — 2026-05-06

**Operator feedback:** Nav consolidation across all three sidebar modes. 10 approved nav decisions implemented. Three mechanical fixes: calendar period navigation, Connections logos, Inbox button consistency.

**Changes made:**

_sidebar.js nav consolidation (Change 1):
- Workspace mode restructured from one flat "Workspace" section into 6 grouped sections: Work (Home, Inbox+badge, Calendar, Activity), Build (Agents, Automations, Knowledge, Connections), Tasks (Tasks stub), External (Pages stub, Portal stub), Setup (Team stub, Manage), ClientPulse (3 stubs labeled "separate thread")
- Removed from workspace: Workflows (folded into Automations as tabs), Triggers (folded into Automations), Goals (retired, replaced by Project Objective field), Org Chart (folded into Team page as a tab), Sites (renamed to Pages)
- Action Log: kept as stub pending Run trace consolidation discussion (not removed)
- Bottom Manage link moved into Setup section; bottom section now contains only Profile Settings
- Org mode restructured from one flat "Organisation" section into 5 grouped sections: Clients (Companies stub), Build (Agents, Automations, Skills, Knowledge, Connections stubs), Operate (Calendar, Activity), Setup (Team, Spending, Manage stubs), ClientPulse
- Removed from org: Workflows (merged into Automations), Health (folded into Activity with type=health_finding filter), Teams (Team page now has Members+Teams tab), Spending Budgets+Spend Ledger (one "Spending" stub)
- System mode restructured from one flat "System" section into 3 grouped sections: Inventory (Organisations, Agents, Skills, Workflow Studio, Automations stubs), Operate (Activity, Incidents+badge, Queues stub), Setup (Financials, Settings stubs)
- Removed from system: Diagnostics and Job Queues as separate items (merged into one "Queues" stub)
- Renamed in system: LLM P&L to Financials
- New ICONS added: pages, manage, spending, financials (llmpnl icon repurposed)
- Old icons removed: sites, triggers, goals, orgchart, health, budget, llmpnl, diagnostics, workflows (retained as nav was removed)
- Section label rationale: Work (operator daily flow), Build (creating capability), Tasks (kanban board primitive), External (client-facing surfaces), Setup (team and config), Operate (cross-cutting visibility), Inventory (platform resources)

calendar.html period navigation (Change 2):
- Period type buttons renamed: "7 days" to "Week", "14 days" to "Fortnight", "30 days" to "Month"
- Back/forward arrow pair added before period toggle, using chevron characters in a rounded-border wrapper
- Period label element (`#period-label`) between arrows, min-width 160px centered, shows computed period string
- Today button added to the right of the arrow group, highlights bold indigo when at offset 0
- JS variables: `currentPeriodType` ('week'/'fortnight'/'month'), `currentPeriodOffset` (integer, 0=today's period)
- `computePeriodLabel(type, offset)` computes the display string using real date math anchored to prototype date May 6, 2026; week starts Monday
- `shiftPeriod(dir)` increments/decrements offset and calls renderPeriod()
- `resetToToday()` resets offset to 0 and calls renderPeriod()
- `switchCalView()` updated to set `currentPeriodType` from days param and reset offset to 0 on type change
- `renderPeriod()` called on load to initialise the label to "May 6 - May 12, 2026"

integrations.html app logos (Change 3):
- Added `.app-logo` CSS class (28px square, border-radius 6px, flex centering) to `_shared.css`-style inline block in integrations.html
- Replaced `conn-icon-sm` spans for all 8 connection rows with `.app-logo` spans containing inline SVG:
  - Gmail: red M-shape envelope path
  - Salesforce: blue cloud shape
  - HubSpot: orange sprocket/spoke shape
  - Client portal: generic plus-in-box (no external trademark)
  - Internal data API: bar chart / waveform
  - AWS S3: hexagon outline with S3 text
  - Zapier: orange Z monogram on background
  - LegalDocs Pro: document with checkmark (non-trademarked, generic)
  - Slack: 4-square color grid (red/blue/green/amber)
  - Google Analytics: bar chart bars (yellow/green/blue)
  - Filesystem server: generic document lines (for MCP/custom/unknown)

inbox.html button consistency (Change 4):
- Added `.inbox-btn`, `.inbox-btn-primary`, `.inbox-btn-secondary`, `.inbox-btn-archive` CSS classes
- All button sizing: padding 7px 14px, font-size 13px, font-weight 600, border-radius 6px, line-height 1
- Primary (inbox-btn-primary): solid indigo-600 background, white text (Approve, Accept new, Open task, Reply to agent, View run trace, Re-add)
- Secondary (inbox-btn-secondary): white background, slate-300 border, slate-700 text (Reject, Keep existing, View draft, Re-authenticate, View task, Details, Re-suppress)
- Archive (inbox-btn-archive): white background, slate-300 border, slate-500 text (differentiated from secondary without being a plain link)
- Updated all active items: belief conflict (Accept new/Keep existing/Archive), block proposal (Approve/Reject/Details), email approval (Approve/Reject/View draft), clarification (Reply to agent/Archive), task (Open task/Archive), LinkedIn approval (Approve/Reject/View draft), failed run (View run trace/Re-authenticate/Archive), 3 suppressed memory items (Re-add/Re-suppress)
- Updated all Earlier/Read section archive buttons to inbox-btn-archive
- Legacy `.inline-approve` and `.inline-reject` CSS retained as aliases pointing to same dimensions (for any remaining usages not explicitly updated)

index.html:
- Masthead eyebrow updated to "Prototype Round 7b-1"
- Description updated to describe the 4 changes
- Decisions box: 6 new bullets for nav consolidation decisions and 3 mechanical fixes
- Round 7b-1 section added with 4 cards (Sidebar JS, Calendar, Connections, Inbox)
- Round 7a sidebar card description updated to note 7b-1 supersedes it

**Frontend-design-principles checks:**
- Start with primary task: yes -- nav restructuring follows primary task groupings (Work = what operator does daily, Build = what they create). No new screens added.
- Default to hidden: yes -- no new panels, dashboards, or diagnostic panels. Removed items (Goals, Workflows, Org Chart, etc.) are either folded as tabs or fully removed, reducing nav weight.
- One primary action: yes -- calendar navigation: primary action remains "view the schedule". Period nav is a secondary control. Inbox: primary action is "Approve/act on item". Connections: "Connect service" unchanged.
- Inline state: yes -- calendar period label shows the current period inline. No new dashboards.
- Re-check passed: yes -- non-technical operator sees shorter, grouped nav without stub noise from removed items. Calendar period navigation is obvious (left/right arrows are universal). Inbox actions are visually clear (solid = act, outlined = secondary, outlined-muted = dismiss).

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/_sidebar.js` (full nav restructure, 3 modes, section groupings, icon additions/removals)
- `prototypes/consolidation-2026-05-06/calendar.html` (period navigation: arrows, label, Today button, JS state)
- `prototypes/consolidation-2026-05-06/integrations.html` (app logo SVGs replacing initials, .app-logo CSS class)
- `prototypes/consolidation-2026-05-06/inbox.html` (button consistency CSS, all active item buttons updated)
- `prototypes/consolidation-2026-05-06/index.html` (masthead, decisions, Round 7b-1 section)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (Round 7b-1 entry)

## Round 7b-3 — 2026-05-06 18:00
**Operator feedback:** Build queues.html consolidating JobQueueDashboardPage + SystemTaskQueuePage into a two-tab surface (Queue health + Execution log), plus before-queues.html companion, plus index.html and mockup-log updates.

**Changes made:**
- Created `queues.html`: two-tab system admin surface. Queue health tab: 4 KPI tiles (total active 14, pending 127, DLQ depth 8 in red, avg duration 4.2s); 4 tier cards (agent execution indigo, financial blue, maintenance slate, memory emerald) each with a 9-column per-queue table; 12 mock queues across the four tiers with realistic elevated data (agent.run: 80 pending, 12% retry rate, DLQ 5; spend.aggregate: DLQ 3); row click opens 520px drawer with stats grid, SVG sparkline of pending depth over 1h, last 5 errors with toggleable stack traces, DLQ retry/discard rows (3 mock jobs), read-only queue config grid, pause/resume toggle. Execution log tab: filter bar (status, engine, time range, search, live tail toggle); 20-row execution table with status and engine type badges, process name, org, started, duration, retry count, error preview; pagination row (25 of 1,847); row click opens 520px drawer with timestamps, inline confirm-before-action banner, error block with stack trace, 3-accordion payload section (outbound, callback, process snapshot), return webhook URL, retry history table, Retry now / Discard / Mark cancelled action buttons.
- Created `before-queues.html`: side-by-side split showing JobQueueDashboardPage (left, flat table with implicit tier section rows, no visual tier cards, no click-through, no DLQ UI) and SystemTaskQueuePage (right, flat execution table with basic status/engine filters, no live tail, task IDs as primary identifier, no process names, no action buttons). Both sides annotated with specific gaps. Problems box lists 6 issues: two pages for related data, no drill-down, tier grouping is data not visual, no live tail, DLQ requires CLI, no queue pause in UI.
- Updated `_sidebar.js`: Queues item in system mode changed from stub to `href: 'queues.html'`.
- Updated `index.html`: masthead updated to Round 7b-3 with queues description; new Round 7b-3 section added at bottom with Queues card and Before card; file count updated to 46+.

**Frontend-design-principles checks:**
- Start with primary task: yes — system-admin surface for SRE/on-call. Primary task is "identify and remediate a degraded queue or failing execution". Queue health tab opens on the health overview immediately. Execution log opens with failure-biased filter pre-selected to show actionable items. Brief explicitly notes the strict consumer-simplicity rules apply less to power-user system surfaces.
- Default to hidden: relaxed per brief (system-admin page). KPI strip is aggregate signal, not decoration. Sparkline is in the drawer (progressive disclosure). Stack traces collapsed behind "Show stack" toggle. Payload JSONs are collapsed accordions. Config panel at bottom of drawer.
- One primary action: yes — Queue health: primary action is "click a queue row to drill in". Execution log: primary action is "click an execution row to inspect". Drawer actions (Retry now, Pause queue) are the single corrective action per context.
- Inline state: yes — DLQ depth in red in KPI tile and tier table. Pending count colored amber/red when elevated. Status badges inline on every execution row. Error preview truncated inline so engineers can triage without opening a drawer.
- Re-check passed: yes — SRE landing on Queue health sees KPI strip for global state, scans tier cards for elevated numbers, drills into specific queue. Execution log gives failure firehose with 3 filter controls and live tail. Drawer provides full forensic context without navigating away. System-admin only surface.

**Rule violations flagged:** none (system-admin surface explicitly exempted per brief and frontend-design-principles.md "When to break these rules")

**Files modified:**
- `prototypes/consolidation-2026-05-06/queues.html` (created)
- `prototypes/consolidation-2026-05-06/before-queues.html` (created)
- `prototypes/consolidation-2026-05-06/_sidebar.js` (Queues stub resolved to queues.html)
- `prototypes/consolidation-2026-05-06/index.html` (masthead + Round 7b-3 section)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7b-4 — 2026-05-06

**Operator feedback:** Build spending.html (Caps and budgets + Ledger tabs) consolidating SpendingBudgetsPage and SpendLedgerPage, plus before-spending.html companion. Update index.html and mockup-log.md. Resolve _sidebar.js Spending link from stub to spending.html.

**Changes made:**
- Created `spending.html`: two-tab page for org admins. Mode=org, activeHref=spending.html. Primary action: "Edit org cap" button in topbar. Caps and budgets tab: org-level cap card with $5,000/month big number, 8px indigo progress bar, dotted pace line at 19.4% (day 6 of 31), "$1,283 used, 25.7%, on pace for $4,920" inline metric. Per-workspace caps table: 4 rows (Acme Corp healthy green, TerraForm Partners over-pace amber background with amber badge, Revel Group near-cap red background at 87.9%, Globex Industries healthy green). Each row has inline-editable daily and monthly caps (hover shows edit icon), two mini progress bars (monthly + daily), status badge, Edit/Pause action buttons. Defaults panel below table with default $50/day and $1,500/month and "Edit defaults" button. Ledger tab: filter bar (search, workspace multi-select, date range, type, group-by select), KPI strip (4 tiles: total spend $1,283.42, avg per day $42.78, largest day $89.50 on May 2, top spender Outreach Agent $312.50). Flat transaction table with 25 rows JS-rendered from TRANSACTIONS array spanning 7 days across 4 workspaces and varied agents and types (LLM, Tool, Storage), all with realistic costs $0.02-$4.50. Group-by switching: None (flat table), Day (6 day-rows), Subaccount (4 rows by workspace with spend bars), Agent (8 ranked agents by spend). Row click opens 440px transaction detail drawer with meta grid (workspace, agent, type, model, token counts, timestamp, run ID), cost breakdown section (input cost, output cost, cache discount, total), "View run trace" and "View agent definition" buttons. Edit org cap modal: monthly field only with validation. Per-workspace cap modal: daily + monthly fields with validation (monthly >= daily). Defaults modal with daily + monthly fields. All modals support Escape key and overlay click to close. Toast notifications for applied changes.
- Created `before-spending.html`: side-by-side split. Before banner with route annotations. Left: SpendingBudgetsPage mock with form-style org cap input field, per-subaccount table with limits in raw cents (5000, 150000), Edit buttons only. Right: SpendLedgerPage for Acme Corp with navigation path annotation explaining the 4-click depth required, Group by Day only filter with note about limited options, day-grouped transaction rows with no clickable detail, annotation about missing provider/model/token/cache information. Problems box with 6 specific gaps: two pages for related data, no org-wide ledger, caps in cents without context, limited group-by, no row drill-down.
- Updated `_sidebar.js`: Spending item in org mode Setup section changed from stub to `href: 'spending.html'` and `stub` property removed.
- Updated `index.html`: masthead eyebrow changed to "Prototype Round 7b-4", description updated to describe spending page, file count updated to 48+, decisions box gets Round 7b-4 bullet. New Round 7b-4 section at bottom with two cards (spending.html and before-spending.html with cross-links).

**Frontend-design-principles checks:**
- Start with primary task: yes. Audience is org admin or finance person. Primary task is "understand and control how much each workspace is spending". Caps and budgets tab opens on the org cap card (the top-level budget) then the per-workspace breakdown. The ledger tab provides the transaction drill-down for investigation. Neither tab opens on a list of technical IDs or data model fields.
- Default to hidden: yes. Transaction detail drawer is hidden until row click. Group-by sub-views are hidden until dropdown selection. Cap modals are hidden until Edit action. The KPI strip on the Ledger tab is appropriate here (audience is org admin/finance, the brief explicitly allows mid-density for power-user territory, and the four tiles are the minimum context needed to interpret the transaction data below them).
- One primary action: yes. "Edit org cap" is the single primary action on the page. It appears in the topbar and as a link inside the org cap card. Per-workspace inline edit is a secondary action on the caps table, not a competing primary action.
- Inline state: yes. Workspace cap status (within/over-pace/near cap) is shown as inline badge with color directly in the table row. Progress bars communicate cap consumption without requiring a click. The org cap card shows spend vs cap inline with a pace line on the same card.
- Re-check passed: yes. A non-technical org admin landing on Caps and budgets can immediately see which workspaces are over-pace or near their cap (colored rows + status badges). Clicking Edit on a row opens a focused modal with two fields. The Ledger tab requires more attention but the audience (finance person) is a power user, consistent with the brief's note that mid-density is appropriate for this surface.

**Rule violations flagged:** The Ledger tab KPI strip contains 4 tiles. Per strict frontend-design-principles, KPI tiles are "0 by default" and only permitted when the primary task is monitoring. This is flagged as a deviation from the default rule. The brief explicitly calls for this KPI strip ("KPI strip below the filter bar..."), the audience is power-user finance territory, and the tiles directly contextualize the transaction data below them. Flagging per spec; operator to confirm or cut.

**Files modified:**
- `prototypes/consolidation-2026-05-06/spending.html` (created)
- `prototypes/consolidation-2026-05-06/before-spending.html` (created)
- `prototypes/consolidation-2026-05-06/_sidebar.js` (Spending stub resolved to spending.html)
- `prototypes/consolidation-2026-05-06/index.html` (masthead, decisions box, Round 7b-4 section)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7b-5 — 2026-05-06

**Operator feedback:** Build pages.html (renamed "Sites" to "Pages") and before-pages.html companion. Light redesign: card grid, status badges, detail drawer instead of separate route. Update _sidebar.js Pages link, index.html, mockup-log.md.

**Changes made:**
- `pages.html` created: Card grid (3 cols desktop, 2 cols tablet, 1 col mobile) with 6 mock page cards. Each card has a browser-frame thumbnail placeholder (styled div with primary color fill at low opacity), bold page name, URL slug in monospace, status badge (Published green / Draft amber / Archived slate), last-updated text, theme color dot, and custom-domain pill where applicable. Status filter pills (All / Published / Draft / Archived) and search input filter by name/slug in real time. Page count subtitle updates on filter. Click any card opens a 600px slide-in drawer. Drawer header shows name, URL, status badge. Four tabs: Settings (name, slug, custom domain, color picker with 5 chips + custom input, status dropdown), Content (block list: Hero, Body, CTA, Footer with "Edit content" stub button), SEO (meta title, meta description textarea, OG image upload placeholder, canonical URL), Analytics (4 metric tiles: visits 1,248 / conversion 4.3% / avg time 1:42 / bounce 38%, "View detailed analytics" stub link). Drawer footer: "View live page" external-link button, Duplicate outlined button, Archive outlined button, Save changes primary button. New page modal: name input, slug (auto-generated from name, editable, prefixed with domain), 5 color chips + custom color input, status dropdown (Draft/Published). Submit appends a new card live with a "New" badge, shows "Page created" toast. Escape key closes open drawer/modal. No em-dashes in any UI copy.
- `before-pages.html` created: Before banner with route annotation. Left: compact old-nav sidebar (flat list, nav item labeled "Sites" active). Right: production table (Name, Slug/URL, Custom domain, Created, Updated, Actions columns, 6 rows). Route annotation callout explaining detail navigates to a separate full-page route. Below the table: sketch of PageProjectDetailPage.tsx (back link, field rows: name, slug, custom domain, primaryColor as raw hex, created, updated, Save/Cancel buttons). Problems box lists 7 specific gaps: two-step navigation, no visual thumbnail, no status column, no status filter, raw hex color only, no analytics, wrong "Sites" label.
- `_sidebar.js` updated: Workspace External section Pages item changed from `href: '#', stub: true` to `href: 'pages.html'` (stub flag removed).
- `index.html` updated: masthead eyebrow changed to "Round 7b-5", description updated, file count updated to "50+", confirmed decisions box gets Round 7b-5 bullet, new Round 7b-5 section added at bottom with two cards (pages.html and before-pages.html with cross-links).

**Frontend-design-principles checks:**
- Start with primary task: yes -- primary task for a workspace operator on Pages is "find and manage a landing page". The list opens immediately on the card grid. No KPI tiles, no usage charts, no analytics dashboard on the list view.
- Default to hidden: yes -- Analytics tab in the drawer is hidden until selected. SEO and Content tabs are hidden. No analytics surfaced on the card grid itself (theme dot and status badge only). Drawer is hidden until a card is clicked.
- One primary action: yes -- the list page has one primary action: "+ New page". The drawer's primary action is "Save changes". The new-page modal's primary action is "Create page". No competing primaries.
- Inline state: yes -- page status shown inline as a badge on each card. Theme color shown as a dot. Custom domain shown as a pill chip on the relevant card. Last-updated text inline. No separate status panel or analytics strip on the list.
- Re-check passed: yes -- a non-technical operator landing on Pages sees their page cards immediately (name, status, URL), can filter to "Draft" with one click, and can edit settings in a drawer without navigating away. Card thumbnails provide visual distinction without adding cognitive load.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/pages.html` (created)
- `prototypes/consolidation-2026-05-06/before-pages.html` (created)
- `prototypes/consolidation-2026-05-06/_sidebar.js` (Pages stub resolved to pages.html)
- `prototypes/consolidation-2026-05-06/index.html` (masthead, decisions box, Round 7b-5 section)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7b-6 — 2026-05-06

**Operator feedback:** Restructure automations.html to consolidate Workflows + External Automations + Triggers into one page with three top-level tabs. Update before-automations.html to show the three-page before-state. Update index.html and mockup-log.md.

**Changes made:**
- `automations.html` rewritten: Three-tab structure replacing single external-automations list. Tab bar: Workflows (10) / Automations (12) / Triggers (8). Context-aware primary CTA changes label per active tab (New workflow / New automation / New trigger) and opens the matching creation drawer.
  - Workflows tab: 3-column card grid with 10 mock workflows (New lead onboarding, Invoice processing, Weekly report generation, Customer health check, Churn risk escalation, Demo follow-up sequence, Contract renewal nudge, Support ticket triage, Onboarding email cadence, Subscription upgrade workflow). Each card shows name, description, step count badge, last run status (green succeeded / red failed / slate never run), last run time, run count last 7d, trigger source badge. Click opens workflow drawer with Steps tab (step-number circles + label + description) and Run history tab (dot + outcome + timestamp + duration).
  - Automations tab: Table with 12 mock external automations. Columns: Name/Trigger description/tag, Action description, Engine, Status, Last fired + count, Actions. Engine badges: n8n / Make / Zapier / internal. Status: Active green / Paused slate / Error red. Admin notice banner. Rows link to automation-detail.html. Admin controls (Pause/Activate/Delete/Retry) per row.
  - Triggers tab: Table with 8 mock triggers (1 Webhook, 2 Scheduled, 2 HubSpot event, 1 Stripe, 1 Email received, 1 Manual). Columns: Name/URL, Source badge (color-coded per source type), Filter (monospace), Fires (chips linking to targets), Last fired + count, Status. Click opens trigger drawer with Detail tab (name, source select, webhook URL with copy button, event filter, linked targets) and Run history tab (outcome dot + message + timestamp + test-fire button).
  - Cross-tab navigation: target chips on Triggers tab and target chips in trigger drawer call crossTabNavigate(tab, name) which closes all drawers, switches to the correct tab, and shows a toast confirmation.
  - Three creation drawers: new-workflow-drawer (name, description, trigger type), new-auto-drawer (preserves prior fields plus trigger/action description fields), new-trigger-drawer (name, source, event filter, note about target linking after creation).
  - Subtitle line on page header: "Acme Corp - 10 workflows, 12 automations, 7 triggers" (uses middle-dot, not em-dash).
  - Replaces banner updated: "Replaces 4 pages: AutomationsPage + AdminAutomationsPage + WorkflowsLibraryPage + TriggersPage".
- `before-automations.html` rewritten: 3-column grid layout. Column 1: WorkflowsLibraryPage (/workflows) with 5 workflow cards showing step badges and last run status. Column 2: AutomationsPage + AdminAutomationsPage (/automations and /admin/automations) with shared table and note about near-duplicate routes. Column 3: TriggersPage (/triggers) with trigger table and annotated note about lack of cross-page navigation. Banner updated: "BEFORE: Three separate top-level pages". Impact summary (4 items) and problems-with-current-state list (6 items). Explicit before-state banner links to automations.html.
- `index.html`: masthead updated to Round 7b-6 with accurate description. Automations card description updated to reflect three-tab structure. Replaces list expanded from 2 to 4 pages (WorkflowsLibraryPage + TriggersPage added). Round 7b-6 bullet added to confirmed decisions box.
- `_sidebar.js`: verified. Automations link in Workspace Build section already resolves to automations.html. No standalone Workflows or Triggers items present (removed in 7b-1).

**Frontend-design-principles checks:**
- Start with primary task: yes -- primary task on the Automations page is "find and manage an automated process". Three tabs cover the three conceptual types without overwhelming. Default tab is Workflows (the internal multi-step flows that are most commonly built first). The active tab surfaces the most relevant list for that intent.
- Default to hidden: yes -- run history and detail for any workflow are behind a drawer. Trigger event filter detail is behind the drawer. Admin controls on automations are permission-gated and inline. No KPI tiles, no dashboard view, no aggregated cost panels. Cross-tab chips show names only, not firing statistics.
- One primary action: yes -- each tab has exactly one primary action that changes label per tab (New workflow / New automation / New trigger). No competing primaries on any tab.
- Inline state: yes -- workflow last-run status shown as a badge chip on each card without needing to open the drawer. Automation status (Active / Paused / Error) shown inline in the Status column. Trigger status shown inline. Fire count shown as "N/7d" inline without a separate analytics panel.
- Re-check passed: yes -- a non-technical operator can: (a) click Workflows tab, scan cards for a failed workflow, click it, and see the run history in 2 clicks; (b) click Triggers tab, find a trigger, click a target chip to navigate to the matching automation or workflow in one more click; (c) create a new trigger from "+ New trigger" with a 4-field form. No technical jargon required; source types are labeled plainly (Webhook, Schedule, HubSpot event, etc.).

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/automations.html` (rewritten)
- `prototypes/consolidation-2026-05-06/before-automations.html` (rewritten)
- `prototypes/consolidation-2026-05-06/index.html` (masthead, decisions box, automations card description)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7b-7 — 2026-05-06 (retry)

**Operator feedback:** Restructure knowledge.html tabs from Summary / Auto-memory / Authored to Memory / Notes / Documents. Memory tab combines authored entries and memory blocks with org-inheritance chips and rich-text authoring. Notes tab is renamed Auto-memory with promote-to-memory action. Documents tab is new with 2-column card grid, org-inherited chips, upload modal, Drive connect, and version history drawer.

**Changes made:**
- `knowledge.html` fully rewritten: three tabs (Memory / Notes / Documents) replace prior three tabs (Summary / Auto-memory / Authored). Summary tab removed. Rich-text authoring drawer (640px) added with full toolbar: bold, italic, underline, strikethrough, H2, H3, bullet list, numbered list, link, blockquote, code block — all using document.execCommand. Memory tab: 14 items (3 org-inherited blocks, 5 subaccount blocks, 6 authored entries). Each item shows type chip, inheritance chip, tier badge for blocks, last updated, source/author. Org-inherited items open a locked drawer with "Edit at organisation level" link. Documents tab: 2-column card grid with 4 org-inherited docs and 6 client docs. Doc drawer includes version history collapsible with revert buttons, replace drop zone, and archive action. Upload modal and Connect Drive modal present. Notes tab: 10 auto-extracted note entries plus 2 block proposals with Promote to Memory and Suppress actions, confidence display, and source links preserved.
- `before-knowledge.html` banner updated to describe the 4 source pages being merged and what the new structure adds.
- `index.html` masthead updated to Round 7b-7 with description of Memory/Notes/Documents restructure. Round 7b-7 entry added to round changelog list.

**Frontend-design-principles checks:**
- Start with primary task: yes -- Memory tab default active. Operator's primary task is read and manage what agents know. Tab opens immediately on combined memory list.
- Default to hidden: yes -- no KPI tiles, no metric dashboards. Tier information and inheritance scope are inline chips. Documents tab is behind a tab click.
- One primary action: yes -- Memory tab: "+ New" dropdown (New entry / New block). Notes tab: read-focused, no primary action. Documents tab: "+ Upload document" primary.
- Inline state: yes -- inheritance scope, tier badge, last updated, author all inline on rows. File size and version count inline on doc cards.
- Re-check passed: yes -- a non-technical operator can read an entry, click Edit, author rich-text, and save without technical context. Lock notice on org-inherited items is clear and actionable.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/knowledge.html` (rewritten)
- `prototypes/consolidation-2026-05-06/before-knowledge.html` (banner updated)
- `prototypes/consolidation-2026-05-06/index.html` (masthead 7b-7, changelog entry added)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7b-8 — 2026-05-06
**Operator feedback:** Build org-knowledge.html (org-level Knowledge surface: Memory + Documents tabs, "Used by N workspaces" indicators, per-subaccount inheritance toggles) and before-org-knowledge.html (OrgMemoryPage + scattered doc management in production). Update _sidebar.js, index.html, mockup-log.md.

**Changes made:**
- `org-knowledge.html` created: org-level Knowledge page with two tabs (Memory / Documents). Mode org, active sidebar link org-knowledge.html. Header subtitle "Acme Corp organisation · org-level memory and documents shared across all 4 client workspaces". Primary action dropdown "New entry / New block" (Memory tab), "Upload document + Connect Drive" (Documents tab).
  - Memory tab: 12 items. Tier 1 section (Brand identity, Voice and tone). Tier 2 section (Offer positioning, ICP). Tier 3 section (Compliance, Proof library, Escalation policy). Authored entries section (5 entries: Approved vendors, Standard contracts, Pricing guidelines, Escalation contacts, Communication style guide). Each item: type chip (Entry/Block), tier badge (Tier 1/2/3 with category), "Inherited by N of 4 workspaces" click-to-reveal indicator (amber dot for 3/4, green dot for 4/4).
  - Memory drawer (640px): view mode and edit mode. Edit mode: title input, tier dropdown, full rich-text editor (Bold/Italic/Underline/Strikethrough/H2/H3/bullet/numbered/link/code/quote using document.execCommand). Inheritance panel below editor: 4 subaccount rows (Acme Corp, TerraForm Partners, Revel Group, Globex Industries), each with a toggle switch (default on) and "Override at workspace level" link. Footer: Save / Cancel / Delete. Delete opens confirmation modal with warning text.
  - Documents tab: 2-column card grid with 7 org-level documents (PDF/MD/DOC). Each card: file icon, name, source, size, version count, "Used by N of 4 workspaces" indicator, Edit button, 3-dot overflow (Replace / View inheritance / Archive). Click card opens doc drawer: preview thumbnail placeholder, version history (collapsible), inheritance panel (4 rows with toggles), replace drop zone.
  - Upload modal: drop zone + "Push to all workspaces" toggle (default on). Delete confirmation modal with warning prose.
- `before-org-knowledge.html` created: depicts production state. Banner: "BEFORE: OrgMemoryPage at /org/memory + scattered org-level reference document management. No unified org Knowledge surface." Left half: OrgMemoryPage (flat list of 7 memory blocks, no tier grouping, no type distinction, no "Used by" indicator). Right half: SubaccountKnowledgePage with scope filter toggled to "Organisation" (/workspace/knowledge?scope=org) — shows 4 org documents with no inheritance controls and no usage indicators. Production sidebar (no mode switcher, Memory-only under Knowledge section). Annotation callouts on each half explaining the specific gap. Problems box: 8 annotated issues (no unified view, inheritance invisible, no opt-out, documents second-class, no usage indicator, no rich-text, no authored entries at org scope, no tier grouping).
- `_sidebar.js` updated: org Build section Knowledge item changed from `href: '#', stub: true, stubNote: 'org-knowledge.html in 7b-3'` to `href: 'org-knowledge.html'` (stub removed, link active).
- `index.html` updated: masthead eyebrow changed to "Prototype Round 7b-8", description paragraph updated. Round counter in meta-row updated to 7b-8. Decisions box: new Round 7b-8 bullet. New Round 7b-8 section at bottom with 2 cards (org-knowledge.html + before-org-knowledge.html).

**Frontend-design-principles checks:**
- Start with primary task: yes -- primary task is "manage what all subaccount workspaces inherit". Memory tab default active with the 12 org items immediately visible. No KPI tiles, no monitoring view.
- Default to hidden: yes -- drawer hidden until row click. Inheritance panel inside edit mode (not visible in view mode). "Used by" details (which workspaces) shown via click-to-reveal toast, not always-expanded list. Document drawer hidden until card click.
- One primary action: yes -- Memory tab: "+ New entry" dropdown. Documents tab: "+ Upload document". Drawer: "Save". One primary action per surface.
- Inline state: yes -- "Inherited by N of 4 workspaces" inline on every row (green = all, amber = partial). Tier badge inline. Last updated + author inline. No dashboard or chart needed.
- Re-check passed: yes -- a non-technical org admin can scan the Memory list, see at a glance which items all 4 workspaces use, click a row to edit it, use the rich-text toolbar, toggle a workspace opt-out, and save without technical knowledge.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/org-knowledge.html` (created)
- `prototypes/consolidation-2026-05-06/before-org-knowledge.html` (created)
- `prototypes/consolidation-2026-05-06/_sidebar.js` (org mode Knowledge link: stub removed, href set to org-knowledge.html)
- `prototypes/consolidation-2026-05-06/index.html` (masthead 7b-8, meta round, description, decisions bullet, Round 7b-8 section + 2 cards)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7b-9 — 2026-05-06
**Operator feedback:** Update agent-edit.html Capabilities tab to be inheritance-aware. Three-dot overflow menu must vary by skill tier (System / Org / This client). Add tier chips to each skill row. Wire "+ Add custom skill" to a creation drawer. Add scope breadcrumb above skill list.

**Changes made:**

CSS additions (agent-edit.html inline style block):
- `.tier-chip`, `.tier-system` (slate, lock SVG), `.tier-org` (blue), `.tier-subaccount` (indigo) badge styles
- `.skill-ctx-menu` fixed-position contextual menu with `.ctx-item`, `.ctx-danger`, `.ctx-link`, `.ctx-separator`
- `.skill-scope-bar` breadcrumb/context line at top of Capabilities tab
- `.creator-drawer-overlay` / `.creator-drawer` / `.creator-drawer-header` / `.creator-drawer-body` / `.creator-drawer-footer` 560px skill creation drawer
- `.param-row` / `.param-row-header` / `.param-drag` / `.param-name-input` / `.param-type-select` / `.param-required-toggle` / `.param-delete-btn` / `.param-desc-input` for parameter list
- `.scope-radio-row` / `.scope-label` / `.scope-option` for footer save-scope toggle
- `.icon-picker-grid` / `.icon-option` for icon selection grid in Basic info tab
- `.creator-tab-panel` / `.creator-tab-panel.hidden` for tab switching

Skill tier assignment (14 skills realistically tiered):
- Communication: Send email (System), Read email inbox (System), LinkedIn: post message (Org), SMS: send message (System)
- Data: HubSpot: read contacts (System), HubSpot: create contact (System), Salesforce: read records (Org), Stripe: read payments (System, rate-limited)
- Analysis: Summarise content (System), Extract entities (System), Sentiment analysis (Org, available not enabled)
- Custom: Acme: Outreach scoring rubric (This client), Acme: Lead qualification (This client), Acme: Deal stage mapping (This client)

Scope breadcrumb bar added above toolbar: "Showing skills available to: Outreach Agent in Acme Corp workspace."

Three-dot overflow menu (openCtxMenu(event, tier)):
- System skill menu: View source, Configure for this agent, separator, Disable for this agent, read-only note
- Org skill menu: View source, Configure for this agent, Override locally for this client, separator, Disable for this agent, separator, "Edit at organisation level" link
- This client menu: Edit skill (opens skill-edit-drawer), Configure for this agent, View parameters, separator, Disable for this agent, separator, Delete skill (confirm())
- openCtxMenu() builds menu HTML dynamically, positions fixed below the clicked button using getBoundingClientRect
- closeCtxMenu() on outside click via document click listener + Escape key
- confirmDeleteSkill() fires a confirm() dialog and shows a toast on confirm

Skill creator drawer (openSkillCreator / closeSkillCreator / addCustomSkillDrawer):
- openSkillCreator() / closeSkillCreator() toggle .open class; Escape and overlay-click close
- 4 tabs wired via switchCreatorTab(): Basic info (default), Parameters, Implementation, Test
- Basic info: Name (required), Slug (auto-generated with autoSlug(), edit/lock toggle), Description textarea, Category dropdown, 8-cell icon picker
- Parameters tab: 2 pre-populated example params (prospect_id, context_notes); "+ Add parameter" button appends new param-row; each row has drag handle, name input, type select, required toggle, delete button, description input
- Implementation tab: 3 radio cards (Built-in template, Custom code, External webhook); switchImplType() shows/hides panels; Built-in: template dropdown + showTemplateConfig() config description; Custom code: dark-theme code editor textarea + runtime select; External webhook: URL + auth header + response schema textarea
- Test tab: parameter inputs pre-rendered; "Run test" shows mock JSON result panel
- Footer: scope toggle (This client / Organisation both enabled as mock), Cancel, Save as draft, Save and enable
- saveAndEnableSkill() calls addNewSkillRow(name) which prepends a live row to grp-custom with This client tier badge and checked toggle, then fires showToast()
- showToast() creates a positioned toast div, auto-removes after 2.5s

Index and log updates:
- index.html masthead: eyebrow "Prototype Round 7b-9", description paragraph updated, meta-row round updated to 7b-9
- index.html decisions box: Round 7b-9 bullet added
- index.html: new "Round 7b-9: Capabilities inheritance" section with 1 card linking to agent-edit.html

**Frontend-design-principles checks:**
- Start with primary task: yes -- Capabilities tab opens on the skill list (toggle on/off is the primary task). Tier chips and context menu are secondary signals that only matter when the operator wants to do more than toggle. Breadcrumb context clarifies the scope without blocking the primary flow.
- Default to hidden: yes -- contextual menu is hidden until three-dot click. Creator drawer is hidden until button click. Test result in creator hidden until "Run test". No dashboards or KPI tiles added.
- One primary action: yes -- Capabilities tab primary action remains toggling a skill. Creator drawer primary action is "Save and enable". Context menus are secondary controls.
- Inline state: yes -- tier shown as a chip inline on the skill name (3-5px overhead per row). No separate tier legend panel or aside needed.
- Re-check passed: yes -- a non-technical operator can still toggle any skill on/off without needing to understand tiers. The tier chips and overflow menu are progressive disclosure for when they need more control. The context menu labels are plain English ("View source", "Override locally", "Edit skill", "Delete skill").

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/agent-edit.html` (tier CSS, tier chips on 14 skill rows, scope breadcrumb, openCtxMenu/closeCtxMenu JS, skill creator drawer HTML + switchCreatorTab/autoSlug/selectIcon/addCreatorParam/switchImplType/openSkillCreator/closeSkillCreator/saveAndEnableSkill/saveSkillDraft/addNewSkillRow/showToast JS, Escape key handler extended)
- `prototypes/consolidation-2026-05-06/index.html` (masthead 7b-9, meta round, description, decisions bullet, Round 7b-9 section + card)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7b-10 — 2026-05-06 15:00
**Operator feedback:** Build org-agent-edit.html (org-level agent definition editor) and before-org-agent-edit.html companion. Requirements: 6 tabs (Configure, Behaviour, Capabilities, Schedule, Budget, Deployments), two-tier skill view (System + Org-custom only, no This client tier), Deployments tab with 4-workspace table and row-click drawer, deploy-to-workspaces modal, skill creator locked to Org scope. before state depicts flat AdminAgentEditPage with annotations and problems list.

**Changes made:**
- Created `prototypes/consolidation-2026-05-06/org-agent-edit.html`: Org-level agent definition editor with 6 tabs. Configure tab: name, slug (read-only), description, default model, max context window, greeting/closing templates. Behaviour tab: system role textarea with prompt history (collapsible). Capabilities tab: skill-scope-bar explains org context; two-group toggle list (System skills x8, Org-custom skills x3 with amber icon); filter chips (All 11 / System 8 / Org-custom 3); three-dot menus differ per tier (System: View source, Configure, Disable; Org-custom: Edit, Configure, View, Disable, Delete with inheritance warning). Skill creator drawer scope locked to Organisation with blue chip indicator. Schedule tab: default CRON, timezone, activation window with workspace-override note. Budget tab: default daily and monthly per workspace with org-cap note. Deployments tab: 4-workspace table (Acme Corp Active 2 overrides 3 custom 142 runs, TerraForm Active 0 overrides 89 runs, Revel Customised 5 overrides 1 custom 67 runs, Globex Paused 1 override 12 runs); row-click opens 520px drawer with workspace summary, side-by-side override comparison (Org value vs Workspace override with blue changed highlight), custom skills list, recent runs table, view workspace agent edit link, force re-sync and pause/resume buttons. Deploy to additional workspaces modal with workspace checklist (4 already-deployed grayed out, 2 new options). Page header: h1 + status badge + "Org-level definition - Deployed to 4 of 4 workspaces" subtitle. Org propagation banner in blue. Sidebar mode = org, activeHref = org-agent-edit.html.
- Created `prototypes/consolidation-2026-05-06/before-org-agent-edit.html`: Simulated flat production AdminAgentEditPage. Includes: amber BEFORE banner with route reference, simulated production sidebar (11 flat items, no section grouping, no org-level indicator), breadcrumb, flat form (name, slug, description, model, status, system role all on one card), skills picker with no tier chips (5 rows, no source indicator), schedule inline (no default/override framing), budget inline (no per-workspace context), submit buttons. Annotations on 4 sections. Problems box with 8 items covering: no org-level identity, no workspace visibility, no override visibility, no skill tiers, no deployments view, mixed schedule/budget framing, no deploy action on page, no shared state between org and workspace editing.
- Updated `prototypes/consolidation-2026-05-06/_sidebar.js`: Org mode Build section Agents link changed from stub to `org-agent-edit.html`.
- Updated `prototypes/consolidation-2026-05-06/index.html`: masthead updated to Round 7b-10, description updated, files count updated, new decisions bullet added, new Org Agent Edit card added in Primitive consolidation section (between Agent Edit and Run Trace).
- Appended this entry to `tasks/builds/consolidation-2026-05-06/mockup-log.md`.

**Frontend-design-principles checks:**
- Start with primary task: yes -- Primary task is "configure the org-level agent definition". Page opens on Configure tab. Deployments tab is secondary and requires a click to reach.
- Default to hidden: yes -- No KPI tiles. Override counts shown inline as numbers, not a separate dashboard. Drawer hides detail until the admin deliberately clicks a workspace row.
- One primary action: yes -- Save changes is the sole primary action (dirty state only). Deployments tab has "Deploy to additional workspaces" as its one action.
- Inline state: yes -- Status badge inline in breadcrumb. "Deployed to 4 of 4 workspaces" subtitle is inline on the page. Workspace status (Active/Paused/Customised) shown as inline badge in the table, not a separate status page.
- Re-check passed: yes -- An org admin landing on this page knows immediately: (a) this is the org-level definition, (b) 4 workspaces use it, (c) they can edit and save or go to Deployments to review overrides first.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/org-agent-edit.html` (created)
- `prototypes/consolidation-2026-05-06/before-org-agent-edit.html` (created)
- `prototypes/consolidation-2026-05-06/_sidebar.js` (Org Build Agents link updated)
- `prototypes/consolidation-2026-05-06/index.html` (masthead, decisions, card added)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7c — 2026-05-06

**Operator feedback:** Two small permission-state demos. (1) Sidebar mode switcher: add a "Demo: viewing as" dropdown above the pill row to simulate System admin / Org admin / Workspace operator profiles, gating which mode pills render. (2) Skill creator drawer in agent-edit.html: add a collapsible "Demo controls" section above the footer, with Org admin vs Workspace user states that disable the Organisation scope radio when set to Workspace user.

**Changes made:**

Change 1 (_sidebar.js mode switcher permission demo):
- Added `DEMO_PROFILE_MODES` map: `system-admin` allows all three modes, `org-admin` allows workspace + org, `workspace-operator` allows workspace only.
- Added `getDemoProfile()` helper reading `localStorage['prototype.sidebar.demoProfile']` (default `'system-admin'`).
- Added `buildDemoProfileSelector(mode, activeHref)`: renders a small `<label> + <select>` above the pill row. Three options: "System admin" (default), "Org admin", "Workspace operator". On change, saves profile to localStorage, resolves whether current mode is still allowed (falls back to workspace if not), and calls `renderSidebar(nextMode, activeHref, newProfile)`.
- Updated `buildModeSwitcher(mode, activeHref, demoProfile)`: now accepts `demoProfile` parameter; filters pill list to only the allowed modes for that profile; returns `null` (no element) when only one mode is allowed (Workspace operator case) so the pill row is hidden entirely.
- Updated `renderSidebar(mode, activeHref, demoProfile)` signature to accept third parameter; resolves profile from param > localStorage > default; validates mode against profile's allowed list (falls back to workspace if incompatible); calls `buildDemoProfileSelector` before `buildModeSwitcher`.
- A muted note below the dropdown: "Production hides modes a user has no permission to access."
- Profile persists in `localStorage` under key `prototype.sidebar.demoProfile`.
- Updated comment block at top of file documenting Round 7c additions.

Change 2 (agent-edit.html skill creator scope toggle demo):
- Added `.scope-disabled` CSS class: `opacity:0.45`, `cursor:not-allowed`, `color:var(--slate-400)`. Applied via JS to the Organisation scope label when Workspace user profile is active.
- Added collapsible "Demo controls" panel in HTML between `/creator-drawer-body` and `creator-drawer-footer`: a toggle button (caret icon + "Demo controls" label), collapsed by default, containing two radio inputs: "Org admin" (default, checked) and "Workspace user".
- Wired `toggleCreatorDemoControls()` JS function: toggles `creator-demo-inner` visibility and rotates the caret icon.
- Wired `applyCreatorScopeDemo(profile)` JS function: when `'workspace-user'` is selected, adds `.scope-disabled` to `scope-org-label`, sets `orgRadio.disabled = true`, force-checks the client radio, shows the lock icon SVG next to "Organisation" label, hides the radio row, and shows the static `creator-scope-static` div ("Saved to: This client"). When `'org-admin'` is selected, reverses all of the above.
- Added lock icon SVG inline in `scope-org-label`: `display:none` by default, shown when profile is workspace-user.
- Added `id="scope-org-label"`, `id="scope-client-radio"`, `id="scope-org-radio"`, `id="scope-org-lock-icon"`, `id="creator-scope-row"`, `id="creator-scope-static"` attributes to the relevant elements for reliable JS targeting.
- The `title` attribute on `scope-org-label` is set to "Requires org admin permission to save skills at the organisation level" when workspace-user is active (acts as browser tooltip on hover/focus).
- Demo controls section background is `#f8fafc` (slate-50) with `border-top:1px solid var(--slate-100)` to separate it from the drawer body without adding visual weight.
- State is in-session only (no localStorage persistence). Default is always "Org admin" on drawer open.

index.html:
- Masthead eyebrow changed from "Prototype Round 7b-11 - 7b chain COMPLETE" to "Prototype Round 7c".
- Masthead description paragraph updated to describe both permission demos.
- Meta-row Round field updated to "7c".
- Decisions box: Round 7c bullet added.
- New "Round 7c: Permission demos" section added at bottom with two cards (sidebar demo and skill creator scope demo, both in cyan/teal accent color to distinguish from prior rounds).

**Frontend-design-principles checks:**
- Start with primary task: yes -- the demo toggles are purely secondary controls for prototype review; they do not appear on the primary task path. The demo selector sits above the mode switcher (not blocking nav). The "Demo controls" in the drawer are collapsed by default and placed outside the primary task flow (above the footer).
- Default to hidden: yes -- demo controls in the drawer are collapsed by default. The demo profile selector is visible but small (two lines, muted typography). No new dashboards or KPI tiles introduced.
- One primary action: yes -- no change to any primary action. Sidebar primary action remains clicking a nav item. Skill creator primary action remains "Save and enable".
- Inline state: yes -- the disabled Organisation scope is shown inline on the existing radio label (greyed opacity + lock icon). No separate panel or explanation box required beyond the existing drawer context.
- Re-check passed: yes -- a non-technical operator reviewing the prototype sees the demos as contextual prototype aids, not as confusing UI elements. The muted note "Production hides modes a user has no permission to access" is concise and plain.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/_sidebar.js` (demoProfile system: DEMO_PROFILE_MODES, getDemoProfile, buildDemoProfileSelector, updated buildModeSwitcher + renderSidebar signatures, updated header comment)
- `prototypes/consolidation-2026-05-06/agent-edit.html` (scope-disabled CSS, demo controls HTML panel, lock icon SVG, applyCreatorScopeDemo + toggleCreatorDemoControls JS, id attributes on scope elements)
- `prototypes/consolidation-2026-05-06/index.html` (masthead, meta-row, decisions bullet, Round 7c section with two cards)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7b-11 — 2026-05-06 (FINAL round of 7b chain)

**Operator feedback:** Build project-edit.html (AFTER: Goals retired, per-project Objective field added) and before-project-edit.html (BEFORE: no Objective field, separate GoalsPage). Decision (a) approved: retire Goals tree, add projects.objective field. Goals were never read by agent execution code (zero hits in server/services/agent*/). Objective IS read at runtime. Subaccount-level strategy lives in Memory blocks.

**Changes made:**
- Created `prototypes/consolidation-2026-05-06/project-edit.html`: Single-page project edit form. Five sections: (1) Identity: name, 5-color swatch picker + custom color, description textarea, status dropdown. (2) Objective (NEW, indigo-accented header with "NEW" badge): blue helper band explaining agent runtime injection, large textarea (15px font, light indigo background), word/character counter with warn state at 220+ chars, tip about brevity, expandable "Show example objectives" with 4 click-to-use example objectives. (3) Project management: target date, budget with $ prefix formatting, warning threshold slider (50-95, default 75) with live % display. (4) Linked resources: repo URL with GitHub picker button, linked agent chips (Outreach Agent/Lead Qualifier/Demo Scheduler) each linking to agent-edit.html, Add agent button. (5) Migration notice card (blue info card): "Migrated from Goals" - shows once for projects that had a goal_id. Sticky footer with Save/Discard/Delete. Dirty-state topbar indicator shows unsaved changes dot + Save/Discard buttons when form is modified. Sidebar mode = workspace, activeHref = project-edit.html (page reached from list, not nav item).
- Created `prototypes/consolidation-2026-05-06/before-project-edit.html`: Split-panel before state. Left panel: existing project edit page at /projects/:id/edit with no Objective field. Sections: Identity (name, description only - no color swatch, no signposting), goalId dropdown (sets projects.goalId metadata but does NOT push goal text to agents, annotated), project management (budget in cents, no $ formatting), linked resources. Amber annotation boxes inline on 2 sections. Right panel: GoalsPage (/admin/subaccounts/:id/goals). Full OKR tree: Mission 1 "Become the leading agent-OS for mid-market..." > Objective 1.1 "Q1 Outreach Campaign" (linked-to-project badge) > Key Results (30 qualified meetings 8/30, 5 closed deals 1/5) > Objective 1.2 "Customer success scaling" > Key Results. Mission 2 collapsed stub. Amber "zero hits in server/services/agent*/" badge at top. 4-item annotations panel. Problems-with-current-state footer listing 6 gaps. "After" link to project-edit.html.
- Updated `prototypes/consolidation-2026-05-06/index.html`: masthead updated to "Round 7b-11 - 7b chain COMPLETE", description updated, files count to 54+, new decisions bullet for 7b-11, new Round 7b-11 section card pair (project-edit.html + before-project-edit.html) added.
- Verified `prototypes/consolidation-2026-05-06/_sidebar.js`: Goals already absent from workspace mode (removed in 7b-1). No changes needed.

**Frontend-design-principles checks:**
- Start with primary task: yes -- Primary task is "set a focused objective so agents know what this project is trying to achieve". Page opens directly on the form, Objective section is section 2 (immediately visible after Identity). No dashboards, no tabs needed.
- Default to hidden: yes -- Example objectives are behind a click-to-expand. Migration notice card is a compact info band, not a full panel. No KPI tiles, no run history, no cost panels.
- One primary action: yes -- "Save changes" is the sole primary action. Discard and Delete are clearly secondary/destructive. Dirty-state CTA in topbar mirrors footer to reduce scroll friction.
- Inline state: yes -- Character count inline below textarea. Dirty indicator inline in topbar. Migration notice is inline context, not a separate page or modal.
- Re-check passed: yes -- A non-technical operator landing on this page sees: project name at top, Objective section clearly labelled with helper text explaining why it matters, example objectives to get started. No overwhelming panels. The form is scannable and the Save is obvious.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/project-edit.html` (created)
- `prototypes/consolidation-2026-05-06/before-project-edit.html` (created)
- `prototypes/consolidation-2026-05-06/index.html` (masthead, decisions bullet, 7b-11 section added, chain marked complete)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7d — 2026-05-06

**Operator feedback:** Knowledge structure leaks schema concepts (memory blocks, suppression, promotion) into the UI in ways operators cannot decode. Round 7d: drop all schema-verb language from knowledge.html, org-knowledge.html, inbox.html, and before-* pages. Apply locked mental model and inheritance visibility model.

**Terminology decisions (Round 7d):**
- "blocks" removed from UI (schema concept only)
- "promote" replaced by "Approve as authored" or "Edit and approve"
- "suppress" replaced by "Reject" or "Ignore"
- "re-add" replaced by "Track again"
- "re-suppress" replaced by "Keep ignoring"
- "Notes" tab replaced by "Auto-memory" (Authored memory is its own tab now)
- "Suppressed memory" inbox item type renamed "Memory update"
- New terms introduced: "Pending review", "Suggested grouping", "Track again", "Keep ignoring", "Ignored memories"
- "Review queue" becomes a filter chip within each tab (not a separate page)

**Changes made:**

knowledge.html (full rebuild):
- Top-level tabs: Authored memory (default) / Auto-memory / Documents
- Authored memory: filter chips (All / Pending review / Tier 1 / Tier 2 / Tier 3 / Inherited for admins). 8 active entries, 2 pending-review entries (amber left-border, Approve / Edit and approve / Reject actions). 3 org-inherited entries (hidden for workspace operators, shown with "Admin view" purple chip + tooltip + lock-icon "Edit at org level" for org/system admins). All wired to demo profile selector.
- Auto-memory: filter chips (All / Pending review / Suggested groupings / Inherited). No "+ New" button (system-generated). 2 suggested grouping cards (indigo-bg, bullet list of observations, Approve grouping / Edit and approve / Reject). 8 pending individual entries with type chip + confidence bar. 2 approved entries with "In use" chip and "Edit and take ownership" overflow action.
- Documents tab: sub-tab strip (Documents / Bundles). Documents sub-tab: 8 subaccount docs + 4 inherited (admin-only, violet-bg). Bundles sub-tab: 4 bundle cards with utilization per model family, drawer with member list, attached agents, cached context impact. "+ New bundle" primary button opens modal.
- "Ignored memories (12)" link in page header opens drawer (was "Suppressed (12)"). Drawer renamed "Ignored memories". Body copy: "Memories you removed. Agents won't track these unless you add them back." 5 example rows each with "Track again" (primary) and "Keep ignoring" (outlined) buttons.
- "New entry" drawer: execCommand rich-text editor + tier dropdown.
- Profile-aware JS: applyProfileToKnowledge() shows/hides admin-view entries and Inherited filter chip based on localStorage profile.

org-knowledge.html (full rebuild):
- Same three-tab structure (Authored memory / Auto-memory / Documents).
- No inheritance chips (this IS the source). "Used by N of 4 workspaces" indicator on every item (replaces old Inheritance panel from 7b-8).
- 6 authored entries with Used-by chips. 4 auto-memory entries (2 pending with "Would propagate to N workspaces" chip, 2 approved). 8 documents + 3 bundles, all with Used-by chips.
- New entry drawer adds "Share with workspaces" selector.
- Org notice bar explains propagation behavior.

inbox.html (3 item edits + drawer edit):
- Item 1 title: "Memory update: Acme Corp prospect". Body: plain-English question format ("CRM Agent flagged...Should I track this again?"). Buttons: Track again / Keep ignoring. Keyboard hint: "T to track · K to keep ignoring".
- Item 2 title: "Memory update: H2 2026 budget review". Same plain-English format.
- Item 3 title: "Memory update: Acme Corp primary contact". Same format.
- Item type chip: "Memory update" (was "Suppressed memory").
- Drawer title: "Memory update: Acme Corp prospect". Section labels: "Note you removed" / "New evidence". Footer: "Keep ignoring" / "Track again".

before-knowledge.html: banner updated to note Round 7d scope + 5-point problems list including schema-verb leak.

before-org-knowledge.html: Round 7d note added: OrgMemoryPage used "block" terminology; all schema verbs replaced in Round 7d rebuild.

index.html: masthead eyebrow Round 7c -> 7d. Description updated. 4 new decisions box entries covering terminology rebuild, suggested groupings, inheritance visibility model, and inbox Memory update items. Knowledge card description updated. org-knowledge card description updated.

**Frontend-design-principles checks:**
- Start with primary task: yes -- knowledge.html opens on Authored memory (the operator's primary task: manage what agents know). Auto-memory and Documents are secondary tabs. Pending review is a filter chip, not a leading state.
- Default to hidden: yes -- inherited items hidden for workspace operators (not relevant to their context). Suggested groupings surfaced in Auto-memory but not as a default view. Confidence bars visible inline but small. No KPI tiles added.
- One primary action: yes -- Authored memory: "+ New entry". Auto-memory: no primary action (system-generated). Documents: "+ Upload" or "+ New bundle" per sub-tab. Ignored memories: "Track again" per row.
- Inline state: yes -- pending status shown as amber chip and left-border on card. Approved shown as "In use" chip. Admin-inherited shown as purple "Admin view" chip. No separate status dashboard.
- Re-check passed: yes -- workspace operator sees only their workspace items, no confusing inherited noise. Admin sees inherited items clearly tagged and separated. "Track again / Keep ignoring" replaces the schema-verb pair. A non-technical operator can read "Memory update: Acme Corp prospect" and understand what to do without a glossary.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/knowledge.html` (full rebuild)
- `prototypes/consolidation-2026-05-06/org-knowledge.html` (full rebuild)
- `prototypes/consolidation-2026-05-06/inbox.html` (3 item edits + drawer edit)
- `prototypes/consolidation-2026-05-06/before-knowledge.html` (banner update)
- `prototypes/consolidation-2026-05-06/before-org-knowledge.html` (banner update)
- `prototypes/consolidation-2026-05-06/index.html` (metadata, decisions, card descriptions)

## Round 7e-1a — 2026-05-06 (agent-edit Skills + Data sources split)

**Operator feedback:** Replace the single "Capabilities" tab with two top-level tabs: Skills and Data sources. Tab strip becomes: Configure, Behaviour, Skills, Data sources, Schedule, Budget, Runs.

**Changes made:**
- Tab strip updated: removed "Capabilities" button, added "Skills" (count 7) and "Data sources" (count 6) buttons
- Removed `tab-capabilities` panel entirely
- Added `tab-skills` panel with two sections:
  - Section 1 "Enabled skills (7)": compact flat rows with tier chip (System/Org/This client) leading each row, toggle, 3-dot overflow, row click opens existing skill detail drawer; 7 mock skills: Send email, Read email inbox, HubSpot: read contacts, LinkedIn: post message, Sentiment analysis, Acme: Outreach scoring rubric, Acme: Lead qualification
  - Section 2 "Add skills": search input + filter chips (All 247 / System 180 / Organisation 15 / This client 3 / Custom only 18) + live search via filterSkillLibrary(); results grouped in collapsible sections: System (15 visible + "Show all 180" link), Organisation (5 skills), This client (2 not-yet-enabled skills); each row has tier chip + icon + name + desc + "Add" button that animates row into enabled section; "+ Add custom skill" primary button in section header opens existing creator drawer
- Added `tab-datasources` panel with two sections:
  - Section 1 "Enabled data sources (6)": rows with type-coloured icon (blue=doc, violet=memory, purple=bundle, green=live), name, tier chip, inline description with sync status, toggle; 6 mock sources: Acme Inc Brand Guide, Voice and Tone Standards, Demo collateral Q1 2026, Acme HubSpot CRM, Acme: Outreach scoring rubric, Acme: ICP profile
  - Section 2 "Add data sources": search + filter chips (All/Memory/Documents/Bundles/Live integrations) + "+ Add source" dropdown button (New memory block / Upload document / Connect data source); 14 available source rows across all types
- Added `ds-drawer` element: type-specific drawer with 4 content variants (doc/memory/bundle/live); memory shows content preview + "Edit in Knowledge" link; doc shows file metadata + "View full document" link; bundle shows member document list; live shows connection details + "Configure connection in Integrations" link
- Updated JS: added filterSkillLibrary(), setSkillLibFilter(), addSkillToEnabled(), openDsDrawer(), filterDsSources(), setDsFilter(), addDsToEnabled(), toggleDsAddMenu(), closeDsAddMenu(); updated Escape key handler to include ds-drawer; updated addNewSkillRow() to insert into new enabled skills list (grp-custom no longer exists)
- Updated HTML comment block at top of file to reflect 7e-1a IA change

**Frontend-design-principles checks:**
- Start with primary task: yes — Skills tab opens on the enabled skills list (the active kit), not the library. Operator sees what this agent can do, then can search the library to add more.
- Default to hidden: yes — 247-skill library is search-driven; results are collapsed by tier group; "Show all 180 system skills" link defers the long tail. Data sources section uses search + filter; no dashboards or utilization charts visible by default.
- One primary action: yes — Skills tab primary action is managing enabled skills (toggle on/off); library search is secondary. Data sources tab primary action is enabling/disabling attached sources.
- Inline state: yes — Each skill row shows tier, toggle state, and description inline. Each data source row shows type icon, sync status, and attachment mode inline.
- Re-check passed: yes — A non-technical operator can quickly see which skills are on, toggle them, and search the library. Data sources are visually distinct from skills (dedicated tab). No overwhelming dashboards.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/agent-edit.html` (tab strip + two new tab panels + DS drawer + JS updates)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7e-1b — 2026-05-06 (org-agent-edit Skills + Data sources split)

**Operator feedback:** Apply the same Capabilities-to-Skills+Data-sources restructure to org-agent-edit.html. The org-level editor should mirror the workspace editor's IA but with a two-tier view only (System + Organisation; no This client tier at org level).

**Design rationale:** The Capabilities tab failed on two counts: discoverability and scalability. "Capabilities" is jargon — operators do not know what the tab groups until they have opened it. More critically, a single flat tab cannot scale to 200+ skills without becoming a scroll-marathon. Separating Skills and Data sources into two top-level tabs gives each surface a clear primary task (enable/disable skills; attach/configure data sources), and makes the search-driven library structure legible. At org level the split also makes the two-tier inheritance model (System built-ins vs Org-custom additions) obvious from the filter chips, rather than invisible in a flat list. "Skills" and "Data sources" are self-describing labels; "Capabilities" was not.

**Changes made:**
- Tab strip updated: removed "Capabilities" button, added "Skills" (count 5) and "Data sources" (count 4) buttons. Tab order: Configure, Behaviour, Skills, Data sources, Schedule, Budget, Deployments.
- `tab-capabilities` panel removed.
- Added `tab-skills` panel with two sections:
  - Section 1 "Enabled skills (5)": compact flat rows with tier chip (System/Org) leading each row, toggle, 3-dot overflow. Filter chips: All 5 / System 4 / Org-custom 1. No "This client" filter chip (not applicable at org level). 5 mock skills: Send email (System), Read email inbox (System), HubSpot: read contacts (System), LinkedIn: post message (System), Acme: Outreach scoring rubric (Org).
  - Section 2 "Add skills": search input + filter chips (All 195 / System 180 / Organisation 15) + live search; results grouped in collapsible sections: System (15 visible + "Show all 180" link), Organisation (5 skills); each row has tier chip + icon + name + desc + "Add" button. "+ Add custom skill" button opens skill creator drawer locked to Org scope.
- Added `tab-datasources` panel with two sections:
  - Section 1 "Enabled data sources (4)": rows with type-coloured icon, name, tier chip, inline description with sync status, toggle. 4 mock sources: Org Brand Guide (doc, Org tier), Voice and Tone Standards (doc, Org tier), Org HubSpot CRM (live, System tier), Org ICP profile (memory, Org tier).
  - Section 2 "Add data sources": search + filter chips (All/Memory/Documents/Bundles/Live integrations) + Add source dropdown. 10 available source rows across types.
- DS drawer preserved with type-specific content variants.
- Updated JS: filterSkillLibrary(), setSkillLibFilter(), addSkillToEnabled(), openDsDrawer(), filterDsSources(), setDsFilter(), addDsToEnabled() wired in org-agent-edit.html context.
- Updated file header comment to note 7e-1b IA change.

**Frontend-design-principles checks:**
- Start with primary task: yes — Skills tab opens on the enabled skills list. Primary task at org level is "confirm which skills this template provides to all workspaces". Data sources tab is behind a tab click.
- Default to hidden: yes — 195-skill library is search-driven; results collapsed by tier; "Show all 180" defers the long tail. No utilization dashboards or KPI tiles added.
- One primary action: yes — Skills tab: toggle or add a skill. Data sources tab: toggle or add a source. Deployments tab unchanged.
- Inline state: yes — tier chip inline on every skill row. Toggle state visible without clicking. Data source sync status inline.
- Re-check passed: yes — an org admin can see at a glance which System and Org-custom skills are enabled, search the library, and add a data source, without the old Capabilities tab's scroll-marathon or jargon barrier.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/org-agent-edit.html` (tab strip + two new tab panels + DS drawer + JS updates)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7e-1c — 2026-05-06 (before-state and index updates)

**Operator feedback:** Update before-agent-edit.html and before-org-agent-edit.html to document the discoverability and IA gaps that the 7e-1a/7e-1b restructure fixes. Update index.html masthead, card descriptions, and decisions box to reflect the Skills + Data sources IA change.

**Design rationale (consolidated):** The Capabilities tab was retired because it failed on three independent dimensions: labelling ("Capabilities" is jargon; "Skills" and "Data sources" are self-describing), scalability (a flat single-tab toggle list cannot grow past ~20 skills before it requires a scroll-marathon; the new search-driven structure scales to 200+), and information hierarchy (data sources were buried below the skill list and frequently missed entirely). The IA split also makes tier inheritance legible for the first time: the filter chips (System / Organisation / This client) give operators a one-click lens into which skills came from the platform, which from the org, and which are workspace-specific — something that was entirely invisible in the flat Capabilities list.

**Changes made:**

before-agent-edit.html:
- Banner text augmented: BEFORE note now states the single Capabilities tab lumped skills and data sources together; 14-row flat list does not scale; data sources cramped below, often invisible; tier inheritance was implicit and not surfaced.
- Capabilities tab mockup (second panel) updated: now shows a realistic 14-row flat toggle list (all 14 mock skills from the 7b-9 tier assignment) with data sources section cramped below annotated as "scroll to see" with amber section header and explanatory note.
- Problems-with-current-state box added at bottom of page (6 items): single tab cannot scale beyond ~20 skills; data sources often missed; no search across 200+ skill library; tier inheritance not visible per-row; "Capabilities" is jargon; no live filter.

before-org-agent-edit.html:
- Banner text augmented: added a Capabilities IA gap paragraph explaining that AdminAgentEditPage org-level used the same single Capabilities tab; no two-tier filter (System / Org-custom); operator could not tell platform skills from org-custom skills; data sources buried; no search.
- Skills picker annotation updated to note the flat tier problem and the absence of a System / Org-custom filter at org level.
- Problems-with-current-state list expanded: added three new items covering single Capabilities tab scalability failure, data sources missed at bottom, and no search across 200+ skills.

index.html:
- Masthead eyebrow updated from "Round 7d" to "Round 7e-1c".
- Masthead description paragraph updated to explain Capabilities tab retirement and Skills + Data sources restructure on both surfaces.
- Meta-row Round field updated to "7e-1c".
- Agent Edit card description updated: references Round 7e-1a; describes new tab strip (Configure, Behaviour, Skills, Data sources, Schedule, Budget, Runs); mentions search-driven Skills tab scaling to 200+; mentions type-coloured Data sources tab rows.
- Org Agent Edit card description updated: references Round 7e-1b; describes same restructure with two-tier System + Organisation view; notes no This client tier at org level.
- Decisions box: Round 7e-1 bullet added covering Capabilities retirement rationale, new tab structure on both surfaces, and before-page updates.

**Frontend-design-principles checks:**
- Start with primary task: yes — before pages are faithful depictions of prior state with problem annotations; no primary task design decisions.
- Default to hidden: yes — no new panels or dashboards introduced. Problems boxes are additive annotations, not UI surfaces.
- One primary action: yes — before pages have no primary actions (reference only).
- Inline state: yes — problems annotated inline on the before mockups.
- Re-check passed: yes — a non-technical operator reviewing the before/after pair can immediately see what changed and why. Before pages show the cramped Capabilities tab; after pages show the split Skills and Data sources tabs.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/before-agent-edit.html` (banner augmented, Capabilities tab mockup updated to 14-row flat list + cramped data sources, problems box added)
- `prototypes/consolidation-2026-05-06/before-org-agent-edit.html` (banner augmented with Capabilities IA gap paragraph, skills annotation updated, problems list expanded)
- `prototypes/consolidation-2026-05-06/index.html` (masthead Round 7e-1c, description updated, meta-row, agent-edit card desc, org-agent-edit card desc, decisions box Round 7e-1 bullet)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7e-1d — 2026-05-06

**Operator feedback:** Make agents.html mode-aware so it morphs between Workspace / Organisation / System views. Three explicit preview URLs in index.html for side-by-side review.

**Changes made:**
- `agents.html` fully rewritten with mode-aware rendering. `getActiveView()` reads `?view=` URL param first (wins), then falls back to `prototype.sidebar.demoProfile` in localStorage. URL param also writes localStorage to keep sidebar profile in sync. `renderAgentsForView(view)` re-renders the entire page body including subtitle, banner, table columns, mock data, filter pills, action handlers, and topbar buttons.
- Workspace view: 12 agents for Acme Corp. Columns: Agent / Status / Last run / Tags / Actions. Live pill (3 running). Local Notes Agent has a "Local" amber chip. Outreach Manager, CSM Manager, Orchestrator have tier chips. CRM Sync shows Failed state with Fix button. Vacation Coverage Agent is Draft. New agent modal offers "Deploy from library" (default) or "Create workspace-only". Org chart link visible.
- Organisation view: 7 org-level templates. Columns: Agent / Deployment status / Total runs (30d) / Tags / Actions. Deployment status shows full/partial/customised variants with colour coding. Deploy button opens workspace picker modal. Org chart link visible.
- System view: 23 system catalogue agents. Columns: Agent / Status / Total platform runs / Adoption / Actions. Status uses Published/Beta/Draft/Deprecated badges. Adoption shows inline bar + "N orgs / pct in use" text. "Drill into org" opens org picker modal which sets demo profile to org-admin and reloads. Org chart link hidden (not applicable at system level).
- `AGENTS_BY_VIEW` data object contains all three keyed data sets with realistic mock values.
- Storage event listener re-renders when sidebar demo profile selector changes in another tab.
- View mode indicator strip at top of page body shows current view context and quick-switch links to the other two views.
- `index.html` Agents card updated: description rewritten to explain mode-aware single file, three colour-coded preview links (workspace/org/system), side-by-side note, "Before" link retained.

**Frontend-design-principles checks:**
- Start with primary task: yes -- each view opens on the user's primary task. Workspace operator: see and act on deployed agents. Org admin: see deployment coverage and manage templates. System admin: see catalogue status and adoption.
- Default to hidden: yes -- no KPI tiles, no run history panels, no aggregated cost views. Adoption bar in system view is load-bearing (system admin's primary task includes understanding usage). Filter counts are inline, not a dashboard row.
- One primary action: yes -- each view has one primary action: Workspace "New agent" (opens modal), Org "New template", System "New system agent". Deploy and Drill are secondary row-level actions.
- Inline state: yes -- running state is a dot + time inline on each row. Deployment coverage is a single text string per row. Adoption is an inline bar + number, not a separate panel.
- Re-check passed: yes -- workspace operator can see agent health and trigger a run in one click. Org admin can see which templates need wider deployment at a glance. System admin can identify low-adoption or beta agents and drill into context.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/agents.html` (full rewrite)
- `prototypes/consolidation-2026-05-06/index.html` (Agents card updated with three preview links)

## Round 7e-2 — 2026-05-06 17:00

**Operator feedback:** Four targeted changes: (1) calendar header nav conventionality, (2) run-trace timestamp clarity, (3) retire Triggers tab from Automations, (4) add Recent runs + Recent activity list cards to home.

**Changes made:**

- `calendar.html` header restructured: split controls row into two clusters. Left nav cluster: Today button (muted/cursor:default when offset=0, full button when offset!=0) + prev arrow (32x32px) + period label (16px/600) + next arrow. Right view switcher: Week/Fortnight/Month pill group on slate-100 background. Period label en-dash updated in computePeriodLabel JS. renderPeriod() updated to apply muted vs active Today button states.
- `run-trace.html` timestamps updated: run header now shows "Outreach Agent -- Run #4827" title, two metadata lines: "Started: May 6 2026, 2:14:32 PM · 5 minutes ago" and "Duration: 5 min 32 sec | Status: Running | 47 events". Chain sidebar run times changed from "0:42" to "+5m 32s" format. All 8 event rows use +Xs/+Xm Xs format (e.g., +0s, +3s, +4s, +6s, +9s, +18s, +19s, +28s, +5m 32s). Event detail panel updated to three-line format: event index + type, absolute timestamp (2:15:14 PM, May 6 2026), time-into-run + ago (via JS helpers formatAbsTimestamp and timeAgoFromIso).
- `automations.html` Triggers tab removed: tab strip reduced to Workflows / External (2 tabs). Subtitle count updated to remove "8 triggers". Triggers panel content commented out. Footer note added: "Triggers and scheduled tasks are managed on the Recurring tasks page →" with stub link. switchTab JS updated to only iterate [workflows, automations]. openNewDrawer JS updated to remove triggers case.
- `home.html` two list cards added below widget-grid inside home-main, in a 50/50 grid row (list-card-row). Left: "Recent runs" -- 10 rows with status dot, agent name, subaccount badge (4 clients color-coded), status word, duration, time-ago; mix of 6 completed/1 running/2 failed/1 cancelled; click row opens run-trace.html; footer link. Right: "Recent activity" -- 10 rows with type icon, subject, actor/context, time-ago; types: agent_run completed, memory block updated, skill enabled, integration synced, document uploaded, inbox resolved, agent_run failed, memory proposal, workflow completed, identity event; click row opens activity.html; footer link. CSS added for list-card, list-card-row, run-list-row, act-list-row, sub-badge, act-icon.

**Frontend-design-principles checks:**
- Start with primary task: yes -- all four changes serve the operator's primary task: calendar nav serves "see what's scheduled this week"; run-trace timestamps serve "understand when this event happened"; automations cleanup serves "find my workflows without clutter"; home list cards serve "see what just happened across my system"
- Default to hidden: yes -- no new KPI tiles, no dashboard panels. List cards show raw lists, no aggregated metrics. Spend/diagnostics remain deferred.
- One primary action: yes -- home primary action remains "New agent". Calendar primary action remains the view (not the nav). Run-trace primary action remains "select event to inspect".
- Inline state: yes -- run status is an inline dot + status word. Activity types are color-coded icons inline. Subaccount is an inline badge. No separate status panel.
- Re-check passed: yes -- a non-technical operator landing on home can see the 10 most recent runs and activity items in a single glance without navigating. Calendar nav follows Google Calendar / Outlook convention so it requires zero learning. Run timestamps are unambiguous (absolute + relative).

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/calendar.html` (header restructured)
- `prototypes/consolidation-2026-05-06/run-trace.html` (timestamp formats)
- `prototypes/consolidation-2026-05-06/automations.html` (Triggers tab removed)
- `prototypes/consolidation-2026-05-06/home.html` (Recent runs + Recent activity added)

## Round 7e-3 -- 2026-05-06

**Operator feedback:** Build a unified "Recurring tasks" surface consolidating scheduled_tasks (RRULE-based) and agent_triggers (event-based) schemas. Both are a rule that fires an agent; only the fire condition differs. Add before companion, update sidebar, update index.

**Changes made:**
- `recurring-tasks.html` created: unified 17-task table with fire condition badges (Schedule-fired 8, Event-fired 6, Manual 3). Filter chips: All / Schedule-fired / Event-fired / Manual / Active / Paused / Error. Columns: Name, Fire condition (badge + detail sub-line), Action (agent + optional pinned workflow chip), Status (Active/Paused/Error with inline error note), Last fired, Fires/30d, Next fire, overflow actions. Row click opens 560px drawer. Drawer tabs: Configure (fire condition radio cards swap between RRULE scheduler, event type/filter, manual run-now panel; Action section: agent, pinned workflow, brief textarea; Retry policy; Token budget; Status toggle), History (last 30 fires table with run ID links to run-trace.html, status, duration, cost), Test (test-fire button, sample event payload editor for event tasks, result panel). "+ New recurring task" modal with name, fire condition, agent, and "Create and configure" button that opens the drawer.
- `before-recurring-tasks.html` created: side-by-side split layout. Left: ScheduledTasksPage at /admin/subaccounts/:id/scheduled-tasks with 6 scheduled tasks, RRULE column, amber annotation "Only schedule-based fires". Right: TriggersPage at /admin/subaccounts/:id/triggers with 5 event triggers, event type and filter columns, amber annotation "Only event-based fires; cannot pin workflow; no run-now". Route notes with source file and schema name. Eight-item problems box covering: conceptual split, mental model, mid-flow context switch, no unified history, feature parity gap (workflow pinning), no manual fire mode, no run-now button, schema JOIN complexity.
- `_sidebar.js` Build section: "Recurring tasks" added between Automations and Knowledge, href=recurring-tasks.html, icon=calendar. Not a stub.
- `index.html` masthead: eyebrow updated to "Prototype Round 7e-3", description updated, file count updated to 56+. New proto-card added in Page merge section for recurring-tasks.html (before the Automations card) with "Consolidates 2 schemas / 2 pages" replaces list (ScheduledTasksPage/scheduled_tasks, TriggersPage/agent_triggers) and before-link to before-recurring-tasks.html.

**Consolidation rationale:** scheduled_tasks and agent_triggers represent the same domain concept: a persistent rule that describes when to invoke an agent. The fire condition (cron/RRULE vs event subscription vs manual) is a property of the rule, not a reason to have two separate surfaces. Unifying them lets operators see all their recurring invocations in one list, compare fire counts across types, share history/test/retry-policy UX, and surfaces the Manual fire mode that neither legacy page supported.

**Frontend-design-principles checks:**
- Start with primary task: yes -- operator's primary task is "manage when my agents run automatically". The page opens on the full task list with all fire types visible, not segmented by schema origin.
- Default to hidden: yes -- no KPI tile strip, no fire-count trend chart, no cost-per-task dashboard. Fire count/30d is a single number per row. History tab is behind a tab click.
- One primary action: yes -- "+ New recurring task" is the single primary action on the page. Drawer has one primary action (Save changes) with secondary actions clearly outlined or at far right (Delete in red).
- Inline state: yes -- status (Active/Paused/Error) shown as inline colored badge with status dot per row. Error message surfaced inline under the status badge rather than in a separate panel.
- Re-check passed: yes -- a non-technical operator can scan the task list, see what fires when, and create a new task without understanding the scheduled_tasks vs agent_triggers schema distinction. Fire condition labels ("Schedule-fired daily 9am UTC") are plain English.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/recurring-tasks.html` (created)
- `prototypes/consolidation-2026-05-06/before-recurring-tasks.html` (created)
- `prototypes/consolidation-2026-05-06/_sidebar.js` (Recurring tasks nav item added)
- `prototypes/consolidation-2026-05-06/index.html` (round metadata updated, Recurring tasks card added)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7 — 2026-05-06 (final-A)

**Operator feedback:** Three changes: (1) Rebuild integrations.html as Connections page with two sub-tabs (Integrations/Logins), universal search, plain-language connection method chips, and NO Tools/MCP tab. (2) Onboarding multi-select restructure across steps 2-5. (3) Skill state polish across agent-edit.html and org-agent-edit.html with broken-dependency, locked, and destructive states.

**Changes made:**
- `integrations.html` — complete rebuild as Connections page. Page title and subtitle updated (Connections, Acme Corp 8 connected 3 with errors). Universal search bar above sub-tabs with cross-tab chip (shows "Also found N matches in Logins" and jumps on click). Two sub-tabs: Integrations (default) and Logins. Integrations tab: 8 connected app cards in auto-fill grid with logo, name, label, status dot, "Verified Xh ago" text, and connection method chip (Sign in / Key -- plain language, no OAuth/API key). Cards are error-bordered for Salesforce (amber, token expired) and Linear (red, invalid key). Add a connection section with category filter chips (All/Email/CRM/Messaging/Payments/Storage/Custom) and 16 available app cards each with + Connect button that triggers 2s connecting overlay. Logins tab: table view with service name, URL (monospace), masked username, last verified, status dot. Click row opens detail drawer with full fields, masked password with show/hide, verification history. + Add web login button opens modal with URL prefix indicator, show/hide password, optional label. + Connect top-right dropdown (Connect an app / Add a web login). No MCP/Tools sub-tab anywhere.
- `before-integrations.html` — banner text updated to describe actual UX problems (OAuth jargon leaked, MCP confusion, web logins not differentiated). Problems list added as red-bordered box with 6 specific bullet points.
- `onboarding.html` — Step nav updated with Step 2b (Connecting...) added. Step 2 rebuilt: title "Pick the integrations you'll use", subtitle about ticking. Radio cards replaced with checkbox cards (multi-select). Live summary panel updates as user ticks: N active connections / skills list / background pull count. Continue button: "Connect (N) integrations". Step 2b added: mini-flow view with done/spinning/waiting rows, each with Skip option. Background sync banner showing HubSpot CRM 47% pull. Step 3 rebuilt: title "Choose your worker agents", subtitle about manager/orchestrator auto-inclusion. Six worker-only checkbox cards (Outreach Agent, Lead Qualifier, Account Health Agent, Demo Scheduler, Support Triage, CRM Sync Agent). Live hierarchy preview updates on selection showing auto-included managers. Background sync banner visible steps 3+. Continue button: "Set up (N) agents". Step 4 rebuilt: title "Pick the automations to enable", six automation checkbox cards with trigger type badges. Background sync shows 91% complete. Continue button: "Set up (N) automations". Step 5 updated: multi-count summary (3 integrations, 2 agents, 2 automations), background pull status section showing 3 connections established + pulls in progress + Slack complete. Button text: "Go to dashboard". JavaScript: updateS2Summary(), updateS3Hierarchy(), updateS4Count() functions with live count/label updates.
- `agent-edit.html` — CSS: added .skill-row-broken, .skill-row-locked, .skill-row-destructive, .chip-broken, .chip-destructive, .lock-icon, .destruct-modal-overlay/.destruct-modal, CSS tooltip via [data-tip]::after. Enabled section: added "Gmail: send email" row with .skill-row-broken, amber Disconnected chip, toggle preserved-on but disabled/cursor-not-allowed. Add section (system library): added "HubSpot: create deal" with .skill-row-locked (lock icon, greyed, Add button disabled) and "Gmail: delete emails" with .skill-row-destructive (amber Destructive chip, Enable button triggers confirm modal). Destructive confirm modal added (title, body, Yes enable red button / Cancel). JS: openDestructiveConfirm(), closeDestructiveConfirm(), confirmDestructiveEnable().
- `org-agent-edit.html` — Same CSS block added. Enabled section: added "Slack: post message" with .skill-row-broken and Disconnected chip. Add section: added "Calendly: schedule meeting" with .skill-row-locked and "Stripe: refund payment" with .skill-row-destructive. Destructive confirm modal added (org-prefixed IDs). JS: openOrgDestructiveConfirm(), closeOrgDestructiveConfirm(), confirmOrgDestructiveEnable().

**Mandatory completion checks:**
- Check 1 (plain-language terms in integrations.html): 15 matches (Sign in, Web login, Connection method) -- PASS (target: >= 3)
- Check 2 (OAuth/API key jargon): 1 match -- only in HTML comment at top, not in any visible UI copy -- PASS (target: 0 in UI)
- Check 3 (multi-select terms in onboarding.html): 9 matches -- PASS (target: >= 2)
- Check 4 (skill state classes in agent-edit.html): 19 matches -- PASS (target: >= 3)
- Check 5 (skill state classes in org-agent-edit.html): 15 matches -- PASS (target: >= 2)

**Frontend-design-principles checks:**
- Start with primary task: yes -- Connections opens on app cards ready to click; no credential-type dashboard or health report visible by default. Onboarding starts from user intent (what will you use), not data model (credential types). Skill states communicate dependency status exactly at point of use.
- Default to hidden: yes -- MCP/Tools tab not surfaced to operators at all. Destructive skills require an extra confirmation step before enabling. Detail drawer for web logins is on-click.
- One primary action: yes -- Connections: + Connect (dropdown). Onboarding each step: one Continue/Connect/Set-up button. Skills tab: skill toggle or Add button (one action per row).
- Inline state: yes -- Connection status (dot + verified time) inline on card. Broken dependency shown inline on skill row without navigating away. Cross-tab search chip shows inline below search.
- Re-check passed: yes -- non-technical operator can tell the difference between "Sign in" and "Key" connections without needing to know OAuth. Disconnected skill row tells the operator exactly what to do (Re-connect at Connections). Locked skill tells the operator what integration to add. Destructive action requires deliberate confirmation.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/integrations.html` (rebuilt)
- `prototypes/consolidation-2026-05-06/before-integrations.html` (banner and problems list updated)
- `prototypes/consolidation-2026-05-06/onboarding.html` (steps 2-5 restructured for multi-select)
- `prototypes/consolidation-2026-05-06/agent-edit.html` (skill state CSS + rows + modal added)
- `prototypes/consolidation-2026-05-06/org-agent-edit.html` (skill state CSS + rows + modal added)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)

## Round 7-final-B — 2026-05-06

**Operator feedback:** Final polish pass before review-ready. Walk every after-mockup page systematically against 10 check categories: terminology, em-dashes, emojis, design principles, mock data quality, stub labels, cross-links, demo profile gating, sidebar consistency, visual consistency.

**Changes made:**

Em-dash fixes (user-visible content only, HTML/CSS/JS comments exempt):
- `run-trace.html`: "Outreach Agent — Run #4827" replaced with "Outreach Agent: Run #4827"
- `project-edit.html`: "Example objectives — click to use" replaced with "(click to use)"; "— alert when spend..." replaced with "(alert when spend...)"
- `org-agent-edit.html`: "Outreach Agent — Org-level definition" (2 instances) replaced with "Outreach Agent, org-level definition"; JS string " — Deployment details" replaced with ": Deployment details"
- `agents.html`: null indicator em-dash in tags column replaced with hyphen
- `recurring-tasks.html`: null indicator em-dash in "Next fire" column replaced with hyphen
- `queues.html`: 5 null indicator em-dashes in table cells replaced with hyphens

Terminology fixes:
- `inbox.html`: "HubSpot OAuth token expired" replaced with "HubSpot connection expired"; CSS comment updated from "Re-suppress" to "Keep ignoring"
- `agent-edit.html`: credential select "(OAuth, valid)" replaced with "(connected, valid)"; "HubSpot API key (valid)" replaced with "HubSpot key (valid)"
- `manage-org.html`: "Google Workspace OAuth token expires in 3 days" replaced with "Google Workspace connection expires in 3 days"
- `recurring-tasks.html`: error mock data "HubSpot OAuth expired" replaced with "HubSpot connection expired"
- `activity.html`: integration field "Gmail (OAuth)" replaced with "Gmail"

Emoji fixes (&#12xxxx entities, all replaced with SVG or text):
- `knowledge.html`: 24 emoji entities removed. &#128683; (prohibited) replaced with SVG circle-line icon; &#128065; (eye) removed from "Admin view" chip label; &#128274; (lock) removed from "Edit at org level" button; &#128196;/&#128202; (document icons) replaced with inline SVG file/chart icons throughout
- `org-knowledge.html`: 21 emoji entities removed. &#128101; (group) removed from "Used by N workspaces" chips; &#128101; removed from "Not yet shared" chip; &#128196;/&#128202; doc icons replaced with SVG
- `agent-edit.html`: &#128270; (magnifying glass) agent icon replaced with "OA" initials in emerald circle
- `org-agent-edit.html`: &#128270; agent icon replaced with "OA" initials; &#128196;/&#128683;/&#128465;/&#9998;/&#9881; in context menu items replaced with empty strings (text-only items)

Cross-link fixes:
- `home.html`: "View run log" link changed from # to activity.html; spend drawer "coming soon" note replaced with link to spending.html
- `agents.html`: "Edit" row action changed from showToast to actual <a> link: workspace view -> agent-edit.html, org view -> org-agent-edit.html
- `inbox.html`: "View run trace" button changed from button (stub) to <a href="run-trace.html">; "Re-authenticate" button changed to <a href="integrations.html">
- `agent-edit.html`: data source drawer "View full document in Knowledge", "Edit in Knowledge", "Edit bundle in Knowledge" links changed from # (onclick=false) to href="knowledge.html"
- `automations.html`: "Recurring tasks page" footer link changed from # to recurring-tasks.html
- `org-knowledge.html`: "View at workspace level" link added to all 6 authored memory overflow menus, pointing to knowledge.html

Stub/placeholder fixes:
- `home.html`: "Detailed spend breakdown - coming soon" replaced with proper "View full spending breakdown" link to spending.html
- `spending.html`: 4 x alert('Pause stub') replaced with showToast('Agent paused')
- `activity.html`: alert('Prototype stub') in "View finding" button replaced with showToast('Opening finding detail...')
- `project-edit.html`: showToast message changed from "Prototype stub: X not implemented" to "X saved"

Pages checked with no changes needed:
- `calendar.html`: clean, period navigation works, no terminology issues
- `automation-detail.html`: clean, no issues found
- `team.html`: em-dash in CSS comment only (exempt), no other issues
- `integrations.html`: clean, uses "Sign in" / "Key" / "Web login" terminology correctly
- `manage-org.html`: one OAuth fix applied, otherwise clean
- `pages.html`: stub CSS class names only (not UI text), showToast used for stub actions
- `onboarding.html`: no sidebar (intentional: full-screen flow), no issues
- `queues.html`: OAuth in system admin error tables (exception per brief), null indicators fixed, correctly defaults to system mode

**Frontend-design-principles checks:**
- Start with primary task: yes -- polish pass only. No information architecture changes. Primary tasks remain unchanged on all pages.
- Default to hidden: yes -- no new panels or dashboards added. Spend drawer "coming soon" note replaced with direct link rather than expanding the drawer content.
- One primary action: yes -- no screen structure changed. Cross-link fixes route to correct destination pages.
- Inline state: yes -- agent icon uses initials (readable inline state without emoji dependency). Knowledge overflow menus now show workspace link inline.
- Re-check passed: yes -- emoji removal makes Admin view and document type indicators use text or SVG rather than platform-dependent emoji glyphs, which is more reliable and professional. Terminology fixes ("connection expired" vs "OAuth token expired") are more operator-friendly.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/consolidation-2026-05-06/run-trace.html` (em-dash in title)
- `prototypes/consolidation-2026-05-06/project-edit.html` (em-dashes, stub toast message)
- `prototypes/consolidation-2026-05-06/org-agent-edit.html` (em-dashes, agent icon emoji, context menu emoji)
- `prototypes/consolidation-2026-05-06/inbox.html` (OAuth terminology, CSS comment, cross-links)
- `prototypes/consolidation-2026-05-06/agent-edit.html` (OAuth/API key terminology, Knowledge cross-links, agent icon emoji)
- `prototypes/consolidation-2026-05-06/manage-org.html` (OAuth terminology)
- `prototypes/consolidation-2026-05-06/recurring-tasks.html` (OAuth error, null indicator)
- `prototypes/consolidation-2026-05-06/activity.html` (OAuth field, stub alert)
- `prototypes/consolidation-2026-05-06/home.html` (View run log link, spend drawer note)
- `prototypes/consolidation-2026-05-06/agents.html` (Edit cross-link, null indicator)
- `prototypes/consolidation-2026-05-06/knowledge.html` (24 emoji entities replaced)
- `prototypes/consolidation-2026-05-06/org-knowledge.html` (21 emoji entities replaced, workspace cross-links added)
- `prototypes/consolidation-2026-05-06/spending.html` (Pause stubs replaced with toast)
- `prototypes/consolidation-2026-05-06/automations.html` (recurring-tasks cross-link)
- `prototypes/consolidation-2026-05-06/queues.html` (null indicator em-dashes)
- `tasks/builds/consolidation-2026-05-06/mockup-log.md` (this entry)
