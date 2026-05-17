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
