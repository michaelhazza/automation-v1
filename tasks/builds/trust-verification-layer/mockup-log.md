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
