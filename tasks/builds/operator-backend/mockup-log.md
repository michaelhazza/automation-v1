# Mockup log: Operator Backend (Phase D)

## Round 1 — 2026-05-12 (initial draft)

**Operator feedback:** Initial draft. No prior rounds.

**Changes made:**
- Created `prototypes/operator-backend/` multi-screen directory (directory already existed with `_shared.css` and `brief.md`)
- Built 12 prototype screens plus `index.html` (13 files total)
- C1: `c1-agent-edit-model-access-live.html` — refreshed Phase C screen 08, converting "Available soon" placeholder to live. Adds enabled toggle (Org admin only), duration cap (120 min), concurrency limit (3), AI Subscription allowlist (read-only), fallback key status with CTA if not configured. Two state variants on page: fallback configured vs not configured
- C2: `c2-run-trace-timeline.html` — complete Run Trace timeline for an operator run with all Phase D event types: session start, credential injected (auth type: subscription, plan tier, token redacted), steps 1-4 (subscription), fallback engaged at step 5 (rate_limited), steps 5-8 (API key), artefact harvest, completed. Collapsible event details. Sidebar: session info, credentials used, cost breakdown ($0.00 subscription + $0.18 API key fallback + $0.24 sandbox = $0.42), artefact downloads
- D1: `d1-session-in-progress.html` — live runtime view with animated running pill, time strip (elapsed/remaining/steps), progress strip (current activity), recent steps log. Primary action: Cancel run with confirm modal. Secondary: Snapshot artefacts. State variant B: approaching 120 min cap (amber styling, 15 min remaining warning, Extend CTA)
- D2: `d2-session-completed.html` — completed state with summary stats, cost breakdown (subscription/fallback/sandbox), artefact list with downloads, re-run CTA, view trace link
- D3: `d3-session-failed.html` — failed state (OPERATOR_RUNTIME_CRASH), plain-English explanation, expandable "what does this mean?" section explaining no-auto-restart policy, action cards (retry/trace/report), partial artefacts
- D4: `d4-session-cancelled.html` — cancelled state with who/when notice, run summary, partial artefacts
- D5: `d5-fallback-engaged-banner.html` — fallback engaged amber banner component on in-progress layout. "Why?" opens popover. Running dot changes to amber. Non-dismissable.
- D6: `d6-error-operator-session-unavailable.html` — error screen "This run can't start". Primary CTA: Add fallback API key. "What does this mean?" expander. Subscription status + fallback status inline cards
- D7: `d7-error-concurrency-limit-exceeded.html` — concurrency limit error (3/3 slots used). 3 active session cards with Cancel per row. Cancel opens confirm modal. Footer Org admin gating note
- D8: `d8-active-sessions-list.html` — autonomous runs list page with sidebar nav entry and badge. 2 active cards, slot indicator (2/3), collapsible recent runs. Empty state variant
- D9: `d9-duration-override-modal.html` — duration override modal (Org admin only). Context strip, slider+number input (default 60, max 120), computed new cap and cost estimate, policy note. Once-per-run policy
- D10: `d10-provider-account-suspended.html` — provider revocation screen (ChatGPT Plus). Factual tone. What happened, disclosure record link, action cards (reconnect/fallback/support), CS comms template expander with copyable message

**Frontend-design-principles checks:**
- Start with primary task: yes — each screen is oriented around one operator action (monitor run, download artefact, add fallback, cancel, etc.), not the data model
- Default to hidden: yes — cost breakdown is a section users expand/scroll to; run IDs and internal event types are in expandable details or footers; advanced metrics (vCPU, wall clock) only appear in cost breakdown note. Dashboard tiles are avoided
- One primary action: yes — D1: Cancel run; D2: Download (artefacts); D3: Retry; D4: Start new run; D6: Add fallback API key; D7: Cancel one active run; D8: (monitor); D9: Extend run; D10: Reconnect
- Inline state: yes — status pills, countdown timers, animated running dots, slot indicators, fallback badges all communicate state inline without separate dashboard screens
- Re-check passed: yes — non-technical operator landing on D1 sees "Running / 23 min / Step 3 / Reading invoice PDF" and Cancel button. D6 says "This run can't start" with one CTA. D7 shows the 3 runs and a Cancel button per row

**Rule violations flagged:** none

**Files modified:**
- `prototypes/operator-backend/c1-agent-edit-model-access-live.html` (created)
- `prototypes/operator-backend/c2-run-trace-timeline.html` (created)
- `prototypes/operator-backend/d1-session-in-progress.html` (created)
- `prototypes/operator-backend/d2-session-completed.html` (created)
- `prototypes/operator-backend/d3-session-failed.html` (created)
- `prototypes/operator-backend/d4-session-cancelled.html` (created)
- `prototypes/operator-backend/d5-fallback-engaged-banner.html` (created)
- `prototypes/operator-backend/d6-error-operator-session-unavailable.html` (created)
- `prototypes/operator-backend/d7-error-concurrency-limit-exceeded.html` (created)
- `prototypes/operator-backend/d8-active-sessions-list.html` (created)
- `prototypes/operator-backend/d9-duration-override-modal.html` (created)
- `prototypes/operator-backend/d10-provider-account-suspended.html` (created)
- `prototypes/operator-backend/index.html` (created)
- `tasks/builds/operator-backend/mockup-log.md` (created, this file)
