# Mockup log — operator-confidence-layer

## Round 1 — 2026-05-18 (initial draft)

**Operator feedback:** Initial draft — no prior feedback.

---

### Codebase grounding (Step 0a) — PER SCREEN (mandatory)

- **S1 (Task creation with Preview):** extends `client/src/pages/ScheduledTaskDetailPage.tsx` (edit form pattern: title, brief, instructions textarea, RecurrencePicker, scheduleTime, timezone, priority select, inline-form button row). Also references `client/src/components/TaskModal.tsx` field/label conventions.
- **S2 (Preview output — the readable plan):** NEW dedicated view. Justification: no existing "plan review" surface exists in the app. The Preview output is ephemeral, operator-specific, and distinct from run history or task detail views. Every other screen extends an existing surface; this is the one surface the brief explicitly calls out as new ("Preview result view (new)" in Files-in-scope). The anti-confusion invariant from the brief additionally requires it to be visually distinct from real execution surfaces — embedding it inside an existing view would risk confusion.
- **S3 (Promote-to-run post state):** extends `client/src/pages/ScheduledTaskDetailPage.tsx` (StatCard components, task title + status pill row, instructions section, upcoming runs, run history table pattern).
- **S4 (Record detail with undo):** extends `client/src/pages/PageProjectDetailPage.tsx` (detail layout: max-w-3xl, back link, header title+actions, white bordered section cards) and `client/src/pages/ScheduledTaskDetailPage.tsx` (section header pattern, activity/note pattern).
- **S5 (Snapshot quota on usage view):** extends `client/src/pages/govern/SpendingPage.tsx` (tab bar: "Ledger" | "Caps & Budgets" — adds third tab "Storage"; ViewModeSwitcher; page header; section card layout).

### Codebase grounding — round-wide

**All files read:**
- `client/src/pages/ScheduledTaskDetailPage.tsx`
- `client/src/pages/build/RecurringTasksPage.tsx`
- `client/src/pages/govern/SpendingPage.tsx`
- `client/src/pages/PageProjectDetailPage.tsx`
- `client/src/pages/StudioPage.tsx`
- `client/src/pages/AutomationsPage.tsx`
- `client/src/pages/AgentTriggersPage.tsx`
- `client/src/pages/PortalExecutionPage.tsx`
- `client/src/components/TaskModal.tsx`
- `client/src/components/clientpulse/CreateTaskEditor.tsx`
- `client/src/pages/build/components/TestRunnerCard.tsx`
- `prototypes/operator-backend/index.html` (visual conventions reference)
- `prototypes/operator-backend/_shared.css` (token/colour reference)
- `prototypes/operator-backend/r1-opentaskview-operator-running.html` (layout reference)

**Vocabulary / conventions inherited (quoted from codebase):**
- `STATUS_CLS` status pills from `ScheduledTaskDetailPage.tsx`: `completed: 'bg-green-100 text-green-800'`, `running: 'bg-blue-100 text-blue-800'`, `failed: 'bg-red-100 text-red-800'`, `retrying: 'bg-amber-100 text-amber-800'`
- Input class from `ScheduledTaskDetailPage.tsx`: `'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500'`
- Priority options: `low | normal | high | urgent`
- Schedule fields: `title`, `brief`, `description` (instructions), `rrule`, `timezone`, `scheduleTime`, `endsAt`, `endsAfterRuns`, `priority`
- Tab labels from `SpendingPage.tsx`: `'ledger' | 'caps'` — new tab uses the same tab-button pattern with `border-b-2 border-indigo-600 text-indigo-600` active state
- Record status badges from `PageProjectDetailPage.tsx`: `draft: 'bg-amber-100 text-amber-800'`, `published: 'bg-green-100 text-green-800'`, `archived: 'bg-slate-100 text-slate-600'`
- `ViewModeSwitcher` modes: `workspace | org | system`
- From prior prototype conventions: `btn-primary` indigo `#4f46e5`, `btn-secondary` white+border, pill running = emerald, pill completed = indigo, font Inter

**New dedicated pages proposed:**
- S2 (Preview output): one new dedicated view. Justified above — explicit in brief's Files-in-scope, no existing surface fits, anti-confusion invariant requires visual separation.
- All other screens are extensions of existing surfaces.

---

### Changes made (Round 1)

- Created `prototypes/operator-confidence-layer/` directory with 6 files.
- `_shared.css`: complete shared token/component library. All tokens self-contained (no import chain). Inherits visual language from `operator-backend/_shared.css`.
- `index.html`: screen index with decision log and vocabulary reference.
- `01-task-creation.html`: S1 — task creation form extended with three-option segmented run-mode control. Interactive: clicking each option changes button label/colour and shows/hides the Preview inline explanation.
- `02-preview-output.html`: S2 — Preview output. Strong PREVIEW ONLY top bar (anti-confusion invariant), ordered step list with skill chips, promote panel. All copy in future tense ("would", "plans to"). Disclaimer note per brief's "not a guarantee" constraint.
- `03-promote-to-run.html`: S3 — post-promote task detail with dismissable success banner and violet lineage card linking back to the preview.
- `04-record-detail-undo.html`: S4 — two variants: A (undo available), B (undo disabled after human edit). Interactive: click Undo in A to see confirmation. Tooltip on disabled button explains why.
- `05-snapshot-quota.html`: S5 — Govern > Spending > Storage tab, two variants: 72% (normal) and 91% (approaching limit with amber warning and actionable options).

---

### Frontend-design-principles checks

- **Start with primary task:** yes — S1: primary task is "create a task"; Preview is additive, opt-in, does not disrupt the default flow. S2: primary task is "review the plan"; one summary + ordered steps. S4: primary task is "restore the record"; one button, one outcome. S5: primary task is "understand how much storage is in use and act if needed"; one quota bar.
- **Default to hidden:** yes — Preview mode is opt-in (default is "Run now"). Undo button only appears on records with a recent agent snapshot. Storage tab is one click away; no quota tile pushed onto the main Spending header. No cost estimates, no run history tables on new screens, no IDs surfaced.
- **One primary action per screen:** yes — S1: "Preview plan" (or "Create and run" in default mode). S2: "Create task and schedule". S3: no action (confirmation state). S4: "Undo this edit" (one button per variant). S5: no primary action in normal state; "Reduce retention window" appears only when quota is nearly full.
- **Inline state beats dashboards:** yes — quota shown as an inline bar, not a KPI tile. Agent-sourced fields highlighted inline on the contact record, not on a separate audit page. Activity feed entry inline for the undo affordance.
- **Re-check passed:** yes — all five screens tested mentally against "non-technical operator lands here for the first time": S1 (the segmented control makes the three options immediately legible), S2 (PREVIEW ONLY banner prevents confusion, numbered steps are scannable), S3 (success banner removes any doubt about what happened), S4 (agent-edited fields are highlighted in violet, undo button is immediately findable), S5 (quota bar with number is instantly readable).
- **Extends existing surface:** yes — 4 of 5 screens extend existing pages. S2 is the justified new view.

---

### Rule violations flagged

None. All five brief mockup constraints are respected:
- No timeline history of agent actions across runs or tasks.
- No diff visualisation (undo restores without showing a before/after diff).
- No multi-record rollback or "undo entire run".
- No per-step approval prompts.
- No cost forecasting from Preview.
- S2 disclaimer note explicitly states Preview is not a guarantee of identical execution.

---

### Files modified

- `prototypes/operator-confidence-layer/_shared.css` (created)
- `prototypes/operator-confidence-layer/index.html` (created)
- `prototypes/operator-confidence-layer/01-task-creation.html` (created)
- `prototypes/operator-confidence-layer/02-preview-output.html` (created)
- `prototypes/operator-confidence-layer/03-promote-to-run.html` (created)
- `prototypes/operator-confidence-layer/04-record-detail-undo.html` (created)
- `prototypes/operator-confidence-layer/05-snapshot-quota.html` (created)

---

## Round 2 — 2026-05-18

**Operator feedback:** Round 1 grounding gap caught by operator. S1 invented a standalone "New Recurring Task" page that does not exist in the app. Brief expanded to v4 adding C1 (recurring task creation) as a foundational capability on NewBriefModal.tsx. Full re-grounding required.

---

### Codebase grounding (Step 0a) — PER SCREEN (mandatory)

- **S1 (NewBriefModal with recurring toggle):** extends `client/src/components/layout/modals/NewBriefModal.tsx` (the actual "+ New Task" modal — Title / Description / Priority / Org override / Subaccount override / btn-primary / btn-secondary). Also references `client/src/components/RecurrencePicker.tsx` (RecurrenceValue props: rrule, endsAt, endsAfterRuns; panel: bg-[#fafbfc] border border-slate-200 rounded-[10px] p-5; day buttons: w-9 h-9 rounded-full; freq/ends sections). Additionally references `client/src/pages/ScheduledTaskDetailPage.tsx` for the schedule field set (assigned agent, time, timezone) to match what create and edit show consistently.
- **S2 (Preview output — recurring context):** new dedicated view (brief explicitly lists "Preview result view (new)" in Files-in-scope). Updated from Round 1: added a recurring context pill ("Recurring: Mon / Wed / Fri at 07:00 NZ") under the task name to reflect the C1 recurring context. No existing surface fits — anti-confusion UX invariant also requires visual separation from real execution surfaces.
- **S3 (Promote-to-run aftermath):** extends `client/src/pages/ScheduledTaskDetailPage.tsx`. Round 2 correction: layout now faithfully mirrors the source — back link (text-[14px] text-indigo-600), h1 text-[24px] font-bold with Active pill (bg-green-100 text-green-800) and dismissable lineage pill, brief paragraph text-[14px] text-slate-500, Edit button, five StatCards (bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5: Agent / Schedule / Total Runs / Success Rate / Token Budget), Instructions section (bg-slate-50 border border-slate-200 rounded-lg p-4, pre font-mono text-[12px]), Data Sources section, Upcoming chips (bg-slate-100 px-3 py-1.5 rounded-lg text-[13px] text-slate-600), Run History.
- **S4 (Record detail with undo):** extends `client/src/pages/PageProjectDetailPage.tsx` (layout: max-w-3xl, back link text-[13px] text-slate-500, h1 text-[24px] font-bold text-slate-900, Pages card bg-white border border-slate-200 rounded-xl overflow-hidden, divide-y divide-slate-100, status pills draft/published/archived). Also references `client/src/pages/ScheduledTaskDetailPage.tsx` (section header font-size 14px font-semibold text-slate-800). Round 2: comment header updated; nav links corrected. Design unchanged from Round 1 (correctly grounded then).
- **S5 (Snapshot quota — Storage tab):** extends `client/src/pages/govern/SpendingPage.tsx` (tabs: "Ledger" | "Caps & Budgets", border-b-2 active = border-indigo-600 text-indigo-600, inactive = border-transparent text-slate-500; ViewModeSwitcher; PageShell; h1 "Spending" text-lg font-semibold text-slate-900). Round 2: comment header updated; nav links corrected. Design unchanged from Round 1.

### Codebase grounding — round-wide

**All files read this round:**
- `client/src/components/layout/modals/NewBriefModal.tsx` (primary new grounding — S1)
- `client/src/components/RecurrencePicker.tsx` (component props, panel structure, day buttons — S1)
- `client/src/pages/ScheduledTaskDetailPage.tsx` (S1 schedule field reference, S3 layout)
- `client/src/pages/build/RecurringTasksPage.tsx` (post-creation landing page layout)
- `client/src/pages/PageProjectDetailPage.tsx` (S4 record detail layout)
- `client/src/pages/govern/SpendingPage.tsx` (S5 tab/header layout)
- `docs/frontend-design-principles.md`
- `tasks/builds/operator-confidence-layer/brief.md` (v4)
- `prototypes/operator-confidence-layer/` (all 6 Round 1 files)

**Vocabulary / conventions inherited (quoted from codebase):**
- NewBriefModal form structure: `h2 "New Task" text-[17px] font-bold text-slate-900`, `p-6 flex flex-col gap-4`, `label block text-[13px] font-medium text-slate-700 mb-1.5`, `input w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:ring-2 focus:ring-indigo-500`, `btn btn-primary | btn btn-secondary`
- RecurrencePicker panel: `bg-[#fafbfc] border border-slate-200 rounded-[10px] p-5`, section label `text-sm font-medium text-gray-700`, day buttons `w-9 h-9 rounded-full`, active day `bg-indigo-500 text-white`, inactive `bg-slate-200 text-slate-600`, end radio `accent-indigo-500`
- ScheduledTaskDetailPage status pills: `completed: bg-green-100 text-green-800`, `running: bg-blue-100 text-blue-800`, `failed: bg-red-100 text-red-800`, `retrying: bg-amber-100 text-amber-800`
- ScheduledTaskDetailPage inputCls: `w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500`
- SpendingPage tabs: `activeTab === 'ledger'` and `'caps'`; tab-button: `border-b-2 border-indigo-600 text-indigo-600` (active), `border-transparent text-slate-500` (inactive)
- RecurringTasksPage columns: Name / Fire condition / Action / Scope (WorkspaceBadge) / Status / Last fired / Next fire
- PageProjectDetailPage status pills: `draft: bg-amber-100 text-amber-800`, `published: bg-green-100 text-green-800`, `archived: bg-slate-100 text-slate-600`

**New dedicated pages proposed:**
- S2 (Preview output): one new dedicated view — same justification as Round 1; brief explicitly lists "Preview result view (new)" in Files-in-scope; no existing surface fits; anti-confusion invariant requires visual separation.
- All other screens extend existing surfaces.

---

### Changes made (Round 2)

- **S1 (01-task-creation.html) — fully rewritten.** Corrected from Round 1's standalone-page mistake. Now shows NewBriefModal.tsx structure exactly: modal backdrop, bg-white rounded-xl shadow-2xl max-w-lg, header (h2 "New Task"), form body (Title / Description / Priority as exact field/label/input pattern from source), "Make this task recurring" inline toggle (OFF by default, shown ON in mockup), revealed schedule section (assigned agent, RecurrencePicker component faithfully reproduced from RecurrencePicker.tsx — bg-[#fafbfc] border rounded-[10px], repeat every, weekday buttons, ends section), time+timezone row, compact two-option "Submit as" row (Create and run / Preview first). Interactive: toggle hides/shows the schedule section; clicking Preview first shows the preview note and changes the button label.
- **S2 (02-preview-output.html) — updated.** Added recurring context pill ("Recurring task preview: Mon / Wed / Fri at 07:00 NZ") below the task name. Updated promote panel button copy to "Create recurring task". Nav link corrected. All other design retained from Round 1.
- **S3 (03-promote-to-run.html) — substantially rewritten.** Now faithfully mirrors ScheduledTaskDetailPage.tsx. Added all five StatCards, Instructions pre block (monospace), Data Sources placeholder, Upcoming date chips. Back link is text-indigo-600 text-[14px] per source. Lineage pill is dismissable; success banner is dismissable. Run History shows "No runs yet" (new task).
- **S4 (04-record-detail-undo.html) — comment header updated, nav link corrected.** Design unchanged — was correctly grounded in Round 1.
- **S5 (05-snapshot-quota.html) — comment header updated, nav link corrected.** Design unchanged — was correctly grounded in Round 1.
- **index.html — fully rewritten.** Updated to Round 2, added grounding correction banner, updated S1 description to describe the actual modal-based interaction, added C1/C2/C3 sections, updated vocabulary box with NewBriefModal and RecurrencePicker tokens.

---

### Frontend-design-principles checks

- **Start with primary task:** yes — S1: primary task is "create a task"; recurring add-on is opt-in, toggle is OFF by default, the default one-off brief creation flow is unchanged. S2: primary task is "review the plan". S3: confirmation state, task is live. S4: primary task is "restore the record". S5: primary task is "understand snapshot storage usage and act if needed".
- **Default to hidden:** yes — Toggle is OFF by default on S1 (brief invariant: "Make this task recurring is OFF by default"). Preview is opt-in. Recurring schedule section hidden until toggled. Undo button only appears on records with a recent agent snapshot. Storage tab one click away; no quota tile pushed onto the main header.
- **One primary action per screen:** yes — S1: "Create Task" (or "Preview plan" when Preview mode selected). S2: "Create recurring task" (promote button). S3: no action (confirmation state). S4: "Undo this edit" (one per variant). S5: "Reduce retention window" appears only at 90%+.
- **Inline state beats dashboards:** yes — Quota is an inline bar, not a KPI tile. Agent-sourced fields highlighted inline. Activity feed entry for undo, not a separate audit page.
- **Re-check passed:** yes — S1: operator opening "+ New Task" sees the exact same modal they always see; the toggle row is clearly labelled "Make this task recurring" with the hint "Run on a schedule instead of once". The schedule section only opens when they opt in. S2: PREVIEW ONLY banner prevents confusion. S3: green success banner removes doubt. S4: undo button immediately visible in activity feed. S5: quota bar with percentage is instantly readable.
- **Extends existing surface:** yes — 4 of 5 screens extend existing pages/components. S2 is the justified new view (explicit in brief). S1 extends NewBriefModal.tsx (the correction this round made).

---

### Rule violations flagged

None. All six brief mockup constraints respected:
- No timeline history of agent actions across runs.
- No diff visualisation.
- No multi-record rollback or "undo entire run".
- No per-step approval prompts.
- No cost forecasting from Preview.
- S2 disclaimer explicitly states "Preview is not a contract for identical execution."
- New C1 constraints: toggle is shown OFF-by-default in commentary (shown ON in mockup to demonstrate capability); recurring fields are inline on NewBriefModal, not a separate page; RecurrencePicker is reproduced from the real component.

---

### Files modified

- `prototypes/operator-confidence-layer/01-task-creation.html` (fully rewritten — Round 1 grounding error corrected)
- `prototypes/operator-confidence-layer/02-preview-output.html` (updated — recurring context pill, promote button copy, nav link)
- `prototypes/operator-confidence-layer/03-promote-to-run.html` (substantially rewritten — faithful ScheduledTaskDetailPage layout)
- `prototypes/operator-confidence-layer/04-record-detail-undo.html` (comment header updated, nav link corrected)
- `prototypes/operator-confidence-layer/05-snapshot-quota.html` (comment header updated, nav link corrected)
- `prototypes/operator-confidence-layer/index.html` (fully rewritten — Round 2, correction banner, updated descriptions)

---

## Round 3 — 2026-05-18

**Operator feedback:** Five items: (1) S1 grounding tightening — add Org/Subaccount override fields; (2) S2 to S1 flow articulation — breadcrumb, working navigation; (3) S3 layout fix — content going to screen edges, max-width wrong; (4) S4 polish — reduce visual density, undo hierarchy; (5) S5 simplify — automate, no manual retention controls.

---

### Codebase grounding (Step 0a) — PER SCREEN (mandatory)

- **S1 (NewBriefModal with recurring toggle):** extends `client/src/components/layout/modals/NewBriefModal.tsx`. Round 3: confirmed Organisation override field (`identity.isSystemAdmin && orgs.length > 1`, label "Organisation (optional)") and Subaccount override field (`subaccounts.length > 0 && !crossOrgOverride`, label "Subaccount (optional)") from source. Both use the same `w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:ring-2 focus:ring-indigo-500` class. Modal width confirmed: `max-w-lg = 512px mx-4`. Fields added between Priority and the recurring toggle.
- **S2 (Preview output):** new dedicated view (justified — brief explicit, anti-confusion invariant). Round 3: flow breadcrumb CSS and HTML added. All navigation links verified working (back to S1, promote to S3).
- **S3 (Promote-to-run aftermath):** extends `client/src/pages/ScheduledTaskDetailPage.tsx`. Round 3: `PageShell.tsx` read — confirms `maxWidth: 1280` default. S3 `detail-body` corrected from `max-width: 860px` to `max-width: 1280px`. Section head sizes corrected: Instructions/Data Sources `text-[14px]`, Upcoming/Run History `text-[16px]` per source.
- **S4 (Record detail with undo):** extends `client/src/pages/PageProjectDetailPage.tsx`. Round 3: duplicate undo button removed from contact header (undo affordance now only in activity feed). Agent-source badge text removed from highlighted field labels (violet background alone is the signal). Variant divider labels shortened.
- **S5 (Snapshot quota — Storage tab):** extends `client/src/pages/govern/SpendingPage.tsx`. Round 3: manual retention window selector removed. Actionable near-quota notice (with "Reduce retention window" and "Request quota increase" buttons) removed. Replaced with passive auto-clear note and passive warning chip text. Per-agent breakdown table retained (informational, no action buttons).

### Codebase grounding — round-wide

**All files read this round:**
- `client/src/components/layout/modals/NewBriefModal.tsx` (re-read for S1 field confirmation)
- `client/src/pages/ScheduledTaskDetailPage.tsx` (re-read for S3 section head sizes)
- `client/src/components/PageShell.tsx` (NEW — read for S3 max-width confirmation)
- All Round 2 prototype files (re-read before editing)
- `docs/frontend-design-principles.md`
- `tasks/builds/operator-confidence-layer/brief.md` (v4)
- `tasks/builds/operator-confidence-layer/mockup-log.md` (Round 2 entry)

**Vocabulary / conventions inherited (quoted from codebase):**
- NewBriefModal Organisation override condition: `identity.isSystemAdmin && orgs.length > 1` — label `"Organisation (optional)"`
- NewBriefModal Subaccount override condition: `subaccounts.length > 0 && !(briefOrgOverride && briefOrgOverride.id !== identity.activeOrgId)` — label `"Subaccount (optional)"`
- Modal container: `bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4`
- PageShell.tsx default: `maxWidth: 1280` (applied as `style={{ maxWidth }}` on `page-content`)
- ScheduledTaskDetailPage `Instructions` section head: `text-[14px] font-semibold text-slate-800`
- ScheduledTaskDetailPage `Upcoming` + `Run History` heads: `text-[16px] font-semibold text-slate-800`

**New dedicated pages proposed:** none this round. All screens extend existing surfaces (S2 remains the one justified new view, unchanged from prior rounds).

---

### Changes made (Round 3)

**Item 1 — S1 grounding tightening:**
- Added Organisation override field (between Priority and recurring toggle). Shows "Org admin only" pill on the label, matching the source pattern. Uses same input class as all other fields.
- Added Subaccount override field (between Organisation and recurring toggle). Label: "Subaccount (optional)".
- Updated comment header to document both fields and their visibility conditions from source.
- Modal width: confirmed and documented `max-w-lg = 512px`. CSS already correct.

**Item 2 — S2 flow articulation:**
- Added `.flow-chip` CSS and HTML "New Task > Preview plan" breadcrumb at the top of S2, between the nav bar and the PREVIEW ONLY banner.
- S1's submit button already navigated to S2 when preview mode selected (from Round 2) — confirmed working.
- S2's "Edit task" links (in the banner top-right and in the promote panel) both href to `01-task-creation.html`.
- S2's promote button href confirmed as `03-promote-to-run.html`.
- index.html updated with a clickable linear flow diagram (S1 -> S2 -> S3 tiles).

**Item 3 — S3 layout fix:**
- Read `PageShell.tsx`: confirms default `maxWidth: 1280`.
- Changed `detail-body` from `max-width: 860px` to `max-width: 1280px; margin: 0 auto`.
- Added `.section-head-lg` class (`font-size: 16px`) for Upcoming and Run History heads, matching source.
- Updated the two section heads in HTML body to use `.section-head-lg`.

**Item 4 — S4 layout polish:**
- Removed duplicate "Undo agent edit" button from both Variant A and Variant B contact header rows. Only "Edit" button remains in the header (standard PageProjectDetailPage action). The undo affordance now lives only in the activity feed where context is richest.
- Removed `<span class="agent-source-badge">agent</span>` from all highlighted field cell labels in both variants. The violet `field-cell-new` background alone communicates agent-sourced, without the badge noise.
- Shortened variant divider labels ("Variant A: undo available" / "Variant B: undo disabled (human edited after agent)").
- Updated comment header to document all polish decisions.

**Item 5 — S5 automated framing:**
- Removed `retention-row` CSS and the two retention selector `<div>` blocks from both Variant A and Variant B.
- Removed `.retention-select` CSS.
- Removed "Manage quota" button from Variant B header.
- Removed the actionable amber notice block ("Snapshot storage is nearly full" with "Reduce retention window" / "Request quota increase" buttons) from Variant B.
- Added `.auto-note` CSS (passive note row at bottom of quota card).
- Variant A: replaced retention row with passive auto-note: "Snapshots auto-clear after 30 days. No action needed."
- Variant B warning chip text changed from actionable to passive: "Oldest snapshots auto-removed when quota is exceeded. No action needed."
- Variant B: passive note: "Snapshots auto-clear after 30 days. When quota is full, the oldest snapshots are removed first. No action needed."
- Per-agent breakdown table kept — no action buttons were in it in Round 2, confirmed retained as purely informational.
- index.html: S5 description updated, decision 5 updated to reflect automated retention stance.

**index.html (updated):**
- Round 3 comment header.
- Round 3 round banner (five items summarised).
- Added clickable linear flow diagram (S1 -> S2 -> S3 visual chain).
- All screen descriptions updated.
- Decision log entry 5 updated for automated retention.
- Vocab box updated with PageShell maxWidth and new NewBriefModal field conditions.

---

### Frontend-design-principles checks

- **Start with primary task:** yes — S1: create a task (recurring add-on opt-in, preview opt-in). S2: review the plan. S3: confirm creation succeeded. S4: restore the record (undo button is primary). S5: understand snapshot storage usage.
- **Default to hidden:** yes — Org/Subaccount fields only appear for eligible users (mockup shows the system-admin view). Recurring section hidden until toggled. Preview opt-in only. S5: no manual controls visible at all (automated system).
- **One primary action per screen:** yes — S1: "Create Task" or "Preview plan". S2: "Create recurring task". S3: confirmation state (no primary action). S4: "Undo this edit" (in activity feed). S5: no primary action (informational only now that manual controls are gone).
- **Inline state beats dashboards:** yes — Quota bar is inline. Agent-sourced fields highlighted inline. Activity feed entry for undo.
- **Re-check passed:** yes — S1: same modal operators already use, override fields are short selects, recurring is opt-in. S2: flow breadcrumb clarifies origin, PREVIEW ONLY banner is unmissable. S3: green banner confirms success immediately. S4: cleaned up header means first glance shows contact info and Edit — undo is found in the activity feed right below. S5: operator sees quota bar and passive note — understands system handles this automatically.
- **Extends existing surface:** yes — 4 of 5 screens extend existing pages. S2 is the justified new view.

---

### Rule violations flagged

None. All six brief mockup constraints respected (no timeline, no diff, no multi-record rollback, no per-step approval, no cost forecast, no Preview-as-guarantee copy). Item 5 alignment: S5 now correctly implements the operator direction (automated retention, passive UI) — the prior manual retention controls would have violated the spirit of the brief's "default 30 days, auto-clear" design decision.

---

### Files modified

- `prototypes/operator-confidence-layer/01-task-creation.html` (Org + Subaccount override fields added; comment header updated)
- `prototypes/operator-confidence-layer/02-preview-output.html` (flow breadcrumb CSS + HTML added; comment updated)
- `prototypes/operator-confidence-layer/03-promote-to-run.html` (max-width 1280px; section-head-lg; comment updated)
- `prototypes/operator-confidence-layer/04-record-detail-undo.html` (duplicate header undo buttons removed; agent-source badges removed; comment updated)
- `prototypes/operator-confidence-layer/05-snapshot-quota.html` (retention selector removed; actionable notice removed; passive auto-note added; comment updated)
- `prototypes/operator-confidence-layer/index.html` (Round 3 banner; linear flow diagram; all screen descriptions updated; decision 5 updated; vocab box updated)
