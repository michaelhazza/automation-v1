# Mockup Log: trust-verification-layer

## Round 1 — 2026-05-07 15:00

**Operator feedback:** Initial draft (no prior feedback)

**Changes made:**
- Created `prototypes/trust-verification-layer/` directory
- Copied `_shared.css` and `_sidebar.js` from consolidation-2026-05-06 (same visual language, same layout primitives)
- Built `run-trace.html` — verify badges + Correct action + toast
- Built `knowledge.html` — Source filter + source column + two corrections seed rows
- Built `agent-edit-scorecard.html` — Scorecard tab (dimensions list, sampling rate, judge model, Run bench link, recent score summary)
- Built `govern-quality.html` — new Govern primitive (sortable table, filters, agent drawer with 30-day trend chart)
- Built `model-bench.html` — three-state page (Setup / Running / Results), winner highlighted, Approve as default
- Built `index.html` — index of all screens with layer tags and base prototype links
- Decided to skip `home.html` trust tile (see decision below)

**Format:** Multi-screen directory (`prototypes/trust-verification-layer/`)

**Design decisions made:**

1. **model-bench: page not modal.** The bench has a results table with per-row Approve actions and a cost comparison that needs full-width layout. A modal at the needed width would be 90% of viewport and lose modal semantics. Page with breadcrumb back to Quality is cleaner.

2. **Scorecard: new tab on agent-edit (not a new section within an existing tab).** Agent edit already has 7 tabs. Scorecard is configuration-heavy enough (5+ rows of dimension data, a slider, a selector, a chart) that embedding it inside another tab would violate the single-primary-task rule for that tab. A dedicated tab is the established pattern for similar density (cf. Budget, Schedule).

3. **Source filter: Auto-memory tab only.** Authored memory is always "manual" by definition. Adding the Source filter there would be noise with only one option ever visible.

4. **home.html trust tile: skipped.** The home uses a fixed 2x3 widget grid. Adding a tile requires restructuring the grid (breaking the established uniform-height 2-col layout), or adding a third row (makes home longer for a low-frequency signal). Brief explicitly allows this skip. Verify failure entry points are Inbox (items appear there) and Govern / Quality.

5. **Verify summary bar on run-trace.** Added a compact strip above the event list showing aggregate counts (5 passed / 1 failed / 1 inconclusive / 1 n/a). Zero per-row vertical height cost; helps operator triage without scrolling the full list.

6. **Correction suggestion card on Knowledge auto-memory tab.** Added a suggestion card showing "3 tone corrections cluster around Outreach Agent" to illustrate the pattern-detector nudge described in brief Layer 3. This is a platform-surfaced suggestion, not a new user action, so it does not violate the one-primary-action rule.

**Frontend-design-principles checks:**

- Start with primary task: yes — each screen's layout answers the operator's primary question: "did this step work?" (run-trace), "what did the correction create?" (knowledge), "configure quality scoring" (agent-edit scorecard tab), "is anything getting worse?" (govern-quality), "which model is cheapest that clears the floor?" (model-bench).

- Default to hidden: yes — verify reasons are tooltip-only (zero visual weight until hover); Correct action is hover-only (not permanently visible); bench cost is front-and-centre only on model-bench (the one screen where cost IS the primary task); the full 30-day chart lives in the drawer, not the main table row.

- One primary action: yes — run-trace: Correct (or select event to inspect); knowledge: Approve on the corrections-sourced entry; agent-edit scorecard: Save changes (footer); govern-quality: Run bench (on the drifting row); model-bench: Approve as default (on winner row).

- Inline state: yes — verify state is a small inline badge (not a dashboard panel); drift is an arrow + delta on the same row as the agent name; sparklines communicate trend in 70px; score warnings are colour-coded inline without opening a new view.

- Re-check passed: yes — a non-technical operator can scan Govern / Quality and immediately see the red drift indicator on two agents, click one, see the hero trend chart in the drawer, and click Run bench. The Correct action on run-trace is discoverable on hover with a clear label. The Knowledge Source filter has four plain-English options.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/trust-verification-layer/_shared.css` (copied from consolidation)
- `prototypes/trust-verification-layer/_sidebar.js` (copied from consolidation)
- `prototypes/trust-verification-layer/run-trace.html` (new, extends consolidation/run-trace.html)
- `prototypes/trust-verification-layer/knowledge.html` (new, extends consolidation/knowledge.html)
- `prototypes/trust-verification-layer/agent-edit-scorecard.html` (new, extends consolidation/agent-edit.html)
- `prototypes/trust-verification-layer/govern-quality.html` (new page)
- `prototypes/trust-verification-layer/model-bench.html` (new page)
- `prototypes/trust-verification-layer/index.html` (new index)
- `tasks/builds/trust-verification-layer/mockup-log.md` (this file, created)

---

## Round 2 — 2026-05-08 12:00

**Operator feedback:** Apply round-1 feedback and add missing creation-flow screens. Full brief updated with terminology rules, multi-attach scorecard pattern, new screens (skill-create, scorecard-create, agent-create), and updates to existing three screens.

**Changes made:**

Files UPDATED:
- `agent-edit-scorecard.html` — Complete rebuild: multi-attach scorecard list replaces single dimension list; each scorecard shows name, Source pill (System/Organisation/This subaccount), View link, Detach button, collapsible read-only quality checks with pass marks as %; provenance banner ("Installed from System Agent: Content Director"); "Run bench" button removed (lives on Govern/Quality); "How often to grade" slider with one-line help; recent score summary shows per attached scorecard, 7-day mean per quality check as %, sparklines, drift warnings; Attach modal with source filter chips and multi-select.
- `model-bench.html` — Mode switcher (Agent bench / Skill bench); Test inputs section (three radio options: Recent real runs with preview table and Re-roll, Specific date range, Paste in); estimated cost banner before Run bench; skill picker for skill bench mode; all scores as percentages; "Approve as default" toast text updated per spec.
- `govern-quality.html` — Three tabs at top: Agents, Scorecards, Bench history; Scorecards tab embeds iframe pointing at scorecard-library.html; Bench history tab with past runs, model recommended/approved/outcome; "Run bench" button visible on Agents table rows for drifting agents; scores as percentages; drawer labels updated to sentence case.
- `index.html` — Full rewrite to reflect round 2 screens, round 2 decisions box, file descriptions updated.

Files CREATED:
- `scorecard-library.html` — Scorecards tab (standalone page with same tab shell as govern-quality.html). Table: name, Source pill, quality checks count, attach count (clickable used-by modal), Share with sub-accounts toggle (System/Org rows only; absent on subaccount rows), actions menu. Source filter chips, search, "Create scorecard" primary action. "Hidden by org" info note for subaccount view.
- `skill-create.html` — Two-step custom skill creation. Step 1: name, description, API endpoint, parameters table, blast radius selector (Self/Tenant/External with one-line help each), reversible toggle. Step 2: suggested verify check (auto-generated plain-English), three radio options (Use/Edit/No check possible), "Edit" expands Advanced code disclosure, "No check" requires justification text. Run-trace preview at bottom showing the verify badge. Cannot save without selecting a verify option.
- `scorecard-create.html` — Create/duplicate scorecard. Duplicate mode pre-fills and shows independence note. Scope read-only badge. Name, description, Share with sub-accounts toggle (org scope) with live visibility estimate. Quality checks list: name (sentence case), description, pass mark (number input + % suffix), enabled toggle, remove button. Add quality check button.
- `agent-create.html` — Agent creation showing scorecard pre-attachment. Two path tabs: Install System Agent (Content Director) and Create from Template (Content Writer). System path: required scorecards with lock icon (read-only, labelled "Required"), suggested scorecards with checkboxes (default on). Template path: template-recommended scorecards with checkboxes (default on), "Don't include any scorecards" option with amber note. Both paths include evaluation settings (How often to grade slider + judge model). Footer shows count of scorecards being attached.

**Design decisions made this round:**

1. "Override pass marks for this agent" deferred to Round 3. Three levels of nesting (Advanced disclosure inside collapsible body inside collapsible card inside tab) violates complexity budget and requires non-trivial state management. Will ship as an "Advanced" disclosure per attached scorecard.

2. scorecard-library.html renders as a standalone page. govern-quality.html Scorecards tab embeds it via iframe for prototype navigation continuity. In production, the tab would render the library content inline.

3. govern-quality.html Bench history tab includes an "Overridden" outcome state (operator chose a different model than recommended). This illustrates a real scenario: the platform recommends Opus 4.7, but the operator approves Sonnet 4.6 for cost reasons.

4. agent-create.html uses two tabs on one page rather than two separate pages. The brief says "two paths visible on one page" — tabs are the right pattern for co-located alternatives without forcing the operator to navigate.

5. skill-create.html Advanced code block defaults collapsed. Plain-English verify check is the primary surface per brief spec: "Plain English first. The actual implementation lives in an Advanced disclosure for technical users."

6. Source pills in scorecard-library.html are uppercase abbreviated text (SYSTEM, ORGANISATION, THIS SUBACCOUNT) as these are classification labels, not operator-facing prose. Consistent with the source pill pattern in agent-edit-scorecard.html.

**Frontend-design-principles checks:**

- Start with primary task: yes — agent-create starts from "make this agent meet a quality bar from day one" not from the scorecard data model; scorecard-create starts from "create a scoring rubric" not from the schema; skill-create starts from "add a verified action" not the capability registry.

- Default to hidden: yes — "Override pass marks" is deferred entirely; Advanced code block in skill-create is behind disclosure; collapsible scorecard bodies on agent-edit default open for the first two, closed for the third; "no scorecards" warning note only appears if the operator selects that option.

- One primary action: yes — agent-create: Install/Create button; scorecard-create: Save scorecard; skill-create: Next (step 1) / Save skill (step 2); scorecard-library: Create scorecard; govern-quality (Agents tab): Run bench on drifting row; model-bench: Run bench (setup) / Approve as default (results).

- Inline state: yes — scorecard library shows attach counts and share state inline; agent-create footer updates live with scorecard count; model-bench setup shows estimated cost inline before action; agent-edit scorecard tab shows score warnings inline with amber background on drifting rows.

- Re-check passed: yes — a non-technical operator installing a System Agent on agent-create.html sees immediately that 2 scorecards are locked in and 3 are suggested checked by default; they do not need to understand what scorecards are to proceed correctly.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/trust-verification-layer/agent-edit-scorecard.html` (updated)
- `prototypes/trust-verification-layer/model-bench.html` (updated)
- `prototypes/trust-verification-layer/govern-quality.html` (updated)
- `prototypes/trust-verification-layer/index.html` (updated)
- `prototypes/trust-verification-layer/scorecard-library.html` (created)
- `prototypes/trust-verification-layer/skill-create.html` (created)
- `prototypes/trust-verification-layer/scorecard-create.html` (created)
- `prototypes/trust-verification-layer/agent-create.html` (created)
- `tasks/builds/trust-verification-layer/mockup-log.md` (updated)
