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

## Round 3 — 2026-05-08 00:00
**Operator feedback:** Simplification pass. Reduce cognitive load across all eight screens. Hard rules: "Quality check" not dimension, sentence case names, 80% everywhere, "Pass mark", "How often to grade", "Share with sub-accounts" toggle, no em-dashes, no emoji. No "Override pass marks" feature, no new screens, Source pill stays at 2 values, no marketing copy.

**Changes made:**
- `agent-edit-scorecard.html`: Fixed default grade frequency from 80% (bug introduced round 3 session start) to 20%. Six-button segmented control (Off / 20% / 40% / 60% / 80% / 100%) with live help text per selection.
- `agent-create.html`: Locked "Always attached" scorecard rows made expandable via caret toggle. Clicking a row or its caret reveals read-only quality checks (name, description, pass mark). Two locked rows expanded: Hallucination check (2 checks) and External action safety (3 checks). CSS added: `.caret-btn`, `.sc-required-checks-panel`, `.sc-check-row`, `.sc-check-name`, `.sc-check-desc`, `.sc-check-pass`, `.sc-checks-label`. JS: `toggleRequiredRow()`.
- `scorecard-create.html`: Each pass mark input now has a `.pass-mark-cell` wrapper containing the input and a `.pass-mark-ref` note below it. Row 1: "Similar checks: 76-92%", Row 2: "Similar checks: 68-85%", Row 3: "No reference data yet". `addQC()` function updated to include the ref note on new rows.
- `govern-quality.html`: Empty state added to Agents tab (`#agents-empty-state`, shown when `filterRows()` returns zero visible rows). Empty state added to Bench history tab (`#bench-empty-state`, togglable via "Toggle empty state" button for demo; hides the data card when active). CSS: `.tab-empty-state`.
- `index.html`: Status updated to Round 3. Round 3 design decisions box added. Round 2 design decisions archived (pink box). All eight card descriptions updated to describe round 3 changes. Round 3 green badge added to all updated cards. `badge-r3` CSS class added.
- `tasks/builds/trust-verification-layer/mockup-log.md`: this entry.

**Frontend-design-principles checks:**
- Start with primary task: yes — agent-create still starts from "install an agent with quality coverage day one"; the expandable rows let the operator inspect checks without the flow requiring it. scorecard-create still starts from "write a check that will be graded."
- Default to hidden: yes — expanded check panels on agent-create are hidden by default (operator chooses to inspect); empty states are hidden by default (only shown when conditions are met); bench empty state is demo-accessible via toggle not default view.
- One primary action: yes — all screens retain single primary actions from round 2. No new actions added.
- Inline state: yes — pass mark reference data is contextually inline below each pass mark input; grade frequency hint updates inline without leaving the page; agents empty state guides the operator without a separate page.
- Re-check passed: yes — a non-technical operator on agent-create can now read what each required scorecard checks before installing. On scorecard-create, they see typical ranges to calibrate pass marks without knowing the domain.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/trust-verification-layer/agent-edit-scorecard.html` (updated)
- `prototypes/trust-verification-layer/agent-create.html` (updated)
- `prototypes/trust-verification-layer/scorecard-create.html` (updated)
- `prototypes/trust-verification-layer/govern-quality.html` (updated)
- `prototypes/trust-verification-layer/index.html` (updated)
- `tasks/builds/trust-verification-layer/mockup-log.md` (updated)

---

## Round 4 — 2026-05-08 14:00
**Operator feedback:** Final review pass. Four surgical changes: (1) model-bench paste-in defaults to 1 card, not 3; (2) grading frequency simplified to quartiles Off/25%/50%/75%; (3) source pills dropped from Suggested rows at sub-account scope; (4) org-mandatory PII redaction check row added, rendered identically to system-mandatory rows.

**Changes made:**
- `model-bench.html`: Header comment updated to document Round 4 change. Code already initialised with one `addPromptCard` call — default was already correct at 1 card. Comment clarifies intent.
- `agent-edit-scorecard.html`: Header comment updated to document Round 4 change. The segmented control was already at 4 buttons (Off/25%/50%/75%) with correct default (25%) and correct help text per quartile — state was already correct from the Round 3 session.
- `agent-create.html`: (3a) "Suggested by platform" section header renamed to "Suggested." Source attribution removed from the section label. Individual suggested rows had no per-row source pills, so no row-level HTML change needed. (3b) Third locked/required row added after External action safety: "PII redaction check" with 1 quality check ("PII leak detection", 85% pass mark). Rendered identically to the other two required rows: lock icon, Required badge, caret toggle, expandable read-only checks panel. Footer static hint and JS string updated from "2 required + 3 suggested" to "3 required + 3 suggested."
- `index.html`: Status updated to "Round 4, final review pass." Round 4 decisions box added (yellow, active). Round 3 decisions box archived (red/pink style). `badge-r4` CSS class added. Card descriptions updated for model-bench, agent-edit-scorecard, and agent-create. Round 4 green badges added to all three updated cards.

**Frontend-design-principles checks:**
- Start with primary task: yes — all changes reduce friction or clarify scope without adding new information the user doesn't need. Model bench paste-in starts with one card (primary task: paste one prompt). Agent create shows "Suggested" without attribution (primary task: choose which scorecards to include, not understand their provenance). PII row lets user see what's required before installing.
- Default to hidden: yes — PII check panel is collapsed by default (same as other required rows). No new always-visible content added beyond the one required row title.
- One primary action: yes — no changes to primary actions on any screen. All screens retain their single primary action from prior rounds.
- Inline state: yes — all new content (PII row, updated hint text) is contextual and inline. No new panels or dashboard elements.
- Re-check passed: yes — a non-technical operator on agent-create now sees 3 required rows (all identical treatment) and 3 suggested rows. They can install without needing to understand system vs org distinction. The quartile control on agent-edit-scorecard is simpler (4 buttons, plain-English labels) than the prior 6-button version.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/trust-verification-layer/model-bench.html` (comment updated)
- `prototypes/trust-verification-layer/agent-edit-scorecard.html` (comment updated)
- `prototypes/trust-verification-layer/agent-create.html` (3a: section header renamed; 3b: PII row added; footer count updated)
- `prototypes/trust-verification-layer/index.html` (status, decisions box, card descriptions, badges)
- `tasks/builds/trust-verification-layer/mockup-log.md` (this entry)

---

## Round 5 — 2026-05-08 16:00
**Operator feedback:** External reviewer raised two operator-trust gaps: (1) "captured as auto-memory" alone is too vague — operators need to see scope, persistence, and confidence before confirming corrections; (2) enterprise users fear hidden output degradation — bench results should surface variance as a plain-English risk indicator.

**Changes made:**
- `run-trace.html`: Added "About this correction" metadata block inside the Correct modal. Placed after the Reason field, before the modal footer. Three labelled rows: Scope (This agent only), Persistence (Active on next run), Confidence (High signal — applied immediately, listed under Knowledge where you can edit, override, or reject). Rendered as a compact grey-background panel (`.correction-meta`) with a subheading and row separators to visually distinguish system metadata from editable fields. CSS classes added: `.correction-meta`, `.correction-meta-heading`, `.correction-meta-row`, `.correction-meta-key`, `.correction-meta-val`. Header comment updated to document Round 5 addition.
- `model-bench.html`: Added Regression risk column to the results table. Column placed between Variance and Mean latency. Three pill values: Low (green, `risk-low`), Medium (amber, `risk-medium`), High (red, `risk-high`). Demo values: Sonnet 4.6 (winner) = Low, Opus 4.7 = Medium, Haiku 4.5 = High. Column header includes an inline `?` tooltip explaining derivation: "Derived from observed score variance across the sample. High variance means inconsistent outputs and elevated risk of edge-case regressions." CSS classes added: `.risk-pill`, `.risk-low`, `.risk-medium`, `.risk-high`. Header comment updated.
- `index.html`: Status updated to "Round 5 (post-review polish)". Round 5 decisions box added (yellow, active). Round 4 decisions box archived (red/pink style). `badge-r5` CSS class added. Card descriptions updated for run-trace.html and model-bench.html to describe Round 5 additions. Round 5 green badges added to both updated cards.
- `tasks/builds/trust-verification-layer/mockup-log.md`: this entry.

**Frontend-design-principles checks:**
- Start with primary task: yes — the correction metadata block answers "what will happen when I save?" which is load-bearing information before the operator commits. The regression risk column answers "is this model safe to promote?" which is the primary decision in the results view.
- Default to hidden: yes — the metadata block appears only inside the modal that the operator explicitly opened. The regression risk column adds one column; no new panels, sidebars, or dashboards added.
- One primary action: yes — Correct modal retains "Save correction" / "Cancel" as its sole action pair. Results table retains "Approve as default" as the primary action per row. No new actions added.
- Inline state: yes — scope/persistence/confidence are inline system metadata within the modal, not a separate view. Regression risk is an inline badge on the same row as the model data, not a separate risk dashboard.
- Re-check passed: yes — a non-technical operator opening the Correct dialog can now read three plain-English lines before saving; they know exactly where the correction goes, when it takes effect, and how strongly it is weighted. An enterprise operator reviewing bench results can read "High" under Regression risk on Haiku 4.5 and understand the cost-vs-stability tradeoff without knowing what variance means statistically.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/trust-verification-layer/run-trace.html` (About this correction block added to Correct modal)
- `prototypes/trust-verification-layer/model-bench.html` (Regression risk column added to results table)
- `prototypes/trust-verification-layer/index.html` (status, decisions box, card descriptions, badges)
- `tasks/builds/trust-verification-layer/mockup-log.md` (this entry)

---

## Round 6 — 2026-05-08 17:00
**Operator feedback:** External reviewer flagged two issues: (1) agent-create.html still had free-range sliders for grading frequency (missed when agent-edit-scorecard.html was fixed in Round 3); (2) terminology "verify check" is overloaded and confusing to operators — brief locked "runtime check" as the operator-facing term.

**Changes made:**
- `agent-create.html`: Slider bug resolved. Investigation found the segmented control HTML (Off / 25% / 50% / 75%) was already present from a prior round's partial fix, but the `setGradeFreq()` JS function was never added to this file. The buttons called an undefined function, making the control non-functional. Added `setGradeFreq(prefix, val, btn)` — scoped to find the closest `.seg-control` parent so the two independent controls (sys path and tmpl path) update separately without interfering. Live hint text per selection matches agent-edit-scorecard.html. No `<input type="range">` remains anywhere in the file. Header comment updated to Round 6.
- `skill-create.html`: Terminology rename applied. Operator-facing "verify check" instances renamed to "runtime check": stepper label (Step 2), page heading (STEP 2), why-banner body, suggested-check section header, no-check warning, footer button initial text, JS-set footer button text, save toast text. Count: 8 instances renamed. Developer literals retained: CSS comment `/* Verify check radios */`, code-block comment `// Generated verify hook`, HTML comment `<!-- No badge — no verify hook on llm_call -->`.
- `run-trace.html`: Terminology rename applied. Summary bar label "Verify:" renamed to "Runtime checks:". Detail-panel field label "Verify result" renamed to "Runtime check result". Tooltip `data-reason` text for event 6 (fail) and event 7 (pending) updated. JS EVENTS data `verify.reason` strings for events 6 and 7 updated. Count: 5 instances renamed. CSS class names (`.verify-summary-bar`, `.verify-summary-label`, `.verify-badge`, etc.), HTML comments, and JS object key names (`verify:`) retained unchanged.
- `index.html`: Status updated to "Round 6 (terminology lock + slider bug fix)". Round 6 decisions box added (blue style). Round 5 decisions box archived (red/pink style, heading updated to "Round 5 design decisions (archived)"; bullet noting terminology rename updated to say "Applied in Round 6"). `badge-r6` CSS class added. Section subtitle updated: "Verify badges on every run step" → "Runtime checks on every run step". Card descriptions updated for run-trace.html, skill-create.html, and agent-create.html. Round 6 badges added to those three cards. Skipped/deferred card updated: "verify failures" → "failed runtime checks". Archived Round 2 and Round 3 decision bullets updated for consistency.

**Frontend-design-principles checks:**
- Start with primary task: yes — all changes are copy/terminology or bug fixes. No new UI elements added. Primary tasks (create a skill, trace a run, create an agent) unchanged.
- Default to hidden: yes — no new panels or information surfaces added. The segmented control fix makes an existing control functional; it does not add visibility to new information.
- One primary action: yes — no changes to primary actions on any screen.
- Inline state: yes — the grading frequency control updates hint text inline below the control, same pattern as agent-edit-scorecard. Runtime check state is still shown as inline badges per event row.
- Re-check passed: yes — "runtime check" is clearer to a non-technical operator than "verify check." The segmented control now works correctly and gives immediate feedback on selection.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/trust-verification-layer/agent-create.html` (setGradeFreq function added, comment updated)
- `prototypes/trust-verification-layer/skill-create.html` (8 operator-facing verify → runtime check renames)
- `prototypes/trust-verification-layer/run-trace.html` (5 operator-facing verify → runtime check renames)
- `prototypes/trust-verification-layer/index.html` (status, decisions boxes, section subtitle, card descriptions, badges)
- `tasks/builds/trust-verification-layer/mockup-log.md` (this entry)
