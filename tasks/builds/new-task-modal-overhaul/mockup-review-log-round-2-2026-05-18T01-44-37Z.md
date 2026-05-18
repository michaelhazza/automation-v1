```mockup-review-log
## Mockup review — new-task-modal-overhaul — Round 2

**Reviewer:** mockup-reviewer (read-only, proxied via general-purpose)
**Date:** 2026-05-18

**Codebase claims verified:** NewBriefModal.tsx, TaskModal.tsx, format.ts, WorkspaceBoardPage.tsx, sidebar.ts — all exist. No phantom pages, routes, or nav entries. PASS.

**Round 1 resolution check (all 11 findings):**
- SF-1 (jargon): FIXED — "auto-promotes"/"settle" removed; tooltip link holds failure-mode detail
- SF-2 (label drift): FIXED — "Assign Agent" on all screens
- SF-3 (phantom option): FIXED — "Unassigned" on all screens
- SF-4 (permanent hint): FIXED — .agent-hint row removed
- SF-5 (× glyph ambiguity): FIXED — "Cancel" text button on mid-upload rows
- SF-6 (four-fact paragraph): FIXED — two sentences at first paint
- C-1 (placeholder): FIXED — "What should the agent do?"
- C-2 ((optional) label): FIXED — removed from Instructions on all screens
- C-3 (footer counter): FIXED — removed; row-level progress bar carries signal
- C-4 (panel count): FIXED — Agent select inline under Instructions; 4 perceived sections
- C-5 (Subaccount gate): FIXED — HTML comment documents gate condition

---

### 🔴 Blocking findings

(none)

---

### 🟡 Should-fix findings

- 🟡 `01-default-state.html:34`, `02-with-attachments.html:34`, `03-advanced-expanded.html:36` — Nav bar active link label is "Workspace". The canonical nav label in `client/src/config/sidebar.ts:139` for the workspace board page is "Tasks" (key: "tasks", to: `/admin/subaccounts/:id/workspace`). "Workspace" is a viewMode value (sidebar.ts:51), not a nav item label.
  **Why:** `mockup-reviewer.md § Axis 1 — Vocabulary matches the codebase`. Nav bar is decorative blurred chrome (not the design subject), so NOT blocking — the operator reviewing the modal overlay understands the context. Recommend changing the active nav link to "Tasks" for implementer fidelity. Carried from Round 1 (previously accepted); surfaced explicitly here.

---

### 💭 Consider

- 💭 `02-with-attachments.html:183` — "What happens if an upload fails?" tooltip trigger is an `<a>` without `href` (`role="button"`, `tabindex="0"`). Screen readers may behave inconsistently with a bare `<a>` vs a `<button type="button">` styled as a link.
  **Why:** `docs/frontend-design-principles.md § Re-check before delivery` (accessibility). Prototype works; flag for implementer.

- 💭 `index.html:3` — HTML comment still says "Round 1". Minor documentation drift.
  **Why:** Low-signal audit-trail note. Not a UX finding.

---

**Brief-invariant compliance:** Invariants 3, 6, 7, 8, 11 all PASS. Invariants 1,2,4,5,9,10 are non-applicable at mockup phase.

Blocking: 0 / Should-fix: 1 / Consider: 2

**Verdict:** CLEAN
```
