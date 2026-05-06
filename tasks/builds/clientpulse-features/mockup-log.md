## Round 2 — 2026-05-06

**Operator feedback:** Exhaustive review pass requested. Every modified surface needs a current-state mockup alongside the proposed state so the diff is obvious. Index restructured into four sections: A (net-new), B (modifies, with Today/Proposed button pairs), C (reused unchanged), D (deferred).

**Changes made:**
- Built `current-onboarding-wizard-step4.html` — faithful render of the existing Step4Baseline component: flat client rows, status dot grid (Brand/Voice/Offer/Audience/Constraints/Proof), "Start capture" link that navigates away to a workflow run page, no inline input, disabled "Continue to done" button until all Tier-1+2 artefacts are complete for every client
- Built `current-onboarding-celebration.html` — faithful render of OnboardingCelebrationPage: dark gradient background, three health badges (Healthy/Needs Attention/At Risk), single CTA "View your dashboard" only; no automation intake CTA, no O-Intake entry, no "Skip for now"
- Built `current-subaccount-detail.html` — faithful render of the SubaccountKnowledgePage artefacts section: flat list of 6 rows (name, tier tag, status dot, "Edit" button only when completed), no summary badge, no drawer, no timestamps, no revert option; plus tabs (References/Insights/Memory Blocks) and references table below
- Built `current-playbooks-library.html` — faithful render of WorkflowsLibraryPage: flat table with Name/Type/Version/Run columns, "New Workflow" button (small, top-right, links to admin studio), no visual cards, no category grouping, no template preview icons, no animated CTA; Run button opens modal with raw JSON textarea
- Built `current-report-detail.html` — faithful render of ReportDetailPage: header with title/date/"Resend to inbox", four KPI tiles (Total Clients/Healthy/Needs Attention/At Risk), HTML report body in iframe; no ROI section, no baseline comparison, no "since onboarding" section of any kind
- Built `current-deliverable-no-citations.html` — faithful render of TaskModal deliverables tab: plain prose cards with title, type badge (e.g. "research_brief"), description; no citation markers, no source attribution, no hover tooltips, no sources list
- Rewrote `prototypes/clientpulse-features/index.html` with four-section structure: Section A (net-new, teal NEW badges), Section B (modifies, indigo MODIFIES badges + Today/Proposed button pairs), Section C (reused unchanged, links to existing prototypes), Section D (deferred); colour-coded section letters and card borders distinguish NEW from MODIFIES at a glance

**Frontend-design-principles checks (proposed mockups only — principles do not apply to current-state mockups):**
- Start with primary task: yes — no changes to proposed screens this round; current-state mockups are faithful representations, not redesigns
- Default to hidden: yes — current-state mockups show what is exposed today (some surfaces expose more than the principles would recommend); proposed screens remain unchanged from round 1
- One primary action: yes — no proposed screens modified this round
- Inline state: yes — no proposed screens modified this round
- Re-check passed: yes — current-state mockups include annotation callouts explaining what the operator sees today; proposed screens unchanged

**Rule violations flagged:** none (current-state mockups intentionally render current production state; no principles applied to them per brief instructions)

**Stubbed/empty surfaces found:**
- None. All six modified surfaces have real production UI today. Step 4 is NOT a stub — it is a real functional component (Step4Baseline) that routes operators out to a separate workflow run page to fill artefacts. The key distinction is the workflow run page exists separately from the wizard; the wizard step itself only shows status indicators, not the input forms. This means B-Artefacts is adding inline input to a surface that today has none — it is functionally a new capability on an existing surface, not a replacement of a placeholder.

**Files modified:**
- `prototypes/clientpulse-features/current-onboarding-wizard-step4.html` (created)
- `prototypes/clientpulse-features/current-onboarding-celebration.html` (created)
- `prototypes/clientpulse-features/current-subaccount-detail.html` (created)
- `prototypes/clientpulse-features/current-playbooks-library.html` (created)
- `prototypes/clientpulse-features/current-report-detail.html` (created)
- `prototypes/clientpulse-features/current-deliverable-no-citations.html` (created)
- `prototypes/clientpulse-features/index.html` (rewritten — four-section structure)
- `tasks/builds/clientpulse-features/mockup-log.md` (this entry)

---

## Round 1 — 2026-05-06 14:00

**Operator feedback:** initial draft

**Changes made:**
- Created `prototypes/clientpulse-features/` multi-screen directory with `_shared.css` (already existed from a prior session stub)
- Built `o-intake-celebration.html` (pre-existing stub) — celebration screen extended from the existing OnboardingCelebrationPage with O-Intake CTA replacing the plain "Done" button
- Built `o-intake-conversation.html` — full-screen chat surface; LLM opening message, two pre-seeded turns with inline capability cards ("Add to my list" / "Not quite"), interactive wish counter in topbar, working send button that simulates a third agent reply, "I'm done" button links to summary
- Built `o-intake-summary.html` — three-wish list with per-wish state transitions (queued / saved), running count in footer bar, Done button links to D-Compiler bridge
- Built `b-artefacts-capture-step.html` — OnboardingWizard step 4 with 5-step progress bar; Tier-1 (brand identity, voice/tone) expanded and required; Tier-2 (offer, ICP, constraints, proof) collapsed with default value chips; progress gated on Tier-1; "Save and continue" routes to celebration
- Built `b-artefacts-edit-drawer.html` — subaccount detail page with status badge strip ("Knowledge: 4 of 6 Edit"); clicking the badge opens a slide-out drawer with 6 artefact accordion rows (4 complete, 2 empty); each filled row shows last-updated timestamp and a "Revert to baseline" link; overlay closes on backdrop click
- Built `b-metrics-manual-entry.html` — focused form triggered by auto-capture failure alert; Tier-1 (pipeline value, revenue) required with real-time numeric validation and Confirmed/Estimated confidence toggles; Tier-2 (lead count, response time) optional; single primary action "Save baseline"; routes to ROI delta page on valid submit
- Built `b-metrics-roi-delta.html` — extends a ReportDetailPage simulation; "Since onboarding" section shows narration line + 2 delta cards (pipeline +32%, revenue +24%); demo toggle bottom-right shows the fallback state when baseline is missing with a "Set baseline now" link
- Built `d-compiler-playbooks-library.html` — Playbooks Library with animated "New automation" CTA as the primary action; grid of 4 system templates + 1 org automation + 1 "Build something new" dashed card; "+ New automation" links to existing `prototypes/workflows/01-studio-chat-with-live-preview.html`
- Built `d-compiler-from-onboarding.html` — 3-pane studio in mid-generation state; origin-context banner in chat shows the O-Intake wish; user message prefilled; compiler thinking indicator; DAG canvas shows 3 confirmed steps + 1 pending step (waiting for Slack channel config); reuses exact workflow studio chrome (3-pane layout, step type badges, thinking dots)
- Built `r-polish-deliverable-citations.html` — competitor brief deliverable with numbered inline citations; hover tooltips on each `[N]` superscript showing source title, URL, one-line snippet; sources section below body with title, URL, fetched-at timestamp, "View source" link; right sidebar with download/share/request-update actions
- Built `index.html` — feature index with suggested walkthrough flow guide, grouped screen cards per feature, deferred-to-next-round notice for B-Metrics admin reset action

**Frontend-design-principles checks:**
- Start with primary task: yes — every screen was designed from the operator's task, not the data model. O-Intake starts from "tell me what you want to automate", not "pick from a schema of capabilities". B-Artefacts starts from "fill in what you know about yourself", not "populate 6 database fields". B-Metrics starts from "give us a starting point", not "enter baseline_pipeline_value".
- Default to hidden: yes — B-Artefacts Tier-2/3 cards are collapsed by default with defaults shown. B-Metrics Tier-2 fields are below the fold. The edit drawer is closed until the operator clicks the status badge. The DAG inspector is empty until a step is clicked. No dashboard tiles, no KPI rows.
- One primary action: yes — every screen has exactly one prominent action: "Save and continue" (B-Artefacts), "Save baseline" (B-Metrics), "I'm done" (O-Intake conversation), "Done" (O-Intake summary), "New automation" (Playbooks Library), "Save and open PR" (D-Compiler studio), drawer "Save changes" (Knowledge drawer).
- Inline state: yes — status dots on the subaccount detail page replace dashboards. "Knowledge: 4 of 6 Edit" is an inline badge, not a separate page. "Baseline: Complete" is a dot + label, not a chart. The wish count "2 of 5" is in the topbar, not a KPI tile. ROI deltas are inline within the report, not a separate dashboard.
- Re-check passed: yes — each screen was reviewed for the 3-second test. O-Intake conversation: open textbox + "I'm done" = obvious. B-Artefacts capture: two open required fields = obvious. B-Metrics form: two currency fields + "Save baseline" = obvious. D-Compiler bridge: prefilled chat + thinking DAG = obvious state (agent is working, operator should answer the Slack channel question).

**Rule violations flagged:** none

**Files modified:**
- `prototypes/clientpulse-features/index.html` (created)
- `prototypes/clientpulse-features/o-intake-celebration.html` (pre-existing, not modified this round — already correct)
- `prototypes/clientpulse-features/o-intake-conversation.html` (created)
- `prototypes/clientpulse-features/o-intake-summary.html` (created)
- `prototypes/clientpulse-features/b-artefacts-capture-step.html` (created)
- `prototypes/clientpulse-features/b-artefacts-edit-drawer.html` (created)
- `prototypes/clientpulse-features/b-metrics-manual-entry.html` (created)
- `prototypes/clientpulse-features/b-metrics-roi-delta.html` (created)
- `prototypes/clientpulse-features/d-compiler-playbooks-library.html` (created)
- `prototypes/clientpulse-features/d-compiler-from-onboarding.html` (created)
- `prototypes/clientpulse-features/r-polish-deliverable-citations.html` (created)
- `tasks/builds/clientpulse-features/mockup-log.md` (created)

## Round 3 — 2026-05-06 11:00

**Operator feedback:** Major review pass requested. Build exhaustive coverage: empty states, failure/edge states, knowledge-management surface (current + proposed), downstream Pulse inbox landings. No modifications to round 1 or 2 outputs.

**Changes made:**

Empty states (4 new — 2 already existed from prior rounds):
- `empty-pulse-inbox.html` — Pulse inbox with zero items. No zero counts, no skeleton loaders. Single CTA routes to Automations library. Existing `prototypes/pulse/index.html` had no standalone empty-state mockup.
- `empty-o-intake-summary.html` — O-Intake summary with zero captured wishes (operator clicked "I'm done" immediately). Low-pressure copy, no shaming. Single primary: Done. Escape: go back to conversation.
- `empty-subaccount-knowledge.html` — SubaccountKnowledgePage with all 6 artefacts "Not started". Each row has a "Capture" CTA. Tabs show 0 counts. Faithful to current code structure (no proposed changes here).
- `empty-deliverables.html` — Deliverables tab before any research output. Single CTA: "Run a research task".

Failure / edge states (6 new):
- `o-intake-cost-cap-warning.html` — 80% budget consumed. Warning appears inline in chat thread as a system message with budget bar. Conversation continues unblocked, input stays active.
- `o-intake-cost-cap-reached.html` — Soft cap fully consumed. Inline pause message with wish count. Input disabled. Two clear actions: "Review my N wishes" (primary) / "Continue anyway" (secondary).
- `o-intake-im-done-confirmation.html` — Operator clicks "I'm done" with 3 wishes. Inline confirmation in thread shows compact wish list + "Review summary" / "Keep going". No modal.
- `b-metrics-capture-failed-notification.html` — Auto-capture failed 3 times. Inline notice with red left-border on subaccount detail page. Single CTA: "Enter baseline manually". No modal, no error codes.
- `d-compiler-validation-rejected.html` — DAG compilation failed due to missing required field (Slack channel). One plain-English question + one inline input field in chat thread. Blocked step shown in DAG preview. No modal.
- `d-compiler-missing-integration.html` — Wish requires Google Ads connector that isn't linked. System explains, shows integration row with status, offers "Connect Google Ads" or "Save for later". Compilation does not attempt to proceed.

Knowledge-management surface (2 new):
- `current-subaccount-knowledge-tab.html` — Faithful render of SubaccountKnowledgePage.tsx as read from production code on 2026-05-06. Three tabs (References/Insights/Memory Blocks), Baseline artefacts section at top (flat list, status badges, Edit on completed rows only), search bar, full references table with 5 columns. Added to Section B.
- `subaccount-knowledge-page-proposed.html` — Proposed modification. Artefact flat list → 3-column card grid with last-updated, captured-by, inline Edit/Capture per card. Tier-1 cards have indigo top border, Tier-2 grey. Page title anchors primary task ("Everything we know about X"). Badge in header triggers edit drawer. References/blocks tabs retained below. Added to Section B.

Downstream landings (2 new):
- `pulse-inbox-with-o-intake-task.html` — New "Saved for later" inbox lane. Row shows "From onboarding chat" chip + original wish text inline. "Set up now" opens D-Compiler with wish prefilled.
- `pulse-inbox-with-baseline-failed.html` — Red-accented inbox row for "Baseline capture failed for [Client]". Badge "3 attempts failed", plain-English detail, single CTA: "Enter manually".

Index updates:
- Page meta updated to reflect round 3
- Section B count: 6 → 7 (knowledge page pair added)
- New Section E added with amber/grey state-variant badge system (Empty/Failure/Edge/Downstream/Current)
- Priority 2 deferred items documented in Section E

**Frontend-design-principles checks:**
- Start with primary task: yes — every empty state has exactly one next action; every failure message tells the operator what to do next, not what went wrong technically
- Default to hidden: yes — no KPI tiles on empty states, no error codes exposed, no diagnostic panels surfaced
- One primary action: yes — each screen has one primary CTA; secondary actions (dismiss, go back, keep going) are visually subordinate
- Inline state: yes — all conversation interruptions (cost cap warning, validation rejection, "I'm done" confirmation) appear inline in the chat thread, not modals
- Re-check passed: yes — all 14 screens are navigable by a non-technical operator without needing to understand error codes, budgets, or system internals

**Rule violations flagged:** none

**Files modified:**
- `prototypes/clientpulse-features/index.html` (Section E added, Section B count updated, round 3 metadata)
- `prototypes/clientpulse-features/empty-pulse-inbox.html` (new)
- `prototypes/clientpulse-features/empty-o-intake-summary.html` (new)
- `prototypes/clientpulse-features/empty-subaccount-knowledge.html` (new)
- `prototypes/clientpulse-features/empty-deliverables.html` (new)
- `prototypes/clientpulse-features/o-intake-cost-cap-warning.html` (new)
- `prototypes/clientpulse-features/o-intake-cost-cap-reached.html` (new)
- `prototypes/clientpulse-features/o-intake-im-done-confirmation.html` (new)
- `prototypes/clientpulse-features/b-metrics-capture-failed-notification.html` (new)
- `prototypes/clientpulse-features/d-compiler-validation-rejected.html` (new)
- `prototypes/clientpulse-features/d-compiler-missing-integration.html` (new)
- `prototypes/clientpulse-features/current-subaccount-knowledge-tab.html` (new)
- `prototypes/clientpulse-features/subaccount-knowledge-page-proposed.html` (new)
- `prototypes/clientpulse-features/pulse-inbox-with-o-intake-task.html` (new)
- `prototypes/clientpulse-features/pulse-inbox-with-baseline-failed.html` (new)
