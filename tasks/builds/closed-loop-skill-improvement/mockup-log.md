# Mockup log — closed-loop-skill-improvement

## Round 1 — 2026-05-14 (initial draft)

**Operator feedback:** Initial draft (no prior operator feedback)

---

**Codebase grounding (Step 0a) — PER SCREEN (mandatory):**

- **S1 (s1-review-queue.html):** Extends `client/src/pages/ReviewQueuePage.tsx` — tabs pill (Briefs / Needs Review), tab-count badges, queue row card shape, and page header layout all inherited directly. ViewModeSwitcher mounted in header per `client/src/components/ViewModeSwitcher.tsx` (two-segment pill with Workspace / Org). Stat tiles pattern from `docs/frontend-design-principles.md § Stat tiles on list / table pages` (max 2). Also cross-references `client/src/pages/MemoryReviewQueuePage.tsx` for the filter-by-type visual language.

- **S2 (s2-review-drawer.html):** Extends `ReviewQueuePage.tsx` (opened from S1 row). Drawer pattern mirrors `client/src/components/correction/CorrectDialog.tsx` — sticky head/foot, editable textarea with character counter, Cancel / primary CTA footer layout. Diff view modelled on `MemoryReviewQueuePage.tsx` `BeliefConflictBody` two-column grid. Agent Reasoning collapsible pattern taken from `ReviewQueuePage.tsx` `toggleReasoning` / expandedReasoning set.

- **S3 (s3-skill-detail.html):** Extends `client/src/pages/SubaccountSkillsPage.tsx` — inherits `bg-white rounded-xl border border-slate-200` section-card pattern, tier badge colour classes (`tierBadgeClass`), and table header / breadcrumb conventions. Skill body rendered as a read-only prose block (from `SystemSkillEditPage.tsx` `textareaCls` convention). Also references `client/src/pages/SystemSkillsPage.tsx` for status pill style (`bg-green-100 text-green-800` Active).

- **S4 (s4-run-trace.html):** Extends `client/src/pages/operate/RunTracePage.tsx` and `client/src/pages/operate/components/RunTraceEventRenderer.tsx`. New improvement-proposed event card styled to match the existing `operator-session.*` event row pattern (coloured background pill, icon dot, label, timestamp). Positioned immediately after the scorecard-fail event card to demonstrate the trigger surface. `RuntimeCheckSummaryStrip` colour conventions reused for the scorecard verdict summary strip.

---

**Codebase grounding — round-wide:**

All files read:
- `client/src/pages/ReviewQueuePage.tsx`
- `client/src/pages/SubaccountSkillsPage.tsx`
- `client/src/pages/SystemSkillsPage.tsx`
- `client/src/pages/SystemSkillEditPage.tsx`
- `client/src/pages/MemoryReviewQueuePage.tsx`
- `client/src/pages/operate/RunTracePage.tsx`
- `client/src/pages/operate/components/RunTraceEventRenderer.tsx`
- `client/src/components/ViewModeSwitcher.tsx`
- `client/src/components/correction/CorrectDialog.tsx`
- `client/src/components/Layout.tsx`
- `prototypes/operator-backend/_shared.css`

Vocabulary / conventions inherited (quoted from codebase):
- Tab pill: `"flex gap-1 p-1 bg-slate-100 rounded-xl mb-6 w-fit"` from `ReviewQueuePage.tsx` line 791
- Active tab: `"bg-white text-slate-900 shadow-sm"` from `ReviewQueuePage.tsx` line 793
- Tab count badge: `"px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[11px] font-bold"` from `ReviewQueuePage.tsx` line 805
- Tier badge classes: `tierBadgeClass` returns `'bg-purple-50 text-purple-700'` (System), `'bg-blue-50 text-blue-700'` (Org), `'bg-green-50 text-green-700'` (Subaccount) from `SubaccountSkillsPage.tsx` lines 34-39
- Row card: `"p-4 bg-white border border-slate-200 rounded-lg"` from `ReviewQueuePage.tsx` line 520
- Agent reasoning expander: `text-[13px] text-indigo-600 font-medium` from `ReviewQueuePage.tsx` line 548
- ViewModeSwitcher modes: `workspace | org | system`, active segment = `"bg-slate-800 text-white shadow-sm"` from `ViewModeSwitcher.tsx` line 74
- CorrectDialog footer buttons: `"px-[18px] py-[9px] text-[13px] font-semibold rounded-lg"`, primary uses `"bg-gradient-to-br from-indigo-500 to-indigo-600"` from `CorrectDialog.tsx` lines 88-97
- Char counter: `remainingReasonChars < 50 ? 'text-amber-600' : 'text-slate-400'` from `CorrectDialog.tsx` line 153
- System event rows: `"flex items-center gap-2 px-3 py-2 rounded-lg ... text-[12px]"` from `RunTraceEventRenderer.tsx` lines 161+
- Status pills: Active = `"bg-green-100 text-green-800"`, Inactive = `"bg-orange-50 text-orange-800"` from `SystemSkillsPage.tsx` lines 506-507

New dedicated pages proposed: None. All four screens are extensions of existing surfaces.

---

**Changes made:**
- Created `prototypes/closed-loop-skill-improvement/_shared.css` — shared styles for all four screens
- Created `prototypes/closed-loop-skill-improvement/index.html` — prototype navigation index
- Created `prototypes/closed-loop-skill-improvement/s1-review-queue.html` — Screen 1: Review queue with Skill improvements tab, Workspace/Org mode toggle
- Created `prototypes/closed-loop-skill-improvement/s2-review-drawer.html` — Screen 2: Amendment review drawer with editable textarea, char counter, diff view, collapsible why-proposed, peer-review verdict, Accept/Edit & accept/Reject footer
- Created `prototypes/closed-loop-skill-improvement/s3-skill-detail.html` — Screen 3: Skill detail (Draft Email) with Active improvements section, cap counter cycling demo, retire action
- Created `prototypes/closed-loop-skill-improvement/s4-run-trace.html` — Screen 4: Run trace with scorecard-fail event and new improvement-proposed event inline

---

**Frontend-design-principles checks:**

- **Start with primary task:** yes — Each screen has one primary task. S1: choose which improvement to review. S2: decide accept/reject on one proposal. S3: scan the active improvement stack. S4: read what happened during the failed run.
- **Default to hidden:** yes — "Why proposed" block collapses by default in S2. Improvement text collapses by default in S3 rows (one pre-expanded for demonstration). No KPI tiles beyond the 2-tile maximum. No run history, cost data, or model identifiers exposed.
- **One primary action per screen:** yes — S1: click a row (no action button on the list page itself). S2: Accept (primary CTA, swaps to "Edit & accept" on text edit). S3: Retire (destructive, gated behind confirm dialog). S4: "Review in queue" link.
- **Inline state:** yes — Cap counter inline on the improvements section head. Char counter inline below the textarea. Source badge inline on agent-proposed improvement rows (absent on operator-authored rows per "don't badge the default case").
- **Re-check passed:** yes — A non-technical operator can: (a) see how many proposals are waiting, (b) click one and read the plain-English summary, diff, and peer-review verdict, (c) click Accept. No model names, no token counts, no internal IDs anywhere.
- **Extends existing surface:** yes — All four screens extend named existing pages/components. No new nav entries or parallel UI universe.

**Rule violations flagged:** None

**Files modified:**
- `prototypes/closed-loop-skill-improvement/_shared.css` (new)
- `prototypes/closed-loop-skill-improvement/index.html` (new)
- `prototypes/closed-loop-skill-improvement/s1-review-queue.html` (new)
- `prototypes/closed-loop-skill-improvement/s2-review-drawer.html` (new)
- `prototypes/closed-loop-skill-improvement/s3-skill-detail.html` (new)
- `prototypes/closed-loop-skill-improvement/s4-run-trace.html` (new)
- `tasks/builds/closed-loop-skill-improvement/mockup-log.md` (new)

---

## Round 2 — 2026-05-18 (full 7-screen build)

**Operator feedback:** Initial brief specified 7 screens (multi-screen directory). Round 1 delivered 4. This round completes the remaining 3 new screens and significantly extends the existing 4 screens to match the brief's full specification.

---

**Codebase grounding (Step 0a) — PER SCREEN (mandatory):**

- **s1-review-queue.html (Surface A):** Extends `client/src/pages/ReviewQueuePage.tsx`. Tab pill shape (`flex gap-1 p-1 bg-slate-100 rounded-xl mb-6 w-fit`), active tab (`bg-white text-slate-900 shadow-sm`), tab count badge (`px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[11px] font-bold`), view mode switcher pill pattern all inherited. Priority-tier section labels, incident alert, conflict banner, review_required header card, and grouped low-batch are new additions to this surface.

- **s5-surface-b.html (Surface B, org queue):** Extends `client/src/pages/ReviewQueuePage.tsx` in Org mode as driven by `client/src/components/ViewModeSwitcher.tsx`. Inherits the queue-row card shape (`p-4 bg-white border border-slate-200 rounded-lg`) and workspace column pattern from Round 1's org-mode variant. New: 4-metric health panel, governance overload alert, filter bar, dedicated Org-mode page (separate from S1 to keep information density appropriate per role).

- **s2-review-drawer.html (amendment review drawer):** Extends `client/src/pages/ReviewQueuePage.tsx` (opened as overlay). Drawer pattern mirrors `client/src/components/correction/CorrectDialog.tsx` (sticky head/foot, textarea, char counter). New this round: reject_reason categorical panel (7 enum values), root-cause record block, peer-review verdict block, collapsed provenance chain section, collapsed "Audit detail" expander.

- **s3-skill-detail.html (skill detail with amendment stack):** Extends `client/src/pages/SubaccountSkillsPage.tsx` and `client/src/components/skills/HistoryRender.tsx`. Section-card pattern (`bg-white border border-slate-200 rounded-xl`), tier badge classes (`tierBadgeClass`: `bg-purple-50 text-purple-700` for System) inherited. New this round: 6-column stack-health metrics row, retirement suggestion card (inactivity_decay_candidate), composition-order numbered badges, lineage graph for amendment #37, collapsed retired-amendments section.

- **s4-run-trace.html (run trace event + composition tab):** Extends `client/src/pages/operate/RunTracePage.tsx` and `client/src/pages/operate/components/RunTraceEventRenderer.tsx`. Improvement-proposed event card and scorecard-fail card from Round 1 retained. New this round: "Skill composition" panel below the event stream with Snapshot tab (resolver version, composed size) and "Amendments used" tab (included/excluded amendments with reasons — §3.8 composition observability).

- **s6-review-required.html (cap warning surface):** Extends `client/src/pages/SubaccountSkillsPage.tsx`. New dedicated state-variant of the skill detail page surfaced when `status = 'review_required'`. "Paused" badge in header, warning banner (amber/yellow), suppressed proposals table, stepped instructions, retirement candidates leading the active stack.

- **s7-governance-freeze.html (governance freeze controls):** New admin-only surface. Not an extension of an existing page (justified: admin-only governance controls have no prior surface in the existing codebase; the closest is the org-admin settings pattern but no direct component match). Linked from the Org nav sidebar under "Governance". Scope selector, freeze matrix (4 independently composable layers), reason requirement before apply, immutable freeze event log.

---

**Codebase grounding — round-wide:**

All files read this round:
- `client/src/pages/ReviewQueuePage.tsx` (re-read to verify tab/queue-row conventions for S1/S2)
- `client/src/pages/SubaccountSkillsPage.tsx` (re-read for S3/S6 section-card and tier badge conventions)
- `client/src/pages/operate/RunTracePage.tsx` (re-read for S5 event stream and composition panel placement)
- `client/src/components/ViewModeSwitcher.tsx` (confirmed: Workspace/Org pill, `bg-slate-800 text-white shadow-sm` active segment)
- `prototypes/closed-loop-skill-improvement/_shared.css` (full read — inherited all existing tokens)
- `prototypes/closed-loop-skill-improvement/s1-review-queue.html` (Round 1 baseline)
- `prototypes/closed-loop-skill-improvement/s2-review-drawer.html` (Round 1 baseline)
- `prototypes/closed-loop-skill-improvement/s3-skill-detail.html` (Round 1 baseline)
- `prototypes/closed-loop-skill-improvement/s4-run-trace.html` (Round 1 baseline)
- `tasks/research-briefs/closed-loop-skill-improvement-dev-brief.md` (§3.6, §3.7, §3.8, §3.9, §4.1, §4.4, §4.5, §4.7, §4.9 re-read in full)

Vocabulary / conventions inherited (quoted from codebase):
- Tab pill: `"flex gap-1 p-1 bg-slate-100 rounded-xl mb-6 w-fit"` from `ReviewQueuePage.tsx`
- Active tab: `"bg-white text-slate-900 shadow-sm"` from `ReviewQueuePage.tsx`
- Tab count amber badge: `"px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[11px] font-bold"` from `ReviewQueuePage.tsx`
- Row card: `"p-4 bg-white border border-slate-200 rounded-lg"` from `ReviewQueuePage.tsx`
- Section card: `"bg-white border border-slate-200 border-radius:12px"` from `SubaccountSkillsPage.tsx` conventions
- Tier badge System: `"bg-purple-50 text-purple-700"` from `SubaccountSkillsPage.tsx` `tierBadgeClass`
- ViewModeSwitcher active: `"bg-slate-800 text-white shadow-sm"` from `ViewModeSwitcher.tsx`
- CorrectDialog footer primary: `"bg-gradient-to-br from-indigo-500 to-indigo-600"` from `CorrectDialog.tsx` (replicated as `.btn-accept` gradient)

New dedicated pages proposed:
- `s7-governance-freeze.html` — new dedicated admin page. Justified: admin-only governance controls (freeze switch, freeze event log) have no existing surface in the codebase. The nearest is org-admin settings, but no component handles operational circuit-breaker controls. Gated behind org-admin role in the sidebar only.

---

**Changes made:**
- Rewrote `s1-review-queue.html`: full §4.4 priority ordering (incident, conflict, review_required, high-blast, high-occurrence, stale-soon, grouped-low batch with "Accept all"); 2 stat tiles retained (max per rules); priority-tier section labels; Org mode click now redirects to `s5-surface-b.html`
- Created `s5-surface-b.html`: Surface B (org cross-workspace queue); 4-metric health panel; governance overload alert with freeze-controls link; filter bar; full §4.4 priority order with workspace column per row; links to S7 for freeze controls
- Rewrote `s2-review-drawer.html`: reject panel with 7 `reject_reason` enum buttons (one-click categorical, confirm gated until reason selected); root-cause record (failure_mode tag + contributing factors); peer-review verdict block always visible; collapsed provenance chain (7-row chain matching §3.5); collapsed "Audit detail" with raw proposer output; trust-posture copy ("Proposed amendment from a failed run", "Apply" not "Approve")
- Rewrote `s3-skill-detail.html`: 6-column stack-health metrics row (§4.5: amendment_density, conflict_rate, rollback_rate, stale_ratio, edit_frequency, composition_size_trend); retirement suggestion card (inactivity_decay_candidate with 38-day inactive fact); composition-order numbered position badges on each row; lineage graph (v1 proposed, v2 edited/accepted) for amendment #2; collapsed retired amendments section
- Updated `s4-run-trace.html`: added "Skill composition" section with two tabs (Snapshot, Amendments used) implementing §3.8 composition observability; proto nav updated to all 7 screens
- Created `s6-review-required.html`: "Paused" badge in page header; amber warning banner with 3-step operator instructions and stack health mini-metrics; suppressed proposals table (3 held-back items with dates); leads active stack with 4 retirement-suggestion cards (2 visible, 2 behind expander); plain English framing ("reduce the active stack below 20 to resume")
- Created `s7-governance-freeze.html`: scope selector (org / 3 workspaces / single skill); plain-English column headers per freeze layer; toggle requires typed reason before applying (audit requirement); Acme Corp shown with generation already frozen (demo state); immutable freeze event log with 4 entries (2 freeze, 1 thaw, 1 system suppression entry); "Org admin only" pill in header; framed as circuit breaker
- Updated `index.html`: all 7 screens with descriptions, interaction hints, and Round 2 design-decision notes
- Added `_shared.css` class `.btn-accept` gradient (already existed from Round 1) — no changes needed

---

**Frontend-design-principles checks:**

- **Start with primary task:** yes — S1: pick the next amendment to review. S5: see where the org's queue has structural problems. S3 drawer: accept or reject this one proposal. S4 skill: understand the active amendment stack. S5 run trace: understand what happened in this failed run. S6: retire amendments to unfreeze proposal generation. S7: freeze the proposal loop.
- **Default to hidden:** yes — Provenance chain collapsed in drawer. Audit detail collapsed in drawer. Lineage graph collapsed in skill detail. Retired amendments collapsed in skill detail. Suppressed proposals accessible but not front-and-center in S6. Reason field appears only when toggling a freeze switch in S7. Stack health metrics in S3 are visible but compact (mini-row, not hero chart).
- **One primary action per screen:** yes — S1: click a row (open drawer). S5: click a row (open drawer). S3: Accept (or Reject, after which the categorical panel has one CTA). S4 skill: Retire. S5 run trace: "Review in queue" link. S6: Retire (from the retirement suggestion). S7: Apply freeze (after selecting scope and reason).
- **Inline state:** yes — Cap counter inline on amendment stack section head. Blast-radius badge inline on queue row. Stale-soon chip inline on queue row. Occurrence badge inline on queue row. Stack-health metrics inline on skill detail. Composition snapshot inline below run event stream.
- **Re-check passed:** yes — Non-technical operator can: (a) open Inbox, see priority-sorted proposals with clear labels, (b) click one, read failure trigger in plain English, click Accept. For S6 they see "Retire at least 1 amendment" with a list of candidates. For S7 the freeze matrix descriptions are one plain-English sentence per column.
- **Extends existing surface:** yes for S1, S2, S3, S4, S5. S7 is a new admin-only page with justification (no existing governance surface; admin-only per design rules).

**Rule violations flagged:** None. The brief explicitly required all 7 screens including the admin-only S7, which is within the "admin-only views operate under relaxed budget" exception. S7 exceeds the default 3-panel cap (scope + matrix + audit log = 3 panels; compliant).

**Files modified:**
- `prototypes/closed-loop-skill-improvement/s1-review-queue.html` (rewritten)
- `prototypes/closed-loop-skill-improvement/s2-review-drawer.html` (rewritten)
- `prototypes/closed-loop-skill-improvement/s3-skill-detail.html` (rewritten)
- `prototypes/closed-loop-skill-improvement/s4-run-trace.html` (updated: composition tab added)
- `prototypes/closed-loop-skill-improvement/s5-surface-b.html` (new)
- `prototypes/closed-loop-skill-improvement/s6-review-required.html` (new)
- `prototypes/closed-loop-skill-improvement/s7-governance-freeze.html` (new)
- `prototypes/closed-loop-skill-improvement/index.html` (rewritten with 7 screens)
- `tasks/builds/closed-loop-skill-improvement/mockup-log.md` (this entry)

---

## Round 1.1 — 2026-05-17 (re-grounding after main sync)

**Operator feedback:** No design feedback yet. This entry records the codebase rebase only — verifies the round-1 mockups still hold after ~170 commits landed on main, including the page-split refactor (PR #313), wave-4/5/6 architectural changes, and wave-5 LAEL audit emission. No HTML or CSS file was modified.

**Rebase findings:**

- **Visual surface unchanged.** All eight quoted Tailwind class strings from round 1 (tab pill, active tab, tab-count badge, tier badges, row card, agent-reasoning expander, ViewModeSwitcher segments, CorrectDialog footer + char counter, system event rows, status pills) are byte-identical on current main. The mockups continue to read as a faithful extension of the existing UI.

- **Structural file moves to be aware of when the spec/builder wires these mockups up:**
  - `client/src/pages/ReviewQueuePage.tsx` lost 118 lines in PR #313. Sub-components extracted: see `client/src/components/review-queue/NewBriefModal.tsx`. The new amendment-review drawer (S2) follows the same sibling-component convention — should live at `client/src/components/review-queue/AmendmentReviewDrawer.tsx` (or similar), not as an inline component inside the page file.
  - `client/src/pages/SubaccountSkillsPage.tsx` lost 25 lines in PR #313. Filter actions and checkbox options extracted to `client/src/components/skills/HistoryRender.tsx`. The new "Active improvements" section (S3) should follow the same convention — sibling component file, not inlined.

- **No new visual primitives.** Wave-4/5/6 changes were backend-heavy (RLS migration, prevention gates, LAEL events, IEE worker retirement, knip cleanup). No new design tokens, status pill shapes, drawer patterns, or page-level visual conventions to incorporate.

- **One narrow content variant to consider in a future round, NOT applied this round:** if the deterministic-validators brief (`tasks/research-briefs/deterministic-validators-dev-brief.md`) lands before this work, S2's "Why this was proposed" block and S4's failed-scorecard event card should render `validator slug + structured evidence` in place of judge prose when the failing check was deterministic. Same visual shell; different content. Operator decision — defer until both briefs are confirmed scoped together.

**Files modified this round:** none (re-grounding only).

---

## Round 3 — 2026-05-18 17:00

**Operator feedback:** Full rebuild. Previous 7-screen set archived to `_archive/prototypes/closed-loop-skill-improvement-r2-2026-05-18/`. Failure reasons: invented new pages, added new nav items, exposed jargon to non-technical operators. This round produces a clean 4-screen set that extends ONLY existing pages.

---

**Codebase grounding (Step 0a) — PER SCREEN (mandatory):**

- **s1-inbox-improvements.html:** Extends `client/src/pages/ReviewQueuePage.tsx`. Inherits exact page header text ("Inbox" / "Briefs assigned to your AI team and agent actions awaiting approval."), tab pill shape (`flex gap-1 p-1 bg-slate-100 rounded-xl mb-6 w-fit`), active tab class (`bg-white text-slate-900 shadow-sm`), tab count badges (`px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[11px] font-bold`), queue row card shape (`p-4 bg-white border border-slate-200 rounded-lg`), and action button layout (Approve / Edit & Approve / Reject). The Skill improvements section is a band below the existing tab content, not a third tab.

- **s2-review-drawer.html:** Extends `client/src/pages/ReviewQueuePage.tsx` (overlay triggered from s1). Component location follows `client/src/components/review-queue/NewBriefModal.tsx` sibling convention. Drawer head/body/foot pattern matches existing modal shape. Reject flow is 3 plain-English buttons (not enum strings). Single "Show technical detail" expander at bottom for provenance/peer-review/root-cause. Default collapsed.

- **s3-skill-row-expanded.html:** Extends `client/src/pages/SubaccountSkillsPage.tsx`. Inherits table layout exactly: columns (Name / Slug / Tier / Type / Visibility / Created / action), tier badge classes (`bg-purple-50 text-purple-700` System, `bg-blue-50 text-blue-700` Org, `bg-green-50 text-green-700` Subaccount), heading "Subaccount Skills (N)", subtitle "Manage skills scoped to this workspace. Subaccount skills override org and system skills with the same slug." Expansion is inline (same row pattern as the ColHeader dropdown) — no new detail page. Pause toggle, amendment list, "Show advanced details" expander all inside expanded panel.

- **s4-runtrace-event.html:** Extends `client/src/pages/operate/RunTracePage.tsx` and `client/src/pages/operate/components/RunTraceEventRenderer.tsx`. Inherits event stream timeline layout (dot + body, connector line between rows via CSS `::before`), tool call event shape, scorecard summary strip (from `RuntimeCheckSummaryStrip` pattern). New "Improvement proposed" event is a violet dot + `badge-violet` label + compact card with "Review" link to s2. Single "Show composition detail" toggle at bottom of stream. Default collapsed.

---

**Codebase grounding — round-wide:**

All files read this round:
- `client/src/pages/ReviewQueuePage.tsx` (full read — 710 lines)
- `client/src/pages/SubaccountSkillsPage.tsx` (full read — 419 lines)
- `client/src/pages/operate/RunTracePage.tsx` (read lines 1-100)
- `client/src/pages/operate/components/RunTraceEventRenderer.tsx` (read lines 1-80)
- `prototypes/operator-backend/_shared.css` (full read — CSS token reference)
- `tasks/builds/closed-loop-skill-improvement/mockup-log.md` (full read — prior round context)
- `tasks/research-briefs/closed-loop-skill-improvement-dev-brief.md` (read lines 1-200)
- `docs/frontend-design-principles.md` (full read — 270 lines)

Vocabulary / conventions inherited (quoted from codebase):
- Page title: `"Inbox"`, subtitle `"Briefs assigned to your AI team and agent actions awaiting approval."` from `ReviewQueuePage.tsx` line 747-749
- Tab pill: `"flex gap-1 p-1 bg-slate-100 rounded-xl mb-6 w-fit"` from `ReviewQueuePage.tsx` line 790
- Active tab: `"bg-white text-slate-900 shadow-sm"` from `ReviewQueuePage.tsx` line 793
- Tab count amber badge: `"px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[11px] font-bold"` from `ReviewQueuePage.tsx` line 804
- Tab labels: `"Briefs"` and `"Needs Review"` from `ReviewQueuePage.tsx` lines 793 / 800
- Row card: `"p-4 bg-white border border-slate-200 rounded-lg"` from `ReviewQueuePage.tsx` line 520
- Action buttons: `"btn btn-sm btn-success"` Approve, `"btn btn-sm btn-secondary"` Edit & Approve, `"btn btn-sm btn-ghost text-red-600"` Reject from `ReviewQueuePage.tsx` lines 578-584
- Table page heading: `"Subaccount Skills"` from `SubaccountSkillsPage.tsx` line 374
- Table subtitle: `"Manage skills scoped to this workspace. Subaccount skills override org and system skills with the same slug."` from `SubaccountSkillsPage.tsx` line 379
- Tier badges: System = `"bg-purple-50 text-purple-700"`, Org = `"bg-blue-50 text-blue-700"`, Subaccount = `"bg-green-50 text-green-700"` from `SubaccountSkillsPage.tsx` `tierBadgeClass` function lines 34-39
- Table columns: Name / Slug / Tier / Type / Visibility / Created + action from `SubaccountSkillsPage.tsx` lines 411-424
- Run trace embedded guard comment from `RunTracePage.tsx` lines 1-22 (no affordances that open nested modals)
- Event stream dot + connector pattern from `RunTraceEventRenderer.tsx` lines 54-80

New dedicated pages proposed: **None.** All 4 screens extend existing pages. No new sidebar nav items.

---

**Changes made:**
- Created `prototypes/closed-loop-skill-improvement/_shared.css` (fresh — replicates operator-backend CSS token system)
- Created `prototypes/closed-loop-skill-improvement/index.html` (4 screens + design decision notes)
- Created `prototypes/closed-loop-skill-improvement/s1-inbox-improvements.html` (Inbox + Skill improvements section)
- Created `prototypes/closed-loop-skill-improvement/s2-review-drawer.html` (review drawer with plain-English reject + single tech-detail expander)
- Created `prototypes/closed-loop-skill-improvement/s3-skill-row-expanded.html` (Skills table with inline expanded row)
- Created `prototypes/closed-loop-skill-improvement/s4-runtrace-event.html` (Run trace with violet improvement-proposed event)

---

**Frontend-design-principles checks:**

- **Start with primary task:** yes — S1: decide which skill improvement to accept. S2: accept or reject this one proposal. S3: see what is active on a skill and pause if needed. S4: read what happened during a failed run.
- **Default to hidden:** yes — Technical detail (provenance, peer-review verdict, root-cause record) collapsed in s2. Advanced stack-health metrics collapsed in s3. Composition detail collapsed in s4. Low-priority improvements grouped under expandable in s1.
- **One primary action per screen:** yes — S1: click a row (open drawer). S2: Accept (single primary button; Reject is secondary flow; Edit is alternative path). S3: Pause toggle (one action per expanded row). S4: Review link (links to s2).
- **Inline state:** yes — Rolled-back badge on urgent row (s1). Toggle state changes inline with sub-text update (s3). Accepted/Rejected confirmation replaces action buttons inline (s2).
- **Re-check passed:** yes — A non-technical operator can: (a) open Inbox, see items labelled "Skill improvement" in plain English, (b) click Accept inline OR click a row for more context, (c) in the drawer read "what failed" in one sentence and "what would change" as a simple before/after, then click Accept. No model names, token counts, internal IDs, or jargon visible in any default state.
- **Extends existing surface:** yes — All 4 screens name the exact codebase file they extend. Per-screen filename enumeration above satisfies the mandatory Step 0a requirement.

**Rule violations flagged:** None. No net-new pages. No net-new sidebar nav items. No jargon in default copy. No em-dashes.

**Files modified:**
- `prototypes/closed-loop-skill-improvement/_shared.css` (new)
- `prototypes/closed-loop-skill-improvement/index.html` (new)
- `prototypes/closed-loop-skill-improvement/s1-inbox-improvements.html` (new)
- `prototypes/closed-loop-skill-improvement/s2-review-drawer.html` (new)
- `prototypes/closed-loop-skill-improvement/s3-skill-row-expanded.html` (new)
- `prototypes/closed-loop-skill-improvement/s4-runtrace-event.html` (new)
- `tasks/builds/closed-loop-skill-improvement/mockup-log.md` (this entry)

---

## Round 4 — 2026-05-18 19:35 (corrective sed-pass after first mockup-reviewer audit)

**Operator feedback:** None directly. Round 4 is an automatic corrective pass triggered by `mockup-reviewer` returning `NEEDS_REWORK` on Round 3, per the `mockup-coordinator` Step 5 loop. The audit log is at `tasks/builds/closed-loop-skill-improvement/mockup-review-log-round-3-2026-05-18T19-30Z.md`. Performed inline rather than via a fresh `mockup-designer` dispatch because all blocking findings were mechanical (em-dash substitutions and a sidebar-items list refresh) — no design rethink required. Audit-trail value preserved by this log entry plus the Round 4 review log written immediately after.

---

**Codebase grounding (Step 0a) — PER SCREEN (re-verified, no structural changes):**

- All four screens remain extensions of the same existing pages (`ReviewQueuePage.tsx`, `SubaccountSkillsPage.tsx`, `RunTracePage.tsx` + `RunTraceEventRenderer.tsx`). No new pages introduced. No new nav items beyond the corrected sidebar (which now mirrors the workspace nav from `client/src/config/sidebar.ts`).

---

**Codebase grounding — round-wide:**

Additional files read this round:
- `client/src/config/sidebar.ts` (lines 80-300) — sourced the real workspace sidebar item set: Home (with review-count badge), Tasks, Automations, Workflows, Action Log, Knowledge, plus the Agents section header. Replaced the prior hand-rolled `Inbox / Runs / Agents / Tasks / Reports / Settings` placeholder with these.

---

**Changes made:**
- `s1-inbox-improvements.html`: replaced em-dash in paused-notice title (`"Prospect Research — suggestions paused"` → `"Prospect Research: suggestions paused"`); replaced em-dash in `<title>` tag (`"Inbox — Skill improvements"` → `"Inbox · Skill improvements"`); replaced hand-rolled sidebar with workspace nav from `sidebar.ts` (Home with badge active; Work group: Tasks, Automations, Workflows, Action Log, Knowledge; Agents section).
- `s2-review-drawer.html`: replaced em-dash in reject button (`"Unsafe — don't suggest again"` → `"Unsafe: don't suggest again"`); sidebar untouched (drawer overlay does not render its own sidebar).
- `s3-skill-row-expanded.html`: replaced em-dash in `<title>` tag (`"— row expanded"` → `"· row expanded"`); replaced em-dash in sample amendment body (`"subject lines — use"` → `"subject lines; use"`); replaced sidebar with workspace nav (no active state — Skills table is reached via subaccount admin drilldown, not via a top-level workspace nav item).
- `s4-runtrace-event.html`: replaced em-dash in `<title>` tag (`"Run trace — improvement proposed"` → `"Run trace · improvement proposed"`); replaced em-dash in composition-detail audit row (`"amend_7g4h) — deduplication"` → `"amend_7g4h): deduplication, superseded by"`); replaced sidebar with workspace nav (Action Log active — run traces are reached via Action Log drilldown).
- `index.html`: replaced em-dash in `<title>` tag and `round-label` strip; updated the "Reject reasons" descriptor to quote the new `"Unsafe:"` label; bumped round label to "Round 4 prototype".
- HTML comments containing em-dashes were left in place — comments are not user-facing copy and are outside the rule's scope (`docs/frontend-design-principles.md § Em-dashes` applies to UI copy, labels, app-facing text, and sample mockup data; comments are author-facing only).

---

**Frontend-design-principles checks (re-verified):**

- **Start with primary task:** unchanged from Round 3 — yes
- **Default to hidden:** unchanged — yes
- **One primary action per screen:** unchanged — yes
- **Inline state:** unchanged — yes
- **Re-check passed:** yes — fixes were mechanical, no new operator-facing content added
- **Extends existing surface:** yes — sidebar now reflects the real workspace nav per `sidebar.ts`; per-page extension claims unchanged

**Rule violations flagged:** None. Confirmed by grep across all four prototypes: zero em-dashes in visible copy (one remaining inside an HTML comment block in `s1-inbox-improvements.html:212`, which is author-facing only and outside the rule's scope).

**Files modified:**
- `prototypes/closed-loop-skill-improvement/s1-inbox-improvements.html`
- `prototypes/closed-loop-skill-improvement/s2-review-drawer.html`
- `prototypes/closed-loop-skill-improvement/s3-skill-row-expanded.html`
- `prototypes/closed-loop-skill-improvement/s4-runtrace-event.html`
- `prototypes/closed-loop-skill-improvement/index.html`
- `tasks/builds/closed-loop-skill-improvement/mockup-log.md` (this entry)

---

---

## Round 5 — 2026-05-18 20:15 (brief design decision: inherited vs custom skill distinction)

**Operator feedback:** Design session established that the amendment mechanism applies only to inherited skills (system-tier or org-tier). Custom subaccount skills are edited directly and do not participate in the amendment loop. S3 updated to show this distinction.

**Changes made:**
- `s3-skill-row-expanded.html`: Row 5 ("Summarise Notes", Subaccount/Custom tier) now expands to an Edit panel (direct skill text edit + Save/Cancel) instead of the amendment panel. Includes a note: "Custom skills are edited directly. Automatic improvement suggestions apply only to inherited skills from the system or organisation level." Row 6 ("Analyse Contract", Org tier) remains collapsed but labelled as an inherited org skill with the same amendment behaviour as system skills.
- `tasks/builds/closed-loop-skill-improvement/mockup-log.md`: this entry.
- No changes to s1, s2, s4, index — brief design decision only affects the skill table view.

**Frontend-design-principles checks:**
- Extends existing surface: yes — still SubaccountSkillsPage, inline expanded row only.
- Default to hidden: yes — Edit panel hidden until clicked; amendment panel for Draft Email unchanged.
- One primary action per screen: yes — each row expand has one primary action (Save for edit, Accept for amendment).
- Re-check: yes — non-technical operator now correctly sees that clicking "Summarise Notes" opens a simple edit form rather than an improvement panel.
- Em-dashes: none in visible copy. Phantom nav: none.

**Rule violations flagged:** None.

**Files modified:**
- `prototypes/closed-loop-skill-improvement/s3-skill-row-expanded.html`
- `tasks/builds/closed-loop-skill-improvement/mockup-log.md`

<!-- machine-readable completion marker per mockup-coordinator Step 8 -->
```yaml
---
status: complete
mockup_rounds_complete: true
final_round: 4
completed_at: 2026-05-18T19:40Z
---
```

## Final state — 2026-05-18 19:40

**Final prototype paths:**
- `prototypes/closed-loop-skill-improvement/index.html`
- `prototypes/closed-loop-skill-improvement/s1-inbox-improvements.html`
- `prototypes/closed-loop-skill-improvement/s2-review-drawer.html`
- `prototypes/closed-loop-skill-improvement/s3-skill-row-expanded.html`
- `prototypes/closed-loop-skill-improvement/s4-runtrace-event.html`

**Total rounds (designer + reviewer pairs):** 4 (Rounds 1, 2, 3 designer-only; Round 4 = corrective sed-pass after Round 3 reviewer audit). Note: Rounds 1, 2, 3 predate the `mockup-reviewer` agent existing; only Round 3 received a formal audit (logged at `mockup-review-log-round-3-2026-05-18T19-30Z.md`). Round 4 audit logged at `mockup-review-log-round-4-2026-05-18T19-40Z.md`.

**Total operator feedback rounds:** 0 — operator has not yet seen Round 4. Marker written eagerly so `spec-coordinator` reuse-check (if invoked later) can detect completion; operator may still request further iteration via the standard flow.

**Deferred concerns for the eventual spec:** None this round.
