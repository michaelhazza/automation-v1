```mockup-review-log
## Mockup review — new-task-modal-overhaul — Round 1

**Reviewer:** mockup-reviewer (read-only)
**Date:** 2026-05-18
**Note:** Dispatched via general-purpose proxy because the mockup-reviewer agent file was added in PR #350 (merged this session) and not yet in the runtime agent registry. Read-only constraint enforced via prompt; review followed `.claude/agents/mockup-reviewer.md` spec exactly.

**Prototypes reviewed:**
- `prototypes/new-task-modal-overhaul/index.html`
- `prototypes/new-task-modal-overhaul/01-default-state.html`
- `prototypes/new-task-modal-overhaul/02-with-attachments.html`
- `prototypes/new-task-modal-overhaul/03-advanced-expanded.html`
- `prototypes/new-task-modal-overhaul/_shared.css`

**Codebase claims verified:**
- `client/src/components/layout/modals/NewBriefModal.tsx` — EXISTS. Modal shell (`bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4`), header (`px-6 py-4 border-b border-slate-200`, `text-[17px] font-bold`), body (`p-6 flex flex-col gap-4`), label/input classes, `btn btn-secondary` / `btn btn-primary` footer, "New Task" title, "Create Task" button — ALL faithfully reproduced in the prototype's CSS. Grounding is solid.
- `client/src/components/TaskModal.tsx` attachments tab (lines 565-718) — EXISTS. Uses `AttachmentTypeIcon`, `formatBytes`, 10MB cap with the same accept list (`image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown`). Prototype copies the accept list exactly.
- `client/src/components/task-modal/format.ts` — EXISTS. Has `formatBytes` — prototype sizes match the helper's output format.
- `client/src/pages/WorkspaceBoardPage.tsx` lines 300-306 — EXISTS. Plain `<select>` with label "Assign Agent". Prototype calls the field "Assigned Agent" — minor vocabulary drift, flagged below.
- `client/src/components/review-queue/NewBriefModal.tsx` — EXISTS. Confirms the fixed-default-agent pattern.
- `client/src/config/sidebar.ts` — "Workspace" is a real `viewMode`. Prototype's "Workspace" active nav link is grounded.
- No new pages, no new routes, no new nav entries. Modal-only scope honoured (matches brief constraint "DO NOT introduce a new page or route").

---

### 🔴 Blocking findings

(none)

---

### 🟡 Should-fix findings

- 🟡 `02-with-attachments.html:178` — Lifecycle notice uses the word "auto-promotes": *"the task still auto-promotes after a short timeout."*
  **Why:** `docs/frontend-design-principles.md § Recurring UI patterns / Token / cost / size information` and the general no-jargon rule (`mockup-reviewer.md § Axis 2 — No jargon in default UI`). "Auto-promote" is an internal lifecycle verb; a non-technical operator will not parse "promote a task to runnable state" in 3 seconds (fails `§ Re-check before delivery / 3-second rule`). Suggested rewording: *"If an upload doesn't finish, the task will still start after a short wait."* The same sentence's word "settle" is borderline (also internal lifecycle vocabulary) — consider replacing with "finish uploading".

- 🟡 `01-default-state.html:89`, `02-with-attachments.html:84`, `03-advanced-expanded.html:84` — Agent field label is "Assigned Agent"; the codebase label in `WorkspaceBoardPage.tsx` line 301 is "Assign Agent".
  **Why:** `mockup-reviewer.md § Axis 1 — Vocabulary matches the codebase` (mismatched vocabulary is 🟡 unless the brief explicitly changes it; the brief uses "Assigned Agent" in prose at § Field set but the existing codebase label is "Assign Agent"). Pick one and apply consistently. Recommend keeping the codebase wording "Assign Agent" unless the spec deliberately changes it.

- 🟡 `01-default-state.html:91`, `02-with-attachments.html:86`, `03-advanced-expanded.html:86` — Agent picker first option is `"Auto-assign (recommended)"`, supported by an info hint *"Auto-assign picks the best available agent for this task."* Neither concept exists in the codebase today: `NewBriefModal.tsx` has no agent picker and routes via downstream auto-routing implicitly; `WorkspaceBoardPage.tsx:303` uses `"Unassigned"` for the empty option. "Auto-assign (recommended)" implies a product behaviour (an algorithm that picks the best agent) that is not currently a named, operator-facing feature.
  **Why:** `mockup-reviewer.md § Axis 1 — Vocabulary matches the codebase`. The mockup is implying a feature ("auto-assign with a recommended algorithm") not described in the brief; brief § Capability 2 / Field set says only "Assigned Agent (select from configured subaccount agents)." Either align with the existing `"Unassigned"` empty-option vocabulary, or have the spec author lock the new vocabulary at authoring with a one-line behavioural definition.

- 🟡 `01-default-state.html:96-99` — `agent-hint` info row under the agent picker (*"Auto-assign picks the best available agent for this task."*) is permanent helper text.
  **Why:** `docs/frontend-design-principles.md § Explainer banners` (*"Do not ship permanent help copy at the top of every page"*) and § *Recurring UI patterns / Sub-text on rows* (trim aggressively). Either move this into the agent-select default option's own copy (e.g. just "Auto-assign") and rely on the operator's intuition, or make it a one-time dismissable hint. Static helper text under every default-state field becomes wallpaper.

- 🟡 `02-with-attachments.html:162-167` — Removing a file mid-upload uses an `×` icon with `aria-label="Cancel upload of enrichment_rules.md"`. The same visual `×` does *different* things on different rows (Remove uploaded file vs Cancel in-flight upload). Operator cannot distinguish them by sight, only by inferring from the progress bar.
  **Why:** `docs/frontend-design-principles.md § Re-check before delivery` (the non-technical operator 3-second rule). Consider showing a small "Cancel" text label on in-flight rows, or a different glyph (e.g. a stop icon) during upload — the cost is one row variation; the benefit is that destructive-during-upload is visually distinct.

- 🟡 `02-with-attachments.html:174-180` — Lifecycle notice contains four facts in a single paragraph (task can be created now, uploads continue in background, ready-to-run after settle, auto-promote on failure). Per `docs/frontend-design-principles.md § Recurring UI patterns / Sub-text on rows` ("Multi-fact strings become noise"), this is operator-facing copy that mixes a reassurance and a failure-mode disclaimer.
  **Why:** Combined with the 🟡 "auto-promotes" jargon above, consider splitting: keep the primary reassurance visible always (*"You can create the task now. Uploads will finish in the background."*) and move the failure-mode posture (timeout, auto-start) into a tooltip on a small "What happens if an upload fails?" link. Reduces always-on text weight.

---

### 💭 Consider

- 💭 `01-default-state.html:80` — Instructions placeholder *"Describe what the agent should do. The more context you give here, the less back-and-forth later."* is two sentences. The second sentence is meta-advice rather than placeholder content.
  **Why:** `docs/frontend-design-principles.md § Sub-text on rows` (trim aggressively). Consider just *"What should the agent do?"* — matches the Title placeholder's tone (*"What needs to be done?"*).

- 💭 All three screens — Modal currently has 5 visible "panels" when collapsed. Per `docs/frontend-design-principles.md § Complexity budget per screen` the panel cap is 3. The brief grants implicit latitude here ("the modal grows taller... compactness wins where it doesn't fight clarity") and modals legitimately host more form sections than dashboards. NOT a blocking finding (the brief mockup constraint § Open decisions for the mockup round explicitly contemplates the expanded modal), but worth flagging.
  **Why:** `docs/frontend-design-principles.md § Complexity budget per screen` (panels cap 3 by default; modal context softens this; brief justifies the field set).

- 💭 `02-with-attachments.html:239`, footer counter *"1 upload in progress"*: information is duplicated by the in-row progress bar on the attachment row itself.
  **Why:** `docs/frontend-design-principles.md § Recurring UI patterns / Explainer banners` ("Footer notes that repeat what the banner just said are noise. Pick one, not both."). Drop the footer counter; the row-level progress bar already carries the signal.

- 💭 `01-default-state.html:74`, `02-with-attachments.html:74`, `03-advanced-expanded.html:74` — Instructions label says `(optional)`. The brief is silent on whether Instructions is required for task creation.
  **Why:** `mockup-reviewer.md § Axis 2 — Vocabulary` (mockup language should not pre-commit a contract the spec hasn't decided). Optional vs required is a spec-author decision; flag for spec-coordinator to lock.

- 💭 Screen 03 — Subaccount override is admin-y in spirit (only meaningful when the operator has >1 subaccount). NewBriefModal.tsx:166 already gates it server-side (`subaccounts.length > 0`); the mockup could reflect that pattern more explicitly.
  **Why:** `docs/frontend-design-principles.md § Default-case controls` (single-choice controls hidden).

---

**Grounding verification summary:** All claimed-extension files exist; visual / structural patterns are faithful. No phantom pages, no phantom routes, no phantom nav. "Workspace" active nav element is a real `viewMode` in `client/src/config/sidebar.ts`. Vocabulary mostly matches the codebase except for the agent label ("Assigned Agent" vs "Assign Agent") and the new-to-the-product "Auto-assign (recommended)" option.

**Brief-invariant compliance:**
- Invariant 6 (drag-drop accessibility): drop-zone has `role="button"`, `tabindex="0"`, keyboard handler for Enter/Space, `aria-label`. Non-drag "Browse files" fallback is visible on ALL three screens. PASS.
- Invariant 7 (Title + Instructions + Agent always visible): all three fields are always-visible-and-above-the-fold on every screen, never inside the Advanced expander. PASS.
- Invariant 8 (Instructions canonical, not Description): all three screens label the textarea "Instructions". PASS.
- Invariant 3 + 11 (attachment lifecycle / no stranded tasks): lifecycle notice on Screen 02 explains separation; mentions timeout / auto-start fallback. PASS (with the jargon 🟡 above).
- Em-dashes: visible UI text contains no em-dashes (the `—` characters present are inside HTML/CSS comments, not rendered). PASS.
- Mockup constraints (no scheduling, no recurring toggle, no Preview, no status picker, no multi-agent, no chat tab, no "brief" terminology): verified clean across all three screens. PASS.

Blocking: 0 / Should-fix: 6 / Consider: 5

**Verdict:** CLEAN
```
