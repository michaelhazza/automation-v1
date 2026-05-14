# Mockup log — composite-quality-dashboard

## Round 1 — 2026-05-14 (initial draft)

**Operator feedback:** Initial draft — no prior feedback.

---

### 1. Codebase grounding (Step 0a) — PER SCREEN

**Screen 1a — `home-with-chip-green.html`**
Extends: `client/src/pages/operate/HomePage.tsx`
Components: `MetricCard` (border/padding/value/label/sub pattern), `PageShell` (.page-shell .page-content), `RunActivityChart` (bar chart shape), `ActivityRow` (table).

**Screen 1b — `home-with-chip-amber.html`**
Extends: `client/src/pages/operate/HomePage.tsx`
Same as 1a. Only chip border colour, score, trend arrow, sub-label differ.

**Screen 1c — `home-with-chip-red.html`**
Extends: `client/src/pages/operate/HomePage.tsx`
Same as 1a/1b. Safety banner appears above KPI grid, separate from chip (brief §3.2).

**Screen 2a — `review-queue-green.html`**
Extends: `client/src/pages/ReviewQueuePage.tsx` + `client/src/pages/operate/InboxPage.tsx` (band concept reference)
Components: page header (lines 736-780), tab-group pill (lines 790-810), `renderItemCard` queue item (lines 507-592), btn action row.

**Screen 2b — `review-queue-amber.html`**
Extends: `client/src/pages/ReviewQueuePage.tsx`
Same as 2a. Overdue items float to top with amber left-border. Section dividers replicate InboxPage.tsx band pattern.

**Screen 2c — `review-queue-red.html`**
Extends: `client/src/pages/ReviewQueuePage.tsx` + `client/src/pages/operate/InboxPage.tsx`
Safety banner above composite header. Safety item pinned above overdue section.

**Screen 3a — `review-queue-drill-in-dimensions.html`**
Extends: `client/src/pages/ReviewQueuePage.tsx` (queue dimmed behind modal)
New component: DrillInDialog. Modal overlay from ReviewQueuePage.tsx NewBriefModal (lines 147-213). Four collapsible dimension rows with inline 80x24px SVG sparklines.

**Screen 3b — `review-queue-drill-in-quality-expanded.html`**
Extends: `client/src/pages/ReviewQueuePage.tsx` + DrillInDialog Level 3
Breadcrumb within dialog. 30-day sparkline with band-coloured background regions. Verdict list rows linking to existing run detail pages. Insight box (deterministic rule, not LLM).

**Screen 4a — `system-quality-org-rollup.html`**
Extends: `client/src/pages/SystemPnlPage.tsx`
Components: `PnlKpiCard` (4-column grid), `PnlGroupingTabs` (view toggle), table + sort headers, footer note row (lines 352-359). New dedicated page justified: no existing surface covers system-tier cross-org quality rollup.

**Screen 4b — `system-quality-org-drilldown.html`**
Extends: `client/src/pages/SystemPnlPage.tsx`
Same shell as 4a. Three-level breadcrumb. Org summary card. Dimension breakdown table (staff-only extra).

**Screen 4c — `system-quality-subaccount-drilldown.html`**
Extends: `client/src/pages/SystemPnlPage.tsx`
Three-level breadcrumb. Per-skill table with monospace skill slugs, four sub-score columns + mini progress bars, run volume. Staff insight box. Footer note: per-skill is staff-only.

---

### 2. Codebase grounding — round-wide

**All files read:** `docs/frontend-design-principles.md`, `tasks/research-briefs/composite-quality-dashboard-dev-brief.md`, `client/src/pages/operate/HomePage.tsx`, `client/src/pages/ReviewQueuePage.tsx`, `client/src/pages/MemoryReviewQueuePage.tsx`, `client/src/pages/operate/InboxPage.tsx`, `client/src/pages/SystemPnlPage.tsx`, `client/src/components/PageShell.tsx`, `client/src/components/MetricCard.tsx`, `client/src/index.css`

**Vocabulary / conventions inherited:**

From `index.css`: font Inter, body bg `#f8fafc`, `.btn-primary` bg `#4f46e5` (indigo-600), `.btn-success` bg `#059669`, `.btn-secondary` border `#cbd5e1`, `.badge-failed` bg `#fef2f2` color `#dc2626`, `.badge-pending` bg `#fffbeb` color `#d97706`, `.data-table thead th` font-size 11px uppercase letter-spacing 0.06em bg `#f8fafc`, `.page-content` max-width 1280px padding 28px, shimmer animation `linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%)`

From `HomePage.tsx`: greeting `text-[28px] font-extrabold text-slate-900 tracking-tight`, KPI grid `grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]`, personal zone label `text-[11px] font-bold text-indigo-600 uppercase tracking-widest`, chart section `bg-white border border-slate-200 rounded-xl p-5 mb-6`

From `ReviewQueuePage.tsx`: tab group `flex gap-1 p-1 bg-slate-100 rounded-xl mb-6 w-fit`, active tab `bg-white text-slate-900 shadow-sm`, queue card `p-4 bg-white border border-slate-200 rounded-lg`, back link `text-[14px] text-indigo-600`, modal backdrop `fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm`

From `MetricCard.tsx`: card `bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3`, icon `w-9 h-9 rounded-lg`, value `text-[22px] font-extrabold text-slate-900 leading-none`, label `text-[12px] font-semibold text-slate-500 uppercase tracking-wider`

From `SystemPnlPage.tsx`: page wrapper `min-h-screen bg-slate-50; max-w-7xl mx-auto px-6 py-6`, h1 `text-2xl font-semibold text-slate-900`, view toggle `inline-flex rounded-md border border-slate-200 bg-white p-0.5 shadow-sm`, active btn `bg-indigo-600 text-white`, KPI grid `grid grid-cols-1 md:grid-cols-4 gap-4 mb-6`, footer `mt-10 pt-6 border-t border-slate-200 text-xs text-slate-500`

**New dedicated pages proposed:** `/system/quality` (screen 4a) — justified because no existing surface covers system-tier cross-org quality aggregation. All operator-facing surfaces are extensions of existing pages (ReviewQueuePage, HomePage). No new operator nav items added.

---

### 3. Changes made

- Created `_shared.css` — shared styles derived from `client/src/index.css` tokens
- Created `index.html` — clickable operator review entry point linking all 12 screens
- Created `home-with-chip-green.html` — home page with green quality chip (composite 84)
- Created `home-with-chip-amber.html` — home page with amber quality chip (composite 67)
- Created `home-with-chip-red.html` — home page with red quality chip (composite 52) + safety banner above grid
- Created `review-queue-green.html` — morning review queue with green composite header
- Created `review-queue-amber.html` — morning review queue with amber composite header, 5 overdue items floated to top
- Created `review-queue-red.html` — red composite header + safety regression banner + pinned safety item
- Created `review-queue-drill-in-dimensions.html` — drill-in dialog Level 2: four dimensions, Quality expanded
- Created `review-queue-drill-in-quality-expanded.html` — drill-in dialog Level 3: Quality raw verdicts and corrections
- Created `system-quality-org-rollup.html` — /system/quality staff admin, org-level table (10 orgs shown)
- Created `system-quality-org-drilldown.html` — drilled into Acme Marketing Co., subaccount table + dimension grid
- Created `system-quality-subaccount-drilldown.html` — drilled into Content Team, per-skill breakdown table

---

### 4. Frontend-design-principles checks

**Home page screens (1a, 1b, 1c):**
- Start with primary task: yes — home page unchanged except chip tile; task is "see the state of my AI team"
- Default to hidden: yes — chip shows score + trend + label only; no drill-in on home per locked decision
- One primary action: yes — click chip to go to review queue
- Inline state: yes — composite number + band colour conveys health without a chart
- Re-check passed: yes — non-technical operator sees one new tile; nothing else changed
- Extends existing surface: yes — extends `HomePage.tsx` KPI grid

**Review queue screens (2a, 2b, 2c):**
- Start with primary task: yes — operator opens queue to approve/reject items; header is context not task
- Default to hidden: yes — header is minimal (number, band, trend, callout, one link)
- One primary action: yes — approve/reject items
- Inline state: yes — overdue amber borders and safety banner communicate state inline
- Re-check passed: yes — header readable in under 10 seconds; queue immediately below
- Extends existing surface: yes — extends `ReviewQueuePage.tsx`

**Drill-in dialog screens (3a, 3b):**
- Start with primary task: yes — operator understands WHY score is amber before acting
- Default to hidden: yes — Level 2 and 3 are 1-2 clicks deep; not on default view
- One primary action: yes — close dialog and return, or follow a link to a specific run/amendment
- Inline state: yes — sparklines, sub-scores, verdict rows communicate state; no separate dashboard page
- Re-check passed: yes — operator reads Quality 71, Stability 63, Cost 88, Capacity 46; problem areas obvious
- Extends existing surface: yes — dialog overlays `ReviewQueuePage.tsx`

**System quality admin screens (4a, 4b, 4c):**
- Start with primary task: yes — staff identifies which orgs need attention
- Default to hidden: N/A — relaxed admin budget applies (frontend-design-principles.md §exception)
- One primary action: yes — drill into the worst org/subaccount
- Inline state: yes — band-coloured score cells + trend arrows in table
- Re-check passed: yes — Synthetos staff, not consumer operators; complexity tolerance is higher
- Extends existing surface: yes (4b/4c); new dedicated page (4a) explicitly justified

---

### 5. Rule violations flagged

None. All consumer-facing screens pass the five hard rules. Staff screens operate under the documented admin-view relaxed budget exception. No em-dashes in any UI copy or sample data.

---

### 6. Open questions for the operator

These are design decisions the mockups forced a choice on, not definitively resolved by the brief:

1. **Home chip placement:** Mocked as a new tile in the KPI grid (same MetricCard, 2px coloured border). Alternative: a narrow strip above the grid. Which fits better?
2. **Safety banner on home page:** Mocked above the KPI grid. Confirm this placement, or should it be a persistent top-of-page notification strip?
3. **Composite header width on review queue:** Full-width card. Could be narrower (max 520px). Confirm.
4. **Dialog vs slide-over:** Mocked as a centered modal. Slide-over (right panel) is an existing pattern in SystemPnlPage (PnlCallDetailDrawer). Which feels more natural?
5. **"All systems healthy" callout text:** Mocked as a subdued note in green state. Brief says "omit or show." Should green state omit the callout entirely, or show positive confirmation?
6. **Sparkline colour in green state:** Mocked as light-green (#86efac). Should it match the band green exactly (#16a34a) or stay muted?
7. **Overdue section dividers in amber/red queue:** Mocked as uppercase section labels ("Overdue (5)", "Recent (8)"). Alternative: no dividers, amber border alone. Which is clearer?
8. **Refresh Now button:** Mocked as low-emphasis text link below "Details." Should it be a more prominent button?
9. **System quality page title:** Mocked as "System Quality" (matching "System P&L"). Alternatives: "System Health", "Agent Quality." Confirm.
10. **Composite formula in dialog:** Mocked as a small formula line at the bottom of Level 2 dialog. Useful for transparency; possibly confusing for operators. Show only in staff view, or always?

---

### 7. Files modified

All files created fresh in Round 1:

- `prototypes/composite-quality-dashboard/_shared.css`
- `prototypes/composite-quality-dashboard/index.html`
- `prototypes/composite-quality-dashboard/home-with-chip-green.html`
- `prototypes/composite-quality-dashboard/home-with-chip-amber.html`
- `prototypes/composite-quality-dashboard/home-with-chip-red.html`
- `prototypes/composite-quality-dashboard/review-queue-green.html`
- `prototypes/composite-quality-dashboard/review-queue-amber.html`
- `prototypes/composite-quality-dashboard/review-queue-red.html`
- `prototypes/composite-quality-dashboard/review-queue-drill-in-dimensions.html`
- `prototypes/composite-quality-dashboard/review-queue-drill-in-quality-expanded.html`
- `prototypes/composite-quality-dashboard/system-quality-org-rollup.html`
- `prototypes/composite-quality-dashboard/system-quality-org-drilldown.html`
- `prototypes/composite-quality-dashboard/system-quality-subaccount-drilldown.html`
- `tasks/builds/composite-quality-dashboard/mockup-log.md`
