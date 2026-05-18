# Mockup log: deterministic-validators

## Round 1 — 2026-05-18 (initial draft)
**Operator feedback:** initial draft

**Codebase grounding (Step 0a) — PER SCREEN (mandatory):**
- Screen 1 (quality-check editor): extends `client/src/pages/govern/ScorecardCreatePage.tsx`. The check card pattern (`border border-slate-200 rounded p-3 space-y-2`) is inherited directly. The form layout (`max-w-xl mx-auto px-6 py-8`), field label style (`text-sm font-medium text-slate-700 mb-1`), input style (`border border-slate-200 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-300`), pass mark input, enabled checkbox, remove button (`text-xs text-red-500`), and add-check link (`text-xs text-indigo-600`) are all directly inherited. New fields (`kind`, `validatorSlug`, `validatorParameters`, `preconditionSlugs`, `preconditionParameters`, `safetyClass`) are injected into the existing check card shape without adding a new page.
- Screen 2 (verdict drill-in): extends `prototypes/closed-loop-skill-improvement/s1-inbox-improvements.html` (morning review queue) and inherits `.verdict-card`, `.badge-*`, `.queue-card`, `.tech-detail-*` patterns from `prototypes/closed-loop-skill-improvement/_shared.css`. This is a reusable panel within the existing review queue surface. No new page.

**Codebase grounding — round-wide:**
- All files read:
  - `client/src/pages/govern/ScorecardCreatePage.tsx`
  - `client/src/pages/agents/AgentEditScorecardTab.tsx`
  - `docs/frontend-design-principles.md`
  - `tasks/research-briefs/deterministic-validators-dev-brief.md`
  - `prototypes/closed-loop-skill-improvement/_shared.css`
  - `prototypes/closed-loop-skill-improvement/s1-inbox-improvements.html`
  - `prototypes/closed-loop-skill-improvement/s2-review-drawer.html`
- Vocabulary / conventions inherited (quoted from codebase):
  - `"border border-slate-200 rounded p-3 space-y-2"` — check card container (ScorecardCreatePage.tsx:164)
  - `"text-sm font-medium text-slate-700 mb-1"` — field labels (ScorecardCreatePage.tsx:121)
  - `"w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"` — inputs (ScorecardCreatePage.tsx:169)
  - `"text-xs text-red-500 hover:text-red-700"` — remove button (ScorecardCreatePage.tsx:218)
  - `"text-xs text-indigo-600 hover:text-indigo-700 font-medium"` — add check link (ScorecardCreatePage.tsx:157)
  - `"px-4 py-2 rounded text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"` — primary button (ScorecardCreatePage.tsx:234)
  - `"border-b border-slate-100"` — page header border (ScorecardCreatePage.tsx:98)
  - `"text-lg font-semibold text-slate-900"` — page title (ScorecardCreatePage.tsx:107)
  - `.queue-card`, `.badge-*`, `.section-card`, `.drawer-*`, `.tech-detail-*` — from closed-loop `_shared.css`
  - Tab pill: `.tab-pill`, `.tab-pill-btn`, `.tab-pill-btn.active` — from closed-loop `_shared.css`
- New dedicated pages proposed: none. Both screens extend existing surfaces.

**Changes made:**
- Created `prototypes/deterministic-validators.html` as a single-file prototype with two screens navigable via a prototype navigator bar.
- Screen 1: Extends the ScorecardCreatePage check card with a `kind` pill selector (3 states: Deterministic / Semantic / Hybrid), a deterministic config panel showing validator dropdown and generated parameter form, a hybrid config panel showing ordered precondition list with add/remove/reorder and a semantic judge prompt field, and a safety class toggle with contextual helper text. Three check cards shown: one in each kind state so the reviewer can compare all three states.
- Screen 2: Extends the morning review queue with expandable verdict drill-in panels on each verdict row. Three variants shown: deterministic pass (green badge, evidence table, validator slug + version), hybrid deterministic fail (amber badge, gate evidence first then skipped-judge note), inconclusive catalogue miss (amber callout, "this rubric references a validator that no longer exists", link to fix rubric).
- Interactive: kind pills toggle config visibility; validator dropdown updates parameter form dynamically; safety toggle fires; each verdict row expands/collapses its drill-in.

**Frontend-design-principles checks:**
- Start with primary task: yes — Screen 1 primary task is "configure a quality check"; Screen 2 primary task is "understand why a verdict was produced". Both start from the task, not the data model.
- Default to hidden: yes — parameter form is hidden until a validator is selected; hybrid judge prompt is below the precondition list; safety class toggle is hidden for pure semantic checks; technical detail (validator version, latency) is in the evidence table but not front-and-center.
- One primary action: yes — Screen 1 has one primary button ("Create scorecard"); Screen 2 has one primary reveal per row (expand drill-in).
- Inline state: yes — evaluation method badge, validator slug, and evidence are inline in the drill-in panel; no separate diagnostic page needed.
- Re-check passed: yes — a non-technical operator can read "Deterministic / Semantic / Hybrid" pill labels, see "Safety class" with one-sentence helper, and understand "This rubric references a validator that no longer exists" without jargon exposure.
- Extends existing surface: yes — both screens are injections into existing page layouts, not new pages.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/deterministic-validators.html` (created)
- `tasks/builds/deterministic-validators/mockup-log.md` (created)

---

## Round 2 — 2026-05-18
**Operator feedback:** NEEDS_REWORK from mockup-reviewer. Blocking findings B1-B3 on Screen 2; should-fix findings S1-S5.

**Codebase grounding (Step 0a) — PER SCREEN (mandatory):**
- Screen 1 (quality-check editor): extends `client/src/pages/govern/ScorecardCreatePage.tsx`. Unchanged surface extension; no new page.
- Screen 2 (Inbox with verdict drill-in): NOW correctly extends `client/src/pages/ReviewQueuePage.tsx`. Page title is "Inbox" (line 627), subtitle is "Briefs assigned to your AI team and agent actions awaiting approval." (line 628), tabs are "Briefs" and "Needs Review" (lines 678-694), tab-pill component class is `flex gap-1 p-1 bg-slate-100 rounded-xl mb-6 w-fit`. The verdict drill-in panel is an expansion inside an existing queue card row, not a standalone page-level list. Also read `prototypes/closed-loop-skill-improvement/s1-inbox-improvements.html` for the expansion-panel-inside-queue-row pattern.

**Codebase grounding — round-wide:**
- All files read this round:
  - `docs/frontend-design-principles.md`
  - `client/src/pages/ReviewQueuePage.tsx`
  - `client/src/pages/govern/ScorecardCreatePage.tsx`
  - `prototypes/closed-loop-skill-improvement/s1-inbox-improvements.html`
  - `prototypes/deterministic-validators.html` (prior round, read before editing)
- Vocabulary / conventions inherited (quoted from codebase):
  - Page title: `"Inbox"` (ReviewQueuePage.tsx line 627)
  - Page subtitle: `"Briefs assigned to your AI team and agent actions awaiting approval."` (line 628)
  - Tab 1 label: `"Briefs"` (line 679) with indigo badge
  - Tab 2 label: `"Needs Review"` (line 687) with amber badge (`bg-amber-100 text-amber-700`)
  - Tab pill container: `"flex gap-1 p-1 bg-slate-100 rounded-xl mb-6 w-fit"` (line 675)
  - Active tab: `"bg-white text-slate-900 shadow-sm"` (line 678)
  - Back link: `"text-[14px] text-indigo-600 hover:text-indigo-700 no-underline"` (line 622)
  - Header h1: `"text-[24px] font-bold text-slate-900 mt-2 mb-1"` (line 627)
  - Queue card body: `.p-4 bg-white border border-slate-200 rounded-lg` (line 405)
  - Expansion panel pattern inside queue card: inherited from `s1-inbox-improvements.html` `.improvements-section`, `.skill-improvement-card`, `.grouped-items` pattern
- New dedicated pages proposed: none. Screen 2 is now correctly an extension of ReviewQueuePage.tsx, not a standalone page.

**Changes made:**
- B1: Screen 2 title changed from "Morning review" to "Inbox" (from ReviewQueuePage.tsx line 627).
- B2: Screen 2 completely reshaped. It is now the Inbox page with "Needs Review" tab active. Two existing abbreviated queue cards are shown first (preserving the existing pattern). A new quality-checks queue card follows, which expands to reveal a drill-in panel. Inside the expansion: three verdict sub-rows (deterministic pass, hybrid gate fail, inconclusive catalogue-miss), each individually expandable to show the VerdictDrillIn detail. This matches the expansion-inside-queue-card pattern from the companion prototype.
- B3: Removed invented "Resolved" tab. Tabs are now "Briefs" and "Needs Review" only, matching ReviewQueuePage.tsx exactly.
- S1: Validator picker in Screen 1 now shows human-readable names as the primary option label (e.g. "Output Schema Valid") with slug shown as muted secondary text below the select (e.g. "output_schema_valid"). Same pattern applied to precondition pickers in hybrid mode (e.g. "Output Non-Empty" with slug hint below).
- S2: Screen 1 default state: only check 1 (deterministic) is shown fully expanded. Checks 2 (hybrid) and 3 (semantic) are visible as collapsed rows with name + kind badge; clicking expands them.
- S3: Kind selector field label renamed from "Evaluation method" to "Check kind" on all three check cards.
- S4: Prototype instruction text moved out of page body into a yellow banner strip above the page shell (above `.page-shell`, below `.proto-nav`), separately toggled per screen.
- S5: Screen 2 no longer has an invented subtitle. The subtitle "Briefs assigned to your AI team and agent actions awaiting approval." is inherited directly from ReviewQueuePage.tsx line 628.
- C2 (latency): Latency row removed from all evidence tables in Screen 2 verdict drill-ins. Deferred as directed.

**Deferred findings (noted, not implemented):**
- C1: Validator slug link to catalogue browser — deferred as Surface 3, per reviewer direction.
- C2: Latency row in evidence table — removed from user-facing drill-in as directed; noted as admin-only concern.

**Frontend-design-principles checks:**
- Start with primary task: yes — Screen 1 task is "configure a quality check kind"; Screen 2 task is "understand why a verdict was produced" via progressive disclosure inside the Inbox.
- Default to hidden: yes — checks 2 and 3 are collapsed; verdict drill-ins are collapsed; evidence detail is behind a row click.
- One primary action: yes — Screen 1: "Create scorecard"; Screen 2: no commit action (read-only review context).
- Inline state: yes — verdict outcome dot, score, and badge visible on the sub-row summary; full evidence behind one click.
- Re-check passed: yes — the Inbox is the existing familiar surface; the quality-checks card reads "3 quality checks evaluated" with pass/fail/inconclusive counts inline; a non-technical operator can read the verdict without encountering jargon.
- Extends existing surface: yes — both screens extend existing pages (ScorecardCreatePage.tsx, ReviewQueuePage.tsx), no new page invented.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/deterministic-validators.html` (edited in place)
- `tasks/builds/deterministic-validators/mockup-log.md` (appended)

---

## Round 3 — 2026-05-18
**Operator feedback:** Admin-gate Screen 1. Kind/validator controls are Synthetos staff only. Split Screen 1 into Operator view (default, no kind/validator/precondition/safetyClass fields visible) and Admin view (same form plus "Validator configuration (Synthetos staff only)" section below each check). Add "View as: Operator | Admin" toggle in the yellow prototype banner. Screen 2 unchanged.

**Codebase grounding (Step 0a) — PER SCREEN (mandatory):**
- Screen 1 (quality-check editor): extends `client/src/pages/govern/ScorecardCreatePage.tsx`. Re-read this round to confirm the operator baseline: the production check card contains only name input, description input, pass mark number input, enabled checkbox, and a remove button. No kind selector, no validator dropdown, no precondition list, no safetyClass toggle. The operator view in this prototype now exactly matches that baseline. The admin view adds a `staff-config-section` container below the operator fields, containing all new fields (kind pills, validator config, safety toggle).
- Screen 2 (Inbox with verdict drill-in): extends `client/src/pages/ReviewQueuePage.tsx`. No changes this round.

**Codebase grounding — round-wide:**
- All files read this round:
  - `docs/frontend-design-principles.md`
  - `client/src/pages/govern/ScorecardCreatePage.tsx`
  - `prototypes/deterministic-validators.html` (prior round, read before editing)
  - `tasks/builds/deterministic-validators/mockup-log.md`
- Vocabulary / conventions inherited (quoted from codebase):
  - ScorecardCreatePage.tsx operator fields: name input, description textarea, pass mark number, enabled checkbox (`rounded border-slate-300`), remove button (`text-xs text-red-500 hover:text-red-700`) -- all inherited unchanged into operator view
  - Admin-only controls pattern from `docs/frontend-design-principles.md` § *Admin-only controls*: "Hide entirely from non-admin users. Do not render disabled; do not render with 'you can't do this' copy." and "Use a small 'Org admin only' pill on the field label in the org-admin view itself" -- applied as the `Staff` pill in the section header
- New dedicated pages proposed: none. Both screens extend existing surfaces.

**Changes made:**
- Added CSS: `.view-as-toggle`, `.view-as-label`, `.view-as-btn`, `.view-as-btn.active` for the banner toggle. Added `.staff-config-section`, `.staff-config-header`, `.staff-config-title`, `.staff-pill` for the staff-only container. Updated `.proto-instruction-banner` to `flex-wrap: wrap` so the toggle wraps gracefully on narrow viewports.
- Screen 1 banner: added "View as: Operator | Admin" toggle buttons inline in the yellow prototype banner.
- Each check card restructured: operator fields (name, description, pass mark, enabled, remove) remain at top level. All kind/validator/safety fields moved into a `.staff-config-section.admin-only-section` div with a "Validator configuration" header and a muted "Staff" pill badge. Each staff section is `display:none` by default (operator view default).
- Collapsed check rows: kind badges ("Hybrid", "Semantic") on collapsed cards also marked `.admin-only-section` and hidden by default, since the kind concept is not visible to operators.
- JS: added `setViewAs(mode)` function that toggles `.active` on the two banner buttons and sets `display: block/none` on all `.admin-only-section` elements. Added `currentViewAs` state variable so `expandCheck()` can apply the current view state to newly expanded cards. `DOMContentLoaded` calls `setViewAs('operator')` as a belt-and-suspenders fallback (inline `style="display:none;"` already handles initial state).
- Screen 2: no changes.

**Frontend-design-principles checks:**
- Start with primary task: yes -- operator view primary task is "configure a quality check" (name, pass mark, enable/disable). Admin view adds validator wiring as a secondary concern in a clearly separated section.
- Default to hidden: yes -- operator view shows nothing new vs today's production form; all new fields hidden by default. Admin section only appears on explicit toggle.
- One primary action: yes -- "Create scorecard" button unchanged; no new commit actions.
- Inline state: yes -- the Staff pill is inline in the section header; no extra pages or modals.
- Re-check passed: yes -- operator view is identical to the current production scorecard form in information density. Non-technical operator sees name, description, pass mark, enabled, remove. Nothing else.
- Extends existing surface: yes -- both screens extend existing pages. Admin-only controls pattern applied per `docs/frontend-design-principles.md` § *Admin-only controls* and the relaxed complexity budget for admin-only views.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/deterministic-validators.html` (edited in place)
- `tasks/builds/deterministic-validators/mockup-log.md` (appended)
